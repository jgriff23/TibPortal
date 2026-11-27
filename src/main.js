'use strict';

const path = require('path');
const {
  app,
  BaseWindow,
  WebContentsView,
  View,
  ipcMain,
  dialog,
  session,
  shell,
  Menu,
  screen,
  Notification,
} = require('electron');
const fs = require('fs');
const { startAutoUpdates } = require('./updater');
const {
  ProfileStore, partitionFor, gridLayout, resizePanes, clampZoom, SHAPES, COLORS, MAX_PROFILES,
} = require('./profiles');
const { notesBetween, shouldShowWhatsNew } = require('./whatsnew');

// The game URL. TIBPORTAL_URL lets us point at a local page while testing.
const GAME_URL = process.env.TIBPORTAL_URL || 'https://play.tibidle.com/';
// The site and the game share this domain (tibidle.com, play.tibidle.com).
const GAME_DOMAIN = process.env.TIBPORTAL_URL
  ? new URL(GAME_URL).hostname
  : 'tibidle.com';
const TOOLBAR_HEIGHT = 44;
const GRID_GAP = 6; // wide enough to grab the dividers between panes
const ICON = path.join(__dirname, '..', 'build', 'icon.png');

let win = null;
let toolbar = null;
let frame = null; // accent outline behind the active grid cell
let store = null;
const views = new Map(); // profile id -> WebContentsView
const attention = new Set(); // profile ids with something new since last viewed
const lastNotified = new Map(); // profile id -> time of last desktop notification
const NOTIFY_COOLDOWN_MS = 30_000;
const popWins = new Map(); // profile id -> BaseWindow for popped-out tabs
const dividers = []; // draggable lines between grid panes
let placeholder = null; // shown in tab view when the active tab is popped out
let lastGrid = null; // last grid layout, for divider drags
let drag = null;
let quitting = false;

// Ask websites for English (Accept-Language and navigator.language).
app.commandLine.appendSwitch('lang', 'en-US');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

function isGameUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === GAME_DOMAIN || u.hostname.endsWith('.' + GAME_DOMAIN);
  } catch {
    return false;
  }
}

function createGameView(profile) {
  const view = new WebContentsView({
    webPreferences: {
      partition: partitionFor(profile.id),
      preload: path.join(__dirname, 'game-preload.js'),
      additionalArguments: [`--tibportal-game-domain=${GAME_DOMAIN}`],
      // Keep hidden sessions running at full speed so idle progress continues.
      backgroundThrottling: false,
      zoomFactor: profile.zoom || 1,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const wc = view.webContents;
  wc.on('did-finish-load', () => {
    const p = store.get(profile.id);
    if (p) wc.setZoomFactor(p.zoom || 1);
  });
  // Ctrl + mouse wheel zooms just this tab.
  wc.on('zoom-changed', (_e, direction) => changeZoom(profile.id, direction === 'in' ? 0.1 : -0.1));

  // Popups from the game (e.g. login windows) stay in the same profile's
  // session; anything outside the game opens in the normal browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (isGameUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { partition: partitionFor(profile.id), sandbox: true },
        },
      };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.setAudioMuted(!!profile.muted);
  wc.on('before-input-event', (e, input) => handleShortcut(e, input));
  wc.on('audio-state-changed', ({ audible }) => {
    if (audible) flagAttention(profile.id, 'is playing sound');
    sendState();
  });

  // Title changes after the page has settled count as "something happened".
  let settled = false;
  let lastTitle = '';
  wc.on('did-start-navigation', (_e, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) settled = false;
  });
  wc.on('did-finish-load', () => setTimeout(() => { settled = true; lastTitle = wc.getTitle(); }, 3000));
  wc.on('page-title-updated', (_e, title) => {
    if (settled && title && lastTitle && title !== lastTitle) flagAttention(profile.id, title);
    lastTitle = title;
    sendState();
  });
  // Clicking into a grid cell makes that profile the active one.
  wc.on('focus', () => {
    if (store.activeId !== profile.id && store.get(profile.id)) {
      store.setActive(profile.id);
      if (!store.isPoppedOut(profile.id)) layout();
      sendState();
    }
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      console.warn(`[${profile.name}] failed to load ${url}: ${desc}`);
    }
  });

  setEnglishDefaults(wc.session).finally(() => wc.loadURL(GAME_URL));
  views.set(profile.id, view);
  return view;
}

function isInView(id) {
  const pop = popWins.get(id);
  if (pop) return pop.isFocused();
  if (!win || !win.isFocused()) return false;
  if (store.view.mode === 'grid') return !store.view.hiddenInGrid.includes(id);
  return store.activeId === id;
}

function flagAttention(id, detail) {
  const profile = store.get(id);
  if (!profile || isInView(id)) return;
  attention.add(id);
  sendState();

  if (!profile.notify || win.isFocused()) return;
  win.flashFrame(true);
  const now = Date.now();
  if (now - (lastNotified.get(id) || 0) < NOTIFY_COOLDOWN_MS) return;
  lastNotified.set(id, now);
  if (Notification.isSupported()) {
    const n = new Notification({ title: `TibPortal: ${profile.name}`, body: String(detail || 'Something changed'), silent: false });
    n.on('click', () => {
      if (win.isMinimized()) win.restore();
      win.focus();
      activate(id);
    });
    n.show();
  }
}

function clearAttentionInView() {
  let changed = false;
  for (const id of [...attention]) {
    if (isInView(id)) {
      attention.delete(id);
      changed = true;
    }
  }
  if (changed) sendState();
}

function activate(id) {
  if (!store.get(id)) return;
  const pop = popWins.get(id);
  if (pop) {
    if (pop.isMinimized()) pop.restore();
    pop.focus();
    store.setActive(id);
    sendState();
    return;
  }
  if (store.view.mode === 'grid' && store.view.hiddenInGrid.includes(id)) {
    store.setShownInGrid(id, true);
  }
  store.setActive(id);
  showActive();
}

function cycle(step) {
  const list = store.view.mode === 'grid' ? store.gridProfiles() : store.list();
  if (list.length === 0) return;
  const i = list.findIndex((p) => p.id === store.activeId);
  activate(list[(i + step + list.length) % list.length].id);
}

function setMuted(id, muted) {
  store.update(id, { muted });
  const view = views.get(id);
  if (view) view.webContents.setAudioMuted(muted);
  sendState();
}

function setZoom(id, zoom) {
  const p = store.update(id, { zoom: clampZoom(zoom) });
  const view = views.get(id);
  if (view) view.webContents.setZoomFactor(p.zoom);
  sendState();
}

function changeZoom(id, delta) {
  const p = store.get(id);
  if (p) setZoom(id, Math.round(((p.zoom || 1) + delta) * 10) / 10);
}

function setAlwaysOnTop(on) {
  store.setAlwaysOnTop(on);
  win.setAlwaysOnTop(on);
  sendState();
}

function addProfile() {
  if (store.list().length >= MAX_PROFILES) return null;
  const profile = store.add();
  // Keep focus in the toolbar so the new profile's name can be typed.
  showActive({ focusGame: false });
  toolbar.webContents.focus();
  return profile;
}

// Keyboard shortcuts work whether the toolbar or a game has focus.
function handleShortcut(event, input) {
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta;
  const key = input.key;
  let handled = true;
  if (ctrl && input.shift && input.code === 'Digit0') {
    if (store.activeId) setZoom(store.activeId, 1);
  } else if (ctrl && (key === '=' || key === '+')) {
    if (store.activeId) changeZoom(store.activeId, 0.1);
  } else if (ctrl && (key === '-' || key === '_')) {
    if (store.activeId) changeZoom(store.activeId, -0.1);
  } else if (ctrl && !input.alt && /^[0-9]$/.test(key)) {
    const index = key === '0' ? 9 : Number(key) - 1;
    const p = store.list()[index];
    if (p) activate(p.id);
  } else if (ctrl && key === 'Tab') {
    cycle(input.shift ? -1 : 1);
  } else if (ctrl && !input.shift && key.toLowerCase() === 'g') {
    store.setMode(store.view.mode === 'grid' ? 'tabs' : 'grid');
    showActive();
  } else if (ctrl && !input.shift && key.toLowerCase() === 'm' && store.activeId) {
    setMuted(store.activeId, !store.get(store.activeId).muted);
  } else if (ctrl && !input.shift && key.toLowerCase() === 't') {
    const p = addProfile();
    if (p) toolbar.webContents.send('rename', p.id);
  } else if (key === 'F5' || (ctrl && !input.shift && key.toLowerCase() === 'r')) {
    const view = store.activeId && views.get(store.activeId);
    if (view) view.webContents.reload();
  } else if (key === 'F11') {
    win.setFullScreen(!win.isFullScreen());
  } else {
    handled = false;
  }
  if (handled) event.preventDefault();
}

const COLOR_LABELS = {
  none: 'None', red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green',
  teal: 'Teal', blue: 'Blue', purple: 'Purple', pink: 'Pink',
};

function showProfileMenu(id) {
  const profile = store.get(id);
  if (!profile) return;
  const grid = store.view.mode === 'grid';
  const menu = Menu.buildFromTemplate([
    { label: 'Rename', click: () => toolbar.webContents.send('rename', id) },
    {
      label: 'Color',
      submenu: Object.entries(COLORS).map(([key, value]) => ({
        label: COLOR_LABELS[key],
        type: 'radio',
        checked: (profile.color || null) === value,
        click: () => { store.update(id, { color: value }); sendState(); },
      })),
    },
    { type: 'separator' },
    { label: 'Mute', type: 'checkbox', checked: !!profile.muted, click: (item) => setMuted(id, item.checked) },
    {
      label: 'Desktop notifications',
      type: 'checkbox',
      checked: profile.notify !== false,
      click: (item) => { store.update(id, { notify: item.checked }); sendState(); },
    },
    {
      label: 'Show in grid',
      type: 'checkbox',
      visible: grid,
      checked: !store.view.hiddenInGrid.includes(id),
      click: (item) => { store.setShownInGrid(id, item.checked); showActive(); },
    },
    {
      label: 'Zoom',
      submenu: [
        ...[0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5].map((z) => ({
          label: `${Math.round(z * 100)}%`,
          type: 'radio',
          checked: Math.abs((profile.zoom || 1) - z) < 0.01,
          click: () => setZoom(id, z),
        })),
        { type: 'separator' },
        { label: 'Zoom in (Ctrl+=)', click: () => changeZoom(id, 0.1) },
        { label: 'Zoom out (Ctrl+-)', click: () => changeZoom(id, -0.1) },
        { label: 'Reset (Ctrl+Shift+0)', click: () => setZoom(id, 1) },
      ],
    },
    store.isPoppedOut(id)
      ? { label: 'Bring back to main window', click: () => bringBack(id) }
      : { label: 'Open in its own window', click: () => popOut(id) },
    { label: 'Reload', enabled: views.has(id), click: () => views.get(id) && views.get(id).webContents.reload() },
    { type: 'separator' },
    { label: 'Delete profile…', click: () => removeProfile(id) },
  ]);
  menu.popup({ window: win });
}

async function removeProfile(id) {
  const profile = store.get(id);
  if (!profile) return false;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Delete profile',
    message: `Delete the profile "${profile.name}"?`,
    detail: 'Its saved login will be removed from this computer. Your game account is not affected.',
  });
  if (response !== 0) return false;
  const pop = popWins.get(id);
  if (pop) {
    popWins.delete(id);
    pop.contentView.removeChildView(views.get(id));
    pop.destroy();
  }
  store.remove(id);
  attention.delete(id);
  await destroyProfileData(id);
  showActive();
  return true;
}

// The tibidle.com website picks its language from the NEXT_LOCALE cookie.
// Set it to English for each profile, unless the player has already chosen.
async function setEnglishDefaults(ses) {
  if (process.env.TIBPORTAL_URL) return;
  try {
    const existing = await ses.cookies.get({ url: 'https://tibidle.com', name: 'NEXT_LOCALE' });
    if (existing.length === 0) {
      await ses.cookies.set({
        url: 'https://tibidle.com',
        name: 'NEXT_LOCALE',
        value: 'en',
        domain: '.tibidle.com',
        path: '/',
        secure: true,
        sameSite: 'lax',
        expirationDate: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600,
      });
    }
  } catch (err) {
    console.warn('Could not set language cookie:', err);
  }
}

function viewFor(id) {
  const profile = store.get(id);
  if (!profile) return null;
  return views.get(id) || createGameView(profile);
}

function gameArea() {
  const { width, height } = win.getContentBounds();
  return { x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) };
}

function ensureAttached(id) {
  const view = viewFor(id);
  if (view && !store.isPoppedOut(id) && !win.contentView.children.includes(view)) {
    win.contentView.addChildView(view);
  }
  return view;
}

function gridInset(area) {
  return {
    x: area.x + GRID_GAP,
    y: area.y + GRID_GAP,
    width: area.width - GRID_GAP * 2,
    height: area.height - GRID_GAP * 2,
  };
}

function layout() {
  if (!win) return;
  const { width } = win.getContentBounds();
  toolbar.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT });
  const area = gameArea();
  const placements = new Map();
  const v = store.view;
  let showPlaceholder = false;
  lastGrid = null;

  if (v.mode === 'grid') {
    const shown = store.gridProfiles();
    const inset = gridInset(area);
    lastGrid = { ...gridLayout(shown.length, inset, GRID_GAP, v), inset };
    lastGrid.cells.forEach((cell, i) => placements.set(shown[i].id, cell));
  } else if (store.activeId) {
    if (store.isPoppedOut(store.activeId)) showPlaceholder = true;
    else placements.set(store.activeId, area);
  }

  for (const id of placements.keys()) ensureAttached(id);
  for (const [id, view] of views) {
    if (store.isPoppedOut(id)) continue;
    const bounds = placements.get(id);
    view.setVisible(!!bounds);
    if (bounds) view.setBounds(bounds);
  }

  // Outline the active cell in grid mode.
  const activeCell = v.mode === 'grid' && placements.size > 1 && placements.get(store.activeId);
  if (activeCell) {
    frame.setBounds({
      x: activeCell.x - 2,
      y: activeCell.y - 2,
      width: activeCell.width + 4,
      height: activeCell.height + 4,
    });
    // Keep the frame at the back, behind the game views.
    win.contentView.addChildView(frame, 0);
    frame.setVisible(true);
  } else {
    frame.setVisible(false);
  }

  layoutDividers();
  layoutPlaceholder(showPlaceholder ? area : null);
}

// ---- Draggable dividers between grid panes ----

function dividerView(i) {
  if (!dividers[i]) {
    const d = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    d.setBackgroundColor('#00000000');
    d.webContents.loadFile(path.join(__dirname, 'ui', 'divider.html'));
    dividers[i] = d;
  }
  return dividers[i];
}

function layoutDividers() {
  const lines = [];
  if (lastGrid && lastGrid.cells.length > 0) {
    const { inset } = lastGrid;
    lastGrid.colDividers.forEach((x, index) => lines.push({
      kind: 'col', index,
      bounds: { x: Math.round(x - GRID_GAP / 2), y: inset.y, width: GRID_GAP, height: inset.height },
    }));
    lastGrid.rowDividers.forEach((y, index) => lines.push({
      kind: 'row', index,
      bounds: { x: inset.x, y: Math.round(y - GRID_GAP / 2), width: inset.width, height: GRID_GAP },
    }));
  }
  lines.forEach((line, i) => {
    const d = dividerView(i);
    if (!win.contentView.children.includes(d)) win.contentView.addChildView(d);
    else win.contentView.addChildView(d); // keep dividers on top
    d.setBounds(line.bounds);
    d.setVisible(true);
    const send = () => d.webContents.send('divider', { kind: line.kind, index: line.index });
    if (d.webContents.isLoading()) d.webContents.once('did-finish-load', send);
    else send();
  });
  for (let i = lines.length; i < dividers.length; i++) dividers[i].setVisible(false);
}

function onDividerDrag(phase, { kind, index, screenX, screenY } = {}) {
  if (!lastGrid) return;
  if (phase === 'reset') {
    store.setPaneSizes(null, null);
    layout();
    return;
  }
  if (phase === 'start') {
    drag = { kind, index };
    return;
  }
  if (!drag) return;
  if (phase === 'move') {
    const content = win.getContentBounds();
    const { inset, cols, rows } = lastGrid;
    if (drag.kind === 'col') {
      const usable = inset.width - GRID_GAP * (cols - 1);
      const pos = screenX - content.x - inset.x - GRID_GAP * (drag.index + 0.5);
      const sizes = resizePanes(lastGrid.colSizes, drag.index, pos, usable);
      store.setPaneSizes(sizes, store.view.rowSizes && store.view.rowSizes.length === rows ? store.view.rowSizes : lastGrid.rowSizes, { persist: false });
    } else {
      const usable = inset.height - GRID_GAP * (rows - 1);
      const pos = screenY - content.y - inset.y - GRID_GAP * (drag.index + 0.5);
      const sizes = resizePanes(lastGrid.rowSizes, drag.index, pos, usable);
      store.setPaneSizes(store.view.colSizes && store.view.colSizes.length === cols ? store.view.colSizes : lastGrid.colSizes, sizes, { persist: false });
    }
    layout();
  } else if (phase === 'end') {
    drag = null;
    const v = store.view;
    store.setPaneSizes(v.colSizes, v.rowSizes);
  }
}

// ---- Pop-out windows ----

function layoutPlaceholder(bounds) {
  if (!bounds) {
    if (placeholder) placeholder.setVisible(false);
    return;
  }
  if (!placeholder) {
    placeholder = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    placeholder.webContents.loadFile(path.join(__dirname, 'ui', 'placeholder.html'));
    placeholder.webContents.on('did-finish-load', () => sendState());
  }
  if (!win.contentView.children.includes(placeholder)) win.contentView.addChildView(placeholder);
  placeholder.setBounds(bounds);
  placeholder.setVisible(true);
}

function popOut(id, savedBounds) {
  const profile = store.get(id);
  if (!profile || popWins.has(id)) return;
  const view = viewFor(id);
  if (win.contentView.children.includes(view)) win.contentView.removeChildView(view);

  const bounds = savedBounds && isOnScreen(savedBounds) ? savedBounds : { width: 960, height: 680 };
  const pop = new BaseWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 240,
    title: `${profile.name} - TibPortal`,
    icon: ICON,
    backgroundColor: '#14161a',
  });
  pop.contentView.addChildView(view);
  view.setVisible(true);
  const fit = () => {
    const { width, height } = pop.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  fit();
  pop.on('resize', fit);
  pop.on('focus', () => {
    clearAttentionInView();
    if (store.activeId !== id) { store.setActive(id); sendState(); }
  });
  pop.on('close', () => {
    if (quitting) {
      // Remember where it was so it reopens there next time.
      store.setPopout(id, pop.getNormalBounds());
      return;
    }
    pop.contentView.removeChildView(view);
    popWins.delete(id);
    store.setPopout(id, null);
    showActive({ focusGame: false });
  });
  popWins.set(id, pop);
  store.setPopout(id, pop.getNormalBounds());
  view.webContents.focus();
  showActive({ focusGame: false });
}

function bringBack(id) {
  const pop = popWins.get(id);
  if (pop) pop.close(); // the close handler moves the tab back
}

function syncPopouts() {
  const wanted = store.view.popouts;
  for (const id of [...popWins.keys()]) if (!(id in wanted)) bringBack(id);
  for (const [id, bounds] of Object.entries(wanted)) if (!popWins.has(id)) popOut(id, bounds);
}

// ---- Layout and app menus ----

const SHAPE_LABELS = {
  auto: 'Auto (fits the number of tabs)', '2x1': '2 × 1', '3x1': '3 × 1', '2x2': '2 × 2',
  '3x2': '3 × 2', '4x2': '4 × 2', '3x3': '3 × 3', '5x2': '5 × 2',
};

function showLayoutMenu() {
  const v = store.view;
  const layouts = store.listLayouts();
  Menu.buildFromTemplate([
    {
      label: 'Grid size',
      submenu: SHAPES.map((shape) => ({
        label: SHAPE_LABELS[shape],
        type: 'radio',
        checked: v.shape === shape,
        click: () => { store.setShape(shape); store.setMode('grid'); showActive(); },
      })),
    },
    { label: 'Even out pane sizes', enabled: !!(v.colSizes || v.rowSizes), click: () => onDividerDrag('reset') },
    { type: 'separator' },
    { label: 'Saved layouts', enabled: false },
    ...(layouts.length
      ? layouts.map((l) => ({ label: `   ${l.name}`, click: () => applySavedLayout(l.name) }))
      : [{ label: '   (none yet)', enabled: false }]),
    { type: 'separator' },
    { label: 'Save current layout…', click: () => askFor('saveLayout', 'Layout name', '') },
    {
      label: 'Delete a saved layout',
      enabled: layouts.length > 0,
      submenu: layouts.map((l) => ({ label: l.name, click: () => { store.deleteLayout(l.name); sendState(); } })),
    },
  ]).popup({ window: win });
}

function applySavedLayout(name) {
  store.applyLayout(name);
  syncPopouts();
  showActive();
}

function askFor(kind, label, value) {
  toolbar.webContents.focus();
  toolbar.webContents.send('prompt', { kind, label, value });
}

function showAppMenu() {
  Menu.buildFromTemplate([
    { label: 'Export profiles…', click: exportProfiles },
    { label: 'Import profiles…', click: importProfiles },
    { type: 'separator' },
    { label: "What's new", click: () => showWhatsNew(null) },
    { label: `TibPortal ${app.getVersion()}`, enabled: false },
  ]).popup({ window: win });
}

async function exportProfiles() {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export profiles',
    defaultPath: path.join(app.getPath('documents'), 'TibPortal-profiles.json'),
    filters: [{ name: 'TibPortal profiles', extensions: ['json'] }],
  });
  if (canceled || !filePath) return;
  const data = store.exportData();
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    dialog.showErrorBox('Export failed', String(err.message || err));
    return;
  }
  dialog.showMessageBox(win, {
    type: 'info',
    title: 'Profiles exported',
    message: `Exported ${data.profiles.length} profile${data.profiles.length === 1 ? '' : 's'} and ${data.layouts.length} saved layout${data.layouts.length === 1 ? '' : 's'}.`,
    detail: 'The file has names, colors and settings only. Logins and passwords are never included, so it is safe to share.',
  });
}

async function importProfiles() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import profiles',
    properties: ['openFile'],
    filters: [{ name: 'TibPortal profiles', extensions: ['json'] }],
  });
  if (canceled || !filePaths || !filePaths[0]) return;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (!data || data.app !== 'TibPortal' || !Array.isArray(data.profiles)) throw new Error("This file isn't a TibPortal profile export.");
  } catch (err) {
    dialog.showErrorBox('Import failed', err instanceof SyntaxError ? "This file isn't a TibPortal profile export." : String(err.message || err));
    return;
  }
  const room = MAX_PROFILES - store.list().length;
  if (room <= 0) {
    dialog.showMessageBox(win, { type: 'warning', title: 'No room', message: `You already have ${MAX_PROFILES} profiles, the most TibPortal allows. Delete some first.` });
    return;
  }
  const count = data.profiles.length;
  const layoutCount = Array.isArray(data.layouts) ? data.layouts.length : 0;
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Import', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Import profiles',
    message: `Add ${count} profile${count === 1 ? '' : 's'}${layoutCount ? ` and ${layoutCount} saved layout${layoutCount === 1 ? '' : 's'}` : ''} to TibPortal?`,
    detail: `They're added next to your current profiles. Imported profiles start logged out, so you'll log in once in each.${count > room ? `\n\nOnly ${room} will fit (the limit is ${MAX_PROFILES}).` : ''}`,
  });
  if (response !== 0) return;
  const result = store.importData(data);
  showActive();
  if (result.skipped > 0) {
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Import finished',
      message: `Added ${result.added} profile${result.added === 1 ? '' : 's'}. ${result.skipped} didn't fit and were skipped.`,
      detail: 'Saved layouts are only imported when all of their profiles fit.',
    });
  }
}

function showWhatsNew(since) {
  const version = app.getVersion();
  const entries = notesBetween(since, version);
  if (entries.length === 0) return;
  const detail = entries
    .map((e) => (entries.length > 1 ? `Version ${e.version}\n` : '') + e.notes.map((n) => `•  ${n}`).join('\n'))
    .join('\n\n');
  dialog.showMessageBox(win, {
    type: 'info',
    title: "What's new",
    message: `What's new in TibPortal ${version}`,
    detail,
    buttons: ['OK'],
  });
}

function maybeShowWhatsNew() {
  const current = app.getVersion();
  const lastSeen = store.lastSeenVersion;
  const show = shouldShowWhatsNew({ lastSeen, current, isFirstRun: !store.existedBefore });
  store.setLastSeenVersion(current);
  if (show) setTimeout(() => showWhatsNew(lastSeen), 1500);
}

function showActive({ focusGame = true } = {}) {
  layout();
  const view = store.activeId && views.get(store.activeId);
  if (view && focusGame) view.webContents.focus();
  clearAttentionInView();
  sendState();
}

function sendState() {
  if (!toolbar || toolbar.webContents.isDestroyed()) return;
  const state = {
    profiles: store.list().map((p) => ({
      ...p,
      loaded: views.has(p.id),
      title: views.has(p.id) ? views.get(p.id).webContents.getTitle() : '',
      audible: views.has(p.id) ? views.get(p.id).webContents.isCurrentlyAudible() : false,
      attention: attention.has(p.id),
      poppedOut: store.isPoppedOut(p.id),
    })),
    shape: store.view.shape,
    activeId: store.activeId,
    alwaysOnTop: !!store.view.alwaysOnTop,
    mode: store.view.mode,
    hiddenInGrid: store.view.hiddenInGrid,
    layouts: store.listLayouts(),
    max: MAX_PROFILES,
  };
  toolbar.webContents.send('state', state);
  if (placeholder && !placeholder.webContents.isDestroyed()) placeholder.webContents.send('state', state);
}

async function destroyProfileData(id) {
  const view = views.get(id);
  if (view) {
    win.contentView.removeChildView(view);
    view.webContents.close();
    views.delete(id);
  }
  try {
    await session.fromPartition(partitionFor(id)).clearStorageData();
  } catch (err) {
    console.warn('Could not clear profile storage:', err);
  }
}

function registerIpc() {
  ipcMain.handle('profiles:add', () => addProfile());

  ipcMain.handle('toolbar:focus', () => toolbar.webContents.focus());

  ipcMain.handle('profiles:rename', (_e, id, name) => {
    const profile = store.rename(id, name);
    sendState();
    return profile;
  });

  ipcMain.handle('profiles:remove', (_e, id) => removeProfile(id));

  ipcMain.handle('profiles:activate', (_e, id) => activate(id));

  ipcMain.handle('profiles:menu', (_e, id) => showProfileMenu(id));

  ipcMain.handle('profiles:mute', (_e, id) => {
    const p = store.get(id);
    if (p) setMuted(id, !p.muted);
  });

  ipcMain.handle('view:alwaysOnTop', () => setAlwaysOnTop(!store.view.alwaysOnTop));

  ipcMain.handle('profiles:move', (_e, id, toIndex) => {
    store.move(id, toIndex);
    layout();
    sendState();
  });

  ipcMain.handle('profiles:reload', (_e, id) => {
    const view = views.get(id);
    if (view) view.webContents.reload();
  });

  ipcMain.handle('view:mode', (_e, mode) => {
    store.setMode(mode);
    showActive();
  });

  ipcMain.handle('grid:toggle', (_e, id) => {
    const hidden = store.view.hiddenInGrid.includes(id);
    store.setShownInGrid(id, hidden);
    showActive();
  });

  ipcMain.handle('state:get', () => sendState());

  ipcMain.handle('menu:layout', () => showLayoutMenu());
  ipcMain.handle('menu:app', () => showAppMenu());
  ipcMain.handle('profiles:bringBack', (_e, id) => bringBack(id));
  ipcMain.handle('prompt:submit', (_e, kind, value) => {
    if (kind === 'saveLayout') {
      const saved = store.saveLayout(value);
      sendState();
      return saved;
    }
    return null;
  });
  ipcMain.on('divider', (_e, phase, data) => onDividerDrag(phase, data));
}

function isOnScreen(b) {
  return screen.getAllDisplays().some(({ workArea: d }) =>
    b.x < d.x + d.width - 50 && b.x + b.width > d.x + 50 && b.y >= d.y - 10 && b.y < d.y + d.height - 50);
}

function createWindow() {
  const saved = store.view;
  const bounds = saved.bounds && isOnScreen(saved.bounds) ? saved.bounds : { width: 1280, height: 800 };
  win = new BaseWindow({
    ...bounds,
    minWidth: 640,
    minHeight: 400,
    title: 'TibPortal',
    icon: ICON,
    backgroundColor: '#14161a',
  });

  toolbar = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.contentView.addChildView(toolbar);
  toolbar.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'));
  toolbar.webContents.on('did-finish-load', () => sendState());
  toolbar.webContents.on('before-input-event', (e, input) => handleShortcut(e, input));

  if (saved.maximized) win.maximize();
  if (saved.alwaysOnTop) win.setAlwaysOnTop(true);

  frame = new View();
  frame.setBackgroundColor('#5b9dff');
  frame.setVisible(false);
  win.contentView.addChildView(frame);

  win.on('resize', layout);
  win.on('focus', () => {
    win.flashFrame(false);
    clearAttentionInView();
  });
  win.on('close', () => {
    store.setWindowState(win.getNormalBounds(), win.isMaximized());
    // Closing the main window closes pop-outs too, but remembers them.
    quitting = true;
    for (const pop of popWins.values()) pop.close();
  });
  win.on('closed', () => {
    win = null;
  });

  showActive();
}

if (process.platform === 'win32') app.setAppUserModelId('com.tibportal.app');

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  store = new ProfileStore(path.join(app.getPath('userData'), 'profiles.json'));
  if (store.list().length === 0) store.add('Main');
  registerIpc();
  createWindow();
  syncPopouts();
  maybeShowWhatsNew();
  startAutoUpdates(() => win);
});

app.on('window-all-closed', () => app.quit());

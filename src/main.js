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
const { ProfileStore, partitionFor, gridCells, COLORS, MAX_PROFILES } = require('./profiles');

// The game URL. TIBPORTAL_URL lets us point at a local page while testing.
const GAME_URL = process.env.TIBPORTAL_URL || 'https://tibidle.com';
const GAME_ORIGIN = new URL(GAME_URL).origin;
const TOOLBAR_HEIGHT = 44;
const GRID_GAP = 2;

let win = null;
let toolbar = null;
let frame = null; // accent outline behind the active grid cell
let store = null;
const views = new Map(); // profile id -> WebContentsView
const attention = new Set(); // profile ids with something new since last viewed
const lastNotified = new Map(); // profile id -> time of last desktop notification
const NOTIFY_COOLDOWN_MS = 30_000;

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
    return u.origin === GAME_ORIGIN || u.hostname.endsWith('.' + new URL(GAME_URL).hostname);
  } catch {
    return false;
  }
}

function createGameView(profile) {
  const view = new WebContentsView({
    webPreferences: {
      partition: partitionFor(profile.id),
      // Keep hidden sessions running at full speed so idle progress continues.
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const wc = view.webContents;

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
      layout();
      sendState();
    }
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      console.warn(`[${profile.name}] failed to load ${url}: ${desc}`);
    }
  });

  wc.loadURL(GAME_URL);
  views.set(profile.id, view);
  return view;
}

function isInView(id) {
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

function setAlwaysOnTop(on) {
  store.setAlwaysOnTop(on);
  win.setAlwaysOnTop(on);
  sendState();
}

function addProfile() {
  if (store.list().length >= MAX_PROFILES) return null;
  const profile = store.add();
  showActive();
  return profile;
}

// Keyboard shortcuts work whether the toolbar or a game has focus.
function handleShortcut(event, input) {
  if (input.type !== 'keyDown') return;
  const ctrl = input.control || input.meta;
  const key = input.key;
  let handled = true;
  if (ctrl && !input.alt && /^[0-9]$/.test(key)) {
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
  store.remove(id);
  attention.delete(id);
  await destroyProfileData(id);
  showActive();
  return true;
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
  if (view && !win.contentView.children.includes(view)) {
    win.contentView.addChildView(view);
  }
  return view;
}

function layout() {
  if (!win) return;
  const { width } = win.getContentBounds();
  toolbar.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT });
  const area = gameArea();
  const placements = new Map();

  if (store.view.mode === 'grid') {
    const shown = store.gridProfiles();
    const inset = {
      x: area.x + GRID_GAP,
      y: area.y + GRID_GAP,
      width: area.width - GRID_GAP * 2,
      height: area.height - GRID_GAP * 2,
    };
    const cells = gridCells(shown.length, inset, GRID_GAP);
    shown.forEach((p, i) => placements.set(p.id, cells[i]));
  } else if (store.activeId) {
    placements.set(store.activeId, area);
  }

  for (const id of placements.keys()) ensureAttached(id);
  for (const [id, view] of views) {
    const bounds = placements.get(id);
    view.setVisible(!!bounds);
    if (bounds) view.setBounds(bounds);
  }

  // Outline the active cell in grid mode.
  const activeCell = store.view.mode === 'grid' && placements.size > 1 && placements.get(store.activeId);
  if (activeCell) {
    frame.setBounds({
      x: activeCell.x - GRID_GAP,
      y: activeCell.y - GRID_GAP,
      width: activeCell.width + GRID_GAP * 2,
      height: activeCell.height + GRID_GAP * 2,
    });
    // Keep the frame at the back, behind the game views.
    win.contentView.addChildView(frame, 0);
    frame.setVisible(true);
  } else {
    frame.setVisible(false);
  }
}

function showActive() {
  layout();
  const view = store.activeId && views.get(store.activeId);
  if (view) view.webContents.focus();
  clearAttentionInView();
  sendState();
}

function sendState() {
  if (!toolbar || toolbar.webContents.isDestroyed()) return;
  toolbar.webContents.send('state', {
    profiles: store.list().map((p) => ({
      ...p,
      loaded: views.has(p.id),
      title: views.has(p.id) ? views.get(p.id).webContents.getTitle() : '',
      audible: views.has(p.id) ? views.get(p.id).webContents.isCurrentlyAudible() : false,
      attention: attention.has(p.id),
    })),
    activeId: store.activeId,
    alwaysOnTop: !!store.view.alwaysOnTop,
    mode: store.view.mode,
    hiddenInGrid: store.view.hiddenInGrid,
    max: MAX_PROFILES,
  });
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
});

app.on('window-all-closed', () => app.quit());

'use strict';

const path = require('path');
const {
  app,
  BaseWindow,
  WebContentsView,
  ipcMain,
  dialog,
  session,
  shell,
  Menu,
} = require('electron');
const { ProfileStore, partitionFor, MAX_PROFILES } = require('./profiles');

// The game URL. TIBPORTAL_URL lets us point at a local page while testing.
const GAME_URL = process.env.TIBPORTAL_URL || 'https://tibidle.com';
const GAME_ORIGIN = new URL(GAME_URL).origin;
const TOOLBAR_HEIGHT = 44;

let win = null;
let toolbar = null;
let store = null;
const views = new Map(); // profile id -> WebContentsView

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

  wc.on('page-title-updated', () => sendState());
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      console.warn(`[${profile.name}] failed to load ${url}: ${desc}`);
    }
  });

  wc.loadURL(GAME_URL);
  views.set(profile.id, view);
  return view;
}

function viewFor(id) {
  const profile = store.get(id);
  if (!profile) return null;
  return views.get(id) || createGameView(profile);
}

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  toolbar.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT });
  const gameBounds = { x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) };
  for (const [id, view] of views) {
    const visible = id === store.activeId;
    view.setVisible(visible);
    if (visible) view.setBounds(gameBounds);
  }
}

function showActive() {
  const id = store.activeId;
  if (id) {
    const view = viewFor(id);
    if (view && !win.contentView.children.includes(view)) {
      win.contentView.addChildView(view);
    }
  }
  layout();
  if (id && views.get(id)) views.get(id).webContents.focus();
  sendState();
}

function sendState() {
  if (!toolbar || toolbar.webContents.isDestroyed()) return;
  toolbar.webContents.send('state', {
    profiles: store.list().map((p) => ({
      ...p,
      loaded: views.has(p.id),
      title: views.has(p.id) ? views.get(p.id).webContents.getTitle() : '',
    })),
    activeId: store.activeId,
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
  ipcMain.handle('profiles:add', (_e, name) => {
    const profile = store.add(name);
    showActive();
    return profile;
  });

  ipcMain.handle('profiles:rename', (_e, id, name) => {
    const profile = store.rename(id, name);
    sendState();
    return profile;
  });

  ipcMain.handle('profiles:remove', async (_e, id) => {
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
    await destroyProfileData(id);
    showActive();
    return true;
  });

  ipcMain.handle('profiles:activate', (_e, id) => {
    store.setActive(id);
    showActive();
  });

  ipcMain.handle('profiles:move', (_e, id, toIndex) => {
    store.move(id, toIndex);
    sendState();
  });

  ipcMain.handle('profiles:reload', (_e, id) => {
    const view = views.get(id);
    if (view) view.webContents.reload();
  });

  ipcMain.handle('state:get', () => sendState());
}

function createWindow() {
  win = new BaseWindow({
    width: 1280,
    height: 800,
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

  win.on('resize', layout);
  win.on('closed', () => {
    win = null;
  });

  showActive();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  store = new ProfileStore(path.join(app.getPath('userData'), 'profiles.json'));
  if (store.list().length === 0) store.add('Main');
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());

'use strict';

// Automatic updates for the installed version of TibPortal.
//
// On startup (and every few hours) the app asks GitHub Releases whether a
// newer version exists. If so it downloads it in the background, then asks
// whether to restart now. "Restart now" installs silently (no installer
// wizard) and reopens TibPortal. If you choose "Later", it installs
// silently the next time you close the app.
//
// The portable .exe can't replace itself, so it only checks and tells you
// where to download the new version.

const { app, dialog, shell } = require('electron');

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const RELEASES_URL = 'https://github.com/jgriff23/TibPortal/releases/latest';

function isPortable() {
  return !!process.env.PORTABLE_EXECUTABLE_DIR;
}

function startAutoUpdates(getWindow, onStatus = () => {}) {
  if (!app.isPackaged || process.env.TIBPORTAL_DISABLE_UPDATES) return null;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.warn('Updater unavailable:', err);
    return null;
  }

  const portable = isPortable();
  autoUpdater.autoDownload = !portable;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  let prompted = false;

  autoUpdater.on('update-available', async (info) => {
    onStatus({ state: portable ? 'available' : 'downloading', version: info.version });
    if (!portable || prompted) return;
    prompted = true;
    const win = getWindow();
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update available',
      message: `TibPortal ${info.version} is available.`,
      detail: 'The portable version can\'t update itself. Download the new .exe from the Releases page, or use the installer to get automatic updates.',
    });
    if (response === 0) shell.openExternal(RELEASES_URL);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    onStatus({ state: 'ready', version: info.version });
    if (prompted) return;
    prompted = true;
    const win = getWindow();
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `TibPortal ${info.version} has been downloaded.`,
      detail: 'Restart now to update. TibPortal closes, installs the update and reopens by itself. Your profiles and logins are kept. If you choose Later, it will update the next time you close TibPortal.',
    });
    // Silent install (/S) and relaunch afterwards (--force-run).
    if (response === 0) autoUpdater.quitAndInstall(true, true);
  });

  autoUpdater.on('error', (err) => {
    // Offline or GitHub unreachable: try again at the next check.
    console.warn('Update check failed:', err && err.message);
    onStatus({ state: 'error' });
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 10_000);
  setInterval(check, CHECK_EVERY_MS);

  return { check };
}

module.exports = { startAutoUpdates };

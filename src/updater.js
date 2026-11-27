'use strict';

// Automatic updates for the installed version of TibPortal.
//
// While the app is running it asks GitHub Releases every 30 minutes (and
// when you come back to the window) whether a newer version exists. If so it
// downloads it in the background, then asks whether to restart now.
// "Restart now" runs the installer with no questions: only a progress bar
// shows (see build/installer.nsh), then TibPortal reopens. If you choose "Later", it installs silently the next time you
// close the app. "Check for updates…" in the ⋯ menu checks right away.
//
// The portable .exe can't replace itself, so it only checks and tells you
// where to download the new version.

const { app, dialog, shell } = require('electron');

const CHECK_EVERY_MS = 30 * 60 * 1000;
const FOCUS_CHECK_AFTER_MS = 10 * 60 * 1000;
const RELEASES_URL = 'https://github.com/jgriff23/TibPortal/releases/latest';

function isPortable() {
  return !!process.env.PORTABLE_EXECUTABLE_DIR;
}

function startAutoUpdates(getWindow) {
  const info = (message, detail) => dialog.showMessageBox(getWindow(), {
    type: 'info', buttons: ['OK'], title: 'Updates', message, detail,
  });

  const disabled = {
    status: () => ({ state: 'off' }),
    checkNow: () => info('Updates only work in the installed app.',
      'This copy of TibPortal was started from source, so it doesn\'t update itself.'),
    nudge: () => {},
  };
  if (!app.isPackaged || process.env.TIBPORTAL_DISABLE_UPDATES) return disabled;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.warn('Updater unavailable:', err);
    return disabled;
  }

  const portable = isPortable();
  autoUpdater.autoDownload = !portable;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  let state = 'idle'; // idle | downloading | ready
  let version = null; // version being downloaded or ready to install
  let manual = false; // the current check was started from the menu
  let lastCheck = 0;
  const prompted = new Set(); // versions we've already popped a dialog for

  async function promptRestart() {
    const { response } = await dialog.showMessageBox(getWindow(), {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `TibPortal ${version} has been downloaded.`,
      detail: 'Restart now to update. TibPortal closes, shows a progress bar while it installs, and reopens by itself. Your profiles and logins are kept. If you choose Later, it will update the next time you close TibPortal.',
    });
    // Not silent, so the installer's progress bar shows. With --updated the
    // installer skips its questions and reopens the app when done.
    if (response === 0) autoUpdater.quitAndInstall(false, true);
  }

  async function promptDownload(v) {
    const { response } = await dialog.showMessageBox(getWindow(), {
      type: 'info',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update available',
      message: `TibPortal ${v} is available.`,
      detail: 'The portable version can\'t update itself. Download the new .exe from the Releases page, or use the installer to get automatic updates.',
    });
    if (response === 0) shell.openExternal(RELEASES_URL);
  }

  autoUpdater.on('update-available', (u) => {
    const wasManual = manual;
    manual = false;
    if (portable) {
      if (wasManual || !prompted.has(u.version)) {
        prompted.add(u.version);
        promptDownload(u.version);
      }
      return;
    }
    state = 'downloading';
    version = u.version;
    if (wasManual) {
      info(`TibPortal ${u.version} is available.`,
        'It\'s downloading in the background. You\'ll be asked to restart when it\'s ready.');
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (manual) info('You\'re up to date.', `TibPortal ${app.getVersion()} is the latest version.`);
    manual = false;
  });

  // Download progress on the taskbar button.
  const taskbar = (value) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.setProgressBar(value);
  };
  autoUpdater.on('download-progress', (p) => taskbar(Math.max(0, Math.min(1, p.percent / 100))));

  autoUpdater.on('update-downloaded', (u) => {
    taskbar(-1);
    state = 'ready';
    version = u.version;
    if (prompted.has(u.version)) return;
    prompted.add(u.version);
    promptRestart();
  });

  autoUpdater.on('error', (err) => {
    // Offline or GitHub unreachable: try again at the next check.
    console.warn('Update check failed:', err && err.message);
    if (manual) {
      dialog.showMessageBox(getWindow(), {
        type: 'warning', buttons: ['OK'], title: 'Updates',
        message: 'Couldn\'t check for updates.',
        detail: 'Check your internet connection and try again later.',
      });
    }
    manual = false;
    if (state === 'downloading') {
      state = 'idle';
      taskbar(-1);
    }
  });

  function check() {
    // Once an update is downloading or downloaded there's nothing new to find.
    if (state !== 'idle') return;
    lastCheck = Date.now();
    autoUpdater.checkForUpdates().catch(() => {});
  }

  setTimeout(check, 10_000);
  setInterval(check, CHECK_EVERY_MS);

  return {
    status: () => ({ state, version }),
    // From the ⋯ menu: check now and always say what happened.
    checkNow() {
      if (state === 'ready') return promptRestart();
      if (state === 'downloading') {
        return info(`TibPortal ${version} is downloading.`,
          'You\'ll be asked to restart when it\'s ready.');
      }
      manual = true;
      check();
    },
    // When the window comes back into focus, check if it's been a while.
    nudge() {
      if (Date.now() - lastCheck > FOCUS_CHECK_AFTER_MS) check();
    },
  };
}

module.exports = { startAutoUpdates };

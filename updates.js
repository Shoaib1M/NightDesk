'use strict';
// Updates from GitHub Releases. The installed app checks a minute after it starts and then every
// 4 hours, downloads a new version in the background (only the changed parts when it can, using the
// .blockmap files the release carries), and installs it when the app quits, or straight away when
// the user presses "Restart to update". Data is never touched: it lives in %USERPROFILE%\.nightdesk.
//
// Test hook: NIGHTDESK_UPDATE_URL=<folder or http URL with latest.yml> makes the app read updates
// from there instead of GitHub (used to try a real update locally before releasing).
const { app } = require('electron');

module.exports = function updates({ getWin, prefs, savePrefs, handle, logInfo, logError, isTest, beforeInstall }) {
  const state = { state: 'idle', version: app.getVersion(), next: null, percent: 0, error: '', checkedAt: 0 };
  const send = () => { const w = getWin(); if (w) w.webContents.send('app:update', { ...state }); };
  const set = (patch) => { Object.assign(state, patch); send(); };

  handle('update:state', () => ({ ...state, auto: prefs.autoUpdate !== false, packaged: app.isPackaged }));

  // Only the installed app updates itself; a copy run from the project folder never does.
  const feed = process.env.NIGHTDESK_UPDATE_URL;
  if ((!app.isPackaged && !feed) || isTest) {
    handle('update:check', () => { throw new Error('Updates only work in the installed app.'); });
    handle('update:install', () => false);
    handle('update:setAuto', (on) => { prefs.autoUpdate = !!on; savePrefs(); return prefs.autoUpdate; });
    return { state };
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = { info: (m) => logInfo(`update: ${m}`), warn: (m) => logInfo(`update: ${m}`), error: (m) => logError('update', m), debug() {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = prefs.autoUpdate !== false;
  autoUpdater.allowDowngrade = false;
  if (feed) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  }

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: '' }));
  autoUpdater.on('update-not-available', () => set({ state: 'latest', checkedAt: Date.now() }));
  autoUpdater.on('update-available', (i) => set({ state: 'downloading', next: i.version, percent: 0, checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => { logInfo(`update: ${i.version} downloaded, installs on restart`); set({ state: 'ready', next: i.version, percent: 100 }); });
  autoUpdater.on('error', (err) => set({ state: 'error', error: String((err && err.message) || err).split('\n')[0].slice(0, 200) }));

  // Offline, GitHub down or rate-limited: just try again at the next check.
  const check = () => autoUpdater.checkForUpdates().catch((err) => set({ state: 'error', error: String(err && err.message).slice(0, 200) }));
  setTimeout(check, feed ? 3000 : 60000);
  setInterval(check, 4 * 3600000);

  handle('update:check', () => { check(); return true; });
  handle('update:install', () => {
    if (state.state !== 'ready') return false;
    logInfo(`update: restarting to install ${state.next}`);
    beforeInstall();
    setImmediate(() => autoUpdater.quitAndInstall(true, true)); // silent install, then reopen
    return true;
  });
  handle('update:setAuto', (on) => {
    prefs.autoUpdate = !!on; savePrefs();
    autoUpdater.autoInstallOnAppQuit = prefs.autoUpdate;
    return prefs.autoUpdate;
  });
  return { state, check };
};

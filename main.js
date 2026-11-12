'use strict';
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, nativeTheme, powerSaveBlocker, net, screen, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const gcal = require('./gcal');
const spotify = require('./spotify');
const db = require('./db');

// Keep Windows' taskbar shortcut tied to Nightdesk, rather than Electron's
// runtime identity. This must happen before any windows are created.
const APP_ID = 'com.nightdesk.app';
app.setAppUserModelId(APP_ID);

// Dev-only: NIGHTDESK_SHOTS=<dir> captures each view to PNG and exits, using a throwaway profile.
const SHOTS = process.env.NIGHTDESK_SHOTS;
if (SHOTS) app.setPath('userData', path.join(SHOTS, 'profile'));
const ICON = path.join(__dirname, 'build', 'icon.png');

let win = null;
let tray = null;
let quitting = false;
let awakeId = null;
let prefs = {};

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
function loadPrefs() { try { prefs = JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); } catch { prefs = {}; } }
function savePrefs() { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch {} }

const closeToTray = () => prefs.closeToTray !== false; // on unless switched off in Settings

// The lamp keeps the display awake, but only while the window is actually on screen.
let wantAwake = false;
function applyAwake() {
  const on = wantAwake && !!win && !win.isDestroyed() && win.isVisible();
  if (on && awakeId === null) awakeId = powerSaveBlocker.start('prevent-display-sleep');
  if (!on && awakeId !== null) { powerSaveBlocker.stop(awakeId); awakeId = null; }
}

// Start with Windows. Re-registered on every launch so the entry always points at the exe that
// is actually installed, even after the app is moved or rebuilt.
function syncLoginItem() {
  if (!app.isPackaged || SHOTS) return;
  try { app.setLoginItemSettings({ openAtLogin: prefs.startAtLogin !== false }); } catch (err) { console.error(err); }
}

function savedBounds() {
  const b = prefs.bounds;
  if (!b || SHOTS) return {};
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y < a.y + a.height - 80 && b.y + b.height > a.y;
  });
  return onScreen ? b : {};
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, ...savedBounds(),
    minWidth: 900, minHeight: 620,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    title: 'Nightdesk',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (!app.isPackaged) {
    win.webContents.on('console-message', (e) => console.log('[renderer]', e.message));
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });
  }

  win.on('close', (e) => {
    if (!win.isFullScreen() && !win.isMaximized() && !win.isMinimized()) { prefs.bounds = win.getBounds(); savePrefs(); }
    // Closing the window keeps the app alive in the tray so timers, alarms and sounds carry on.
    if (closeToTray() && !quitting && !SHOTS) {
      e.preventDefault();
      if (win.isFullScreen()) win.setFullScreen(false);
      win.hide();
      if (!prefs.trayNoticeShown && tray) {
        prefs.trayNoticeShown = true; savePrefs();
        try { tray.displayBalloon({ title: 'Nightdesk is still running', content: 'Timers, alarms and sounds carry on. Click the tray icon to open it, right-click to quit.', iconType: 'info' }); } catch {}
      }
    }
  });
  win.on('closed', () => { win = null; });
  win.on('session-end', () => { quitting = true; });
  win.on('show', applyAwake);
  win.on('hide', applyAwake);
  // If the page ever crashes or hangs, bring it back instead of leaving a dead window.
  win.webContents.on('render-process-gone', () => { if (win && !win.isDestroyed()) win.reload(); });

  if (SHOTS) win.webContents.once('did-finish-load', () => shoot().catch((err) => { console.error(err); app.exit(1); }));
}

async function shoot() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const steps = (process.env.NIGHTDESK_STEPS || 'clock,focus,timer,stopwatch,calendar,contests,lamp').split(',');
  await wait(2500);
  if (process.env.NIGHTDESK_EVAL) {
    console.log('EVAL', await win.webContents.executeJavaScript(fs.readFileSync(process.env.NIGHTDESK_EVAL, 'utf8')));
    // Tests only: die instantly, like ending the task in Task Manager, without any clean shutdown.
    if (process.env.NIGHTDESK_HARDKILL) process.kill(process.pid, 'SIGKILL');
    return app.exit(0);
  }
  for (const step of steps) {
    await win.webContents.executeJavaScript(`window.__shot(${JSON.stringify(step)})`);
    const dm = /(?:^|:)d(\d+)(?::|$)/.exec(step);
    await wait(dm ? +dm[1] : step.includes('ring') ? 3000 : 1000);
    const target = step.includes('ring') && overlays[0] ? overlays[0] : step.includes('deskpet') && petWin ? petWin : win;
    let img = await target.webContents.capturePage();
    if (step.includes('real')) { // the real on-screen pixels, including compositor glitches capturePage cannot see
      const cb = win.getContentBounds(), d = screen.getDisplayMatching(cb), sf = d.scaleFactor;
      const src = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * sf), height: Math.round(d.size.height * sf) } }))
        .find((s) => s.display_id === String(d.id));
      if (src) img = src.thumbnail.crop({ x: Math.round((cb.x - d.bounds.x) * sf), y: Math.round((cb.y - d.bounds.y) * sf), width: Math.round(cb.width * sf), height: Math.round(cb.height * sf) });
    }
    fs.writeFileSync(path.join(SHOTS, step.replace(/\W+/g, '_') + '.png'), img.toPNG());
    if (step.includes('ring')) { console.log('overlays open:', overlays.length); closeAlarm('stop'); await wait(300); }
  }
  app.exit(0);
}

// ---------- alarm overlay: a frozen, blurred copy of every screen with Snooze / Stop on top
let overlays = [];
let alarmData = {};

function closeAlarm(result) {
  const open = overlays;
  overlays = [];
  for (const w of open) { if (!w.isDestroyed()) w.destroy(); }
  if (result && win && !win.isDestroyed()) win.webContents.send('alarm:result', result);
}

async function showAlarm(data) {
  closeAlarm();
  alarmData = data || {};
  const shots = {};
  let first = '';
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 800 } });
    for (const s of sources) {
      const jpg = s.thumbnail.isEmpty() ? '' : s.thumbnail.toJPEG(70).toString('base64');
      shots[s.display_id] = jpg;
      first = first || jpg;
    }
  } catch (err) { console.error('screen capture failed', err); }

  for (const d of screen.getAllDisplays()) {
    const w = new BrowserWindow({
      ...d.bounds, frame: false, resizable: false, movable: false, minimizable: false, skipTaskbar: true,
      show: false, backgroundColor: '#000000', title: 'Alarm',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    w.alarmImg = shots[String(d.id)] || first;
    w.setAlwaysOnTop(true, 'screen-saver');
    w.loadFile(path.join(__dirname, 'src', 'alarm.html'));
    w.once('ready-to-show', () => { w.show(); w.setBounds(d.bounds); w.focus(); });
    // Closing one overlay by hand (Alt+F4) counts as Stop.
    w.on('closed', () => { if (overlays.includes(w)) closeAlarm('stop'); });
    overlays.push(w);
  }
}

// ---------- desktop pet: a small transparent always-on-top window that mirrors the in-app pet
let petWin = null;
let lastPetState = null;
const PET_SIZE = { width: 260, height: 260 };

function petStartPosition() {
  const p = prefs.petPos;
  const fits = p && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return p.x > a.x - 200 && p.x < a.x + a.width - 40 && p.y > a.y - 200 && p.y < a.y + a.height - 40;
  });
  if (fits) return p;
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - PET_SIZE.width - 20, y: a.y + a.height - PET_SIZE.height };
}

function setDesktopPet(on) {
  if (!on) { stopPetWalk(); stopPetDrag(); if (petWin && !petWin.isDestroyed()) petWin.destroy(); petWin = null; return false; }
  if (petWin && !petWin.isDestroyed()) return true;
  petWin = new BrowserWindow({
    ...PET_SIZE, ...petStartPosition(),
    transparent: true, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, focusable: false, show: false, title: 'Nightdesk pet',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  petWin.setAlwaysOnTop(true, 'floating');
  petWin.loadFile(path.join(__dirname, 'src', 'pet-desktop.html'));
  petWin.webContents.once('did-finish-load', () => {
    if (!petWin || petWin.isDestroyed()) return;
    if (lastPetState) petWin.webContents.send('pet:state', lastPetState);
    petWin.showInactive();
  });
  petWin.on('closed', () => { petWin = null; });
  petWin.once('show', () => movePet(...petWin.getPosition()));
  // Catch any rescale Windows applies on its own (for example after a display change).
  petWin.on('resize', () => {
    const g = petWin.getBounds();
    if (g.width !== PET_SIZE.width || g.height !== PET_SIZE.height) setImmediate(() => movePet(g.x, g.y));
  });
  return true;
}

// Dragging follows the real cursor position, read here in the main process. That keeps it working
// across monitors with different scaling, where positions reported by the page are unreliable.
let petDragTimer = null;
let petWalkTimer = null;
let petWalks = 0; // walk requests, for tests
const petAlive = () => petWin && !petWin.isDestroyed();

// Monitors with different scaling make Windows resize the window as it crosses between them,
// so every move sets the full bounds and snaps the size back if it was changed.
function movePet(x, y) {
  if (!petAlive()) return;
  const want = { x: Math.round(x), y: Math.round(y), ...PET_SIZE };
  petWin.setBounds(want);
  const got = petWin.getBounds();
  if (got.width !== PET_SIZE.width || got.height !== PET_SIZE.height) petWin.setBounds(want);
}
function savePetPos() {
  if (!petAlive()) return;
  const [x, y] = petWin.getPosition();
  prefs.petPos = { x, y }; savePrefs();
}
function stopPetWalk() {
  if (!petWalkTimer) return;
  clearInterval(petWalkTimer); petWalkTimer = null;
  if (petAlive()) petWin.webContents.send('pet:walk', { on: false });
  savePetPos();
}
function stopPetDrag() {
  if (!petDragTimer) return;
  clearInterval(petDragTimer); petDragTimer = null;
  savePetPos();
}
function startPetDrag() {
  stopPetWalk(); stopPetDrag();
  const cursor = screen.getCursorScreenPoint(), [x, y] = petWin.getPosition();
  const off = { x: cursor.x - x, y: cursor.y - y }, started = Date.now();
  petDragTimer = setInterval(() => {
    if (!petAlive() || Date.now() - started > 120000) return stopPetDrag();
    const p = screen.getCursorScreenPoint();
    movePet(p.x - off.x, p.y - off.y);
  }, 16);
}
// Walk along whichever monitor the pet is on. `fraction` is how far across that monitor to go.
function startPetWalk(fraction) {
  if (!petAlive() || petDragTimer) return;
  stopPetWalk();
  const area = screen.getDisplayMatching(petWin.getBounds()).workArea;
  const target = Math.round(area.x + Math.max(0, Math.min(1, fraction)) * Math.max(0, area.width - 150));
  const dir = target > petWin.getBounds().x ? 1 : -1;
  petWin.webContents.send('pet:walk', { on: true, flip: dir < 0 });
  petWalkTimer = setInterval(() => {
    if (!petAlive()) { clearInterval(petWalkTimer); petWalkTimer = null; return; }
    const [cx, cy] = petWin.getPosition(), nx = cx + dir * 3;
    if ((dir > 0 && nx >= target) || (dir < 0 && nx <= target)) return stopPetWalk();
    movePet(nx, cy);
  }, 33);
}

function registerPetIpc() {
  const fromPet = (e) => petAlive() && (e.sender === petWin.webContents || !!SHOTS);
  const fromApp = (e) => win && e.sender === win.webContents;
  ipcMain.on('pet:state', (e, s) => {
    if (!fromApp(e)) return;
    lastPetState = s;
    if (petAlive()) petWin.webContents.send('pet:state', s);
  });
  ipcMain.on('pet:walk', (e, fraction) => { if (fromApp(e) && Number.isFinite(fraction)) { petWalks++; startPetWalk(fraction); } });
  ipcMain.on('pet:dragStart', (e) => { if (fromPet(e)) startPetDrag(); });
  ipcMain.on('pet:dragEnd', (e) => { if (fromPet(e)) stopPetDrag(); });
  ipcMain.on('pet:click', (e) => {
    if (!fromPet(e)) return;
    showWindow();
    if (win) win.webContents.send('pet:open');
  });
  // Dev only (screenshot / test mode): read and place the pet window.
  if (SHOTS) {
    handle('pet:test', (cmd, arg) => {
      if (!petAlive()) return null;
      const displays = screen.getAllDisplays();
      if (cmd === 'place') { const a = displays[Math.min(arg, displays.length - 1)].workArea; movePet(a.x + 40, a.y + a.height - PET_SIZE.height); }
      if (cmd === 'dragStart') startPetDrag();
      if (cmd === 'dragEnd') stopPetDrag();
      const b = petWin.getBounds(), d = screen.getDisplayMatching(b);
      return { bounds: b, display: displays.findIndex((x) => x.id === d.id), displays: displays.length, area: d.workArea, dragging: !!petDragTimer, walking: !!petWalkTimer, walks: petWalks, saved: prefs.petPos || null, cursor: screen.getCursorScreenPoint() };
    });
  }
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.setToolTip('Nightdesk');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Nightdesk', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
  } catch (err) {
    console.error('tray unavailable', err);
  }
}

const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

async function cfApi(method, query) {
  const res = await net.fetch(`https://codeforces.com/api/${method}?${new URLSearchParams(query)}`);
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`Codeforces is not responding (${res.status}).`);
  if (json.status !== 'OK') throw new Error(json.comment || 'Codeforces returned an error.');
  return json.result;
}

function registerDbIpc() {
  // Loaded once, synchronously, when the page starts; every later change is written straight away.
  ipcMain.on('db:load', (e) => {
    try { e.returnValue = { ok: true, data: db.loadAll() }; }
    catch (err) { console.error(err); e.returnValue = { ok: false, error: String(err.message || err) }; }
  });
  ipcMain.on('db:set', (e, key, value) => {
    if (!win || e.sender !== win.webContents) return;
    try { db.set(key, value); } catch (err) { console.error('db write failed', err); }
  });
  handle('db:backup', () => db.backupNow());
  handle('db:folder', () => shell.openPath(db.folder()));
}

function registerIpc() {
  registerDbIpc();
  handle('app:info', () => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
    openAtLogin: app.isPackaged ? prefs.startAtLogin !== false : false,
    closeToTray: closeToTray(),
  }));
  handle('app:setLogin', (on) => {
    if (!app.isPackaged) throw new Error('Startup launch only works in the built app.');
    prefs.startAtLogin = !!on; savePrefs();
    syncLoginItem();
    return prefs.startAtLogin;
  });
  handle('app:setCloseToTray', (on) => { prefs.closeToTray = !!on; savePrefs(); return prefs.closeToTray; });
  handle('app:fullscreen', (on) => {
    if (!win) return false;
    win.setFullScreen(typeof on === 'boolean' ? on : !win.isFullScreen());
    return win.isFullScreen();
  });
  handle('app:theme', (theme) => { nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark'; });
  handle('app:keepAwake', (on) => { wantAwake = !!on; applyAwake(); });
  handle('app:open', (url) => {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') throw new Error('Only https links can be opened.');
    return shell.openExternal(u.toString());
  });

  handle('cf:contests', async () => (await cfApi('contest.list', { gym: 'false' }))
    .filter((c) => c.phase === 'BEFORE' && c.startTimeSeconds)
    .map((c) => ({ id: c.id, name: c.name, start: c.startTimeSeconds * 1000, duration: c.durationSeconds * 1000 }))
    .sort((a, b) => a.start - b.start));
  handle('cf:user', async (handleName) => {
    if (!/^[\w.-]{1,40}$/.test(String(handleName))) throw new Error('That does not look like a Codeforces handle.');
    const [u] = await cfApi('user.info', { handles: handleName });
    return { handle: u.handle, rating: u.rating || 0, maxRating: u.maxRating || 0, rank: u.rank || 'unrated' };
  });

  // Public activity calendars for the Study tab. No keys; only the username/handle is sent.
  handle('gh:contrib', async (user) => {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(String(user))) throw new Error('That does not look like a GitHub username.');
    const res = await net.fetch(`https://github.com/users/${encodeURIComponent(user)}/contributions`, { headers: { 'User-Agent': 'Mozilla/5.0 Nightdesk' } });
    if (res.status === 404) throw new Error(`GitHub user "${user}" not found.`);
    if (!res.ok) throw new Error(`GitHub is not responding (${res.status}).`);
    const html = await res.text();
    const counts = {};
    for (const m of html.matchAll(/<tool-tip[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
      const n = /^(\d+) contribution/.exec(m[2].trim());
      counts[m[1]] = n ? +n[1] : 0;
    }
    const days = {};
    for (const m of html.matchAll(/<td\b[^>]*>/g)) {
      const date = /data-date="(\d{4}-\d{2}-\d{2})"/.exec(m[0]), id = /\bid="([^"]+)"/.exec(m[0]), lvl = /data-level="(\d)"/.exec(m[0]);
      if (!date) continue;
      const c = id && counts[id[1]] != null ? counts[id[1]] : lvl ? +lvl[1] : 0;
      if (c) days[date[1]] = c;
    }
    if (!html.includes('data-date=')) throw new Error('Could not read the GitHub calendar.');
    return days;
  });
  handle('cf:activity', async (handleName) => {
    if (!/^[\w.-]{1,40}$/.test(String(handleName))) throw new Error('That does not look like a Codeforces handle.');
    const subs = await cfApi('user.status', { handle: handleName, from: 1, count: 10000 });
    return subs.map((s) => [s.creationTimeSeconds, s.verdict === 'OK' ? 1 : 0]);
  });

  // Fresh quotes from free public sources (no key, nothing about the user is sent).
  handle('quotes:fetch', async () => {
    const clean = (list) => list
      .map(([q, a]) => [String(q || '').trim(), String(a || '').trim()])
      .filter(([q, a]) => q.length > 10 && q.length <= 180 && a && a !== 'zenquotes.io');
    try {
      const res = await net.fetch('https://zenquotes.io/api/quotes');
      const out = clean((await res.json()).map((x) => [x.q, x.a]));
      if (out.length) return out;
    } catch {}
    const res = await net.fetch('https://dummyjson.com/quotes/random/10');
    return clean((await res.json()).map((x) => [x.quote, x.author]));
  });

  handle('pet:desktop', (on) => setDesktopPet(!!on));
  registerPetIpc();

  handle('alarm:show', (data) => showAlarm(data));
  handle('alarm:hide', () => closeAlarm());
  handle('alarm:action', (action) => closeAlarm(action === 'snooze' ? 'snooze' : 'stop'));
  ipcMain.handle('alarm:data', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    return { ok: true, data: { ...alarmData, img: (w && w.alarmImg) || '' } };
  });

  handle('spotify:status', () => spotify.status());
  handle('spotify:connect', (clientId) => spotify.connect(clientId));
  handle('spotify:disconnect', () => spotify.disconnect());
  handle('spotify:now', () => spotify.now());
  handle('spotify:control', (action) => spotify.control(action));

  handle('gcal:status', () => gcal.status());
  handle('gcal:connect', (creds) => gcal.connect(creds));
  handle('gcal:disconnect', () => gcal.disconnect());
  handle('gcal:list', (from, to) => gcal.list(from, to));
  handle('gcal:create', (ev) => gcal.create(ev));
  handle('gcal:update', (calendarId, id, ev) => gcal.update(calendarId, id, ev));
  handle('gcal:remove', (calendarId, id) => gcal.remove(calendarId, id));
}

if (process.argv.includes('--quit')) {
  app.quit(); // asked to close a running copy; if this is the only one there is nothing to do
} else if (!SHOTS && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--quit')) { quitting = true; app.quit(); return; }
    showWindow();
  });
  app.on('will-quit', () => db.close());
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(() => {
    loadPrefs();
    syncLoginItem();
    registerIpc();
    createWindow();
    if (!SHOTS) createTray();
  });
}

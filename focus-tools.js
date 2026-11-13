'use strict';
// Main-process side of three focus tools:
//  - the mini floating timer (a small always-on-top window)
//  - global hotkeys that work from any app
//  - the distraction guard's window watcher (which app is in front, only while focusing)
const { BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const MINI = { width: 260, height: 76 };
const HOTKEYS = { 'CommandOrControl+Alt+F': 'toggle', 'CommandOrControl+Alt+M': 'mini', 'CommandOrControl+Alt+N': 'open' };

// Prints "<process>|<window title>" for the window in front, once a second, only when it changes.
const WATCH = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
$last = ''
while ($true) {
  $h = [Fg]::GetForegroundWindow(); $sb = New-Object System.Text.StringBuilder 512
  [void][Fg]::GetWindowText($h, $sb, 512); $p = 0; [void][Fg]::GetWindowThreadProcessId($h, [ref]$p)
  $name = (Get-Process -Id $p).ProcessName
  $line = "$name|$($sb.ToString())"
  if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }
  Start-Sleep -Milliseconds 1000
}`;

module.exports = function focusTools({ app, getWin, prefs, savePrefs, handle, logError, SHOTS, showWindow, preload, srcDir }) {
  // ---------- mini timer
  let mini = null;
  let lastState = null;
  const alive = () => !!(mini && !mini.isDestroyed());

  function miniStart() {
    const p = prefs.miniPos;
    const fits = p && screen.getAllDisplays().some((d) => { const a = d.workArea; return p.x >= a.x - 20 && p.y >= a.y - 20 && p.x + MINI.width <= a.x + a.width + 20 && p.y + MINI.height <= a.y + a.height + 20; });
    if (fits) return p;
    const a = screen.getPrimaryDisplay().workArea;
    return { x: a.x + a.width - MINI.width - 24, y: a.y + a.height - MINI.height - 24 };
  }

  function setMini(on) {
    if (!on) {
      if (alive()) mini.destroy();
      mini = null;
      if (!SHOTS) { prefs.miniOn = false; savePrefs(); }
      return false;
    }
    if (alive()) return true;
    mini = new BrowserWindow({
      ...MINI, ...miniStart(), frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Nightdesk timer', backgroundColor: '#00000000', transparent: true, hasShadow: false,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    mini.setAlwaysOnTop(true, 'floating');
    mini.loadFile(path.join(srcDir, 'mini.html'));
    mini.webContents.once('did-finish-load', () => {
      if (!alive()) return;
      if (lastState) mini.webContents.send('mini:state', lastState);
      if (!SHOTS) mini.showInactive();
    });
    mini.on('moved', () => { if (alive() && !SHOTS) { const [x, y] = mini.getPosition(); prefs.miniPos = { x, y }; savePrefs(); } });
    mini.on('closed', () => { mini = null; });
    if (!SHOTS) { prefs.miniOn = true; savePrefs(); }
    return true;
  }

  ipcMain.on('mini:state', (e, s) => {
    const w = getWin();
    if (!w || e.sender !== w.webContents) return;
    lastState = s;
    if (alive()) mini.webContents.send('mini:state', s);
  });
  ipcMain.on('mini:cmd', (e, cmd) => {
    if (!alive() || e.sender !== mini.webContents) return;
    if (cmd === 'open') { showWindow(); return; }
    if (cmd === 'close') { setMini(false); notifyMini(); return; }
    if (['toggle', 'skip', 'reset'].includes(cmd)) { const w = getWin(); if (w) w.webContents.send('focus:cmd', cmd); }
  });
  const notifyMini = () => { const w = getWin(); if (w) w.webContents.send('focus:cmd', alive() ? 'mini-on' : 'mini-off'); };
  handle('mini:toggle', (on) => { const r = setMini(typeof on === 'boolean' ? on : !alive()); notifyMini(); return r; });

  // ---------- global hotkeys (not in test runs, so they never take keys from the real app)
  function fire(cmd) {
    if (cmd === 'open') return showWindow();
    if (cmd === 'mini') { setMini(!alive()); return notifyMini(); }
    const w = getWin();
    if (w) w.webContents.send('focus:cmd', cmd);
  }
  const hotkeys = {};
  function registerHotkeys() {
    if (SHOTS) return;
    for (const [acc, cmd] of Object.entries(HOTKEYS)) {
      try { hotkeys[acc] = globalShortcut.register(acc, () => fire(cmd)); } catch { hotkeys[acc] = false; }
      if (!hotkeys[acc]) logError('hotkey', `${acc} is already used by another app`);
    }
  }
  handle('hotkeys:status', () => hotkeys);

  // ---------- distraction guard: which window is in front (runs only during a focus block)
  let watcher = null;
  function guard(on) {
    if (on && !watcher) {
      try {
        watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WATCH], { windowsHide: true });
        readline.createInterface({ input: watcher.stdout }).on('line', (line) => {
          const i = line.indexOf('|');
          const w = getWin();
          if (i > 0 && w) w.webContents.send('guard:window', { proc: line.slice(0, i), title: line.slice(i + 1) });
        });
        watcher.on('exit', () => { watcher = null; });
        watcher.on('error', (err) => { logError('distraction guard', err); watcher = null; });
      } catch (err) { logError('distraction guard', err); watcher = null; }
    } else if (!on && watcher) {
      try { watcher.kill(); } catch {}
      watcher = null;
    }
    return !!watcher;
  }
  handle('guard:watch', (on) => guard(!!on));

  // ---------- tests only
  if (SHOTS) {
    handle('focus:test', async (cmd, arg) => {
      if (cmd === 'fakeWindow') { const w = getWin(); if (w) w.webContents.send('guard:window', arg); return true; }
      if (cmd === 'miniClick' && alive()) return mini.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(arg)}).click(); true`);
      if (cmd === 'miniText' && alive()) return mini.webContents.executeJavaScript('document.body.innerText');
      if (cmd === 'hotkey') { fire(arg); return true; }
      return { mini: alive(), bounds: alive() ? mini.getBounds() : null, watching: !!watcher };
    });
  }

  app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} guard(false); });
  return { start() { registerHotkeys(); if (prefs.miniOn && !SHOTS) setMini(true); } };
};

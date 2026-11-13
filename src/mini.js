'use strict';
// The mini floating timer: shows what the main window sends, sends button presses back.
// Click anywhere on it to open Nightdesk; press and drag to move it.
const ACCENTS = { rose: '#d98a7c', blue: '#5b9dff', sage: '#7fae8b', amber: '#e0a040', violet: '#9b87f5' };
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 5.5l10 6.5-10 6.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg>';
const RING = 194.8;
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`; };
const dur = (min) => (min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`);
const clock = (t) => new Date(t).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
let st = null;

function paint() {
  if (!st) return;
  const left = st.running ? st.endAt - Date.now() : st.left;
  document.body.className = st.theme === 'light' ? 'light' : '';
  document.documentElement.style.setProperty('--accent', ACCENTS[st.palette] || ACCENTS.rose);
  const box = $('box');
  box.classList.toggle('paused', !st.running);
  box.classList.toggle('distracted', !!st.distracted);
  const fresh = !st.running && left >= st.dur;
  $('mode').textContent = st.mode === 'focus' ? (st.running ? 'FOCUS' : fresh ? 'READY' : 'PAUSED') : st.longBreak ? 'LONG BREAK' : 'BREAK';
  $('label').textContent = st.label ? `· ${st.label}` : '';
  $('time').textContent = fmt(left);
  $('prog').style.strokeDashoffset = RING * (1 - Math.min(1, Math.max(0, 1 - left / st.dur)));
  // Swap the icon only when it changes: replacing it mid-press would swallow the click.
  const icon = st.running ? 'pause' : 'play';
  if ($('toggle').dataset.icon !== icon) { $('toggle').dataset.icon = icon; $('toggle').innerHTML = st.running ? PAUSE : PLAY; }
  let status;
  if (st.distracted) status = `${st.distracted} · not counted`;
  else if (st.mode === 'break') status = st.running ? `Back to focus at ${clock(st.endAt)}` : 'Break paused';
  else if (st.running) status = `Today ${dur(st.todayMin)} · ends ${clock(st.endAt)}`;
  else status = `Today ${dur(st.todayMin)} · round ${st.round}`;
  $('status').textContent = status;
}
window.api.mini.onState((s) => { st = s; paint(); });
setInterval(paint, 250);

// Buttons do their job and never count as "open the app".
// They act on release over the same button (a real click), and keyboard clicks still work.
for (const id of ['toggle', 'skip', 'close']) {
  const b = $(id);
  let down = false;
  b.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.button === 0) { down = true; try { b.setPointerCapture(e.pointerId); } catch {} } });
  b.addEventListener('pointerup', (e) => {
    e.stopPropagation();
    if (!down) return; down = false;
    const r = b.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) window.api.mini.cmd(id);
  });
  b.addEventListener('pointercancel', () => { down = false; });
  b.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail === 0) window.api.mini.cmd(id); });
}

// Press and move = drag (the main process follows the cursor); a plain click opens Nightdesk.
let press = null;
let lastOpen = 0;
const box = $('box');
// Opens on release (not on the browser's later "click"), so even the very first click on a
// timer that has just appeared works. Releasing after a drag never opens.
const open = () => { if (Date.now() - lastOpen > 600) { lastOpen = Date.now(); window.api.mini.cmd('open'); } };
box.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  press = { x: e.screenX, y: e.screenY, t: e.timeStamp, dragging: false };
  try { box.setPointerCapture(e.pointerId); } catch {}
});
box.addEventListener('pointermove', (e) => {
  if (!press || press.dragging || !(e.buttons & 1)) return;
  // A move event left over from the pointer arriving (within 60 ms of the press) is not a drag.
  if (e.timeStamp - press.t < 60) { press.x = e.screenX; press.y = e.screenY; return; }
  if (Math.abs(e.screenX - press.x) + Math.abs(e.screenY - press.y) > 6) { press.dragging = true; window.api.mini.cmd('dragStart'); }
});
box.addEventListener('pointerup', (e) => {
  const p0 = press; press = null;
  if (!p0) return;
  if (p0.dragging) window.api.mini.cmd('dragEnd'); else if (e.button === 0) open();
});
box.addEventListener('pointercancel', () => { if (press && press.dragging) window.api.mini.cmd('dragEnd'); press = null; });
// Keyboard and programmatic clicks (no pointer press before them) also open.
box.addEventListener('click', (e) => { if (e.detail === 0 || !e.isTrusted) open(); });

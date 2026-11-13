'use strict';
// The mini floating timer: shows what the main window sends, and sends button presses back.
const ACCENTS = { rose: '#d98a7c', blue: '#5b9dff', sage: '#7fae8b', amber: '#e0a040', violet: '#9b87f5' };
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5l11 7-11 7z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
const $ = (id) => document.getElementById(id);
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), p = (n) => String(n).padStart(2, '0'); return h ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`; };
let st = null;

function paint() {
  if (!st) return;
  const left = st.running ? st.endAt - Date.now() : st.left;
  document.body.className = st.theme === 'light' ? 'light' : '';
  document.documentElement.style.setProperty('--accent', ACCENTS[st.palette] || ACCENTS.rose);
  $('box').classList.toggle('paused', !st.running);
  $('mode').textContent = st.mode === 'focus' ? (st.running ? 'FOCUS' : 'FOCUS · PAUSED') : st.longBreak ? 'LONG BREAK' : 'BREAK';
  $('time').textContent = fmt(left);
  $('label').textContent = st.label || '';
  $('bar').style.width = Math.min(100, Math.max(0, (1 - left / st.dur) * 100)) + '%';
  $('toggle').innerHTML = st.running ? PAUSE : PLAY;
}
window.api.mini.onState((s) => { st = s; paint(); });
setInterval(paint, 250);
for (const id of ['toggle', 'skip', 'open', 'close']) $(id).addEventListener('click', () => window.api.mini.cmd(id));

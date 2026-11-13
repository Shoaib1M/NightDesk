'use strict';
// Focus tools on the page side: feeds the mini floating timer, takes commands from it and from the
// global hotkeys, and runs the distraction guard during focus blocks.

// ---------- mini timer + hotkeys
let miniSent = '';
function sendMiniState() {
  if (!api) return;
  const subj = study.subjects.find((s) => s.id === $('#p-subj').value);
  const s = {
    mode: pomo.mode, running: pomo.running, endAt: pomo.endAt, left: pomo.left, dur: pomo.dur,
    longBreak: pomo.mode === 'break' && pomo.dur === settings.longMin * 60000 && settings.longMin !== settings.breakMin,
    label: $('#p-task').value.trim() || (subj ? subj.name : ''), theme: settings.theme, palette: settings.palette,
  };
  const j = JSON.stringify(s);
  if (j !== miniSent) { miniSent = j; api.focus.miniState(s); }
}

if (api) {
  api.focus.onCmd((cmd) => {
    if (cmd === 'toggle') { pomoToggle(); toast(pomo.running ? `Focus started · ${fmtMs(pomo.left)} left` : 'Focus paused'); }
    else if (cmd === 'skip') pomoAdvance(false);
    else if (cmd === 'reset') pomoReset();
    else if (cmd === 'mini-on' || cmd === 'mini-off') $('#b-mini') && $('#b-mini').classList.toggle('on', cmd === 'mini-on');
    sendMiniState();
  });
}

// ---------- distraction guard
const DEFAULT_GUARD = 'YouTube, Instagram, Netflix, Prime Video, Hotstar, Reddit, Twitter, Facebook, TikTok, Twitch, Snapchat, Steam, Epic Games, Valorant, Minecraft, Roblox, Genshin';
const guard = { watching: false, since: 0, app: '', blockMs: 0 };
const guardWords = () => (settings.guardList || DEFAULT_GUARD).split(',').map((w) => w.trim()).filter(Boolean);

function matchDistraction(proc, title) {
  if (/^(nightdesk|electron)$/i.test(proc)) return '';
  const hay = `${proc} ${title}`.toLowerCase();
  return guardWords().find((w) => hay.includes(w.toLowerCase())) || '';
}

// Distracted time today, per app: { 'YYYY-MM-DD': { YouTube: ms } } (kept forever).
function addDistraction(app, ms) {
  if (!(ms > 0)) return;
  const all = store.get('distractions', {}), day = ymd(new Date());
  all[day] = all[day] || {};
  all[day][app] = (all[day][app] || 0) + ms;
  store.set('distractions', all);
}
function distractedToday() {
  const d = store.get('distractions', {})[ymd(new Date())] || {};
  return Object.entries(d).sort((a, b) => b[1] - a[1]);
}

// Ends a distraction episode (when you come back, or when the block ends/pauses).
function guardFlush(now = Date.now()) {
  if (!guard.since) return;
  const ms = now - guard.since;
  guard.blockMs += ms;
  addDistraction(guard.app, ms);
  guard.since = 0;
  return ms;
}

function onForegroundWindow({ proc, title }) {
  if (!(pomo.running && pomo.mode === 'focus' && settings.guard !== false)) return;
  const hit = matchDistraction(proc, title);
  if (hit && !guard.since) {
    guard.since = Date.now(); guard.app = hit;
    buddySay(`${hit} during focus? This time won't count. Back to it!`, 10000);
    notify(`${hit} is open during focus`, 'This time is not counted as study. Close it to keep your block clean.');
  } else if (!hit && guard.since) {
    const ms = guardFlush();
    buddySay(`Welcome back. ${fmtDur(Math.max(1, Math.round(ms / 60000)))} on ${guard.app} wasn't counted.`, 6000);
  }
}

// Watch the front window only while a focus block is running.
function guardSync() {
  const want = !!api && settings.guard !== false && pomo.running && pomo.mode === 'focus';
  if (!want && guard.since) guardFlush();
  if (want !== guard.watching) { guard.watching = want; api && api.focus.guard(want); }
}

if (api) api.focus.onWindow(onForegroundWindow);
on('pomo', (ev) => { if (ev === 'start') guard.blockMs = 0; });

setInterval(() => { sendMiniState(); guardSync(); }, 500);

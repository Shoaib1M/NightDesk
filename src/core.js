'use strict';
// Shared helpers, settings, navigation chrome and the Settings sheet.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // static markup only (icons)
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

// `api` is the global exposed by preload.js (window.api).
async function call(promise) {
  const r = await promise;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

// All saved data lives in a local SQLite database (db.js in the main process). The whole table is
// read once at start-up; every change is written to disk immediately. Browser storage is only used
// if the database is unavailable, and anything still in it from older versions is moved across once.
const store = (() => {
  let cache = {}, persistent = false;
  try {
    const r = window.api && api.db.load();
    if (r && r.ok) { cache = r.data; persistent = true; }
  } catch {}
  if (persistent && !cache.__migrated) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k.startsWith('nd.') || cache[k.slice(3)] != null) continue;
        cache[k.slice(3)] = localStorage.getItem(k);
        api.db.set(k.slice(3), cache[k.slice(3)]);
      }
    } catch {}
    cache.__migrated = '1';
    api.db.set('__migrated', '1');
  }
  const raw = (key) => (persistent ? cache[key] : (() => { try { return localStorage.getItem('nd.' + key); } catch { return null; } })());
  return {
    persistent,
    get(key, fallback) {
      try {
        const v = raw(key);
        if (v == null) return fallback;
        const parsed = JSON.parse(v);
        // Damaged or unexpected saved data must never break start-up: fall back instead.
        if (parsed == null || Array.isArray(parsed) !== Array.isArray(fallback) || (fallback != null && typeof parsed !== typeof fallback)) return fallback;
        return parsed;
      } catch { return fallback; }
    },
    set(key, value) {
      const s = JSON.stringify(value);
      if (s === undefined) return;
      if (persistent) {
        if (cache[key] === s) return;
        cache[key] = s;
        api.db.set(key, s);
      } else { try { localStorage.setItem('nd.' + key, s); } catch {} }
    },
    // Tests only: put a raw (possibly damaged) string in place of a saved value.
    _putRaw(key, s) { if (persistent) cache[key] = s; else localStorage.setItem('nd.' + key, s); },
  };
})();

const settings = Object.assign({
  theme: 'dark', palette: 'rose', h24: false, seconds: true, flipSound: false, buddy: true, quotes: false, quoteMin: 2, quotesOnline: true,
  focusMin: 50, breakMin: 10, longMin: 20, longEvery: 4, autoStart: true,
  cfHandle: '', ghUser: '', cfRemind: true, cfInCalendar: true, snoozeMin: 9, view: 'clock',
}, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);

const bus = new EventTarget();
const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));
const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function fmtMs(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hrs = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return hrs ? `${hrs}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
function fmtTime(d) {
  if (settings.h24) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
}
function fmtRel(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `in ${m} min`;
  if (m < 1440) return `in ${Math.floor(m / 60)}h ${m % 60}m`;
  return `in ${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}
function fmtDur(min) {
  min = Math.round(min);
  if (min < 60) return `${min}m`;
  return min % 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min / 60}h`;
}

let _ac = null;
function audio() {
  if (!_ac) _ac = new AudioContext();
  if (_ac.state === 'suspended') _ac.resume();
  return _ac;
}
function beep(freq, at, len = 0.7, vol = 0.22, type = 'sine') {
  const ac = audio();
  const t = ac.currentTime + at;
  const osc = ac.createOscillator(), g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  osc.connect(g).connect(ac.destination);
  osc.start(t); osc.stop(t + len + 0.05);
}
function chime() { [660, 880, 990].forEach((f, i) => beep(f, 0.05 + i * 0.28)); }
function notify(title, body) {
  try { new Notification(title, { body, silent: true }); } catch {}
}

let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, 5000);
}

// ---------- icons
const ICON = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  focus: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4M9.5 3h5"/>',
  stopwatch: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5l3-3M9.5 3h5M18.5 6.5L20 5"/>',
  alarm: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4M4 5l2-2M20 5l-2-2"/>',
  study: '<path d="M4 20V11M9.5 20V5M15 20v-7M20.5 20V8"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  contests: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
  lamp: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  pet: '<circle cx="12" cy="15.5" r="3.5"/><circle cx="5.5" cy="10.5" r="1.8"/><circle cx="9.5" cy="6" r="1.8"/><circle cx="14.5" cy="6" r="1.8"/><circle cx="18.5" cy="10.5" r="1.8"/>',
  sound: '<path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4"/>',
  buddy: '<path d="M5 4l3 4h8l3-4v9a7 7 0 0 1-14 0zM9.5 12v1M14.5 12v1M11 16h2"/>',
  quote: '<path d="M10 7H6a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3c0 2-1 3.5-3 4M19 7h-4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3c0 2-1 3.5-3 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
  next: '<path d="M6 5l9 7-9 7zM16 5h2.5v14H16z"/>',
  prev: '<path d="M18 5l-9 7 9 7zM5.5 5H8v14H5.5z"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

// ---------- navigation
const VIEWS = [
  ['clock', 'Clock'], ['focus', 'Focus'], ['timer', 'Timer'], ['stopwatch', 'Stopwatch'], ['alarm', 'Alarm'],
  ['study', 'Study'], ['pet', 'Pet'], ['calendar', 'Calendar'], ['contests', 'Contests'], ['lamp', 'Lamp'],
];

function showView(id) {
  if (!VIEWS.some(([v]) => v === id)) id = 'clock';
  settings.view = id;
  saveSettings();
  for (const [v] of VIEWS) $('#v-' + v).classList.toggle('on', v === id);
  $$('#dock button').forEach((b) => b.classList.toggle('on', b.dataset.v === id));
  emit('view', id);
  poke();
}

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.dataset.palette = settings.palette;
  const tb = $('#b-theme');
  if (tb) tb.innerHTML = icon(settings.theme === 'dark' ? 'sun' : 'moon');
  if (api) api.app.setTheme(settings.theme);
}

function buildChrome() {
  const dock = $('#dock');
  for (const [id, label] of VIEWS) {
    dock.append(h('button', { 'data-v': id, html: icon(id), onclick: () => showView(id) }, h('span', {}, label)));
  }
  const ib = (id, ic, title, fn) => h('button', { class: 'ib', id, title, 'aria-label': title, html: icon(ic), onclick: fn });
  $('#top').append(
    ib('b-sound', 'sound', 'Sounds and music', () => toggleSoundPop()),
    // Quotes are an overlay for the Clock view.  Toggling them must not throw the
    // user out of whichever tool they are currently using.
    ib('b-quote', 'quote', 'Quotes on / off', () => { settings.quotes = !settings.quotes; saveSettings(); emit('settings'); }),
    ib('b-buddy', 'buddy', 'Study buddy on / off', () => { settings.buddy = !settings.buddy; saveSettings(); emit('settings'); }),
    ib('b-theme', 'sun', 'Light / dark', () => { settings.theme = settings.theme === 'dark' ? 'light' : 'dark'; saveSettings(); applyTheme(); }),
    ib('b-full', 'full', 'Fullscreen (F11)', () => api && api.app.fullscreen()),
    ib('b-gear', 'gear', 'Settings', openSettings),
  );
}

// Hide the controls after a few seconds without input on the immersive views.
let idleT;
function poke() {
  document.body.classList.remove('idle');
  clearTimeout(idleT);
  idleT = setTimeout(() => {
    const typing = document.activeElement && document.activeElement.matches('input, select');
    if (['clock', 'focus', 'lamp'].includes(settings.view) && $('#modal').hidden && $('#sound-pop').hidden && !typing) {
      document.body.classList.add('idle');
    }
  }, 3500);
}
['mousemove', 'mousedown', 'keydown', 'wheel'].forEach((ev) => addEventListener(ev, poke, { passive: true }));

addEventListener('keydown', (e) => {
  if (e.key === 'F11') { e.preventDefault(); if (api) api.app.fullscreen(); return; }
  if (e.key === 'Escape') {
    if (!$('#modal').hidden) closeSettings();
    else if (!$('#sound-pop').hidden) toggleSoundPop(false);
    else if (api) api.app.fullscreen(false);
    return;
  }
  if (e.target.matches('input, button, select') || e.ctrlKey || e.altKey || e.metaKey || !$('#modal').hidden) return;
  if (e.key >= '1' && e.key <= String(VIEWS.length)) showView(VIEWS[+e.key - 1][0]);
  if (e.key === ' ') { e.preventDefault(); emit('space', settings.view); }
  if (e.key === 'ArrowRight') emit('arrow', 1);
  if (e.key === 'ArrowLeft') emit('arrow', -1);
});

// ---------- settings sheet
function closeSettings() { $('#modal').hidden = true; }
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeSettings(); });

const GOOGLE_STEPS = [
  ['Open ', 'console.cloud.google.com', ' and create a project.'],
  ['APIs & Services → Library → enable ', 'Google Calendar API', '.'],
  ['Google Auth Platform → set up the consent screen as ', 'External', ', then add your own Gmail under Audience → Test users.'],
  ['Clients → Create client → Application type ', 'Desktop app', '.'],
  ['Audience → ', 'Publish app', '. Without this Google signs you out every 7 days; published, it stays connected for good. (When signing in, Google warns the app is unverified: choose Advanced → Go to the app. It is your own app.)'],
  ['Paste the ', 'Client ID and Client secret', ' below and press Connect. They are saved, so you never type them again.'],
];
const SPOTIFY_STEPS = [
  ['Open ', 'developer.spotify.com/dashboard', ' and create an app (Web API).'],
  ['Add this exact Redirect URI: ', 'http://127.0.0.1:43897/callback', ''],
  ['Paste the app\'s ', 'Client ID', ' below and press Connect. Playback controls need Spotify Premium.'],
];

async function openSettings() {
  toggleSoundPop(false);
  const sheet = $('#sheet');
  sheet.replaceChildren();
  $('#modal').hidden = false;

  const changed = () => { saveSettings(); emit('settings'); };
  const row = (label, hint, ctl) => h('label', { class: 'srow' }, h('span', {}, label, hint && h('small', {}, hint)), ctl);
  const steps = (list) => h('ol', { class: 'steps' }, list.map(([a, b, c]) => h('li', {}, a, h('b', {}, b), c)));
  const sw = (key) => {
    const i = h('input', { type: 'checkbox', class: 'sw' });
    i.checked = !!settings[key];
    i.addEventListener('change', () => { settings[key] = i.checked; changed(); });
    return i;
  };
  const num = (key, min, max) => {
    const i = h('input', { type: 'number', class: 'num', min, max });
    i.value = settings[key];
    i.addEventListener('change', () => {
      const v = Math.round(+i.value);
      if (!(v >= min && v <= max)) { i.value = settings[key]; return; }
      settings[key] = v; i.value = v; changed();
    });
    return i;
  };

  const seg = h('div', { class: 'seg' }, ['dark', 'light'].map((t) => h('button', {
    class: settings.theme === t ? 'on' : '',
    onclick: (e) => { settings.theme = t; saveSettings(); applyTheme(); $$('button', seg).forEach((b) => b.classList.toggle('on', b === e.currentTarget)); },
  }, t === 'dark' ? 'Dark' : 'Light')));
  const pal = h('div', { class: 'swatches' }, ['rose', 'blue', 'sage', 'amber', 'violet'].map((p) => {
    const b = h('button', { class: 'swatch' + (settings.palette === p ? ' on' : ''), title: p, 'aria-label': p, 'data-palette': p,
      onclick: () => { settings.palette = p; saveSettings(); applyTheme(); $$('.swatch', pal).forEach((x) => x.classList.toggle('on', x === b)); } });
    b.style.background = 'var(--accent)';
    return b;
  }));

  sheet.append(
    h('div', { class: 'head' }, h('h1', {}, 'Settings'), h('div', { class: 'sp' }),
      h('button', { class: 'ib', 'aria-label': 'Close', html: icon('close'), onclick: closeSettings })),
    h('h3', {}, 'Appearance'),
    row('Theme', null, seg),
    row('Colour', null, pal),
    row('24-hour clock', null, sw('h24')),
    row('Show seconds', null, sw('seconds')),
    row('Flip sound', 'A soft click each time the clock flips', sw('flipSound')),
    row('Study pet', 'More options on the Pet tab', sw('buddy')),
    row('Quotes on the clock', 'Click the quote or use the arrow keys to cycle', sw('quotes')),
    row('Change quote every', 'minutes, 0 to change only by hand', num('quoteMin', 0, 120)),
    row('Add new quotes from the internet', 'Once a day, from zenquotes.io. Saved on this PC so they work offline', sw('quotesOnline')),
    h('div', { class: 'srow' }, h('span', {}, 'Quote library', h('small', {}, `${allQuotes().length} quotes saved`)),
      h('button', { class: 'btn', onclick: async (e) => { await fetchQuotes(true); e.target.previousSibling.lastChild.textContent = `${allQuotes().length} quotes saved`; } }, 'Fetch more now')),
    h('h3', {}, 'Focus timer'),
    row('Focus', 'minutes', num('focusMin', 1, 240)),
    row('Break', 'minutes', num('breakMin', 1, 120)),
    row('Long break', 'minutes', num('longMin', 1, 120)),
    row('Long break every', 'rounds, 0 to turn off', num('longEvery', 0, 12)),
    row('Start the next block automatically', null, sw('autoStart')),
    h('h3', {}, 'Alarms'),
    row('Snooze length', 'minutes', num('snoozeMin', 1, 60)),
  );

  // Windows
  const info = api ? await call(api.app.info()).catch(() => null) : null;
  const login = h('input', { type: 'checkbox', class: 'sw' });
  login.checked = !!(info && info.openAtLogin);
  login.disabled = !(info && info.packaged);
  login.addEventListener('change', async () => {
    try { login.checked = await call(api.app.setLogin(login.checked)); } catch (err) { login.checked = !login.checked; toast(err.message); }
  });
  const trayBox = h('input', { type: 'checkbox', class: 'sw' });
  trayBox.checked = !!(info && info.closeToTray);
  trayBox.disabled = !info;
  trayBox.addEventListener('change', () => api.app.setCloseToTray(trayBox.checked));
  sheet.append(
    h('h3', {}, 'Windows'),
    row('Open when Windows starts', info && !info.packaged ? 'Only available in the built app' : null, login),
    row('Keep running in the background when closed', 'Timers, alarms and sounds carry on. Quit from the tray icon', trayBox),
  );

  const dataNote = h('small', {}, store.persistent
    ? 'Everything is saved instantly to a local database on this PC, with a daily backup kept for 14 days.'
    : 'The database could not be opened, so data is being kept in browser storage for now.');
  sheet.append(
    h('h3', {}, 'Your data'),
    h('div', { class: 'srow' }, h('span', {}, 'Saved on this PC', dataNote),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => api && api.db.folder() }, 'Open folder'),
        h('button', { class: 'btn', onclick: async (e) => {
          try { await call(api.db.backup()); e.target.textContent = 'Backed up'; } catch (err) { toast(err.message); }
        } }, 'Back up now'))),
  );

  // Google Calendar
  const gStatus = h('small', {}, 'Checking…');
  const idIn = h('input', { type: 'text', placeholder: 'xxxx.apps.googleusercontent.com', spellcheck: 'false', autocomplete: 'off' });
  const secIn = h('input', { type: 'password', placeholder: 'Client secret', autocomplete: 'off' });
  const gBtn = h('button', { class: 'btn pri' }, 'Connect');
  const gOff = h('button', { class: 'btn', hidden: true }, 'Disconnect');
  const paintG = (st) => {
    gStatus.textContent = st.connected ? 'Connected. Events sync both ways.'
      : st.configured ? 'Credentials saved, not connected.' : 'Not connected. Events are saved on this PC only.';
    gBtn.textContent = st.connected ? 'Reconnect' : 'Connect';
    gOff.hidden = !st.connected;
    if (st.configured) { idIn.placeholder = 'Saved (leave blank to keep)'; secIn.placeholder = 'Saved (leave blank to keep)'; }
  };
  if (api) call(api.gcal.status()).then(paintG).catch(() => {});
  else gStatus.textContent = 'Unavailable outside the app.';
  gBtn.addEventListener('click', async () => {
    gBtn.disabled = true;
    gStatus.textContent = 'Waiting for you to approve in your browser…';
    try {
      paintG(await call(api.gcal.connect({ clientId: idIn.value, clientSecret: secIn.value })));
      idIn.value = ''; secIn.value = '';
      emit('gcal');
    } catch (err) { gStatus.textContent = err.message; }
    gBtn.disabled = false;
  });
  gOff.addEventListener('click', async () => { paintG(await call(api.gcal.disconnect())); emit('gcal'); });
  sheet.append(
    h('h3', {}, 'Google Calendar'),
    h('div', { class: 'srow' }, h('span', {}, 'Two-way sync', gStatus), h('div', { class: 'row' }, gOff, gBtn)),
    steps(GOOGLE_STEPS),
    h('div', { class: 'row left' }, h('button', { class: 'btn sm', onclick: () => api && api.app.open('https://console.cloud.google.com/apis/credentials') }, 'Open Google Cloud Console')),
    row('Client ID', null, idIn),
    row('Client secret', 'Stored encrypted on this PC', secIn),
  );

  // Spotify
  const sStatus = h('small', {}, 'Checking…');
  const sIn = h('input', { type: 'text', placeholder: 'Spotify Client ID', spellcheck: 'false', autocomplete: 'off' });
  const sBtn = h('button', { class: 'btn pri' }, 'Connect');
  const sOff = h('button', { class: 'btn', hidden: true }, 'Disconnect');
  const paintS = (st) => {
    sStatus.textContent = st.connected ? 'Connected. Controls are in the sounds menu.' : st.configured ? 'Client ID saved, not connected.' : 'Not connected.';
    sBtn.textContent = st.connected ? 'Reconnect' : 'Connect';
    sOff.hidden = !st.connected;
    if (st.configured) sIn.placeholder = 'Saved (leave blank to keep)';
  };
  if (api) call(api.spotify.status()).then(paintS).catch(() => {});
  else sStatus.textContent = 'Unavailable outside the app.';
  sBtn.addEventListener('click', async () => {
    sBtn.disabled = true;
    sStatus.textContent = 'Waiting for you to approve in your browser…';
    try { paintS(await call(api.spotify.connect(sIn.value))); sIn.value = ''; emit('spotify'); }
    catch (err) { sStatus.textContent = err.message; }
    sBtn.disabled = false;
  });
  sOff.addEventListener('click', async () => { paintS(await call(api.spotify.disconnect())); emit('spotify'); });
  sheet.append(
    h('h3', {}, 'Spotify'),
    h('div', { class: 'srow' }, h('span', {}, 'Now playing and controls', sStatus), h('div', { class: 'row' }, sOff, sBtn)),
    steps(SPOTIFY_STEPS),
    h('div', { class: 'row left' }, h('button', { class: 'btn sm', onclick: () => api && api.app.open('https://developer.spotify.com/dashboard') }, 'Open Spotify Dashboard')),
    row('Client ID', null, sIn),
  );

  // Codeforces
  const cfIn = h('input', { type: 'text', placeholder: 'your handle', spellcheck: 'false', maxlength: '40' });
  cfIn.value = settings.cfHandle;
  cfIn.addEventListener('change', () => { settings.cfHandle = cfIn.value.trim(); changed(); });
  sheet.append(
    h('h3', {}, 'Codeforces'),
    row('Handle', 'Rating on the Contests tab, activity heatmap on the Study tab', cfIn),
    row('Remind me 30 minutes before a contest', null, sw('cfRemind')),
    row('Show contests in the calendar', null, sw('cfInCalendar')),
  );
  const ghIn = h('input', { type: 'text', placeholder: 'your username', spellcheck: 'false', maxlength: '39' });
  ghIn.value = settings.ghUser;
  ghIn.addEventListener('change', () => { settings.ghUser = ghIn.value.trim(); changed(); });
  sheet.append(h('h3', {}, 'GitHub'), row('Username', 'Public contribution heatmap on the Study tab. No sign-in needed', ghIn));
}

// Dev hook used by the screenshot mode in main.js.
window.__shot = (step) => {
  closeSettings();
  toggleSoundPop(false);
  for (const part of step.split(':')) {
    if (part === 'light' || part === 'dark') { settings.theme = part; applyTheme(); }
    else if (part === 'settings') openSettings();
    else if (part === 'sound') toggleSoundPop(true);
    else if (part === 'ring') ringAlarm({ label: 'Test alarm' });
    else if (part === 'demo') seedDemo();
    else if (part === 'quotes') { settings.quotes = true; emit('settings'); }
    else if (part === 'deskpet') { pet.desktop = true; buddySay('Drink some water.', 20000); buddyTick(); }
    else if (part === 'rich') { pet.coins = 900; pet.hat = 'crown'; pet.owned.hat.push('crown'); buddy.tab = 'color'; }
    else if (part === 'petkinds') { buddy.tab = 'kind'; }
    else if (part.startsWith('gh=')) { settings.ghUser = part.slice(3); }
    else if (part === 'bunny') { settings.palette = 'blue'; applyTheme(); pet.kind = 'bunny'; pet.color = 'snow'; pet.desktop = false; }
    else if (/^(n|real|d)\d*$/.test(part)) { /* frame marker */ }
    else if (part === 'flipnow') { for (const f of [flipH, flipM]) { const v = f.dataset.v; f.dataset.v = '88'; f._s.forEach((s) => { s.textContent = '88'; }); setFlip(f, v); } }
    else if (part === 'floor') { pet.pos = { x: 480, y: 16 }; placeBuddy(true); buddyTick(); }
    else if (part === 'nudge') { buddySay('It is 10:49 PM and nothing is logged yet. One focus block?', 20000); }
    else if (part === 'dragup') {
      const cv = $('#buddy-cv'), r = cv.getBoundingClientRect(), x = r.left + 20, y = r.top + 20;
      const ev = (t, dy) => cv.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y + dy, pointerId: 1, bubbles: true }));
      ev('pointerdown', 0); for (let i = 1; i <= 12; i++) ev('pointermove', -i * 50); ev('pointerup', -600);
    }
    else if (part === 'pettop') { pet.pos = { x: 480, y: innerHeight - 80 }; placeBuddy(true); buddyTick(); }
    else if (part.startsWith('cf=')) { settings.cfHandle = part.slice(3); }
    else if (part === 'calm') { pet.nudgeOn = false; $('#buddy-say').hidden = true; buddy.bubbleUntil = 0; }
    else showView(part);
  }
};

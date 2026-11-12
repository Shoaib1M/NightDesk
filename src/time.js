'use strict';
// Flip clock, focus (pomodoro) timer, countdown timer, stopwatch and alarms.

// ---------- flip clock
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const flipH = $('#flip-h'), flipM = $('#flip-m');
for (const f of [flipH, flipM]) {
  f.innerHTML = '<div class="half top"><span></span></div><div class="half bottom"><span></span></div>'
    + '<div class="half top flap"><span></span></div><div class="half bottom flap"><span></span></div>';
  f._s = $$('span', f);
}

// Fonts place digits below the middle of their line box. Measure the real digit shapes and lift
// them by the difference, so the flip divider cuts every number exactly in half on any font.
function centerFlipDigits() {
  const ref = flipH._s[0];
  if (!ref || !ref.offsetHeight) return;
  const cs = getComputedStyle(ref), size = parseFloat(cs.fontSize);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const g = ctx.measureText('0123456789');
  if (!g.fontBoundingBoxAscent) return;
  const fa = g.fontBoundingBoxAscent, fd = g.fontBoundingBoxDescent;
  const baseline = (size - (fa + fd)) / 2 + fa;                 // baseline inside a line-height: 1 box
  const digitMid = baseline - (g.actualBoundingBoxAscent - g.actualBoundingBoxDescent) / 2;
  const lift = Math.max(0, (digitMid - size / 2) * 2);         // padding-bottom shifts content by half
  for (const f of [flipH, flipM]) f.style.setProperty('--flip-lift', lift + 'px');
}
addEventListener('resize', () => requestAnimationFrame(centerFlipDigits));
on('view', (v) => { if (v === 'clock') requestAnimationFrame(centerFlipDigits); });
document.fonts && document.fonts.ready.then(centerFlipDigits);

function setFlip(el, v) {
  if (el.dataset.v === v) return;
  const [top, bottom, flapTop, flapBottom] = el._s;
  const old = el.dataset.v;
  el.dataset.v = v;
  if (old == null || !$('#v-clock').classList.contains('on')) { el._s.forEach((s) => { s.textContent = v; }); return; }
  clearTimeout(el._t);
  bottom.textContent = old; flapTop.textContent = old; top.textContent = v; flapBottom.textContent = v;
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  el._t = setTimeout(() => { bottom.textContent = v; flapTop.textContent = v; el.classList.remove('go'); }, 600);
}

function tickClock() {
  const d = new Date();
  setFlip(flipH, pad(settings.h24 ? d.getHours() : d.getHours() % 12 || 12));
  setFlip(flipM, pad(d.getMinutes()));
  $('#c-date').textContent = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  $('#c-day').textContent = DAYS[d.getDay()];
  $('#c-ampm').textContent = settings.h24 ? '' : d.getHours() >= 12 ? 'PM' : 'AM';
  $('#c-sec').textContent = settings.seconds ? pad(d.getSeconds()) : '';
}

// ---------- focus timer
const pomo = { mode: 'focus', running: false, endAt: 0, dur: settings.focusMin * 60000, left: settings.focusMin * 60000, round: 1 };
const longBreakNext = () => settings.longEvery > 0 && pomo.round % settings.longEvery === 0;
const breakMs = () => (longBreakNext() ? settings.longMin : settings.breakMin) * 60000;

function pomoLogFocus() {
  if (pomo.mode !== 'focus') return;
  logStudy(Math.floor((pomo.dur - Math.max(0, pomo.left)) / 60000), $('#p-subj').value);
}
function pomoSet(mode) {
  pomo.mode = mode;
  pomo.dur = mode === 'focus' ? settings.focusMin * 60000 : breakMs();
  pomo.left = pomo.dur;
  pomo.running = false;
}
function pomoToggle() {
  if (pomo.running) { pomo.left = pomo.endAt - Date.now(); pomo.running = false; }
  else {
    pomo.endAt = Date.now() + pomo.left; pomo.running = true;
    if (pomo.mode === 'focus' && pomo.left === pomo.dur) emit('pomo', 'start');
  }
  renderPomo();
}
function pomoAdvance(finished) {
  const wasFocus = pomo.mode === 'focus';
  if (wasFocus) { if (finished) pomo.left = 0; pomoLogFocus(); }
  if (wasFocus) pomoSet('break'); else { pomo.round++; pomoSet('focus'); }
  if (finished) {
    chime();
    const task = $('#p-task').value.trim();
    if (wasFocus) notify('Focus block done', `${task ? task + '. ' : ''}Take a ${fmtDur(pomo.dur / 60000)} break.`);
    else notify('Break is over', `Round ${pomo.round} starts now.`);
    emit('pomo', wasFocus ? 'focus-done' : 'break-done');
    if (settings.autoStart) { pomo.endAt = Date.now() + pomo.left; pomo.running = true; }
  }
  renderPomo();
}
function pomoReset() { pomoLogFocus(); pomoSet(pomo.mode); renderPomo(); }

function tickPomo() {
  if (!pomo.running) return;
  pomo.left = pomo.endAt - Date.now();
  if (pomo.left <= 0) pomoAdvance(true); else renderPomo();
}

function renderPomo() {
  const focus = pomo.mode === 'focus';
  $('#pomo').dataset.mode = pomo.mode;
  $('#p-focus').textContent = fmtMs(focus ? pomo.left : settings.focusMin * 60000);
  $('#p-break').textContent = fmtMs(focus ? breakMs() : pomo.left);
  $('#p-break-title').textContent = (focus ? longBreakNext() : pomo.dur === settings.longMin * 60000 && settings.longMin !== settings.breakMin) ? 'LONG BREAK' : 'BREAK';
  const frac = 1 - Math.max(0, pomo.left) / pomo.dur;
  $$('#pomo .prog').forEach((c) => { c.style.strokeDashoffset = 565.49 * (1 - frac); });
  $('#p-go').textContent = pomo.running ? 'Pause' : pomo.left < pomo.dur ? 'Resume' : 'Start';
  const st = studyStats();
  $('#p-info').textContent = `Round ${pomo.round} · ${fmtDur(st.today)} studied today · ${st.streak} day streak`;
  document.title = pomo.running ? `${fmtMs(pomo.left)} ${focus ? 'Focus' : 'Break'} · Nightdesk` : 'Nightdesk';
}

function fillSubjects() {
  const sel = $('#p-subj'), cur = sel.value || store.get('subj', '');
  sel.replaceChildren(h('option', { value: '' }, 'No subject'), ...study.subjects.map((s) => h('option', { value: s.id }, s.name)));
  sel.value = study.subjects.some((s) => s.id === cur) ? cur : '';
}
$('#p-subj').addEventListener('change', () => store.set('subj', $('#p-subj').value));
$('#p-go').addEventListener('click', pomoToggle);
$('#p-skip').addEventListener('click', () => pomoAdvance(false));
$('#p-reset').addEventListener('click', pomoReset);
on('subjects', fillSubjects);
on('settings', () => { if (!pomo.running && pomo.left === pomo.dur) pomoSet(pomo.mode); renderPomo(); });
on('view', (v) => { if (v === 'focus') renderPomo(); });

// ---------- countdown timer
const tm = { total: 25 * 60000, left: 25 * 60000, running: false, endAt: 0 };
function renderTimer() {
  $('#t-time').textContent = fmtMs(tm.left);
  $('#t-bar').style.width = (tm.total ? (1 - Math.max(0, tm.left) / tm.total) * 100 : 0) + '%';
  $('#t-go').textContent = tm.running ? 'Pause' : tm.left < tm.total && tm.left > 0 ? 'Resume' : 'Start';
}
function timerSet(ms) {
  if (!(ms > 0)) return;
  tm.total = tm.left = ms; tm.running = false;
  $('#t-time').classList.remove('done');
  renderTimer();
}
function timerToggle() {
  if (tm.running) { tm.left = tm.endAt - Date.now(); tm.running = false; }
  else { if (tm.left <= 0) tm.left = tm.total; tm.endAt = Date.now() + tm.left; tm.running = true; $('#t-time').classList.remove('done'); }
  renderTimer();
}
function tickTimer() {
  if (!tm.running) return;
  tm.left = tm.endAt - Date.now();
  if (tm.left <= 0) {
    tm.left = 0; tm.running = false;
    $('#t-time').classList.add('done');
    chime(); setTimeout(chime, 1200);
    notify('Timer finished', `${fmtDur(tm.total / 60000)} is up.`);
  }
  renderTimer();
}
$('#t-chips').append(...[1, 5, 10, 15, 25, 45, 60].map((m) => h('button', { class: 'chip-btn', onclick: () => timerSet(m * 60000) }, `${m} min`)));
$('#t-set').addEventListener('click', () => timerSet(((+$('#t-min').value || 0) * 60 + (+$('#t-sec').value || 0)) * 1000));
$('#t-go').addEventListener('click', timerToggle);
$('#t-reset').addEventListener('click', () => timerSet(tm.total));

// ---------- stopwatch
const sw = { running: false, startAt: 0, acc: 0, laps: [] };
const swNow = () => sw.acc + (sw.running ? Date.now() - sw.startAt : 0);
const fmtSw = (ms) => `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(Math.floor(ms / 10) % 100)}`;
function renderSw() {
  $('#s-time').textContent = fmtSw(swNow());
  $('#s-go').textContent = sw.running ? 'Stop' : sw.acc ? 'Resume' : 'Start';
  if (sw.running && $('#v-stopwatch').classList.contains('on')) requestAnimationFrame(renderSw);
}
function swToggle() {
  if (sw.running) { sw.acc = swNow(); sw.running = false; } else { sw.startAt = Date.now(); sw.running = true; }
  renderSw();
}
function renderLaps() {
  $('#s-laps').replaceChildren(...sw.laps.map((t, i) => h('li', {}, h('span', {}, `Lap ${i + 1}`), h('span', {}, `+${fmtSw(t - (sw.laps[i - 1] || 0))}`), h('span', {}, fmtSw(t)))).reverse());
}
$('#s-go').addEventListener('click', swToggle);
$('#s-lap').addEventListener('click', () => { if (swNow() > 0) { sw.laps.push(swNow()); renderLaps(); } });
$('#s-reset').addEventListener('click', () => { sw.running = false; sw.acc = 0; sw.laps = []; renderLaps(); renderSw(); });
on('view', (v) => { if (v === 'stopwatch') renderSw(); });

on('space', (v) => {
  if (v === 'focus') pomoToggle();
  if (v === 'timer') timerToggle();
  if (v === 'stopwatch') swToggle();
});

// ---------- alarms
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const alarms = store.get('alarms', []); // { id, time 'HH:MM', label, days [0-6], on, last }
const ring = { alarm: null, timer: null, snoozes: [] };
let formDays = [];

function alarmNext(a, from = new Date()) {
  const [hh, mm] = a.time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = addDays(from, i);
    d.setHours(hh, mm, 0, 0);
    if (d > from && (!a.days.length || a.days.includes(d.getDay()))) return d;
  }
  return null;
}
function repeatText(a) {
  if (!a.days.length) return 'Once';
  if (a.days.length === 7) return 'Every day';
  const set = [...a.days].sort().join('');
  if (set === '12345') return 'Weekdays';
  if (set === '06') return 'Weekends';
  return DAY_ORDER.filter((d) => a.days.includes(d)).map((d) => DAYS[d].slice(0, 3)).join(' ');
}

function renderAlarms() {
  store.set('alarms', alarms);
  const sorted = [...alarms].sort((a, b) => a.time.localeCompare(b.time));
  $('#al-list').replaceChildren(...sorted.map((a) => {
    const [hh, mm] = a.time.split(':').map(Number);
    const toggle = h('input', { type: 'checkbox', class: 'sw', 'aria-label': 'Alarm on' });
    toggle.checked = a.on;
    toggle.addEventListener('change', () => { a.on = toggle.checked; a.last = ''; renderAlarms(); });
    return h('div', { class: 'al-row' + (a.on ? '' : ' off') },
      h('div', { class: 'tm' }, settings.h24 ? a.time : `${hh % 12 || 12}:${pad(mm)}`, !settings.h24 && h('small', {}, hh >= 12 ? 'PM' : 'AM')),
      h('div', { class: 'meta' }, [a.label || 'Alarm', repeatText(a)].join(' · ')),
      toggle,
      h('button', { class: 'btn sm danger', 'aria-label': 'Delete alarm', onclick: () => { alarms.splice(alarms.indexOf(a), 1); renderAlarms(); } }, '✕'));
  }));
  if (!alarms.length) $('#al-list').append(h('p', { class: 'empty' }, 'No alarms yet.'));
  const upcoming = [...alarms.filter((a) => a.on).map((a) => alarmNext(a)), ...ring.snoozes.map((s) => new Date(s.at))].filter(Boolean).sort((a, b) => a - b)[0];
  $('#al-next').textContent = upcoming ? `Next rings ${fmtRel(upcoming - Date.now())}` : '';
}

function ringSound() { [0, 0.18, 0.36].forEach((t) => beep(1040, t, 0.14, 0.3, 'square')); }
function ringAlarm(a) {
  if (ring.alarm) return;
  ring.alarm = a;
  ring.started = Date.now();
  ringSound();
  ring.timer = setInterval(() => {
    ringSound();
    if (Date.now() - ring.started > 10 * 60000) { ringStop(); if (api) api.alarm.hide(); } // give up after 10 minutes
  }, 1000);
  notify('Alarm rang', a.label || 'Alarm');
  if (api) api.alarm.show({ label: a.label || 'Alarm', h24: settings.h24, snoozeMin: settings.snoozeMin, palette: settings.palette });
}
function ringStop() { clearInterval(ring.timer); ring.timer = null; ring.alarm = null; }
if (api) api.alarm.onResult((action) => {
  const a = ring.alarm;
  ringStop();
  if (action === 'snooze' && a) {
    ring.snoozes.push({ at: Date.now() + settings.snoozeMin * 60000, label: a.label });
    toast(`Snoozed for ${settings.snoozeMin} minutes`);
  }
  renderAlarms();
});

function tickAlarms() {
  if (ring.alarm) return; // one at a time; anything due is picked up once this one is dealt with
  const d = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`, key = `${ymd(d)} ${hm}`;
  for (const a of alarms) {
    if (!a.on || a.time !== hm || a.last === key || (a.days.length && !a.days.includes(d.getDay()))) continue;
    a.last = key;
    if (!a.days.length) a.on = false;
    renderAlarms();
    ringAlarm(a);
    return; // any other alarm due this minute rings once this one is stopped
  }
  const due = ring.snoozes.findIndex((s) => s.at <= Date.now());
  if (due >= 0) ringAlarm(ring.snoozes.splice(due, 1)[0]);
}

$('#al-days').append(...DAY_ORDER.map((d) => h('button', { type: 'button', title: DAYS[d], 'aria-label': DAYS[d], onclick: (e) => {
  formDays = formDays.includes(d) ? formDays.filter((x) => x !== d) : [...formDays, d];
  e.currentTarget.classList.toggle('on', formDays.includes(d));
} }, DAY_LETTERS[d])));
$('#al-form').addEventListener('submit', (e) => {
  e.preventDefault();
  alarms.push({ id: 'a' + Date.now(), time: $('#al-time').value, label: $('#al-label').value.trim(), days: formDays, on: true, last: '' });
  formDays = [];
  $$('#al-days button').forEach((b) => b.classList.remove('on'));
  $('#al-label').value = '';
  renderAlarms();
});
$('#al-test').addEventListener('click', () => ringAlarm({ label: 'Test alarm' }));
$('#al-time').value = '07:00';
on('view', (v) => { if (v === 'alarm') renderAlarms(); });
on('settings', () => { tickClock(); renderAlarms(); });

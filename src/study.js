'use strict';
// Subjects with daily targets, the study log and statistics.

const SUBJ_COLORS = ['#d98a7c', '#5b9dff', '#7fae8b', '#e0a040', '#9b87f5', '#4fb8b0', '#d974a8', '#a0a5ad'];
const study = {
  subjects: store.get('subjects', [
    { id: 's1', name: 'DSA / CP', color: SUBJ_COLORS[0], goal: 120 },
    { id: 's2', name: 'Maths', color: SUBJ_COLORS[1], goal: 60 },
    { id: 's3', name: 'Core subject', color: SUBJ_COLORS[2], goal: 60 },
  ]),
  // { t: timestamp, m: minutes, s: subject id or '', d: 'YYYY-MM-DD' local date where it happened }
  log: store.get('log', []),
};
const saveSubjects = () => { store.set('subjects', study.subjects); emit('subjects'); renderStudy(); };

// Each session remembers the calendar day it happened on, in the time zone you were in at the
// time. Travelling later (Dubai is 1.5 hours behind India) never moves it to a different day.
// Sessions saved before this existed get the day they show today, once.
const sessionDay = (e) => e.d || ymd(new Date(e.t));
function stampSessionDays() {
  if (!study.log.some((e) => !e.d)) return 0;
  let n = 0;
  study.log = study.log.map((e) => (e.d ? e : (n++, { ...e, d: ymd(new Date(e.t)) })));
  store.set('log', study.log);
  return n;
}
stampSessionDays();

function logStudy(minutes, subjectId) {
  minutes = Math.round(minutes);
  if (minutes < 1) return;
  study.log.push({ t: Date.now(), m: minutes, s: subjectId || '', d: ymd(new Date()) });
  store.set('log', study.log);
  renderStudy();
  emit('studied', minutes);
}

function studyStats() {
  const byDay = new Map(), bySubj = new Map(), byDaySubj = new Map();
  let total = 0;
  for (const e of study.log) {
    const k = sessionDay(e);
    byDay.set(k, (byDay.get(k) || 0) + e.m);
    bySubj.set(e.s, (bySubj.get(e.s) || 0) + e.m);
    byDaySubj.set(k + '|' + e.s, (byDaySubj.get(k + '|' + e.s) || 0) + e.m);
    total += e.m;
  }
  const today = new Date(), tk = ymd(today);
  let week = 0;
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  for (let i = 0; i < 7; i++) week += byDay.get(ymd(addDays(monday, i))) || 0;
  let streak = 0;
  for (let d = byDay.get(tk) ? today : addDays(today, -1); byDay.get(ymd(d)); d = addDays(d, -1)) streak++;
  let best = 0, run = 0, prev = null;
  for (const k of [...byDay.keys()].sort()) {
    run = prev && ymd(addDays(parseYmd(prev), 1)) === k ? run + 1 : 1;
    best = Math.max(best, run); prev = k;
  }
  const level = Math.floor(Math.sqrt(total / 30)) + 1;
  return { byDay, bySubj, byDaySubj, total, today: byDay.get(tk) || 0, week, streak, best, level,
    levelFrom: 30 * (level - 1) ** 2, levelTo: 30 * level ** 2 };
}

const subjName = (id) => (study.subjects.find((s) => s.id === id) || { name: 'No subject' }).name;
const subjColor = (id) => (study.subjects.find((s) => s.id === id) || { color: '#77777c' }).color;

function renderStudy() {
  if (!$('#v-study').classList.contains('on')) return;
  const st = studyStats();
  const tk = ymd(new Date());

  // ----- subjects
  const list = $('#subj-list');
  list.replaceChildren(...study.subjects.map((s) => {
    const done = st.byDaySubj.get(tk + '|' + s.id) || 0;
    const name = h('input', { class: 'nm', maxlength: '40', spellcheck: 'false', 'aria-label': 'Subject name' });
    name.value = s.name;
    name.addEventListener('change', () => { s.name = name.value.trim() || s.name; saveSubjects(); });
    const bar = h('i'); bar.style.width = Math.min(100, s.goal ? (done / s.goal) * 100 : 0) + '%';
    const el = h('div', { class: 'subj' },
      h('div', { class: 'r1' }, h('span', { class: 'dot' }), name,
        h('div', { class: 'step' },
          h('button', { 'aria-label': 'Less time', onclick: () => { s.goal = Math.max(0, s.goal - 30); saveSubjects(); } }, '−'),
          h('b', {}, s.goal ? fmtDur(s.goal) : 'none'),
          h('button', { 'aria-label': 'More time', onclick: () => { s.goal = Math.min(720, s.goal + 30); saveSubjects(); } }, '+'))),
      h('div', { class: 'r2' }, h('div', { class: 'pb' }, bar),
        h('span', {}, `${fmtDur(done)} today` + (s.goal && done >= s.goal ? ' ✓' : '')),
        h('button', { class: 'btn sm', title: 'Log 15 minutes studied away from the app', onclick: () => logStudy(15, s.id) }, '+15m'),
        h('button', { class: 'btn sm danger', 'aria-label': 'Delete subject', onclick: () => {
          if (confirm(`Delete "${s.name}"? Logged hours are kept.`)) { study.subjects = study.subjects.filter((x) => x !== s); saveSubjects(); }
        } }, '✕')));
    el.style.setProperty('--c', s.color);
    return el;
  }));
  if (!study.subjects.length) list.append(h('p', { class: 'empty' }, 'No subjects yet. Add one below.'));

  // ----- stats
  const goalToday = study.subjects.reduce((a, s) => a + s.goal, 0);
  const kpi = (label, value, sub, frac) => {
    const k = h('div', { class: 'kpi' }, h('span', {}, label), h('b', {}, value), h('small', {}, sub));
    if (frac != null) { const i = h('i'); i.style.width = Math.min(100, frac * 100) + '%'; k.append(h('div', { class: 'pb' }, i)); }
    return k;
  };
  const kpis = h('div', { class: 'kpis' },
    kpi('Today', fmtDur(st.today), goalToday ? `of ${fmtDur(goalToday)} planned` : 'no target set', goalToday ? st.today / goalToday : null),
    kpi('This week', fmtDur(st.week), `${fmtDur(st.week / 7)} a day on average`),
    kpi('Streak', `${st.streak} day${st.streak === 1 ? '' : 's'}`, `longest ${st.best}`),
    kpi(`Level ${st.level}`, fmtDur(st.total), `${fmtDur(st.levelTo - st.total)} to level ${st.level + 1}`, (st.total - st.levelFrom) / (st.levelTo - st.levelFrom)));

  const days = [...Array(14)].map((_, i) => addDays(new Date(), i - 13));
  const max = Math.max(60, ...days.map((d) => st.byDay.get(ymd(d)) || 0));
  const ids = [...study.subjects.map((s) => s.id), ''];
  const bars = h('div', { class: 'bars' }, days.map((d) => {
    const k = ymd(d);
    const stack = h('div', { class: 'stack', title: `${d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}: ${fmtDur(st.byDay.get(k) || 0)}` });
    for (const [key, m] of st.byDaySubj) {
      const [day, sid] = key.split('|');
      if (day !== k) continue;
      const seg = h('i'); seg.style.height = (m / max) * 100 + '%'; seg.style.setProperty('--c', ids.includes(sid) ? subjColor(sid) : '#77777c');
      stack.append(seg);
    }
    return h('div', { class: 'col' + (k === tk ? ' today' : '') }, stack, h('span', {}, d.getDate()));
  }));

  const rank = (rows) => h('div', { class: 'rank' }, rows.length ? rows.map(([label, m, color], i) => {
    const w = h('span', { class: 'w' }, label);
    if (color) w.style.color = color;
    return h('div', {}, h('span', { class: 'n' + (i === 0 ? ' g' : '') }, i + 1), w, h('b', {}, fmtDur(m)));
  }) : h('p', { class: 'empty' }, 'Finish a focus block to get on the board.'));
  const bestDays = [...st.byDay].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, m]) => [parseYmd(k).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), m]);
  const topSubj = [...st.bySubj].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, m]) => [subjName(id), m, subjColor(id)]);

  const actCard = h('div', { class: 'card act' }, h('h3', {}, 'Activity', h('small', {}, 'study, GitHub and Codeforces')), h('div', { class: 'heats', id: 'heats' }));
  $('#stats').replaceChildren(kpis,
    h('div', { class: 'card grow' }, h('h3', {}, 'Last 14 days', h('small', {}, 'by subject')), bars),
    actCard,
    h('div', { class: 'two' },
      h('div', { class: 'card' }, h('h3', {}, 'Leaderboard', h('small', {}, 'your best days')), rank(bestDays)),
      h('div', { class: 'card' }, h('h3', {}, 'Subjects', h('small', {}, 'all time')), rank(topSubj))));
  renderHeats(st);
  loadActivity();
}

// ---------- activity heatmaps: study (local), GitHub and Codeforces (fetched, cached for offline)
const activity = Object.assign({ gh: null, cf: null }, store.get('activity', {}));
const actState = { gh: { loading: false, error: '' }, cf: { loading: false, error: '' } };
const ACT_STALE = 3 * 3600000;

async function loadActivity(force) {
  if (!api) return;
  const jobs = [
    ['gh', settings.ghUser, (u) => api.activity.github(u), (days) => days],
    ['cf', settings.cfHandle, (u) => api.activity.codeforces(u), (subs) => {
      const days = {};
      for (const [t, ok] of subs) { const k = ymd(new Date(t * 1000)); days[k] = days[k] || [0, 0]; days[k][0]++; days[k][1] += ok; }
      return days;
    }],
  ];
  for (const [key, user, fetcher, shape] of jobs) {
    const cur = activity[key], s = actState[key];
    if (!user || s.loading) continue;
    if (!force && cur && cur.user === user && Date.now() - cur.at < ACT_STALE) continue;
    s.loading = true; s.error = '';
    renderHeats();
    try {
      activity[key] = { user, at: Date.now(), days: shape(await call(fetcher(user))) };
      store.set('activity', activity);
    } catch (err) { s.error = err.message; }
    s.loading = false;
    renderHeats();
  }
}

function heatmap(weeks, value, color, tip) {
  const today = new Date();
  const start = addDays(today, -today.getDay() - 7 * (weeks - 1)); // weeks start on Sunday, like GitHub
  return h('div', { class: 'heat' }, [...Array(weeks * 7)].map((_, i) => {
    const d = addDays(start, i);
    if (d > today) return h('i', { class: 'f' });
    const v = value(ymd(d)), cell = h('i', { title: tip(d, v) });
    if (v > 0) cell.style.background = color(v);
    return cell;
  }));
}

function renderHeats(st = studyStats()) {
  const box = $('#heats');
  if (!box) return;
  // As many weeks as fit across a third of the card, so all three sit side by side without scrolling.
  const weeks = Math.max(8, Math.min(26, Math.floor(((box.clientWidth || 900) - 40) / 3 / 13)));
  const shade = (base, ratio) => `color-mix(in srgb, ${base} ${Math.round(25 + Math.min(1, ratio) * 75)}%, var(--line))`;
  const fmtDay = (d) => d.toLocaleDateString('en', { day: 'numeric', month: 'short' });
  const since = addDays(new Date(), -7 * weeks);
  const sumSince = (days, get) => Object.entries(days || {}).reduce((a, [k, v]) => (parseYmd(k) >= since ? a + get(v) : a), 0);

  const panel = (title, sub, body, foot) => h('div', { class: 'hp' }, h('div', { class: 'hh' }, h('b', {}, title), h('small', {}, sub)), body, foot || '');
  const link = (key, label, placeholder) => {
    const input = h('input', { placeholder, spellcheck: 'false', maxlength: '40', 'aria-label': label });
    const go = () => { const v = input.value.trim(); if (!v) return; settings[key] = v; saveSettings(); emit('settings'); loadActivity(true); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return h('div', { class: 'hlink' }, input, h('button', { class: 'btn sm pri', onclick: go }, 'Link'));
  };
  const status = (key) => {
    const s = actState[key], cur = activity[key];
    if (s.error) return h('small', { class: 'herr', title: s.error }, cur ? 'Offline, showing saved data' : s.error);
    if (s.loading) return h('small', {}, 'Updating…');
    return '';
  };

  const studied = sumSince(Object.fromEntries(st.byDay), (m) => m);
  const studyPanel = panel('Study', `${fmtDur(studied)} in ${weeks} weeks`,
    heatmap(weeks, (k) => st.byDay.get(k) || 0, (m) => shade('var(--accent)', m / 240), (d, m) => `${fmtDay(d)}: ${fmtDur(m)}`));

  const gh = activity.gh && activity.gh.user === settings.ghUser ? activity.gh : null;
  const ghMax = gh ? Math.max(4, ...Object.values(gh.days)) : 4;
  const ghPanel = !settings.ghUser ? panel('GitHub', 'not linked', link('ghUser', 'GitHub username', 'GitHub username'))
    : panel('GitHub', gh ? `${sumSince(gh.days, (c) => c)} contributions · ${settings.ghUser}` : settings.ghUser,
      heatmap(weeks, (k) => (gh ? gh.days[k] || 0 : 0), (c) => shade('#2ea043', c / ghMax), (d, c) => `${fmtDay(d)}: ${c} contribution${c === 1 ? '' : 's'}`), status('gh'));

  const cfd = activity.cf && activity.cf.user === settings.cfHandle ? activity.cf : null;
  const cfMax = cfd ? Math.max(3, ...Object.values(cfd.days).map((v) => v[0])) : 3;
  const cfPanel = !settings.cfHandle ? panel('Codeforces', 'not linked', link('cfHandle', 'Codeforces handle', 'Codeforces handle'))
    : panel('Codeforces', cfd ? `${sumSince(cfd.days, (v) => v[1])} solved · ${sumSince(cfd.days, (v) => v[0])} submissions` : settings.cfHandle,
      heatmap(weeks, (k) => (cfd && cfd.days[k] ? cfd.days[k][0] : 0), (n) => shade('#5b9dff', n / cfMax),
        (d, n) => `${fmtDay(d)}: ${n} submission${n === 1 ? '' : 's'}${cfd && cfd.days[ymd(d)] ? `, ${cfd.days[ymd(d)][1]} accepted` : ''}`), status('cf'));

  box.replaceChildren(studyPanel, ghPanel, cfPanel);
}

let heatResizeT;
addEventListener('resize', () => { clearTimeout(heatResizeT); heatResizeT = setTimeout(() => { if (settings.view === 'study') renderHeats(); }, 150); });
on('settings', () => { if (settings.view === 'study') { renderHeats(); loadActivity(); } });

$('#subj-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#subj-name').value.trim();
  if (!name) return;
  study.subjects.push({ id: 's' + Date.now(), name, color: SUBJ_COLORS[study.subjects.length % SUBJ_COLORS.length], goal: 60 });
  $('#subj-name').value = '';
  saveSubjects();
});
on('view', (v) => { if (v === 'study') renderStudy(); });

// Dev only: fill the log with sample data for screenshots (not saved).
function seedDemo() {
  study.log = [];
  for (let i = 0; i < 40; i++) {
    if (i % 6 === 5) continue;
    study.subjects.forEach((s, j) => study.log.push({ t: Date.now() - i * 864e5, m: 30 + ((i * 37 + j * 53) % 90), s: s.id }));
  }
  renderStudy();
}

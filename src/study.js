'use strict';
// Subjects with daily targets, the study log and statistics.

const SUBJ_COLORS = ['#d98a7c', '#5b9dff', '#7fae8b', '#e0a040', '#9b87f5', '#4fb8b0', '#d974a8', '#a0a5ad'];
const study = {
  subjects: store.get('subjects', [
    { id: 's1', name: 'DSA / CP', color: SUBJ_COLORS[0], goal: 120 },
    { id: 's2', name: 'Maths', color: SUBJ_COLORS[1], goal: 60 },
    { id: 's3', name: 'Core subject', color: SUBJ_COLORS[2], goal: 60 },
  ]),
  log: store.get('log', []), // { t: timestamp, m: minutes, s: subject id or '' }
};
const saveSubjects = () => { store.set('subjects', study.subjects); emit('subjects'); renderStudy(); };

function logStudy(minutes, subjectId) {
  minutes = Math.round(minutes);
  if (minutes < 1) return;
  study.log.push({ t: Date.now(), m: minutes, s: subjectId || '' });
  store.set('log', study.log);
  renderStudy();
  emit('studied', minutes);
}

function studyStats() {
  const byDay = new Map(), bySubj = new Map(), byDaySubj = new Map();
  let total = 0;
  for (const e of study.log) {
    const k = ymd(new Date(e.t));
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

  const start = addDays(new Date(), -((new Date().getDay() + 6) % 7) - 7 * 17);
  const heat = h('div', { class: 'heat' }, [...Array(18 * 7)].map((_, i) => {
    const d = addDays(start, i), m = st.byDay.get(ymd(d)) || 0;
    const cell = h('i', { class: d > new Date() ? 'f' : '', title: `${d.toLocaleDateString('en', { day: 'numeric', month: 'short' })}: ${fmtDur(m)}` });
    if (m) cell.style.background = `color-mix(in srgb, var(--accent) ${Math.min(100, 25 + (m / 240) * 75)}%, var(--line))`;
    return cell;
  }));

  const rank = (rows) => h('div', { class: 'rank' }, rows.length ? rows.map(([label, m, color], i) => {
    const w = h('span', { class: 'w' }, label);
    if (color) w.style.color = color;
    return h('div', {}, h('span', { class: 'n' + (i === 0 ? ' g' : '') }, i + 1), w, h('b', {}, fmtDur(m)));
  }) : h('p', { class: 'empty' }, 'Finish a focus block to get on the board.'));
  const bestDays = [...st.byDay].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, m]) => [parseYmd(k).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), m]);
  const topSubj = [...st.bySubj].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, m]) => [subjName(id), m, subjColor(id)]);

  $('#stats').replaceChildren(kpis,
    h('div', { class: 'card' }, h('h3', {}, 'Last 14 days', h('small', {}, 'by subject')), bars),
    h('div', { class: 'card' }, h('h3', {}, 'Consistency', h('small', {}, 'last 18 weeks')), heat),
    h('div', { class: 'two' },
      h('div', { class: 'card' }, h('h3', {}, 'Leaderboard', h('small', {}, 'your best days')), rank(bestDays)),
      h('div', { class: 'card' }, h('h3', {}, 'Subjects', h('small', {}, 'all time')), rank(topSubj))));
}

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

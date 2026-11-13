'use strict';
// Exams and syllabus: each subject can have an exam date and a chapter checklist with estimated
// hours. From what is left and the days remaining, it suggests how much to study per day.
// Stored on the subject itself: s.exam = 'YYYY-MM-DD', s.chapters = [{ id, name, hours, done }].

const daysUntil = (dateStr) => Math.round((parseYmd(dateStr) - parseYmd(ymd(new Date()))) / 864e5);

function syllabus(s) {
  const ch = s.chapters || [];
  const done = ch.filter((c) => c.done).length;
  const leftHours = ch.filter((c) => !c.done).reduce((a, c) => a + (c.hours || 0), 0);
  const days = s.exam ? daysUntil(s.exam) : null;
  // Study days left: today up to the day before the exam (at least one, so the last day still counts).
  const studyDays = days == null ? null : Math.max(1, days);
  const perDay = days != null && days >= 0 && leftHours > 0 ? Math.ceil((leftHours * 60) / studyDays / 5) * 5 : 0;
  return { total: ch.length, done, leftHours, days, perDay };
}

const examWhen = (days) => (days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 0 ? `${-days} day${days === -1 ? '' : 's'} ago` : `in ${days} days`);

// The nearest exam still ahead (or today).
function nextExam() {
  return study.subjects.filter((s) => s.exam && daysUntil(s.exam) >= 0).sort((a, b) => a.exam.localeCompare(b.exam))[0] || null;
}

// Extra row on each subject card in the Study tab.
function subjectExtras(s) {
  const y = syllabus(s);
  const parts = [];
  if (s.exam) parts.push(`Exam ${parseYmd(s.exam).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })} · ${examWhen(y.days)}`);
  if (y.total) parts.push(`${y.done}/${y.total} chapters`);
  if (y.perDay) parts.push(`~${fmtDur(y.perDay)} a day`);
  const row = h('button', { class: 'subj-exam' + (s.exam && y.days >= 0 && y.days <= 3 ? ' soon' : ''), onclick: () => openSyllabus(s.id) },
    parts.length ? parts.join(' · ') : '+ Exam date & syllabus');
  if (y.total) { const bar = h('i'); bar.style.width = (y.done / y.total) * 100 + '%'; row.prepend(h('span', { class: 'syl-bar' }, bar)); }
  return row;
}

// ---------- the planner sheet for one subject
function openSyllabus(id) {
  const s = study.subjects.find((x) => x.id === id);
  if (!s) return;
  s.chapters = s.chapters || [];
  const sheet = $('#sheet');
  const save = () => { saveSubjects(); renderClockExam(); if (typeof renderCal === 'function') renderCal(); };
  const draw = () => {
    const y = syllabus(s);
    const date = h('input', { type: 'date', 'aria-label': 'Exam date' });
    date.value = s.exam || '';
    date.addEventListener('change', () => { s.exam = date.value || ''; save(); draw(); });
    let summary = 'Add an exam date and chapters to get a daily plan.';
    if (s.exam && y.days < 0) summary = `The exam was ${examWhen(y.days)}.`;
    else if (s.exam && y.total && !y.leftHours) summary = `Everything is done, ${examWhen(y.days)}. Time to revise.`;
    else if (y.perDay) summary = `${examWhen(y.days)[0].toUpperCase() + examWhen(y.days).slice(1)} · ${fmtDur(y.leftHours * 60)} of chapters left → about ${fmtDur(y.perDay)} a day.`;
    else if (s.exam) summary = `Exam ${examWhen(y.days)}. Add chapters to plan the hours.`;
    const useBtn = y.perDay ? h('button', { class: 'btn sm pri', onclick: () => { s.goal = Math.min(720, Math.ceil(y.perDay / 15) * 15); save(); toast(`${s.name}: daily target set to ${fmtDur(s.goal)}.`); draw(); } }, s.goal === Math.ceil(y.perDay / 15) * 15 ? 'This is your daily target' : 'Use as daily target') : null;

    const list = h('div', { class: 'chap-list' }, s.chapters.map((c) => {
      const box = h('input', { type: 'checkbox', 'aria-label': 'Done' }); box.checked = !!c.done;
      box.addEventListener('change', () => { c.done = box.checked; if (c.done) buddySay(`${c.name || 'Chapter'} done. Nice.`, 4000); save(); draw(); });
      const nm = h('input', { class: 'chap-name', maxlength: '80', spellcheck: 'false', placeholder: 'Chapter', 'aria-label': 'Chapter name' }); nm.value = c.name;
      nm.addEventListener('change', () => { c.name = nm.value.trim(); save(); });
      return h('div', { class: 'chap' + (c.done ? ' done' : '') }, box, nm,
        h('div', { class: 'step' },
          h('button', { 'aria-label': 'Fewer hours', onclick: () => { c.hours = Math.max(0.5, (c.hours || 2) - 0.5); save(); draw(); } }, '−'),
          h('b', {}, fmtDur((c.hours || 0) * 60)),
          h('button', { 'aria-label': 'More hours', onclick: () => { c.hours = Math.min(40, (c.hours || 2) + 0.5); save(); draw(); } }, '+')),
        h('button', { class: 'btn sm danger', 'aria-label': 'Remove chapter', onclick: () => { s.chapters = s.chapters.filter((x) => x !== c); save(); draw(); } }, '✕'));
    }));
    const add = h('textarea', { rows: '2', placeholder: 'Add chapters: one per line (paste a whole syllabus)', spellcheck: 'false', 'aria-label': 'New chapters' });
    const addBtn = h('button', { class: 'btn pri', onclick: () => {
      const names = add.value.split(/\r?\n/).map((x) => x.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 200);
      if (!names.length) return;
      for (const n of names) s.chapters.push({ id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n.slice(0, 80), hours: 2, done: false });
      save(); draw();
    } }, 'Add');

    sheet.replaceChildren(
      h('div', { class: 'head' }, h('h1', {}, s.name), h('div', { class: 'sp' }),
        h('button', { class: 'ib', 'aria-label': 'Close', html: icon('close'), onclick: closeSettings })),
      h('h3', {}, 'Exam'),
      h('div', { class: 'srow' }, h('span', {}, 'Exam date', h('small', {}, 'Shows on the clock and in the calendar')),
        h('div', { class: 'row' }, date, s.exam && h('button', { class: 'btn sm', onclick: () => { s.exam = ''; save(); draw(); } }, 'Clear'))),
      h('div', { class: 'syl-sum' }, h('span', {}, summary), useBtn),
      h('h3', {}, `Syllabus${y.total ? ` · ${y.done}/${y.total} done` : ''}`),
      list,
      !s.chapters.length && h('p', { class: 'hint' }, 'No chapters yet. Each new chapter starts at 2 hours; adjust with − and +.'),
      h('div', { class: 'row left chap-add' }, add, addBtn));
  };
  $('#modal').hidden = false;
  draw();
}

// ---------- clock corner, calendar entries, reminders
function renderClockExam() {
  const el = $('#exam-count');
  if (!el) return;
  const s = settings.examOnClock !== false && nextExam();
  el.hidden = !s;
  if (!s) return;
  const y = syllabus(s);
  el.replaceChildren(h('span', { class: 'dot' }), h('b', {}, `${s.name} exam ${examWhen(y.days)}`), y.total ? ` · ${y.done}/${y.total} chapters` : '');
  el.style.setProperty('--c', s.color);
}

function examEvents() {
  return study.subjects.filter((s) => s.exam).map((s) => ({
    id: 'exam-' + s.id, src: 'exam', title: `${s.name} exam`, allDay: true,
    start: parseYmd(s.exam), end: addDays(parseYmd(s.exam), 1), color: s.color, editable: false,
  }));
}

function examReminders() {
  const today = ymd(new Date());
  for (const s of study.subjects) {
    if (!s.exam) continue;
    const d = daysUntil(s.exam);
    if (d !== 0 && d !== 1) continue;
    const key = `examNote-${s.id}-${today}`;
    if (store.get(key, '')) continue;
    store.set(key, '1');
    const y = syllabus(s);
    const left = y.total ? ` ${y.total - y.done} chapter${y.total - y.done === 1 ? '' : 's'} left.` : '';
    notify(`${s.name} exam ${d === 0 ? 'today' : 'tomorrow'}`, `Good luck!${left}`);
    buddySay(`${s.name} exam ${d === 0 ? 'today. You have got this.' : 'tomorrow.'}${left}`, 15000);
  }
}

on('subjects', renderClockExam);
on('settings', renderClockExam);
on('view', (v) => { if (v === 'clock') renderClockExam(); });

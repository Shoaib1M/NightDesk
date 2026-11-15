'use strict';
// To-do: a big board of post-it notes, like a jamboard. Make your own sections (a pipeline such as
// To do → Scheduled → In progress → Done, or anything else) and drag notes between them.
//  - Double-click empty space, or a colour in the bar, for a new note. Drag notes anywhere.
//  - Sections are frames: drag one by its title and the notes on it come along; resize from the
//    corner; rename, recolour, mark as a "Done" section, clear or delete from its ⋯ menu.
//  - A note dropped in a Done section is finished: 5 coins for the pet the first time.
//  - Notes can have a due date: shown on the note, in the calendar, and as a pet quest on the day.
//  - Ctrl + scroll or the bar zooms; drag empty space to pan.
// Saved as store 'todo' = { notes: [...], sections: [...], zoom }.

const TODO_COLORS = [['yellow', '#fff27a'], ['green', '#b8ec7a'], ['orange', '#ffb35c'], ['pink', '#ff9ec8'], ['blue', '#8fdcf0'], ['lilac', '#cdb8ff']];
const SECTION_TINTS = ['#5b9dff', '#e0a040', '#9b87f5', '#3fa96b', '#e5484d', '#8c8c92'];
const NOTE_SIZE = 170, TODO_COINS = 5;
const todoColor = (id) => (TODO_COLORS.find(([k]) => k === id) || TODO_COLORS[0])[1];
const todo = Object.assign({ notes: [], sections: [], zoom: 1 }, store.get('todo', null) || {});
const td = { saveT: null, drag: null, sel: null, menuFor: null, dateFor: null, pan: null, nextColor: 'yellow' };
const tid = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// First visit: a ready-made pipeline and one note that explains the board.
if (!store.get('todo', null)) {
  ['To do', 'Scheduled', 'In progress', 'Done'].forEach((title, i) => todo.sections.push({ id: tid(), title, x: 30 + i * 330, y: 30, w: 310, h: 640, tint: SECTION_TINTS[[0, 1, 2, 3][i]], done: i === 3 }));
  todo.notes.push({ id: tid(), x: 60, y: 90, w: NOTE_SIZE, h: NOTE_SIZE, color: 'yellow', text: 'Double-click anywhere for a new note. Drag notes between sections.', created: Date.now() });
}

function saveTodo(now) {
  clearTimeout(td.saveT);
  const run = () => { td.saveT = null; store.set('todo', todo); };
  if (now) run(); else td.saveT = setTimeout(run, 300);
}

// ---------- geometry
const canvas = () => $('#todo-canvas');
function toBoard(e) {
  const c = canvas(), r = c.getBoundingClientRect(), z = todo.zoom;
  return { x: (e.clientX - r.left + c.scrollLeft) / z, y: (e.clientY - r.top + c.scrollTop) / z };
}
function viewCenter() {
  const c = canvas(), z = todo.zoom, n = todo.notes.length % 5;
  return { x: (c.scrollLeft + c.clientWidth / 2) / z - NOTE_SIZE / 2 + n * 18, y: (c.scrollTop + c.clientHeight / 2) / z - NOTE_SIZE / 2 + n * 18 };
}
const inside = (n, s) => { const cx = n.x + n.w / 2, cy = n.y + n.h / 2; return cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h; };
// The section a note sits in (the top-most one, if sections overlap).
const sectionOf = (n) => [...todo.sections].reverse().find((s) => inside(n, s)) || null;
const notesIn = (s) => todo.notes.filter((n) => sectionOf(n) === s);
function boardBounds() {
  let w = 3000, ht = 2000;
  for (const o of [...todo.notes, ...todo.sections]) { w = Math.max(w, o.x + o.w + 900); ht = Math.max(ht, o.y + o.h + 700); }
  return { w, h: ht };
}

// ---------- due dates
function dueText(n) {
  if (!n.due) return null;
  const d = Math.round((parseYmd(n.due) - parseYmd(ymd(new Date()))) / 864e5);
  if (n.doneAt) return { t: 'Done', cls: 'ok' };
  if (d < 0) return { t: `${-d} day${d === -1 ? '' : 's'} late`, cls: 'late' };
  if (d === 0) return { t: 'Due today', cls: 'soon' };
  if (d === 1) return { t: 'Due tomorrow', cls: 'soon' };
  return { t: `${d} days left`, cls: '' };
}
// Notes still open and due today or earlier (for pet quests).
const todoDueNow = () => { const today = ymd(new Date()); return todo.notes.filter((n) => n.due && n.due <= today && !n.doneAt && n.text.trim()); };
// Open notes with a due date, as calendar entries.
function todoEvents() {
  if (!tabOn('todo')) return [];
  return todo.notes.filter((n) => n.due && !n.doneAt).map((n) => ({
    id: 'todo-' + n.id, noteId: n.id, src: 'todo', title: n.text.trim().split('\n')[0].slice(0, 80) || 'Post-it', allDay: true,
    start: parseYmd(n.due), end: addDays(parseYmd(n.due), 1), color: '#c99a2e', editable: false,
  }));
}

// ---------- drawing
function fontFor(text) { const l = (text || '').length; return l <= 18 ? 22 : l <= 45 ? 18 : l <= 90 ? 15 : 13; }
function renderTodo() {
  const sheet = $('#todo-sheet'), b = boardBounds(), z = todo.zoom;
  sheet.style.width = b.w + 'px'; sheet.style.height = b.h + 'px'; sheet.style.transform = `scale(${z})`;
  $('#todo-size').style.width = b.w * z + 'px'; $('#todo-size').style.height = b.h * z + 'px';
  sheet.replaceChildren(...todo.sections.map(sectionEl), ...todo.notes.map(noteEl));
  $('#todo-zreset').textContent = Math.round(z * 100) + '%';
  renderTodoStatus();
}
function renderTodoStatus() {
  const open = todo.notes.filter((n) => !n.doneAt).length, due = todoDueNow().length;
  $('#todo-status').textContent = `${open} open` + (due ? ` · ${due} due today or late` : '') + ` · ${todo.notes.filter((n) => n.doneAt).length} done`;
  $$('#todo-sheet .tsec').forEach((el) => { const s = todo.sections.find((x) => x.id === el.dataset.id); if (s) el.querySelector('.tsec-count').textContent = notesIn(s).length; });
}
function place(el, o) { el.style.left = o.x + 'px'; el.style.top = o.y + 'px'; el.style.width = o.w + 'px'; el.style.height = o.h + 'px'; }

function sectionEl(s) {
  const el = h('div', { class: 'tsec' + (s.done ? ' done' : ''), 'data-id': s.id });
  place(el, s);
  el.style.setProperty('--tint', s.tint || SECTION_TINTS[0]);
  const title = h('input', { class: 'tsec-title', maxlength: '40', spellcheck: 'false', 'aria-label': 'Section name' });
  title.value = s.title;
  title.addEventListener('change', () => { s.title = title.value.trim() || 'Section'; title.value = s.title; saveTodo(); });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); });
  el.append(h('div', { class: 'tsec-head' },
    h('span', { class: 'tsec-dot' }), title, s.done && h('span', { class: 'tsec-tag', title: 'Notes here count as finished' }, '✓'),
    h('span', { class: 'tsec-count' }, notesIn(s).length),
    h('button', { class: 'tsec-more', 'aria-label': 'Section options', title: 'Options', onclick: (e) => { e.stopPropagation(); sectionMenu(s, e.currentTarget); } }, '⋯')),
  h('span', { class: 't-size', title: 'Drag to resize' }));
  return el;
}

function noteEl(n) {
  const el = h('div', { class: 'tnote' + (n.doneAt ? ' done' : '') + (td.sel === n.id ? ' sel' : ''), 'data-id': n.id });
  place(el, n);
  el.style.setProperty('--paper', todoColor(n.color));
  const ta = h('textarea', { spellcheck: 'true', placeholder: 'Type…', 'aria-label': 'Post-it note' });
  ta.value = n.text || '';
  ta.style.fontSize = fontFor(n.text) + 'px';
  ta.addEventListener('input', () => { n.text = ta.value.slice(0, 2000); ta.style.fontSize = fontFor(n.text) + 'px'; saveTodo(); });
  ta.addEventListener('focus', () => select(n.id));
  ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') ta.blur(); });
  const due = dueText(n);
  el.append(...[ta,
    !!due && h('button', { class: 'tdue ' + due.cls, title: 'Change the due date', onclick: (e) => { e.stopPropagation(); pickDate(n); } }, due.t),
    h('div', { class: 'tnote-acts' },
      h('button', { title: 'Due date', 'aria-label': 'Due date', onclick: (e) => { e.stopPropagation(); pickDate(n); } }, '📅'),
      h('button', { class: 'tcol', title: 'Change colour', 'aria-label': 'Change colour', onclick: (e) => { e.stopPropagation(); recolor(n); } }),
      h('button', { title: 'Remove', 'aria-label': 'Remove', onclick: (e) => { e.stopPropagation(); removeNote(n); } }, '✕')),
    h('span', { class: 't-size', title: 'Drag to resize' }),
    !!n.doneAt && h('span', { class: 'tdone-mark' }, '✓')].filter(Boolean));
  return el;
}
const elOf = (id) => $(`#todo-sheet [data-id="${id}"]`);
function select(id) {
  td.sel = id;
  $$('#todo-sheet .tnote').forEach((x) => x.classList.toggle('sel', x.dataset.id === id));
}

// ---------- notes
function addNote(at, opts = {}) {
  const n = { id: tid(), x: Math.max(0, Math.round(at.x)), y: Math.max(0, Math.round(at.y)), w: NOTE_SIZE, h: NOTE_SIZE, color: opts.color || td.nextColor, text: opts.text || '', due: opts.due || '', created: Date.now() };
  todo.notes.push(n);
  finishCheck(n);
  saveTodo(); renderTodo();
  if (opts.focus !== false) { const ta = elOf(n.id) && elOf(n.id).querySelector('textarea'); if (ta) ta.focus(); }
  return n;
}
function removeNote(n) {
  const i = todo.notes.indexOf(n);
  if (i < 0) return;
  todo.notes.splice(i, 1);
  saveTodo(); renderTodo();
  toast('Post-it removed', { label: 'Undo', fn: () => { todo.notes.splice(i, 0, n); saveTodo(); renderTodo(); } });
}
function recolor(n) {
  const i = TODO_COLORS.findIndex(([k]) => k === n.color);
  n.color = TODO_COLORS[(i + 1) % TODO_COLORS.length][0];
  const el = elOf(n.id); if (el) el.style.setProperty('--paper', todoColor(n.color));
  saveTodo();
}
function pickDate(n) {
  const inp = $('#todo-date');
  td.dateFor = n.id;
  inp.value = n.due || '';
  const el = elOf(n.id), r = el ? el.getBoundingClientRect() : { left: 200, bottom: 200 };
  inp.style.left = r.left + 'px'; inp.style.top = r.bottom + 'px';
  try { inp.showPicker(); } catch { inp.focus(); }
}
function setDue(n, date) {
  n.due = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : '';
  saveTodo(); renderTodo();
  if (typeof renderCal === 'function') renderCal();
  emit('todo');
}
// Dropped into a Done section: finished (coins once per note). Taken out again: open again.
function finishCheck(n) {
  const s = sectionOf(n);
  if (s && s.done && !n.doneAt) {
    n.doneAt = Date.now();
    emit('taskDone', { src: 'todo', id: n.id });
    if (!n.paid && typeof pet !== 'undefined') {
      n.paid = true;
      pet.coins += TODO_COINS; savePet();
      buddySay(`Done: ${(n.text.trim().split('\n')[0] || 'a post-it').slice(0, 40)}. +${TODO_COINS} coins`, 5000);
    }
    return true;
  }
  if ((!s || !s.done) && n.doneAt) { delete n.doneAt; return true; }
  return false;
}

// ---------- sections
function addSection(at) {
  const i = todo.sections.length;
  const s = { id: tid(), title: 'New section', x: Math.max(0, Math.round(at.x)), y: Math.max(0, Math.round(at.y)), w: 310, h: 520, tint: SECTION_TINTS[i % SECTION_TINTS.length], done: false };
  todo.sections.push(s);
  saveTodo(); renderTodo();
  const t = elOf(s.id) && elOf(s.id).querySelector('.tsec-title');
  if (t) { t.focus(); t.select(); }
  return s;
}
function sectionMenu(s, btn) {
  const m = $('#todo-menu');
  td.menuFor = s.id;
  const close = () => { m.hidden = true; td.menuFor = null; };
  m.replaceChildren(
    h('div', { class: 'tm-tints' }, SECTION_TINTS.map((c) => { const b = h('button', { class: 'tm-tint' + (s.tint === c ? ' on' : ''), 'aria-label': 'Colour', onclick: () => { s.tint = c; saveTodo(); renderTodo(); close(); } }); b.style.background = c; return b; })),
    h('button', { onclick: () => { s.done = !s.done; todo.notes.forEach(finishCheck); saveTodo(); renderTodo(); emit('todo'); close(); } }, s.done ? 'Notes here are not finished' : 'Notes here count as done ✓'),
    s.done && h('button', { onclick: () => { close(); clearSection(s); } }, 'Clear finished notes'),
    h('button', { onclick: () => { close(); const t = elOf(s.id).querySelector('.tsec-title'); t.focus(); t.select(); } }, 'Rename'),
    h('button', { class: 'danger', onclick: () => { close(); deleteSection(s); } }, 'Delete section (notes stay)'));
  const r = btn.getBoundingClientRect(), wrap = $('#v-todo .todo').getBoundingClientRect();
  m.hidden = false;
  m.style.top = (r.bottom - wrap.top + 6) + 'px';
  m.style.left = Math.max(6, r.right - wrap.left - m.offsetWidth) + 'px';
}
function clearSection(s) {
  const gone = notesIn(s);
  if (!gone.length) return;
  todo.notes = todo.notes.filter((n) => !gone.includes(n));
  saveTodo(); renderTodo();
  toast(`${gone.length} post-it${gone.length > 1 ? 's' : ''} cleared`, { label: 'Undo', fn: () => { todo.notes.push(...gone); saveTodo(); renderTodo(); } });
}
function deleteSection(s) {
  const i = todo.sections.indexOf(s);
  todo.sections.splice(i, 1);
  todo.notes.forEach(finishCheck);
  saveTodo(); renderTodo();
  toast('Section deleted', { label: 'Undo', fn: () => { todo.sections.splice(i, 0, s); todo.notes.forEach(finishCheck); saveTodo(); renderTodo(); } });
}

// ---------- zoom
function setZoom(z, around) {
  const c = canvas(), old = todo.zoom;
  z = Math.max(0.3, Math.min(2, Math.round(z * 100) / 100));
  if (z === old) return;
  const r = c.getBoundingClientRect();
  const ax = around ? around.clientX - r.left : c.clientWidth / 2, ay = around ? around.clientY - r.top : c.clientHeight / 2;
  const bx = (c.scrollLeft + ax) / old, by = (c.scrollTop + ay) / old; // board point under the cursor stays put
  todo.zoom = z;
  renderTodo();
  c.scrollLeft = bx * z - ax; c.scrollTop = by * z - ay;
  saveTodo();
}
function fitTodo() {
  const all = [...todo.notes, ...todo.sections];
  const c = canvas();
  if (!all.length) { setZoom(1); c.scrollTo(0, 0); return; }
  const x0 = Math.min(...all.map((o) => o.x)), y0 = Math.min(...all.map((o) => o.y));
  const x1 = Math.max(...all.map((o) => o.x + o.w)), y1 = Math.max(...all.map((o) => o.y + o.h));
  const z = Math.max(0.3, Math.min(1.5, Math.min((c.clientWidth - 40) / (x1 - x0), (c.clientHeight - 40) / (y1 - y0))));
  todo.zoom = Math.round(z * 100) / 100;
  renderTodo();
  c.scrollLeft = x0 * todo.zoom - 20; c.scrollTop = y0 * todo.zoom - 20;
  saveTodo();
}

// ---------- open a note from elsewhere (quest, calendar)
function showTodoNote(id) {
  showView('todo');
  const n = todo.notes.find((x) => x.id === id);
  if (!n) return;
  const c = canvas(), z = todo.zoom;
  c.scrollLeft = (n.x + n.w / 2) * z - c.clientWidth / 2; c.scrollTop = (n.y + n.h / 2) * z - c.clientHeight / 2;
  select(id);
  const el = elOf(id); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
}

// Dev only: an example board for screenshots (screenshot mode, throwaway profile).
if (window.__shot) {
  const baseShot = window.__shot;
  window.__shot = (step) => {
    const parts = step.split(':');
    if (!parts.includes('tododemo')) return baseShot(step);
    baseShot(parts.filter((p) => p !== 'tododemo').join(':') || 'todo');
    const day = (n) => ymd(addDays(new Date(), n));
    const S = (title, i, done) => ({ id: tid(), title, x: 24 + i * 300, y: 24, w: 284, h: 600, tint: SECTION_TINTS[i], done });
    todo.sections = [S('To do', 0), S('Scheduled', 1), S('In progress', 2), S('Done', 3, true)];
    const N = (sec, row, color, text, extra = {}) => ({ id: tid(), x: 24 + sec * 300 + 20 + (row % 2) * 14, y: 84 + row * 128, w: 230, h: 112, color, text, created: Date.now(), ...extra });
    todo.notes = [
      N(0, 0, 'yellow', 'Revise OS paging notes'), N(0, 1, 'pink', 'Email Prof. Rao about the project', { due: day(0) }), N(0, 2, 'green', 'Upsolve Div 2 D'), N(0, 3, 'blue', 'Buy charger'),
      N(1, 0, 'orange', 'Networks lab report', { due: day(2) }), N(1, 1, 'lilac', 'Group study, Thursday 6 pm', { due: day(3) }),
      N(2, 0, 'yellow', 'Website: landing page'), N(2, 1, 'green', 'Past paper 2023 (OS)', { due: day(-1) }),
      N(3, 0, 'blue', 'Submit DBMS assignment', { doneAt: Date.now(), paid: true }), N(3, 1, 'pink', 'Book flight to Dubai', { doneAt: Date.now(), paid: true }),
    ];
    todo.zoom = 1; td.sel = null;
    saveTodo(true); renderTodo(); canvas().scrollTo(0, 0);
  };
}

// ---------- wiring
(function wireTodo() {
  const c = canvas();
  $('#todo-add').replaceChildren(...TODO_COLORS.map(([k, col]) => {
    const b = h('button', { class: 'todo-sw', title: 'New post-it', 'aria-label': `New ${k} post-it`, onclick: () => { td.nextColor = k; addNote(viewCenter(), { color: k }); } });
    b.style.background = col;
    return b;
  }));
  $('#todo-section').addEventListener('click', () => { const p = viewCenter(); addSection({ x: p.x - 70, y: p.y - 150 }); });
  $('#todo-zin').addEventListener('click', () => setZoom(todo.zoom + 0.1));
  $('#todo-zout').addEventListener('click', () => setZoom(todo.zoom - 0.1));
  $('#todo-zreset').addEventListener('click', () => setZoom(1));
  $('#todo-fit').addEventListener('click', fitTodo);
  c.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(todo.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e); }, { passive: false });
  $('#todo-date').addEventListener('change', (e) => { const n = todo.notes.find((x) => x.id === td.dateFor); if (n) setDue(n, e.target.value); });

  // Dragging: notes by their paper, sections by their title bar (bringing their notes), resizing
  // from the corner of either, and panning on empty space.
  c.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const t = e.target, z = todo.zoom;
    if (t.closest('button, .tnote-acts') || (t.tagName === 'INPUT' && !t.closest('.tsec-head')) ) return;
    const noteNode = t.closest('.tnote'), secNode = t.closest('.tsec');
    const resize = !!t.closest('.t-size');
    if (noteNode) {
      const n = todo.notes.find((x) => x.id === noteNode.dataset.id); if (!n) return;
      if (t.tagName === 'TEXTAREA' && !resize && document.activeElement === t) return; // typing or selecting text
      e.preventDefault();
      select(n.id);
      // to the front
      todo.notes.splice(todo.notes.indexOf(n), 1); todo.notes.push(n); noteNode.parentNode.append(noteNode);
      td.drag = { kind: 'note', o: n, el: noteNode, resize, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y, w: n.w, h: n.h, z, moved: false };
    } else if (secNode && (t.closest('.tsec-head') || resize)) {
      const s = todo.sections.find((x) => x.id === secNode.dataset.id); if (!s) return;
      if (t.tagName === 'INPUT' && document.activeElement === t) return; // renaming
      e.preventDefault();
      const riders = resize ? [] : notesIn(s).map((n) => ({ n, x: n.x, y: n.y, el: elOf(n.id) }));
      td.drag = { kind: 'section', o: s, el: secNode, resize, riders, sx: e.clientX, sy: e.clientY, x: s.x, y: s.y, w: s.w, h: s.h, z, moved: false, title: t.tagName === 'INPUT' ? t : null };
    } else {
      td.pan = { sx: e.clientX, sy: e.clientY, l: c.scrollLeft, t: c.scrollTop, moved: false };
      select(null);
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#todo-sheet')) document.activeElement.blur();
    }
    try { c.setPointerCapture(e.pointerId); } catch {}
  });
  c.addEventListener('pointermove', (e) => {
    if (td.pan) {
      const dx = e.clientX - td.pan.sx, dy = e.clientY - td.pan.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) { td.pan.moved = true; c.classList.add('panning'); }
      c.scrollLeft = td.pan.l - dx; c.scrollTop = td.pan.t - dy;
      return;
    }
    const d = td.drag; if (!d) return;
    const dx = (e.clientX - d.sx) / d.z, dy = (e.clientY - d.sy) / d.z;
    if (Math.abs(dx) + Math.abs(dy) > 4 / d.z) d.moved = true;
    if (!d.moved) return;
    const o = d.o;
    if (d.resize) {
      const min = d.kind === 'note' ? 110 : 180;
      o.w = Math.round(Math.max(min, Math.min(2000, d.w + dx))); o.h = Math.round(Math.max(d.kind === 'note' ? 90 : 140, Math.min(3000, d.h + dy)));
    } else {
      o.x = Math.round(Math.max(0, d.x + dx)); o.y = Math.round(Math.max(0, d.y + dy));
      for (const r of d.riders || []) { r.n.x = Math.max(0, r.x + (o.x - d.x)); r.n.y = Math.max(0, r.y + (o.y - d.y)); if (r.el) place(r.el, r.n); }
    }
    place(d.el, o);
    d.el.classList.add('moving');
  });
  const end = () => {
    c.classList.remove('panning');
    if (td.pan) { td.pan = null; return; }
    const d = td.drag; td.drag = null;
    if (!d) return;
    d.el.classList.remove('moving');
    if (!d.moved) {
      if (d.kind === 'note') { const ta = d.el.querySelector('textarea'); ta.focus(); }
      else if (d.title) { d.title.focus(); d.title.select(); }
      return;
    }
    let changed = false;
    for (const n of todo.notes) changed = finishCheck(n) || changed;
    saveTodo();
    renderTodo();
    if (changed) emit('todo');
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
  c.addEventListener('dblclick', (e) => {
    if (e.target.closest('.tnote, .tsec-head, button')) return;
    const p = toBoard(e);
    addNote({ x: p.x - NOTE_SIZE / 2, y: p.y - NOTE_SIZE / 2 });
  });
  addEventListener('keydown', (e) => {
    if (settings.view !== 'todo' || !$('#modal').hidden) return;
    const a = document.activeElement;
    const typing = a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT');
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && td.sel) {
      const n = todo.notes.find((x) => x.id === td.sel);
      if (n) { e.preventDefault(); removeNote(n); td.sel = null; }
    }
    if (!typing && e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); addNote(viewCenter()); }
  });
  addEventListener('mousedown', (e) => { if (!e.target.closest('#todo-menu, .tsec-more')) { $('#todo-menu').hidden = true; td.menuFor = null; } });
  addEventListener('beforeunload', () => { if (td.saveT) saveTodo(true); });
  on('view', (v) => { if (v === 'todo') { renderTodo(); if (!td.shown) { td.shown = true; canvas().scrollTo(0, 0); } } else if (td.saveT) saveTodo(true); });
  saveTodo(true); // keep the first-visit board
})();

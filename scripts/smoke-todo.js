// To-do board (post-its and sections):  node scripts/run-tests.js smoke-todo.js
(async () => {
  const fails = [], errors = [];
  let count = 0;
  addEventListener('error', (e) => errors.push(e.message));
  addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const check = (name, ok, info) => { count++; try { if (!(typeof ok === 'function' ? ok() : ok)) fails.push(`${name} -> ${JSON.stringify(info)}`); } catch (e) { fails.push(`${name} threw ${e.message}`); } };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const saved = () => { saveTodo(true); return store.get('todo', {}); };
  const c = $('#todo-canvas');
  // Screen point of a board point (zoom and scroll included).
  const scr = (x, y) => { const r = c.getBoundingClientRect(), z = todo.zoom; return { clientX: r.left + x * z - c.scrollLeft, clientY: r.top + y * z - c.scrollTop }; };
  const pe = (type, el, p) => el.dispatchEvent(new PointerEvent(type, { ...p, button: 0, pointerId: 1, bubbles: true, cancelable: true }));
  const drag = (el, from, to) => { pe('pointerdown', el, scr(from.x, from.y)); pe('pointermove', c, scr((from.x + to.x) / 2, (from.y + to.y) / 2)); pe('pointermove', c, scr(to.x, to.y)); pe('pointerup', c, scr(to.x, to.y)); };
  const node = (id) => $(`#todo-sheet [data-id="${id}"]`);
  const sec = (title) => todo.sections.find((s) => s.title === title);
  const today = ymd(new Date());

  // ----- first visit
  showView('todo'); await wait(100);
  check('the To-do tab is in the dock', !!$('#dock button[data-v="todo"]') && settings.view === 'todo');
  check('a new board starts as a pipeline', todo.sections.map((s) => s.title).join() === 'To do,Scheduled,In progress,Done' && sec('Done').done && !sec('To do').done);
  check('with one note that explains it, in To do', todo.notes.length === 1 && sectionOf(todo.notes[0]) === sec('To do'));
  check('the starting board is saved straight away', (store.get('todo', {}).sections || []).length === 4);
  check('no stray text inside notes (like "false" or "null")', [...$$('#todo-sheet .tnote, #todo-sheet .tsec')].every((el) => [...el.childNodes].every((k) => k.nodeType === 1)));
  check('sections show how many notes they hold', node(sec('To do').id).querySelector('.tsec-count').textContent === '1');
  todo.notes = []; saveTodo(true); renderTodo(); c.scrollTo(0, 0);

  // ----- adding notes
  const coinsStart = pet.coins = 100;
  c.dispatchEvent(new MouseEvent('dblclick', { ...scr(200, 300), bubbles: true }));
  const n1 = todo.notes[0];
  check('double-click adds a note centred on the spot', n1 && n1.x === 200 - NOTE_SIZE / 2 && n1.y === 300 - NOTE_SIZE / 2, n1);
  check('and it is ready to type in', document.activeElement === node(n1.id).querySelector('textarea'));
  const ta = node(n1.id).querySelector('textarea');
  ta.value = 'Revise OS paging'; ta.dispatchEvent(new Event('input'));
  check('typing saves the text', saved().notes[0].text === 'Revise OS paging');
  check('short text is big, long text gets smaller', parseInt(ta.style.fontSize) === 22 && fontFor('x'.repeat(200)) === 13);
  ta.blur();
  $$('#todo-add .todo-sw')[3].click();
  const n2 = todo.notes[1];
  check('a colour in the bar adds a note of that colour', n2 && n2.color === 'pink' && node(n2.id).style.getPropertyValue('--paper') === '#ff9ec8');
  document.activeElement.blur();
  addEventListener; document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
  check('pressing N adds a note', todo.notes.length === 3);
  removeNote(todo.notes[2]); $('#toast').hidden = true;
  node(n2.id).querySelector('.tcol').click();
  check('the colour button cycles the colour', n2.color === 'blue');

  // ----- dragging between sections, and Done
  const done = sec('Done'), inProg = sec('In progress');
  n1.x = 60; n1.y = 120; renderTodo();
  check('a note in To do is open', sectionOf(n1) === sec('To do') && !n1.doneAt);
  drag(node(n1.id).querySelector('textarea'), { x: 100, y: 160 }, { x: done.x + 140, y: 300 });
  check('dragging moves the note', sectionOf(n1) === done, [n1.x, n1.y]);
  check('dropped in Done it is finished, and pays the pet 5 coins', !!n1.doneAt && pet.coins === coinsStart + 5 && node(n1.id).classList.contains('done'));
  check('the section counts update', node(done.id).querySelector('.tsec-count').textContent === '1' && node(sec('To do').id).querySelector('.tsec-count').textContent === '0');
  drag(node(n1.id).querySelector('textarea'), { x: n1.x + 40, y: n1.y + 40 }, { x: inProg.x + 100, y: 300 });
  check('taken out of Done it is open again', sectionOf(n1) === inProg && !n1.doneAt);
  drag(node(n1.id).querySelector('textarea'), { x: n1.x + 40, y: n1.y + 40 }, { x: done.x + 100, y: 300 });
  check('finishing it again pays nothing more', !!n1.doneAt && pet.coins === coinsStart + 5);
  check('a click without moving does not count as a drag', (() => { const x = n1.x; pe('pointerdown', node(n1.id).querySelector('textarea'), scr(n1.x + 30, n1.y + 30)); pe('pointerup', c, scr(n1.x + 30, n1.y + 30)); return n1.x === x && document.activeElement === node(n1.id).querySelector('textarea'); })());
  document.activeElement.blur();
  check('notes cannot leave the top-left of the board', (() => { drag(node(n2.id).querySelector('textarea'), { x: n2.x + 20, y: n2.y + 20 }, { x: -900, y: -900 }); return n2.x === 0 && n2.y === 0; })(), [n2.x, n2.y]);
  check('resizing a note from its corner', (() => { const w = n2.w; drag(node(n2.id).querySelector('.t-size'), { x: n2.x + n2.w - 4, y: n2.y + n2.h - 4 }, { x: n2.x + n2.w + 60, y: n2.y + n2.h + 30 }); return n2.w === w + 64 || n2.w === w + 60; })(), n2.w);
  check('…but not smaller than readable', (() => { drag(node(n2.id).querySelector('.t-size'), { x: n2.x + n2.w - 4, y: n2.y + n2.h - 4 }, { x: n2.x, y: n2.y }); return n2.w === 110 && n2.h === 90; })(), [n2.w, n2.h]);

  // ----- sections are frames
  const sched = sec('Scheduled');
  const rider = addNote({ x: sched.x + 40, y: sched.y + 80 }, { text: 'Lab report', focus: false });
  const stay = addNote({ x: 1600, y: 900 }, { text: 'Outside', focus: false });
  const sx = sched.x, sy = sched.y, rx = rider.x, ox = stay.x;
  drag(node(sched.id).querySelector('.tsec-title'), { x: sched.x + 60, y: sched.y + 20 }, { x: sched.x + 60, y: sched.y + 260 });
  check('dragging a section by its title brings its notes along', sched.y === sy + 240 && rider.y === sched.y + 80 && rider.x === rx && sched.x === sx, [sched.y, rider.y]);
  check('notes elsewhere stay put', stay.x === ox && stay.y === 900);
  check('a click on the title (no drag) renames it', (() => { const t = node(sched.id).querySelector('.tsec-title'); pe('pointerdown', t, scr(sched.x + 60, sched.y + 20)); pe('pointerup', c, scr(sched.x + 60, sched.y + 20)); return document.activeElement === t; })());
  const title = node(sched.id).querySelector('.tsec-title');
  title.value = 'This week'; title.dispatchEvent(new Event('change'));
  check('renaming is saved', saved().sections.find((s) => s.id === sched.id).title === 'This week');
  title.value = '   '; title.dispatchEvent(new Event('change'));
  check('an empty name falls back to "Section"', sched.title === 'Section');
  title.blur();
  check('resizing a section', (() => { const w = sched.w, ht = sched.h; drag(node(sched.id).querySelector(':scope > .t-size'), { x: sched.x + sched.w - 4, y: sched.y + sched.h - 4 }, { x: sched.x + sched.w + 96, y: sched.y + sched.h - 104 }); return sched.w === w + 100 && sched.h === ht - 100; })(), [sched.w, sched.h]);
  const s5 = addSection({ x: 1300, y: 40 });
  check('+ Section adds one, ready to name', todo.sections.length === 5 && document.activeElement === node(s5.id).querySelector('.tsec-title'));
  document.activeElement.blur();

  // section menu
  node(s5.id).querySelector('.tsec-more').click();
  check('the ⋯ menu opens', !$('#todo-menu').hidden && $('#todo-menu').textContent.includes('count as done'));
  const inS5 = addNote({ x: s5.x + 30, y: s5.y + 70 }, { focus: false, text: 'x' });
  node(s5.id).querySelector('.tsec-more').click();
  [...$$('#todo-menu button')].find((b) => /count as done/.test(b.textContent)).click();
  check('marking a section as Done finishes the notes on it', s5.done && !!inS5.doneAt && node(s5.id).querySelector('.tsec-tag'));
  node(s5.id).querySelector('.tsec-more').click();
  [...$$('#todo-menu .tm-tint')][4].click();
  check('a section can be recoloured', s5.tint === SECTION_TINTS[4]);
  node(s5.id).querySelector('.tsec-more').click();
  [...$$('#todo-menu button')].find((b) => /Clear finished/.test(b.textContent)).click();
  check('clearing a Done section removes its notes', !todo.notes.includes(inS5));
  $('#toast .toast-act').click();
  check('…and Undo brings them back', todo.notes.includes(inS5));
  node(s5.id).querySelector('.tsec-more').click();
  [...$$('#todo-menu button')].find((b) => /Delete section/.test(b.textContent)).click();
  check('deleting a section keeps its notes, which are open again', !todo.sections.includes(s5) && todo.notes.includes(inS5) && !inS5.doneAt);
  $('#toast .toast-act').click();
  check('Undo restores the section', todo.sections.includes(s5) && !!inS5.doneAt);

  // removing notes
  select(stay.id);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  check('Delete removes the selected note', !todo.notes.includes(stay));
  $('#toast .toast-act').click();
  check('…with Undo', todo.notes.includes(stay));
  node(stay.id).querySelector('textarea').focus();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
  check('Backspace while typing never deletes the note', todo.notes.includes(stay));
  document.activeElement.blur();

  // ----- due dates, calendar and the pet quest
  setDue(rider, today);
  check('a due date shows on the note', node(rider.id).querySelector('.tdue').textContent === 'Due today');
  setDue(stay, ymd(addDays(new Date(), -2)));
  check('late notes say so, in red', node(stay.id).querySelector('.tdue.late').textContent === '2 days late');
  setDue(stay, 'nonsense');
  check('a bad date clears it', stay.due === '' && !node(stay.id).querySelector('.tdue'));
  check('notes due show in the calendar', todoEvents().some((e) => e.noteId === rider.id && ymd(e.start) === today));
  check('finished notes do not', !todoEvents().some((e) => e.noteId === n1.id));
  cal.sel = today; showView('calendar'); renderCal(); await wait(50);
  const ev = [...$$('#day-list .ev')].find((e) => e.textContent.includes('Lab report'));
  check('the calendar day lists it as To-do board', ev && ev.textContent.includes('To-do board'));
  [...ev.querySelectorAll('button')].find((b) => b.textContent === 'Open').click(); await wait(50);
  check('Open goes to the note on the board', settings.view === 'todo' && td.sel === rider.id && node(rider.id).classList.contains('flash'));

  cal.todoistOn = false; pet.day = {}; ensureDay();
  let q = petQuests().find((x) => x.id === 'task');
  check('a note due today becomes the pet quest', q && q.text === 'Finish “Lab report”' && q.hint === 'From your To-do board' && q.have === 0, q);
  drag(node(rider.id).querySelector('textarea'), { x: rider.x + 40, y: rider.y + 40 }, { x: done.x + 150, y: 500 });
  q = petQuests().find((x) => x.id === 'task');
  check('moving it to Done completes the quest', q.have === 1 && !!rider.doneAt);
  settings.hiddenTabs = ['todo']; pet.day = {}; ensureDay(); rider.doneAt = undefined;
  check('with the tab switched off, no quests or calendar entries from it', !todoEvents().length && (petQuests().find((x) => x.id === 'task') || {}).hint !== 'From your To-do board');
  settings.hiddenTabs = []; showView('todo');

  // ----- zoom
  setZoom(5);
  check('zoom stops at 200%', todo.zoom === 2 && $('#todo-zreset').textContent === '200%' && $('#todo-sheet').style.transform === 'scale(2)');
  setZoom(0.01);
  check('and at 30%', todo.zoom === 0.3);
  setZoom(0.5);
  const before = todo.notes.length;
  c.dispatchEvent(new MouseEvent('dblclick', { ...scr(900, 700), bubbles: true }));
  const z5 = todo.notes[before];
  check('clicks land in the right place when zoomed', z5 && z5.x === 900 - NOTE_SIZE / 2 && z5.y === 700 - NOTE_SIZE / 2, z5 && [z5.x, z5.y]);
  document.activeElement.blur();
  $('#todo-fit').click();
  check('Fit shows everything', todo.zoom >= 0.3 && todo.zoom <= 1.5 && (() => { const all = [...todo.notes, ...todo.sections]; const x1 = Math.max(...all.map((o) => o.x + o.w)); return x1 * todo.zoom - c.scrollLeft <= c.clientWidth + 2; })(), todo.zoom);
  c.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, ...scr(100, 100), bubbles: true, cancelable: true }));
  check('Ctrl + scroll zooms in', todo.zoom > 0.3);
  check('the zoom is remembered', saved().zoom === todo.zoom);
  setZoom(1);

  // ----- panning on empty space
  c.scrollTo(0, 0);
  const emptyPt = { x: 900, y: 900 };
  c.scrollLeft = 400; c.scrollTop = 400;
  const l0 = c.scrollLeft, t0 = c.scrollTop;
  pe('pointerdown', $('#todo-sheet'), scr(emptyPt.x, emptyPt.y)); pe('pointermove', c, { clientX: scr(emptyPt.x, emptyPt.y).clientX - 120, clientY: scr(emptyPt.x, emptyPt.y).clientY - 80 }); pe('pointerup', c, {});
  check('dragging empty space pans the board', c.scrollLeft === l0 + 120 && c.scrollTop === t0 + 80, [c.scrollLeft - l0, c.scrollTop - t0]);

  // ----- safety and saving
  const evil = addNote({ x: 40, y: 1200 }, { text: '<img src=x onerror="window.__pwn=1"><script>window.__pwn=1</script>', focus: false });
  await wait(50);
  check('note text is never run as HTML', !window.__pwn && !$('#todo-sheet img') && node(evil.id).querySelector('textarea').value.startsWith('<img'));
  const s = saved();
  check('still no stray text with due dates and finished notes', [...$$('#todo-sheet .tnote')].every((el) => [...el.childNodes].every((k) => k.nodeType === 1)));
  check('everything is saved', s.notes.length === todo.notes.length && s.sections.length === 5 && s.notes.find((n) => n.id === rider.id).due === today);
  check('nothing is left half-saved when the tab changes', (() => { evil.text = 'changed'; saveTodo(); showView('clock'); return store.get('todo', {}).notes.find((n) => n.id === evil.id).text === 'changed'; })());
  check('Settings › Tabs can switch it off', TAB_HINTS.todo && VIEWS.some(([v]) => v === 'todo'));
  return JSON.stringify({ checks: count, failed: fails, pageErrors: errors }, null, 1);
})();

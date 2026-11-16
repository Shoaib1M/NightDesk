// Ideas from a friend's first week:  node scripts/run-tests.js smoke-friend.js
// Boards in Notes, quests from real work (syllabus and Todoist), the pet's thought bubble, and a
// pet made from your own picture.
(async () => {
  const fails = [], errors = [];
  let count = 0;
  addEventListener('error', (e) => errors.push(e.message));
  addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const check = (name, ok, info) => { count++; try { if (!(typeof ok === 'function' ? ok() : ok)) fails.push(`${name} -> ${JSON.stringify(info)}`); } catch (e) { fails.push(`${name} threw ${e.message}`); } };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const saved = () => store.get('notes', []);
  const pngFile = async (w, ht, paint, name = 'pic.png') => {
    const c = document.createElement('canvas'); c.width = w; c.height = ht; paint(c.getContext('2d'));
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return new File([blob], name, { type: 'image/png' });
  };
  const today = ymd(new Date());

  // ================= Boards in Notes
  showView('notes'); await wait(100);
  const plain = newNote();
  $('#note-title').value = 'Plain note'; $('#note-body').innerHTML = '<p>hello</p>'; commitNote();
  const bd = newBoard(); await wait(50);
  check('a new board opens as a board', notes.cur === bd && !$('#board').hidden && $('#note-page').classList.contains('boardmode') && getComputedStyle($('#note-body')).display === 'none');
  check('an empty board says so and shows its tools', !$('#board-empty').hidden && !$('#board-tools').hidden);
  $('#note-title').value = 'Project research'; $('#note-title').dispatchEvent(new Event('input')); commitNote();
  check('the title is saved', saved().find((n) => n.id === bd.id).title === 'Project research');

  const t1 = addText({ x: 100, y: 120 }, 'Ideas for the zebra project');
  check('a sticky note is added and focused', bd.board.items.length === 1 && document.activeElement === $(`[data-id="${t1.id}"] textarea`));
  const ta = $(`[data-id="${t1.id}"] textarea`);
  check('Space and numbers type normally in a board note', (() => { const k = (key) => { const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); ta.dispatchEvent(ev); return ev; }; return !k(' ').defaultPrevented && (k('2'), settings.view === 'notes'); })(), settings.view);
  ta.value = 'Ideas for the zebra project, round two'; ta.dispatchEvent(new Event('input'));
  await wait(400);
  check('typing in a note saves it', saved().find((n) => n.id === bd.id).board.items[0].text.includes('round two'));

  // Paste a link and some text while the board (not a card) has the focus.
  const paste = (text) => { const dt = new DataTransfer(); dt.setData('text/plain', text); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); };
  ta.blur(); $('#board').focus();
  paste('https://en.wikipedia.org/wiki/Zebra');
  paste('just a thought');
  check('a pasted link becomes a link card', bd.board.items.some((i) => i.t === 'link' && i.url === 'https://en.wikipedia.org/wiki/Zebra'));
  check('pasted text becomes a sticky note', bd.board.items.some((i) => i.t === 'text' && i.text === 'just a thought'));
  check('the link card shows the site', [...$$('#board-sheet .bi-link small')].some((s) => s.textContent === 'en.wikipedia.org'));
  ta.focus(); paste('typed into the note'); ta.blur();
  check('pasting while typing in a note does not make a new card', bd.board.items.length === 3, bd.board.items.length);

  // Drop: an image, a PDF, a link dragged from a browser, and a file type that is not allowed.
  const br = $('#board').getBoundingClientRect();
  const drop = (dt, x = 200, y = 150) => $('#board').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: br.left + x, clientY: br.top + y, bubbles: true, cancelable: true }));
  const img = await pngFile(300, 150, (g) => { g.fillStyle = '#5b9dff'; g.fillRect(0, 0, 300, 150); }, 'shot.png');
  let dt = new DataTransfer(); dt.items.add(img); drop(dt);
  await wait(600);
  const imgItem = bd.board.items.find((i) => i.t === 'img');
  check('a dropped screenshot becomes an image card', imgItem && NOTE_IMG.test(imgItem.src) && imgItem.w === 300, imgItem);
  check('it is placed where it was dropped', imgItem && imgItem.x === 200 && imgItem.y === 150, imgItem && [imgItem.x, imgItem.y]);
  dt = new DataTransfer(); dt.items.add(new File(['%PDF-1.4 fake'], 'Lecture 5.pdf', { type: 'application/pdf' })); drop(dt, 500, 400);
  await wait(400);
  const pdf = bd.board.items.find((i) => i.t === 'file');
  check('a dropped PDF becomes a file card', pdf && pdf.name === 'Lecture 5.pdf' && /^[a-f0-9]{40}\.pdf$/.test(pdf.file) && pdf.size === 13, pdf);
  const opened = await call(api.notes.openFile(pdf.file)).catch((e) => e.message);
  check('the PDF is kept on this PC and can be opened', /notes-images[\\/][a-f0-9]{40}\.pdf$/.test(opened), opened);
  check('only known files can be opened', /Unknown file/.test(await call(api.notes.openFile('..\\..\\x.exe')).catch((e) => e.message)));
  const before = bd.board.items.length;
  dt = new DataTransfer(); dt.items.add(new File(['MZ'], 'virus.exe', { type: 'application/x-msdownload' })); drop(dt);
  await wait(300);
  check('a program file is refused', bd.board.items.length === before && /Only pdf/.test($('#toast').textContent), $('#toast').textContent);
  dt = new DataTransfer(); dt.setData('text/uri-list', 'https://www.zebras.org/facts'); dt.setData('text/html', '<a href="https://www.zebras.org/facts">Zebra facts</a>'); drop(dt, 600, 200);
  check('a link dragged from a browser keeps its title', bd.board.items.some((i) => i.t === 'link' && i.title === 'Zebra facts'));
  dt = new DataTransfer(); dt.setData('text/plain', 'dragged words'); drop(dt);
  check('dragged text becomes a note', bd.board.items.some((i) => i.text === 'dragged words'));

  // Move and resize with the mouse.
  const card = $(`[data-id="${t1.id}"]`), grip = card.querySelector('.bi-grip');
  const pe = (type, el, x, y) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true }));
  const x0 = t1.x, y0 = t1.y;
  pe('pointerdown', grip, 200, 200); pe('pointermove', $('#board'), 260, 250); pe('pointerup', $('#board'), 260, 250);
  check('dragging a card moves it', t1.x === x0 + 60 && t1.y === y0 + 50 && card.style.left === t1.x + 'px', [t1.x, t1.y]);
  check('the moved card comes to the front', bd.board.items.at(-1) === t1 && $('#board-sheet').lastElementChild.dataset.id === t1.id);
  const w0 = card.offsetWidth;
  pe('pointerdown', card.querySelector('.bi-size'), 300, 300); pe('pointermove', $('#board'), 380, 340); pe('pointerup', $('#board'), 380, 340);
  check('dragging the corner resizes it', t1.w === w0 + 80 && t1.h >= 160, [t1.w, t1.h]);
  pe('pointerdown', grip, 10, 10); pe('pointermove', $('#board'), -5000, -5000); pe('pointerup', $('#board'), -5000, -5000);
  check('cards cannot be dragged off the top-left', t1.x === 0 && t1.y === 0, [t1.x, t1.y]);
  await wait(400);
  check('the new position is saved', (() => { const s = saved().find((n) => n.id === bd.id).board.items.find((i) => i.id === t1.id); return s.x === 0 && s.w === t1.w; })());
  card.querySelector('.bi-col').click();
  check('the colour dot changes a note colour', t1.color === BOARD_COLORS[1]);

  // Remove and undo.
  const n0 = bd.board.items.length, link = bd.board.items.find((i) => i.t === 'link');
  $(`[data-id="${link.id}"] .bi-x`).click();
  check('removing a card', bd.board.items.length === n0 - 1 && !$(`[data-id="${link.id}"]`));
  $('#toast .toast-act').click();
  check('undo puts it back', bd.board.items.length === n0 && !!$(`[data-id="${link.id}"]`));

  // Safety: text is never run as HTML.
  addText({ x: 50, y: 900 }, '<img src=x onerror="window.__pwn=1"><script>window.__pwn=1</script>');
  await wait(50);
  check('note text is shown as text, never as HTML', !window.__pwn && !$('#board-sheet img[src="x"]') && !$('#board-sheet script'));

  // Search, list preview, thumbnail, Markdown, duplicate.
  commitNote(); await wait(50);
  notes.q = 'zebra'; check('search finds words on a board', visibleNotes().includes(bd)); notes.q = '';
  renderNotesList();
  check('the list shows the board with its first image', (() => { const row = $(`#notes-list .note-item[data-id="${bd.id}"]`); return row && row.querySelector('img.ni-thumb') && row.textContent.includes('🧩 Project research') && /zebra|thought|words/.test(row.textContent); })(), $(`#notes-list .note-item[data-id="${bd.id}"]`) && $(`#notes-list .note-item[data-id="${bd.id}"]`).outerHTML.slice(0, 300));
  check('the header counts the cards', /board · \d+ cards/.test($('#note-meta').textContent), $('#note-meta').textContent);
  const md = toMarkdown(bd);
  check('copy as Markdown lists the cards', md.startsWith('# 🧩 Project research') && md.includes('[Zebra facts](https://www.zebras.org/facts)') && md.includes('📄 Lecture 5.pdf') && md.includes('![image](ndimg://'), md);
  const copy = duplicateNote();
  check('duplicate makes an independent copy', copy.board && copy.board.items.length === bd.board.items.length && copy.board.items[0] !== bd.board.items[0]);
  addText({ x: 10, y: 10 }, 'only in the copy');
  check('changing the copy leaves the original alone', bd.board.items.length === copy.board.items.length - 1);

  // Switching between a board and a normal page.
  openNote(plain.id);
  check('a normal note shows its page again', $('#board').hidden && !$('#note-page').classList.contains('boardmode') && $('#note-body').innerHTML.includes('hello'));
  $('#note-body').innerHTML = '<p>hello again</p>'; commitNote();
  check('normal notes still save', saved().find((n) => n.id === plain.id).html.includes('hello again'));
  openNote(bd.id);
  check('back on the board, every card is drawn', $$('#board-sheet .bi').length === bd.board.items.length && $('#note-body').innerHTML === '');
  check('the board never writes page HTML', saved().find((n) => n.id === bd.id).html === '');

  // Recently Deleted: look, do not touch.
  deleteNote(); showFolder('trash'); openNote(bd.id); await wait(50);
  check('a deleted board is read-only', $('#board').classList.contains('ro') && $('#board-tools').hidden && !$('#board-sheet .bi-x') && $('#board-sheet textarea').readOnly);
  const nd = bd.board.items.length;
  $('#board').dispatchEvent(new MouseEvent('dblclick', { clientX: 300, clientY: 300, bubbles: true }));
  paste('should not land');
  check('nothing can be added to a deleted board', bd.board.items.length === nd);
  restoreNote();
  check('restored, it can be edited again', !$('#board').classList.contains('ro') && !$('#board-tools').hidden);
  showFolder('all');
  $('#board').dispatchEvent(new MouseEvent('dblclick', { clientX: 300, clientY: 300, bubbles: true }));
  check('double-click on empty space adds a note', bd.board.items.length === nd + 1);
  check('the board grows with its cards', (() => { addText({ x: 3000, y: 2500 }, 'far away'); return parseInt($('#board-sheet').style.width) >= 3800 && parseInt($('#board-sheet').style.height) >= 3100; })());

  // ================= Quests from real work
  const reset = () => { pet.day = {}; pet.coins = 0; ensureDay(); };
  study.subjects = [
    { id: 'os', name: 'OS', color: '#5b9dff', goal: 0, exam: ymd(addDays(new Date(), 3)), chapters: [{ id: 'c1', name: 'Paging', hours: 2, done: true }, { id: 'c2', name: 'Scheduling', hours: 2, done: false }] },
    { id: 'net', name: 'Networks', color: '#7fae8b', goal: 0, exam: ymd(addDays(new Date(), 9)), chapters: [{ id: 'n1', name: 'TCP', hours: 2, done: false }] },
  ];
  saveSubjects();
  cal.todoistOn = false; cal.todoist = [];
  reset();
  let q = petQuests().find((x) => x.id === 'task');
  check('a quest comes from the nearest exam’s next chapter', q && q.text === 'Finish Scheduling · OS' && q.hint === 'From your syllabus' && q.have === 0, q);
  study.subjects[0].chapters[1].done = true; saveSubjects();
  q = petQuests().find((x) => x.id === 'task');
  check('ticking the chapter in the syllabus completes the quest', q.have === 1 && q.text === 'Finish Scheduling · OS', q);
  claimQuest(q);
  check('claiming it pays 30 coins', pet.coins === 30 && pet.day.claimed.includes('task'));
  check('a claimed quest is not replaced by another that day', petQuests().find((x) => x.id === 'task').text === 'Finish Scheduling · OS');
  showView('pet'); renderPetView(); await wait(50);
  check('the Pet tab shows it, marked as from your syllabus', (() => { const r = $('#pet-quests [data-q="task"]'); return r && r.classList.contains('work') && r.textContent.includes('From your syllabus'); })());
  reset(); study.subjects[0].chapters[1].done = false; saveSubjects(); renderPetView();
  $('#pet-quests [data-q="task"] .qlink').click(); await wait(50);
  check('clicking the quest opens that subject’s syllabus', !$('#modal').hidden && $('#sheet h1').textContent === 'OS');
  closeSettings();
  study.subjects[0].chapters = study.subjects[0].chapters.filter((c) => c.id !== 'c2'); saveSubjects();
  q = petQuests().find((x) => x.id === 'task');
  check('if that chapter is removed, the next one is picked', q && q.text === 'Finish TCP · Networks', q);
  study.subjects.forEach((s) => s.chapters.forEach((c) => { c.done = true; })); saveSubjects(); reset();
  check('no unfinished chapters and no Todoist: no task quest', !petQuests().some((x) => x.id === 'task'));

  // Todoist tasks come first when there are any due.
  cal.todoistOn = true;
  cal.todoist = [
    { id: 't1', title: 'Read chapter 4', allDay: true, date: today, priority: 1 },
    { id: 't2', title: 'Submit essay', allDay: false, at: new Date(Date.now() - 3600000).toISOString(), priority: 4 },
    { id: 't3', title: 'Next week thing', allDay: true, date: ymd(addDays(new Date(), 7)), priority: 4 },
  ];
  reset();
  q = petQuests().find((x) => x.id === 'task');
  check('the most important Todoist task due today is the quest', q && q.text === 'Finish “Submit essay”' && q.hint === 'From Todoist', q);
  emit('taskDone', { src: 'todoist', id: 't2' });
  check('ticking it off in Nightdesk completes the quest', petQuests().find((x) => x.id === 'task').have === 1);
  reset(); cal.todoistAt = 0;
  q = petQuests().find((x) => x.id === 'task');
  cal.todoist = cal.todoist.filter((t) => t.id !== 't2'); cal.todoistAt = Date.now() + 1000;
  check('finished in the Todoist app (gone after a sync) also counts', petQuests().find((x) => x.id === 'task').have === 1);

  // Calendar: Todoist tasks show with a Done button.
  cal.sel = today; showView('calendar'); renderCal(); await wait(50);
  const ev = [...$$('#day-list .ev')].find((e) => e.textContent.includes('Read chapter 4'));
  check('a Todoist task shows on its day, with a Done button', ev && ev.textContent.includes('Todoist') && [...ev.querySelectorAll('button')].some((b) => b.textContent === 'Done'));
  check('it also shows in the month grid', [...$$('#cal-grid .day.today .chip')].some((c) => c.textContent === 'Read chapter 4'));
  check('tasks due later are on their own day, not today', ![...$$('#day-list .ev')].some((e) => e.textContent.includes('Next week thing')));
  check('Todoist is not connected in a fresh profile', (await call(api.todoist.status())).connected === false);
  check('a bad token is refused with a clear message', /does not look like/.test(await call(api.todoist.connect('nope')).catch((e) => e.message)));
  check('Settings › Accounts has Todoist', await (async () => { await openSettings(); showSettingsPage('accounts'); const ok = [...$$('#sheet .spage[data-page="accounts"] h3')].some((x) => x.textContent === 'Todoist'); closeSettings(); return ok; })());
  cal.todoistOn = false; cal.todoist = []; renderCal();

  // ================= Thought bubble
  showView('clock'); settings.buddy = true; pet.desktop = false; pet.roam = false; pomo.running = false;
  pet.hunger = 80; pet.energy = 80; pet.joy = 80; pet.last = Date.now(); buddy.bubbleUntil = 0; buddyTick();
  check('a happy pet has no thought bubble', $('#buddy-think').hidden);
  pet.hunger = 20; pet.saidNeed = {}; buddyTick();
  check('a hungry pet says so once', /hungry/.test($('#buddy-say').textContent) && !$('#buddy-say').hidden);
  check('the thought bubble waits while it speaks', $('#buddy-think').hidden);
  buddy.bubbleUntil = 0; $('#buddy-say').hidden = true; buddyTick(); buddyTick();
  check('then it thinks of food', !$('#buddy-think').hidden && $('#buddy-think').textContent === '🍖');
  check('it does not keep repeating itself', $('#buddy-say').hidden);
  pet.hunger = 80; pet.energy = 10; buddyTick();
  check('a tired pet thinks of sleep', $('#buddy-think').textContent === '😴');
  pet.energy = 80; pet.joy = 10; buddyTick();
  check('a bored pet thinks of play', $('#buddy-think').textContent === '🧶');
  pomo.running = true; pomo.mode = 'focus'; buddyTick();
  check('no bubble while you focus', $('#buddy-think').hidden);
  pomo.running = false; buddyTick();
  $('#buddy-think').click(); await wait(50);
  check('clicking the bubble opens the Pet tab', settings.view === 'pet');
  paintPetLive();
  check('the button that helps is highlighted', $('#pet-acts [data-act="play"]').classList.contains('pri') && !$('#pet-acts [data-act="treat"]').classList.contains('pri'));
  petPlay(); petPlay(); petPlay(); buddyTick(); paintPetLive();
  check('after playing the bubble goes away', $('#buddy-think').hidden && !$('#pet-acts [data-act="play"]').classList.contains('pri'), pet.joy);
  pet.desktop = true; pet.hunger = 20; buddy.bubbleUntil = 0; buddyTick(); await wait(1500);
  check('the desktop pet gets the bubble too', JSON.parse(buddy.lastSent).think === '🍖', buddy.lastSent);
  pet.desktop = false; pet.hunger = 80; buddyTick();

  // ================= Your own pet from a picture
  const pic = await pngFile(200, 240, (g) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, 200, 240); g.fillStyle = '#e5484d'; g.beginPath(); g.arc(100, 140, 70, 0, 7); g.fill(); g.fillStyle = '#ffffff'; g.fillRect(90, 130, 20, 20); });
  const sprite = await petSpriteFrom(pic);
  const px = Uint8Array.from(atob(sprite), (c) => c.charCodeAt(0));
  const A = (x, y) => px[(y * 32 + x) * 4 + 3], R = (x, y) => px[(y * 32 + x) * 4];
  check('the sprite is 32 × 36 pixels', px.length === 32 * 36 * 4, px.length);
  check('the plain background is cut away', A(0, 0) === 0 && A(31, 35) === 0 && A(1, 20) === 0);
  check('the subject is kept, sitting where the body goes', A(14, 26) === 255 && R(14, 26) > 200 && A(14, 4) === 0);
  check('white inside the subject is kept (not flood-filled)', A(14, 23) === 255 || A(15, 23) === 255);
  check('edges are crisp (no half-see-through pixels)', [...px].filter((v, i) => i % 4 === 3).every((a) => a === 0 || a === 255));
  const photo = await pngFile(120, 120, (g) => { const gr = g.createLinearGradient(0, 0, 120, 120); gr.addColorStop(0, '#000'); gr.addColorStop(1, '#0f0'); g.fillStyle = gr; g.fillRect(0, 0, 120, 120); });
  check('a photo with a busy background is used whole', Uint8Array.from(atob(await petSpriteFrom(photo)), (c) => c.charCodeAt(0)).filter((v, i) => i % 4 === 3 && v === 255).length > 400);
  check('a fully see-through picture is refused', /empty/.test(await petSpriteFrom(await pngFile(50, 50, () => {})).catch((e) => e.message)));
  showView('pet'); buddy.tab = 'kind'; renderPetView();
  const mine = () => [...$$('#shop .item')].find((i) => i.querySelector('b').textContent === 'Your own');
  check('the shop offers “Your own”, free', mine() && mine().textContent.includes('Upload a picture'));
  await usePetPicture(pic); await wait(50);
  check('using a picture makes it your pet', pet.kind === 'custom' && pet.custom === sprite && store.get('pet', {}).custom === sprite);
  check('it is drawn at double detail', $('#pet-big').width === 32 && $('#pet-big').getContext('2d').getImageData(14, 26, 1, 1).data[3] === 255);
  check('the shop marks it chosen and offers a new picture', mine().textContent.includes('Chosen') && [...$$('#shop .item.add')].length === 1);
  check('it grows with study like the others', petStage().name === 'Little one');
  pet.hat = 'crown'; paintPetLive();
  check('hats still sit on top', (() => { const d = $('#pet-big').getContext('2d').getImageData(8, 10, 1, 1).data; return d[3] === 255 && d[0] === 0xf2; })());
  pet.hat = '';
  check('mood still shows (dimmed eyes-closed when asleep)', (() => { const c = document.createElement('canvas'); drawPet(c.getContext('2d'), petLook(), { closed: true }); return c.width === 32 && c.getContext('2d').getImageData(14, 26, 1, 1).data[0] < R(14, 26); })());
  pet.desktop = true; buddyTick(); await wait(1500);
  check('the desktop pet gets the picture', JSON.parse(buddy.lastSent).look.custom === sprite);
  pet.desktop = false; buddyTick();
  buddy.tab = 'color'; renderPetView();
  check('the Colours tab explains they do not apply', /keeps its picture/.test($('#shop').textContent));
  buddy.tab = 'kind'; renderPetView();
  [...$$('#shop .item')].find((i) => i.querySelector('b').textContent === 'Cat').click();
  check('going back to the cat keeps the picture for later', pet.kind === 'cat' && pet.custom === sprite && $('#pet-big').width === 16);
  mine().click();
  check('and the picture can be chosen again without uploading', pet.kind === 'custom');
  check('a text file is refused as a picture', await (async () => { await usePetPicture(new File(['hi'], 'a.txt', { type: 'text/plain' })); return pet.custom === sprite && /PNG/.test($('#toast').textContent); })());
  // The frog: an original new pet in the shop.
  pet.kind = 'cat'; pet.coins = 300; pet.owned.kind = ['cat']; buddy.tab = 'kind'; renderPetView();
  [...$$('#shop .item')].find((i) => i.querySelector('b').textContent === 'Frog').click();
  check('the frog can be bought and comes with its lily-pad green', pet.kind === 'frog' && pet.color === 'lily' && pet.coins === 50 && pet.owned.color.includes('lily'));
  check('the frog is drawn green, eyes on top', (() => { const c = document.createElement('canvas'); drawPet(c.getContext('2d'), { kind: 'frog', color: 'lily', hat: '' }); const g = c.getContext('2d'); return g.getImageData(4, 9, 1, 1).data[1] === 0xc4 && g.getImageData(3, 8, 1, 1).data[3] === 255; })());
  check('the frog has its own growth names', petStage().name === 'Froglet');
  pet.kind = 'cat'; pet.color = 'ginger'; savePet();

  showView('clock');
  return JSON.stringify({ checks: count, failed: fails, pageErrors: errors }, null, 1);
})();

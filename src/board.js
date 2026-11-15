'use strict';
// Boards in Notes: a big free canvas, like an easel or whiteboard, for dumping things while you
// research. Paste or drop screenshots, links, PDFs and text anywhere; drag cards around, resize
// them, colour the sticky notes. A board is a note with n.board = { items: [...] }, so folders,
// pinning, search, Recently Deleted and backups all work the same.
//
// Items: { id, t: 'text' | 'img' | 'link' | 'file', x, y, w, h?, text?, src?, url?, title?, file?, name?, size?, color? }

const BOARD_COLORS = ['#fff3a3', '#ffd3e0', '#c9f2d0', '#cfe6ff', '#e4d9ff', '#ffffff'];
const BOARD_MIN = { w: 2400, h: 1600 };
const board = { note: null, saveT: null, drag: null };
const boardItems = () => (board.note && board.note.board ? board.note.board.items : []);
const boardEl = () => $('#board');
const readOnly = () => !board.note || !!board.note.deleted;
const isUrl = (s) => /^https?:\/\/[^\s]+\.[^\s]+$/i.test(String(s || '').trim());
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const bid = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- saving
function boardChanged() {
  const n = board.note; if (!n) return;
  n.updated = Date.now();
  $('#note-saved').textContent = 'Saving…';
  clearTimeout(board.saveT);
  board.saveT = setTimeout(boardCommit, 300);
}
function boardCommit() {
  clearTimeout(board.saveT); board.saveT = null;
  if (!board.note) return;
  saveNotes();
  $('#note-saved').textContent = 'Saved';
  renderNotesList(); renderNoteBar();
}

// ---------- open / close (called from openNote)
function showBoard(n) {
  if (board.saveT) boardCommit();
  board.note = n && n.board ? n : null;
  $('#note-page').classList.toggle('boardmode', !!board.note);
  boardEl().hidden = !board.note;
  if (board.note) { boardEl().scrollTo(0, 0); renderBoard(); }
}

// ---------- drawing
function boardSize() {
  let w = BOARD_MIN.w, ht = BOARD_MIN.h;
  for (const it of boardItems()) { w = Math.max(w, it.x + (it.w || 240) + 800); ht = Math.max(ht, it.y + (it.h || 200) + 600); }
  return { w, h: ht };
}
function renderBoard() {
  const sheet = $('#board-sheet'), { w, h: ht } = boardSize();
  sheet.style.width = w + 'px'; sheet.style.height = ht + 'px';
  sheet.replaceChildren(...boardItems().map(itemEl));
  boardEl().classList.toggle('ro', readOnly());
  $('#board-empty').hidden = boardItems().length > 0;
  $('#board-tools').hidden = readOnly();
}

function itemEl(it) {
  const el = h('div', { class: `bi bi-${it.t}`, 'data-id': it.id });
  el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; el.style.width = it.w + 'px';
  if (it.h && it.t === 'text') el.style.height = it.h + 'px';
  if (it.t === 'text') {
    el.style.setProperty('--note', it.color || BOARD_COLORS[0]);
    const ta = h('textarea', { spellcheck: 'true', placeholder: 'Write anything…', 'aria-label': 'Sticky note' });
    ta.value = it.text || '';
    ta.readOnly = readOnly();
    ta.addEventListener('input', () => { it.text = ta.value.slice(0, 20000); boardChanged(); });
    el.append(ta);
  } else if (it.t === 'img') {
    el.append(h('img', { src: NOTE_IMG.test(it.src) ? it.src : '', alt: '', draggable: 'false' }));
  } else if (it.t === 'link') {
    el.append(h('div', { class: 'bl' }, h('span', { class: 'bl-ic' }, '🔗'),
      h('div', {}, h('b', {}, it.title || hostOf(it.url)), h('small', {}, hostOf(it.url)))));
    el.title = it.url + '\nClick to open in your browser';
  } else if (it.t === 'file') {
    const ext = (/\.(\w+)$/.exec(it.file || '') || [])[1] || '';
    el.append(h('div', { class: 'bl' }, h('span', { class: 'bl-ic' }, ext === 'pdf' ? '📕' : '📄'),
      h('div', {}, h('b', {}, it.name || 'File'), h('small', {}, `${ext.toUpperCase()} · ${fmtSize(it.size || 0)}`))));
    el.title = 'Click to open';
  }
  if (!readOnly()) {
    el.append(h('div', { class: 'bi-grip', title: 'Drag to move' }),
      h('button', { class: 'bi-x', title: 'Remove', 'aria-label': 'Remove', onclick: (e) => { e.stopPropagation(); removeItem(it); } }, '✕'),
      h('span', { class: 'bi-size', title: 'Drag to resize' }));
    if (it.t === 'text') el.append(h('button', { class: 'bi-col', title: 'Change colour', 'aria-label': 'Change colour', onclick: (e) => {
      e.stopPropagation(); it.color = BOARD_COLORS[(BOARD_COLORS.indexOf(it.color || BOARD_COLORS[0]) + 1) % BOARD_COLORS.length];
      el.style.setProperty('--note', it.color); boardChanged();
    } }));
  }
  return el;
}
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

// ---------- adding
// Where new things go: the drop point, or the middle of what is on screen, nudged so a burst of
// pastes does not stack exactly on top of each other.
function boardPoint(e) {
  const b = boardEl(), r = b.getBoundingClientRect();
  if (e && e.clientX != null) return { x: Math.max(0, e.clientX - r.left + b.scrollLeft), y: Math.max(0, e.clientY - r.top + b.scrollTop) };
  const n = boardItems().length % 6;
  return { x: b.scrollLeft + r.width / 2 - 120 + n * 26, y: b.scrollTop + r.height / 2 - 90 + n * 26 };
}
function addItem(it, select = true) {
  if (readOnly()) return null;
  it.id = bid();
  it.x = Math.round(Math.max(0, it.x)); it.y = Math.round(Math.max(0, it.y));
  board.note.board.items.push(it);
  boardChanged(); renderBoard();
  if (select && it.t === 'text') { const ta = $(`#board-sheet [data-id="${it.id}"] textarea`); if (ta) ta.focus(); }
  return it;
}
function addText(at, text = '') { return addItem({ t: 'text', x: at.x, y: at.y, w: 220, h: 160, text, color: BOARD_COLORS[0] }); }
function addLink(at, url, title = '') { return addItem({ t: 'link', x: at.x, y: at.y, w: 260, url: url.trim(), title: title.trim().slice(0, 200) }); }
async function addFiles(files, at) {
  let i = 0;
  for (const f of files) {
    const p = { x: at.x + i * 30, y: at.y + i * 30 }; i++;
    try {
      if (/^image\/(png|jpe?g|gif|webp)$/.test(f.type)) {
        if (f.size > 25 * 1024 * 1024) { toast('That image is over 25 MB.'); continue; }
        const src = await call(api.notes.saveImage(new Uint8Array(await f.arrayBuffer()), f.type));
        const dim = await new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res([320, 200]); im.src = src; });
        addItem({ t: 'img', x: p.x, y: p.y, w: Math.max(80, Math.min(420, dim[0])), src }, false);
      } else {
        if (f.size > 50 * 1024 * 1024) { toast('That file is over 50 MB.'); continue; }
        const file = await call(api.notes.saveFile(new Uint8Array(await f.arrayBuffer()), f.name));
        addItem({ t: 'file', x: p.x, y: p.y, w: 240, file, name: f.name.slice(0, 120), size: f.size }, false);
      }
    } catch (err) { toast(`Could not add ${f.name || 'that'}: ${err.message}`); }
  }
}
function removeItem(it) {
  const items = board.note.board.items, at = items.indexOf(it);
  if (at < 0) return;
  items.splice(at, 1);
  boardChanged(); renderBoard();
  toast('Removed from the board', { label: 'Undo', fn: () => { items.splice(at, 0, it); boardChanged(); renderBoard(); } });
}
// Text from a paste or drop: a link card for a URL, otherwise a sticky note.
function addTextOrLink(text, at, title) {
  text = String(text || '').trim();
  if (!text) return;
  if (isUrl(text)) addLink(at, text, title);
  else addText(at, text.slice(0, 20000));
}

// ---------- opening things
function openItem(it) {
  if (it.t === 'link') { if (/^https:/i.test(it.url)) api.app.open(it.url); else toast('Only https links can be opened from Nightdesk.'); }
  else if (it.t === 'file') call(api.notes.openFile(it.file)).catch((err) => toast(err.message));
  else if (it.t === 'img') { const view = h('div', { class: 'img-view', onclick: () => view.remove() }, h('img', { src: it.src, alt: '' })); document.body.append(view); }
}

// ---------- as a new note
function newBoard() {
  commitNote();
  if (notes.folder === 'trash') { notes.folder = 'all'; store.set('noteFolder', 'all'); }
  const folder = notes.folder !== 'all' && folderOf(notes.folder) ? notes.folder : DEFAULT_FOLDER;
  const n = { id: 'n' + Date.now(), title: '', html: '', icon: '🧩', folder, created: Date.now(), updated: Date.now(), pinned: false, board: { items: [] } };
  notes.list.push(n);
  saveNotes(); renderFolders();
  openNote(n.id);
  $('#note-title').focus();
  return n;
}
function boardMarkdown(n) {
  const lines = [`# ${n.icon ? n.icon + ' ' : ''}${noteTitle(n)}`, ''];
  for (const it of [...n.board.items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (it.t === 'text') lines.push(it.text || '');
    else if (it.t === 'link') lines.push(`[${it.title || hostOf(it.url)}](${it.url})`);
    else if (it.t === 'img') lines.push(`![image](${it.src})`);
    else if (it.t === 'file') lines.push(`📄 ${it.name}`);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

// ---------- wiring
(function wireBoard() {
  const b = boardEl();
  // Moving and resizing cards; a click without moving opens a link, file or image.
  b.addEventListener('pointerdown', (e) => {
    if (readOnly() || e.button !== 0) return;
    const card = e.target.closest('.bi');
    if (!card) return;
    const it = boardItems().find((x) => x.id === card.dataset.id);
    if (!it || e.target.closest('.bi-x, .bi-col')) return;
    const resize = !!e.target.closest('.bi-size');
    if (e.target.tagName === 'TEXTAREA' && !resize) return; // typing, selecting text
    e.preventDefault();
    board.drag = { it, card, resize, sx: e.clientX, sy: e.clientY, x: it.x, y: it.y, w: card.offsetWidth, h: card.offsetHeight, moved: false };
    card.classList.add('moving');
    sheetFront(card, it);
    try { b.setPointerCapture(e.pointerId); } catch {}
  });
  b.addEventListener('pointermove', (e) => {
    const d = board.drag; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.resize) {
      d.it.w = Math.round(Math.max(120, Math.min(1600, d.w + dx)));
      d.card.style.width = d.it.w + 'px';
      if (d.it.t === 'text') { d.it.h = Math.round(Math.max(80, Math.min(1400, d.h + dy))); d.card.style.height = d.it.h + 'px'; }
    } else {
      d.it.x = Math.round(Math.max(0, d.x + dx)); d.it.y = Math.round(Math.max(0, d.y + dy));
      d.card.style.left = d.it.x + 'px'; d.card.style.top = d.it.y + 'px';
    }
  });
  const end = (open) => {
    const d = board.drag; board.drag = null;
    if (!d) return;
    d.card.classList.remove('moving');
    if (d.moved) { boardChanged(); const s = boardSize(), sh = $('#board-sheet'); sh.style.width = s.w + 'px'; sh.style.height = s.h + 'px'; }
    else if (open && d.it.t !== 'text') openItem(d.it);
    else if (d.it.t === 'text') { const ta = d.card.querySelector('textarea'); if (ta) ta.focus(); }
  };
  b.addEventListener('pointerup', () => end(true));
  b.addEventListener('pointercancel', () => end(false));
  // In read-only (Recently Deleted) a click still opens things.
  b.addEventListener('click', (e) => {
    if (!readOnly()) return;
    const card = e.target.closest('.bi'); const it = card && boardItems().find((x) => x.id === card.dataset.id);
    if (it && it.t !== 'text') openItem(it);
  });
  // Double-click empty space for a new sticky note.
  b.addEventListener('dblclick', (e) => { if (!readOnly() && !e.target.closest('.bi, #board-tools')) addText(boardPoint(e)); });

  // Paste: images, files, links and text, when the board has the focus (not while typing in a card).
  document.addEventListener('paste', (e) => {
    if (!board.note || settings.view !== 'notes' || readOnly() || !$('#modal').hidden) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.isContentEditable)) return;
    e.preventDefault();
    const files = [...e.clipboardData.files];
    if (files.length) return addFiles(files, boardPoint());
    addTextOrLink(e.clipboardData.getData('text/plain'), boardPoint());
  });
  // Drop: files from Explorer, images and links dragged from a browser, selected text.
  b.addEventListener('dragover', (e) => { if (!readOnly()) { e.preventDefault(); b.classList.add('drop'); } });
  b.addEventListener('dragleave', (e) => { if (!b.contains(e.relatedTarget)) b.classList.remove('drop'); });
  b.addEventListener('drop', (e) => {
    b.classList.remove('drop');
    if (readOnly()) return;
    e.preventDefault();
    const at = boardPoint(e), dt = e.dataTransfer;
    const files = [...dt.files];
    if (files.length) return addFiles(files, at);
    const uri = (dt.getData('text/uri-list') || '').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
    const html = dt.getData('text/html');
    const title = html ? (new DOMParser().parseFromString(html, 'text/html').body.textContent || '').trim() : '';
    if (uri && isUrl(uri)) return addLink(at, uri, title && !isUrl(title) ? title : '');
    addTextOrLink(dt.getData('text/plain'), at);
  });

  $('#board-text').addEventListener('click', () => addText(boardPoint()));
  $('#board-link').addEventListener('click', () => {
    const url = prompt('Link to (https://…)', 'https://');
    if (url && isUrl(url)) addLink(boardPoint(), url); else if (url && url !== 'https://') toast('That does not look like a link.');
  });
  $('#board-file').addEventListener('click', () => $('#board-pick').click());
  $('#board-pick').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) addFiles(f, boardPoint()); });
  $('#notes-board').addEventListener('click', newBoard);
  addEventListener('beforeunload', () => { if (board.saveT) boardCommit(); });
})();
// Dev only: example board and pet for screenshots (screenshot mode, throwaway profile).
if (window.__shot) {
  const baseShot = window.__shot;
  window.__shot = (step) => {
    const parts = step.split(':');
    const mine = parts.filter((p) => /^(boarddemo|petneed|petmine|petfrog)$/.test(p));
    baseShot(parts.filter((p) => !mine.includes(p)).join(':') || (mine.includes('boarddemo') ? 'notes' : 'pet'));
    for (const p of mine) friendShot(p);
  };
}
async function friendShot(p) {
  const png = async (w, ht, paint) => { const c = document.createElement('canvas'); c.width = w; c.height = ht; paint(c.getContext('2d')); return new File([await new Promise((r) => c.toBlob(r, 'image/png'))], 'x.png', { type: 'image/png' }); };
  if (p === 'boarddemo') {
    const n = newBoard();
    n.title = 'Zebra project research'; $('#note-title').value = n.title;
    const shot = await png(520, 300, (g) => { const gr = g.createLinearGradient(0, 0, 520, 300); gr.addColorStop(0, '#5b9dff'); gr.addColorStop(1, '#9b87f5'); g.fillStyle = gr; g.fillRect(0, 0, 520, 300);
      g.fillStyle = '#fff'; g.font = 'bold 34px Segoe UI'; g.fillText('Stripes = heat control?', 30, 70); g.font = '20px Segoe UI'; ['Black stripes ~ 12°C warmer', 'Air currents form above them', 'Flies avoid striped hides'].forEach((t, i) => g.fillText('• ' + t, 30, 130 + i * 38)); });
    await addFiles([shot], { x: 40, y: 80 });
    n.board.items[0].w = 360;
    addItem({ t: 'text', x: 430, y: 80, w: 230, h: 170, text: 'Questions\n– do stripes really keep flies off?\n– compare with horses in the same field\n– ask Dr. Rao for the 2019 paper', color: BOARD_COLORS[0] }, false);
    addItem({ t: 'link', x: 430, y: 280, w: 260, url: 'https://en.wikipedia.org/wiki/Zebra', title: 'Zebra – Wikipedia' }, false);
    addItem({ t: 'link', x: 700, y: 120, w: 250, url: 'https://www.nature.com/articles/s41598-019-40149-7', title: 'Stripes and biting flies (2019)' }, false);
    addItem({ t: 'file', x: 40, y: 330, w: 260, file: 'a'.repeat(40) + '.pdf', name: 'Lecture 7 – camouflage.pdf', size: 2400000 }, false);
    addItem({ t: 'text', x: 700, y: 210, w: 210, h: 120, text: 'Draft due Friday!', color: BOARD_COLORS[1] }, false);
    addItem({ t: 'text', x: 320, y: 360, w: 200, h: 110, text: 'Photo ideas: Nairobi trip, March', color: BOARD_COLORS[2] }, false);
    boardCommit(); renderBoard();
  } else {
    pet.desktop = false; pet.roam = false; pet.pos = { x: 420, y: 16 };
    if (p === 'petmine') {
      pet.custom = await petSpriteFrom(await png(160, 180, (g) => {
        g.fillStyle = '#fff'; g.fillRect(0, 0, 160, 180);
        g.fillStyle = '#7a4a2a'; g.beginPath(); g.ellipse(80, 110, 60, 62, 0, 0, 7); g.fill(); // a brown bear-ish face
        g.beginPath(); g.arc(32, 52, 22, 0, 7); g.arc(128, 52, 22, 0, 7); g.fill();
        g.fillStyle = '#e8c39e'; g.beginPath(); g.ellipse(80, 130, 30, 22, 0, 0, 7); g.fill();
        g.fillStyle = '#1b1b1b'; g.beginPath(); g.arc(58, 95, 8, 0, 7); g.arc(102, 95, 8, 0, 7); g.fill(); g.beginPath(); g.ellipse(80, 122, 10, 7, 0, 0, 7); g.fill();
      }));
      pet.kind = 'custom'; pet.hat = 'party'; buddy.tab = 'kind';
    }
    if (p === 'petfrog') { pet.kind = 'frog'; pet.color = 'lily'; pet.hat = ''; buddy.tab = 'kind'; }
    pet.hunger = 18; pet.energy = 70; pet.joy = 70; pet.last = Date.now(); pet.saidNeed = {};
    study.subjects = [{ id: 'os', name: 'OS', color: '#5b9dff', goal: 60, exam: ymd(addDays(new Date(), 5)), chapters: [{ id: 'c1', name: 'Paging', hours: 2, done: true }, { id: 'c2', name: 'CPU scheduling', hours: 2, done: false }] }];
    pet.day = {}; ensureDay();
    savePet(); renderPetView(); buddyTick();
  }
}
// The card being touched comes to the front (and stays there: it is moved to the end of the list).
function sheetFront(card, it) {
  const items = board.note.board.items, i = items.indexOf(it);
  if (i >= 0 && i !== items.length - 1) { items.splice(i, 1); items.push(it); card.parentNode.append(card); }
}

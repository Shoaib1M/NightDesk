'use strict';
// Notes: folders and lists like iOS Notes, pages like Notion.
//
// - Folders column: All Notes, your folders (create, rename by double-click, delete, drop notes on
//   them to move), and Recently Deleted (restore or delete forever).
// - Notes column: pinned first, then grouped by Today / Yesterday / Previous 7 Days / ..., each
//   with a preview line and a thumbnail of its first image.
// - Page: emoji icon, big title, and a block editor: type "/" for blocks, markdown shortcuts at the
//   start of a line, a ⋮⋮ handle to drag blocks and a + to add one, images pasted or dropped in
//   (stored as files and shown through ndimg://), autosave.

const DEFAULT_FOLDER = 'f-notes';
const notes = {
  list: store.get('notes', []),
  folders: store.get('noteFolders', []),
  folder: store.get('noteFolder', 'all'), // 'all' | 'trash' | a folder id
  cur: null, saveT: null, q: '', slash: null, dragBlock: null, phBlock: null,
};
if (!notes.folders.some((f) => f.id === DEFAULT_FOLDER)) notes.folders.unshift({ id: DEFAULT_FOLDER, name: 'Notes' });
for (const n of notes.list) if (!n.folder) n.folder = DEFAULT_FOLDER;
if (notes.folder !== 'all' && notes.folder !== 'trash' && !notes.folders.some((f) => f.id === notes.folder)) notes.folder = 'all';

const NOTE_IMG = /^ndimg:\/\/img\/[a-f0-9]{40}\.(png|jpe?g|gif|webp)$/;
const NOTE_ICONS = ['📄', '📝', '📚', '💡', '✅', '📌', '🎯', '🧠', '💻', '🔥', '⭐', '📅', '🧪', '📐', '🎓', '💼', '🏃', '🍎', '🎵', '✈️', '🗂️', '🔒', '❤️', '🌙'];
const CALLOUT_ICONS = ['💡', '⚠️', '📌', '✅', '❗', '🔥', '💬', 'ℹ️'];

// ---------- sanitising: only simple formatting and our own blocks survive, from pastes and saved pages
const KEEP = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'CODE', 'PRE', 'A', 'IMG', 'SPAN', 'INPUT', 'HR', 'DETAILS', 'SUMMARY', 'MARK', 'STRIKE']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'BUTTON', 'TEXTAREA', 'SELECT']);
const CLASSES = new Set(['todo', 'callout', 'ci', 'ct', 'toggle']);
function cleanNode(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) continue;
    if (child.nodeType !== 1) { child.remove(); continue; }
    const tag = child.tagName;
    if (DROP.has(tag)) { child.remove(); continue; }
    if (tag === 'INPUT' && child.getAttribute('type') !== 'checkbox') { child.remove(); continue; }
    if (tag === 'IMG' && !NOTE_IMG.test(child.getAttribute('src') || '')) { child.remove(); continue; }
    cleanNode(child);
    if (!KEEP.has(tag)) { child.replaceWith(...child.childNodes); continue; }
    for (const at of [...child.attributes]) {
      const n = at.name.toLowerCase();
      const ok = (tag === 'A' && n === 'href' && /^https?:\/\//i.test(at.value))
        || (tag === 'IMG' && n === 'src')
        || (tag === 'INPUT' && (n === 'type' || n === 'checked'))
        || (tag === 'DETAILS' && n === 'open')
        || (tag === 'SPAN' && n === 'contenteditable' && at.value === 'false')
        || (n === 'class' && CLASSES.has(at.value));
      if (!ok) child.removeAttribute(at.name);
    }
    if (tag === 'A') { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener'); }
  }
  return node;
}
function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return cleanNode(doc.body.firstChild).innerHTML;
}

// ---------- data helpers
const noteTitle = (n) => (n.title || '').trim() || 'Untitled';
// Plain text of a note, with a space between blocks so words on separate lines never run together.
const noteText = (n) => {
  const d = document.createElement('div');
  d.innerHTML = (n.html || '').replace(/<\/(p|div|h[1-3]|li|blockquote|pre|summary|details)>|<br\s*\/?>/gi, '$& ');
  return d.textContent.replace(/\s+/g, ' ');
};
const firstImage = (n) => { const m = /src="(ndimg:\/\/img\/[a-f0-9]{40}\.(?:png|jpe?g|gif|webp))"/.exec(n.html || ''); return m ? m[1] : ''; };
const folderOf = (id) => notes.folders.find((f) => f.id === id);
const folderName = (id) => (id === 'all' ? 'All Notes' : id === 'trash' ? 'Recently Deleted' : (folderOf(id) || { name: 'Notes' }).name);
function saveNotes() { store.set('notes', notes.list); }
function saveFolders() { store.set('noteFolders', notes.folders); }

function visibleNotes() {
  const q = notes.q.toLowerCase();
  return notes.list.filter((n) => {
    if (notes.folder === 'trash' ? !n.deleted : n.deleted) return false;
    if (notes.folder !== 'all' && notes.folder !== 'trash' && n.folder !== notes.folder) return false;
    return !q || noteTitle(n).toLowerCase().includes(q) || noteText(n).toLowerCase().includes(q);
  });
}

// ---------- folders column
function renderFolders() {
  const live = notes.list.filter((n) => !n.deleted);
  const row = (id, icon, name, count, extra = {}) => {
    const el = h('div', { class: 'nf-item' + (notes.folder === id ? ' on' : ''), 'data-id': id, onclick: () => showFolder(id) },
      h('span', { class: 'nf-ic' }, icon), h('span', { class: 'nf-name' }, name), h('span', { class: 'nf-count' }, count),
      extra.del && h('button', { class: 'nf-del', title: 'Delete folder', 'aria-label': `Delete folder ${name}`, onclick: (e) => { e.stopPropagation(); deleteFolder(id); } }, '✕'));
    if (extra.rename) el.querySelector('.nf-name').addEventListener('dblclick', (e) => { e.stopPropagation(); renameFolder(id, el); });
    if (extra.drop) {
      el.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('nd/note')) { e.preventDefault(); el.classList.add('drop'); } });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop'); moveNote(e.dataTransfer.getData('nd/note'), id); });
    }
    return el;
  };
  $('#nf-list').replaceChildren(
    row('all', '🗒️', 'All Notes', live.length),
    h('div', { class: 'nf-sec' }, 'Folders'),
    ...notes.folders.map((f) => row(f.id, f.icon || '📁', f.name, live.filter((n) => n.folder === f.id).length,
      { rename: true, drop: true, del: f.id !== DEFAULT_FOLDER })),
    h('div', { class: 'nf-sep' }),
    row('trash', '🗑️', 'Recently Deleted', notes.list.filter((n) => n.deleted).length));
}

function showFolder(id) {
  commitNote();
  notes.folder = id; store.set('noteFolder', id);
  notes.q = ''; $('#notes-search').value = '';
  const first = visibleNotes().sort(sortNotes)[0];
  renderFolders();
  openNote(notes.cur && visibleNotes().includes(notes.cur) ? notes.cur.id : first ? first.id : '');
}

function newFolder() {
  const f = { id: 'f' + Date.now(), name: 'New Folder' };
  notes.folders.push(f); saveFolders();
  notes.folder = f.id; store.set('noteFolder', f.id);
  renderFolders(); renderNotesList(); openNote('');
  const el = $(`#nf-list [data-id="${f.id}"]`);
  if (el) renameFolder(f.id, el);
  return f;
}
function renameFolder(id, el) {
  const f = folderOf(id); if (!f) return;
  const input = h('input', { class: 'nf-rename', maxlength: '40', spellcheck: 'false' });
  input.value = f.name;
  el.querySelector('.nf-name').replaceWith(input);
  input.focus(); input.select();
  const done = (keep) => { if (keep && input.value.trim()) f.name = input.value.trim(); saveFolders(); renderFolders(); renderNotesList(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  input.addEventListener('blur', () => done(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}
// Like iOS: deleting a folder moves its notes to Recently Deleted, where they can be restored.
function deleteFolder(id) {
  const f = folderOf(id); if (!f || id === DEFAULT_FOLDER) return;
  const inside = notes.list.filter((n) => !n.deleted && n.folder === id);
  if (!confirm(`Delete the folder "${f.name}"?${inside.length ? `\n\nIts ${inside.length} note${inside.length > 1 ? 's go' : ' goes'} to Recently Deleted, where you can restore ${inside.length > 1 ? 'them' : 'it'}.` : ''}`)) return;
  commitNote();
  for (const n of inside) n.deleted = Date.now();
  notes.folders = notes.folders.filter((x) => x.id !== id);
  saveNotes(); saveFolders();
  showFolder('all');
}
function moveNote(id, folderId) {
  const n = notes.list.find((x) => x.id === id);
  if (!n || !folderOf(folderId)) return;
  n.folder = folderId; n.deleted = undefined; n.updated = Date.now();
  saveNotes(); renderFolders(); renderNotesList();
  if (notes.cur === n) renderNoteBar();
  toast(`Moved to ${folderOf(folderId).name}`);
}

// ---------- notes column
const sortNotes = (a, b) => (!!b.pinned - !!a.pinned) || ((b.deleted || b.updated) - (a.deleted || a.updated));
function dayGroup(t) {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.floor((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 Days';
  if (days < 30) return 'Previous 30 Days';
  return d.toLocaleDateString('en', { month: 'long', year: 'numeric' });
}
function renderNotesList() {
  const shown = visibleNotes().sort(sortNotes);
  $('#ns-title').textContent = folderName(notes.folder);
  $('#ns-count').textContent = `${shown.length} note${shown.length === 1 ? '' : 's'}`;
  $('#notes-new').hidden = notes.folder === 'trash';
  $('#notes-empty-trash').hidden = notes.folder !== 'trash' || !shown.length;
  const out = [];
  let group = '';
  for (const n of shown) {
    const g = n.pinned && notes.folder !== 'trash' ? 'Pinned' : dayGroup(n.deleted || n.updated);
    if (g !== group) { group = g; out.push(h('div', { class: 'nl-sec' }, g)); }
    const t = new Date(n.deleted || n.updated);
    const when = dayGroup(t) === 'Today' ? fmtTime(t) : t.toLocaleDateString('en', { day: 'numeric', month: 'short' });
    const thumb = firstImage(n);
    const item = h('button', { class: 'note-item' + (notes.cur && notes.cur.id === n.id ? ' on' : ''), draggable: notes.folder !== 'trash' ? 'true' : 'false', onclick: () => openNote(n.id) },
      h('div', { class: 'ni-text' },
        h('b', {}, `${n.icon ? n.icon + ' ' : ''}${noteTitle(n)}`),
        h('span', {}, h('em', {}, when), ' ', noteText(n).trim().slice(0, 90) || (thumb ? 'Image' : 'No additional text')),
        notes.folder === 'all' && h('small', {}, `📁 ${folderName(n.folder)}`)),
      thumb && h('img', { class: 'ni-thumb', src: thumb, alt: '' }));
    item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('nd/note', n.id); e.dataTransfer.effectAllowed = 'move'; });
    out.push(item);
  }
  if (!shown.length) out.push(h('p', { class: 'empty' }, notes.folder === 'trash' ? 'Nothing deleted.' : notes.q ? 'No notes match.' : 'No notes yet. Press the pencil to start one.'));
  $('#notes-list').replaceChildren(...out);
}

// ---------- page
function renderNoteBar() {
  const n = notes.cur; if (!n) return;
  const inTrash = !!n.deleted;
  $('#note-crumbs').textContent = `${folderName(n.folder)}  /  ${noteTitle(n)}`;
  $('#note-meta').textContent = `Edited ${new Date(n.updated).toLocaleString('en', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` + (inTrash ? ' · in Recently Deleted' : '');
  for (const id of ['note-pin', 'note-del', 'note-move', 'note-more']) $('#' + id).hidden = inTrash;
  for (const id of ['note-restore', 'note-forever']) $('#' + id).hidden = !inTrash;
  $('#note-pin').textContent = n.pinned ? 'Unpin' : 'Pin';
  $('#note-move').replaceChildren(...notes.folders.map((f) => h('option', { value: f.id }, `Move to: ${f.name}`)));
  $('#note-move').value = n.folder;
  $('#note-icon').textContent = n.icon || '';
  $('#note-icon').classList.toggle('none', !n.icon);
  $('#note-add-icon').hidden = !!n.icon || inTrash;
  $('#note-body').contentEditable = String(!inTrash);
  $('#note-title').readOnly = inTrash;
}

function openNote(id) {
  commitNote();
  closeSlash(); hideHandle();
  notes.cur = notes.list.find((n) => n.id === id) || null;
  $('#note-page').hidden = !notes.cur;
  $('#note-none').hidden = !!notes.cur;
  for (const id of ['fmt-bar', 'icon-pop', 'more-pop']) { const el = $('#' + id); if (el) el.hidden = true; }
  if (notes.cur) {
    $('#note-scroll').scrollTop = 0; // every note opens at its top
    $('#note-title').value = notes.cur.title;
    $('#note-body').innerHTML = sanitize(notes.cur.html);
    normalizeBlocks();
    $('#note-saved').textContent = 'Saved';
    store.set('noteOpen', id);
    renderNoteBar();
  }
  renderNotesList();
}

function newNote() {
  commitNote();
  if (notes.folder === 'trash') { notes.folder = 'all'; store.set('noteFolder', 'all'); }
  const folder = notes.folder !== 'all' && folderOf(notes.folder) ? notes.folder : DEFAULT_FOLDER;
  const n = { id: 'n' + Date.now(), title: '', html: '', icon: '', folder, created: Date.now(), updated: Date.now(), pinned: false };
  notes.list.push(n);
  saveNotes(); renderFolders();
  openNote(n.id);
  $('#note-title').focus();
  return n;
}

// Saves the open page (debounced while typing; immediately when switching away).
function commitNote() {
  clearTimeout(notes.saveT);
  const n = notes.cur;
  if (!n || n.deleted) return;
  const body = $('#note-body');
  if (notes.phBlock) notes.phBlock.classList.remove('ph');
  const html = body.innerHTML, title = $('#note-title').value;
  if (notes.phBlock && document.activeElement === body) notes.phBlock.classList.add('ph');
  if (html.replace(/ class="ph"/g, '') === n.html && title === n.title) { $('#note-saved').textContent = 'Saved'; return; }
  n.html = html.replace(/ class="ph"/g, ''); n.title = title; n.updated = Date.now();
  saveNotes();
  $('#note-saved').textContent = 'Saved';
  renderNotesList(); renderNoteBar();
}
function noteChanged() {
  $('#note-saved').textContent = 'Saving…';
  clearTimeout(notes.saveT);
  notes.saveT = setTimeout(commitNote, 400);
}

function deleteNote() {
  const n = notes.cur; if (!n) return;
  commitNote();
  n.deleted = Date.now();
  saveNotes();
  const next = visibleNotes().sort(sortNotes)[0];
  notes.cur = null;
  renderFolders();
  openNote(next ? next.id : '');
  toast('Moved to Recently Deleted');
}
function restoreNote() {
  const n = notes.cur; if (!n) return;
  delete n.deleted;
  if (!folderOf(n.folder)) n.folder = DEFAULT_FOLDER;
  saveNotes(); renderFolders(); renderNotesList(); renderNoteBar();
  toast(`Restored to ${folderName(n.folder)}`);
}
function deleteForever(n = notes.cur) {
  if (!n || !confirm(`Delete "${noteTitle(n)}" forever? It stays only in older daily backups.`)) return;
  notes.list = notes.list.filter((x) => x !== n);
  notes.cur = null; saveNotes(); renderFolders();
  const next = visibleNotes().sort(sortNotes)[0];
  openNote(next ? next.id : '');
}

// ---------- images
async function addImages(files) {
  for (const f of files) {
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(f.type)) { toast('Only PNG, JPEG, GIF and WebP images can be added.'); continue; }
    if (f.size > 25 * 1024 * 1024) { toast('That image is over 25 MB.'); continue; }
    try {
      const url = await call(api.notes.saveImage(new Uint8Array(await f.arrayBuffer()), f.type));
      document.execCommand('insertHTML', false, `<img src="${url}"><br>`);
    } catch (err) { toast('Could not add the image: ' + err.message); }
  }
  noteChanged();
}

// ---------- blocks
const BODY = () => $('#note-body');
function topBlock(node) {
  const body = BODY();
  while (node && node.parentNode !== body) node = node.parentNode;
  return node && node.parentNode === body ? node : null;
}
function caretBlock() { const s = getSelection(); return s.rangeCount ? topBlock(s.anchorNode) : null; }
const blockType = (b) => (!b ? '' : b.classList.contains('todo') ? 'todo' : b.classList.contains('callout') ? 'callout' : b.tagName === 'DETAILS' ? 'toggle' : b.tagName.toLowerCase());
// Where the text of a block is typed.
function editTarget(b) {
  const t = blockType(b);
  if (t === 'callout') return b.querySelector('.ct') || b;
  if (t === 'toggle') return b.querySelector('summary') || b;
  if (t === 'ul' || t === 'ol') return b.querySelector('li:last-child') || b;
  return b;
}
function placeCaret(el, atEnd = true) {
  const r = document.createRange();
  if (el.classList && el.classList.contains('todo')) {
    const input = el.querySelector('input');
    r.setStartAfter(input); if (atEnd) r.setEnd(el, el.childNodes.length);
    r.collapse(!atEnd);
  } else { r.selectNodeContents(el); r.collapse(!atEnd); }
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  BODY().focus();
}
function innerOf(b) {
  const t = blockType(b);
  let src = b;
  if (t === 'callout') src = b.querySelector('.ct') || b;
  else if (t === 'toggle') src = b.querySelector('summary') || b;
  else if (t === 'ul' || t === 'ol') src = b.querySelector('li') || b;
  const c = src.cloneNode(true);
  c.querySelectorAll('input[type=checkbox]').forEach((x) => x.remove());
  const html = c.innerHTML.replace(/^(\s|&nbsp;|<br>)+$/, '');
  return c.textContent.trim() || c.querySelector('img') ? html : '';
}
function makeBlock(type, html = '') {
  const fill = html || '<br>';
  if (type === 'todo') { const d = h('div', { class: 'todo' }); d.innerHTML = `<input type="checkbox">${fill}`; return d; }
  if (type === 'ul' || type === 'ol') { const l = document.createElement(type); l.innerHTML = `<li>${fill}</li>`; return l; }
  if (type === 'toggle') { const d = document.createElement('details'); d.className = 'toggle'; d.open = true; d.innerHTML = `<summary>${html || 'Toggle'}</summary><p><br></p>`; return d; }
  if (type === 'callout') { const d = h('div', { class: 'callout' }); d.innerHTML = `<span class="ci" contenteditable="false">💡</span><div class="ct">${fill}</div>`; return d; }
  if (type === 'hr') return document.createElement('hr');
  const el = document.createElement(['p', 'h1', 'h2', 'h3', 'blockquote', 'pre'].includes(type) ? type : 'p');
  el.innerHTML = fill;
  return el;
}
// Turn a block into another kind, keeping its text (or add a divider below it).
function setBlockType(block, type) {
  if (!block) return null;
  if (type === 'hr') {
    const hr = makeBlock('hr');
    const empty = !innerOf(block);
    if (empty) block.replaceWith(hr); else block.after(hr);
    const p = makeBlock('p'); hr.after(p); placeCaret(p);
    noteChanged();
    return hr;
  }
  const el = makeBlock(type, innerOf(block));
  block.replaceWith(el);
  placeCaret(editTarget(el));
  noteChanged();
  return el;
}
// Keep the page a flat list of blocks: stray text and Chrome's <div> lines become paragraphs.
function normalizeBlocks() {
  const body = BODY();
  for (const node of [...body.childNodes]) {
    if (node.nodeType === 3) { if (!node.textContent.trim()) { if (!node.textContent) node.remove(); continue; } const p = document.createElement('p'); node.replaceWith(p); p.append(node); continue; }
    if (node.nodeType !== 1) continue;
    if (node.tagName === 'DIV' && !node.className) { const p = document.createElement('p'); p.append(...node.childNodes); node.replaceWith(p); }
    else if (['B', 'I', 'U', 'S', 'A', 'SPAN', 'STRONG', 'EM', 'CODE', 'IMG'].includes(node.tagName)) { const p = document.createElement('p'); node.replaceWith(p); p.append(node); }
  }
  if (!body.firstChild && body.isContentEditable) body.append(makeBlock('p'));
}

// ---------- "/" menu
const BLOCKS = [
  ['p', 'Text', 'Just start writing', '¶'], ['h1', 'Heading 1', 'Big section heading', 'H1'], ['h2', 'Heading 2', 'Medium section heading', 'H2'],
  ['h3', 'Heading 3', 'Small section heading', 'H3'], ['todo', 'To-do list', 'Track tasks with a checkbox', '☑'], ['ul', 'Bulleted list', 'A simple list', '•'],
  ['ol', 'Numbered list', 'A list with numbers', '1.'], ['toggle', 'Toggle', 'Hide details inside it', '▸'], ['blockquote', 'Quote', 'Capture a quote', '❝'],
  ['callout', 'Callout', 'Make a note stand out', '💡'], ['hr', 'Divider', 'Separate sections', '—'], ['pre', 'Code', 'A block of code', '</>'],
  ['image', 'Image', 'Upload an image (you can also paste or drop one)', '🖼'],
];
function slashMatches() {
  const s = notes.slash; if (!s) return [];
  const q = s.query.toLowerCase();
  return BLOCKS.filter(([id, name]) => !q || name.toLowerCase().includes(q) || id.startsWith(q));
}
function openSlash(node, offset) {
  notes.slash = { node, offset, query: '', sel: 0 };
  renderSlash();
}
function closeSlash() { notes.slash = null; const m = $('#slash'); if (m) m.hidden = true; }
function renderSlash() {
  const s = notes.slash, menu = $('#slash');
  const items = slashMatches();
  if (!s || !items.length) { if (s && s.query.length > 2) closeSlash(); else if (menu) menu.hidden = true; return; }
  s.sel = Math.max(0, Math.min(s.sel, items.length - 1));
  menu.replaceChildren(h('div', { class: 'sl-head' }, 'Basic blocks'), ...items.map(([id, name, desc, ic], i) => h('button', {
    class: 'sl-item' + (i === s.sel ? ' on' : ''), onmousedown: (e) => { e.preventDefault(); chooseSlash(id); },
  }, h('span', { class: 'sl-ic' }, ic), h('span', {}, h('b', {}, name), h('small', {}, desc)))));
  // place under the caret, inside the page
  const sel = getSelection(), page = $('#note-page').getBoundingClientRect();
  let r = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
  if (!r || (!r.width && !r.height && !r.top)) r = (s.node.parentElement || BODY()).getBoundingClientRect();
  menu.hidden = false;
  const top = Math.min(r.bottom - page.top + 6, page.height - menu.offsetHeight - 10);
  menu.style.top = Math.max(8, top) + 'px';
  menu.style.left = Math.max(8, Math.min(r.left - page.left, page.width - menu.offsetWidth - 10)) + 'px';
  const on = menu.querySelector('.sl-item.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function updateSlash() {
  const s = notes.slash; if (!s) return;
  const sel = getSelection();
  if (!sel.rangeCount || sel.anchorNode !== s.node || sel.anchorOffset <= s.offset || s.node.textContent[s.offset] !== '/') return closeSlash();
  s.query = s.node.textContent.slice(s.offset + 1, sel.anchorOffset);
  if (/\s/.test(s.query) || s.query.length > 20) return closeSlash();
  renderSlash();
}
function chooseSlash(type) {
  const s = notes.slash; if (!s) return;
  const sel = getSelection();
  const end = sel.anchorNode === s.node ? sel.anchorOffset : s.offset + 1 + s.query.length;
  s.node.textContent = s.node.textContent.slice(0, s.offset) + s.node.textContent.slice(end);
  const block = topBlock(s.node) || caretBlock();
  closeSlash();
  if (type === 'image') {
    if (block) placeCaret(editTarget(block));
    $('#note-file').click();
    return;
  }
  if (!block) return;
  if (!innerOf(block) && !['hr'].includes(type)) setBlockType(block, type);
  else if (type === 'hr') setBlockType(block, 'hr');
  else { const el = makeBlock(type); block.after(el); placeCaret(editTarget(el)); noteChanged(); }
}

// ---------- markdown shortcuts at the start of a line: "# ", "## ", "### ", "- ", "* ", "1. ", "[] ", "> ", "``` "
const SHORTCUTS = { '#': 'h1', '##': 'h2', '###': 'h3', '-': 'ul', '*': 'ul', '1.': 'ol', '[]': 'todo', '>': 'blockquote', '"': 'blockquote', '```': 'pre', '>>': 'toggle', '!': 'callout' };
function shortcut() {
  const sel = getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== 3 || !BODY().contains(node)) return false;
  const block = topBlock(node);
  if (!block || !['p', ''].includes(blockType(block)) && block !== node) return false;
  const before = node.textContent.slice(0, sel.anchorOffset).replace(/ /g, ' ');
  const m = /^(#{1,3}|-|\*|1\.|\[\]|>>|>|"|```|!)\s?$/.exec(before);
  if (!m || (node.previousSibling && node.previousSibling.nodeName !== 'BR')) return false;
  if (!/\s$/.test(before) && sel.anchorOffset !== node.textContent.length) return false;
  node.textContent = node.textContent.slice(sel.anchorOffset).replace(/^\s/, '');
  normalizeBlocks();
  setBlockType(topBlock(node) || block, SHORTCUTS[m[1]]);
  return true;
}

// ---------- block handle (+ and ⋮⋮) and drag to reorder
function hideHandle() { const hd = $('#blk-handle'); if (hd) hd.hidden = true; notes.handleBlock = null; }
function showHandle(block) {
  if (!block || !BODY().isContentEditable) return hideHandle();
  const hd = $('#blk-handle'), page = $('#note-page').getBoundingClientRect(), r = block.getBoundingClientRect();
  notes.handleBlock = block;
  hd.hidden = false;
  hd.style.top = (r.top - page.top + Math.min(4, r.height / 2 - 11)) + 'px';
  hd.style.left = (r.left - page.left - 52) + 'px';
}
function blockAtY(y) {
  let best = null, dist = Infinity;
  for (const b of BODY().children) {
    const r = b.getBoundingClientRect();
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (d < dist) { dist = d; best = b; }
  }
  return best;
}

// ---------- placeholder on the empty line being edited
function markEmptyLine() {
  if (notes.phBlock) notes.phBlock.classList.remove('ph');
  notes.phBlock = null;
  const b = caretBlock();
  if (b && b.tagName === 'P' && !b.textContent && !b.querySelector('img') && document.activeElement === BODY()) { b.classList.add('ph'); notes.phBlock = b; }
}

// ---------- wiring
(function wireNotes() {
  const body = BODY();
  document.execCommand('defaultParagraphSeparator', false, 'p');
  $('#notes-new').addEventListener('click', newNote);
  $('#nf-new').addEventListener('click', newFolder);
  $('#notes-search').addEventListener('input', (e) => { notes.q = e.target.value; renderNotesList(); });
  $('#notes-empty-trash').addEventListener('click', () => {
    const gone = notes.list.filter((n) => n.deleted);
    if (!gone.length || !confirm(`Delete ${gone.length} note${gone.length > 1 ? 's' : ''} forever? They stay only in older daily backups.`)) return;
    notes.list = notes.list.filter((n) => !n.deleted); notes.cur = null; saveNotes(); renderFolders(); openNote('');
  });
  $('#note-title').addEventListener('input', noteChanged);
  $('#note-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (e.key === 'ArrowDown')) { e.preventDefault(); normalizeBlocks(); const f = body.firstElementChild; if (f) placeCaret(editTarget(f), false); else body.focus(); }
  });

  // icon picker
  const pickIcon = (e) => {
    if (!notes.cur || notes.cur.deleted) return;
    const pop = $('#icon-pop');
    const setIcon = (ic) => { pop.hidden = true; commitNote(); notes.cur.icon = ic; notes.cur.updated = Date.now(); saveNotes(); renderNoteBar(); renderNotesList(); };
    pop.replaceChildren(...NOTE_ICONS.map((ic) => h('button', { onclick: () => setIcon(ic) }, ic)),
      h('button', { class: 'ip-none', onclick: () => setIcon('') }, 'Remove'));
    const page = $('#note-page').getBoundingClientRect(), r = e.currentTarget.getBoundingClientRect();
    pop.style.top = (r.bottom - page.top + 6) + 'px'; pop.style.left = (r.left - page.left) + 'px';
    pop.hidden = false;
  };
  $('#note-icon').addEventListener('click', pickIcon);
  $('#note-add-icon').addEventListener('click', pickIcon);
  addEventListener('mousedown', (e) => { if (!e.target.closest('#icon-pop, #note-icon, #note-add-icon')) $('#icon-pop').hidden = true; });

  body.addEventListener('input', (e) => {
    normalizeBlocks();
    if (e.inputType === 'insertText' && e.data === '/') {
      const s = getSelection();
      if (s.anchorNode && s.anchorNode.nodeType === 3) openSlash(s.anchorNode, s.anchorOffset - 1);
    } else if (notes.slash) updateSlash();
    if (e.inputType === 'insertText' && e.data === ' ') shortcut();
    if (e.inputType === 'insertText' && e.data && e.data.endsWith('-')) {
      const b = caretBlock();
      if (b && b.tagName === 'P' && b.textContent === '---') setBlockType(b, 'hr');
    }
    markEmptyLine();
    noteChanged();
  });
  document.addEventListener('selectionchange', () => { if (document.activeElement === body) { markEmptyLine(); if (notes.slash) updateSlash(); } });
  body.addEventListener('blur', () => { if (notes.phBlock) notes.phBlock.classList.remove('ph'); setTimeout(closeSlash, 150); });

  body.addEventListener('keydown', (e) => {
    // "/" menu keys
    if (notes.slash && !$('#slash').hidden) {
      const items = slashMatches();
      if (e.key === 'ArrowDown') { e.preventDefault(); notes.slash.sel = (notes.slash.sel + 1) % items.length; renderSlash(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); notes.slash.sel = (notes.slash.sel - 1 + items.length) % items.length; renderSlash(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); chooseSlash(items[notes.slash.sel][0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
    }
    const block = caretBlock(), type = blockType(block);
    if (e.key === 'Enter' && !e.shiftKey && block) {
      if (type === 'pre') { e.preventDefault(); document.execCommand('insertText', false, '\n'); return; }
      if (type === 'todo') {
        e.preventDefault();
        if (!innerOf(block)) setBlockType(block, 'p');
        else { const t = makeBlock('todo'); block.after(t); placeCaret(t); noteChanged(); }
        return;
      }
      if (['h1', 'h2', 'h3', 'blockquote', 'callout', 'hr'].includes(type)) {
        e.preventDefault();
        const p = makeBlock('p'); block.after(p); placeCaret(p); noteChanged();
        return;
      }
      const an = getSelection().anchorNode;
      const inSummary = type === 'toggle' && an && (an.nodeType === 1 ? an : an.parentElement).closest('summary');
      if (inSummary) {
        e.preventDefault();
        block.open = true;
        let p = block.querySelector('summary + *');
        if (!p) { p = makeBlock('p'); block.append(p); }
        placeCaret(p, false);
        return;
      }
    }
    // Backspace at the start of an empty special block turns it back into text
    if (e.key === 'Backspace' && block && type !== 'p' && !innerOf(block) && getSelection().isCollapsed) {
      e.preventDefault();
      if (type === 'hr') { const prev = block.previousElementSibling; block.remove(); if (prev) placeCaret(editTarget(prev)); noteChanged(); return; }
      setBlockType(block, 'p');
    }
  });

  body.addEventListener('paste', (e) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (files.length) return addImages(files);
    const html = e.clipboardData.getData('text/html');
    if (html) document.execCommand('insertHTML', false, sanitize(html));
    else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    normalizeBlocks();
    noteChanged();
  });

  // dropping image files, or a block dragged by its ⋮⋮ handle
  const dropLine = () => $('#blk-drop');
  body.addEventListener('dragover', (e) => {
    const types = [...e.dataTransfer.types];
    if (types.includes('nd/block') && notes.dragBlock) {
      e.preventDefault();
      const b = blockAtY(e.clientY); if (!b) return;
      const r = b.getBoundingClientRect(), page = $('#note-page').getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      notes.dropAt = { b, after };
      const line = dropLine(); line.hidden = false;
      line.style.top = ((after ? r.bottom : r.top) - page.top - 1) + 'px';
      line.style.left = (r.left - page.left) + 'px'; line.style.width = r.width + 'px';
    } else if (types.includes('Files')) e.preventDefault();
  });
  body.addEventListener('dragleave', (e) => { if (!body.contains(e.relatedTarget)) dropLine().hidden = true; });
  body.addEventListener('drop', (e) => {
    if ([...e.dataTransfer.types].includes('nd/block') && notes.dragBlock) {
      e.preventDefault();
      dropLine().hidden = true;
      const at = notes.dropAt, moving = notes.dragBlock;
      notes.dragBlock = null;
      if (at && at.b !== moving) { if (at.after) at.b.after(moving); else at.b.before(moving); noteChanged(); }
      return;
    }
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (pos) { const s = getSelection(); s.removeAllRanges(); s.addRange(pos); }
    addImages(files);
  });

  // the handle follows the block under the mouse
  $('#note-scroll').addEventListener('mousemove', (e) => {
    if (notes.dragBlock) return;
    const b = blockAtY(e.clientY);
    if (b && e.clientX > b.getBoundingClientRect().left - 70) showHandle(b); else hideHandle();
  });
  $('#note-page').addEventListener('mouseleave', (e) => { if (!e.relatedTarget || !e.relatedTarget.closest('#blk-handle')) hideHandle(); });
  $('#bh-add').addEventListener('click', () => {
    const b = notes.handleBlock; if (!b) return;
    const p = makeBlock('p'); p.textContent = '/'; b.after(p);
    const r = document.createRange(); r.setStart(p.firstChild, 1); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); body.focus();
    openSlash(p.firstChild, 0);
  });
  const drag = $('#bh-drag');
  drag.addEventListener('dragstart', (e) => {
    notes.dragBlock = notes.handleBlock;
    if (!notes.dragBlock) { e.preventDefault(); return; }
    e.dataTransfer.setData('nd/block', '1'); e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setDragImage(notes.dragBlock, 0, 0); } catch {}
    notes.dragBlock.classList.add('dragging');
  });
  drag.addEventListener('dragend', () => { if (notes.dragBlock) notes.dragBlock.classList.remove('dragging'); body.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging')); notes.dragBlock = null; dropLine().hidden = true; });

  $('#note-file').addEventListener('change', (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) addImages(files); });

  // checkboxes keep their state; links open in the browser; images open large; callout icon cycles
  body.addEventListener('click', (e) => {
    const t = e.target;
    if (t.matches('input[type=checkbox]')) { t.toggleAttribute('checked', t.checked); noteChanged(); }
    else if (t.matches('a[href]') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); api.app.open(t.href); }
    else if (t.matches('.callout .ci') && body.isContentEditable) { t.textContent = CALLOUT_ICONS[(CALLOUT_ICONS.indexOf(t.textContent) + 1) % CALLOUT_ICONS.length]; noteChanged(); }
  });
  body.addEventListener('toggle', (e) => { if (e.target.matches('details')) noteChanged(); }, true);
  body.addEventListener('dblclick', (e) => {
    if (!e.target.matches('img')) return;
    const view = h('div', { class: 'img-view', onclick: () => view.remove() }, h('img', { src: e.target.src, alt: '' }));
    document.body.append(view);
  });

  $('#note-pin').addEventListener('click', () => { if (!notes.cur) return; notes.cur.pinned = !notes.cur.pinned; notes.cur.updated = Date.now(); saveNotes(); renderNotesList(); renderNoteBar(); });
  $('#note-del').addEventListener('click', deleteNote);
  $('#note-restore').addEventListener('click', restoreNote);
  $('#note-forever').addEventListener('click', () => deleteForever());
  $('#note-move').addEventListener('change', (e) => { if (notes.cur) moveNote(notes.cur.id, e.target.value); });
  addEventListener('beforeunload', commitNote);
  on('view', (v) => {
    if (v === 'notes') {
      renderFolders();
      if (!notes.cur) { const keep = notes.list.find((n) => n.id === store.get('noteOpen', '')); openNote(keep && visibleNotes().includes(keep) ? keep.id : (visibleNotes().sort(sortNotes)[0] || {}).id || ''); }
      renderNotesList();
    } else commitNote();
  });
  // save the tidied-up folder data (default folder, notes without a folder) once
  saveFolders(); saveNotes();
})();

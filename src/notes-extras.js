'use strict';
// Notes extras: tags, checklist progress, word count, a formatting bar on selected text,
// duplicate, copy as Markdown, and keyboard shortcuts. Loaded after notes.js; it wraps a few of
// its functions (they are global function bindings, so reassigning them here is picked up there).

// ---------- tags: "#exam" anywhere in a note
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_-]{1,29})/gu;
function noteTags(n) {
  const out = new Set();
  for (const m of noteText(n).matchAll(TAG_RE)) out.add(m[2].toLowerCase());
  return [...out];
}
function allTags() {
  const count = new Map();
  for (const n of notes.list) if (!n.deleted) for (const t of noteTags(n)) count.set(t, (count.get(t) || 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function renderTags() {
  const box = $('#nf-tags');
  const tags = allTags();
  box.hidden = !tags.length;
  box.replaceChildren(h('div', { class: 'nf-sec' }, 'Tags'), h('div', { class: 'nf-tagwrap' }, tags.map(([t, c]) => h('button', {
    class: 'nf-tag' + (notes.tag === t ? ' on' : ''), title: `${c} note${c > 1 ? 's' : ''}`,
    onclick: () => {
      notes.tag = notes.tag === t ? '' : t;
      if (notes.tag && notes.folder === 'trash') { notes.folder = 'all'; store.set('noteFolder', 'all'); }
      renderFolders(); renderNotesList();
    },
  }, '#' + t))));
}

// ---------- checklist progress and word count
function noteStats(n) {
  const d = document.createElement('div'); d.innerHTML = n.html || '';
  const boxes = d.querySelectorAll('.todo input[type=checkbox]');
  const done = [...boxes].filter((b) => b.hasAttribute('checked')).length;
  const words = (d.textContent.match(/[\p{L}\p{N}']+/gu) || []).length;
  return { todos: boxes.length, done, words, minutes: Math.max(1, Math.round(words / 220)) };
}

// ---------- wrap notes.js functions
notes.tag = '';
{
  const baseVisible = visibleNotes;
  visibleNotes = function () { return baseVisible().filter((n) => !notes.tag || noteTags(n).includes(notes.tag)); };
  const baseFolders = renderFolders;
  renderFolders = function () { baseFolders(); renderTags(); };
  const baseShow = showFolder;
  showFolder = function (id) { notes.tag = ''; baseShow(id); };
  const baseList = renderNotesList;
  renderNotesList = function () {
    baseList();
    if (notes.tag) $('#ns-title').textContent = `#${notes.tag}`;
    // "☑ 3/5 done" on rows that have a checklist (rows come in the same order as the sorted list)
    const shown = visibleNotes().sort(sortNotes);
    $$('#notes-list .note-item').forEach((row, i) => {
      const n = shown[i]; if (!n) return;
      row.dataset.id = n.id;
      const st = noteStats(n);
      if (st.todos) row.querySelector('.ni-text').append(h('small', { class: 'ni-todo' + (st.done === st.todos ? ' all' : '') }, `☑ ${st.done}/${st.todos} done`));
    });
  };
  const baseBar = renderNoteBar;
  renderNoteBar = function () {
    baseBar();
    const n = notes.cur; if (!n) return;
    const st = noteStats(n);
    $('#note-meta').textContent += ` · ${st.words} word${st.words === 1 ? '' : 's'} · ${st.minutes} min read` + (st.todos ? ` · ${st.done}/${st.todos} done` : '');
  };
}

// ---------- formatting bar on selected text
function wrapSelection(tag) {
  const s = getSelection(); if (!s.rangeCount || s.isCollapsed) return;
  const r = s.getRangeAt(0);
  const el = document.createElement(tag);
  try { r.surroundContents(el); } catch { el.append(r.extractContents()); r.insertNode(el); }
  s.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(el); s.addRange(nr);
  noteChanged();
}
function addLink() {
  const s = getSelection(); if (!s.rangeCount || s.isCollapsed) return;
  const range = s.getRangeAt(0).cloneRange();
  const url = prompt('Link to (https://…)', 'https://');
  if (!url || !/^https?:\/\/\S+\.\S+/i.test(url)) return;
  s.removeAllRanges(); s.addRange(range);
  document.execCommand('createLink', false, url);
  BODY().querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
  noteChanged();
}
const FMT = [
  ['B', 'Bold (Ctrl+B)', () => document.execCommand('bold')],
  ['I', 'Italic (Ctrl+I)', () => document.execCommand('italic')],
  ['U', 'Underline (Ctrl+U)', () => document.execCommand('underline')],
  ['S', 'Strikethrough (Ctrl+Shift+X)', () => document.execCommand('strikeThrough')],
  ['</>', 'Inline code (Ctrl+E)', () => wrapSelection('code')],
  ['✎', 'Highlight (Ctrl+Shift+H)', () => wrapSelection('mark')],
  ['🔗', 'Link (Ctrl+K)', addLink],
];
function showFmtBar() {
  const bar = $('#fmt-bar'), s = getSelection(), body = BODY();
  if (!s.rangeCount || s.isCollapsed || !body.contains(s.anchorNode) || !body.isContentEditable || notes.slash) { bar.hidden = true; return; }
  const r = s.getRangeAt(0).getBoundingClientRect(), page = $('#note-page').getBoundingClientRect();
  const view = $('#note-scroll').getBoundingClientRect();
  // hide while the selection is scrolled out of sight, instead of pinning to a corner
  if (!r.width || r.bottom < view.top || r.top > view.bottom) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.style.top = Math.max(6, r.top - page.top - bar.offsetHeight - 8) + 'px';
  bar.style.left = Math.max(6, Math.min(r.left - page.left + r.width / 2 - bar.offsetWidth / 2, page.width - bar.offsetWidth - 6)) + 'px';
}

// ---------- duplicate and copy as Markdown
function duplicateNote() {
  const n = notes.cur; if (!n || n.deleted) return null;
  commitNote();
  const copy = { ...n, id: 'n' + Date.now(), title: `${noteTitle(n)} copy`, created: Date.now(), updated: Date.now(), pinned: false };
  notes.list.push(copy); saveNotes(); renderFolders(); openNote(copy.id);
  toast('Duplicated');
  return copy;
}
function toMarkdown(n) {
  const d = document.createElement('div'); d.innerHTML = n.html || '';
  const inline = (el) => [...el.childNodes].map((c) => {
    if (c.nodeType === 3) return c.textContent;
    if (c.nodeType !== 1) return '';
    const t = inline(c);
    switch (c.tagName) {
      case 'B': case 'STRONG': return `**${t}**`;
      case 'I': case 'EM': return `*${t}*`;
      case 'S': case 'STRIKE': return `~~${t}~~`;
      case 'CODE': return '`' + t + '`';
      case 'MARK': return `==${t}==`;
      case 'A': return `[${t}](${c.getAttribute('href')})`;
      case 'IMG': return `![image](${c.getAttribute('src')})`;
      case 'BR': return '\n';
      case 'INPUT': return '';
      default: return t;
    }
  }).join('');
  const lines = [`# ${n.icon ? n.icon + ' ' : ''}${noteTitle(n)}`, ''];
  for (const b of d.children) {
    const t = blockType(b);
    if (t === 'h1' || t === 'h2' || t === 'h3') lines.push('#'.repeat(+t[1] + 1) + ' ' + inline(b).trim());
    else if (t === 'ul' || t === 'ol') [...b.children].forEach((li, i) => lines.push(`${t === 'ol' ? `${i + 1}.` : '-'} ${inline(li).trim()}`));
    else if (t === 'todo') lines.push(`- [${b.querySelector('input[checked]') ? 'x' : ' '}] ${inline(b).trim()}`);
    else if (t === 'blockquote') lines.push('> ' + inline(b).trim());
    else if (t === 'callout') lines.push(`> ${(b.querySelector('.ci') || {}).textContent || '💡'} ${inline(b.querySelector('.ct') || b).trim()}`);
    else if (t === 'toggle') {
      lines.push(`<details><summary>${inline(b.querySelector('summary') || b).trim()}</summary>`, '');
      [...b.children].filter((c) => c.tagName !== 'SUMMARY').forEach((c) => lines.push(inline(c).trim()));
      lines.push('</details>');
    } else if (t === 'pre') lines.push('```', b.textContent, '```');
    else if (t === 'hr') lines.push('---');
    else lines.push(inline(b).trim());
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
async function copyMarkdown() {
  if (!notes.cur) return '';
  commitNote();
  const md = toMarkdown(notes.cur);
  try { await navigator.clipboard.writeText(md); toast('Copied as Markdown'); } catch { toast('Could not copy to the clipboard.'); }
  return md;
}

(function wireExtras() {
  const body = BODY();
  const bar = $('#fmt-bar');
  bar.replaceChildren(...FMT.map(([label, title, fn]) => h('button', {
    title, 'aria-label': title, onmousedown: (e) => { e.preventDefault(); fn(); noteChanged(); setTimeout(showFmtBar, 0); },
  }, label)));
  document.addEventListener('selectionchange', () => { if (settings.view === 'notes') showFmtBar(); });
  body.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== body) bar.hidden = true; }, 120));

  const pop = $('#more-pop');
  pop.replaceChildren(
    h('button', { onclick: () => { pop.hidden = true; duplicateNote(); } }, 'Duplicate'),
    h('button', { onclick: () => { pop.hidden = true; copyMarkdown(); } }, 'Copy as Markdown'),
    h('button', { class: 'danger', onclick: () => { pop.hidden = true; deleteNote(); } }, 'Delete'));
  $('#note-more').addEventListener('click', (e) => {
    pop.hidden = !pop.hidden;
    if (!pop.hidden) {
      const page = $('#note-page').getBoundingClientRect(), r = e.currentTarget.getBoundingClientRect();
      pop.style.top = (r.bottom - page.top + 6) + 'px';
      pop.style.left = (r.right - page.left - pop.offsetWidth) + 'px';
    }
  });
  addEventListener('mousedown', (e) => { if (!e.target.closest('#more-pop, #note-more')) pop.hidden = true; });

  // keyboard shortcuts while the Notes tab is open
  addEventListener('keydown', (e) => {
    if (settings.view !== 'notes' || !$('#modal').hidden) return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    if (!e.shiftKey && k === 'n') { e.preventDefault(); newNote(); }
    else if (e.shiftKey && k === 'n') { e.preventDefault(); newFolder(); }
    else if (!e.shiftKey && k === 'f') { e.preventDefault(); $('#notes-search').focus(); $('#notes-search').select(); }
    else if (!e.shiftKey && k === 'd' && notes.cur) { e.preventDefault(); duplicateNote(); }
    else if (document.activeElement === body) {
      if (!e.shiftKey && k === 'k') { e.preventDefault(); addLink(); }
      else if (!e.shiftKey && k === 'e') { e.preventDefault(); wrapSelection('code'); }
      else if (e.shiftKey && k === 'h') { e.preventDefault(); wrapSelection('mark'); }
      else if (e.shiftKey && k === 'x') { e.preventDefault(); document.execCommand('strikeThrough'); noteChanged(); }
    }
  }, true);
  renderTags();
})();

// Dev only: example notes for screenshots (screenshot mode, throwaway profile).
if (window.__shot) {
  const baseShot = window.__shot;
  window.__shot = (step) => {
    const parts = step.split(':');
    const mine = parts.filter((p) => /^notes(demo|slash|fmt|trash|icon|empty|all)$/.test(p));
    baseShot(parts.filter((p) => !mine.includes(p)).join(':') || 'notes');
    for (const p of mine) notesShot(p);
  };
}
async function notesShot(p) {
  const body = BODY();
  if (p === 'notesdemo') {
    const day = 864e5, now = Date.now();
    notes.folders = [{ id: DEFAULT_FOLDER, name: 'Notes' }, { id: 'f-sem', name: 'Semester 5', icon: '📚' }, { id: 'f-cf', name: 'Codeforces', icon: '💻' }, { id: 'f-me', name: 'Personal', icon: '🌙' }];
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 300;
    const c = cv.getContext('2d'); const g = c.createLinearGradient(0, 0, 640, 300); g.addColorStop(0, '#5b9dff'); g.addColorStop(1, '#9b87f5');
    c.fillStyle = g; c.fillRect(0, 0, 640, 300); c.fillStyle = '#fff'; c.font = 'bold 40px Segoe UI'; c.fillText('Page tables', 40, 90); c.font = '22px Segoe UI';
    ['virtual address → page number + offset', 'TLB hit: ~1 ns   miss: walk the table', 'multi-level tables save memory'].forEach((t, i) => c.fillText(t, 40, 150 + i * 40));
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const img = await call(api.notes.saveImage(new Uint8Array(await blob.arrayBuffer()), 'image/png'));
    const page = `<p>Exam on <b>Nov 20</b>. Focus on paging and scheduling; past papers repeat these. #exam #os</p>
<div class="callout"><span class="ci" contenteditable="false">💡</span><div class="ct">Do one past paper a day from Nov 15. Mark weak topics in <mark>yellow</mark>.</div></div>
<h2>Checklist</h2>
<div class="todo"><input type="checkbox" checked="">Chapter 8: Main memory</div>
<div class="todo"><input type="checkbox" checked="">Chapter 9: Virtual memory</div>
<div class="todo"><input type="checkbox">Chapter 5: CPU scheduling</div>
<div class="todo"><input type="checkbox">2023 past paper</div>
<h2>Paging</h2>
<p>Logical address = <code>page number</code> + <code>offset</code>. The TLB caches recent translations.</p>
<p><img src="${img}"></p>
<details class="toggle" open=""><summary>Formulas to remember</summary><p>EAT = h·(t + m) + (1 − h)·(t + 2m)</p></details>
<pre>def fifo(refs, frames):\n    return faults</pre>
<blockquote>Understand the why, not just the steps.</blockquote>`;
    notes.list = [
      { id: 'd1', title: 'OS exam plan', icon: '🧠', folder: 'f-sem', html: page, created: now - 3 * day, updated: now - 20 * 60000, pinned: true },
      { id: 'd2', title: 'Networks: TCP vs UDP', icon: '', folder: 'f-sem', html: '<p>Three-way handshake, flow control, congestion control. #exam</p>', created: now, updated: now - 2 * 3600000 },
      { id: 'd3', title: 'Div 2 round notes', icon: '💻', folder: 'f-cf', html: '<p>C: binary search on the answer. D: DSU with rollback. #cp</p><div class="todo"><input type="checkbox">Upsolve D</div><div class="todo"><input type="checkbox">Upsolve E</div>', created: now, updated: now - day },
      { id: 'd4', title: 'Graph patterns', icon: '', folder: 'f-cf', html: `<p>BFS on grid, 0-1 BFS, Dijkstra with potentials. #cp</p><p><img src="${img}"></p>`, created: now, updated: now - 3 * day },
      { id: 'd5', title: 'Groceries', icon: '🍎', folder: 'f-me', html: '<div class="todo"><input type="checkbox" checked="">Milk</div><div class="todo"><input type="checkbox">Coffee</div>', created: now, updated: now - 10 * day },
      { id: 'd6', title: 'Old draft', icon: '', folder: DEFAULT_FOLDER, html: '<p>Scratch ideas</p>', created: now, updated: now - 5 * day, deleted: now - 3600000 },
    ];
    saveNotes(); saveFolders();
    notes.cur = null; notes.folder = 'f-sem'; store.set('noteFolder', 'f-sem');
    renderFolders(); openNote('d1');
  } else if (p === 'notesslash') {
    const last = makeBlock('p'); body.append(last); placeCaret(last);
    document.execCommand('insertText', false, '/');
    $('#note-scroll').scrollTop = 99999;
  } else if (p === 'notesfmt') {
    $('#note-scroll').scrollTop = 0;
    const t = body.querySelector('p').firstChild;
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 7); body.focus();
    getSelection().removeAllRanges(); getSelection().addRange(r); showFmtBar();
  } else if (p === 'notestrash') { showFolder('trash'); }
  else if (p === 'notesall') { showFolder('all'); openNote('d3'); }
  else if (p === 'notesicon') { $('#note-scroll').scrollTop = 0; getSelection().removeAllRanges(); $('#fmt-bar').hidden = true; $('#note-icon').click(); }
  else if (p === 'notesempty') { notes.list = []; saveNotes(); showFolder('all'); }
}

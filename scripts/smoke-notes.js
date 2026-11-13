// Notes and the Google reminder:  node scripts/run-tests.js smoke-notes.js
(async () => {
  const fails = [];
  let count = 0;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  const body = $('#note-body');
  const place = (node, offset) => { const r = document.createRange(); r.setStart(node, offset); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  // Exactly what typing does: the space lands in the text, then the input event fires.
  const typeSpaceShortcut = (text) => { body.focus(); body.innerHTML = ''; document.execCommand('insertText', false, text + ' '); const tx = body.firstChild && body.firstChild.nodeType === 1 ? body.firstChild.firstChild : body.firstChild; if (tx && tx.nodeType === 3) place(tx, tx.textContent.length); body.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ' ' })); };

  const blocked = [];
  document.addEventListener('securitypolicyviolation', (e) => blocked.push(`${e.violatedDirective} ${e.sample || ''} @ ${e.sourceFile}:${e.lineNumber}`));
  showView('notes');
  check('notes tab opens', $('#v-notes').classList.contains('on'), settings.view);
  check('empty state shown', /No notes yet/.test($('#notes-list').textContent), $('#notes-list').textContent);

  // create, title, text, autosave
  const n = newNote();
  $('#note-title').value = 'Exam plan'; $('#note-title').dispatchEvent(new Event('input'));
  body.focus(); document.execCommand('insertText', false, 'Revise OS chapters 3 to 5');
  body.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: '5' }));
  await wait(600);
  const saved = store.get('notes', []).find((x) => x.id === n.id);
  check('note autosaves title and text', saved && saved.title === 'Exam plan' && saved.html.includes('Revise OS'), saved);
  check('note listed', /Exam plan/.test($('#notes-list').textContent), $('#notes-list').textContent);

  // paste an image: a real PNG made on a canvas, through the same save path as Ctrl+V
  const cv = document.createElement('canvas'); cv.width = 40; cv.height = 30;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#5b9dff'; ctx.fillRect(0, 0, 40, 30);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  place(body, body.childNodes.length);
  await addImages([new File([blob], 'shot.png', { type: 'image/png' })]);
  await wait(600);
  const img = body.querySelector('img');
  check('pasted image shows in the note', !!img && /^ndimg:\/\/img\/[a-f0-9]{40}\.png$/.test(img.getAttribute('src')), img && img.getAttribute('src'));
  await new Promise((r) => { if (img.complete) r(); else { img.onload = r; img.onerror = r; } });
  check('image loads from disk', img.naturalWidth === 40 && img.naturalHeight === 30, { w: img.naturalWidth, h: img.naturalHeight });
  check('image reference saved with the note', store.get('notes', []).find((x) => x.id === n.id).html.includes('ndimg://img/'), null);
  const again = await call(api.notes.saveImage(new Uint8Array(await blob.arrayBuffer()), 'image/png'));
  check('same image stored once (named by content)', again === img.getAttribute('src'), again);
  const bad = await api.notes.saveImage(new Uint8Array([1, 2, 3]), 'application/x-msdownload');
  check('non-images refused', bad.ok === false, bad);

  // pasted web content is cleaned
  const dirty = '<h2>Title</h2><p onclick="x()">Text <b>bold</b><script>alert(1)</script></p><img src="https://evil.example/x.png" onerror="alert(1)"><iframe src="https://x"></iframe><a href="javascript:alert(1)">bad</a><a href="https://ok.example">ok</a>';
  const clean = sanitize(dirty);
  check('scripts, frames and handlers removed', !/script|iframe|onclick|onerror|javascript:/i.test(clean), clean);
  check('outside images removed, formatting kept', !/evil\.example/.test(clean) && /<h2>Title<\/h2>/.test(clean) && /<b>bold<\/b>/.test(clean), clean);
  check('safe links kept and open outside', /href="https:\/\/ok\.example"[^>]*target="_blank"/.test(clean) || /target="_blank"[^>]*href="https:\/\/ok\.example"/.test(clean), clean);

  // quick shortcuts at the start of a line
  typeSpaceShortcut('#');
  check('"# " makes a heading', !!body.querySelector('h1'), body.innerHTML);
  typeSpaceShortcut('-');
  check('"- " makes a bullet list', !!body.querySelector('ul li'), body.innerHTML);
  typeSpaceShortcut('1.');
  check('"1. " makes a numbered list', !!body.querySelector('ol li'), body.innerHTML);
  typeSpaceShortcut('[]');
  const box = body.querySelector('.todo input[type=checkbox]');
  check('"[] " makes a checkbox', !!box, body.innerHTML);
  box.click();
  check('ticking a checkbox is remembered', box.hasAttribute('checked'), box.outerHTML);
  typeSpaceShortcut('>');
  check('"> " makes a quote', !!body.querySelector('blockquote'), body.innerHTML);

  // a second note, search, pin, switch, delete
  commitNote();
  const n2 = newNote();
  $('#note-title').value = 'Groceries'; $('#note-title').dispatchEvent(new Event('input'));
  commitNote();
  $('#notes-search').value = 'groc'; $('#notes-search').dispatchEvent(new Event('input'));
  check('search filters the list', $$('#notes-list .note-item').length === 1 && /Groceries/.test($('#notes-list').textContent), $('#notes-list').textContent);
  $('#notes-search').value = ''; $('#notes-search').dispatchEvent(new Event('input'));
  openNote(n.id);
  check('switching notes loads the right page', $('#note-title').value === 'Exam plan', $('#note-title').value);
  $('#note-pin').click();
  check('pinned note goes first', $$('#notes-list .note-item')[0].textContent.includes('Exam plan') && store.get('notes', []).find((x) => x.id === n.id).pinned, null);
  openNote(n2.id);
  const realConfirm = window.confirm; window.confirm = () => true;
  $('#note-del').click();
  window.confirm = realConfirm;
  const gone = store.get('notes', []).find((x) => x.id === n2.id);
  check('delete moves the note to Recently Deleted (like iOS)', gone && gone.deleted > 0 && $('#note-title').value === 'Exam plan', gone);

  // ---------- Recently Deleted
  showFolder('trash');
  check('Recently Deleted lists it', /Groceries/.test($('#notes-list').textContent) && !/Exam plan/.test($('#notes-list').textContent), $('#notes-list').textContent);
  openNote(n2.id);
  check('a deleted note opens read-only with Restore', body.contentEditable === 'false' && !$('#note-restore').hidden && $('#note-del').hidden, null);
  $('#note-restore').click();
  check('Restore brings it back to its folder', !store.get('notes', []).find((x) => x.id === n2.id).deleted && store.get('notes', []).find((x) => x.id === n2.id).folder === DEFAULT_FOLDER, null);

  // ---------- folders
  showFolder('all');
  const f = newFolder();
  const rn = $('#nf-list .nf-rename');
  check('a new folder opens straight into renaming', !!rn, $('#nf-list').innerHTML.slice(0, 200));
  rn.value = 'Semester 5'; rn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  check('folder renamed and saved', store.get('noteFolders', []).some((x) => x.id === f.id && x.name === 'Semester 5'), store.get('noteFolders', []));
  check('the new folder is open and empty', notes.folder === f.id && /No notes yet/.test($('#notes-list').textContent), notes.folder);
  const n3 = newNote();
  check('a new note goes into the open folder', n3.folder === f.id, n3.folder);
  $('#note-title').value = 'OS revision'; $('#note-title').dispatchEvent(new Event('input'));
  body.innerHTML = '<p>Revise paging and #exam #os scheduling</p>'; body.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'g' }));
  commitNote();
  moveNote(n.id, f.id);
  check('moving a note into a folder updates its count', $(`#nf-list [data-id="${f.id}"] .nf-count`).textContent === '2', $(`#nf-list [data-id="${f.id}"]`).textContent);
  showFolder(DEFAULT_FOLDER);
  check('the default folder no longer lists the moved note', !/Exam plan/.test($('#notes-list').textContent) && /Groceries/.test($('#notes-list').textContent), $('#notes-list').textContent);
  showFolder('all');
  check('All Notes lists every live note', ['Exam plan', 'Groceries', 'OS revision'].every((t) => $('#notes-list').textContent.includes(t)), $('#notes-list').textContent);
  check('notes are grouped by date', $$('#notes-list .nl-sec').some((s) => /Pinned|Today/.test(s.textContent)), $$('#notes-list .nl-sec').map((s) => s.textContent));

  // ---------- tags
  const tagButtons = $$('#nf-tags .nf-tag').map((t) => t.textContent);
  check('#tags in a note show up in the sidebar', tagButtons.includes('#exam') && tagButtons.includes('#os'), tagButtons);
  $$('#nf-tags .nf-tag').find((t) => t.textContent === '#exam').click();
  check('clicking a tag filters the list', $$('#notes-list .note-item').length === 1 && /OS revision/.test($('#notes-list').textContent) && $('#ns-title').textContent === '#exam', $('#notes-list').textContent);
  showFolder('all');

  // ---------- Notion-style blocks
  openNote(n3.id);
  body.innerHTML = '<p><br></p>';
  place(body.firstChild, 0); body.focus();
  document.execCommand('insertText', false, '/');
  await wait(50);
  check('typing "/" opens the block menu', !$('#slash').hidden && $$('#slash .sl-item').length >= 12, $$('#slash .sl-item').length);
  document.execCommand('insertText', false, 'call');
  await wait(50);
  check('the menu filters as you type', $$('#slash .sl-item').length === 1 && /Callout/.test($('#slash').textContent), $('#slash').textContent);
  body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  check('Enter turns the line into the chosen block', !!body.querySelector('.callout .ct') && $('#slash').hidden && !body.textContent.includes('/call'), body.innerHTML);
  const p1 = makeBlock('p'); body.append(p1); placeCaret(p1);
  for (const [t, sel] of [['toggle', 'details.toggle > summary'], ['pre', 'pre'], ['h2', 'h2'], ['todo', '.todo input']]) {
    const blk = setBlockType(caretBlock() || body.lastElementChild, t);
    check(`block type: ${t}`, !!body.querySelector(sel), body.innerHTML.slice(-160));
    const next = makeBlock('p'); (blk || body.lastElementChild).after(next); placeCaret(next);
  }
  setBlockType(body.lastElementChild, 'hr');
  check('block type: divider (with a fresh line after it)', !!body.querySelector('hr') && body.lastElementChild.tagName === 'P', body.innerHTML.slice(-120));
  // Enter in a to-do with text makes the next to-do; on an empty to-do it ends the list
  const todo = body.querySelector('.todo'); todo.append('Read chapter 4'); placeCaret(todo);
  body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  check('Enter after a to-do adds another to-do', body.querySelectorAll('.todo').length === 2, body.querySelectorAll('.todo').length);
  body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  check('Enter on an empty to-do turns it into text', body.querySelectorAll('.todo').length === 1, body.querySelectorAll('.todo').length);
  // "---" makes a divider
  const p2 = makeBlock('p'); body.append(p2); placeCaret(p2);
  const hrs = body.querySelectorAll('hr').length;
  document.execCommand('insertText', false, '---');
  check('typing --- makes a divider', body.querySelectorAll('hr').length === hrs + 1, body.innerHTML.slice(-120));
  // drag a block by its handle to reorder
  body.innerHTML = '<h2>First</h2><p>Second</p><p>Third</p>';
  const [b1, , b3] = body.children;
  notes.dragBlock = b3;
  const dt = new DataTransfer(); dt.setData('nd/block', '1');
  const r1 = b1.getBoundingClientRect();
  body.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: r1.left + 5, clientY: r1.top + 2, bubbles: true, cancelable: true }));
  body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: r1.left + 5, clientY: r1.top + 2, bubbles: true, cancelable: true }));
  check('dragging a block moves it', [...body.children].map((x) => x.textContent).join() === 'Third,First,Second', [...body.children].map((x) => x.textContent));
  // formatting bar actions
  body.innerHTML = '<p>Important exam date</p>';
  const tn = body.firstChild.firstChild; const r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, 9); getSelection().removeAllRanges(); getSelection().addRange(r);
  wrapSelection('mark');
  check('highlight wraps the selection', body.querySelector('mark') && body.querySelector('mark').textContent === 'Important', body.innerHTML);
  check('highlights survive saving', /<mark>Important<\/mark>/.test(sanitize(body.innerHTML)), sanitize(body.innerHTML));
  check('own blocks survive the cleaner', /class="callout"/.test(sanitize('<div class="callout"><span class="ci" contenteditable="false">💡</span><div class="ct">x</div></div>')) && /<details class="toggle" open="">/.test(sanitize('<details class="toggle" open><summary>s</summary></details>')), null);
  check('the cleaner still drops unknown classes and styles', !/evil|style/.test(sanitize('<p class="evil" style="color:red">x</p>')), sanitize('<p class="evil" style="color:red">x</p>'));
  commitNote();

  // ---------- word count, checklist progress, icon, duplicate, Markdown
  body.innerHTML = '<p>one two three</p><div class="todo"><input type="checkbox" checked="">done item</div><div class="todo"><input type="checkbox">open item</div>';
  body.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'x' })); commitNote();
  check('page shows words and checklist progress', /words/.test($('#note-meta').textContent) && /1\/2 done/.test($('#note-meta').textContent), $('#note-meta').textContent);
  check('the list row shows checklist progress', $$('#notes-list .ni-todo').some((x) => /1\/2 done/.test(x.textContent)), $$('#notes-list .ni-todo').map((x) => x.textContent));
  $('#note-add-icon').click();
  $$('#icon-pop button')[3].click();
  check('a page icon can be set', notes.cur.icon === NOTE_ICONS[3] && store.get('notes', []).find((x) => x.id === n3.id).icon === NOTE_ICONS[3], notes.cur.icon);
  const md = toMarkdown(notes.cur);
  check('copy as Markdown', /^# .* OS revision/.test(md) && md.includes('- [x] done item') && md.includes('- [ ] open item'), md);
  const before = notes.list.length;
  const dup = duplicateNote();
  check('duplicate makes a copy in the same folder', notes.list.length === before + 1 && dup.title === 'OS revision copy' && dup.folder === n3.folder, dup && dup.title);

  // ---------- regressions found in screenshots
  const nt = { html: '<p>Round notes #cp</p><div class="todo"><input type="checkbox">Upsolve D</div>' };
  check('tags never glue words from the next line', noteTags(nt).join() === 'cp', noteTags(nt));
  const nTog = newNote();
  body.innerHTML = '<details class="toggle" open=""><summary>Hidden</summary><p>inside</p></details>';
  body.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'e' })); commitNote();
  openNote(nTog.id); await wait(700);
  check('a note with a toggle shows "Saved" after opening, not "Saving…"', $('#note-saved').textContent === 'Saved', $('#note-saved').textContent);
  // the block handle appears beside the block under the mouse
  const hb = body.firstElementChild, hr2 = hb.getBoundingClientRect();
  $('#note-scroll').dispatchEvent(new MouseEvent('mousemove', { clientX: hr2.left + 10, clientY: hr2.top + 5, bubbles: true }));
  check('hovering a block shows its ⋮⋮ handle on its left', !$('#blk-handle').hidden && $('#blk-handle').getBoundingClientRect().right <= hr2.left + 2, $('#blk-handle').hidden);
  $('#bh-add').click(); await wait(30);
  check('the + beside a block adds a block below and opens the menu', !$('#slash').hidden && body.children.length === 2, body.children.length);
  body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  check('Escape closes the block menu', $('#slash').hidden, null);
  // formatting bar shows on a selection
  body.innerHTML = '<p>Select these words</p>';
  const ft = body.firstChild.firstChild; const fr = document.createRange(); fr.setStart(ft, 0); fr.setEnd(ft, 6); body.focus(); getSelection().removeAllRanges(); getSelection().addRange(fr); showFmtBar();
  check('selecting text shows the formatting bar', !$('#fmt-bar').hidden && $$('#fmt-bar button').length === 7, $('#fmt-bar').hidden);
  getSelection().removeAllRanges(); showFmtBar();
  check('…and it hides again', $('#fmt-bar').hidden, null);
  // keyboard: Ctrl+N new note in the open folder
  const count0 = notes.list.length;
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }));
  check('Ctrl+N makes a new note', notes.list.length === count0 + 1, notes.list.length);
  showFolder(f.id);

  // ---------- deleting a folder sends its notes to Recently Deleted
  window.confirm = () => true;
  deleteFolder(f.id);
  window.confirm = realConfirm;
  const all = store.get('notes', []);
  check('deleting a folder removes it', !store.get('noteFolders', []).some((x) => x.id === f.id), store.get('noteFolders', []));
  check('its notes go to Recently Deleted, not lost', all.filter((x) => x.folder === f.id).every((x) => x.deleted > 0) && all.filter((x) => x.folder === f.id).length === 3, all.map((x) => [x.title, x.folder, !!x.deleted]));
  showFolder('trash'); openNote(n.id); $('#note-restore').click();
  check('restoring a note from a deleted folder puts it in Notes', store.get('notes', []).find((x) => x.id === n.id).folder === DEFAULT_FOLDER, null);
  check('the default folder cannot be deleted', !$(`#nf-list [data-id="${DEFAULT_FOLDER}"] .nf-del`), null);
  showFolder('all');

  // ---------- Google reminder
  const shown = [];
  const RealN = window.Notification;
  window.Notification = function (title) { shown.push(title); };
  const day = 864e5, t0 = Date.now();
  store.set('gcalRemindDay', ''); store.set('gcalOutNotified', ''); store.set('gcalLasting', false);
  check('no reminder in the first 6 days', googleReminder({ configured: true, connected: true, connectedAt: t0 - 3 * day }, t0) === '' && !cal.remindReconnect, shown);
  check('reminder on day 6', googleReminder({ configured: true, connected: true, connectedAt: t0 - 6.3 * day }, t0) === 'reminded' && cal.remindReconnect && shown.some((s) => /Reconnect Google/.test(s)), shown);
  check('only once a day', googleReminder({ configured: true, connected: true, connectedAt: t0 - 6.4 * day }, t0) === '' && shown.length === 1, shown);
  check('signed out: alert', googleReminder({ configured: true, connected: false }, t0) === 'signed-out' && shown.some((s) => /signed out/.test(s)), shown);
  check('signed-out alert once a day', googleReminder({ configured: true, connected: false }, t0) === '', shown);
  check('a login older than 7 days means it lasts: reminders stop', googleReminder({ configured: true, connected: true, connectedAt: t0 - 8 * day }, t0) === 'lasting' && store.get('gcalLasting', false) === true, null);
  store.set('gcalRemindDay', '');
  check('after that, no more reminders', googleReminder({ configured: true, connected: true, connectedAt: t0 - 6.5 * day }, t0) === '', null);
  check('not set up: nothing', googleReminder({ configured: false, connected: false }, t0) === '', null);
  cal.gst = { configured: true, connected: false }; cal.error = ''; showView('calendar'); renderCal();
  check('signed-out calendar shows Reconnect', !!$('#cal-reconnect') && /signed out/.test($('#cal-status').textContent), $('#cal-status').textContent);
  window.Notification = RealN;
  store.set('gcalLasting', false);

  return JSON.stringify({ checks: count, failed: fails, blocked }, null, 1);
})();

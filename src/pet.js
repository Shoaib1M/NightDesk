'use strict';
// The study pet: care stats fed by study time, coins, shop, daily quests, celebrations,
// helper reminders, dragging and roaming, the Pet tab, and syncing to the desktop pet window.

const clamp100 = (v) => Math.max(0, Math.min(100, v));
const pet = Object.assign({
  name: 'Mochi', kind: 'cat', color: 'ginger', hat: '', coins: 0,
  hunger: 70, energy: 80, joy: 70, last: Date.now(), napUntil: 0,
  pos: { x: 18, y: 16 }, desktop: false, roam: true, breaks: true, nudgeOn: true, nudgeTime: '21:00',
  day: {}, cele: {}, level: 0, focusRun: 0,
}, store.get('pet', {}));
pet.owned = Object.assign({ kind: ['cat'], color: ['ginger'], hat: [''] }, pet.owned);
if (!PET_PAL[pet.color]) pet.color = 'ginger';
pet.pos = Object.assign({ x: 18, y: 16 }, pet.pos);
const savePet = () => store.set('pet', pet);

const SHOP = {
  kind: [['cat', 'Cat', 0], ['dog', 'Dog', 250], ['bunny', 'Bunny', 250], ['frog', 'Frog', 250], ['custom', 'Your own', 0]],
  color: [['ginger', 'Ginger', 0], ['grey', 'Grey', 60], ['cream', 'Cream', 60], ['cocoa', 'Cocoa', 80], ['snow', 'Snow', 80], ['tuxedo', 'Tuxedo', 120], ['mint', 'Mint', 150], ['sakura', 'Sakura', 150],
    ['sky', 'Sky', 150], ['lily', 'Lily pad', 150], ['lavender', 'Lavender', 200], ['galaxy', 'Galaxy', 350], ['gold', 'Gold', 500]],
  hat: [['', 'No hat', 0], ['party', 'Party hat', 50], ['phones', 'Headphones', 120], ['tophat', 'Top hat', 150], ['grad', 'Grad cap', 200], ['crown', 'Crown', 400]],
};
// Each pet comes with its own signature colour, included when you buy it.
const SIGNATURE = { cat: 'ginger', dog: 'cocoa', bunny: 'snow', frog: 'lily' };
const SHOP_TABS = [['kind', 'Pets'], ['color', 'Colours'], ['hat', 'Hats']];
const STAGES = { cat: ['Kitten', 'Cat', 'Elder cat'], dog: ['Puppy', 'Dog', 'Elder dog'], bunny: ['Kit', 'Bunny', 'Elder bunny'], frog: ['Froglet', 'Frog', 'Old toad'], custom: ['Little one', 'Grown up', 'Elder'] };
const REMINDERS = ['Stretch your neck and shoulders.', 'Look at something 20 feet away for 20 seconds.', 'Drink some water.'];
const buddy = { state: '', cheerUntil: 0, bubble: '', bubbleUntil: 0, sayT: null, blink: false, walking: false, walkT: null,
  nextAct: Date.now() + 9000, chaseUntil: 0, mouseX: 300, lastTick: Date.now(), lastSave: 0, deskOn: null, lastSent: '', tab: 'kind', lastPoke: 0 };
if (pet.kind === 'custom' && !pet.custom) pet.kind = 'cat';
const petLook = () => ({ kind: pet.kind, color: pet.color, hat: pet.hat, ...(pet.kind === 'custom' ? { custom: pet.custom } : {}) });

// What the pet needs right now, shown as a thought bubble so you do not have to keep checking on it.
const NEEDS = {
  hunger: { icon: '🍖', say: 'I am hungry. A treat, please?', fix: 'treat' },
  energy: { icon: '😴', say: 'So sleepy. Can I nap?', fix: 'nap' },
  joy: { icon: '🧶', say: 'I am bored. Play with me?', fix: 'play' },
};
function petNeed() {
  const k = pet.hunger < 35 ? 'hunger' : pet.energy < 30 ? 'energy' : pet.joy < 35 ? 'joy' : '';
  return k ? { k, ...NEEDS[k] } : null;
}

function ensureDay() {
  const d = ymd(new Date());
  if (pet.day.date === d) return;
  pet.day = { date: d, minutes: 0, blocks: 0, pets: 0, plays: 0, early: 0, nudges: 0, lastNudge: 0, claimed: [] };
  // Celebration records are kept forever (each is dated, so old ones never block a new one).
}

// Stats drift down slowly while nobody is looking; capped so a long holiday is not a disaster.
function petDecay(now) {
  const hrs = Math.min(72, (now - pet.last) / 3600000);
  if (!(hrs > 0.005)) { if (hrs < 0) pet.last = now; return; }
  pet.last = now;
  const resting = now < pet.napUntil || (pomo.running && pomo.mode === 'break');
  pet.hunger = clamp100(pet.hunger - 3 * hrs);
  pet.joy = clamp100(pet.joy - 2 * hrs);
  pet.energy = clamp100(pet.energy + (resting ? 40 : -1.5) * hrs);
}
function petMood() {
  const avg = (pet.hunger + pet.energy + pet.joy) / 3;
  const low = pet.hunger < 25 ? 'hungry' : pet.energy < 25 ? 'tired' : pet.joy < 25 ? 'lonely' : '';
  return { avg, sad: avg < 33 || !!low, text: low ? `Feeling ${low}` : avg >= 66 ? 'Happy' : 'Doing okay' };
}
function petStage() {
  const total = studyStats().total;
  const i = total < 600 ? 0 : total < 3000 ? 1 : 2;
  return { i, name: (STAGES[pet.kind] || STAGES.cat)[i], scale: 4 + i, next: [600, 3000, 0][i], total };
}

// ---------- speech, hearts, confetti
function buddySay(text, ms = 6000) {
  if (!settings.buddy) return;
  buddy.bubble = text;
  buddy.bubbleUntil = Date.now() + ms;
  const b = $('#buddy-say');
  b.textContent = text;
  b.hidden = false;
  clearTimeout(buddy.sayT);
  buddy.sayT = setTimeout(() => { b.hidden = true; }, ms);
}
function heart() {
  const el = h('span', { class: 'heart' }, '♥');
  $('#buddy').append(el);
  setTimeout(() => el.remove(), 900);
}
function confetti() {
  const box = h('div', { class: 'confetti' });
  const colors = ['#d98a7c', '#5b9dff', '#7fae8b', '#e0a040', '#9b87f5', '#f3a6c0'];
  for (let i = 0; i < 70; i++) {
    const p = h('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.6 + 's';
    p.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4000);
}
function celebrate(text) {
  buddy.cheerUntil = Date.now() + 3500;
  confetti();
  chime();
  buddySay(text, 9000);
}

// ---------- wins: level-ups, streaks, targets, best day
function checkWins() {
  ensureDay();
  const st = studyStats(), d = pet.day.date;
  const win = (key, text, bonus) => {
    if (pet.cele[key]) return;
    pet.cele[key] = 1;
    pet.coins += bonus;
    celebrate(`${text} +${bonus} coins`);
  };
  if (pet.level && st.level > pet.level) win('lvl' + st.level, `Level ${st.level}!`, 20);
  pet.level = st.level;
  if ([3, 7, 14, 30, 50, 100, 200, 365].includes(st.streak)) win(`streak${st.streak}@${d}`, `${st.streak} day streak!`, st.streak * 2);
  for (const s of study.subjects) {
    if (s.goal && (st.byDaySubj.get(d + '|' + s.id) || 0) >= s.goal) win(`t:${s.id}@${d}`, `${s.name} target done!`, 15);
  }
  const others = Math.max(0, ...[...st.byDay].filter(([k]) => k !== d).map(([, m]) => m));
  if (others > 0 && st.today >= 60 && st.today > others) win('best@' + d, 'New personal best day!', 30);
}

on('studied', (m) => {
  ensureDay();
  pet.hunger = clamp100(pet.hunger + m * 0.8);
  pet.joy = clamp100(pet.joy + m * 0.3);
  pet.coins += m;
  pet.day.minutes += m;
  checkWins();
  savePet();
  renderPetView();
});
on('pomo', (ev) => {
  ensureDay();
  if (ev === 'start') {
    const d = new Date();
    if (`${pad(d.getHours())}:${pad(d.getMinutes())}` < pet.nudgeTime) pet.day.early = 1;
    buddySay(`Let's go. ${settings.focusMin} minutes.`);
  }
  if (ev === 'focus-done') {
    pet.day.blocks++;
    if (Date.now() > buddy.cheerUntil) { buddy.cheerUntil = Date.now() + 3000; buddySay('Block done! Stand up and stretch.'); }
  }
  if (ev === 'break-done') buddySay('Break is over. Back to it.');
  savePet();
  renderPetView();
});

// ---------- daily quests
function petQuests() {
  ensureDay();
  const seed = [...pet.day.date].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const [mins, minCoins] = [[60, 40], [90, 60], [120, 80], [180, 120]][seed % 4];
  const [blocks, blockCoins] = [[1, 20], [2, 35], [3, 55]][(seed >> 3) % 3];
  const st = studyStats();
  const targets = study.subjects.filter((s) => s.goal && (st.byDaySubj.get(pet.day.date + '|' + s.id) || 0) >= s.goal).length;
  const [hh, mm] = pet.nudgeTime.split(':').map(Number);
  const care = [
    { id: 'pets', text: `Pet ${pet.name} 5 times`, have: pet.day.pets, goal: 5, coins: 10 },
    { id: 'play', text: `Play with ${pet.name}`, have: pet.day.plays, goal: 1, coins: 10 },
    { id: 'target', text: 'Hit one subject target', have: targets, goal: 1, coins: 40 },
    { id: 'early', text: `Start a focus block before ${fmtTime(new Date(2000, 0, 1, hh, mm))}`, have: pet.day.early, goal: 1, coins: 25 },
  ][(seed >> 5) % 4];
  const task = taskQuest();
  return [
    { id: 'min', text: `Study ${fmtDur(mins)}`, have: pet.day.minutes, goal: mins, coins: minCoins },
    { id: 'blocks', text: `Finish ${blocks} focus block${blocks > 1 ? 's' : ''}`, have: pet.day.blocks, goal: blocks, coins: blockCoins },
    care,
    ...(task ? [task] : []),
  ];
}

// One quest a day from your real work: a Todoist task that is due, or else the next chapter of the
// subject whose exam is nearest. Picked once per day, so finishing it does not swap in another.
function pickTask() {
  const due = typeof todoistDueNow === 'function' && cal.todoistOn ? todoistDueNow().sort((a, b) => b.priority - a.priority) : [];
  if (due.length) return { src: 'todoist', id: due[0].id, text: `Finish “${due[0].title}”`, at: Date.now() };
  const notesDue = typeof todoDueNow === 'function' && tabOn('todo') ? todoDueNow().sort((a, b) => a.due.localeCompare(b.due)) : [];
  if (notesDue.length) return { src: 'todo', id: notesDue[0].id, text: `Finish “${notesDue[0].text.trim().split('\n')[0].slice(0, 50)}”`, at: Date.now() };
  const today = ymd(new Date());
  const withWork = study.subjects.filter((s) => (s.chapters || []).some((c) => !c.done));
  const s = withWork.filter((x) => x.exam && x.exam >= today).sort((a, b) => a.exam.localeCompare(b.exam))[0] || withWork[0];
  if (!s) return null;
  const c = s.chapters.find((x) => !x.done);
  return { src: 'chapter', sid: s.id, id: c.id, text: `Finish ${c.name || 'the next chapter'} · ${s.name}`, at: Date.now() };
}
function taskQuest() {
  const claimed = pet.day.claimed.includes('task');
  let t = pet.day.task;
  if (t && t.src === 'chapter' && !claimed) {
    const s = study.subjects.find((x) => x.id === t.sid), c = s && (s.chapters || []).find((x) => x.id === t.id);
    if (!c) t = null; // the chapter was removed: pick again
  }
  if (t && t.src === 'todo' && !claimed && typeof todo !== 'undefined' && !todo.notes.some((n) => n.id === t.id)) t = null; // post-it removed
  if (!t && !claimed) { t = pickTask(); pet.day.task = t; }
  if (!t) return null;
  let have = 0, go;
  if (t.src === 'chapter') {
    const s = study.subjects.find((x) => x.id === t.sid), c = s && (s.chapters || []).find((x) => x.id === t.id);
    have = c && c.done ? 1 : 0;
    go = () => openSyllabus(t.sid);
  } else if (t.src === 'todo') {
    const n = todo.notes.find((x) => x.id === t.id);
    have = (n && n.doneAt) || (pet.day.doneTasks || []).includes(t.id) ? 1 : 0;
    go = () => showTodoNote(t.id);
  } else {
    // Ticked off here, or gone from Todoist's due list since it was picked (done in the Todoist app).
    const gone = cal.todoistOn && cal.todoistAt > t.at && !todoistDueNow().some((x) => x.id === t.id);
    have = (pet.day.doneTasks || []).includes(t.id) || gone ? 1 : 0;
    go = () => { const x = cal.todoist.find((y) => y.id === t.id); if (x) cal.sel = x.allDay ? x.date : ymd(new Date(x.at)); showView('calendar'); };
  }
  return { id: 'task', text: t.text, have, goal: 1, coins: 30, go, hint: { todoist: 'From Todoist', todo: 'From your To-do board' }[t.src] || 'From your syllabus' };
}
on('taskDone', (d) => {
  ensureDay();
  pet.day.doneTasks = [...(pet.day.doneTasks || []), d.id];
  savePet(); renderPetView();
});
function claimQuest(q) {
  if (q.have < q.goal || pet.day.claimed.includes(q.id)) return;
  pet.day.claimed.push(q.id);
  pet.coins += q.coins;
  buddySay(`Quest done! +${q.coins} coins`);
  heart(); savePet(); renderPetView();
}

// ---------- care actions
function petPoke() {
  ensureDay();
  const now = Date.now();
  if (now - buddy.lastPoke > 1200) { pet.joy = clamp100(pet.joy + 2); pet.day.pets++; }
  buddy.lastPoke = now;
  heart();
  const st = studyStats(), mood = petMood();
  const lines = mood.sad ? [`${mood.text}. A focus block would feed me.`, 'I missed you. Study with me?'] : [
    st.today ? `You've studied ${fmtDur(st.today)} today.` : 'Nothing logged yet today. One block?',
    st.streak > 1 ? `${st.streak} days in a row. Keep it alive.` : 'Start a streak tonight.',
    `${pet.coins} coins saved. The shop has hats.`,
    pomo.running && pomo.mode === 'focus' ? 'Eyes on the work, not on me.' : 'Press Space on the Focus tab to start.',
    'Purr.',
  ];
  buddySay(lines[Math.floor(Math.random() * lines.length)]);
  savePet(); renderPetView();
}
function petTrick() {
  const el = $('#buddy');
  el.classList.remove('spin'); void el.offsetWidth; el.classList.add('spin');
  setTimeout(() => el.classList.remove('spin'), 700);
}
function petPlay() {
  ensureDay();
  if (pet.energy < 10) return buddySay('Too tired to play. Let me nap first.');
  pet.joy = clamp100(pet.joy + 15); pet.energy = clamp100(pet.energy - 10); pet.day.plays++;
  petTrick(); heart(); buddySay('Wheee!');
  savePet(); renderPetView();
}
function petTreat() {
  if (pet.coins < 5) return buddySay('Treats cost 5 coins. Studying earns 1 a minute.');
  if (pet.hunger >= 100) return buddySay('I am full.');
  pet.coins -= 5; pet.hunger = clamp100(pet.hunger + 20);
  heart(); buddySay('Yum.');
  savePet(); renderPetView();
}
function petNap() {
  if (pet.energy > 90) return buddySay('Not sleepy.');
  pet.napUntil = Date.now() + 60000; pet.energy = clamp100(pet.energy + 30);
  buddySay('Zzz. One minute.');
  savePet(); renderPetView();
}
function shopClick(type, id, price) {
  if (type === 'kind' && id === 'custom') {
    if (!pet.custom) return pickPetPicture();
    pet.kind = 'custom';
    if (!pet.owned.kind.includes('custom')) pet.owned.kind.push('custom');
    savePet(); renderPetView(); buddyTick();
    return;
  }
  if (!pet.owned[type].includes(id)) {
    if (pet.coins < price) return buddySay(`${price - pet.coins} more coins needed. That is ${fmtDur(price - pet.coins)} of study.`);
    pet.coins -= price;
    pet.owned[type].push(id);
    celebrate('New look!');
  }
  pet[type] = id;
  if (type === 'kind') {
    const sig = SIGNATURE[id];
    if (!pet.owned.color.includes(sig)) pet.owned.color.push(sig);
    pet.color = sig;
  }
  savePet(); renderPetView(); buddyTick();
}

// ---------- your own pet from a picture (like a game skin)
// The picture is turned into a 32 x 36 pixel sprite: a plain background is cut away (flood fill
// from the edges), the subject is cropped and fitted where the body goes, so hats still sit on top,
// and edges are made crisp. Stored as RGBA bytes in base64 on the pet itself.
function pickPetPicture() {
  const f = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp' });
  f.addEventListener('change', () => { if (f.files[0]) usePetPicture(f.files[0]); });
  f.click();
}
async function petSpriteFrom(blob) {
  const bmp = await createImageBitmap(blob);
  const M = 96, sc = Math.min(M / bmp.width, M / bmp.height, 1e9);
  const mw = Math.max(1, Math.round(bmp.width * sc)), mh = Math.max(1, Math.round(bmp.height * sc));
  const mid = h('canvas', { width: mw, height: mh }), mg = mid.getContext('2d', { willReadFrequently: true });
  mg.imageSmoothingQuality = 'high';
  mg.drawImage(bmp, 0, 0, mw, mh);
  const img = mg.getImageData(0, 0, mw, mh), d = img.data, at = (x, y) => (y * mw + x) * 4;
  // Background: the corners, if they are opaque and about the same colour.
  const corners = [at(0, 0), at(mw - 1, 0), at(0, mh - 1), at(mw - 1, mh - 1)];
  const dist = (i, j) => Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
  if (corners.every((c) => d[c + 3] > 200) && corners.every((c) => dist(c, corners[0]) < 60)) {
    const seen = new Uint8Array(mw * mh), stack = [];
    for (let x = 0; x < mw; x++) stack.push([x, 0], [x, mh - 1]);
    for (let y = 0; y < mh; y++) stack.push([0, y], [mw - 1, y]);
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= mw || y >= mh || seen[y * mw + x]) continue;
      seen[y * mw + x] = 1;
      const i = at(x, y);
      if (dist(i, corners[0]) > 70) continue;
      d[i + 3] = 0;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }
  // Crop to what is left.
  let x0 = mw, y0 = mh, x1 = -1, y1 = -1;
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (d[at(x, y) + 3] > 60) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) throw new Error('The picture looks empty.');
  mg.putImageData(img, 0, 0);
  const W = PET_W * 2, H = PET_H * 2, box = { x: 2, y: 10, w: 24, h: 26 };
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, k = Math.min(box.w / cw, box.h / ch);
  const ow = Math.max(1, Math.round(cw * k)), oh = Math.max(1, Math.round(ch * k));
  const out = h('canvas', { width: W, height: H }), og = out.getContext('2d', { willReadFrequently: true });
  og.imageSmoothingQuality = 'high';
  og.drawImage(mid, x0, y0, cw, ch, box.x + Math.floor((box.w - ow) / 2), box.y + box.h - oh, ow, oh);
  const px = og.getImageData(0, 0, W, H).data;
  for (let i = 3; i < px.length; i += 4) px[i] = px[i] > 110 ? 255 : 0; // crisp pixel edges
  let s = '';
  for (let i = 0; i < px.length; i += 8192) s += String.fromCharCode(...px.subarray(i, i + 8192));
  return btoa(s);
}
async function usePetPicture(file) {
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) return toast('Pick a PNG, JPEG, GIF or WebP picture.');
  if (file.size > 15 * 1024 * 1024) return toast('That picture is over 15 MB.');
  try {
    pet.custom = await petSpriteFrom(file);
    pet.kind = 'custom';
    if (!pet.owned.kind.includes('custom')) pet.owned.kind.push('custom');
    buddy.tab = 'kind';
    savePet(); celebrate('Say hi to your own pet!'); renderPetView(); buddyTick();
  } catch (err) { toast('Could not use that picture: ' + err.message); }
}

// ---------- position, dragging, roaming
let petDrag = null;
function buddySize() { const s = petStage().scale; return { w: PET_W * s, h: PET_H * s }; }
function placeBuddy(instant) {
  const el = $('#buddy'), { w, h: ht } = buddySize();
  pet.pos.x = Math.max(0, Math.min(innerWidth - w, pet.pos.x));
  pet.pos.y = Math.max(0, Math.min(innerHeight - ht - 4, pet.pos.y));
  if (instant) el.style.transition = 'none';
  // Moved with a GPU transform on its own layer, so the page underneath is never repainted.
  el.style.transform = `translate3d(${pet.pos.x}px, ${-pet.pos.y}px, 0)`;
}
function stopWalk() { clearTimeout(buddy.walkT); buddy.walking = false; buddy.chaseUntil = 0; }
// While the pet stands at dock height, the stretch of floor under the dock is off limits.
function avoidDock(x, w) {
  const d = $('#dock').getBoundingClientRect();
  if (pet.pos.y > innerHeight - d.top || x + w < d.left || x > d.right) return x;
  return x + w / 2 < (d.left + d.right) / 2 ? d.left - w - 6 : d.right + 6;
}
function walkTo(x) {
  const { w } = buddySize();
  x = Math.max(4, Math.min(innerWidth - w - 4, avoidDock(x, w)));
  const dist = Math.abs(x - pet.pos.x);
  if (dist < 12) return;
  const secs = dist / 55;
  $('#buddy').style.transition = `transform ${secs}s linear`;
  $('#buddy').classList.toggle('flip', x < pet.pos.x);
  pet.pos.x = x;
  placeBuddy(false);
  buddy.walking = true;
  clearTimeout(buddy.walkT);
  buddy.walkT = setTimeout(() => { buddy.walking = false; savePet(); }, secs * 1000);
}
function roam(now, state) {
  if (!pet.roam || petDrag || !['idle', 'sad', 'walk'].includes(state)) return;
  if (now < buddy.chaseUntil) return walkTo(buddy.mouseX - buddySize().w / 2);
  if (now < buddy.nextAct || buddy.walking) return;
  const r = Math.random();
  if (r < 0.55) walkTo(Math.random() * innerWidth);
  else if (r < 0.72) buddy.chaseUntil = now + 6000;
  else if (r < 0.82) pet.napUntil = now + 15000;
  buddy.nextAct = now + 9000 + Math.random() * 14000;
}

(function wirePet() {
  const cv = $('#buddy-cv');
  cv.addEventListener('pointerdown', (e) => {
    petDrag = { x: e.clientX, y: e.clientY, px: pet.pos.x, py: pet.pos.y, moved: false };
    cv.setPointerCapture(e.pointerId);
    stopWalk();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!petDrag) return;
    const dx = e.clientX - petDrag.x, dy = e.clientY - petDrag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) petDrag.moved = true;
    if (petDrag.moved) { pet.pos.x = petDrag.px + dx; pet.pos.y = petDrag.py - dy; placeBuddy(true); }
  });
  const end = () => {
    const d = petDrag; petDrag = null;
    if (!d) return;
    if (d.moved) { savePet(); buddy.nextAct = Date.now() + 12000; } else petPoke();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', () => { petDrag = null; });
  cv.addEventListener('dblclick', petTrick);
  addEventListener('mousemove', (e) => { buddy.mouseX = e.clientX; }, { passive: true });
  addEventListener('resize', () => placeBuddy(true));
})();

// ---------- helper jobs: break reminders and the start nudge
function petHelpers(now, dt) {
  if (pomo.running && pomo.mode === 'focus') {
    const before = Math.floor(pet.focusRun / (20 * 60000));
    pet.focusRun += dt;
    const after = Math.floor(pet.focusRun / (20 * 60000));
    if (pet.breaks && after > before) buddySay(REMINDERS[after % REMINDERS.length], 12000);
    return;
  }
  const d = new Date(now);
  if (!pet.nudgeOn || pet.day.minutes > 0 || pet.day.nudges >= 3 || now - pet.day.lastNudge < 15 * 60000) return;
  if (`${pad(d.getHours())}:${pad(d.getMinutes())}` < pet.nudgeTime) return;
  pet.day.nudges++; pet.day.lastNudge = now;
  chime();
  notify(`${pet.name} is waiting`, 'You have not studied yet today. Start one focus block?');
  buddySay(`It is ${fmtTime(d)} and nothing is logged yet. One focus block?`, 20000);
  if (pet.roam && !pet.desktop) walkTo(innerWidth / 2);
  savePet();
}

// ---------- the tick: runs every 700 ms from boot.js
function buddyTick() {
  const now = Date.now(), dt = Math.min(5000, Math.max(0, now - buddy.lastTick));
  buddy.lastTick = now;
  ensureDay();
  petDecay(now);
  if (settings.buddy) petHelpers(now, dt);

  $('#b-buddy').classList.toggle('on', settings.buddy);
  const mood = petMood(), stage = petStage(), el = $('#buddy');
  const state = now < buddy.cheerUntil ? 'cheer' : now < pet.napUntil ? 'sleep'
    : pomo.running ? (pomo.mode === 'focus' ? 'work' : 'sleep') : buddy.walking ? 'walk' : mood.sad ? 'sad' : 'idle';
  const inApp = settings.buddy && !pet.desktop && settings.view !== 'lamp';
  el.hidden = !inApp;
  // Thought bubble with what it needs (not while you focus or it sleeps, and not over a speech bubble).
  const need = petNeed();
  const thinking = settings.buddy && need && !['work', 'sleep'].includes(state) ? need.icon : '';
  const th = $('#buddy-think');
  th.hidden = !thinking || now < buddy.bubbleUntil;
  if (thinking) th.firstChild.textContent = thinking;
  if (need && thinking && need.k !== buddy.need) {
    pet.saidNeed = pet.saidNeed || {};
    if (now - (pet.saidNeed[need.k] || 0) > 3 * 3600000) { pet.saidNeed[need.k] = now; buddySay(need.say, 8000); savePet(); }
  }
  buddy.need = need ? need.k : '';
  th.hidden = !thinking || Date.now() < buddy.bubbleUntil; // never at the same time as words
  if (inApp) {
    if (state !== buddy.state) { for (const c of ['idle', 'work', 'sleep', 'cheer', 'walk', 'sad']) el.classList.toggle(c, c === state); }
    const cv = $('#buddy-cv');
    cv.style.width = PET_W * stage.scale + 'px'; cv.style.height = PET_H * stage.scale + 'px';
    if (!petDrag && !buddy.walking) placeBuddy(false);
    drawPet(cv.getContext('2d'), petLook(), { closed: state === 'sleep' || buddy.blink, sad: mood.sad && state !== 'cheer' });
    buddy.blink = !buddy.blink && state !== 'sleep' && Math.random() < 0.06;
    roam(now, state);
  }
  buddy.state = state;

  // desktop pet window
  const wantDesk = settings.buddy && pet.desktop;
  if (wantDesk !== buddy.deskOn) { buddy.deskOn = wantDesk; buddy.lastSent = ''; stopWalk(); api.pet.desktop(wantDesk); }
  if (wantDesk) {
    const s = { look: petLook(), scale: stage.scale, cls: state, closed: state === 'sleep', sad: mood.sad && state !== 'cheer', bubble: now < buddy.bubbleUntil ? buddy.bubble : '', think: now < buddy.bubbleUntil ? '' : thinking };
    const j = JSON.stringify(s);
    if (j !== buddy.lastSent) { buddy.lastSent = j; api.pet.state(s); }
    // On the desktop the pet strolls along whichever monitor it is on.
    if (pet.roam && (state === 'idle' || state === 'sad') && now > buddy.nextAct) {
      api.pet.walk(Math.random());
      buddy.nextAct = now + 12000 + Math.random() * 20000;
    }
  }

  if (settings.view === 'pet') paintPetLive();
  if (now - buddy.lastSave > 60000) { buddy.lastSave = now; savePet(); }
}

// ---------- the Pet tab
function paintPetLive() {
  const mood = petMood(), stage = petStage();
  drawPet($('#pet-big').getContext('2d'), petLook(), { closed: buddy.state === 'sleep', sad: mood.sad });
  $('#pet-mood').textContent = mood.text;
  $('#pet-stage').textContent = stage.next ? `${stage.name} · grows after ${fmtDur(stage.next - stage.total)} more study` : `${stage.name} · fully grown`;
  for (const k of ['hunger', 'energy', 'joy']) {
    const bar = $(`#pet-bars [data-k=${k}] i`);
    if (bar) { bar.style.width = pet[k] + '%'; bar.parentNode.nextSibling.textContent = Math.round(pet[k]); }
  }
  $('#pet-coins').textContent = `${pet.coins} coins`;
  const need = petNeed();
  $$('#pet-acts [data-act]').forEach((b) => b.classList.toggle('pri', !!need && b.dataset.act === need.fix));
}

function renderPetView() {
  if (settings.view !== 'pet') return;
  $('#pet-name').value = pet.name;
  $('#pet-bars').replaceChildren(...[['hunger', 'Food'], ['energy', 'Energy'], ['joy', 'Happiness']].map(([k, label]) =>
    h('div', { class: 'pbar', 'data-k': k }, h('span', {}, label), h('div', { class: 'pb' }, h('i')), h('b', {}, ''))));
  $('#pet-acts').replaceChildren(
    h('button', { class: 'btn', onclick: petPoke }, 'Pet'),
    h('button', { class: 'btn', 'data-act': 'play', onclick: petPlay }, 'Play'),
    h('button', { class: 'btn', 'data-act': 'treat', onclick: petTreat }, 'Treat · 5'),
    h('button', { class: 'btn', 'data-act': 'nap', onclick: petNap }, 'Nap'));

  $('#pet-quests').replaceChildren(...petQuests().map((q) => {
    const done = q.have >= q.goal, claimed = pet.day.claimed.includes(q.id);
    const bar = h('i'); bar.style.width = Math.min(100, (q.have / q.goal) * 100) + '%';
    const label = q.go ? h('button', { class: 'qlink', title: 'Open it', onclick: q.go }, q.text) : h('span', {}, q.text);
    return h('div', { class: 'quest' + (claimed ? ' got' : '') + (q.id === 'task' ? ' work' : ''), 'data-q': q.id },
      h('div', { class: 'qt' }, label, q.hint && h('small', {}, q.hint), h('div', { class: 'pb' }, bar)),
      h('button', { class: 'btn sm' + (done && !claimed ? ' pri' : ''), disabled: !done || claimed, onclick: () => claimQuest(q) },
        claimed ? 'Claimed' : done ? `Claim ${q.coins}` : `${q.coins} coins`));
  }));

  $('#shop-tabs').replaceChildren(...SHOP_TABS.map(([key, label]) => h('button', {
    class: 'chip-btn' + (buddy.tab === key ? ' on' : ''), onclick: () => { buddy.tab = key; renderPetView(); },
  }, label)));
  $('#shop').replaceChildren(...SHOP[buddy.tab].map(([id, label, price]) => {
    const owned = pet.owned[buddy.tab].includes(id), worn = pet[buddy.tab] === id;
    const cv = h('canvas', { width: PET_W, height: PET_H });
    const look = { ...petLook(), [buddy.tab]: id };
    if (buddy.tab === 'kind' && !worn && SIGNATURE[id]) look.color = SIGNATURE[id];
    if (id === 'custom') look.custom = pet.custom;
    const mine = buddy.tab === 'kind' && id === 'custom';
    if (mine && !pet.custom) { look.kind = 'cat'; look.color = 'grey'; cv.style.opacity = '.35'; }
    drawPet(cv.getContext('2d'), look);
    const tag = mine && !pet.custom ? 'Upload a picture' : worn ? (buddy.tab === 'hat' ? 'Wearing' : 'Chosen') : owned ? 'Owned' : `${price} coins`;
    return h('button', { class: 'item' + (worn ? ' on' : '') + (mine ? ' mine' : ''), title: mine ? 'Turn any picture into your pet' : '', onclick: () => shopClick(buddy.tab, id, price) },
      cv, h('b', {}, label), h('small', {}, tag));
  }), ...(buddy.tab === 'kind' && pet.custom ? [h('button', { class: 'item add', title: 'Use a different picture', onclick: pickPetPicture }, h('span', { class: 'plus' }, '＋'), h('b', {}, 'New picture'), h('small', {}, 'PNG with a plain background works best'))] : []));
  if (buddy.tab === 'color' && pet.kind === 'custom') $('#shop').prepend(h('p', { class: 'hint shop-note' }, 'Colours change the cat, dog and bunny. Your own pet keeps its picture’s colours.'));

  const opt = (label, hint, key, after) => {
    const i = h('input', { type: 'checkbox', class: 'sw' });
    i.checked = !!pet[key];
    i.addEventListener('change', () => { pet[key] = i.checked; savePet(); if (after) after(); buddyTick(); });
    return h('label', { class: 'srow' }, h('span', {}, label, h('small', {}, hint)), i);
  };
  const time = h('input', { type: 'time', 'aria-label': 'Nudge time' });
  time.value = pet.nudgeTime;
  time.addEventListener('change', () => { if (time.value) { pet.nudgeTime = time.value; savePet(); renderPetView(); } });
  $('#pet-opts').replaceChildren(
    opt('Live on my desktop', 'Floats above other windows; drag it anywhere, click it to open Nightdesk', 'desktop', () => placeBuddy(true)),
    opt('Roam around', 'Walks about when you are not focusing, in the app and on the desktop', 'roam', stopWalk),
    opt('Break reminders', 'Water, eyes and stretch tips every 20 focused minutes', 'breaks'),
    opt('Nudge me to start', 'Reminds you up to 3 times if nothing is studied by this time', 'nudgeOn'),
    h('label', { class: 'srow' }, h('span', {}, 'Nudge time'), time));
  paintPetLive();
}

$('#pet-name').addEventListener('change', () => { pet.name = $('#pet-name').value.trim().slice(0, 16) || pet.name; savePet(); renderPetView(); });
on('view', (v) => { if (v === 'pet') renderPetView(); buddyTick(); });
on('subjects', renderPetView);
on('todoist', renderPetView);
on('todo', renderPetView);
$('#buddy-think').addEventListener('click', () => showView('pet'));
on('settings', buddyTick);
api.pet.onOpen(() => showView('pet'));

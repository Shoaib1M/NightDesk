'use strict';
// The desktop pet window: draws whatever state the main Nightdesk window sends, and can be dragged.
// The drag itself is done by the main process (it follows the real cursor), so it works on any
// monitor and scaling; this page only says when a drag starts and ends.
const cv = document.getElementById('cv'), say = document.getElementById('say');
let st = null, blink = false, drag = null, walk = { on: false, flip: false };

function paint() {
  if (!st) return;
  cv.style.width = PET_W * st.scale + 'px';
  cv.style.height = PET_H * st.scale + 'px';
  document.body.className = [st.cls, walk.on ? 'walking' : '', walk.flip ? 'flip' : ''].join(' ');
  drawPet(cv.getContext('2d'), st.look, { closed: st.closed || blink, sad: st.sad });
  say.hidden = !st.bubble;
  say.textContent = st.bubble || '';
}
window.api.pet.onState((s) => { st = s; paint(); });
window.api.pet.onWalk((w) => { walk = { on: !!w.on, flip: w.on ? !!w.flip : walk.flip }; paint(); });
setInterval(() => { blink = !blink && Math.random() < 0.06; paint(); }, 700);

function endDrag(click) {
  const d = drag; drag = null;
  if (!d) return;
  window.api.pet.dragEnd();
  if (click && !d.moved) window.api.pet.click();
}
cv.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { x: e.screenX, y: e.screenY, moved: false };
  try { cv.setPointerCapture(e.pointerId); } catch {}
  window.api.pet.dragStart();
});
cv.addEventListener('pointermove', (e) => {
  if (drag && Math.abs(e.screenX - drag.x) + Math.abs(e.screenY - drag.y) > 5) drag.moved = true;
});
cv.addEventListener('pointerup', () => endDrag(true));
cv.addEventListener('pointercancel', () => endDrag(false));
cv.addEventListener('lostpointercapture', () => endDrag(false));
addEventListener('blur', () => endDrag(false));

// Clicks go through the empty part of this window to whatever is behind it. The main process keeps
// the window click-through and still forwards mouse moves here; while the cursor is over a drawn
// pixel of the pet (or a drag is under way) the window takes clicks.
let hit = false;
function onPet(x, y) {
  const r = cv.getBoundingClientRect();
  if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return false;
  let px = Math.floor(((x - r.left) / r.width) * cv.width);
  const py = Math.floor(((y - r.top) / r.height) * cv.height);
  if (walk.flip) px = cv.width - 1 - px; // the sprite is mirrored on screen while walking left
  const g = cv.getContext('2d');
  // A one-pixel margin round the pet, so the edge of its outline is easy to grab.
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const ax = px + dx, ay = py + dy;
    if (ax >= 0 && ay >= 0 && ax < cv.width && ay < cv.height && g.getImageData(ax, ay, 1, 1).data[3] > 40) return true;
  }
  return false;
}
function setHit(on) { if (on !== hit) { hit = on; window.api.pet.hit(on); } }
addEventListener('mousemove', (e) => setHit(!!drag || onPet(e.clientX, e.clientY)));
document.addEventListener('mouseleave', () => { if (!drag) setHit(false); });
window.__petHitAt = onPet; // tests

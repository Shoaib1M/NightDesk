'use strict';
// The desktop pet window: draws whatever state the main Nightdesk window sends, and can be dragged.
const cv = document.getElementById('cv'), say = document.getElementById('say');
let st = null, blink = false, drag = null;

function paint() {
  if (!st) return;
  cv.style.width = PET_W * st.scale + 'px';
  cv.style.height = PET_H * st.scale + 'px';
  document.body.className = st.cls;
  drawPet(cv.getContext('2d'), st.look, { closed: st.closed || blink, sad: st.sad });
  say.hidden = !st.bubble;
  say.textContent = st.bubble || '';
}
window.api.pet.onState((s) => { st = s; paint(); });
setInterval(() => { blink = !blink && Math.random() < 0.06; paint(); }, 700);

cv.addEventListener('pointerdown', (e) => {
  drag = { x: e.screenX, y: e.screenY, moved: false };
  cv.setPointerCapture(e.pointerId);
  window.api.pet.dragStart();
});
cv.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.x, dy = e.screenY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
  if (drag.moved) window.api.pet.drag(dx, dy);
});
cv.addEventListener('pointerup', () => {
  const d = drag; drag = null;
  if (!d) return;
  if (d.moved) window.api.pet.dragEnd(); else window.api.pet.click();
});
cv.addEventListener('pointercancel', () => { drag = null; });

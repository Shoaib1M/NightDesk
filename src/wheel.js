'use strict';
// iOS-style wheel picker column. Spin it with the mouse wheel or trackpad, drag and flick it,
// click a value, or use the arrow keys. Looping columns (hours, minutes) wrap around forever.
//   const w = wheel({ items: ['1', '2', ...], loop: true, onChange: (index) => ... });
//   el.append(w.el); w.set(index); w.get();
const WHEEL_ROW = 40;     // px per row
const WHEEL_SHOW = 3;     // rows drawn above and below the centre

function wheel({ items, loop = true, label = '', onChange = () => {} }) {
  const n = items.length;
  const el = document.createElement('div');
  el.className = 'wheel-col' + (loop ? '' : ' fixed');
  el.tabIndex = 0;
  el.setAttribute('role', 'spinbutton');
  el.setAttribute('aria-label', label);
  const rows = [];
  for (let k = -WHEEL_SHOW - 1; k <= WHEEL_SHOW + 1; k++) { const r = document.createElement('div'); r.className = 'wheel-item'; el.append(r); rows.push(r); }

  let pos = 0, target = 0, raf = 0, last = -1;
  const wrap = (i) => ((i % n) + n) % n;
  const clamp = (p) => (loop ? p : Math.max(0, Math.min(n - 1, p)));
  // The value follows where the wheel is heading, so it is right at once, even mid-animation.
  const index = () => wrap(Math.round(target));

  function draw() {
    const base = Math.round(pos);
    rows.forEach((r, j) => {
      const i = base + j - WHEEL_SHOW - 1;
      const off = i - pos;                       // rows away from the centre
      const visible = Math.abs(off) <= WHEEL_SHOW + 0.5 && (loop || (i >= 0 && i < n));
      r.style.visibility = visible ? '' : 'hidden';
      if (!visible) return;
      r.textContent = items[wrap(i)];
      r.dataset.i = i;
      const a = Math.max(-80, Math.min(80, off * 22)); // drum curve, like a real wheel
      r.style.transform = `translateY(${Math.sin((a * Math.PI) / 180) * WHEEL_ROW * 2.6}px) rotateX(${-a}deg)`;
      r.style.opacity = String(Math.max(0, 1 - Math.abs(off) * 0.27));
      r.classList.toggle('mid', Math.abs(off) < 0.5);
    });
    el.setAttribute('aria-valuetext', items[wrap(Math.round(pos))]);
  }
  function settle() {
    const i = index();
    if (i !== last) { last = i; onChange(i); }
  }
  function animate() {
    cancelAnimationFrame(raf);
    const step = () => {
      const d = target - pos;
      if (Math.abs(d) < 0.002) { pos = target; draw(); return; }
      pos += d * 0.2;
      draw();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  const go = (t) => { target = clamp(Math.round(t)); settle(); animate(); };

  // Mouse wheel / trackpad: one notch = one row, a fast spin moves several.
  let acc = 0;
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    let steps;
    if (Math.abs(dy) >= 50) { acc = 0; steps = Math.sign(dy) * Math.max(1, Math.round(Math.abs(dy) / 100)); } // mouse: a notch is ~100
    else { acc += dy; steps = Math.trunc(acc / 40); acc -= steps * 40; }                                    // trackpad: small, smooth deltas
    if (steps) go(target + Math.sign(steps) * Math.min(Math.abs(steps), 6));
  }, { passive: false });

  // Drag and flick.
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    cancelAnimationFrame(raf);
    drag = { y: e.clientY, start: pos, moved: false, t: e.timeStamp, v: 0, ly: e.clientY, lt: e.timeStamp };
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.focus();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 3) drag.moved = true;
    const dt = Math.max(1, e.timeStamp - drag.lt);
    drag.v = (e.clientY - drag.ly) / dt; drag.ly = e.clientY; drag.lt = e.timeStamp;
    pos = target = clamp(drag.start - dy / WHEEL_ROW);
    draw();
  });
  const end = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) { // a click: jump to the row that was clicked
      const r = e.target.closest && e.target.closest('.wheel-item');
      go(r && r.dataset.i != null ? Number(r.dataset.i) : pos);
      return;
    }
    go(pos - (d.v * 260) / WHEEL_ROW); // flick keeps spinning a little, then snaps
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  el.addEventListener('keydown', (e) => {
    const k = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
    if (k) { e.preventDefault(); go(target + k); }
  });

  draw();
  const api = {
    el,
    // Ends any animation at once (tests; hidden windows do not animate).
    finish() { cancelAnimationFrame(raf); pos = target; draw(); },
    get: index,
    // Jumps straight to a value without animating (used when the form resets).
    set(i, quiet) { cancelAnimationFrame(raf); pos = target = loop ? i : clamp(i); last = quiet ? index() : last; draw(); if (!quiet) settle(); },
  };
  el.wheel = api;
  return api;
}

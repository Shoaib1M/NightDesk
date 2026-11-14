// The iOS-style alarm time wheels:  node scripts/run-tests.js smoke-wheel.js
(async () => {
  const fails = [];
  let count = 0;
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async () => { await wait(50); document.querySelectorAll('#al-wheel .wheel-col').forEach((c) => c.wheel.finish()); };
  showView('alarm');
  await wait(200);
  const cols = () => [...document.querySelectorAll('#al-wheel .wheel-col')];
  const time = () => $('#al-time').value;
  const key = (el, k, times = 1) => { for (let i = 0; i < times; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); };
  const spin = (el, dy) => el.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true }));

  // 12-hour wheels.
  settings.h24 = false; saveSettings(); emit('settings');
  check('12-hour clock: hour, minute and AM/PM wheels', cols().length === 3, cols().length);
  check('starts at 7:00 AM', time() === '07:00', time());
  check('says when it would ring', /^Rings in /.test($('#al-in').textContent), $('#al-in').textContent);

  const [hw, mw, aw] = cols();
  key(mw, 'ArrowDown', 30); await settle();
  check('arrow keys move the minute wheel', time() === '07:30', time());
  key(aw, 'ArrowDown'); await settle();
  check('AM/PM wheel switches to PM', time() === '19:30', time());
  key(aw, 'ArrowDown', 3); await settle();
  check('AM/PM wheel stops at the end (does not loop)', time() === '19:30', time());
  key(hw, 'ArrowDown', 5); await settle();
  check('hour wheel 7 -> 12 with PM reads 12:30 PM', time() === '12:30', time());
  key(hw, 'ArrowUp', 13); await settle();
  check('hour wheel loops around backwards', time() === '23:30', time());
  key(mw, 'ArrowDown', 45); await settle();
  check('minute wheel loops around (30 + 45 = 15)', time() === '23:15', time());

  // Mouse wheel: one notch = one row; a big spin moves several rows, never more than 6 at once.
  spin(mw, 100); await settle();
  check('one mouse-wheel notch moves one minute', time() === '23:16', time());
  spin(mw, -100); await settle();
  check('scrolling up goes back', time() === '23:15', time());
  spin(mw, 2000); await settle();
  check('a huge spin is capped (6 rows per event)', time() === '23:21', time());

  // Clicking a row selects it.
  const items = [...mw.querySelectorAll('.wheel-item')];
  const mid = items.find((r) => r.classList.contains('mid'));
  const below = items.find((r) => mid && Number(r.dataset.i) === Number(mid.dataset.i) + 2);
  if (!below) return JSON.stringify({ checks: count, failed: [...fails, 'no row two below the middle: ' + JSON.stringify(items.map((r) => [r.textContent, r.dataset.i, r.className, r.style.visibility]))] }, null, 1);
  below.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientY: 100, bubbles: true, pointerId: 1 }));
  below.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientY: 100, bubbles: true, pointerId: 1 }));
  await settle();
  check('clicking a row picks it', time() === '23:23', time());

  // Dragging: 3 rows down in the drag = 3 minutes earlier.
  const r = mw.getBoundingClientRect(), y0 = r.top + r.height / 2;
  mw.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientY: y0, bubbles: true, pointerId: 2 }));
  for (let i = 1; i <= 12; i++) { mw.dispatchEvent(new PointerEvent('pointermove', { button: 0, buttons: 1, clientY: y0 + i * 10, bubbles: true, pointerId: 2 })); await wait(40); }
  await wait(150); // stop before letting go: no flick
  mw.dispatchEvent(new PointerEvent('pointermove', { button: 0, buttons: 1, clientY: y0 + 120, bubbles: true, pointerId: 2 }));
  mw.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientY: y0 + 120, bubbles: true, pointerId: 2 }));
  await settle();
  check('dragging down 3 rows goes back 3 minutes', time() === '23:20', time());

  // Adding the alarm uses the wheel's time.
  const before = alarms.length;
  $('#al-label').value = 'Wheel test';
  $('#al-form').requestSubmit();
  const added = alarms[alarms.length - 1];
  check('Add alarm saves the time on the wheels', alarms.length === before + 1 && added.time === '23:20' && added.label === 'Wheel test', added);
  check('the list shows it as 11:20 PM', $('#al-list').textContent.includes('11:20PM'), $('#al-list').textContent);

  // 24-hour wheels keep the chosen time.
  settings.h24 = true; saveSettings(); emit('settings');
  check('24-hour clock: hour and minute wheels only', cols().length === 2, cols().length);
  check('the chosen time survives switching to 24-hour', time() === '23:20', time());
  key(cols()[0], 'ArrowDown'); await settle();
  check('24-hour hour wheel goes 23 -> 00', time() === '00:20', time());
  settings.h24 = false; saveSettings(); emit('settings');
  check('and back to 12-hour shows 12:20 AM', time() === '00:20' && cols().length === 3, time());

  alarms.splice(before); renderAlarms();
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

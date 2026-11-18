// Timer set with hours / minutes / seconds wheels:  node scripts/run-tests.js smoke-timer.js
(async () => {
  const fails = [], errors = [];
  let count = 0;
  addEventListener('error', (e) => errors.push(e.message));
  addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const check = (name, ok, info) => { count++; try { if (!(typeof ok === 'function' ? ok() : ok)) fails.push(`${name} -> ${JSON.stringify(info)}`); } catch (e) { fails.push(`${name} threw ${e.message}`); } };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const W = () => timerWheels;
  const finish = () => Object.values(W()).forEach((w) => w.finish());
  const key = (w, k, times = 1) => { for (let i = 0; i < times; i++) w.el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); finish(); };
  const chip = (label) => [...$$('#t-chips .chip-btn')].find((b) => b.textContent === label);

  showView('timer'); await wait(50);
  check('the timer shows three wheels: hours, minutes, seconds', $$('#t-wheel .wheel-col').length === 3 && $('#t-wheel').textContent.includes('hours'));
  check('it starts on the wheels, not the countdown', !$('#t-pick').hidden && $('#t-run').hidden);
  check('presets go up to 3 hours', ['1 h', '1 h 30', '2 h', '3 h'].every((l) => chip(l)));

  chip('3 h').click(); finish();
  check('3 h sets a three-hour timer', tm.total === 3 * 3600000 && W().h.get() === 3 && W().m.get() === 0 && W().s.get() === 0, [tm.total, W().h.get()]);
  check('and its chip lights up', chip('3 h').classList.contains('on') && !chip('2 h').classList.contains('on'));
  check('it says when it will end', /^Ends at /.test($('#t-ends').textContent), $('#t-ends').textContent);

  // Spin the wheels: 3 h → 2 h, then 30 min and 15 s.
  key(W().h, 'ArrowUp');
  key(W().m, 'PageDown', 6);
  key(W().s, 'ArrowDown', 15);
  check('spinning the wheels sets the time', tm.total === (2 * 3600 + 30 * 60 + 15) * 1000, tm.total);
  check('a length that is not a preset lights no chip', ![...$$('#t-chips .chip-btn')].some((b) => b.classList.contains('on')));
  check('the length is remembered', store.get('timerLen', 0) === tm.total);
  W().h.set(23); W().m.set(59); W().s.set(59);
  check('up to 23 h 59 min 59 s', tm.total === (23 * 3600 + 59 * 60 + 59) * 1000);
  check('anything longer is capped', (() => { timerSet(99 * 3600000); return tm.total === TIMER_MAX && W().h.get() === 23; })());
  chip('1 h 30').click(); finish();
  check('1 h 30 moves the wheels to 1 : 30 : 0', W().h.get() === 1 && W().m.get() === 30 && W().s.get() === 0);

  // Start, pause, resume, reset.
  $('#t-go').click();
  check('Start shows the big countdown instead', $('#t-pick').hidden && !$('#t-run').hidden && tm.running);
  check('hours show in the countdown', /^1:(30|29):\d\d$/.test($('#t-time').textContent), $('#t-time').textContent);
  $('#t-go').click();
  check('Pause, then it offers Resume', !tm.running && $('#t-go').textContent === 'Resume' && $('#t-pick').hidden);
  $('#t-go').click();
  check('Resume carries on', tm.running && $('#t-go').textContent === 'Pause');
  $('#t-reset').click();
  check('Reset goes back to the wheels with the same length', !tm.running && !$('#t-pick').hidden && tm.total === 90 * 60000 && W().h.get() === 1 && W().m.get() === 30);
  check('on the wheels the button says Clear', $('#t-reset').textContent === 'Clear');
  $('#t-reset').click(); finish();
  check('Clear sets the wheels to zero and Start waits for a time', tm.total === 0 && W().h.get() === 0 && W().m.get() === 0 && $('#t-go').disabled && /Spin the wheels/.test($('#t-ends').textContent));
  $('#t-go').click();
  check('a zero timer cannot start', !tm.running);
  check('code cannot set zero, negative or NaN by accident', (() => { timerSet(60000); timerSet(0); timerSet(-5); timerSet(NaN); return tm.total === 60000; })());

  // Finishing.
  timerSet(5000); timerToggle(); tm.endAt = Date.now() - 1; tickTimer();
  check('when it finishes, the countdown stays up showing 00:00', tm.done && !$('#t-run').hidden && $('#t-time').textContent === '00:00' && $('#t-time').classList.contains('done'));
  check('Start runs it again', (() => { timerToggle(); const ok = tm.running && tm.left > 4000; timerToggle(); return ok; })());
  $('#t-reset').click();
  check('Reset after finishing goes back to the wheels', !$('#t-pick').hidden && tm.total === 5000);
  check('Space starts the timer on this tab', (() => { emit('space', 'timer'); const ok = tm.running; emit('space', 'timer'); return ok && !tm.running; })());

  showView('clock');
  return JSON.stringify({ checks: count, failed: fails, pageErrors: errors }, null, 1);
})();

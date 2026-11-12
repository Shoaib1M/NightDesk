// Edge-case checks run inside the app window:
//   NIGHTDESK_SHOTS=<dir> NIGHTDESK_EVAL=scripts/smoke-edge.js electron .
// Prints a list of FAILED checks (empty means everything passed).
(async () => {
  const fails = [], errors = [];
  let count = 0;
  addEventListener('error', (e) => errors.push(e.message));
  addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const check = (name, fn) => { count++; try { const v = fn(); if (v !== true) fails.push(`${name} -> ${JSON.stringify(v)}`); } catch (err) { fails.push(`${name} threw ${err.message}`); } };
  const today = new Date();

  // ----- navigation and toggles
  check('every view opens', () => { VIEWS.forEach(([v]) => showView(v)); return true; });
  check('unknown view falls back to clock', () => { showView('nope'); return settings.view === 'clock'; });
  check('quotes button keeps the current view', () => {
    showView('focus'); const was = settings.quotes;
    $('#b-quote').click(); const a = settings.view; $('#b-quote').click();
    return a === 'focus' && settings.view === 'focus' && settings.quotes === was;
  });
  check('buddy and theme buttons keep the view', () => {
    showView('study'); $('#b-buddy').click(); $('#b-buddy').click(); $('#b-theme').click(); $('#b-theme').click();
    return settings.view === 'study';
  });
  check('settings opens and closes on every view', () => { VIEWS.forEach(([v]) => { showView(v); openSettings(); closeSettings(); }); return $('#modal').hidden; });

  // ----- damaged saved data
  check('non-array where a list is expected', () => { localStorage.setItem('nd.zz', '{"a":1}'); return store.get('zz', []).length === 0; });
  check('garbage JSON', () => { localStorage.setItem('nd.zz', '{oops'); return store.get('zz', 5) === 5; });
  check('wrong type', () => { localStorage.setItem('nd.zz', '"text"'); return store.get('zz', 0.6) === 0.6; });
  check('null value', () => { localStorage.setItem('nd.zz', 'null'); return store.get('zz', 'x') === 'x'; });
  localStorage.removeItem('nd.zz');

  // ----- formatting
  check('fmtMs negative', () => fmtMs(-500) === '00:00');
  check('fmtMs over an hour', () => fmtMs(3725000) === '1:02:05');
  check('fmtDur', () => fmtDur(0) === '0m' && fmtDur(60) === '1h' && fmtDur(135) === '2h 15m');
  check('fmtRel', () => fmtRel(-5) === 'in 0 min' && fmtRel(90 * 60000) === 'in 1h 30m' && fmtRel(49 * 3600000) === 'in 2d 1h');

  // ----- focus timer
  study.log = [];
  settings.focusMin = 50; settings.breakMin = 10; settings.longMin = 20; settings.longEvery = 4; settings.autoStart = true;
  pomo.round = 1; pomoSet('focus');
  check('pause keeps the remaining time', () => { pomoToggle(); pomo.endAt -= 60000; tickPomo(); pomoToggle(); const l = pomo.left; tickPomo(); return !pomo.running && pomo.left === l && l < pomo.dur; });
  check('changing settings mid-block does not reset it', () => { const l = pomo.left; settings.focusMin = 30; emit('settings'); settings.focusMin = 50; return pomo.left === l; });
  check('reset logs the minutes already done', () => { pomo.left = pomo.dur - 5 * 60000; pomoReset(); return study.log.length === 1 && study.log[0].m === 5 && pomo.left === pomo.dur; });
  check('reset under a minute logs nothing', () => { pomo.left = pomo.dur - 20000; pomoReset(); return study.log.length === 1; });
  check('PC asleep for hours: one block, then a fresh break', () => {
    pomoToggle(); pomo.endAt = Date.now() - 3 * 3600000; tickPomo();
    return pomo.mode === 'break' && pomo.running && pomo.left > 9 * 60000 && study.log.length === 2 && study.log[1].m === 50;
  });
  check('skipping a break starts round 2 without logging', () => { pomoAdvance(false); return pomo.mode === 'focus' && pomo.round === 2 && !pomo.running && study.log.length === 2; });
  check('long break after round 4', () => { pomo.round = 4; pomoSet('focus'); pomoAdvance(false); return pomo.dur === 20 * 60000; });
  check('long breaks switched off', () => { settings.longEvery = 0; pomo.round = 4; pomoSet('focus'); pomoAdvance(false); const ok = pomo.dur === 10 * 60000; settings.longEvery = 4; return ok; });
  check('auto-start off waits for you', () => { settings.autoStart = false; pomoSet('focus'); pomoToggle(); pomo.endAt = Date.now() - 1; tickPomo(); const ok = !pomo.running && pomo.mode === 'break'; settings.autoStart = true; return ok; });
  check('deleted subject still logs', () => {
    study.subjects.push({ id: 'tmp', name: 'Tmp', color: '#fff', goal: 60 }); saveSubjects(); $('#p-subj').value = 'tmp';
    study.subjects = study.subjects.filter((s) => s.id !== 'tmp'); saveSubjects();
    pomoSet('focus'); pomo.left = pomo.dur - 2 * 60000; const n = study.log.length; pomoReset();
    return $('#p-subj').value === '' && study.log.length === n + 1 && study.log.at(-1).s === '';
  });
  pomo.round = 1; pomoSet('focus'); renderPomo();

  // ----- countdown timer and stopwatch
  check('timer ignores zero, negative and NaN', () => { timerSet(60000); timerSet(0); timerSet(-5); timerSet(NaN); return tm.total === 60000; });
  check('timer restarts after finishing', () => { timerToggle(); tm.endAt = Date.now() - 1; tickTimer(); const done = tm.left === 0 && !tm.running; timerToggle(); const again = tm.running && tm.left > 59000; timerToggle(); return done && again; });
  check('stopwatch lap at zero is ignored, reset clears', () => { $('#s-reset').click(); $('#s-lap').click(); const none = sw.laps.length === 0; swToggle(); sw.startAt -= 5000; $('#s-lap').click(); $('#s-reset').click(); return none && sw.acc === 0 && sw.laps.length === 0 && !sw.running; });

  // ----- alarms
  alarms.length = 0; ring.snoozes.length = 0;
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  check('one-off alarm whose time has passed rings tomorrow', () => { const n = alarmNext({ time: hm(new Date(Date.now() - 3600000)), days: [] }); return n > new Date() && n - Date.now() < 24 * 3600000; });
  check('repeating alarm lands on an allowed weekday', () => { const day = (today.getDay() + 3) % 7; return alarmNext({ time: '06:30', days: [day] }).getDay() === day; });
  check('repeat labels', () => repeatText({ days: [] }) === 'Once' && repeatText({ days: [1, 2, 3, 4, 5] }) === 'Weekdays' && repeatText({ days: [0, 6] }) === 'Weekends' && repeatText({ days: [0, 1, 2, 3, 4, 5, 6] }) === 'Every day');
  if (new Date().getSeconds() > 50) await wait(11000); // keep the whole sequence inside one minute
  const nowD = new Date();
  alarms.push({ id: 'a', time: hm(nowD), label: 'A', days: [], on: true, last: '' }, { id: 'b', time: hm(nowD), label: 'B', days: [nowD.getDay()], on: true, last: '' });
  ring.snoozes.push({ at: Date.now() - 1, label: 'S' });
  tickAlarms();
  check('first alarm rings, the others wait', () => ring.alarm && ring.alarm.label === 'A' && ring.snoozes.length === 1 && alarms[1].last === '');
  check('one-off switches itself off, repeating stays on', () => alarms[0].on === false && alarms[1].on === true);
  await wait(1500);
  await api.alarm.action('stop'); await wait(300);
  tickAlarms();
  check('second alarm rings after the first is stopped', () => !!ring.alarm && ring.alarm.label === 'B');
  await wait(1500);
  await api.alarm.action('snooze'); await wait(300);
  // The app's own 250 ms tick may already have started the overdue snooze "S" by now; both are correct.
  check('snooze queues it again', () => (!ring.alarm && ring.snoozes.length === 2) || (ring.alarm.label === 'S' && ring.snoozes.some((s) => s.label === 'B')));
  tickAlarms();
  check('the overdue snooze rings next', () => !!ring.alarm && ring.alarm.label === 'S' && ring.snoozes.length === 1);
  check('deleting an alarm while one rings is safe', () => { alarms.length = 0; renderAlarms(); return true; });
  await wait(1500);
  await api.alarm.hide(); ringStop(); ring.snoozes.length = 0; renderAlarms();
  check('nothing left ringing', () => !ring.alarm && !ring.timer);

  // ----- calendar
  store.set('events', []);
  const at = (d, h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
  const tomorrow = addDays(today, 1);
  await saveEvent({ title: 'Late', allDay: false, start: at(today, 23).toISOString(), end: at(tomorrow, 1).toISOString() }, null);
  await saveEvent({ title: 'Exam', allDay: true, start: ymd(today), end: ymd(tomorrow) }, null);
  await saveEvent({ title: 'Instant', allDay: false, start: at(today, 9).toISOString(), end: at(today, 9).toISOString() }, null);
  const on = (d) => eventsOn(allEvents().filter((e) => e.src === 'local'), new Date(d.getFullYear(), d.getMonth(), d.getDate())).map((e) => e.title).sort().join();
  check('event past midnight shows on both days', () => on(today) === 'Exam,Instant,Late' && on(tomorrow) === 'Late');
  check('all-day event does not leak into the next day', () => !on(tomorrow).includes('Exam'));
  cal.sel = ymd(today); showView('calendar'); resetEventForm();
  $('#ev-title').value = 'Overnight'; $('#ev-start').value = '22:00'; $('#ev-end').value = '02:00';
  $('#ev-form').requestSubmit(); await wait(300);
  check('end before start is treated as next day', () => { const e = localEvents().find((x) => x.title === 'Overnight'); return !!e && new Date(e.end) - new Date(e.start) === 4 * 3600000; });
  $('#ev-title').value = '   '; $('#ev-form').requestSubmit(); await wait(200);
  check('blank title is not saved', () => localEvents().length === 4);
  check('editing keeps one copy', () => { editEvent(allEvents().find((e) => e.title === 'Exam')); return cal.editing.title === 'Exam'; });
  $('#ev-title').value = 'Exam 2'; $('#ev-form').requestSubmit(); await wait(300);
  check('edit saved', () => localEvents().length === 4 && localEvents().some((e) => e.title === 'Exam 2') && cal.editing === null);
  check('month steps across the year end', () => { cal.month = new Date(2026, 11, 1); moveMonth(1); const a = cal.month.getFullYear() === 2027 && cal.month.getMonth() === 0; moveMonth(-2); return a && cal.month.getFullYear() === 2026 && cal.month.getMonth() === 10; });
  check('leap day renders', () => { cal.month = new Date(2028, 1, 1); renderCal(); return $$('#cal-grid .day').length === 42; });
  cal.month = new Date(today.getFullYear(), today.getMonth(), 1); store.set('events', []); renderCal();

  // ----- study stats
  study.log = [];
  check('empty log gives sane numbers', () => { const s = studyStats(); return s.today === 0 && s.streak === 0 && s.level === 1 && s.levelTo === 30 && !Number.isNaN(s.week); });
  check('zero and negative minutes are ignored', () => { logStudy(0, ''); logStudy(-5, ''); logStudy(0.4, ''); return study.log.length === 0; });
  for (const back of [0, 1, 2, 4, 5]) study.log.push({ t: Date.now() - back * 864e5, m: 60, s: 's1' });
  check('streak stops at the gap', () => { const s = studyStats(); return s.streak === 3 && s.best === 3 && s.total === 300; });
  check('streak survives a day not yet studied', () => { study.log = study.log.filter((e) => Date.now() - e.t > 3600000); return studyStats().streak === 2; });
  check('hostile subject name is shown as text', () => {
    study.subjects.push({ id: 'x', name: '<img src=x onerror=alert(1)>', color: '#fff', goal: 60 }); saveSubjects(); showView('study'); renderStudy();
    const safe = !$('#subj-list img') && !$('#p-subj img') && !$('#stats img');
    study.subjects = study.subjects.filter((s) => s.id !== 'x'); saveSubjects();
    return safe;
  });
  check('target cannot go below zero or above 12h', () => {
    showView('study'); renderStudy();
    for (let i = 0; i < 40; i++) $('#subj-list .step button').click();
    const low = study.subjects[0].goal === 0;
    for (let i = 0; i < 40; i++) $$('#subj-list .step button')[1].click();
    const high = study.subjects[0].goal === 720;
    study.subjects[0].goal = 120; saveSubjects();
    return low && high;
  });
  study.log = [];

  // ----- quotes
  check('quote list wraps both ways', () => { quote.i = 0; cycleQuote(-1); const a = quote.i === allQuotes().length - 1; cycleQuote(1); return a && quote.i === 0; });
  check('auto-rotate off when set to 0', () => { settings.quotes = true; settings.quoteMin = 0; quote.changedAt = 0; const i = quote.i; tickQuote(); settings.quoteMin = 2; return quote.i === i; });
  await fetchQuotes(true); const n1 = allQuotes().length; await fetchQuotes(true);
  check('fetching twice adds no duplicates', () => allQuotes().length >= n1 && new Set(allQuotes().map(([q]) => q.toLowerCase())).size === allQuotes().length);
  check('index past the end is recovered', () => { quote.i = 99999; renderQuote(); return quote.i < allQuotes().length; });

  // ----- sounds and lamp
  check('rapid sound toggling', () => { for (let i = 0; i < 6; i++) SOUNDS.forEach(([id]) => soundSet(id, i % 2 === 0)); return Object.keys(mix.live).length === 0; });
  check('sound menu opens and closes', () => { toggleSoundPop(true); toggleSoundPop(false); return $('#sound-pop').hidden; });
  check('lamp colour and brightness', () => { lamp.color = '#ff8040'; lamp.bright = 50; applyLamp(); const ok = $('#v-lamp').style.background === 'rgb(128, 64, 32)'; lamp.color = '#ffffff'; lamp.bright = 100; applyLamp(); return ok; });

  await wait(600);
  showView('clock');
  return JSON.stringify({ checks: count, failed: fails, pageErrors: errors }, null, 1);
})();

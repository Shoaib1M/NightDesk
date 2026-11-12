// Behaviour check run inside the app window: NIGHTDESK_SHOTS=<dir> NIGHTDESK_EVAL=scripts/smoke.js electron .
(async () => {
  const r = {};
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  // focus block finishes -> logged against the subject, switches to break and auto-starts
  settings.focusMin = 1; pomoSet('focus'); $('#p-subj').value = 's1';
  pomoToggle(); pomo.endAt = Date.now() - 10; tickPomo();
  r.afterFocus = { mode: pomo.mode, running: pomo.running, logged: study.log.at(-1).m, subject: study.log.at(-1).s };
  pomoAdvance(false);
  r.afterSkip = { mode: pomo.mode, round: pomo.round };
  r.today = studyStats().today;

  // countdown timer and stopwatch
  timerSet(1000); timerToggle(); tm.endAt = Date.now() - 1; tickTimer();
  r.timerDone = $('#t-time').classList.contains('done') && !tm.running;
  swToggle(); await wait(150); swToggle();
  r.stopwatch = sw.acc >= 100;

  // one-off alarm due this minute -> rings, switches itself off, snooze re-queues it
  const d = new Date();
  alarms.push({ id: 'x', time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, label: 'T', days: [], on: true, last: '' });
  tickAlarms();
  r.alarm = { ringing: !!ring.alarm, oneOffTurnedOff: alarms[0].on === false };
  await wait(2500);
  await api.alarm.action('snooze');
  await wait(400);
  r.snooze = { stopped: !ring.alarm, queued: ring.snoozes.length };

  // sounds
  SOUNDS.forEach(([id]) => soundSet(id, true));
  r.soundsPlaying = Object.keys(mix.live).length;
  SOUNDS.forEach(([id]) => soundSet(id, false));

  // local calendar event
  await saveEvent({ title: 'Exam', allDay: true, start: ymd(new Date()), end: ymd(addDays(new Date(), 1)) }, null);
  r.eventsToday = eventsOn(allEvents(), parseYmd(ymd(new Date()))).map((e) => e.title);

  r.gcal = (await api.gcal.status()).data;
  r.spotify = (await api.spotify.status()).data;
  r.contests = cal.contests.length;
  return JSON.stringify(r, null, 1);
})();

// Travelling between time zones:  node scripts/run-tests.js smoke-tz.js
(async () => {
  const fails = [];
  let count = 0;
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  const today = ymd(new Date()), yesterday = ymd(addDays(new Date(), -1));

  // New sessions remember the local day they happened on.
  study.log = [];
  logStudy(45, '');
  check('a new session records the day it happened', study.log[0].d === today && store.get('log', [])[0].d === today, study.log[0]);

  // A session done late at night somewhere else: its moment falls on "today" here, but it was
  // done yesterday where you were (for example 11:30 PM in Dubai is 1:00 AM in India).
  const lateNight = new Date(); lateNight.setHours(0, 30, 0, 0);
  study.log = [{ t: lateNight.getTime(), m: 90, s: '', d: yesterday }];
  let st = studyStats();
  check('it stays on the day it happened, not the day the clock here says', st.byDay.get(yesterday) === 90 && !st.byDay.get(today), [...st.byDay]);
  check('so "Today" is not inflated by it', st.today === 0, st.today);

  // A streak built while travelling across zones is not broken by the moments shifting.
  const day = (n) => ymd(addDays(new Date(), -n));
  const moment = (n, h) => { const x = addDays(new Date(), -n); x.setHours(h, 0, 0, 0); return x.getTime(); };
  study.log = [
    { t: moment(2, 23), m: 60, s: '', d: day(2) },
    { t: moment(0, 0) + 30 * 60000, m: 60, s: '', d: day(1) }, // logged just after midnight here, but it was still the previous evening there
    { t: moment(0, 10), m: 60, s: '', d: day(0) },
  ];
  st = studyStats();
  check('a 3-day streak across time zones stays a 3-day streak', st.streak === 3 && st.best === 3, { streak: st.streak, best: st.best });

  // Sessions saved by older versions get the day they show now, once, and keep it.
  study.log = [{ t: moment(1, 15), m: 30, s: '' }, { t: moment(0, 9), m: 20, s: '', d: today }];
  const stamped = stampSessionDays();
  check('older sessions are stamped with their day', stamped === 1 && study.log[0].d === day(1) && study.log[1].d === today, study.log);
  check('stamping happens only once', stampSessionDays() === 0, null);
  check('stamped days are saved', store.get('log', []).every((e) => !!e.d), store.get('log', []));

  // Calendar: timed events are exact moments (shown in local time), all-day events and sticky notes keep their date.
  store.set('events', [
    { id: 'tz1', title: 'All day exam', allDay: true, start: today, end: ymd(addDays(new Date(), 1)) },
    { id: 'tz2', title: 'Timed call', allDay: false, start: new Date(moment(0, 15)).toISOString(), end: new Date(moment(0, 16)).toISOString() },
  ]);
  const ev = localEvents();
  check('all-day events are stored as a plain date (never shift)', ev[0].start === today && !/T/.test(ev[0].start), ev[0]);
  check('timed events are stored as exact moments (shown in local time)', /Z$/.test(ev[1].start), ev[1]);

  study.log = []; store.set('log', []); store.set('events', []);
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

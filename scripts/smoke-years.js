// Nothing is lost when the year changes:  node scripts/run-tests.js smoke-years.js
(async () => {
  const fails = [];
  let count = 0;
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  const at = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh).getTime();

  // Calendar events and sticky notes in three different years
  store.set('events', [
    { id: 'y1', title: 'New Year 2025', allDay: true, start: '2025-01-01', end: '2025-01-02' },
    { id: 'y2', title: 'NYE party', allDay: false, start: new Date(at(2026, 12, 31, 22)).toISOString(), end: new Date(at(2027, 1, 1, 2)).toISOString() },
    { id: 'y3', title: 'Exam 2027', allDay: true, start: '2027-03-10', end: '2027-03-11' },
  ]);
  store.set('dayFills', { '2025-01-01': 'yellow', '2026-12-31': 'pink', '2027-01-01': 'mint', '2030-06-15': 'sky' });
  showView('calendar');
  const titlesOn = (y, m, d) => eventsOn(allEvents().filter((e) => e.src === 'local'), new Date(y, m - 1, d)).map((e) => e.title);
  check('an event from two years ago is still there', titlesOn(2025, 1, 1).includes('New Year 2025'), titlesOn(2025, 1, 1));
  check('an event that crosses midnight on New Year shows on both days', titlesOn(2026, 12, 31).includes('NYE party') && titlesOn(2027, 1, 1).includes('NYE party'), null);
  check('an event next year is there', titlesOn(2027, 3, 10).includes('Exam 2027'), null);
  for (const [y, m, key, colour] of [[2025, 1, '2025-01-01', 'yellow'], [2026, 12, '2026-12-31', 'pink'], [2027, 1, '2027-01-01', 'mint'], [2030, 6, '2030-06-15', 'sky']]) {
    cal.month = new Date(y, m - 1, 1); renderCal();
    const cell = $$('#cal-grid .day')[Math.round((parseYmd(key) - gridStart()) / 864e5)];
    check(`sticky note on ${key} shows when you go to that month`, cell && cell.classList.contains('filled') && dayFills()[key] === colour, key);
  }
  cal.month = new Date(2026, 11, 1); moveMonth(1);
  check('next month after December 2026 is January 2027', cal.month.getFullYear() === 2027 && cal.month.getMonth() === 0, cal.month.toDateString());
  moveMonth(-1);
  check('and back again', cal.month.getFullYear() === 2026 && cal.month.getMonth() === 11, cal.month.toDateString());

  // Study history across the year boundary
  study.log = [
    { t: at(2025, 6, 1), m: 60, s: '' },
    { t: at(2026, 12, 30), m: 90, s: '' }, { t: at(2026, 12, 31), m: 90, s: '' }, { t: at(2027, 1, 1), m: 90, s: '' }, { t: at(2027, 1, 2), m: 90, s: '' },
  ];
  const st = studyStats();
  check('a streak runs straight through New Year', st.best === 4, st.best);
  check('every session ever is counted in the total', st.total === 420, st.total);
  check('days from earlier years are kept', st.byDay.get('2025-06-01') === 60, [...st.byDay.keys()]);

  // Saved data is a plain list with full dates: nothing is filtered by year when it is saved again
  store.set('log', study.log);
  check('the study log saves every year', store.get('log', []).length === 5, store.get('log', []).length);
  check('events save every year', store.get('events', []).length === 3, store.get('events', []).length);

  // Quotes library has no cap
  const before = quote.online.length;
  quote.online = [...quote.online, ...Array.from({ length: 1500 }, (_, i) => [`Test quote number ${i} for the library size check`, 'Test'])];
  store.set('quotesOnline', quote.online);
  check('quotes library keeps more than 1,000 quotes', store.get('quotesOnline', []).length === before + 1500, store.get('quotesOnline', []).length);
  quote.online = quote.online.slice(0, before); store.set('quotesOnline', quote.online);

  study.log = []; store.set('log', []); store.set('events', []); store.set('dayFills', {});
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

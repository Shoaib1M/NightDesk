// Calendar post-it fills:  node scripts/run-tests.js smoke-dayfill.js
(async () => {
  const fails = [];
  let count = 0;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  const cellFor = (key) => $$('#cal-grid .day')[Math.round((parseYmd(key) - gridStart()) / 864e5)];
  showView('calendar');
  const today = ymd(new Date()), tomorrow = ymd(addDays(new Date(), 1));

  // double-click fills with the default colour, a second double-click clears it
  let cell = cellFor(today);
  cell.click(); cellFor(today).click();
  check('double-click fills the day', dayFills()[today] === 'yellow' && cellFor(today).classList.contains('filled'), dayFills());
  await wait(500);
  cellFor(today).click(); cellFor(today).click();
  check('double-click again clears it', !dayFills()[today] && !cellFor(today).classList.contains('filled'), dayFills());
  await wait(500);

  // two single clicks far apart are not a double-click
  cellFor(today).click(); await wait(500); cellFor(today).click();
  check('slow clicks do not fill', !dayFills()[today], dayFills());
  // clicks on two different days are not a double-click
  await wait(500); cellFor(today).click(); cellFor(tomorrow).click();
  check('clicks on different days do not fill', !dayFills()[today] && !dayFills()[tomorrow], dayFills());

  // picking a colour from the panel fills the selected day
  await wait(500); cellFor(today).click();
  const sw = $$('#day-colors .fill-sw');
  check('six colours plus "no fill" in the panel', sw.length === 7, sw.length);
  sw[4].click(); // Sky
  check('picked colour is applied', dayFills()[today] === 'sky' && cellFor(today).style.getPropertyValue('--fill') === '#cfe6ff', dayFills());
  check('picked colour is marked in the panel', $$('#day-colors .fill-sw')[4].classList.contains('on'), null);
  $$('#day-colors .fill-sw')[6].click();
  check('"no fill" clears it', !dayFills()[today], dayFills());

  // text stays readable on a filled day, in both themes
  await saveEvent({ title: 'Readable event', allDay: true, start: today, end: tomorrow }, null);
  setDayFill(today, 'yellow');
  for (const theme of ['dark', 'light']) {
    settings.theme = theme; applyTheme(); renderCal();
    const c = cellFor(today), fg = getComputedStyle(c).color, bg = getComputedStyle(c).backgroundColor;
    const lum = (s) => { const [r, g, b] = s.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
    check(`date and event text readable on a filled day (${theme})`, ratio >= 7, { fg, bg, ratio: ratio.toFixed(1) });
  }

  // fills are saved and survive months moving
  moveMonth(1); moveMonth(-1);
  check('fill still there after changing month', cellFor(today).classList.contains('filled'), null);
  check('fill is saved', store.get('dayFills', {})[today] === 'yellow', store.get('dayFills', {}));
  setDayFill(today, '');
  store.set('events', []);
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

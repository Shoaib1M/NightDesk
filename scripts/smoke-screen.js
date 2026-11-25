// Screen time, day history and the calendar month picker:  node scripts/run-tests.js smoke-screen.js
(async () => {
  const fails = [];
  let count = 0;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  const today = ymd(new Date());
  window.__fakeWindowsOnly = true; // the real desktop must not leak into the checks

  // ----- recognising apps and sites
  const c = (p, t) => classifyWindow(p, t);
  check('YouTube in Chrome is Entertainment', JSON.stringify(c('chrome', 'Lofi - YouTube - Google Chrome')) === '{"app":"YouTube","cat":"watch"}', c('chrome', 'Lofi - YouTube - Google Chrome'));
  check('plain Chrome is Browsing', c('chrome', 'New Tab - Google Chrome').app === 'Chrome' && c('chrome', 'New Tab - Google Chrome').cat === 'browse', null);
  check('VS Code is Study & work', c('Code', 'main.js - nightdesk - Visual Studio Code').cat === 'work', null);
  check('Codeforces in a browser is Study & work', c('msedge', 'Problem - 1900A - Codeforces - Microsoft Edge').app === 'Codeforces', null);
  check('WhatsApp is Communication', c('WhatsApp', 'WhatsApp').cat === 'chat', null);
  check('Valorant is Games', c('VALORANT-Win64-Shipping', 'VALORANT').cat === 'games', null);
  check('Instagram is Social', c('chrome', 'Instagram - Google Chrome').cat === 'social', null);
  check('an unknown app is named after itself, under Other', JSON.stringify(c('blender', 'Untitled')) === '{"app":"Blender","cat":"other"}', c('blender', 'Untitled'));

  // ----- counting time (driven directly; the real watcher is checked at the end)
  settings.screenTime = true;
  store.set('screen-' + today, {});
  scr.cur = null; scr.since = 0; scr.paused = false;
  screenOnWindow({ fake: true, proc: 'Code', title: 'secret-project.js - Visual Studio Code' });
  scr.since = Date.now() - 60000;
  screenOnWindow({ fake: true, proc: 'chrome', title: 'Some private video title - YouTube - Google Chrome' });
  let d = screenDay(today);
  check('a minute in VS Code is counted', Math.abs((d.apps['VS Code'] || 0) - 60000) < 2000 && Math.abs((d.cats.work || 0) - 60000) < 2000, d);
  check('switching apps is counted', d.switches === 1, d.switches);
  check('time lands in the right hour', Object.values(d.hours[new Date(Date.now() - 60000).getHours()] || {}).reduce((a, b) => a + b, 0) >= 58000, d.hours);
  scr.since = Date.now() - 10 * 60000; screenAdd();
  d = screenDay(today);
  check('a long gap (sleep, freeze) counts at most two minutes', Math.abs((d.apps.YouTube || 0) - 120000) < 2000, d.apps.YouTube);
  scr.paused = true; scr.since = Date.now() - 60000; screenAdd(); scr.paused = false;
  check('idle or locked time is not counted', Math.abs((screenDay(today).apps.YouTube || 0) - 120000) < 2000, screenDay(today).apps.YouTube);
  screenOnWindow({ fake: true, proc: 'LockApp', title: 'Windows Default Lock Screen' });
  check('the lock screen is not an app', scr.cur === null, scr.cur);
  const saved = JSON.stringify(store.get('screen-' + today, {}));
  check('window titles are never stored', !/secret-project|private video/i.test(saved), saved.slice(0, 200));
  settings.screenTime = false; screenOnWindow({ fake: true, proc: 'Code', title: 'x' });
  check('switched off: nothing is tracked', JSON.stringify(store.get('screen-' + today, {})) === saved, null);
  settings.screenTime = true;

  // ----- the page
  screenDemo();
  showView('screen'); renderScreen();
  check('screen tab opens', $('#v-screen').classList.contains('on'), settings.view);
  check('donut has a slice per category used', $$('#scr-donut .slice').length === 7, $$('#scr-donut .slice').length);
  check('the total is in the middle of the donut', /\d+h/.test($('#scr-donut .d-total').textContent), $('#scr-donut .d-total').textContent);
  check('every category is labelled with time and %', $$('#scr-legend .lg').length === 7 && $$('#scr-legend .lg')[0].textContent.includes('%'), $('#scr-legend').textContent);
  check('four headline numbers', $$('#scr-kpis .kpi').length === 4 && /% vs 7-day average/.test($('#scr-kpis').textContent), $('#scr-kpis').textContent);
  check('24 hours in the day chart', $$('#scr-hours .col').length === 24, $$('#scr-hours .col').length);
  check('top six apps', $$('#scr-apps .app').length === 6, $$('#scr-apps .app').length);
  check('seven days in the week chart', $$('#scr-week .col').length === 7, null);
  check('the pet has something to say', $('#scr-insight').textContent.length > 20, $('#scr-insight').textContent);
  const right = $('.scr-right'), left = $('.scr-left');
  check('everything fits without scrolling', right.scrollHeight <= right.clientHeight + 1 && left.scrollHeight <= left.clientHeight + 1, { r: [right.scrollHeight, right.clientHeight], l: [left.scrollHeight, left.clientHeight] });

  // ----- your own categories, apps not tracked
  settings.scrCats = { YouTube: 'work' };
  check('an app you moved gets your category', c('chrome', 'Lecture - YouTube - Google Chrome').cat === 'work', c('chrome', 'Lecture - YouTube - Google Chrome'));
  settings.scrCats = {};
  const raw = { ...emptyDay(), total: 600000, apps: { YouTube: 400000, Blender: 200000 }, appCat: { YouTube: 'watch', Blender: 'other' }, cats: { watch: 400000, other: 200000 },
    hours: { 10: { watch: 400000, other: 200000 } }, ha: { 10: { YouTube: 400000, Blender: 200000 } } };
  settings.scrCats = { YouTube: 'work' }; settings.scrIgnore = ['Blender'];
  let v = scrView(raw);
  check('moving an app re-colours past days and the hour chart', v.cats.work === 400000 && !v.cats.watch && v.hours[10].work === 400000, v);
  check('an untracked app is left out of totals', v.total === 400000 && !v.apps.Blender && !v.hours[10].other, v);
  scr.cur = null;
  screenOnWindow({ fake: true, proc: 'blender', title: 'Untitled' });
  check('an untracked app is not counted', scr.cur === null, scr.cur);
  settings.scrCats = {}; settings.scrIgnore = [];
  check('videos and calls keep counting when you sit still', keepsCounting({ app: 'YouTube', cat: 'watch' }) && keepsCounting({ app: 'Zoom', cat: 'chat' }) && !keepsCounting({ app: 'VS Code', cat: 'work' }), null);

  // ----- daily limits, breaks, bedtime
  const bubble = () => $('#buddy-say').hidden ? '' : $('#buddy-say').textContent;
  settings.buddy = true; pomo.running = false;
  store.set('screen-' + today, {}); $('#buddy-say').hidden = true;
  settings.scrBreak = 0; settings.scrBed = '';
  settings.scrLimits = { 'app:YouTube': 20 };
  screenOnWindow({ fake: true, proc: 'chrome', title: 'x - YouTube - Google Chrome' });
  let dd = screenDay(today); dd.apps.YouTube = 10.5 * 60000; dd.appCat.YouTube = 'watch'; dd.total = dd.apps.YouTube; store.set('screen-' + today, dd);
  scr.since = Date.now() - 60000; screenAdd();
  check('10 minutes before a limit the pet warns you', screenDay(today).flags['app:YouTube'] === 'warn' && /10 minutes of YouTube left/.test(bubble()), { f: screenDay(today).flags, b: bubble() });
  dd = screenDay(today); dd.apps.YouTube = 19.5 * 60000; store.set('screen-' + today, dd);
  scr.since = Date.now() - 60000; screenAdd();
  check('reaching a limit: the pet tells you', screenDay(today).flags['app:YouTube'] === 'over' && /20m of YouTube/.test(bubble()), { f: screenDay(today).flags, b: bubble() });
  $('#buddy-say').hidden = true;
  scr.since = Date.now() - 60000; screenAdd();
  check('and only once a day', bubble() === '', bubble());
  settings.scrLimits = { 'cat:social': 1 };
  dd = screenDay(today); dd.apps.Instagram = 5 * 60000; dd.appCat.Instagram = 'social'; store.set('screen-' + today, dd);
  scr.since = Date.now() - 60000; screenAdd();
  check('a limit you are not using right now stays quiet', screenDay(today).flags['cat:social'] === 'over' && bubble() === '', { f: screenDay(today).flags, b: bubble() });
  setLimit('cat:social', 0);
  check('removing a limit', !('cat:social' in settings.scrLimits), settings.scrLimits);
  settings.scrLimits = {};
  settings.scrBreak = 1; scr.cont = 0;
  scr.since = Date.now() - 70000; screenAdd();
  check('a break reminder after unbroken screen time', /20 seconds/.test(bubble()) && scr.cont === 0, { b: bubble(), cont: scr.cont });
  $('#buddy-say').hidden = true; pomo.running = true; scr.cont = 0;
  scr.since = Date.now() - 70000; screenAdd(); pomo.running = false;
  check('no break reminder during a focus block', bubble() === '', bubble());
  settings.scrBreak = 60;
  const at = (hh, mm) => new Date(2026, 0, 5, hh, mm);
  settings.scrBed = '23:00';
  check('bedtime 11 pm: 11:30 pm and 2 am are late, 6 am and 10 pm are not', isLate(at(23, 30)) && isLate(at(2, 0)) && !isLate(at(6, 0)) && !isLate(at(22, 0)), null);
  settings.scrBed = '01:00';
  check('bedtime 1 am: 12:30 am is not late, 1:30 am is', !isLate(at(0, 30)) && isLate(at(1, 30)), null);
  settings.scrBed = '';
  check('no bedtime: nothing is late', !isLate(at(2, 0)), null);

  // ----- the page again: week view, app menu, limits panel
  screenDemo(); settings.scrLimits = { total: 420, 'cat:watch': 45 }; settings.scrBed = '23:00';
  showView('screen'); renderScreen();
  check('limits show with a bar each', $$('#scr-limits .lim').length === 2, $('#scr-limits').textContent);
  check('late hours are marked', $$('#scr-hours .col.late').length === 6, $$('#scr-hours .col.late').length);
  check('still fits without scrolling with limits', left.scrollHeight <= left.clientHeight + 1 && right.scrollHeight <= right.clientHeight + 1, { l: [left.scrollHeight, left.clientHeight], r: [right.scrollHeight, right.clientHeight] });
  $('#scr-all').click();
  check('All shows every app', $$('#scr-apps .app').length === Object.keys(scrView(screenDay(today)).apps).length && $$('#scr-apps .app').length > 6, $$('#scr-apps .app').length);
  $('#scr-all').click();
  $('#scr-mode [data-mode=week]').click();
  check('week view: totals for seven days', $('#scr-day').textContent === 'This week' && /This week/.test($('#scr-kpis').textContent) && /vs the week before/.test($('#scr-kpis').textContent), $('#scr-kpis').textContent);
  const weekSum = [...Array(7)].reduce((a, _, i) => a + scrView(screenDay(ymd(addDays(new Date(), -i)))).total, 0);
  check('the week donut adds up all seven days', $('#scr-donut .d-total').textContent === fmtH(weekSum), { shown: $('#scr-donut .d-total').textContent, want: fmtH(weekSum) });
  check('the weekly report compares with the week before', /than the week before/.test($('#scr-insight').textContent), $('#scr-insight').textContent);
  $('#scr-prev').click();
  check('previous goes back a whole week', scr.dayView === 7 && /–/.test($('#scr-day').textContent), { dv: scr.dayView, t: $('#scr-day').textContent });
  $$('#scr-week .col')[2].click();
  check('clicking a day opens that day', scr.mode === 'day' && scr.dayView === 11, { m: scr.mode, dv: scr.dayView });
  $('#scr-pick').value = today; $('#scr-pick').dispatchEvent(new Event('change'));
  const firstApp = $('#scr-apps .app .nm').textContent;
  $('#scr-apps .app').click();
  check('clicking an app opens its menu', !$('#scr-menu').hidden && $$('#scr-menu button').length === 9, $('#scr-menu').textContent);
  [...$$('#scr-menu button')].find((b) => b.textContent.startsWith('Entertainment')).click();
  check('moving it updates the day straight away', settings.scrCats[firstApp] === 'watch' && $('#scr-menu').hidden && pct(scrView(screenDay(today)).cats.watch, 1) > 0, settings.scrCats);
  [...$$('#scr-apps .app')].find((b) => b.textContent.startsWith(firstApp)).click();
  [...$$('#scr-menu button')].find((b) => b.textContent.startsWith('Study & work')).click();
  check('moving it back to its usual category forgets the change', !(firstApp in settings.scrCats), settings.scrCats);
  $('#scr-gear').click();
  check('the gear opens limits and reminders', !$('#scr-panel').hidden && $$('#scr-panel .lrow input[type=number]').length === 3, $('#scr-panel').textContent.slice(0, 120));
  const add = $('#scr-panel select'); add.value = 'cat:games'; add.dispatchEvent(new Event('change'));
  check('adding a limit from the panel', settings.scrLimits['cat:games'] === 60 && $$('#scr-limits .lim').length === 3, settings.scrLimits);
  $$('#scr-panel .lrow')[0].querySelector('.ib').click();
  check('removing one from the panel', !('total' in settings.scrLimits), settings.scrLimits);
  const n = $('#scr-panel input[aria-label="Break reminder minutes"]'); n.value = '45'; n.dispatchEvent(new Event('change'));
  check('break reminder length is saved', settings.scrBreak === 45 && store.get('settings', {}).scrBreak === 45, settings.scrBreak);
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  check('clicking elsewhere closes the panel', $('#scr-panel').hidden, null);
  settings.scrLimits = {}; settings.scrBed = ''; settings.scrBreak = 60; saveSettings(); scr.mode = 'day';

  // ----- history: any day, years back
  const old = ymd(addDays(new Date(), -3 * 365));
  store.set('screen-' + old, { total: 5400000, apps: { 'VS Code': 5400000 }, appCat: { 'VS Code': 'work' }, cats: { work: 5400000 }, hours: { 21: { work: 5400000 } }, switches: 12, longest: { app: 'VS Code', ms: 3600000 } });
  study.log.push({ t: parseYmd(old).getTime() + 20 * 3600000, m: 90, s: study.subjects[0].id, d: old });
  const pick = $('#scr-pick'); pick.value = old; pick.dispatchEvent(new Event('change'));
  check('the date picker jumps to a day three years ago', scr.dayView >= 1094 && /1h 30m/.test($('#scr-donut').textContent), { dayView: scr.dayView, txt: $('#scr-donut').textContent });
  check('and shows what you studied that day', /Studied/.test($('#scr-studied').textContent) && $('#scr-studied').textContent.includes(study.subjects[0].name), $('#scr-studied').textContent);
  $('#scr-next').click();
  check('next day steps forward', scr.dayView >= 1093, scr.dayView);
  pick.value = today; pick.dispatchEvent(new Event('change'));
  check('and back to today', scr.dayView === 0 && $('#scr-day').textContent === 'Today', scr.dayView);
  check('older days are all still saved', !!store.get('screen-' + old, null) && !!store.get('screen-' + ymd(addDays(new Date(), -6)), null), null);

  // ----- calendar: jump to any month
  showView('calendar');
  const cp = $('#cal-pick'); cp.value = '2029-05'; cp.dispatchEvent(new Event('change'));
  check('calendar month picker jumps to any month', cal.month.getFullYear() === 2029 && cal.month.getMonth() === 4 && /May 2029/.test($('#cal-title').textContent), $('#cal-title').textContent);
  $('#cal-today').click();

  // ----- the real window watcher runs for screen time even with no focus block
  pomo.running = false; await wait(1500);
  check('the watcher runs all the time for screen time', (await api.focus.test('info')).data.watching === true, null);

  study.log = study.log.filter((e) => e.d !== old);
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

// Screen time, day history and the calendar month picker:  node scripts/run-tests.js smoke-screen.js
(async () => {
  const fails = [];
  let count = 0;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  const today = ymd(new Date());

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
  screenOnWindow({ proc: 'Code', title: 'secret-project.js - Visual Studio Code' });
  scr.since = Date.now() - 60000;
  screenOnWindow({ proc: 'chrome', title: 'Some private video title - YouTube - Google Chrome' });
  let d = screenDay(today);
  check('a minute in VS Code is counted', Math.abs((d.apps['VS Code'] || 0) - 60000) < 2000 && Math.abs((d.cats.work || 0) - 60000) < 2000, d);
  check('switching apps is counted', d.switches === 1, d.switches);
  check('time lands in the right hour', Object.values(d.hours[new Date(Date.now() - 60000).getHours()] || {}).reduce((a, b) => a + b, 0) >= 58000, d.hours);
  scr.since = Date.now() - 10 * 60000; screenAdd();
  d = screenDay(today);
  check('a long gap (sleep, freeze) counts at most two minutes', Math.abs((d.apps.YouTube || 0) - 120000) < 2000, d.apps.YouTube);
  scr.paused = true; scr.since = Date.now() - 60000; screenAdd(); scr.paused = false;
  check('idle or locked time is not counted', Math.abs((screenDay(today).apps.YouTube || 0) - 120000) < 2000, screenDay(today).apps.YouTube);
  screenOnWindow({ proc: 'LockApp', title: 'Windows Default Lock Screen' });
  check('the lock screen is not an app', scr.cur === null, scr.cur);
  const saved = JSON.stringify(store.get('screen-' + today, {}));
  check('window titles are never stored', !/secret-project|private video/i.test(saved), saved.slice(0, 200));
  settings.screenTime = false; screenOnWindow({ proc: 'Code', title: 'x' });
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

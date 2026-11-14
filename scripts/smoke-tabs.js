// Choosing tabs, Study heatmaps and the paged Settings:  node scripts/run-tests.js smoke-tabs.js
(async () => {
  const fails = [];
  let count = 0;
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shownDock = () => [...document.querySelectorAll('#dock button')].filter((b) => !b.hidden).map((b) => b.dataset.v);
  const press = (k) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

  check('every tab is shown by default', shownDock().length === VIEWS.length, shownDock());

  // Number keys: all of them work now (2-9 used to do nothing).
  press('2'); check('key 2 opens Focus', settings.view === 'focus', settings.view);
  press('9'); check('key 9 opens Calendar', settings.view === 'calendar', settings.view);

  // Open Settings: pages down the side.
  await openSettings();
  const nav = [...document.querySelectorAll('#sheet .snav button')];
  check('Settings has six pages in a side menu', nav.length === 6, nav.map((b) => b.textContent));
  check('only one page shows at a time', [...document.querySelectorAll('#sheet .spage')].filter((p) => !p.hidden).length === 1);
  check('every page has something on it', [...document.querySelectorAll('#sheet .spage')].every((p) => p.querySelector('.srow, h3')), [...document.querySelectorAll('#sheet .spage')].map((p) => p.childElementCount));
  check('nothing was left outside the pages', [...$('#sheet').children].every((c) => c.matches('.head, .sbody')), [...$('#sheet').children].map((c) => c.className));
  nav.find((b) => b.dataset.page === 'tabs').click();
  const tabsPage = $('#sheet .spage[data-page="tabs"]');
  check('the Tabs page opens from the menu', !tabsPage.hidden && nav.find((b) => b.dataset.page === 'tabs').classList.contains('on'));
  const rowFor = (label) => [...tabsPage.querySelectorAll('.srow')].find((r) => r.querySelector('span').firstChild.textContent === label);
  check('Clock cannot be switched off', rowFor('Clock').querySelector('input').disabled && rowFor('Clock').querySelector('input').checked);

  // Switch Contests and Lamp off from the Settings switches, while on the Lamp tab.
  showView('lamp');
  for (const label of ['Contests', 'Lamp']) { const i = rowFor(label).querySelector('input'); i.checked = false; i.dispatchEvent(new Event('change')); }
  await wait(50);
  check('switching tabs off saves them', JSON.stringify(settings.hiddenTabs) === '["contests","lamp"]', settings.hiddenTabs);
  check('they leave the dock', !shownDock().includes('contests') && !shownDock().includes('lamp') && shownDock().length === VIEWS.length - 2, shownDock());
  check('being on a tab that is switched off moves you to the Clock', settings.view === 'clock', settings.view);
  showView('lamp');
  check('a hidden tab cannot be opened another way', settings.view === 'clock', settings.view);
  check('the Settings page stays open on Tabs while switching', !tabsPage.hidden);
  closeSettings();

  // Number keys follow the dock: with Contests and Lamp gone, there are 10 tabs and 9 keys.
  press('9'); check('key 9 still opens the 9th shown tab (Calendar)', settings.view === 'calendar', settings.view);

  // Contests off: no contest entries in the calendar.
  const realContests = cal.contests;
  cal.contests = [{ id: 9999, name: 'Test Round', start: Date.now() + 864e5, duration: 72e5 }];
  check('Codeforces contests leave the calendar when Contests is off', !allEvents().some((e) => e.src === 'cf'), allEvents().filter((e) => e.src === 'cf').length);
  settings.hiddenTabs = []; saveSettings(); emit('settings');
  check('and come back when it is on', allEvents().some((e) => e.src === 'cf'));
  settings.hiddenTabs = ['contests', 'lamp']; saveSettings(); emit('settings');
  cal.contests = realContests;

  // Study heatmaps.
  showView('study');
  await wait(100);
  check('three heatmaps by default', $('#heats').children.length === 3, $('#heats').children.length);
  settings.heatCf = false; saveSettings(); emit('settings'); await wait(50);
  check('Codeforces heatmap off leaves two', $('#heats').children.length === 2 && !$('#heats').textContent.includes('Codeforces'), $('#heats').textContent.slice(0, 80));
  check('the card title follows', $('.act h3 small').textContent === 'study and GitHub', $('.act h3 small').textContent);
  settings.heatGh = false; saveSettings(); emit('settings'); await wait(50);
  check('both off leaves only study time, wider', $('#heats').children.length === 1 && $('#heats').style.gridTemplateColumns === 'repeat(1, 1fr)', $('#heats').style.gridTemplateColumns);
  check('one heatmap can show more weeks', $('#heats .heat').childElementCount > 26 * 7 || $('#heats').clientWidth < 26 * 13 * 2, $('#heats .heat').childElementCount);

  // Back to everything on, and it all survives a reload of the settings.
  settings.hiddenTabs = []; settings.heatGh = true; settings.heatCf = true; saveSettings(); emit('settings'); await wait(50);
  check('switching back on brings everything back', shownDock().length === VIEWS.length && $('#heats').children.length === 3, [shownDock().length, $('#heats').children.length]);
  check('the choice is saved with the settings', JSON.stringify(store.get('settings', {}).hiddenTabs) === '[]' && store.get('settings', {}).heatCf === true);
  showView('clock');
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

// Activity heatmap checks (needs the internet):
//   node scripts/run-tests.js smoke-activity.js
(async () => {
  const fails = [];
  let count = 0;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await wait(250); } return false; };

  showView('study');
  check('unlinked shows link boxes', $$('#heats .hlink').length === 2, $$('#heats .hlink').length);

  // bad input is rejected in the main process before anything is fetched
  for (const [name, fn] of [['github', 'bad user/../x'], ['github', '-leadingdash'], ['codeforces', 'a b'], ['codeforces', '']]) {
    const r = await api.activity[name](fn);
    check(`rejects ${name} "${fn}"`, r.ok === false, r);
  }
  const nf = await api.activity.github('nightdesk-no-such-user-404x');
  check('unknown GitHub user gives a clear error', nf.ok === false && /not found/i.test(nf.error), nf);

  // linking through the inline box
  const [ghBox] = $$('#heats .hlink');
  ghBox.querySelector('input').value = 'torvalds';
  ghBox.querySelector('button').click();
  check('GitHub username saved', settings.ghUser === 'torvalds', settings.ghUser);
  check('GitHub data arrives', await until(() => activity.gh && activity.gh.user === 'torvalds'), activity.gh && activity.gh.user);
  check('GitHub days look like dates and counts', !!activity.gh && Object.entries(activity.gh.days).every(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && v > 0), null);
  check('GitHub cells are coloured', $$('#heats .hp')[1].querySelectorAll('.heat i[style]').length > 0, null);

  settings.cfHandle = 'tourist'; saveSettings(); emit('settings');
  check('Codeforces data arrives', await until(() => activity.cf && activity.cf.user === 'tourist', 40000), activity.cf && activity.cf.user);
  check('Codeforces days hold submissions and accepted', !!activity.cf && Object.values(activity.cf.days).every((v) => v[0] >= v[1] && v[1] >= 0), null);
  check('Codeforces panel shows a summary', /solved/.test($$('#heats .hp')[2].textContent), $$('#heats .hp')[2].textContent);

  // cached data is used without refetching, and a bad name does not break the view
  const at = activity.gh.at;
  await loadActivity();
  check('fresh cache is not refetched', activity.gh.at === at, null);
  settings.ghUser = 'bad user'; saveSettings(); emit('settings');
  await until(() => actState.gh.error, 5000);
  check('a bad username shows an error, nothing crashes', !!actState.gh.error && $$('#heats .hp').length === 3, actState.gh);
  settings.ghUser = 'torvalds'; saveSettings(); actState.gh.error = ''; emit('settings');
  check('switching back uses the saved data', $$('#heats .hp')[1].querySelectorAll('.heat i[style]').length > 0, null);

  // everything fits without scrolling at the default window size
  seedDemo();
  const right = $('#stats');
  check('study view fits without scrolling', right.scrollHeight <= right.clientHeight + 1, { scroll: right.scrollHeight, client: right.clientHeight, h: innerHeight });
  const tops = $$('#heats .hp').map((e) => e.getBoundingClientRect().top);
  check('heatmaps sit side by side', Math.abs(tops[0] - tops[2]) < 2, tops);
  check('no heatmap overflows its panel', $$('#heats .hp').every((p) => !p.querySelector('.heat') || p.querySelector('.heat').scrollWidth <= p.clientWidth + 1), null);

  settings.ghUser = ''; settings.cfHandle = ''; saveSettings();
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

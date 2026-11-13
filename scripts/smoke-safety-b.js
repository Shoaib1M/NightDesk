// Database safety, part B: the next start folds the cut-off session back in, exactly once.
(async () => {
  const fails = [];
  let count = 0;
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  check('database in use', store.persistent === true, store.loadError);
  check('subjects unchanged (starter subjects not merged in)', study.subjects.map((s) => s.name).join() === 'FLAT,OS', study.subjects.map((s) => s.name));
  const total = study.log.reduce((a, e) => a + e.m, 0);
  check('the cut-off 50 minutes were added once', study.log.length === 3 && total === 245, { n: study.log.length, total });
  check('a session on an unknown subject counts as "no subject"', study.log.some((e) => e.m === 50 && e.s === ''), study.log);
  check('focus block in progress recovered', pomo.mode === 'focus' && pomo.left === 2700000 && $('#p-task').value === 'cut-off task', { left: pomo.left, task: $('#p-task').value });
  const snap = (await new Promise((r) => r(api.db.load(true)))).data || {};
  const snapName = Object.keys(snap).find((k) => k.startsWith('__browserStorage-'));
  check('a full snapshot of browser storage was kept in the database', !!snapName && /DSA \/ CP/.test(snap[snapName]), Object.keys(snap));
  check('browser storage cleared afterwards', !Object.keys(localStorage).some((k) => k.startsWith('nd.')), Object.keys(localStorage));
  check('recovery noted', JSON.parse(store.get('__recovered', '{}') || '{}') !== null, null);
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

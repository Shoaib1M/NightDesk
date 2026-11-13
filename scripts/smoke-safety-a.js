// Database safety, part A (runs on a profile the runner prepared with an old WAL-mode database and
// an empty backup): the data must load, then we leave behind what a cut-off session would have.
(async () => {
  const fails = [];
  let count = 0;
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  check('database in use', store.persistent === true, store.loadError);
  check('subjects from the old WAL database loaded', study.subjects.map((s) => s.name).join() === 'FLAT,OS', study.subjects.map((s) => s.name));
  check('study log from the old WAL database loaded', study.log.length === 2 && study.log.reduce((a, e) => a + e.m, 0) === 195, study.log);
  const list = await call(api.db.list());
  check('empty backup is not offered for restore', !list.includes('nightdesk-2025-02-01.db'), list);
  const empty = await api.db.restore('nightdesk-2025-02-01.db');
  check('empty backup cannot be restored', empty.ok === false, empty);
  check('data untouched after refused restore', study.subjects.length === 2, study.subjects.length);
  // What an older build left in browser storage after losing the database: one 50-minute session
  // on a starter subject, one already in the database, and a focus block in progress.
  const dbLog = study.log;
  localStorage.setItem('nd.log', JSON.stringify([dbLog[0], { t: Date.now() - 3600000, m: 50, s: 's1' }]));
  localStorage.setItem('nd.subjects', JSON.stringify([{ id: 's1', name: 'DSA / CP', color: '#000', goal: 120 }]));
  localStorage.setItem('nd.pomoState', JSON.stringify({ mode: 'focus', dur: 3000000, left: 2700000, round: 1, task: 'cut-off task' }));
  store._putRaw('pomoState', null); api.db.set('pomoState', null);
  await new Promise((r) => setTimeout(r, 300));
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

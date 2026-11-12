// Persistence check, part 4 (run twice): after a restore, and after the app data folder is wiped.
(async () => {
  const fails = [];
  let count = 0;
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  check('database in use', store.persistent === true, store.persistent);
  check('coins back to the backed-up value', pet.coins === 777, pet.coins);
  check('pet kept', pet.name === 'Biscuit', pet.name);
  check('subject kept', study.subjects.some((s) => s.id === 'sp1'), study.subjects.map((s) => s.name));
  check('study session kept', study.log.some((e) => e.s === 'sp1' && e.m === 42), study.log.length);
  check('calendar event kept', localEvents().some((e) => e.title === 'Persist event'), localEvents().length);
  check('settings kept', settings.palette === 'violet' && settings.focusMin === 37, { p: settings.palette, f: settings.focusMin });
  const n = await call(api.db.backups());
  check('all old backups still there', n >= 31, n);
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

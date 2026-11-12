// Persistence check, part 2: a fresh start after the hard kill must see everything from part 1.
(async () => {
  const fails = [];
  let count = 0;
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  check('database in use', store.persistent === true, store.persistent);
  const subj = study.subjects.find((s) => s.id === 'sp1');
  check('subject kept with its target', !!subj && subj.name === 'Persist subject' && subj.goal === 90, subj);
  check('study session kept', study.log.some((e) => e.s === 'sp1' && e.m === 42), study.log);
  check('calendar event kept', localEvents().some((e) => e.title === 'Persist event'), localEvents());
  const al = alarms.find((a) => a.id === 'ap1');
  check('alarm kept', !!al && al.time === '06:45' && al.days.join() === '1,3', al);
  check('coins and pet kept', pet.coins >= 777 && pet.name === 'Biscuit' && pet.hat === 'crown', { coins: pet.coins, name: pet.name, hat: pet.hat });
  check('settings kept', settings.theme === 'light' && settings.palette === 'violet' && settings.focusMin === 37 && settings.ghUser === 'someone', settings);
  check('lamp colour kept', lamp.color === '#ffb766', lamp);
  check('theme applied on start', document.documentElement.dataset.theme === 'light', document.documentElement.dataset.theme);
  const done = pomo.dur - pomo.left;
  check('focus block in progress comes back paused with its minutes', pomo.mode === 'focus' && !pomo.running && done >= 7 * 60000 && done < 8 * 60000, { mode: pomo.mode, running: pomo.running, done });
  check('focus task text kept', $('#p-task').value === 'Persist task', $('#p-task').value);
  check('Resume button shown', $('#p-go').textContent === 'Resume', $('#p-go').textContent);
  const b = await api.db.backup();
  check('backup can be made', b.ok && /nightdesk-\d{4}-\d{2}-\d{2}\.db$/.test(b.data), b);
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

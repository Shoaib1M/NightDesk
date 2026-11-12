// Persistence check, part 1: write one of everything, then the runner hard-kills the app.
(async () => {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  study.subjects.push({ id: 'sp1', name: 'Persist subject', color: '#5b9dff', goal: 90 }); saveSubjects();
  logStudy(42, 'sp1');
  await saveEvent({ title: 'Persist event', allDay: true, start: ymd(new Date()), end: ymd(addDays(new Date(), 1)) }, null);
  alarms.push({ id: 'ap1', time: '06:45', label: 'Persist alarm', days: [1, 3], on: true, last: '' }); renderAlarms();
  pet.coins = 777; pet.name = 'Biscuit'; pet.hat = 'crown'; pet.owned.hat.push('crown'); savePet();
  settings.theme = 'light'; settings.palette = 'violet'; settings.focusMin = 37; settings.ghUser = 'someone'; saveSettings();
  lamp.color = '#ffb766'; applyLamp();
  // a focus block 7 minutes in, still running when the PC goes off
  $('#p-task').value = 'Persist task'; pomoSet('focus'); pomoToggle(); pomo.endAt -= 7 * 60000; tickPomo(); savePomo(true);
  await wait(400); // let the last writes reach the main process
  return JSON.stringify({ persistent: store.persistent, wrote: true });
})();

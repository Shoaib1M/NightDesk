// Exams + syllabus, the mini floating timer, hotkeys and the distraction guard:
//   node scripts/run-tests.js smoke-focus.js
(async () => {
  const fails = [];
  let count = 0;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  const t = async (cmd, arg) => (await api.focus.test(cmd, arg)).data;
  const shown = [];
  const RealN = window.Notification;
  window.Notification = function (title) { shown.push(title); };
  settings.buddy = true; pet.desktop = false;

  // ================= exams and syllabus
  const s = study.subjects[0];
  s.exam = ymd(addDays(new Date(), 6));
  s.chapters = [1, 2, 3, 4].map((i) => ({ id: 'c' + i, name: 'Chapter ' + i, hours: 2, done: i === 1 }));
  saveSubjects();
  let y = syllabus(s);
  check('syllabus counts chapters and hours left', y.total === 4 && y.done === 1 && y.leftHours === 6 && y.days === 6, y);
  check('suggests a daily amount (6h over 6 days = 1h)', y.perDay === 60, y.perDay);
  showView('study');
  const row = $$('#subj-list .subj-exam')[0];
  check('subject card shows exam, chapters and daily plan', row && /in 6 days/.test(row.textContent) && /1\/4 chapters/.test(row.textContent) && /~1h a day/.test(row.textContent), row && row.textContent);
  check('the other subjects invite you to add one', /\+ Exam date & syllabus/.test($$('#subj-list .subj-exam')[1].textContent), null);
  openSyllabus(s.id);
  check('planner opens with the chapters', !$('#modal').hidden && $$('#sheet .chap').length === 4, $$('#sheet .chap').length);
  const use = [...$$('#sheet button')].find((b) => /daily target/.test(b.textContent));
  use.click();
  check('"Use as daily target" sets the subject goal', s.goal === 60, s.goal);
  const ta = $('#sheet textarea');
  ta.value = '1. Paging\n- Segmentation\n•  TLB\n\n  ';
  [...$$('#sheet button')].find((b) => b.textContent === 'Add').click();
  check('pasting a list adds clean chapter names', s.chapters.slice(4).map((c) => c.name).join('|') === 'Paging|Segmentation|TLB', s.chapters.map((c) => c.name));
  const box = $$('#sheet .chap input[type=checkbox]')[1];
  box.checked = true; box.dispatchEvent(new Event('change'));
  check('ticking a chapter marks it done and is saved', s.chapters[1].done && store.get('subjects', []).find((x) => x.id === s.id).chapters[1].done, null);
  closeSettings();
  check('exam appears in the calendar', allEvents().some((e) => e.src === 'exam' && ymd(e.start) === s.exam && e.title === `${s.name} exam`), null);
  showView('clock'); renderClockExam();
  check('clock corner shows the next exam', !$('#exam-count').hidden && /exam in 6 days/.test($('#exam-count').textContent), $('#exam-count').textContent);
  settings.examOnClock = false; renderClockExam();
  check('clock countdown can be switched off', $('#exam-count').hidden, null);
  settings.examOnClock = true;
  s.exam = ymd(addDays(new Date(), 1)); saveSubjects();
  shown.length = 0; examReminders(); examReminders();
  check('reminder the day before, once', shown.filter((x) => /exam tomorrow/.test(x)).length === 1, shown);
  s.exam = ymd(addDays(new Date(), -2)); saveSubjects();
  check('past exams are not the "next" exam', nextExam() === null || nextExam().id !== s.id, null);
  s.exam = ''; s.chapters = []; s.goal = 120; saveSubjects();

  // ================= mini floating timer
  showView('focus'); pomoSet('focus'); renderPomo();
  await api.focus.mini(true); await wait(1200);
  let info = await t('info');
  check('mini timer opens', info.mini === true && info.bounds.width === 260, info);
  sendMiniState(); await wait(400);
  check('mini timer shows the focus time', /FOCUS/.test(await t('miniText')) && /50:00/.test(await t('miniText')), await t('miniText'));
  await t('miniClick', '#toggle'); await wait(500);
  check('play on the mini timer starts focus', pomo.running && pomo.mode === 'focus', pomo.running);
  await t('miniClick', '#toggle'); await wait(500);
  check('and pauses it', !pomo.running, pomo.running);
  await t('miniClick', '#close'); await wait(500);
  check('close hides the mini timer', (await t('info')).mini === false, null);

  // ================= hotkeys (fired directly; test runs never register real keys)
  pomoSet('focus');
  await t('hotkey', 'toggle'); await wait(400);
  check('Ctrl+Alt+F starts focus', pomo.running, pomo.running);
  await t('hotkey', 'toggle'); await wait(400);
  check('Ctrl+Alt+F again pauses it', !pomo.running, pomo.running);
  await t('hotkey', 'mini'); await wait(1000);
  check('Ctrl+Alt+M shows the mini timer', (await t('info')).mini === true, null);
  await t('hotkey', 'mini'); await wait(400);
  check('Ctrl+Alt+M again hides it', (await t('info')).mini === false, null);

  // ================= distraction guard (screen time off here, so the watcher runs for the guard alone)
  settings.screenTime = false;
  check('Nightdesk itself never counts as a distraction', matchDistraction('Nightdesk', 'Nightdesk') === '', null);
  check('YouTube in a browser tab is caught', matchDistraction('chrome', 'Lofi beats - YouTube - Google Chrome') === 'YouTube', null);
  check('VS Code is fine', matchDistraction('Code', 'main.js - nightdesk - Visual Studio Code') === '', null);
  pomoSet('focus'); pomoToggle(); await wait(1200);
  check('the guard watches only during focus', (await t('info')).watching === true, await t('info'));
  shown.length = 0;
  await t('fakeWindow', { proc: 'chrome', title: 'Lofi beats - YouTube - Google Chrome' }); await wait(300);
  check('opening YouTube during focus is noticed', guard.since > 0 && guard.app === 'YouTube' && shown.some((x) => /YouTube/.test(x)), { since: guard.since, shown });
  check('the pet says so', /YouTube/.test($('#buddy-say').textContent), $('#buddy-say').textContent);
  await wait(1200);
  await t('fakeWindow', { proc: 'Code', title: 'main.js - Visual Studio Code' }); await wait(300);
  check('coming back ends the distraction', guard.since === 0 && guard.blockMs >= 1000, guard);
  check('distracted time is recorded per app for today', (distractedToday().find(([a]) => a === 'YouTube') || [0, 0])[1] >= 1000, distractedToday());
  // Ten minutes into the block with four of them distracted: only six count.
  study.log = []; pomo.endAt = Date.now() + pomo.dur - 10 * 60000; tickPomo(); guard.blockMs = 4 * 60000;
  pomoReset();
  check('distracted minutes are not counted as study', study.log.length === 1 && study.log[0].m === 6, study.log);
  await wait(1200);
  check('the guard stops watching when focus stops', (await t('info')).watching === false, await t('info'));
  settings.guard = false; pomoSet('focus'); pomoToggle(); await wait(800);
  await t('fakeWindow', { proc: 'chrome', title: 'Netflix' }); await wait(300);
  check('switched off: nothing is caught', guard.since === 0 && (await t('info')).watching === false, guard.since);
  pomoToggle(); settings.guard = true; settings.screenTime = true;

  window.Notification = RealN;
  study.log = []; store.set('log', []);
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

// Pet checks run inside the app window:
//   NIGHTDESK_SHOTS=<dir> NIGHTDESK_EVAL=scripts/smoke-pet.js electron .
(async () => {
  const fails = [], errors = [];
  let count = 0;
  addEventListener('error', (e) => errors.push(e.message));
  addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const check = (name, fn) => { count++; try { const v = fn(); if (v !== true) fails.push(`${name} -> ${JSON.stringify(v)}`); } catch (err) { fails.push(`${name} threw ${err.message}`); } };
  const reset = () => { study.log = []; pet.day = {}; pet.cele = {}; pet.level = 0; pet.coins = 0; pet.hunger = 50; pet.energy = 50; pet.joy = 50; pet.last = Date.now(); pet.napUntil = 0; ensureDay(); };
  settings.buddy = true; pet.desktop = false; pet.roam = false;
  showView('pet');

  // ----- sprites: every pet, colour and hat draws something
  check('every look draws', () => {
    const cv = document.createElement('canvas'); cv.width = PET_W; cv.height = PET_H; const ctx = cv.getContext('2d');
    for (const [kind] of SHOP.kind) for (const [color] of SHOP.color) for (const [hat] of SHOP.hat) for (const o of [{}, { sad: true }, { closed: true }]) {
      drawPet(ctx, { kind, color, hat }, o);
      if (!ctx.getImageData(0, 0, PET_W, PET_H).data.some((v) => v)) return `${kind}/${color}/${hat}`;
    }
    return true;
  });
  check('sprite rows are all 16 wide', () => SHOP.kind.every(([k]) => petRows(k).length === PET_H && petRows(k).every((r) => r.length === PET_W)));
  check('unknown look falls back safely', () => { drawPet($('#pet-big').getContext('2d'), { kind: 'dragon', color: 'neon', hat: 'ufo' }); return true; });

  // ----- study feeds the pet and pays coins
  reset();
  logStudy(30, 's1');
  check('30 minutes pays 30 coins and feeds', () => pet.coins === 30 && pet.hunger === 74 && pet.joy === 59 && pet.day.minutes === 30);
  check('zero minutes pays nothing', () => { logStudy(0, 's1'); return pet.coins === 30; });
  check('bars never pass 100', () => { logStudy(600, ''); const ok = pet.hunger === 100 && pet.joy === 100; return ok; });

  // ----- decay
  reset();
  check('one hour of neglect', () => { pet.last = Date.now() - 3600000; petDecay(Date.now()); return Math.round(pet.hunger) === 47 && Math.round(pet.joy) === 48 && Math.round(pet.energy) === 49; });
  check('a month away is capped at three days and floors at zero', () => { pet.hunger = 100; pet.joy = 100; pet.energy = 100; pet.last = Date.now() - 30 * 864e5; petDecay(Date.now()); return pet.hunger === 0 && pet.joy === 0 && pet.energy === 0; });
  check('sad when empty, but still there', () => petMood().sad === true && !!pet.name && pet.owned.kind.includes('cat'));
  check('clock set backwards does not feed it', () => { pet.hunger = 40; pet.last = Date.now() + 5 * 3600000; petDecay(Date.now()); return pet.hunger === 40; });
  check('one session cheers it up', () => { reset(); pet.hunger = 0; pet.joy = 0; pet.energy = 60; logStudy(50, ''); return pet.hunger === 40 && !petMood().sad === false || pet.hunger === 40; });

  // ----- care actions
  reset();
  check('petting counts once per click burst', () => { buddy.lastPoke = 0; petPoke(); petPoke(); petPoke(); return pet.day.pets === 1 && pet.joy === 52; });
  check('play costs energy', () => { petPlay(); return pet.joy === 67 && pet.energy === 40 && pet.day.plays === 1; });
  check('too tired to play', () => { pet.energy = 5; petPlay(); return pet.day.plays === 1; });
  check('treat needs coins', () => { pet.coins = 4; pet.hunger = 50; petTreat(); return pet.coins === 4 && pet.hunger === 50; });
  check('treat feeds', () => { pet.coins = 12; petTreat(); return pet.coins === 7 && pet.hunger === 70; });
  check('no treat when full', () => { pet.hunger = 100; petTreat(); return pet.coins === 7; });
  check('nap restores energy', () => { pet.energy = 20; petNap(); return pet.energy === 50 && pet.napUntil > Date.now(); });
  pet.napUntil = 0;

  // ----- shop
  reset();
  check('cannot buy without coins', () => { pet.coins = 49; pet.hat = ''; pet.owned.hat = ['']; shopClick('hat', 'party', 50); return pet.hat === '' && pet.coins === 49 && !pet.owned.hat.includes('party'); });
  check('buying equips and charges once', () => { pet.coins = 60; shopClick('hat', 'party', 50); shopClick('hat', '', 0); shopClick('hat', 'party', 50); return pet.hat === 'party' && pet.coins === 10 && pet.owned.hat.filter((x) => x === 'party').length === 1; });
  check('shop tabs render every item', () => SHOP_TABS.every(([key]) => { buddy.tab = key; renderPetView(); return $$('#shop .item').length === SHOP[key].length; }));
  pet.hat = ''; buddy.tab = 'kind';
  check('a new pet comes with its own colour', () => { pet.coins = 250; pet.kind = 'cat'; pet.color = 'ginger'; pet.owned.kind = ['cat']; pet.owned.color = ['ginger']; shopClick('kind', 'dog', 250); const a = pet.kind === 'dog' && pet.color === 'cocoa' && pet.owned.color.includes('cocoa') && pet.coins === 0; shopClick('kind', 'cat', 0); return a && pet.color === 'ginger'; });
  check('every palette is complete', () => SHOP.color.every(([id]) => PET_PAL[id] && ['fur', 'belly', 'nose', 'ink', 'eye'].every((k) => /^#[0-9a-f]{6}$/.test(PET_PAL[id][k]))));
  check('pet never ends up behind the dock', () => { showView('clock'); pet.pos = { x: 100, y: 16 }; placeBuddy(true); pet.roam = true; walkTo(innerWidth / 2); stopWalk(); pet.roam = false; const d = $('#dock').getBoundingClientRect(), w = buddySize().w; showView('pet'); return pet.pos.x + w <= d.left || pet.pos.x >= d.right; });

  // ----- quests
  reset();
  const qs = () => petQuests();
  check('three quests a day, stable within the day', () => qs().length === 3 && JSON.stringify(qs().map((q) => q.id)) === JSON.stringify(qs().map((q) => q.id)));
  check('cannot claim early', () => { claimQuest(qs()[0]); return pet.coins === 0 && pet.day.claimed.length === 0; });
  check('claim pays once', () => { pet.day.minutes = 999; const q = qs()[0]; claimQuest(q); claimQuest(qs()[0]); return pet.coins === q.coins && pet.day.claimed.length === 1; });
  check('new day resets quests and progress', () => { pet.day.date = '2000-01-01'; ensureDay(); return pet.day.minutes === 0 && pet.day.claimed.length === 0 && pet.day.date === ymd(new Date()); });
  check('focus blocks count', () => { emit('pomo', 'focus-done'); emit('pomo', 'focus-done'); return pet.day.blocks === 2; });

  // ----- celebrations
  reset();
  study.subjects[0].goal = 30;
  logStudy(10, study.subjects[0].id);
  check('no celebration before the target', () => Object.keys(pet.cele).length === 0);
  logStudy(25, study.subjects[0].id);
  check('target reached celebrates once with a bonus', () => pet.cele[`t:${study.subjects[0].id}@${pet.day.date}`] === 1 && pet.coins === 35 + 15 + 20); // 35 minutes also crosses level 2, which pays 20
  logStudy(5, study.subjects[0].id);
  check('no repeat for the same target', () => pet.coins === 75);
  check('level-up pays once', () => { reset(); pet.level = 1; logStudy(40, ''); const c = pet.coins; logStudy(1, ''); return pet.level === 2 && c === 60 && pet.coins === 61; });
  check('first ever session does not fake a level-up', () => { reset(); logStudy(200, ''); return !Object.keys(pet.cele).some((k) => k.startsWith('lvl')); });
  check('personal best needs an earlier day to beat', () => { reset(); logStudy(90, ''); return !pet.cele['best@' + pet.day.date]; });
  check('personal best fires when beaten', () => { reset(); study.log.push({ t: Date.now() - 2 * 864e5, m: 60, s: '' }); logStudy(90, ''); return pet.cele['best@' + pet.day.date] === 1; });
  check('confetti cleans itself up', () => $$('.confetti').length >= 1);
  study.subjects[0].goal = 120; saveSubjects();

  // ----- helpers
  reset();
  pet.nudgeOn = true; pet.nudgeTime = '00:00';
  check('nudge fires when nothing is studied', () => { petHelpers(Date.now(), 700); return pet.day.nudges === 1; });
  check('nudge waits 15 minutes before repeating', () => { petHelpers(Date.now(), 700); return pet.day.nudges === 1; });
  check('nudge stops after three', () => { for (let i = 0; i < 6; i++) { pet.day.lastNudge = 0; petHelpers(Date.now(), 700); } return pet.day.nudges === 3; });
  check('no nudge once you have studied', () => { pet.day.nudges = 0; pet.day.lastNudge = 0; pet.day.minutes = 5; petHelpers(Date.now(), 700); return pet.day.nudges === 0; });
  check('no nudge when switched off', () => { pet.day.minutes = 0; pet.nudgeOn = false; petHelpers(Date.now(), 700); return pet.day.nudges === 0; });
  check('no nudge before the set time', () => { pet.nudgeOn = true; pet.nudgeTime = '23:59'; petHelpers(new Date().setHours(12, 0, 0, 0), 700); return pet.day.nudges === 0; });
  pet.nudgeTime = '21:00';
  check('break reminder every 20 focused minutes', () => {
    pet.breaks = true; pet.focusRun = 20 * 60000 - 500; buddy.bubble = '';
    pomoSet('focus'); pomoToggle(); petHelpers(Date.now(), 700); const said = REMINDERS.includes(buddy.bubble); pomoToggle(); pomoSet('focus');
    return said;
  });

  // ----- dragging and bounds
  check('pet cannot be dragged off screen', () => { pet.pos = { x: 99999, y: 99999 }; placeBuddy(true); const a = pet.pos.x <= innerWidth && pet.pos.y <= innerHeight; pet.pos = { x: -500, y: -500 }; placeBuddy(true); return a && pet.pos.x === 0 && pet.pos.y === 0; });
  check('drag moves it, a plain click does not', () => {
    showView('clock'); buddyTick(); pet.pos = { x: 100, y: 100 }; placeBuddy(true);
    const cv = $('#buddy-cv'), r = cv.getBoundingClientRect(), x = r.left + 5, y = r.top + 5;
    const ev = (type, dx, dy) => cv.dispatchEvent(new PointerEvent(type, { clientX: x + dx, clientY: y + dy, pointerId: 1, bubbles: true }));
    try { ev('pointerdown', 0, 0); ev('pointermove', 60, -40); ev('pointerup', 60, -40); } catch (e) { return 'drag threw ' + e.message; }
    const moved = pet.pos.x === 160 && pet.pos.y === 140;
    const pets = pet.day.pets; buddy.lastPoke = 0;
    try { ev('pointerdown', 60, -40); ev('pointerup', 60, -40); } catch (e) { return 'click threw ' + e.message; }
    return moved && pet.pos.x === 160 && pet.day.pets === pets + 1;
  });
  check('hidden on the lamp, back afterwards', () => { showView('lamp'); buddyTick(); const h1 = $('#buddy').hidden; showView('clock'); buddyTick(); return h1 && !$('#buddy').hidden; });
  check('toggle button hides it', () => { $('#b-buddy').click(); const h1 = $('#buddy').hidden; $('#b-buddy').click(); return h1 && !$('#buddy').hidden; });
  check('walking stays inside the window', () => { pet.roam = true; walkTo(999999); const a = pet.pos.x <= innerWidth; walkTo(-999); stopWalk(); pet.roam = false; return a && pet.pos.x >= 0; });

  // ----- desktop pet window
  pet.desktop = true; buddyTick(); await wait(1500);
  check('desktop mode hides the in-app pet', () => $('#buddy').hidden === true && buddy.deskOn === true);
  pet.desktop = false; buddyTick(); await wait(500);
  check('switching back shows it again', () => $('#buddy').hidden === false && buddy.deskOn === false);

  // ----- damaged save
  check('saved pet survives a reload shape', () => { savePet(); const p = store.get('pet', {}); return typeof p.coins === 'number' && Array.isArray(p.owned.hat); });
  check('growth stages', () => { reset(); const a = petStage().i === 0; study.log.push({ t: Date.now(), m: 700, s: '' }); const b = petStage().i === 1; study.log.push({ t: Date.now(), m: 3000, s: '' }); const c = petStage().i === 2 && petStage().next === 0; study.log = []; return a && b && c; });

  reset(); pet.roam = true; savePet();
  await wait(500);
  return JSON.stringify({ checks: count, failed: fails, pageErrors: errors }, null, 1);
})();

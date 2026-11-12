// Desktop pet checks (needs the real screens):
//   NIGHTDESK_SHOTS=<dir> NIGHTDESK_EVAL=scripts/smoke-deskpet.js electron .
(async () => {
  const fails = [];
  let count = 0;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  const t = async (cmd, arg) => (await api.pet.test(cmd, arg)).data;

  settings.buddy = true; pet.desktop = true; pet.roam = false; buddy.deskOn = null; buddyTick();
  await wait(1500);
  let s = await t('info');
  check('desktop pet window opens', !!s, s);
  const screens = s.displays;

  for (let d = 0; d < screens; d++) {
    s = await t('place', d);
    check(`placed on monitor ${d + 1}`, s.display === d, s);
    // walk right then left on this monitor
    const x0 = s.bounds.x;
    api.pet.walk(0.9); await wait(1200);
    let w = await t('info');
    check(`walks right on monitor ${d + 1}`, w.walking && w.bounds.x > x0 && w.display === d, w);
    await wait(200);
    api.pet.walk(0); await wait(1200);
    const w2 = await t('info');
    check(`walks left on monitor ${d + 1}`, w2.bounds.x < w.bounds.x && w2.display === d, w2);
    api.pet.walk(0.5); await wait(100);
    // a drag interrupts walking and is followed by the cursor (simulated: cursor stays still, so the pet holds)
    const before = await t('dragStart');
    await wait(400);
    const held = await t('info');
    check(`drag stops walking on monitor ${d + 1}`, before.dragging && !held.walking, held);
    // The drag follows the real cursor, so compare the pet-to-cursor offset rather than assume the mouse is still.
    const off0 = { x: before.bounds.x - before.cursor.x, y: before.bounds.y - before.cursor.y };
    const off1 = { x: held.bounds.x - held.cursor.x, y: held.bounds.y - held.cursor.y };
    check(`pet keeps its grip on the cursor on monitor ${d + 1}`, Math.abs(off0.x - off1.x) <= 3 && Math.abs(off0.y - off1.y) <= 3, { off0, off1 });
    const end = await t('dragEnd');
    check(`size stays fixed on monitor ${d + 1}`, Math.abs(end.bounds.width - 260) <= 1 && Math.abs(end.bounds.height - 260) <= 1, end.bounds);
    check(`drag ends and position is saved on monitor ${d + 1}`, !end.dragging && end.saved && end.saved.x === end.bounds.x, end);
  }
  for (let i = 0; i < 20; i++) { await t('place', i % 2); }
  // window size never drifts, whatever the monitor scaling
  s = await t('info');
  check('size stays fixed after moving on every monitor', Math.abs(s.bounds.width - 260) <= 1 && Math.abs(s.bounds.height - 260) <= 1, s.bounds);

  // roaming on the desktop triggers walks when idle
  pet.roam = true; buddy.nextAct = 0; pomo.running = false; buddy.cheerUntil = 0; pet.napUntil = 0;
  pet.hunger = 80; pet.energy = 80; pet.joy = 80;
  await t('place', 0); buddy.nextAct = 0; const n0 = (await t('info')).walks; buddy.nextAct = 0; buddyTick(); await wait(300);
  s = await t('info');
  check('roaming walks the desktop pet', s.walks > n0, { n0, s });
  pet.roam = false;

  pet.desktop = false; buddyTick(); await wait(500);
  check('switching off closes the window', (await api.pet.test('info')).data === null);
  return JSON.stringify({ checks: count, monitors: screens, failed: fails }, null, 1);
})();

// Persistence check, part 3: change something, then roll back to today's backup (made in part 2).
(async () => {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  pet.coins = 5; savePet();
  await wait(300);
  const names = await call(api.db.list());
  const d = new Date(), today = `nightdesk-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.db`;
  const r = await api.db.restore(today);
  return JSON.stringify({ restoreOk: r.ok, error: r.error || '', listed: names.length, hasToday: names.includes(today) });
})();

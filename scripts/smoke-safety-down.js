// Database safety, part C: the database cannot be opened at all. The app must block, save nothing,
// and never pretend with starter data.
(async () => {
  const fails = [];
  let count = 0;
  const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
  check('database reported unavailable', store.persistent === false && !!store.loadError, { p: store.persistent, e: store.loadError });
  const box = document.querySelector('.dbdown');
  check('blocking notice shown over the whole app', !!box && getComputedStyle(box).position === 'fixed' && box.getBoundingClientRect().height >= innerHeight - 1, !!box);
  check('notice explains the data is safe', !!box && /data is safe/.test(box.textContent), box && box.textContent);
  logStudy(30, ''); pet.coins = 999; savePet(); settings.theme = 'light'; saveSettings();
  check('nothing written to browser storage', !Object.keys(localStorage).some((k) => k.startsWith('nd.')), Object.keys(localStorage));
  return JSON.stringify({ checks: count, failed: fails }, null, 1);
})();

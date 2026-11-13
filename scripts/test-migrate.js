// Unit test for the one-time data move (plain Node, no app window):  node scripts/test-migrate.js
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'), os = require('os'), path = require('path');
const { migrate } = require('../migrate');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-migrate-test-'));
const fails = [];
let count = 0;
const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };

function makeDb(dir, kv, { wal = false } = {}) {
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const f = path.join(dir, 'nightdesk.db');
  const d = new DatabaseSync(f);
  d.exec(`PRAGMA journal_mode = ${wal ? 'WAL' : 'DELETE'}; ${wal ? 'PRAGMA wal_autocheckpoint = 0;' : ''} CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)`);
  const put = d.prepare('INSERT INTO kv VALUES (?, ?, ?)');
  for (const [k, v] of Object.entries(kv)) put.run(k, JSON.stringify(v), Date.now());
  if (wal) { // leave the data only in the WAL file, as on the user's PC
    const keep = path.join(dir, 'keep');
    fs.copyFileSync(f, keep); fs.copyFileSync(f + '-wal', keep + '-wal'); d.close();
    fs.renameSync(keep, f); fs.renameSync(keep + '-wal', f + '-wal');
  } else d.close();
}
const readNew = (dir) => {
  const d = new DatabaseSync(path.join(dir, 'nightdesk.db'), { readOnly: true });
  const kv = Object.fromEntries(d.prepare('SELECT key, value FROM kv').all().map((r) => [r.key, JSON.parse(r.value)]));
  d.close();
  return kv;
};

// The real AppData copy (the user's own launches) and a redirected per-package copy.
const real = path.join(root, 'Roaming', 'Nightdesk');
const local = path.join(root, 'Local');
const virt = path.join(local, 'Packages', 'Claude_test', 'LocalCache', 'Roaming', 'Nightdesk');
makeDb(real, {
  settings: { theme: 'light', palette: 'blue' },
  subjects: [{ id: 'a1', name: 'FLAT' }, { id: 'a2', name: 'OS' }],
  log: [{ t: 1, m: 120, s: 'a2' }, { t: 2, m: 75, s: 'a1' }],
  pet: { name: 'Mochi', coins: 140 },
  dayFills: { '2026-11-20': 'yellow' },
}, { wal: true });
fs.writeFileSync(path.join(real, 'google.bin'), 'REAL-GOOGLE');
fs.writeFileSync(path.join(real, 'prefs.json'), '{"closeToTray":true}');
makeDb(virt, {
  settings: { theme: 'dark', palette: 'rose' }, // starter settings from a blank redirected copy: must NOT win
  subjects: [{ id: 's1', name: 'DSA / CP' }],
  log: [{ t: 2, m: 75, s: 'a1' }, { t: 3, m: 50, s: 's1' }], // one duplicate, one new session
  events: [{ id: 'e1', title: 'Exam' }],
  dayFills: { '2026-11-20': 'pink', '2026-11-21': 'mint' },
});
fs.writeFileSync(path.join(virt, 'spotify.bin'), 'VIRT-SPOTIFY');
fs.writeFileSync(path.join(virt, 'google.bin'), 'VIRT-GOOGLE');
fs.copyFileSync(path.join(virt, 'nightdesk.db'), path.join(virt, 'backups', 'nightdesk-2026-11-13.db'));

const dest = path.join(root, 'home', '.nightdesk');
const note = migrate({ newDir: dest, oldDir: real, localAppData: local });
check('move happened from both copies', note && note.sources.length === 2 && note.base === real, note);
const kv = readNew(dest);
check('settings come from the real copy', kv.settings.palette === 'blue' && kv.settings.theme === 'light', kv.settings);
check('pet comes from the real copy', kv.pet.coins === 140, kv.pet);
check('real subjects kept; redirected subject added', kv.subjects.map((s) => s.name).join() === 'FLAT,OS,DSA / CP', kv.subjects);
check('study sessions merged without duplicates', kv.log.length === 3 && kv.log.reduce((a, e) => a + e.m, 0) === 245, kv.log);
check('events only in the redirected copy are kept', kv.events && kv.events[0].title === 'Exam', kv.events);
check('sticky notes merged, real colour wins', kv.dayFills['2026-11-20'] === 'yellow' && kv.dayFills['2026-11-21'] === 'mint', kv.dayFills);
check('Google login from the real copy', fs.readFileSync(path.join(dest, 'google.bin'), 'utf8') === 'REAL-GOOGLE', null);
check('Spotify login from the redirected copy (real had none)', fs.readFileSync(path.join(dest, 'spotify.bin'), 'utf8') === 'VIRT-SPOTIFY', null);
check('prefs copied', fs.existsSync(path.join(dest, 'prefs.json')), null);
check('backups copied', fs.existsSync(path.join(dest, 'backups', 'nightdesk-2026-11-13.db')), null);
check('new database uses the plain journal (no WAL file)', !fs.existsSync(path.join(dest, 'nightdesk.db-wal')), null);
check('originals untouched', fs.existsSync(path.join(real, 'nightdesk.db-wal')) && fs.readFileSync(path.join(real, 'google.bin'), 'utf8') === 'REAL-GOOGLE', null);
check('runs only once', migrate({ newDir: dest, oldDir: real, localAppData: local }) === null, null);
const fresh = migrate({ newDir: path.join(root, 'fresh', '.nightdesk'), oldDir: path.join(root, 'nothing'), localAppData: path.join(root, 'nolocal') });
check('brand-new install: nothing to move', fresh === null, fresh);

fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ checks: count, failed: fails }, null, 1));
process.exit(fails.length ? 1 : 0);

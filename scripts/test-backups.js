// Unit test for long-term backups (plain Node, no app window):  node scripts/test-backups.js
// Two years of daily copies, growing like real data: old days get compressed and packed by month,
// nothing is lost, every day still restores, the mirror follows, and the weekly self-check passes.
const Module = require('module');
const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-backup-test-'));
const data = path.join(root, 'data'), mirrorDir = path.join(root, 'mirror');
const load = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { app: { getPath: () => data } } : load.call(this, req, ...rest); };
const db = require('../db');
const logs = [];
db.setLogger((...a) => logs.push(a.join(' ')));
db.setMirror(mirrorDir);

const fails = [];
let count = 0;
const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const read = (f) => { const d = new DatabaseSync(f, { readOnly: true }); const kv = Object.fromEntries(d.prepare('SELECT key, value FROM kv').all().map((r) => [r.key, r.value])); d.close(); return kv; };
const sizeOf = (dir) => fs.readdirSync(dir).filter((f) => /^nightdesk-/.test(f)).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);

db.set('subjects', JSON.stringify([{ id: 's1', name: 'OS' }]));
db.loadAll();
// A brand-new install has no backup yet: that is not a failed check, and it is not remembered.
const first = db.selfCheck(false);
check('new install: the backup check is neutral, not failed', first.ok === null, first);
check('new install: nothing is remembered, so the real check runs once a backup exists', !fs.existsSync(path.join(data, 'backup-check.json')));
check('new install: no FAILED line in the log', !logs.some((l) => /FAILED/.test(l)), logs);
db.backupNow();
const bdir = path.join(data, 'backups');
// 730 days of history. Each day's copy holds everything so far (the study log grows every day,
// plus screen-time records), like the real app.
const days = [];
const log = [];
for (let i = 730; i >= 1; i--) {
  const day = ymd(Date.now() - i * 864e5);
  days.push(day);
  for (let k = 0; k < 4; k++) log.push({ id: `${day}-${k}`, sub: 's1', min: 50, d: day, at: Date.now() - i * 864e5 + k * 36e5 });
  const f = path.join(bdir, `nightdesk-${day}.db`);
  const d = new DatabaseSync(f);
  d.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL); BEGIN');
  const put = d.prepare('INSERT INTO kv VALUES (?, ?, ?)');
  put.run('marker', day, 1);
  put.run('log', JSON.stringify(log), 1);
  for (const sd of days.slice(-60)) put.run(`screen-${sd}`, JSON.stringify({ total: 3600, apps: { Chrome: 1800, Code: 1800 }, hours: Array(24).fill(150) }), 1);
  d.exec('COMMIT'); d.close();
}
const before = sizeOf(bdir);

db.compactOld();
const files = fs.readdirSync(bdir);
const cut = ymd(Date.now() - 3 * 864e5);
const packs = files.filter((f) => /\.pack$/.test(f));
const looseOld = files.filter((f) => /^nightdesk-\d{4}-\d{2}-\d{2}\.db$/.test(f) && f.slice(10, 20) < cut);
check('two years packed into monthly files', packs.length >= 23 && packs.length <= 25, packs.length);
check('no plain copy older than 3 days left', looseOld.length === 0, looseOld.slice(0, 3));
check('last few days kept as plain files', files.filter((f) => /^nightdesk-.*\.db$/.test(f)).length >= 2, files.length);
check('this month so far kept as compressed daily files', files.some((f) => f.endsWith('.db.gz')), files.length);
const after = sizeOf(bdir);
check('history takes a small fraction of the space', after < before * 0.1, { before, after });
check('a second pass changes nothing', db.compactOld() === 0 && sizeOf(bdir) === after);

const listed = db.backups();
check('every one of the 731 days is still listed', listed.length === 731, listed.length);
check('newest first', listed[0] > listed[listed.length - 1], [listed[0], listed.at(-1)]);

// Restore a spread of days, including the oldest one; each comes back exactly as it was.
const live = path.join(data, 'nightdesk.db');
let wrong = 0;
const sample = [0, 1, 15, 100, 200, 364, 365, 500, 600, 690, 700, 729].map((i) => days[i]);
for (const day of sample) {
  const r = db.restore(`nightdesk-${day}.db`);
  const kv = read(live);
  const n = days.indexOf(day) + 1;
  if (kv.marker !== day || JSON.parse(kv.log).length !== n * 4 || !fs.existsSync(path.join(bdir, r.safety))) wrong++;
}
check('every sampled day restores to exactly its own data', wrong === 0, wrong);

// The mirror ends up with the packs and no loose copies of packed days.
const m = fs.readdirSync(mirrorDir);
check('mirror has every monthly pack', packs.every((p) => m.includes(p)), m.filter((f) => f.endsWith('.pack')).length);
check('mirror dropped loose copies of packed days', !m.some((f) => /^nightdesk-\d{4}-\d{2}-\d{2}\.db/.test(f) && packs.includes(`nightdesk-${f.slice(10, 17)}.pack`)), m.length);
// With the app's own backup folder gone, the mirror alone still has every day.
fs.rmSync(bdir, { recursive: true, force: true });
check('mirror alone still lists all 731 days', db.backups().length === 731, db.backups().length);
const r2 = db.restore(`nightdesk-${days[3]}.db`);
check('restore straight from the mirror works', read(live).marker === days[3], r2);

// Weekly self-check.
const ok = db.selfCheck(true);
check('self-check passes', ok.ok === true && ok.items > 0, ok);
check('self-check remembered for a week', db.selfCheck(false).at === ok.at);
const liveBefore = fs.readFileSync(live);
db.selfCheck(true);
check('self-check never changes the live database', Buffer.compare(liveBefore, fs.readFileSync(live)) === 0);
check('nothing failed along the way', !logs.some((l) => /failed|unreadable/.test(l)), logs.filter((l) => /failed|unreadable/.test(l)).slice(0, 3));

db.close();
fs.rmSync(root, { recursive: true, force: true });
if (fails.length) { console.log('FAIL test-backups\n' + fails.join('\n')); process.exit(1); }
console.log(JSON.stringify({ ok: true, checks: count, before, after }, null, 1));

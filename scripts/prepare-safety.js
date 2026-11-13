// Builds the test profile for the database-safety checks (run with plain Node, which has node:sqlite):
//  - nightdesk.db in the OLD WAL format, with its data only in the -wal file (as on the user's PC)
//  - an empty backup from before any data existed
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'), path = require('path');
const prof = process.argv[2];
fs.mkdirSync(path.join(prof, 'backups'), { recursive: true });
const tmp = path.join(prof, 'build.db');
const d = new DatabaseSync(tmp);
d.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)");
const put = d.prepare('INSERT INTO kv VALUES (?, ?, ?)');
put.run('__migrated', '1', Date.now());
put.run('subjects', JSON.stringify([{ id: 'a1', name: 'FLAT', color: '#d98a7c', goal: 60 }, { id: 'a2', name: 'OS', color: '#5b9dff', goal: 240 }]), Date.now());
put.run('log', JSON.stringify([{ t: Date.now() - 864e5, m: 120, s: 'a2' }, { t: Date.now() - 2 * 864e5, m: 75, s: 'a1' }]), Date.now());
// copy while still open, so the data exists only in the -wal file
fs.copyFileSync(tmp, path.join(prof, 'nightdesk.db'));
fs.copyFileSync(tmp + '-wal', path.join(prof, 'nightdesk.db-wal'));
d.close();
for (const f of fs.readdirSync(prof)) if (f.startsWith('build.db')) fs.rmSync(path.join(prof, f));
const e = new DatabaseSync(path.join(prof, 'backups', 'nightdesk-2025-02-01.db'));
e.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)');
e.close();
console.log('prepared');

'use strict';
// Local database: one SQLite file in the app's data folder. Every change is written to disk
// immediately (WAL journal, synchronous=FULL), so nothing is lost if the app is closed, killed
// or the PC loses power. A copy is kept every day in backups/ (the last 14 days).
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let db = null;
let stmt = {};
const dir = () => app.getPath('userData');
const file = () => path.join(dir(), 'nightdesk.db');
const backupDir = () => path.join(dir(), 'backups');

function openAt(p) {
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(p);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 3000;');
  d.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)');
  const ok = d.prepare('PRAGMA quick_check').get();
  if (!ok || Object.values(ok)[0] !== 'ok') { d.close(); throw new Error('database check failed'); }
  return d;
}

function latestBackup() {
  try {
    return fs.readdirSync(backupDir()).filter((f) => /^nightdesk-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().pop() || null;
  } catch { return null; }
}

function open() {
  if (db) return db;
  try {
    db = openAt(file());
  } catch (err) {
    // Damaged file: keep it aside for inspection and restore the newest daily backup.
    console.error('database could not be opened, restoring', err);
    const stamp = Date.now();
    for (const ext of ['', '-wal', '-shm']) { try { fs.renameSync(file() + ext, `${file()}${ext}.broken-${stamp}`); } catch {} }
    const last = latestBackup();
    if (last) fs.copyFileSync(path.join(backupDir(), last), file());
    db = openAt(file());
  }
  stmt = {
    all: db.prepare('SELECT key, value FROM kv'),
    set: db.prepare('INSERT INTO kv (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated'),
    del: db.prepare('DELETE FROM kv WHERE key = ?'),
  };
  dailyBackup();
  return db;
}

function loadAll() {
  open();
  const out = {};
  for (const row of stmt.all.all()) out[row.key] = row.value;
  return out;
}

function set(key, value) {
  if (typeof key !== 'string' || !key || key.length > 100) return;
  open();
  if (value == null) stmt.del.run(key);
  else stmt.set.run(key, String(value), Date.now());
}

function dailyBackup(force) {
  try {
    fs.mkdirSync(backupDir(), { recursive: true });
    const d = new Date(), name = `nightdesk-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.db`;
    const target = path.join(backupDir(), name);
    if (fs.existsSync(target)) { if (!force) return target; fs.rmSync(target); }
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(backupDir()).filter((f) => /^nightdesk-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 14))) fs.rmSync(path.join(backupDir(), f), { force: true });
    return target;
  } catch (err) { console.error('backup failed', err); return null; }
}

function close() {
  if (!db) return;
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {}
  db = null;
}

module.exports = { loadAll, set, close, backupNow: () => { open(); return dailyBackup(true); }, folder: dir, file };

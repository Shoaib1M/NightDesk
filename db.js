'use strict';
// Local database: one SQLite file in the app's data folder. Every change is written to disk
// immediately (WAL journal, synchronous=FULL), so nothing is lost if the app is closed, killed
// or the PC loses power.
//
// Backups: a copy every day in backups/, kept forever, and mirrored to Documents\Nightdesk Backups
// (synced off the machine when Documents is in OneDrive). If the database is damaged, or missing
// because the app data folder was wiped, the newest copy from either place is restored on start.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let db = null;
let stmt = {};
let mirrorDir = null;
const dir = () => app.getPath('userData');
const file = () => path.join(dir(), 'nightdesk.db');
const backupDir = () => path.join(dir(), 'backups');
const BACKUP = /^nightdesk-\d{4}-\d{2}-\d{2}\.db$/;
const log = (...a) => console.error('[db]', ...a);

function openAt(p, readOnly) {
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(p, readOnly ? { readOnly: true } : {});
  if (!readOnly) {
    d.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 3000;');
    d.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)');
  }
  const ok = d.prepare('PRAGMA quick_check').get();
  if (!ok || Object.values(ok)[0] !== 'ok') { d.close(); throw new Error('database check failed'); }
  return d;
}

const listIn = (d) => { try { return fs.readdirSync(d).filter((f) => BACKUP.test(f)); } catch { return []; } };
// Every backup from both places, newest first, each with the folder it lives in.
function allBackups() {
  const seen = new Map();
  for (const d of [backupDir(), mirrorDir].filter(Boolean)) for (const f of listIn(d)) if (!seen.has(f)) seen.set(f, path.join(d, f));
  return [...seen].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([name, full]) => ({ name, full }));
}
// The newest backup that actually opens and passes the integrity check.
function newestGoodBackup() {
  for (const b of allBackups()) {
    try { openAt(b.full, true).close(); return b; } catch { log('skipping damaged backup', b.name); }
  }
  return null;
}

function swapIn(source) {
  for (const ext of ['-wal', '-shm']) fs.rmSync(file() + ext, { force: true });
  fs.copyFileSync(source, file() + '.restoring');
  fs.renameSync(file() + '.restoring', file());
}

function open() {
  if (db) return db;
  fs.mkdirSync(dir(), { recursive: true });
  // App data wiped (or a new PC) but backups exist in Documents: bring the data back.
  if (!fs.existsSync(file())) {
    const b = newestGoodBackup();
    if (b) { log('no database found, restoring', b.name); swapIn(b.full); }
  }
  try {
    db = openAt(file());
  } catch (err) {
    // Damaged file: keep it aside for inspection and restore the newest good backup.
    log('database could not be opened, restoring', err);
    const stamp = Date.now();
    for (const ext of ['', '-wal', '-shm']) { try { fs.renameSync(file() + ext, `${file()}${ext}.broken-${stamp}`); } catch {} }
    const b = newestGoodBackup();
    if (b) swapIn(b.full);
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

function todayName() {
  const d = new Date();
  return `nightdesk-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.db`;
}

function dailyBackup(force) {
  let target = null;
  try {
    fs.mkdirSync(backupDir(), { recursive: true });
    target = path.join(backupDir(), todayName());
    if (force || !fs.existsSync(target)) {
      // Written to a temporary name first, so a crash mid-backup never leaves a half-written copy.
      const tmp = target + '.tmp';
      fs.rmSync(tmp, { force: true });
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      fs.renameSync(tmp, target); // every daily copy is kept forever (each is only a few kilobytes)
    }
  } catch (err) { log('backup failed', err); return null; }
  mirror(target, force);
  return target;
}

function mirror(target, force) {
  if (!mirrorDir || !target) return;
  try {
    fs.mkdirSync(mirrorDir, { recursive: true });
    const out = path.join(mirrorDir, path.basename(target));
    if (force || !fs.existsSync(out)) { fs.copyFileSync(target, out + '.tmp'); fs.renameSync(out + '.tmp', out); }
    // Fill in any days the mirror missed (for example while it was switched off).
    for (const f of listIn(backupDir())) {
      const o = path.join(mirrorDir, f);
      if (!fs.existsSync(o)) fs.copyFileSync(path.join(backupDir(), f), o);
    }
  } catch (err) { log('mirror failed', err); }
}

// Roll the whole database back to one of the daily copies. The current state is saved first.
function restore(name) {
  if (!BACKUP.test(String(name))) throw new Error('Unknown backup.');
  const b = allBackups().find((x) => x.name === name);
  if (!b) throw new Error('That backup no longer exists.');
  openAt(b.full, true).close(); // refuse a damaged copy before touching anything
  open();
  const safety = path.join(backupDir(), `before-restore-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${safety.replace(/'/g, "''")}'`);
  close();
  swapIn(b.full);
  open();
  return { restored: name, safety: path.basename(safety) };
}

function close() {
  if (!db) return;
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {}
  db = null;
}

// Called on a timer so a copy is still made each day when the app runs for days without restarting.
function backupIfDue() { if (db) dailyBackup(false); }

module.exports = {
  loadAll, set, close, backupIfDue, restore,
  backupNow: () => { open(); return dailyBackup(true); },
  backups: () => allBackups().map((b) => b.name),
  backupCount: () => allBackups().length,
  setMirror: (d) => { mirrorDir = d || null; },
  mirrorFolder: () => mirrorDir,
  folder: dir, file,
};

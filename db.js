'use strict';
// Local database: one SQLite file in the app's data folder.
//
// - Every change is committed straight into nightdesk.db (rollback journal, synchronous=FULL):
//   no WAL side files, so the file on disk is always complete and safe to copy.
// - Opening waits out temporary locks (another copy of the app closing, antivirus, OneDrive) for
//   up to ~10 seconds instead of failing.
// - Backups: a verified copy every day in backups/, kept forever, mirrored to
//   Documents\Nightdesk Backups. A copy is only kept if it contains everything the live database has.
// - Damage: only a genuinely corrupt file is replaced, by the newest backup that has data in it.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

let db = null;
let stmt = {};
let mirrorDir = null;
let logger = (...a) => console.error('[db]', ...a);
const dir = () => app.getPath('userData');
const file = () => path.join(dir(), 'nightdesk.db');
const backupDir = () => path.join(dir(), 'backups');
const BACKUP = /^nightdesk-\d{4}-\d{2}-\d{2}\.db$/;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const isTransient = (err) => /SQLITE_(BUSY|LOCKED|CANTOPEN|IOERR)|database is locked|unable to open|disk I\/O/i.test(`${err && err.code} ${err && err.message}`);
const isCorrupt = (err) => /SQLITE_(CORRUPT|NOTADB)|malformed|not a database|check failed/i.test(`${err && err.code} ${err && err.message}`);

function openAt(p, readOnly) {
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(p, readOnly ? { readOnly: true } : {});
  try {
    d.exec('PRAGMA busy_timeout = 5000;');
    if (!readOnly) {
      // Fold any older WAL file back into the main file, then use a plain rollback journal.
      const mode = Object.values(d.prepare('PRAGMA journal_mode').get())[0];
      if (String(mode).toLowerCase() === 'wal') d.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      d.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;');
      d.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)');
    }
    const ok = d.prepare('PRAGMA quick_check').get();
    if (!ok || Object.values(ok)[0] !== 'ok') throw new Error('database check failed');
    return d;
  } catch (err) { try { d.close(); } catch {} throw err; }
}

// Number of saved items in a database file (-1 if it cannot be read).
function rowCount(p) {
  try { const d = openAt(p, true); const n = d.prepare('SELECT count(*) AS n FROM kv').get().n; d.close(); return n; }
  catch { return -1; }
}

const listIn = (d) => { try { return fs.readdirSync(d).filter((f) => BACKUP.test(f)); } catch { return []; } };
// Every backup from both places, newest first, each with the folder it lives in.
function allBackups() {
  const seen = new Map();
  for (const d of [backupDir(), mirrorDir].filter(Boolean)) for (const f of listIn(d)) if (!seen.has(f)) seen.set(f, path.join(d, f));
  return [...seen].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([name, full]) => ({ name, full }));
}
// Only backups that open, pass the check and actually contain data can ever be restored.
const usable = (b) => rowCount(b.full) > 0;
function newestGoodBackup() { return allBackups().find(usable) || null; }

function swapIn(source) {
  for (const ext of ['-wal', '-shm', '-journal']) fs.rmSync(file() + ext, { force: true });
  fs.copyFileSync(source, file() + '.restoring');
  fs.renameSync(file() + '.restoring', file());
}

function openWithRetry(tries = 20) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return openAt(file()); }
    catch (err) {
      last = err;
      if (!isTransient(err)) throw err;
      logger(`database busy, retrying (${i + 1})`, err.message);
      if (i < tries - 1) sleep(500);
    }
  }
  throw last;
}

function open(quick) {
  if (db) return db;
  fs.mkdirSync(dir(), { recursive: true });
  // App data wiped (or a new PC) but backups exist in Documents: bring the data back.
  if (!fs.existsSync(file())) {
    const b = newestGoodBackup();
    if (b) { logger('no database found, restoring', b.name); swapIn(b.full); }
  }
  try {
    db = openWithRetry(quick ? 1 : 20);
  } catch (err) {
    if (!isCorrupt(err)) throw err; // a lock or I/O problem is not damage: never replace the file for it
    logger('database damaged, restoring newest good backup', err);
    const stamp = Date.now();
    for (const ext of ['', '-wal', '-shm', '-journal']) { try { fs.renameSync(file() + ext, `${file()}${ext}.broken-${stamp}`); } catch {} }
    const b = newestGoodBackup();
    if (b) swapIn(b.full);
    db = openWithRetry();
  }
  stmt = {
    all: db.prepare('SELECT key, value FROM kv'),
    count: db.prepare('SELECT count(*) AS n FROM kv'),
    set: db.prepare('INSERT INTO kv (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated'),
    del: db.prepare('DELETE FROM kv WHERE key = ?'),
  };
  cleanEmptyBackups();
  dailyBackup();
  return db;
}

// Loading never hands back an empty database while a backup holds data: that is not a real empty
// state but a read gone wrong. Re-open and retry; if it is still empty, restore the newest good backup
// (the live file is empty, so nothing can be lost by replacing it).
function loadAll(quick) {
  open(quick);
  let rows = stmt.all.all();
  if (rows.length === 0) {
    const b = newestGoodBackup();
    if (b) {
      for (let i = 0; i < (quick ? 1 : 6) && rows.length === 0; i++) {
        logger(`database looked empty while backup ${b.name} has data, re-opening (${i + 1})`);
        close(); sleep(400); open(true); rows = stmt.all.all();
      }
      if (rows.length === 0) {
        logger('database still empty, restoring', b.name);
        close(); swapIn(b.full); open(true); rows = stmt.all.all();
      }
    }
  }
  const out = {};
  for (const row of rows) out[row.key] = row.value;
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

// Backups with nothing in them (made before any data existed) are useless and dangerous to restore.
function cleanEmptyBackups() {
  if (!db || stmt.count.get().n === 0) return;
  for (const d of [backupDir(), mirrorDir].filter(Boolean)) {
    for (const f of listIn(d)) if (rowCount(path.join(d, f)) === 0) { fs.rmSync(path.join(d, f), { force: true }); logger('removed empty backup', f); }
  }
}

function dailyBackup(force) {
  let target = null;
  try {
    fs.mkdirSync(backupDir(), { recursive: true });
    target = path.join(backupDir(), todayName());
    const live = stmt.count.get().n;
    // Today's copy is (re)made if missing, forced, or holding less than the live database.
    if (force || !fs.existsSync(target) || rowCount(target) < Math.min(live, 1)) {
      const tmp = target + '.tmp';
      fs.rmSync(tmp, { force: true });
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const got = rowCount(tmp);
      if (got !== live) { fs.rmSync(tmp, { force: true }); throw new Error(`backup check failed: ${got} of ${live} items`); }
      fs.renameSync(tmp, target); // every daily copy is kept forever (each is only a few kilobytes)
    }
  } catch (err) { logger('backup failed', err); return null; }
  mirror(target, force);
  return target;
}

function mirror(target, force) {
  if (!mirrorDir || !target) return;
  try {
    fs.mkdirSync(mirrorDir, { recursive: true });
    // Copy today's file, plus any day the mirror is missing or holds an emptier copy of.
    for (const f of listIn(backupDir())) {
      const src = path.join(backupDir(), f), out = path.join(mirrorDir, f);
      const need = (force && src === target) || !fs.existsSync(out) || rowCount(out) < rowCount(src);
      if (need) { fs.copyFileSync(src, out + '.tmp'); fs.renameSync(out + '.tmp', out); }
    }
  } catch (err) { logger('mirror failed', err); }
}

// Roll the whole database back to one of the daily copies. The current state is saved first.
function restore(name) {
  if (!BACKUP.test(String(name))) throw new Error('Unknown backup.');
  const b = allBackups().find((x) => x.name === name);
  if (!b) throw new Error('That backup no longer exists.');
  if (!usable(b)) throw new Error('That backup is empty or damaged, so it was not restored.');
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
  try { db.close(); } catch {}
  db = null;
}

// Called on a timer so a copy is still made each day when the app runs for days without restarting.
function backupIfDue() { if (db) dailyBackup(false); }

module.exports = {
  loadAll, set, close, backupIfDue, restore,
  backupNow: () => { open(); return dailyBackup(true); },
  backups: () => allBackups().filter(usable).map((b) => b.name),
  backupCount: () => allBackups().filter(usable).length,
  setMirror: (d) => { mirrorDir = d || null; },
  setLogger: (fn) => { logger = fn; },
  mirrorFolder: () => mirrorDir,
  folder: dir, file,
};

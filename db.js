'use strict';
// Local database: one SQLite file in the app's data folder.
//
// - Every change is committed straight into nightdesk.db (rollback journal, synchronous=FULL):
//   no WAL side files, so the file on disk is always complete and safe to copy.
// - Opening waits out temporary locks (another copy of the app closing, antivirus, OneDrive) for
//   up to ~10 seconds instead of failing.
// - Backups: a verified copy every day in backups/, kept forever, mirrored to
//   Documents\Nightdesk Backups. A copy is only kept if it contains everything the live database has.
// - Copies older than 3 days are compressed, and each finished month's copies are packed into one
//   file (nightdesk-YYYY-MM.pack). Consecutive days are nearly identical, so a month packs to about
//   the size of one copy. Lossless: every single day stays listed and restorable, and each pack is
//   unpacked and compared byte for byte with the originals before those are removed.
// - Once a week the newest backup is actually unpacked and checked in full (backup-check.json).
// - Damage: only a genuinely corrupt file is replaced, by the newest backup that has data in it.
const { app } = require('electron');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

let db = null;
let stmt = {};
let mirrorDir = null;
let logger = (...a) => console.error('[db]', ...a);
const dir = () => app.getPath('userData');
const file = () => path.join(dir(), 'nightdesk.db');
const backupDir = () => path.join(dir(), 'backups');
const BACKUP = /^nightdesk-\d{4}-\d{2}-\d{2}\.db(\.gz)?$/;
const dayOf = (name) => name.slice(10, 20);
const COMPACT_AFTER_DAYS = 3;
const PACK = /^nightdesk-\d{4}-\d{2}\.pack$/;
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
function rawCount(p) {
  try { const d = openAt(p, true); const n = d.prepare('SELECT count(*) AS n FROM kv').get().n; d.close(); return n; }
  catch { return -1; }
}
// A compressed backup is unpacked to a scratch file to be read.
function unpack(p) {
  const out = path.join(require('os').tmpdir(), `nightdesk-unpack-${process.pid}-${path.basename(p, '.gz')}`);
  fs.writeFileSync(out, zlib.gunzipSync(fs.readFileSync(p)));
  return out;
}
// Counts are remembered per file version, so listing years of backups stays instant.
const counts = new Map();
function rowCount(p) {
  let st; try { st = fs.statSync(p); } catch { return -1; }
  const key = `${p}|${st.size}|${st.mtimeMs}`;
  if (counts.has(key)) return counts.get(key);
  let n;
  if (p.endsWith('.gz')) { let tmp = null; try { tmp = unpack(p); n = rawCount(tmp); } catch { n = -1; } finally { if (tmp) fs.rmSync(tmp, { force: true }); } }
  else n = rawCount(p);
  counts.set(key, n);
  return n;
}

// ---- monthly packs: brotli( 4-byte header length | JSON [{ name, len }] | the copies back to back )
function writePack(target, days) { // days: [{ name, buf }]
  const head = Buffer.from(JSON.stringify(days.map((d) => ({ name: d.name, len: d.buf.length }))));
  const len = Buffer.alloc(4); len.writeUInt32BE(head.length);
  const raw = Buffer.concat([len, head, ...days.map((d) => d.buf)]);
  fs.writeFileSync(target, zlib.brotliCompressSync(raw, { params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }));
}
function readPack(p) { // Map name -> Buffer
  const raw = zlib.brotliDecompressSync(fs.readFileSync(p));
  const hl = raw.readUInt32BE(0);
  const head = JSON.parse(raw.subarray(4, 4 + hl).toString());
  const out = new Map();
  let at = 4 + hl;
  for (const d of head) { out.set(d.name, raw.subarray(at, at + d.len)); at += d.len; }
  if (at !== raw.length) throw new Error('pack length mismatch');
  return out;
}
const bufCount = (buf) => {
  const tmp = path.join(require('os').tmpdir(), `nightdesk-count-${process.pid}-${Date.now()}.db`);
  try { fs.writeFileSync(tmp, buf); return rawCount(tmp); } finally { fs.rmSync(tmp, { force: true }); }
};
// Names and item counts of a pack, worked out once per pack version.
const packInfos = new Map();
function packInfo(p) {
  let st; try { st = fs.statSync(p); } catch { return null; }
  const key = `${p}|${st.size}|${st.mtimeMs}`;
  if (packInfos.has(key)) return packInfos.get(key);
  let info;
  try { info = new Map([...readPack(p)].map(([name, buf]) => [name, bufCount(buf)])); } catch (err) { logger('pack unreadable', p, err); info = null; }
  packInfos.set(key, info);
  return info;
}
const listPacks = (d) => { try { return fs.readdirSync(d).filter((f) => PACK.test(f)); } catch { return []; } };
// The bytes of any backup entry, wherever it is kept.
function bytesOf(b) {
  if (b.pack) { const buf = readPack(b.full).get(b.name); if (!buf) throw new Error('day missing from pack'); return buf; }
  return b.full.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(b.full)) : fs.readFileSync(b.full);
}
const countOf = (b) => (b.pack ? ((packInfo(b.full) || new Map()).get(b.name) ?? -1) : rowCount(b.full));

const listIn = (d) => { try { return fs.readdirSync(d).filter((f) => BACKUP.test(f)); } catch { return []; } };
// Every backup from both places, newest first, each with the folder it lives in.
function allBackups() {
  const seen = new Map();
  // One entry per day; the plain copy wins over a compressed one of the same day.
  for (const d of [backupDir(), mirrorDir].filter(Boolean)) {
    for (const f of listIn(d)) {
      const had = seen.get(dayOf(f));
      if (!had || had.pack || (had.name.endsWith('.gz') && !f.endsWith('.gz'))) seen.set(dayOf(f), { name: f, full: path.join(d, f) });
    }
  }
  // Days kept inside monthly packs (a loose copy of the same day, if any, is preferred).
  for (const d of [backupDir(), mirrorDir].filter(Boolean)) {
    for (const p of listPacks(d)) {
      const info = packInfo(path.join(d, p));
      if (info) for (const name of info.keys()) if (!seen.has(dayOf(name))) seen.set(dayOf(name), { name, full: path.join(d, p), pack: true });
    }
  }
  return [...seen.values()].sort((a, b) => (a.name < b.name ? 1 : -1));
}
// Only backups that open, pass the check and actually contain data can ever be restored.
const usable = (b) => countOf(b) > 0;
function newestGoodBackup() { return allBackups().find(usable) || null; }

function swapIn(b) {
  for (const ext of ['-wal', '-shm', '-journal']) fs.rmSync(file() + ext, { force: true });
  fs.writeFileSync(file() + '.restoring', bytesOf(b));
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
    if (b) { logger('no database found, restoring', b.name); swapIn(b); }
  }
  try {
    db = openWithRetry(quick ? 1 : 20);
  } catch (err) {
    if (!isCorrupt(err)) throw err; // a lock or I/O problem is not damage: never replace the file for it
    logger('database damaged, restoring newest good backup', err);
    const stamp = Date.now();
    for (const ext of ['', '-wal', '-shm', '-journal']) { try { fs.renameSync(file() + ext, `${file()}${ext}.broken-${stamp}`); } catch {} }
    const b = newestGoodBackup();
    if (b) swapIn(b);
    db = openWithRetry();
  }
  stmt = {
    all: db.prepare('SELECT key, value FROM kv'),
    count: db.prepare('SELECT count(*) AS n FROM kv'),
    last: db.prepare('SELECT max(updated) AS t FROM kv'),
    set: db.prepare('INSERT INTO kv (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated'),
    del: db.prepare('DELETE FROM kv WHERE key = ?'),
  };
  // Empty backups are kept too; they are simply never offered for restore (see usable()).
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
        close(); swapIn(b); open(true); rows = stmt.all.all();
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
    // Today's copy is (re)made if missing, forced, emptier than the live database, or older than the
    // latest change, so each day's copy ends up holding how that day ended (refreshed every 30 min).
    const changed = () => { const t = stmt.last.get().t; return t && t > fs.statSync(target).mtimeMs; };
    if (force || !fs.existsSync(target) || rowCount(target) < Math.min(live, 1) || changed()) {
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
      const need = (force && src === target) || !fs.existsSync(out) || (!f.endsWith('.gz') && rowCount(out) < rowCount(src));
      if (need) { fs.copyFileSync(src, out + '.tmp'); fs.renameSync(out + '.tmp', out); }
      // Once the compressed copy is in the mirror and checks out, its plain twin there can go.
      if (f.endsWith('.gz')) { const plain = path.join(mirrorDir, f.slice(0, -3)); if (fs.existsSync(plain) && rowCount(out) === rowCount(plain)) fs.rmSync(plain, { force: true }); }
    }
    // Monthly packs: copied over, then the mirror's loose copies of those days are removed once the
    // mirror's own pack is readable and holds them.
    for (const p of listPacks(backupDir())) {
      const src = path.join(backupDir(), p), out = path.join(mirrorDir, p);
      if (!fs.existsSync(out) || fs.statSync(out).size !== fs.statSync(src).size) { fs.copyFileSync(src, out + '.tmp'); fs.renameSync(out + '.tmp', out); }
      const info = packInfo(out);
      if (!info) continue;
      for (const f of listIn(mirrorDir)) {
        const name = f.replace(/\.gz$/, '');
        if (info.get(name) > 0 && info.get(name) === rowCount(path.join(mirrorDir, f))) fs.rmSync(path.join(mirrorDir, f), { force: true });
      }
    }
  } catch (err) { logger('mirror failed', err); }
}

// Roll the whole database back to one of the daily copies. The current state is saved first.
function restore(name) {
  if (!BACKUP.test(String(name))) throw new Error('Unknown backup.');
  const b = allBackups().find((x) => dayOf(x.name) === dayOf(name));
  if (!b) throw new Error('That backup no longer exists.');
  if (!usable(b)) throw new Error('That backup is empty or damaged, so it was not restored.');
  open();
  fs.mkdirSync(backupDir(), { recursive: true });
  const safety = path.join(backupDir(), `before-restore-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${safety.replace(/'/g, "''")}'`);
  close();
  swapIn(b);
  open();
  return { restored: name, safety: path.basename(safety) };
}

// Daily copies older than 3 days are compressed. Nothing is lost: the compressed file is unpacked and
// compared with the original before the original is removed, and it restores exactly like before.
function compactOld(now = Date.now()) {
  const c = new Date(now - COMPACT_AFTER_DAYS * 864e5);
  const cut = `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
  let done = 0;
  for (const f of listIn(backupDir())) {
    if (f.endsWith('.gz') || dayOf(f) >= cut) continue;
    const src = path.join(backupDir(), f), gz = src + '.gz';
    try {
      const n = rowCount(src);
      if (n <= 0) continue; // never touch an empty or unreadable copy
      fs.writeFileSync(gz + '.tmp', zlib.gzipSync(fs.readFileSync(src), { level: 9 }));
      fs.renameSync(gz + '.tmp', gz);
      if (rowCount(gz) !== n) { fs.rmSync(gz, { force: true }); throw new Error(`compressed copy of ${f} did not match`); }
      fs.rmSync(src, { force: true });
      done++;
    } catch (err) { logger('compact failed', err); }
  }
  if (done) logger(`compressed ${done} backup${done === 1 ? '' : 's'} older than 3 days`);
  const packed = packMonths(cut);
  if (done || packed) mirror(path.join(backupDir(), todayName()));
  return done;
}

// Every month whose days are all past the cutoff is packed into nightdesk-YYYY-MM.pack. A copy that
// turns up later for an already packed month is added to that month's pack.
function packMonths(cut) {
  const months = new Map();
  for (const f of listIn(backupDir())) {
    const m = f.slice(10, 17);
    const last = new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
    if (`${m}-${String(last).padStart(2, '0')}` >= cut) continue; // month not fully past the cutoff yet
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(f);
  }
  let packed = 0;
  for (const [m, files] of months) {
    const target = path.join(backupDir(), `nightdesk-${m}.pack`);
    try {
      const days = new Map();
      if (fs.existsSync(target)) for (const [name, buf] of readPack(target)) days.set(name, buf);
      const add = [];
      for (const f of files) {
        const b = { name: f.replace(/\.gz$/, ''), full: path.join(backupDir(), f) };
        const buf = bytesOf(b);
        if (bufCount(buf) <= 0) continue; // empty or unreadable copies are left alone
        days.set(b.name, buf); add.push(f);
      }
      if (!add.length) continue;
      const list = [...days].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([name, buf]) => ({ name, buf }));
      writePack(target + '.tmp', list);
      const back = readPack(target + '.tmp');
      const same = list.every((d) => back.has(d.name) && Buffer.compare(back.get(d.name), d.buf) === 0) && back.size === list.length;
      if (!same) { fs.rmSync(target + '.tmp', { force: true }); throw new Error(`pack for ${m} did not match`); }
      fs.renameSync(target + '.tmp', target);
      for (const f of add) fs.rmSync(path.join(backupDir(), f), { force: true });
      packed += add.length;
    } catch (err) { logger('pack failed', err); }
  }
  if (packed) logger(`packed ${packed} daily backup${packed === 1 ? '' : 's'} into monthly files`);
  return packed;
}

// Proves the backups work: unpacks the newest one into a scratch file and runs a full integrity
// check on it. The result is kept in backup-check.json and shown in Settings.
function selfCheck(force) {
  const out = path.join(dir(), 'backup-check.json');
  try { const last = JSON.parse(fs.readFileSync(out, 'utf8')); if (!force && Date.now() - last.at < 7 * 864e5) return last; } catch {}
  const b = newestGoodBackup();
  let res;
  if (!b) res = { at: Date.now(), ok: false, note: 'no backup with data yet' };
  else {
    let tmp = null;
    try {
      tmp = path.join(require('os').tmpdir(), `nightdesk-check-${process.pid}.db`);
      fs.writeFileSync(tmp, bytesOf(b));
      const d = openAt(tmp, true);
      const integrity = Object.values(d.prepare('PRAGMA integrity_check').get())[0];
      const items = d.prepare('SELECT count(*) AS n FROM kv').get().n;
      d.close();
      const ok = integrity === 'ok' && items > 0;
      res = { at: Date.now(), ok, backup: b.name, items, total: allBackups().length, note: ok ? 'checked in full' : `integrity: ${integrity}` };
    } catch (err) { res = { at: Date.now(), ok: false, backup: b.name, note: String(err && err.message) }; }
    finally { if (tmp) fs.rmSync(tmp, { force: true }); }
  }
  try { fs.writeFileSync(out + '.tmp', JSON.stringify(res)); fs.renameSync(out + '.tmp', out); } catch {}
  logger(`backup self-check ${res.ok ? 'ok' : 'FAILED'}: ${res.note}${res.backup ? ' (' + res.backup + ')' : ''}`);
  return res;
}

function close() {
  if (!db) return;
  try { db.close(); } catch {}
  db = null;
}

// Called on a timer so a copy is still made each day when the app runs for days without restarting.
function backupIfDue() { if (!db) return; dailyBackup(false); compactOld(); selfCheck(false); }

module.exports = {
  loadAll, set, close, backupIfDue, restore,
  backupNow: () => { open(); return dailyBackup(true); },
  compactOld, selfCheck, packMonths,
  lastCheck: () => { try { return JSON.parse(fs.readFileSync(path.join(dir(), 'backup-check.json'), 'utf8')); } catch { return null; } },
  backups: () => allBackups().filter(usable).map((b) => b.name),
  backupCount: () => allBackups().filter(usable).length,
  setMirror: (d) => { mirrorDir = d || null; },
  setLogger: (fn) => { logger = fn; },
  mirrorFolder: () => mirrorDir,
  folder: dir, file,
};

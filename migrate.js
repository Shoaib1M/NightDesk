'use strict';
// One-time move of Nightdesk's data from %APPDATA%\Nightdesk to %USERPROFILE%\.nightdesk.
//
// Why: Windows redirects writes to AppData made by programs started from inside a packaged
// ("MSIX") app, such as the Claude desktop app, into a hidden per-package copy. A Nightdesk started
// that way saw a different, stale copy of its data than one started from the taskbar. A folder
// outside AppData is never redirected, so every copy of the app now sees the same files.
//
// The move gathers data from the real AppData folder AND from any such hidden per-package copies,
// merges them (nothing is dropped), and never deletes or changes the originals.
const fs = require('fs');
const os = require('os');
const path = require('path');

const listItems = ['log', 'events', 'alarms', 'subjects'];
const idOf = { log: (e) => `${e.t}`, events: (e) => e.id, alarms: (e) => e.id, subjects: (e) => e.id };

function readKv(dir) {
  const src = path.join(dir, 'nightdesk.db');
  if (!fs.existsSync(src)) return null;
  // Work on a private copy (with its journal/WAL files) so the original is never touched.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightdesk-migrate-'));
  try {
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(src + ext)) fs.copyFileSync(src + ext, path.join(tmpDir, 'nightdesk.db' + ext));
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(path.join(tmpDir, 'nightdesk.db'));
    const rows = d.prepare('SELECT key, value, updated FROM kv').all();
    d.close();
    const kv = {};
    for (const r of rows) kv[r.key] = { value: r.value, updated: r.updated };
    return kv;
  } catch (err) {
    return null;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

const parse = (s, fb) => { try { const v = JSON.parse(s); return v == null ? fb : v; } catch { return fb; } };

// Base = the real AppData copy (what the user's own launches used). Lists from every other copy are
// added to it (by id; the base wins on conflicts), so study time or events recorded in a redirected
// copy are not lost. Settings, pet and the rest come from the base.
function mergeKv(base, others) {
  const out = { ...base };
  for (const kv of others) {
    for (const [k, v] of Object.entries(kv)) if (!out[k]) out[k] = v; // keys the base never had
    for (const key of listItems) {
      if (!kv[key]) continue;
      const mine = parse(out[key] && out[key].value, []), theirs = parse(kv[key].value, []);
      if (!Array.isArray(mine) || !Array.isArray(theirs)) continue;
      const seen = new Set(mine.map(idOf[key]));
      const added = theirs.filter((x) => x && !seen.has(idOf[key](x)));
      if (added.length) out[key] = { value: JSON.stringify([...mine, ...added]), updated: Date.now() };
    }
    if (kv.dayFills) {
      const mine = parse(out.dayFills && out.dayFills.value, {}), theirs = parse(kv.dayFills.value, {});
      out.dayFills = { value: JSON.stringify({ ...theirs, ...mine }), updated: Date.now() };
    }
  }
  // Study sessions on a subject that no longer exists count as "no subject".
  const ids = new Set(parse(out.subjects && out.subjects.value, []).map((s) => s.id));
  if (out.log) out.log.value = JSON.stringify(parse(out.log.value, []).map((e) => ({ ...e, s: ids.has(e.s) ? e.s : '' })).sort((a, b) => a.t - b.t));
  return out;
}

function writeKv(file, kv) {
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)');
  const put = d.prepare('INSERT OR REPLACE INTO kv (key, value, updated) VALUES (?, ?, ?)');
  d.exec('BEGIN');
  for (const [k, v] of Object.entries(kv)) put.run(k, v.value, v.updated || Date.now());
  d.exec('COMMIT');
  d.close();
}

// Every hidden per-package copy of %APPDATA%\Nightdesk on this PC.
function redirectedCopies(localAppData) {
  const root = path.join(localAppData, 'Packages');
  let pkgs = [];
  try { pkgs = fs.readdirSync(root); } catch {}
  return pkgs.map((p) => path.join(root, p, 'LocalCache', 'Roaming', 'Nightdesk')).filter((d) => fs.existsSync(d));
}

function migrate({ newDir, oldDir, localAppData, log = () => {} }) {
  if (fs.existsSync(path.join(newDir, 'nightdesk.db'))) return null; // already moved
  const sources = [oldDir, ...redirectedCopies(localAppData)].filter((d) => fs.existsSync(d));
  if (!sources.length) return null; // brand-new install: nothing to move
  fs.mkdirSync(path.join(newDir, 'backups'), { recursive: true });

  const read = sources.map((dir) => ({ dir, kv: readKv(dir) })).filter((s) => s.kv);
  const realOne = read.find((s) => s.dir === oldDir && Object.keys(s.kv).length > 0);
  const base = realOne || read.sort((a, b) => Object.keys(b.kv).length - Object.keys(a.kv).length)[0];
  if (base) {
    const merged = mergeKv(base.kv, read.filter((s) => s !== base).map((s) => s.kv));
    const tmp = path.join(newDir, 'nightdesk.db.moving');
    fs.rmSync(tmp, { force: true });
    writeKv(tmp, merged);
    fs.renameSync(tmp, path.join(newDir, 'nightdesk.db'));
  }

  // The saved logins are encrypted with a key kept in "Local State": copy the key file from the same
  // folder the login files come from, or the new folder could not unlock them.
  const credFrom = sources.find((d) => fs.existsSync(path.join(d, 'google.bin'))) || sources.find((d) => fs.existsSync(path.join(d, 'spotify.bin')));
  if (credFrom && fs.existsSync(path.join(credFrom, 'Local State')) && !fs.existsSync(path.join(newDir, 'Local State'))) {
    fs.copyFileSync(path.join(credFrom, 'Local State'), path.join(newDir, 'Local State'));
  }
  // Small files: the real folder's copy wins, otherwise the first redirected copy that has one.
  for (const f of ['prefs.json', 'google.bin', 'spotify.bin']) {
    const from = sources.find((d) => fs.existsSync(path.join(d, f)));
    if (from) fs.copyFileSync(path.join(from, f), path.join(newDir, f));
  }
  // Every daily backup from every copy (never overwriting one already there).
  for (const d of sources) {
    let files = [];
    try { files = fs.readdirSync(path.join(d, 'backups')); } catch {}
    for (const f of files) {
      const out = path.join(newDir, 'backups', f);
      if (/^nightdesk-\d{4}-\d{2}-\d{2}\.db$/.test(f) && !fs.existsSync(out)) fs.copyFileSync(path.join(d, 'backups', f), out);
    }
  }
  const note = { at: new Date().toISOString(), base: base && base.dir, sources, items: base ? Object.keys(base.kv).length : 0 };
  fs.writeFileSync(path.join(newDir, 'moved-from.json'), JSON.stringify(note, null, 2));
  log(`data moved to ${newDir} from ${sources.join(', ')} (base ${note.base})`);
  return note;
}

module.exports = { migrate, mergeKv, redirectedCopies };

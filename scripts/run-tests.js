// Runs every in-app check on a fresh throwaway profile:  npm test
// Run one suite:  node scripts/run-tests.js smoke-pet.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const shots = path.join(root, 'shots');
const electron = require('electron');
const only = process.argv[2];
let failed = false;

function launch(evalFile, extraEnv = {}) {
  const run = spawnSync(electron, ['.'], {
    cwd: root, encoding: 'utf8', timeout: 180000,
    env: { ...process.env, NIGHTDESK_SHOTS: shots, NIGHTDESK_EVAL: path.join(__dirname, evalFile), ...extraEnv },
  });
  return { status: run.status, out: (run.stdout || '') + (run.stderr || '') };
}
const passed = (r) => r.status === 0 && r.out.includes('EVAL') && !/Uncaught|"failed": \[\s*"/.test(r.out) && !/"pageErrors": \[\s*"/.test(r.out);
const report = (name, ok, out) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { failed = true; console.log(out); }
  else if (/"checks"/.test(out)) console.log(out.match(/"checks": \d+/)[0]);
};

const suites = ['smoke.js', 'smoke-quotes.js', 'smoke-edge.js', 'smoke-pet.js', 'smoke-deskpet.js', 'smoke-activity.js', 'smoke-visual.js', 'smoke-dayfill.js', 'smoke-notes.js', 'smoke-years.js', 'smoke-tz.js', 'smoke-focus.js', 'smoke-screen.js', 'smoke-safety', 'smoke-persist'];
for (const test of suites) {
  if (only && test !== only) continue;
  fs.rmSync(path.join(shots, 'profile'), { recursive: true, force: true });
  if (test === 'smoke-safety') {
    const prof = path.join(shots, 'profile');
    spawnSync(process.execPath, ['--no-warnings', path.join(__dirname, 'prepare-safety.js'), prof], { encoding: 'utf8' });
    const a = launch('smoke-safety-a.js');
    report(test + ' (old WAL database, empty backup)', passed(a), a.out);
    const b = launch('smoke-safety-b.js');
    const walGone = !fs.existsSync(path.join(prof, 'nightdesk.db-wal'));
    const emptyKept = fs.existsSync(path.join(prof, 'backups', 'nightdesk-2025-02-01.db')); // kept, never offered
    report(test + ' (cut-off session folded back in)', passed(b) && walGone && emptyKept, (walGone ? '' : 'WAL file still there\n') + (emptyKept ? '' : 'empty backup was deleted; it should be kept\n') + b.out);
    // A database that cannot be opened at all: a folder where the file should be.
    fs.rmSync(prof, { recursive: true, force: true });
    fs.mkdirSync(path.join(prof, 'nightdesk.db'), { recursive: true });
    const c = launch('smoke-safety-down.js');
    report(test + ' (database unavailable: blocks, saves nothing)', passed(c), c.out);
    continue;
  }
  if (test === 'smoke-persist') {
    // Write data, kill the app with no clean shutdown, start again on the same profile and read it back.
    const w = launch('smoke-persist-write.js', { NIGHTDESK_HARDKILL: '1' });
    if (!(w.out.includes('"wrote":true') && w.out.includes('"persistent":true'))) { report(test + ' (write)', false, w.out); continue; }
    // 30 old daily backups from last year: none of them may ever be deleted.
    const bdir = path.join(shots, 'profile', 'backups');
    fs.mkdirSync(bdir, { recursive: true });
    for (let i = 1; i <= 30; i++) fs.copyFileSync(path.join(shots, 'profile', 'nightdesk.db'), path.join(bdir, `nightdesk-2025-01-${String(i).padStart(2, '0')}.db`));
    const r = launch('smoke-persist-read.js');
    report(test + ' (after a hard kill)', passed(r), r.out);
    // Roll back to today's backup after changing something.
    const rs = launch('smoke-persist-restore.js');
    if (!rs.out.includes('"restoreOk":true')) { report(test + ' (restore)', false, rs.out); continue; }
    const f1 = launch('smoke-persist-final.js');
    const safety = fs.readdirSync(bdir).some((f) => f.startsWith('before-restore-'));
    report(test + ' (restore a day)', passed(f1) && safety, safety ? f1.out : 'no before-restore safety copy\n' + f1.out);
    // Wipe the app data folder completely, keeping only the Documents copy: everything must come back.
    const prof = path.join(shots, 'profile');
    for (const f of fs.readdirSync(prof)) if (f !== 'mirror') fs.rmSync(path.join(prof, f), { recursive: true, force: true });
    const f2 = launch('smoke-persist-final.js');
    report(test + ' (app data wiped, restored from Documents copy)', passed(f2), f2.out);
    continue;
  }
  const r = launch(test);
  report(test, passed(r), r.out);
}
process.exit(failed ? 1 : 0);

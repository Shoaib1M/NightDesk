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

const suites = ['smoke.js', 'smoke-quotes.js', 'smoke-edge.js', 'smoke-pet.js', 'smoke-deskpet.js', 'smoke-activity.js', 'smoke-visual.js', 'smoke-persist'];
for (const test of suites) {
  if (only && test !== only) continue;
  fs.rmSync(path.join(shots, 'profile'), { recursive: true, force: true });
  if (test === 'smoke-persist') {
    // Write data, kill the app with no clean shutdown, start again on the same profile and read it back.
    const w = launch('smoke-persist-write.js', { NIGHTDESK_HARDKILL: '1' });
    if (!(w.out.includes('"wrote":true') && w.out.includes('"persistent":true'))) { report(test + ' (write)', false, w.out); continue; }
    const r = launch('smoke-persist-read.js');
    report(test + ' (after a hard kill)', passed(r), r.out);
    continue;
  }
  const r = launch(test);
  report(test, passed(r), r.out);
}
process.exit(failed ? 1 : 0);

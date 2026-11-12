// Runs every in-app check on a fresh throwaway profile:  npm test
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const shots = path.join(root, 'shots');
const electron = require('electron');
let failed = false;

const only = process.argv[2];
for (const test of ['smoke.js', 'smoke-quotes.js', 'smoke-edge.js', 'smoke-pet.js', 'smoke-deskpet.js', 'smoke-activity.js']) {
  if (only && test !== only) continue;
  fs.rmSync(path.join(shots, 'profile'), { recursive: true, force: true });
  const run = spawnSync(electron, ['.'], {
    cwd: root, encoding: 'utf8', timeout: 180000,
    env: { ...process.env, NIGHTDESK_SHOTS: shots, NIGHTDESK_EVAL: path.join(__dirname, test) },
  });
  const out = (run.stdout || '') + (run.stderr || '');
  const ok = run.status === 0 && out.includes('EVAL') && !/Uncaught|"failed": \[\s*"/.test(out) && !/"pageErrors": \[\s*"/.test(out);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${test}`);
  if (!ok) { failed = true; console.log(out); }
  else if (/checks/.test(out)) console.log(out.match(/"checks": \d+/)[0]);
}
process.exit(failed ? 1 : 0);

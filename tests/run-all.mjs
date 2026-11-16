// Runs every *.test.mjs file in order, prints a summary, exits nonzero if any suite failed.
// usage: node run-all.mjs            (all suites)
//        SUITES=boot,phase1 node run-all.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const order = ['boot', 'phase1', 'gameplay', 'vehicles', 'wanted', 'missions', 'save', 'world', 'ui', 'perf', 'bot', 'screens'];
const want = process.env.SUITES ? process.env.SUITES.split(',') : order;
const files = want.map(n => `${n}.test.mjs`).filter(f => fs.existsSync(path.join(dir, f)));
let failed = 0; const summary = [];
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit', env: process.env });
  const ok = r.status === 0; if (!ok) failed++;
  summary.push(`${ok ? 'PASS' : 'FAIL'}  ${f}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
console.log('\n=== SUMMARY ===\n' + summary.join('\n') + `\n${files.length - failed}/${files.length} suites passed`);
process.exit(failed ? 1 : 0);

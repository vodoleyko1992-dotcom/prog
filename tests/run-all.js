'use strict';
// Runs tests/sync.sh, then every tests/*.test.js (optionally filtered by a substring) in its own child process,
// sequentially, and prints a summary table. Exit code 1 if any file failed.
//   node tests/run-all.js            all current tests (GALAXYZ target)
//   node tests/run-all.js gz         only files whose name contains "gz" (the GALAXYZ suites)
//   node tests/run-all.js live-      only files whose name contains "live-"
//   node tests/run-all.js --legacy [filter]   the retired OgameX-only tests in tests/legacy-ogamex/ (not run by default)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const LEGACY = 'legacy-ogamex';
const args = process.argv.slice(2);
const legacy = args.includes('--legacy');
const filter = args.filter((a) => !a.startsWith('--'))[0] || '';
const sync = spawnSync('bash', [path.join(dir, 'sync.sh')], { stdio: 'inherit' });
if (sync.status !== 0) { console.error('sync.sh failed'); process.exit(1); }

const list = (sub) => { try { return fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith('.test.js')).map((f) => (sub ? sub + '/' : '') + f); } catch (e) { return []; } };
const files = (legacy ? list(LEGACY) : list('')).filter((f) => path.basename(f).includes(filter)).sort();
if (!files.length) { console.log('no test files match', JSON.stringify(filter) + (legacy ? ' in ' + LEGACY : '')); process.exit(0); }
const rows = [];
for (const f of files) {
  console.log(`\n=== ${f}`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit', env: { ...process.env, OGX_NO_SYNC: '1' }, timeout: Number(process.env.OGX_FILE_TIMEOUT) || 15 * 60 * 1000 });
  rows.push({ file: f, ok: r.status === 0, status: r.status === null ? (r.signal || 'timeout') : r.status, sec: ((Date.now() - t0) / 1000).toFixed(1) });
}
const w = Math.max(...rows.map((r) => r.file.length));
console.log('\n' + 'file'.padEnd(w) + '  result  time');
for (const r of rows) console.log(r.file.padEnd(w) + '  ' + (r.ok ? 'ok    ' : 'FAIL  ') + `  ${r.sec}s` + (r.ok ? '' : `  (exit ${r.status})`));
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} files passed`);
process.exit(failed ? 1 : 0);

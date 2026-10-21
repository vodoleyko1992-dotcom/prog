'use strict';
// 8.0.6 (игрок: «собери пакет под фаерфокс, чтобы и на андроидном фаерфоксе работало»): пакет для Firefox 128+ (ПК и Android)
// node tests/tools/firefox-build.cjs [папка-вывода]  → l2wap-bot-v<версия>-firefox.zip (без tests/kb/docs/.git/.claude)
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', '..'), out = path.resolve(process.argv[2] || root);
const mf = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
// Firefox: фоновая страница вместо service worker (service worker в расширениях Firefox нет), без полей только для Chrome
const ff = { ...mf, background: { scripts: ['engine-core.js', 'background.js'] } };
delete ff.minimum_chrome_version; delete ff.version_name;
ff.browser_specific_settings = {
  gecko: { id: 'l2wap-bot@local', strict_min_version: '128.0', data_collection_permissions: { required: ['none'] } },
  gecko_android: { strict_min_version: '128.0' }   // 128 — первая версия с content_scripts world:"MAIN" (hook.js)
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l2ff-')), dir = path.join(tmp, 'pkg');
// 20.10: lite/ — отдельное облегчённое расширение (своя сборка tests/tools/lite-build.cjs), в основной пакет не входит
const skip = /^(tests|kb|docs|lite|\.git|\.claude|__pycache__|node_modules)$|\.(zip|orig)$/;
const copy = (s, d) => { fs.mkdirSync(d, { recursive: true }); for (const e of fs.readdirSync(s, { withFileTypes: true })) {
  if (skip.test(e.name)) continue; const a = path.join(s, e.name), b = path.join(d, e.name);
  if (e.isDirectory()) copy(a, b); else if (e.isFile()) fs.copyFileSync(a, b); } };
copy(root, dir);
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(ff, null, 2) + '\n');
const zip = path.join(out, `l2wap-bot-v${mf.version}-firefox.zip`);
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: dir });
console.log(zip + '\n' + dir);

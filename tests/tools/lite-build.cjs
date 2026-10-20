'use strict';
// 20.10 (тред «Упрошенка под Дестра», игрок: «потом сборка на хром + фаерфокс»): пакеты облегчённого бота из папки lite/.
// node tests/tools/lite-build.cjs [папка-вывода] → l2wap-lite-v<версия>.zip (Chrome) и l2wap-lite-v<версия>-firefox.zip (Firefox ПК/Android 128+)
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const src = path.join(__dirname, '..', '..', 'lite'), out = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const mf = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const skip = /\.(zip|orig)$|^\./;
const copy = (s, d) => { fs.mkdirSync(d, { recursive: true }); for (const e of fs.readdirSync(s, { withFileTypes: true })) {
  if (skip.test(e.name)) continue; const a = path.join(s, e.name), b = path.join(d, e.name);
  if (e.isDirectory()) copy(a, b); else if (e.isFile()) fs.copyFileSync(a, b); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l2lite-'));
fs.mkdirSync(out, { recursive: true });
function pack(name, manifest) {
  const dir = path.join(tmp, name);
  copy(src, dir);
  if (manifest) fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const zip = path.join(out, name + '.zip');
  fs.rmSync(zip, { force: true });
  execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: dir });
  return { zip, dir };
}
// Firefox: фоновая страница вместо service worker, без полей только для Chrome; gecko_android — та же сборка для Firefox на Android
const ff = { ...mf, background: { scripts: ['background.js'] } };
delete ff.minimum_chrome_version; delete ff.version_name;
ff.browser_specific_settings = {
  gecko: { id: 'l2wap-lite@local', strict_min_version: '128.0', data_collection_permissions: { required: ['none'] } },
  gecko_android: { strict_min_version: '128.0' }   // 128 — первая версия с content_scripts world:"MAIN" (hook.js)
};
const c = pack(`l2wap-lite-v${mf.version}`), f = pack(`l2wap-lite-v${mf.version}-firefox`, ff);
console.log([c.zip, c.dir, f.zip, f.dir].join('\n'));

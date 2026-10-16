'use strict';
// 10.0.7 (игрок 13.10 02:31: «Ченч логов стало в папке очень много»): файлы CHANGELOG-X.Y.Z.md живут в docs/changelog/,
// в корне — одно оглавление CHANGELOG.md со ссылками на каждый; расширению история не нужна — папка docs/ в zip не входит
// (firefox-build.cjs пропускает её так же, как tests/ и kb/; команда zip в навыке l2-build исключает 'docs/*').
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const rootFiles = fs.readdirSync(root);
assert.deepEqual(rootFiles.filter(f => /^CHANGELOG-.*\.md$/.test(f)), [], 'в корне не должно остаться CHANGELOG-X.Y.Z.md');
assert.ok(rootFiles.includes('CHANGELOG.md'), 'в корне есть оглавление CHANGELOG.md');
const hist = fs.readdirSync(path.join(root, 'docs/changelog')).filter(f => /^CHANGELOG-.*\.md$/.test(f));
assert.ok(hist.length >= 69, 'история версий в docs/changelog/: ' + hist.length);
const idx = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const links = [...idx.matchAll(/\]\((docs\/changelog\/CHANGELOG-[^)]+\.md)\)/g)].map(m => m[1]);
for (const f of hist) assert.ok(links.includes('docs/changelog/' + f), 'в оглавлении нет ссылки на ' + f);
for (const l of links) assert.ok(fs.existsSync(path.join(root, l)), 'битая ссылка ' + l);
assert.equal(links.length, new Set(links).size, 'ссылки без повторов');
assert.equal(links[0], 'docs/changelog/CHANGELOG-' + JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version + '.md', 'текущая версия сверху'); // 20.2: номер задаёт manifest, а не диапазон 10.x.
// сборки не кладут docs/ в пакет
const ff = fs.readFileSync(path.join(root, 'tests/tools/firefox-build.cjs'), 'utf8');
const skip = ff.match(/const skip = (\/.*\/);/)[1];
const re = eval(skip);
for (const d of ['docs', 'tests', 'kb', '.git', '.claude']) assert.ok(re.test(d), 'firefox-build пропускает ' + d);
for (const d of ['modules', 'manifest.json', 'content.js']) assert.ok(!re.test(d), 'firefox-build оставляет ' + d);
const skill = fs.readFileSync(path.join(root, '.claude/skills/l2-build/SKILL.md'), 'utf8');
assert.ok(/zip -qr l2wap-bot-vX\.Y\.Z\.zip \. -x [^\n]*'docs\/\*'/.test(skill), 'команда zip в l2-build исключает docs/*');
console.log('PASS v1007-changelog-layout');

'use strict';
// Lite 1.0 (20.10, тред «Упрошенка под Дестра»): пакет облегчённого бота lite/ — состав, порядок скриптов, общие файлы
// совпадают с основным ботом, токен и пароль никуда не пишутся, сборки Chrome/Firefox, основной пакет lite/ не включает.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..'), lite = path.join(root, 'lite');
const read = f => fs.readFileSync(path.join(lite, f), 'utf8');
const mf = JSON.parse(read('manifest.json'));

assert.equal(mf.manifest_version, 3);
assert.equal(mf.version, '1.5');
assert.equal(mf.version_name, '1.5 Lite');
assert.deepEqual(mf.permissions, ['storage', 'alarms', 'notifications']);               // без tabs/scripting/<all_urls>
assert.deepEqual(mf.host_permissions, ['https://l2wap.com/*', 'https://*.l2wap.com/*']);
assert.ok(mf.description.length <= 132, 'описание Chrome ≤ 132 символов');
// 1.4: меню окном на странице игры — iframe popup.html#dock; страницам игры доступно только меню и его файлы, ничего больше
assert.deepEqual(mf.web_accessible_resources, [{ resources: ['popup.html', 'popup.css', 'popup.js', 'logic.js'], matches: ['https://l2wap.com/*', 'https://*.l2wap.com/*'] }]);
for (const f of mf.web_accessible_resources[0].resources) assert.ok(fs.existsSync(path.join(lite, f)), 'нет файла ' + f);
const cs = mf.content_scripts;
assert.equal(cs[0].world, 'MAIN'); assert.equal(cs[0].run_at, 'document_start'); assert.deepEqual(cs[0].js, ['hook.js']);
assert.deepEqual(cs[2].js, ['logic.js', 'battle-cooldown.js', 'bot.js']);               // логика и откаты раньше бота
for (const f of [...cs.flatMap(c => c.js), mf.background.service_worker, mf.action.default_popup, ...Object.values(mf.icons), 'popup.js', 'popup.css', 'README.txt'])
  assert.ok(fs.existsSync(path.join(lite, f)), 'нет файла ' + f);
const popup = read('popup.html');
assert.ok(popup.indexOf('logic.js') > 0 && popup.indexOf('logic.js') < popup.indexOf('popup.js'), 'меню грузит logic.js до popup.js');

// Общие файлы — точные копии основного бота (правка одного без другого — расхождение моделей).
for (const f of ['battle-cooldown.js', 'notranslate.js'])
  assert.equal(read(f), fs.readFileSync(path.join(root, f), 'utf8'), f + ' в lite/ отличается от основного');

// Безопасность: токен страницы только в заголовке своего запроса; пароль и ключ auth не трогаем; капчу не решаем.
for (const f of fs.readdirSync(lite).filter(f => f.endsWith('.js'))) {
  const s = read(f);
  const tok = s.split('\n').filter(l => /token/i.test(l) && !/^\s*\/\//.test(l));
  for (const l of tok) assert.ok(/localStorage\.getItem\('token'\)/.test(l) && !/log\(|console\./.test(l), f + ': токен вне заголовка запроса: ' + l.trim());
  assert.ok(!/['"]auth['"]|password|passw/i.test(s.replace(/input\[type="password"\]/g, '')), f + ': пароль/auth');
  assert.ok(!/antibot\/(?:answer|solve)|l2-antibot-card__options\s+button/i.test(s), f + ': попытка решить проверку активности');
}
const bot = read('bot.js');
assert.ok(/abHold\(\) && !el\.closest\?\.\('\.l2-antibot-card--blocked'\)\) return false/.test(bot), 'fire() молчит во время проверки активности');
assert.ok(/if \(abHold\(\)\) throw new Error\('antibot'\)/.test(bot), 'свои запросы молчат во время проверки активности');
assert.ok(/teleportCost/.test(bot) && !/coin.?of.?luck['"]?\s*:/i.test(bot), 'телепорт через проверку цены');
// Firefox для Android: значка, уведомлений и chrome.commands может не быть — фон не должен падать.
const bg = read('background.js');
assert.ok(!/chrome\.commands/.test(bg));
assert.ok(/!chrome\.action \|\| !chrome\.action\.setBadgeText/.test(bg) && /chrome\.notifications && chrome\.notifications\.create/.test(bg));

// Основной пакет lite/ не включает.
assert.match(fs.readFileSync(path.join(root, 'tests/tools/firefox-build.cjs'), 'utf8'), /\|lite\|/);
assert.match(fs.readFileSync(path.join(root, '.claude/skills/l2-build/SKILL.md'), 'utf8'), /-x 'tests\/\*' 'kb\/\*' 'docs\/\*' 'lite\/\*'/);

// Сборка: Chrome — файлы lite/ как есть; Firefox — фоновая страница, gecko id, без полей Chrome.
let zipOk = true; try { execFileSync('zip', ['-v'], { stdio: 'ignore' }); } catch (e) { zipOk = false; }
if (zipOk) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'lite-test-'));
  const lines = execFileSync(process.execPath, [path.join(root, 'tests/tools/lite-build.cjs'), out], { encoding: 'utf8' }).trim().split('\n');
  const [czip, cdir, fzip, fdir] = lines;
  assert.ok(fs.existsSync(czip) && /l2wap-lite-v1\.5\.zip$/.test(czip));
  assert.ok(fs.existsSync(fzip) && /l2wap-lite-v1\.5-firefox\.zip$/.test(fzip));
  const list = d => { const r = []; const walk = (p, rel) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) e.isDirectory() ? walk(path.join(p, e.name), rel + e.name + '/') : r.push(rel + e.name); }; walk(d, ''); return r.sort(); };
  assert.deepEqual(list(cdir), list(lite).filter(f => !/\.zip$/.test(f)));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cdir, 'manifest.json'), 'utf8')), mf);
  const ff = JSON.parse(fs.readFileSync(path.join(fdir, 'manifest.json'), 'utf8'));
  assert.deepEqual(ff.background, { scripts: ['background.js'] });
  assert.equal(ff.browser_specific_settings.gecko.id, 'l2wap-lite@local');
  assert.equal(ff.browser_specific_settings.gecko.strict_min_version, '128.0');
  assert.equal(ff.browser_specific_settings.gecko_android.strict_min_version, '128.0');
  assert.ok(!('version_name' in ff) && !('minimum_chrome_version' in ff));
  // 1.2.1 (John: «нет даже меню вызова»): кнопка закреплена на панели Firefox, а не спрятана в меню «Расширения»
  assert.deepEqual(ff.action, { ...mf.action, default_area: 'navbar' });
  assert.ok(!('default_area' in mf.action), 'Chrome-манифест без ключа Firefox');
  fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(path.dirname(cdir), { recursive: true, force: true });
} else console.log('zip не установлен — проверка сборки пропущена');
console.log('lite-manifest PASS');

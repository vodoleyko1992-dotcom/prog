'use strict';
// 8.0 (аудит ядра): перезагрузки по кругу, остановки при простое сервера, запись rt из меню, замок, сторож
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const { createRecoveryController } = require('../engine-core.js');
const content = read('content.js'), bg = read('background.js'), hook = read('hook.js'), popup = read('popup.js');

// 1. «Cannot read properties of undefined» больше не перезагружает страницу бесконечно: счётчик переживает перезагрузку
let now = 1_000_000; const clock = () => now;
const err = new TypeError("Cannot read properties of undefined (reading 'x')");
let saved = null; const actions = [];
for (let page = 0; page < 6; page++) {                         // каждая итерация — новая страница (новый контроллер)
  const rc = createRecoveryController(clock);
  if (saved) rc.restoreFatal('/map.html', saved);
  const d = rc.failure('/map.html', err); saved = rc.exportFatal('/map.html'); actions.push(d.action); now += 7000;
  if (d.action === 'halt') break;
}
assert.deepEqual(actions, ['retry', 'reload', 'reload', 'halt'], 'retry → reload → (map) → halt, not an endless loop');
const rc2 = createRecoveryController(clock); rc2.restoreFatal('/map.html', { message: 'x', count: 3, at: now - 11 * 60000 });
assert.equal(rc2.exportFatal('/map.html'), null, 'older than 10 min is not restored');
assert.match(content, /sessionStorage\.getItem\('l2bot-fatal'\)[\s\S]{0,200}recovery\.restoreFatal\(route, fatalAll\[route\]\)/);
// 15.10: режим заточки не уводится на карту восстановлением; для обычных режимов третий повтор по-прежнему меняет страницу.
const mapRecovery = content.match(/if \((d\.action === 'reload' && d\.programming && d\.fatalRepeats === 3[^\n]+)\) \{([\s\S]*?)\n  \}/);
assert.ok(mapRecovery, 'third-repeat recovery branch exists');
const recoveryToMap = (mode, page = '/char.html', repeats = 3) => vm.runInNewContext(mapRecovery[1], {
  d: { action: 'reload', programming: true, fatalRepeats: repeats }, autonomyMode: () => mode, location: { pathname: page }
});
assert.equal(recoveryToMap('farm'), true); assert.equal(recoveryToMap('enchant'), false);
assert.equal(recoveryToMap('farm', '/map.html'), false); assert.equal(recoveryToMap('farm', '/char.html', 2), false);
// Реворк20.9: общий flush повторно сверяет владельца/поколение и подтверждённую запись.
assert.match(mapRecovery[2], /if \(await automationFlush\(stamp\)\) location\.href = '\/map\.html'/, 'map recovery needs durable current-context guard');
assert.match(content, /function automationCurrent\(stamp\) \{ return on && tabOwner && stamp === automationSnapshot\(\)/);

// 2. простой сервера не превращается в остановку
assert.match(content, /if \(!hard && on && !\(await srvUp\(\)\)\) \{[^\n]*return serverWait\(\); \}/, 'soft halts wait for the server');
assert.match(content, /d\.action === 'halt' && d\.programming && \/cannot \(\?:read\|set\) properties of \(\?:null\|undefined\)\/i\.test\(d\.error\) && !\(await srvUp\(\)\)/);
const srvAnswer = vm.runInNewContext(`(${content.match(/const srvAnswer = (\(status, ct\) => [^;]+);/)[1]})`);
assert.equal(srvAnswer(200, 'application/json; charset=utf-8'), true);
assert.equal(srvAnswer(200, 'text/html'), false, 'maintenance page with 200 HTML = not up');
assert.equal(srvAnswer(401, 'application/json'), true); assert.equal(srvAnswer(404, 'text/html'), true, 'endpoint moved — server is up, do not wait forever');
assert.equal(srvAnswer(502, 'text/html'), false);
assert.match(bg, /return r\.status < 500 && !\(r\.status === 200 && !\/json\/i\.test\(r\.headers\.get\('content-type'\) \|\| ''\)\) \? 'up' : 'down';/);
assert.match(content, /if \(netOutage\.since && !rt\.downT && \$q\('#l2-hud-legacy-name, #l2-nav-bottom'\)\) \{[\s\S]{0,200}await sleep\(3000\);\s+if \(!automationCurrent\(stamp\)\) return;\s+const up = await srvUp\(\); if \(!automationCurrent\(stamp\)\) return;\s+if \(up\) \{ netOutage\.since = 0;/, 'short API burst: guarded probe, no reload');
assert.doesNotMatch(content, /setRt\(\{ status: `Сервер игры недоступен/, 'outage countdown no longer writes rt every second');

// 3. меню: переключатель не переписывает весь rt; служебные ключи не попадают в экспорт/импорт памяти
assert.match(bg, /const change = Object\.keys\(rtPatch\)\.length \? \{ rt: \{ \.\.\.\(state\.rt \|\| \{\}\), \.\.\.rtPatch, _src: 'menu' \} \} : \{\};/);
assert.match(bg, /if \(Object\.keys\(change\)\.length\) await chrome\.storage\.local\.set\(change\);/);
for (const k of ['lock', 'wdDown', 'stopMeta', 'paused', 'auth']) assert.ok(new RegExp(`MEM_SKIP = new Set\\([^)]*'${k}'`).test(popup), `MEM_SKIP has ${k}`);

// 4. замок: сравнение только по эпохе; сигнал «жив» продлевает замок; вкладку бота не выгружать; старт сбрасывает метку простоя
// 19.10.2026: финальный flush после Stop тоже теряет право записи при передаче lease.
assert.match(content, /if \(ch\.lock && tabOwner && ch\.lock\.newValue\?\.epoch !== leaseEpoch\) \{/);
assert.match(bg, /if \(valid && Date\.now\(\) - lock\.t > 20000\) await chrome\.storage\.local\.set\(\{ lock: \{ \.\.\.lock, t: Date\.now\(\) \} \}\);/);
assert.match(bg, /chrome\.tabs\.update\(tab, \{ autoDiscardable: false \}\)/);
assert.match(bg, /hbBg: \{ \.\.\.nextHb \}, wdog: \[\], wdDown: null \}/);
// 5. ключи-секреты в перехватчике
const SECRET = new RegExp(hook.match(/const SECRET = \/(.+)\/i;/)[1], 'i');
for (const k of ['accessJwt', 'bearerToken', 'ticket', 'apiKey', 'refreshToken', 'password']) assert.ok(SECRET.test(k), k);
for (const k of ['itemId', 'qty', 'spawnId', 'serverNowMs', 'maxHp']) assert.ok(!SECRET.test(k), k);
console.log('PASS: no endless reload loop (counter survives reload, map, then halt), outages never halt, 200-HTML = down, short API burst without reload, menu toggles keep rt, lock by epoch + renew on heartbeat, no tab discard');

'use strict';
// 7.2.5 (игрок 10.10, скрин «502 Bad gateway»: «сервер уходит в перезагрузку — бот должен восстанавливаться и продолжать задачу»)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const bg = read('background.js'), content = read('content.js');
const wdPlan = vm.runInNewContext(`(${bg.slice(bg.indexOf('function wdPlan('), bg.indexOf('async function srvProbe('))})`);
const now = 10_000_000, R = n => Array.from({ length: n }, (_, i) => now - (i + 1) * 60000);
// 1. фоновый сторож: сервер лежит — перезагрузка раз в 2 мин, никогда не остановка и не попытка
assert.equal(wdPlan({ quiet: 100000, recent: [], srv: 'down', now }).act, 'none', 'tab is alive — nothing to do');
assert.deepEqual({ ...wdPlan({ quiet: 200000, recent: R(3), srv: 'down', now }) }, { act: 'reload', down: true }, 'server down + 3 reloads — NOT stop');
assert.deepEqual({ ...wdPlan({ quiet: 200000, recent: R(5), srv: 'down', downLast: now - 60000, wasDown: true, now }) }, { act: 'none', down: true }, 'max once per 2 min');
assert.deepEqual({ ...wdPlan({ quiet: 200000, recent: R(3), srv: 'up', wasDown: true, now }) }, { act: 'reload', back: true }, 'server back — reload at once, not counted');
// сервер отвечает, а вкладка молчит — как раньше: 3 попытки за 20 мин, потом стоп (рыбалка — реже, без стопа)
assert.deepEqual({ ...wdPlan({ quiet: 200000, recent: R(1), srv: 'up', now }) }, { act: 'reload', count: true });
assert.equal(wdPlan({ quiet: 200000, recent: R(3), srv: 'up', now }).act, 'stop');
assert.equal(wdPlan({ quiet: 200000, recent: [now - 6 * 60000, now - 7 * 60000, now - 8 * 60000], fish: true, srv: 'up', now }).act, 'fishReload');
// проводка в обработчике будильника
assert.match(bg, /const server = await srvProbe\(origin\);[\s\S]*const plan = wdPlan\(\{ quiet, recent, fish: fishMode, srv: server, downLast: wdDown\?\.last \|\| 0, wasDown: !!wdDown, now \}\);/);
assert.match(bg, /if \(plan\.down\) \{[\s\S]{0,900}chrome\.tabs\.reload\(hb\.tab\)[\s\S]{0,60}return;\s+\}\s+if \(plan\.back\)/);
assert.match(bg, /if \(quiet < 150000\) \{ if \(wdDown\) await chrome\.storage\.local\.set\(\{ wdDown: null \}\); return; \}/);
assert.match(bg, /fetch\(origin \+ '\/game\/time', \{ cache: 'no-store', credentials: 'include', signal: c\.signal \}\); return r\.status < 500 && !\(r\.status === 200 && !\/json\/i\.test/);   // 8.0: 200 + HTML = техработы
// 2. вкладка: раз в 10 с спрашивает сервер и перезагружается сразу, как он ответил
assert.match(content, /if \(Date\.now\(\) - probeT >= 10000\) \{ probeT = Date\.now\(\); const up = await srvUp\(\); if \(!automationCurrent\(stamp\)\) return; if \(up\) \{ rec\('S', 'сервер', `сервер снова отвечает/);
assert.match(content, /async function srvUp\(\) \{[\s\S]{0,300}fetch\('\/game\/time', \{ cache: 'no-store', credentials: 'include', signal: c\.signal \}\); return srvAnswer\(r\.status, r\.headers\.get\('content-type'\)\); \}/);   // 8.0
// 3. простой сервера не превращается в остановку: ни «нет прогресса 9 мин ×3», ни «сбой повторился»
// Реворк20.9: сетевой probe сначала проверяет контекст; недоступный сервер по-прежнему ждём.
assert.match(content, /const up = await srvUp\(\); if \(!automationCurrent\(stamp\)\) continue;\s+if \(!up\) \{[^\n]*await serverWait\(\); continue; \}/);
assert.match(content, /if \(d\.action === 'halt' && !d\.programming && !\(await srvUp\(\)\)\) \{\s+if \(!automationCurrent\(stamp\)\) return;[\s\S]{0,300}return serverWait\(\);/);
// 4. страница техработ (не 5xx) — тоже простой, но не страница входа
const sd = content.slice(content.indexOf('function serverDown() {'), content.indexOf('// 7.2.5 (игрок 10.10, скрин 502 Bad gateway'));
const mk = (title, text, pw) => { const doc = { title, body: { innerText: text }, querySelector: s => s === 'input[type="password"]' && pw ? {} : null };
  return vm.runInNewContext(`${sd}; serverDown()`, { document: doc, netOutage: { since: 0, last: 0 }, $q: () => null, Date }); };
assert.equal(mk('l2wap.com | 502: Bad gateway', 'Error code 502'), true);
assert.equal(mk('L2WAP', 'Технічні роботи: сервер буде доступний о 15:00'), true, 'maintenance page = outage');
assert.equal(mk('L2WAP', 'Технічні роботи завершено. Логін Пароль', true), false, 'login page with the news — log in, do not wait');
assert.equal(mk('L2WAP', 'Магазин рыбака'), false);
console.log('PASS: server outage — watchdog never stops the bot while the server is down, reloads at once when it answers; tab probes every 10 s; outage ≠ stall/halt; maintenance page');

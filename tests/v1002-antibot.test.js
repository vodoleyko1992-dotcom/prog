'use strict';
// 10.0.2: проверка активности игры (anti_bot_challenge). Пока висит — ни кликов бота, ни своих запросов к игре; состояние переживает
// перезагрузку (rt.abChal); снимается по passed / not_found / блоку фарма; Start не подтверждает прохождение. Поведение целиком — tests/v1002-antibot-browser.cjs
const assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const content = read('content.js'), hook = read('hook.js');
// hook: «passed» доходит до бота, пароли по-прежнему режутся
const SECRET = eval(hook.match(/const SECRET = (\/.*?\/i);/)[1]);
assert.equal(SECRET.test('passed'), false); for (const k of ['password', 'pass', 'passwd', 'token', 'captcha']) assert.equal(SECRET.test(k), true, k);
// abNet + затвор fetch — в песочнице
const a = content.indexOf('function abNet('), z = content.indexOf('  return r;\n};', a) + 14;
assert.ok(a > 0 && z > a);
const net = []; let rt = { abChal: null }; const logs = [];
const sb = { rt, Date, String, JSON, URL, location: { href: 'https://l2wap.com/battle.html' }, rec: (...x) => logs.push(x.join(' ')), setRt: p => { Object.assign(sb.rt, p); },
  abLayer: () => null, Response: class { constructor(b, o) { this.status = o.status; this.b = b; } },
  window: { fetch: async u => { net.push(u); return { status: u === '/game/battle/action' ? 423 : 200, clone: () => ({ json: async () => ({ code: 'anti_bot_challenge', challenge: { id: 'c1' } }) }) }; } } };
vm.createContext(sb); vm.runInContext(content.slice(a, z), sb);
(async () => {
  sb.abNet('/game/battle/action', { code: 'anti_bot_challenge', challenge: { id: 'c1' } });
  assert.ok(sb.rt.abChal && sb.rt.abChal.id === 'c1'); assert.match(logs[0], /Проверку активности/);
  const r = await sb.window.fetch('/game/time'); assert.equal(r.status, 423); assert.deepEqual(net, []);       // запрос не ушёл
  await sb.window.fetch('chrome-extension://x/items-il.json'); assert.equal(net.length, 1);                   // файлы расширения — можно
  sb.abNet('/game/antibot/challenge', { passed: false, challenge: {} }); assert.ok(sb.rt.abChal);           // неверно — ждём дальше
  sb.abNet('/game/antibot/challenge', { passed: true }); assert.equal(sb.rt.abChal, null);
  await sb.window.fetch('/game/battle/action'); await new Promise(r => setTimeout(r, 10)); assert.ok(sb.rt.abChal, '423 своего запроса тоже включает ожидание');
  sb.abNet('/game/antibot/activity', { code: 'antibot_challenge_not_found' }); assert.equal(sb.rt.abChal, null);
  sb.abNet('/x', { code: 'anti_bot_challenge' }); sb.abNet('/game/battle/action', { code: 'pve_farm_blocked' }); assert.equal(sb.rt.abChal, null);
  // ядро: состояние и клики
  assert.match(content, /if \(rt\.abChal\) return 'check';/);
  // 10.0.13: между замком и антиботом добавлен Stop; обе защиты обязаны остаться внутри fire до отправки событий.
  const fireGuard = content.slice(content.indexOf('function fire(el)'), content.indexOf('  el.scrollIntoView', content.indexOf('function fire(el)')));
  assert.match(fireGuard, /if \(!el \|\| \(on && !tabOwner\)\) return false;/);
  assert.match(fireGuard, /if \(abHold\(\) && !el\.closest\?\.\('\.l2-antibot-card--blocked'\)\) return false;/);
  assert.match(content, /try \{ abNet\(path, d\.res\); \}/);
  assert.doesNotMatch(content, /if \(on && ch\.on\.oldValue === false && rt\.abChal\) setRt\(\{ abChal: null \}\);/);
  assert.doesNotMatch(content, /ch\.paused\.oldValue && !ch\.paused\.newValue && rt\.abChal\) setRt\(\{ abChal: null \}\)/);
  console.log('PASS: 10.0.2 antibot — challenge sticky in rt.abChal, own requests and clicks blocked, cleared by passed/not_found/block, Start preserves challenge, hook keeps «passed»');
})().catch(e => { console.error(e); process.exit(1); });

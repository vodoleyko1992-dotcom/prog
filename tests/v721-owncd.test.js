'use strict';
// 7.2.1 (лог 10.10 22:19, РБ): сервер считал Blaze готовым через 1,4 с после нажатия, игра клик отклоняла («ещё на КД — жду 0.0 с»).
// Готовность = больший из откатов: серверный и свой по нажатию (85 % замеренного, последние 5 с)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null } }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), sb);
let serverWait = 0;
const now = Date.now();
let observedAt = now - 2000;   // 8.0.3: откат сервера получен ДО нажатия (sync) — о нажатии он не знает
const env = { rt: { cdUse: { blaze: now - 1400, 'aura burn': now - 6000 }, skills: { blaze: { cd: 3.1 }, 'aura burn': { cd: 1.1 } }, cdUntil: {} }, cfg: {},
  slotAction: b => b.cd, battleSpawn: () => 'rb', cdSpawn: () => 'rb', skKey: b => b.title.toLowerCase(), slotKind: () => 'скилл', slotCd: () => null, memLeft: () => 0,
  combatCooldown: { skillKnown: (id, sp, since = 0) => observedAt >= since, skillWait: () => serverWait, globalWait: () => 0 }, HP_POT_RE: /зцілен/i, uiTimer: () => NaN };
const C = sb.L2V7Factories.combat(env);
const btn = (title, cd) => ({ title, cd, disabled: false, getAttribute: () => null, querySelector: () => null });
const blaze = btn('Blaze', 'l2_1220'), ab = btn('Aura Burn', 'l2_1172');
C.pressAt.set('blaze', now - 1400);   // 8.0.3: время клика (откат сервера получен раньше — о нём не знает)
assert.equal(C.ready(blaze), false, 'server says ready, own press 1.4 s ago (cd 3.1 → 2.6 s) → not ready');
assert.equal(C.ready(ab), true, 'other spell is ready → bot casts it in between');
env.rt.cdUse.blaze = now - 2700; C.pressAt.set('blaze', now - 2700);
assert.equal(C.ready(blaze), true, 'after 85 % of the measured cooldown → ready');
serverWait = 500; assert.equal(C.ready(blaze), false, 'server wait still counts');
// 8.0.3: откат получен ПОСЛЕ нажатия (ответ на сам ход, delta.skillCooldowns) — верим только серверу: под баффом Blaze готов раньше своей оценки
env.rt.cdUse.blaze = now - 900; observedAt = now - 850; serverWait = 0;
C.pressAt.set('blaze', now - 900);
assert.equal(C.ready(blaze), true, 'server deadline from this press says ready → ready (own stale 3.1 s ignored)');
serverWait = 300; assert.equal(C.ready(blaze), false, 'server wait from this press counts');
console.log('PASS: own press cooldown is not overridden by a stale server «ready» (RB log 22:19)');
// 7.2.2 (лог 22:31–23:07): клик не ушёл в игру — это заклинание 0,7 с «занято», бот бьёт другим
{
  const sb2 = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null } }; sb2.globalThis = sb2;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), sb2);
  const env2 = { ...env, rt: { cdUse: {}, skills: {}, cdUntil: {} }, combatCooldown: { skillKnown: () => false, skillWait: () => 0, globalWait: () => 0 } };
  const C2 = sb2.L2V7Factories.combat(env2), vt = btn('Vampiric Touch', 'l2_1147');
  assert.equal(C2.ready(vt), true);
  C2.lostUntil.set('vampiric touch', Date.now() + 700);
  assert.equal(C2.ready(vt), false, 'lost click → not ready for 0.7 s (also without server cooldown info)');
  C2.lostUntil.set('vampiric touch', Date.now() - 1);
  assert.equal(C2.ready(vt), true);
  assert.match(fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), /if \(lost && !lockLost && env\.skKey\(b\)\) lostUntil\.set\(env\.skKey\(b\), Date\.now\(\) \+ 700\);/);
  console.log('PASS: lost click marks the spell busy for 0.7 s (RB log 22:31)');
}
// 7.2.2 (лог 22:38): итог боя с раненым РБ — снятое HP от входа, а не полное (было «ДПС 18026» при 87 359 HP на входе)
assert.match(fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), /const base = ctx\.rb && ctx\.hp0 > 0 \? Math\.min\(ctx\.max, ctx\.hp0\) : ctx\.champ && ctx\.chHp0 > 0 \? Math\.min\(ctx\.max,ctx\.chHp0\) : ctx\.max;/);
console.log('PASS: wounded RB fight summary counts HP from entry');

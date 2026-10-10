'use strict';
// 7.2.1 (лог 10.10 22:19, РБ): сервер считал Blaze готовым через 1,4 с после нажатия, игра клик отклоняла («ещё на КД — жду 0.0 с»).
// Готовность = больший из откатов: серверный и свой по нажатию (85 % замеренного, последние 5 с)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null } }; sb.globalThis = sb;
vm.runInNewContext(fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8'), sb);
let serverWait = 0;
const now = Date.now();
const env = { rt: { cdUse: { blaze: now - 1400, 'aura burn': now - 6000 }, skills: { blaze: { cd: 3.1 }, 'aura burn': { cd: 1.1 } }, cdUntil: {} }, cfg: {},
  slotAction: b => b.cd, battleSpawn: () => 'rb', cdSpawn: () => 'rb', skKey: b => b.title.toLowerCase(), slotKind: () => 'скилл', slotCd: () => null, memLeft: () => 0,
  combatCooldown: { skillKnown: () => true, skillWait: () => serverWait, globalWait: () => 0 }, HP_POT_RE: /зцілен/i, uiTimer: () => NaN };
const C = sb.L2V7Factories.combat(env);
const btn = (title, cd) => ({ title, cd, disabled: false, getAttribute: () => null, querySelector: () => null });
const blaze = btn('Blaze', 'l2_1220'), ab = btn('Aura Burn', 'l2_1172');
assert.equal(C.ready(blaze), false, 'server says ready, own press 1.4 s ago (cd 3.1 → 2.6 s) → not ready');
assert.equal(C.ready(ab), true, 'other spell is ready → bot casts it in between');
env.rt.cdUse.blaze = now - 2700;
assert.equal(C.ready(blaze), true, 'after 85 % of the measured cooldown → ready');
serverWait = 500; assert.equal(C.ready(blaze), false, 'server wait still counts');
console.log('PASS: own press cooldown is not overridden by a stale server «ready» (RB log 22:19)');

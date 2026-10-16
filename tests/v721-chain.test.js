'use strict';
// 7.2.1 (лог 10.10 21:08–21:14): в цепочке «Охотиться дальше» адрес страницы = spawnId нового моба, а игра шлёт battleSpawnId
// первого боя цепочки. Ответы сервера с откатами нельзя выбрасывать; ход, принятый сервером, засчитывается даже без отката на кнопке;
// потерянный клик (запрос не ушёл) — без секундного ожидания; средний урон заклинания идёт за свежими замерами
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const { createBattleCooldown } = require(path.join(root, 'battle-cooldown.js'));
let clock = 1000000;
const cd = createBattleCooldown(() => clock);
// реальная пара из лога: url=dense_30865, req=dense_30844. Раньше activeSpawn = адрес → ответ выброшен
cd.observe({ action: 'l2_1172', battleSpawnId: 'dense_30844' }, { serverNowMs: 5000, cooldownUntilMs: 7200 }, 200, 'dense_30865');
assert.equal(cd.skillWait('l2_1172', 'dense_30865'), 0, 'old behaviour: URL spawn → response dropped');
const cd2 = createBattleCooldown(() => clock);
cd2.observe({ action: 'l2_1172', battleSpawnId: 'dense_30844' }, { serverNowMs: 5000, cooldownUntilMs: 7200 }, 200, 'dense_30844');
assert.ok(cd2.skillWait('l2_1172', 'dense_30844') > 2000, 'game spawn id → server cooldown kept');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8'), combat = fs.readFileSync(path.join(root, 'modules/combat.js'), 'utf8');
assert.match(content, /if \(d\.req\.battleSpawnId\) GAME_SPAWN = String\(d\.req\.battleSpawnId\);\n\s*combatCooldown\.observe\(d\.req, d\.res, d\.status, cdSpawn\(\)\)/);
assert.match(content, /const cdSpawn = \(\) => GAME_SPAWN \|\| battleSpawn\(\);/);
assert.match(content, /get cdSpawn\(\) \{ return cdSpawn; \}/);
assert.ok(!/env\.combatCooldown\.\w+\([^)]*env\.battleSpawn\(\)/.test(combat), 'combat: cooldown checks use the game spawn id');
// ход принят сервером → засчитан; клик потерян → без ожидания отката
assert.match(content, /ACT_NET\.ok = d\.status >= 200 && d\.status < 300/);
assert.match(combat, /const netOk = sent && env\.actNet\(\)\.ok && \(!exact \|\| env\.actNet\(\)\.action === exact\);/);
assert.match(combat, /let done = lost \|\| refused \? false : env\.slotCd\(b\) \? !!\(await env\.waitFor\(\(\) => !uiReady\(b\) \|\| dead\(\) \|\| netOk, 1000, 40\)\) : true;/);
// средний урон: 5 373 старых замера по ≈900, новые по ≈1800 — среднее догоняет за десятки боёв
let p = { dmg: 900 * 5373, dmgN: 5373 };
const add = d => { p.dmg += d; p.dmgN++; if (p.dmgN > 60) { p.dmg = Math.round(p.dmg / p.dmgN * 40); p.dmgN = 40; } };
assert.match(content, /if \(p\.dmgN > 60\) \{ p\.dmg = Math\.round\(p\.dmg \/ p\.dmgN \* 40\); p\.dmgN = 40; \}/);
for (let i = 0; i < 80; i++) add(1800);
assert.ok(p.dmg / p.dmgN > 1600, `average follows fresh samples (${Math.round(p.dmg / p.dmgN)})`);
// квесты: кампания убрана, «Квесты на ресурсы» не уводят бота
assert.match(content, /once\('camp721', \(\) => \{ cf\.campaign = false;/);
assert.ok(!/квест на ресурс — фармим сам/.test(content), 'resource quests do not teleport');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
assert.match(html, /data-auto-task="quests"/);   // 10.0.10: кнопка «📜 Кампания» снова видна (сюжетный квест новичка у альта), по умолчанию выключена — camp721 остаётся
console.log('PASS: chain — server cooldowns by the game battle id, accepted move counts, lost click without 1 s wait, fresh damage average; campaign removed');

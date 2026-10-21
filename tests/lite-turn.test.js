'use strict';
// Lite 1.1 (21.10, тред «Упрошенка под Дестра», «на основе нового кода, внеси правки»): ход по ответу сервера из основного бота 20.36–20.41 —
// откаты в новом формате ответа игры (массив {skillId, readyAt, remainingSec}), второй ход не уходит до ответа на первый, после ожидания
// игры план пересчитывается, отказ «общий откат» держит модель откатов, запасы клика подстраиваются, подтверждённый ход — без паузы.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('откаты: lite/battle-cooldown.js понимает массив skillCooldowns так, как его спрашивает Lite (l2_<id>, без спавна)', () => {
  const { createBattleCooldown } = require('../lite/battle-cooldown.js');
  let now = 1000;
  const CD = createBattleCooldown(() => now);
  CD.observe({ action: 'l2_190' }, { delta: { serverNowMs: 50000, skillCooldowns: [{ skillId: 190, remainingSec: 2 }, { skillId: 'l2_36', readyAt: 51000 }] } }, 200, '');
  assert.ok(CD.skillWait('l2_190', '') > 1900 && CD.skillKnown('l2_190', '', 900));
  assert.ok(CD.skillWait('l2_36', '') > 900);
  // индекс строки массива — не номер навыка; строка без срока не означает «готов»
  CD.observe({ action: 'attack' }, { delta: { serverNowMs: 50100, skillCooldowns: [{ remainingSec: 9 }, { skillId: 255 }] } }, 200, '');
  assert.equal(CD.skillWait('0', ''), 0); assert.equal(CD.skillWait('l2_255', ''), 0);
  // словарь по-прежнему читается
  CD.observe({ action: 'l2_315' }, { delta: { serverNowMs: 50200, skillCooldowns: { l2_315: 53200 } } }, 200, '');
  assert.ok(CD.skillWait('l2_315', '') > 2900);
});

const bot = read('lite/bot.js');
t('второй ход до ответа на первый не шлём: gameIdle ждёт свой ход в полёте и отвечает false', () => {
  assert.match(bot, /const ACT_PATH = \/\^\\\/game\\\/\(\?:battle\|tvt\)\\\/action\$\|\^\\\/game\\\/battle\\\/hunt-continue\$\//);
  assert.match(bot, /if \(act\) \{ if \(now - t0 > 8000 \|\| \(g && !alive\(g\)\)\) return false; await nap\(40\); continue; \}/);
  assert.match(bot, /if \(!\(await gameIdle\(1500, g\)\) \|\| !alive\(g\) \|\| !s\.b\.isConnected\) return false;/);
});
t('после ожидания игры — новый выбор: свежий откат из ответа или другой план отменяют клик', () => {
  assert.match(bot, /if \(!tvt && \(CD\.globalWait\(''\) > 0 \|\| \(s\.action && cdWait\(s\.action\) > 0 && cdKnown\(s\.action, pressAt\.get\(s\.action\) \|\| 0\)/);
  assert.match(bot, /if \(still && !still\(\)\) \{ quick = true; return false; \}/);
  assert.match(bot, /await press\(plan, g, false, \(\) => \{ const p = L\.planTurn\(slotsNow\(false\), meStats\(\), mobHp\(\), opt\(\)\); return !!p && p\.slot\.key === plan\.slot\.key; \}\);/);
  // проверка плана — до клика, отказ «план сменился» ничего не блокирует
  assert.ok(bot.indexOf('if (still && !still())') < bot.indexOf('if (!fire(s.b, g)) { fastMark(\'\'); return false; }'));
});
t('отказ сервера: общий откат — не блокировка слота; откат скилла держит модель; MP — 1,5 с', () => {
  assert.match(bot, /by: String\(d\.bt\?\.blockedBy \|\| ''\)/);
  assert.match(bot, /if \(end\.by === 'global'\) \{ if \(CD\.globalWait\(''\) <= 0\) block\.set\(key, Date\.now\(\) \+ 300\); quick = true; return false; \}/);
  assert.match(bot, /if \(cdErr && s\.action && cdWait\(s\.action\) > 0\) \{ quick = true; return false; \}/);
  // 1.5.1: ранний выстрел — 400 {code:'skill_cooldown', skillId:'l2_19', remainingMs} без serverNowMs: ждём, сколько сказал сервер
  assert.match(bot, /if \(cdErr && end\.rem > 0\) \{ block\.set\(key, Date\.now\(\) \+ Math\.min\(end\.rem, 30000\) \+ 20\); quick = true; return false; \}/);
  assert.match(bot, /\/mp\|мана\/i\.test\(end\.err\) \? 1500 : cdErr \? 700 : 1200/);
});
t('запасы клика подстраиваются как в основном боте: A 60–400, B 30–200, растёт запас, решавший впритык', () => {
  assert.match(bot, /const LOCK_A = \[60, 400, 120\], LOCK_B = \[30, 200, 50\];/);
  assert.match(bot, /if \(gap < 250\) \{ if \(bindB\) lockB = Math\.min\(LOCK_B\[1\], lockB \+ 15\); else lockA = Math\.min\(LOCK_A\[1\], lockA \+ 30\); lockSave\(\); \}/);
  assert.match(bot, /if \(gap < 60\) \{ if \(bindB\) lockB = Math\.max\(LOCK_B\[0\], lockB - 1\); else lockA = Math\.max\(LOCK_A\[0\], lockA - 2\); lockSave\(\); \}/);
  assert.match(bot, /Math\.max\(NET\.actEnd \+ lockA - now, NET\.charEnd \+ lockB - now\)/);
});
t('подтверждённый ход и ожидание отката — без «человеческой» паузы круга; ожидание отката — до ближайшей готовности', () => {
  assert.match(bot, /progress\(\); lastActOk = Date\.now\(\); quick = true;/);
  assert.match(bot, /quick = false;\n\s+try \{ await tick\(\); \}/);
  assert.match(bot, /await sleep\(quick \? 0 : rnd\(60, 140\)\);/);
  assert.match(bot, /await nap\(Math\.max\(10, Math\.min\(readyIn\(slots\) \+ 5, 100\)\)\); quick = true; return;/);
  // ожидания просыпаются по концу запроса игры
  assert.match(bot, /wakeAll\(\);\n\s+\}\n\s+window\.addEventListener\('message'/);
});
t('ответ игры меняется только быстрым ударом (Lite 1.2, решение John 21.10) — и только для метки Lite', () => {
  const hook = read('lite/hook.js');
  assert.equal((hook.match(/new Response\(/g) || []).length, 1);
  assert.match(hook, /return fast \? p\.then\(fastRes\) : p;\n\s+\};/);
  assert.match(hook, /delete o\.delta\.hotbarStale;/);
  assert.ok(!/l2botFast/.test(hook), 'метка основного бота Lite не касается');
});

// 1.5.1 (пробный бой лука 21.10, lite/archer-study.md §6): откат выстрела сервер присылает под каноническим номером
// (delta.skillCooldowns {l2_56}), а жмём power_shot — бот спрашивает модель откатов по обоим (cdIds через L.NATIVE).
t('откат выстрела под номером игры (l2_56) держит и power_shot; победа без откатов — длину помним сами', () => {
  const CDM = require('../lite/battle-cooldown.js'), L = require('../lite/logic.js');
  let now = 1000; const CD = CDM.createBattleCooldown(() => now);
  CD.observe({ action: 'power_shot' }, { delta: { serverNowMs: 5000, skillCooldowns: { l2_56: 12370 } } }, 200, '');
  assert.equal(CD.skillWait('power_shot', ''), 0, 'сама модель имени выстрела не знает');
  assert.ok(CD.skillWait('l2_56', '') > 7000 && CD.skillKnown('l2_56', '', 900));
  assert.equal(L.NATIVE.power_shot, 56); assert.equal(L.NATIVE.double_shot, 19); assert.equal(L.NATIVE.stun_shot, 101);
  assert.match(bot, /const cdIds = a => \{ const id = a && !\/\^l2_\\d\+\$\/\.test\(a\) && Object\.prototype\.hasOwnProperty\.call\(L\.NATIVE, a\) \? L\.NATIVE\[a\] : 0; return id \? \[a, 'l2_' \+ id\] : \[a\]; \};/);
  assert.match(bot, /const known = !!action && cdKnown\(action, pressAt\.get\(action\) \|\| 0\), left = action \? cdWait\(action\) : 0;/);
  assert.match(bot, /if \(w > 0 && cdKnown\(s\.action, t0\)\) cdLen\.set\(s\.action, w \+ Date\.now\(\) - t0\);\s+else if \(cdLen\.get\(s\.action\)\) block\.set\(key, t0 \+ cdLen\.get\(s\.action\)\);/);
  assert.doesNotMatch(bot, /CD\.skillWait\(s\.action|CD\.skillKnown\(action/, 'везде через cdWait/cdKnown');
});
console.log(`lite-turn: ${n} PASS`);

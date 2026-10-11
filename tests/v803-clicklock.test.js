'use strict';
// 8.0.3 (логи 11.10 09:11–09:35, разбор «КД и ДПС с баффом и без»): узкое место — не откаты, а потерянные нажатия. ≈0,3 с после ответа
// сервера на ход игра молча отбрасывает клик (раньше 250 мс — 0 из 83 принято); 8.0 убрал паузу 250 мс → 130 потерянных нажатий на РБ,
// Vampiric Touch прошёл 4 раза из 60, ДПС 1606 против ≈3300 в тех же баффах. Сервер теперь шлёт откаты в delta.skillCooldowns.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const combat = read('modules/combat.js'), content = read('content.js');
const { createBattleCooldown } = require('../battle-cooldown.js');

// 1. act(): клик только когда игра свободна — нет её запросов в полёте (GET /character после хода) и прошёл запас после последнего ответа /
// конца запроса; потеря сразу после освобождения → 'lock' (без «занят 0,7 с») и запас больше; быстро дошёл → запас меньше
const actSrc = combat.slice(combat.indexOf('  let lastHpPot = 0, lastMpPot = 0'), combat.indexOf('  const t0 = Date.now();\n  let progSig'));
assert.ok(actSrc.includes('const act = async (b, status) =>'), 'act() extracted');
const consts = combat.match(/const CLICK_GAP_MIN = 40, CLICK_GAP_MAX = 400, CLICK_GAP_DEF = 60;/)[0];
const mk = ({ accept = true, doneAgo = 5, getMs = 0, gap } = {}) => {
  let now = 1_000_000; const fired = [], rtW = [];
  const NET = { start: 1, done: 1, doneT: now - doneAgo, ok: true, action: 'l2_1220' };
  let getEnd = getMs ? now + getMs : 0;          // GET /character игры в полёте до getEnd
  const env = { on: true, tabOwner: true, isBattle: () => true, rt: gap ? { clickGapMs: gap } : {}, setRt: p => { rtW.push(p); Object.assign(env.rt, p); return Promise.resolve(); },
    gameBusy: () => getEnd && now < getEnd ? { busy: true, end: 0 } : { busy: false, end: getEnd },
    combatCooldown: { globalWait: () => 0, skillWait: () => 0, recentlyGlobalRejected: () => false }, slotAction: () => 'l2_1220', cdSpawn: () => 'sp', battleSpawn: () => 'sp',
    observeSlot: () => {}, actNet: () => NET, fire: () => { fired.push({ afterAnswer: now - NET.doneT, afterGet: getEnd ? now - getEnd : null }); if (accept) { NET.start++; NET.done++; NET.doneT = now + 300; getEnd = 0; } return true; },
    sleep: async ms => { now += ms; }, waitFor: async (fn, ms) => { const r = fn(); if (!r) now += ms; return r; }, setStatus: () => {}, skKey: () => 'blaze',
    slotCd: () => null, petState: () => null, pause: async () => {}, rnd: (a) => a, rec: () => {}, TAG: '', cleanTitle: s => s, memLeft: () => 0, FORCE_NEED: /x^/, UNAVAIL: /x^/, CD_RE: /x^/ };
  const sb = { env, Date: { now: () => now }, Math, Map, console, ctx: { pet: null }, lostUntil: new Map(), pressAt: new Map(), victory: () => false, defeat: () => false, noticeText: () => '', uiReady: () => true,
    mobHp: () => ({ cur: 100 }), rememberCd: async () => {}, mageCombat: () => true };
  vm.runInNewContext(`${consts}\n${actSrc}\nthis.act = act; this.gap = () => clickGap;`, sb);
  return { sb, fired, rtW, NET, env };
};
(async () => {
  { const t = mk({ doneAgo: 5, getMs: 300 });   // ход только что принят, игра шлёт GET /character на 0,3 с
    const r = await t.sb.act({ title: 'Blaze' }, 'Blaze');
    assert.equal(r, true);
    assert.ok(t.fired[0].afterGet >= 60, `click only after the game GET ended + margin (fired ${t.fired[0].afterGet} ms after it; 8.0.2: during it)`);
    assert.equal(t.sb.gap(), 58, 'accepted right at the margin → margin −2'); }
  { const t = mk({ doneAgo: 5, getMs: 0 });     // без GET (бой с мобом): только запас после ответа
    await t.sb.act({ title: 'Blaze' }, 'Blaze');
    assert.ok(t.fired[0].afterAnswer >= 60 && t.fired[0].afterAnswer < 130, 'no GET → short margin after the answer'); }
  { const t = mk({ doneAgo: 5000 });
    await t.sb.act({ title: 'Blaze' }, 'Blaze');
    assert.ok(t.fired[0].afterAnswer >= 5000 && t.fired[0].afterAnswer < 5030, 'no wait when the game is long free'); }
  { const t = mk({ doneAgo: 5, getMs: 300, accept: false });
    const r = await t.sb.act({ title: 'Vampiric Touch' }, 'VT');
    assert.equal(r, 'lock', 'lost right after the game freed → «lock»');
    assert.equal(t.sb.lostUntil.has('blaze'), false, 'not marked busy for 0.7 s — the same spell is pressed again');
    assert.equal(t.sb.gap(), 90, 'margin +30 ms');
    assert.equal(t.rtW.at(-1).clickGapMs, 90, 'learned margin persisted (≥20 ms change)'); }
  { const t = mk({ doneAgo: 5000, accept: false });
    const r = await t.sb.act({ title: 'Blaze' }, 'Blaze');
    assert.equal(r, false, 'lost long after the game freed — the old rule');
    assert.ok(t.sb.lostUntil.has('blaze'), 'busy 0.7 s as before'); }
  { const t = mk({ gap: 9999 }); assert.equal(t.sb.gap(), 400, 'margin capped 40–400'); }
  { const t = mk({ doneAgo: 5, getMs: 99999 });  // запрос игры «завис» — ждём не больше 1,5 с
    await t.sb.act({ title: 'Blaze' }, 'Blaze');
    assert.ok(t.fired.length === 1, 'stuck request does not block forever'); }
  // 2. вампирик: блок 1,5 с только по результату (потерян в окне — повторяем, а не банка); дебафф — без паузы 3 с на «lock»
  assert.match(combat, /if \(drainB\) \{ ctx\.seq\.push\('💉'\); const r = await act\(drainB, [^;]+\); if \(r !== 'lock'\) ctx\.block\['drain:' \+ drainB\.title\] = Date\.now\(\) \+ 1500; continue; \}/);
  assert.doesNotMatch(combat, /if \(drainB\) \{ ctx\.block\['drain:'/);
  assert.match(combat, /else if \(dr !== 'lock'\) ctx\.block\['debuff:' \+ dbf\.k\] = Date\.now\(\) \+ 3000;/);
  // 3. время ответа и «игра занята»: hook сообщает начало/конец GET /character и запросов боя (rid); netStart от GET — не «ход ушёл»
  const hook = read('hook.js');
  assert.match(hook, /const TRACK = \/\^\\\/\(\?:character\|game\\\/battle\\\/\(\?:action\|start\|hunt-continue\)\)\$\/;/);
  assert.equal((hook.match(/, rid \}\)/g) || []).length >= 4, true, 'every end message carries the rid');
  assert.match(content, /if \(p === '\/game\/battle\/action'\) \{ ACT_NET\.start\+\+; ACT_NET\.t = Date\.now\(\); \}/);
  assert.match(content, /if \(d\.rid != null && GAME_REQ\.delete\(d\.rid\)\) GAME_END = Date\.now\(\);/);
  assert.match(content, /get gameBusy\(\) \{ return gameBusy; \}/);
  assert.match(content, /if \(\/\^\\\/game\\\/battle\\\/\(\?:action\|start\|hunt-continue\)\$\/\.test\(path\)\) ACT_NET\.doneT = Date\.now\(\);/);
  // 4. откаты из delta-ответа (лог 11.10 09:11:56)
  let now = 5000; const g = createBattleCooldown(() => now);
  g.observe({ action: 'l2_1220', battleSpawnId: 'sp' }, { revision: 1, delta: { serverNowMs: 100000, skillCooldowns: { l2_1220: 100750, l2_1172: 100300 } } }, 200, 'sp');
  assert.ok(g.skillKnown('l2_1220', 'sp'), 'delta.skillCooldowns read');
  assert.ok(Math.abs(g.skillWait('l2_1220', 'sp') - 790) <= 1, 'Blaze 0.75 s (+40 ms margin) from the server');
  g.observeSync({ delta: { serverNowMs: 100100, skillCooldowns: { l2_1147: 101000 } } }, 'sp');
  assert.ok(g.skillKnown('l2_1147', 'sp'), 'sync delta too');
  assert.match(content, /mysticSkillCdUntil: r\.mysticSkillCdUntil \?\? inner\.mysticSkillCdUntil \?\? null,/, 'unknown field logged for the next analysis');
  // 5. короткие настоящие откаты под баффами не выбрасываются; старые замеры стёрты
  const lc = content.slice(content.indexOf('async function learnCd('), content.indexOf('let lastObserve = 0;'));
  const saved = []; const sb = { ilOf: () => ({ reuse: 3000 }), slotKind: () => 'скилл', rt: { skills: {} }, setRt: async p => saved.push(p), Math };
  vm.runInNewContext(`${lc}; this.learnCd = learnCd;`, sb);
  await sb.learnCd('blaze', 'Blaze', 0.8, {});
  assert.equal(saved.length, 1, '0.8 s Blaze (reference 3 s) is accepted now');
  await sb.learnCd('blaze', 'Blaze', 0.2, {});
  assert.equal(saved.length, 1, 'below 0.4 s — noise');
  assert.match(content, /once\('cdS803', \(\) => \{ for \(const \[k, p\] of Object\.entries\(S\)\) if \(p && \(p\.cd \|\| p\.cdS\)\) \{ S\[k\] = \{ \.\.\.p, cd: 0, cdS: \[\] \}; sk = true; \} \}\);/);
  console.log('PASS: 8.0.3 click gate — click when the game is free (its GET /character done + adaptive 40–400 ms margin), lost click right after it is retried at once (VT no longer yields to potions), server cooldowns read from delta, short buffed cooldowns learned');
})().catch(e => { console.error(e); process.exit(1); });

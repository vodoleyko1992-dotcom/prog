'use strict';
// 8.0.3 (логи 10–11.10: 100 000 аден за Короля Тарлка трижды, 11.10 10:32 — ещё 4 × 100 000 за РБ 60–66; каждый раз «не по силам» уже
// на месте): проверка до телепорта молча пропускалась, когда цифр игры не было (запрос не удался / после переустановки)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const load = (extra = {}) => { const sb = { console, Date, Math, JSON, CSS: { escape: s => s }, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/rb-bosses.html', href: '' }, ...extra }; sb.globalThis = sb; vm.runInNewContext(read('modules/raid.js'), sb); return sb; };
const base = JSON.parse(read('base-profile.json')).chars.Warlock.rt;
(async () => {
  const recs = [];
  const mk = (rt, extra = {}) => { const env = { cfg: { rbMaxBelow: 15, rbMaxAbove: 15, rbRetreatHp: 20, rbRestHp: 95 }, rt, heroLvl: () => 55, RB_WIN: 15, RB_TRY_MS: 0, RB_RETRY_MS: 0,
    meHp: () => ({ max: 6056, cur: 6056, pct: 100 }), potModel: () => ({ pool: 600000, rate: 2000, n: 800 }), fmtK: n => String(Math.round(n)), fmtT: s => String(Math.round(s)),
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), ...extra }; return { env, R: load(extra.sb || {}).L2V7Factories.raid(env) }; };
  // 1. встроенные цифры: Тарлк известен без памяти (после переустановки)
  { const { R } = mk({ rbStats: {}, rbDb: base.rbDb, rbK: base.rbK });
    const t = R.rbKnown('l2dop_rb_25158');
    assert.equal(t.hp, 920790); assert.equal(t.matk, 7287); assert.equal(t.src, 'api');
    for (const id of ['l2dop_rb_25122', 'l2dop_rb_25456', 'l2dop_rb_25047', 'l2dop_rb_25260', 'l2dop_rb_25434', 'l2dop_rb_29014']) assert.ok(R.rbKnown(id), 'known ' + id); }
  // 2. Тарлк (48) и РБ 60–66 не попадают в выбор тура даже на пустой памяти — отсекаются до телепорта
  { const list = { l2dop_rb_25158: { name: 'Король Тарлк', lvl: 48, alive: true, page: 6 }, l2dop_rb_25456: { name: 'Дзеркало Забвения', lvl: 49, alive: true, page: 6 } };
    const hi = [["l2dop_rb_25423", 61], ["l2dop_rb_25234", 60], ["l2dop_rb_25226", 62], ["l2dop_rb_25140", 65], ["l2dop_rb_25322", 66]];   // РБ 60–66, к которым бот летал в 10:32
    for (const [id, lvl] of hi) list[id] = { name: id, lvl, alive: true, page: 10 };
    const { R } = mk({ rbStats: { ...base.rbStats }, rbDb: base.rbDb, rbK: base.rbK, rbList: list });
    const el = R.rbEligible().map(x => x[0]);
    assert.ok(!el.includes('l2dop_rb_25158'), 'Tarlk refused before any teleport: ' + JSON.stringify(el));
    assert.ok(el.includes('l2dop_rb_25456'), 'weak RB of the same level stays');
    for (const [id] of hi) assert.ok(!el.includes(id), `RB ${id} (60–66) refused before paying`); }
  // 3. запрос цифр не удался: причина — в журнал, повтор через 10 мин (было молча и на 6 ч)
  { let calls = 0; const fetch = async () => { calls++; return { ok: false, status: 401 }; };
    const { env, R } = mk({ rbStats: {}, rbList: { x: { name: 'Новый РБ' } } }, { sb: { fetch, AbortController, setTimeout, clearTimeout } });
    assert.equal(await R.rbInfo('x'), null);
    assert.ok(recs.some(r => /цифры Новый РБ у игры не получены: HTTP 401/.test(r)), recs.join(' | '));
    assert.equal(await R.rbInfo('x'), null); assert.equal(calls, 1, 'no repeat within 10 min');
    env.rt.rbInfoFail.x = Date.now() - 11 * 60000; await R.rbInfo('x'); assert.equal(calls, 2, 'retried after 10 min'); }
  // 4. код: цифры окна карты (без src) — тоже цифры; вслепую — только знакомый РБ или раз в 30 мин; два отказа на месте подряд — пауза тура
  const raid = read('modules/raid.js');
  assert.match(raid, /const st = await rbInfo\(p\.id\), real = !!st && st\.hp > 0 && \(st\.matk > 0 \|\| st\.patk > 0\) && !st\.est;/);
  assert.doesNotMatch(raid, /if \(st\?\.src === 'api' && !rbVerdictBlocks\(p\.id\)\)/);
  assert.match(raid, /if \(!\(d\?\.verdict === 'ok' \|\| d\?\.kills > 0\)\) \{\n        if \(Date\.now\(\) - \(env\.rt\.rbBlindT \|\| 0\) < 30 \* 60000\) \{/);
  assert.match(raid, /const run = Date\.now\(\) - \(env\.rt\.rbRefuse\?\.t \|\| 0\) < 10 \* 60000 \? \(env\.rt\.rbRefuse\?\.n \|\| 0\) \+ 1 : 1;/);
  assert.match(raid, /\.\.\.\(run >= 2 \? \{ rbHuntIdle: Date\.now\(\) \+ RB_IDLE_MS,/);
  assert.ok(raid.indexOf('const RB_IDLE_MS') < raid.indexOf('const run = Date.now() - (env.rt.rbRefuse'), 'RB_IDLE_MS defined before use');
  // базовый профиль тоже знает эти цифры (src 'api')
  assert.equal(base.rbStats.l2dop_rb_25158.matk, 7287); assert.equal(base.rbStats.l2dop_rb_25158.src, 'api');
  console.log('PASS: 8.0.3 teleport guard — built-in RB numbers (Tarlk, RB 55–66, epics) survive reinstall and refuse before paying; failed stats request logged and retried in 10 min; blind paid teleport only for a known RB or once per 30 min; two on-site refusals pause the tour');
})().catch(e => { console.error(e); process.exit(1); });
{ // 8.0.3 (ревью): обычный РБ из диапазона 290xx — не эпик
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
  const sb = { console, Date, Math, JSON, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/', href: '' } }; sb.globalThis = sb;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'modules/raid.js'), 'utf8'), sb);
  const R = sb.L2V7Factories.raid({ rt: {}, cfg: {} });
  assert.equal(R.isEpicId('l2dop_rb_29014'), true); assert.equal(R.isEpicId('l2dop_rb_29030'), false); assert.equal(R.isEpicId('l2dop_rb_25158'), false);
  console.log('PASS: 8.0.3 epic ids — only the 8 game epics');
}

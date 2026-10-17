'use strict';
// 10.0.2 (игрок 12.10: «плохо фармит РБ, особенно сильных»; лог 12.10 22:11–22:46, тур РБ, Warlock 65): 30 выходов из боя за 35 мин, убиты 2 РБ из 6,
// две смерти. 1) спецудар 29–36 % HP («смертельно» по скачку ≥ 30 %) → выход после каждого; 2) бой-проба шла 3 ч и после замера спецудара;
// 3) Галлате 73 и Голконда 79 — бой по ≈25–43 мин (урон по РБ выше героя вдвое меньше общего ДПС); 4) недобитый на 96,7 % — «следующий»;
// 5) выход «на карту» без ответа сервера — бой шёл дальше, смерть на карте; 6) «победа не подтверждена» выключала банки в полосе
const assert = require('node:assert/strict');
const { read, clone, mk, base, H } = require('./epic-harness.cjs');

const HALLATE = 'l2dop_rb_25220', GOLK = 'l2dop_rb_25126', RAHHA = 'l2dop_rb_25051';

(async () => {
  // ---------- 1. спецудар 35 % при полном HP — не «смертельно»; тот же удар при низком HP — выход ----------
  let me = { max: 8313, cur: 7541, pct: 91 };
  const m = mk({ hero: 65, meHp: () => me, cfg: { rbRetreatHp: 20, stopHp: 25 }, env: { logLines: () => [], newLines: () => [], activeBuffs: () => [], epicOn: () => false, potModel: () => ({ pool: 576000, rate: 545, n: 960, H: 600, C: 1.1, items: [] }) } });
  const t0 = Date.now(), realNow = Date.now;
  let clock = t0; Date.now = () => clock;
  try {
    const ctx = { name: 'Ice Fairy Sirra', rb: { id: 'l2dop_rb_29056', samples: [], hits: [] } };
    const mob = { cur: 100000, max: 306111 };
    for (let i = 0; i < 3; i++) { m.R.rbAssess(ctx, { ...me }, mob); clock += 1100; mob.cur -= 6000; }
    me = { max: 8313, cur: 4587, pct: 55 };   // 22:12:29.4: −2954 (Вогняний вихор)
    let v = m.R.rbAssess(ctx, me, mob);
    assert.ok(!v.lethal && !v.abort, 'spike of 35 % at 91 % HP is survivable — keep fighting: ' + JSON.stringify(v));
    assert.ok(m.logs.some(l => /второй такой переживу/.test(l)), 'logged once');
    // HP уже низкое — тот же удар: второй добьёт → выход
    const ctx2 = { name: 'Ice Fairy Sirra', rb: { id: 'l2dop_rb_29056', samples: [], hits: [] } };
    me = { max: 8313, cur: 5000, pct: 60 }; clock += 5000;
    for (let i = 0; i < 2; i++) { m.R.rbAssess(ctx2, { ...me }, mob); clock += 1100; }
    me = { max: 8313, cur: 2046, pct: 25 };
    v = m.R.rbAssess(ctx2, me, mob);
    assert.equal(v.lethal, true, 'second such hit would kill → lethal');
    // скачок ≥ 60 % — смертельно всегда (Церберон 4200 из 5060)
    const ctx3 = { name: 'Cerberon', rb: { id: 'l2dop_rb_25039', samples: [], hits: [] } };
    me = { max: 8313, cur: 8313, pct: 100 }; clock += 5000;
    for (let i = 0; i < 2; i++) { m.R.rbAssess(ctx3, { ...me }, mob); clock += 1100; }
    me = { max: 8313, cur: 3300, pct: 40 };
    assert.equal(m.R.rbAssess(ctx3, me, mob).lethal, true, 'jump of 60 % → lethal');

    // ---------- 6. банки в полосе: «победа не подтверждена» их больше не выключает ----------
    const ctx4 = { name: 'Longhorn Golkonda', rb: { id: GOLK, samples: [], hits: [] } };
    const mob4 = { cur: 5800000, max: 6194391 }; me = { max: 8449, cur: 8000, pct: 95 }; clock += 5000;
    for (let i = 0; i < 20; i++) { m.R.rbAssess(ctx4, { ...me }, mob4); clock += 1100; mob4.cur -= 2400; me = { max: 8449, cur: me.cur - 150, pct: (me.cur - 150) / 84.49 }; }
    assert.equal(ctx4.rb.usePots, true, 'not a sure win without potions → potions in the band');
    // свой ДПС по этому РБ записан
    assert.ok(m.env.rt.rbDb[GOLK]?.dps > 1500 && m.env.rt.rbDb[GOLK].dps < 3500, 'per-RB dps ' + m.env.rt.rbDb[GOLK]?.dps);
  } finally { Date.now = realNow; }

  // ---------- 2. проба кончается с замером спецудара ----------
  const m2 = mk({ hero: 65 });
  m2.env.rt.rbDb[HALLATE] = { probe: { t: Date.now() - 600000, lvl: 65, sp: 5097 } };
  assert.equal(m2.R.probeFight(HALLATE), true, 'probe running, special not seen');
  m2.env.rt.rbDb[HALLATE].sp = 2640;
  assert.equal(m2.R.probeFight(HALLATE), false, 'special measured → ordinary fight (no exit after every special)');

  // ---------- 3. долгий бой: свой ДПС по РБ, поправка на уровни, предел ----------
  const m3 = mk({ hero: 65, meHp: () => ({ max: 8313, cur: 8313, pct: 100 }), rt: { rbDps: 4200, rbList: { [GOLK]: { lvl: 79, alive: true }, [RAHHA]: { lvl: 65, alive: true }, [HALLATE]: { lvl: 73, alive: true } } } });
  m3.env.rt.rbDb = {};
  assert.equal(m3.R.rbDpsOn(RAHHA), 4200, 'same level → global');
  assert.equal(Math.round(m3.R.rbDpsOn(HALLATE)), Math.round(4200 * 0.6), '+8 levels → 0.6');
  assert.equal(Math.round(m3.R.rbDpsOn(GOLK)), Math.round(4200 * 0.5), '+14 → not below half');
  m3.env.rt.rbDb[GOLK] = { dps: 2400, sp: 2396 };
  const g = m3.R.rbPreCheck(GOLK, { hp: 6194391, patk: 9953, matk: 2500 });
  assert.equal(g.ok, false); assert.equal(g.kind, 'slow', 'Golkonda 6.2M at 2.4k/s ≈ 43 min > 20'); assert.match(g.why, /долгий бой/); assert.match(g.why, /свой замер/);
  m3.env.cfg.rbMaxKillMin = 0; assert.notEqual(m3.R.rbPreCheck(GOLK, { hp: 6194391, patk: 9953, matk: 2500 }).kind, 'slow', '0 → no limit'); delete m3.env.cfg.rbMaxKillMin;
  m3.env.rt.rbDb[RAHHA] = { dps: 4300, sp: 2770, hitP90: 320 };
  { const r = m3.R.rbPreCheck(RAHHA, { hp: 2384041, patk: 8830, matk: 2500 }); assert.equal(r.ok, true, 'Rahha ≈9 min → go: ' + r.why); }
  // недобитый: HP с замера в бою (rbWound)
  m3.env.rt.rbDb[HALLATE] = { dps: 2500, sp: 2640, hitP90: 860 };
  assert.equal(m3.R.rbPreCheck(HALLATE, { hp: 3561598, patk: 11974, matk: 2500 }).kind, 'slow', '3.56M / 2.5k ≈ 24 min');
  m3.env.rt.rbWound = { [HALLATE]: { cur: 2000000, max: 3561598, t: Date.now() } };
  assert.equal(m3.R.rbHpNow(HALLATE, 3561598), 2000000);
  assert.equal(m3.R.rbPreCheck(HALLATE, { hp: 3561598, patk: 11974, matk: 2500 }).ok, true, 'wounded to 2.0M ≈ 13 min → go');
  // тур: «долгий бой» — пропуск, не «не по силам»
  m3.env.rt.rbList[GOLK].price = 100000; m3.env.rt.rbList[GOLK].unit = 'аден';
  assert.equal(m3.R.rbTeleportCheck(GOLK, m3.env.rt.rbList[GOLK]), 'долгий бой');
  assert.ok(!m3.env.rt.rbDb[GOLK].verdict, 'no «not strong enough» verdict for a slow RB');
  // эпики — по своим правилам
  assert.notEqual(m3.R.rbPreCheck('l2dop_rb_29014', { hp: 9e7, patk: 1100, matk: 4339 }).kind, 'slow');

  // ---------- 4. недобитый на 96,7 % — первым ----------
  m3.env.rt.rbWound = { [RAHHA]: { cur: 2304499, max: 2384041, t: Date.now() } };
  assert.equal(m3.R.rbWounded(RAHHA), true, '96.7 % is wounded now (was: < 95 %)');

  // ---------- 5. выход из боя без ответа сервера — назад в бой ----------
  const content = read('content.js'), combat0 = read('modules/combat.js');
  const fnSrc = content.slice(content.indexOf('function leaveMark('), content.indexOf('async function leaveCheck()'));
  const store = {}, sessionStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const F = new Function('sessionStorage', fnSrc + '; return { leaveMark, leaveOk, leavePending };')(sessionStorage);
  const T = Date.now();
  F.leaveMark(HALLATE, 'Death Lord Hallate');
  assert.equal(F.leavePending(T + 500), null, 'give the answer 2 s');
  assert.equal(F.leavePending(T + 5600)?.id, HALLATE, '22:35:26 → 22:35:32 on the map, no leave answer → back to the fight');
  F.leaveOk(HALLATE); assert.equal(F.leavePending(Date.now() + 5600), null, 'answered 2xx → fine');
  F.leaveMark(HALLATE, 'x'); assert.equal(F.leavePending(Date.now() + 61000), null, 'stale mark ignored');
  assert.match(content, /if \(isMap\(\) && await leaveCheck\(\)\) return true;/);
  F.leaveMark(HALLATE, 'x'); F.leaveMark(null); assert.equal(F.leavePending(Date.now() + 5600), null, 'stayed in the fight → mark cleared');
  assert.equal((combat0.match(/env\.leaveMark\?\.\(null\);/g) || []).length, 3, 'cleared when the exit did not end the fight');   // 10.0.5: + отход от чемпиона
  assert.match(content, /path === '\/game\/battle\/leave' && d\.method === 'POST' && d\.status >= 200 && d\.status < 300 && !d\.error && !d\.res\?\.error\) leaveOk\(/);
  assert.match(content, /get leaveMark\(\) \{ return leaveMark; \}/);
  const combat = read('modules/combat.js');
  assert.equal((combat.match(/env\.leaveMark\?\.\(ctx\.rb\.id, ctx\.name\);\n\s*env\.fire\(leave\);/g) || []).length, 2, 'mark before both RB exits');
  // настройка
  assert.match(content, /rbMaxKillMin: 20,/); assert.match(read('popup.js'), /'rbMaxKillMin'/); assert.match(read('popup.html'), /id="rbMaxKillMin"/);
  assert.equal(JSON.parse(read('base-profile.json')).cfg.rbMaxKillMin, 20);
  // ---------- 7. игрок 12.10: «как потом вернуться к этим боссам… надо учиться всегда» ----------
  const m7 = mk({ hero: 65, meHp: () => ({ max: 8313, cur: 8313, pct: 100 }), rt: { rbDps: 4300, rbList: { [GOLK]: { lvl: 79, alive: true } } } });
  m7.env.rt.rbDb = { [GOLK]: { dps: 2400, dpsLvl: 65, dpsBase: 4300, sp: 2396, hitP90: 675 } };
  const G = { hp: 6194391, patk: 9953, matk: 2500 };
  assert.equal(Math.round(m7.R.rbDpsOn(GOLK)), 2400, 'same level and damage → as measured');
  assert.equal(m7.R.rbPreCheck(GOLK, G).kind, 'slow');
  m7.env.rt.rbDps = 10000;   // общий урон вырос (шмот, баффы) — ожидание по Голконде растёт так же
  assert.equal(Math.round(m7.R.rbDpsOn(GOLK)), Math.round(2400 * 10000 / 4300));
  assert.equal(m7.R.rbPreCheck(GOLK, G).ok, true, 'stronger hero → Golkonda comes back by itself (≈18.5 min)');
  m7.env.rt.rbDps = 4300; m7.setHero(72);   // +7 уровней: разница 14 → 7 ур.
  assert.equal(Math.round(m7.R.rbDpsOn(GOLK)), Math.round(2400 * 0.65 / 0.5), 'level up scales the old measurement');
  // учёба в бою: новый замер — среднее с приведённым старым, с уровнем и общим ДПС; поправка за уровни учится
  m7.setHero(65); m7.env.rt.rbGapK = 0;
  await m7.R.rbDpsLearn(GOLK, 2000);
  assert.equal(m7.env.rt.rbDb[GOLK].dps, Math.round(2400 * 0.6 + 2000 * 0.4)); assert.equal(m7.env.rt.rbDb[GOLK].dpsLvl, 65); assert.equal(m7.env.rt.rbDb[GOLK].dpsBase, 4300);
  assert.ok(Math.abs(m7.env.rt.rbGapK - (1 - 2000 / 4300) / 14) < 0.001, 'gap factor learned from the fight: ' + m7.env.rt.rbGapK);
  // замеры лога 12.10 — в памяти сразу (once rbFit1002) и в базовом профиле
  const c7 = read('content.js'), mig = c7.slice(c7.indexOf("once('rbFit1002'"), c7.indexOf("once('rbStats925'"));
  const FIT = new Function(c7.slice(c7.indexOf('const RB_FIT_1002 = '), c7.indexOf('};', c7.indexOf('const RB_FIT_1002 = ')) + 2) + '; return RB_FIT_1002;')();
  const rt7 = { rbDps: 4000, rbDb: { [RAHHA]: { dps: 5000, sp: 3000, kills: 2 } } }, rf7 = {};
  new Function('rt', 'rf', 'once', 'RB_FIT_1002', mig)(rt7, rf7, (f, fn) => fn(), FIT);
  assert.equal(rf7.rbDb[RAHHA].dps, 5000, 'own measurement wins'); assert.equal(rf7.rbDb[RAHHA].sp, 3000); assert.equal(rf7.rbDb[RAHHA].kills, 2);
  assert.equal(rf7.rbDb[GOLK].dps, 2397); assert.equal(rf7.rbDb[GOLK].dpsLvl, 65); assert.equal(rf7.rbDb[GOLK].dpsBase, 4000); assert.equal(rf7.rbDb[HALLATE].sp, 2640);
  const bp = JSON.parse(read('base-profile.json')).chars.Warlock.rt.rbDb;
  for (const id of Object.keys(FIT)) assert.ok(bp[id]?.dps > 0 && bp[id].sp > 0 && bp[id].dpsLvl === 65, 'base profile ' + id);
  console.log('v1002-rbtour-strong: PASS');
})().catch(e => { console.error(e); process.exit(1); });

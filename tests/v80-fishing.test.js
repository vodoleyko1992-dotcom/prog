'use strict';
// 8.0 (аудит рыбалки, лог 10.10 18:17–19:45, 560 рыб/ч при потолке ≈770–820): наживка по наличию и заряды всегда (A1),
// без кругов fishing ↔ char и заточка из строки снаряжения (A2), «не клюнула» только после ответа на заброс (A3), заряды при ≤ 20 (A5),
// меньше накладных на заброс (B1), быстрый обмен (B3), пакет времени 6 ч (B4), одна запись памяти на исход заброса (B5), откат до 1,05 с (C1)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const code = read('modules/fishing.js'), content = read('content.js'), popup = read('popup.js');

// ---------- фейковая страница рыбалки с управляемыми часами ----------
const clock = { t: 1800000000000 };
class FDate extends Date { static now() { return clock.t; } }
function world(o = {}) {
  const W = { gearRod: 'Вудка +2', gearLoaded: true, castT: 0, netAt: null, sleeps: [], setRt: [], fired: [], halted: null, recs: [], lastSleep: null };
  const slot = (kind, on, n) => ({ kind, on, n, disabled: false, get className() { return 'l2-fishing-hotbar-slot' + (this.on ? ' l2-fishing-hotbar-slot--toggle-on' : ''); } });
  W.slots = {
    basicBait: slot('basicBait', o.basicOn ?? true, o.basic ?? 500),
    goodBait: slot('goodBait', o.goodOn ?? false, o.good ?? 0),
    soulshot: slot('soulshot', o.shotOn ?? true, o.shots ?? 500),
    fishing: slot('fishing', false, 0),
  };
  const sb = { console, Date: FDate, Math, Number, JSON, Object, Array, Promise, setTimeout,
    sessionStorage: { getItem: () => null, setItem() {} },
    document: { body: {}, querySelectorAll: s => /fishing-gear-row/.test(s) ? [{ textContent: W.gearLoaded ? '1431 ON' : '' }] : [], querySelector: () => null } };
  sb.globalThis = sb;
  vm.runInNewContext(code, sb, { filename: 'modules/fishing.js' });
  const env = {
    rt: { ...(o.rt || {}) }, cfg: { fishBait: 'basic', fishShots: true, fishAutoBuy: true, fishBuyPacks: 1000, fishShotAuto: true, fishAutoSetup: false, reactMin: 150, reactMax: 450, ...(o.cfg || {}) },
    on: true, TAG: 't', fishObs: {}, fishMut: 0, fishCdMsg: 0, fishGearMsg: null, fishShotsSess: 0, fishGearN: 0, fishNoResp: 0, fishCast: null, FCD: { pumping: 0, reeling: 0 },
    CD_RE: /перезаряд/i, GEAR_RE: /$^/, ROD_RE: /вудк|удочк/i, ROD_NONE_RE: /не\s*выбран|не\s*обран|не\s*вибран/i,
    get NET_FISH() { return W.netAt != null && clock.t >= W.castT + W.netAt ? { t: W.castT + W.netAt, ok: true, act: 'cast' } : { t: 0 }; },
    $q: s => {
      const m = s.match(/data-slot="(\w+)"/); if (m) return W.slots[m[1]] || null;
      if (s === '.l2-fishing-gear-item--rod') return { cloneNode: () => ({ querySelectorAll: () => [], textContent: W.gearRod }) };
      return null;                                 // нет цели (#fishing-target), нет магазина (#fishing-shop-open) — покупка «не прошла»
    },
    qty: el => !el ? null : /Bait$/.test(el.kind) && !el.on ? 0 : el.n,   // как в игре: счётчик невыбранной наживки — 0
    fire: el => {
      if (!el) return; W.fired.push(el.kind || el);
      if (el.kind === 'fishing') { W.castT = clock.t; W.sleepBeforeCast = W.lastSleep; }
      if (/Bait$/.test(el.kind) && el.n > 0) { W.slots.basicBait.on = W.slots.goodBait.on = false; el.on = true; }   // пустую игра не выбирает
      if (el.kind === 'soulshot') el.on = !el.on;
    },
    cdBusy: () => false, shown: () => true, rnd: (a, b) => a + Math.random() * (b - a),
    sleep: async ms => { W.sleeps.push(ms); W.lastSleep = ms; clock.t += ms; },
    waitFor: async (fn, timeout = 10000, step = 250) => { const t0 = clock.t; while (clock.t - t0 < timeout) { const r = fn(); if (r) return r; clock.t += step; } return null; },
    setRt: async p => { W.setRt.push(p); Object.assign(env.rt, p); return { ok: true }; },
    setStatus: s => { W.status = s; W.statusAt = clock.t; }, rec: (...a) => W.recs.push(a.join(' ')),
    halt: async m => { W.halted = m; }, idle: async () => {}, autonomyMode: () => 'idle',
    isNoBite: () => false, isBite: () => false, isCast: () => false,
  };
  W.env = env; W.F = sb.L2V7Factories.fishing(env);
  return W;
}
(async () => {
  // ---------- A1: «Авто» просит хорошую, а её 0 → ловим на обычной, и блок зарядов ВСЁ РАВНО выполняется ----------
  { const W = world({ cfg: { fishBait: 'auto' }, good: 0, basic: 500, shots: 0, shotOn: false });
    assert.equal(W.F.baitWant(), 'goodBait', 'auto: меньше 60 забросов на хорошей — просит хорошую');
    assert.equal(await W.F.fishPrepare(), true);
    assert.equal(W.slots.basicBait.on, true, 'ловим на обычной');
    assert.equal(W.env.rt.baitSwapTo, 'basicBait', '30 мин на обычной');
    assert.ok(W.env.rt.fishBuyFail?.shot, 'заряды 0 — покупка попытана (раньше выход до блока зарядов)');
    assert.equal(W.env.rt.fishNoShots, true, 'и предупреждение «заряды кончились» выставлено');
    assert.ok(W.recs.some(r => /заряды кончились/.test(r)));
    // повторно в окне 30 мин — без попытки выбрать хорошую (без 5 с ожидания)
    const t0 = clock.t; W.fired.length = 0;
    assert.equal(await W.F.fishPrepare(), true);
    assert.ok(!W.fired.includes('goodBait'), 'в окне 30 мин хорошую не трогаем');
    assert.ok(clock.t - t0 < 1000, 'окно: без ожидания переключения');
  }
  // ---------- A1: хорошей и обычной нет → покупается ОБЫЧНАЯ (хорошую — никогда), раньше при «хорошая/Авто» — сразу пауза ----------
  for (const fishBait of ['good', 'auto']) {
    const W = world({ cfg: { fishBait }, good: 0, basic: 0 });
    assert.equal(await W.F.fishPrepare(), false);
    assert.equal(W.env.rt.fishBuyFail?.bait?.n, 1, `${fishBait}: обычная наживка — попытка покупки`);
    assert.match(W.halted || '', /наживка кончилась, купить не вышло/);
  }
  // ---------- лог 10.10 23:52–06:23 (v7.2.3, ночь): «Авто» выбрала хорошую (00:23), она кончилась → обычная (501 шт.), в 01:05 кончилась
  // и обычная — 5 ч «наживка кончилась, купить не вышло» ×68 без ЕДИНОЙ попытки покупки. Состояние той ночи: решение «Авто» = хорошая,
  // переход на обычную 42 мин назад, обеих 0 → в 8.0 бот обязан пытаться купить обычную ----------
  { const W = world({ cfg: { fishBait: 'auto' }, good: 0, basic: 0, basicOn: true,
      rt: { baitAutoWant: 'goodBait', baitSwapTo: 'basicBait', baitSwapT: clock.t - 42 * 60000, fishBaitStat: { goodBait: { casts: 65, proof: 20 }, basicBait: { casts: 379, proof: 110 } } } });
    assert.equal(await W.F.fishPrepare(), false);
    assert.equal(W.env.rt.fishBuyFail?.bait?.n, 1, 'ночной сценарий: попытка купить обычную наживку есть');
  }
  // ---------- A1: нужна обычная, её 0, есть хорошая → сперва покупка обычной, не вышло — ловим на хорошей ----------
  { const W = world({ cfg: { fishBait: 'basic' }, basic: 0, good: 300 });
    assert.equal(await W.F.fishPrepare(), true);
    assert.equal(W.env.rt.fishBuyFail?.bait?.n, 1, 'сперва докупить обычную');
    assert.equal(W.slots.goodBait.on, true, 'покупка не прошла — ловим на хорошей');
    assert.equal(W.env.rt.baitSwapTo, 'goodBait');
  }
  // ---------- обычный заброс: нужная выбрана и есть — ни пауз, ни записей ----------
  { const W = world({ rt: { rodLvl: 2 } });
    const t0 = clock.t;
    assert.equal(await W.F.fishPrepare(), true);
    assert.equal(clock.t - t0, 0, 'подготовка без пауз');
    assert.equal(W.setRt.length, 0, 'подготовка без записей');
  }
  // ---------- A5: заряды докупаются при ≤ 20 (раньше ровно при 0), не во время лесенки неудач ----------
  { const W = world({ shots: 15 });
    await W.F.fishPrepare();
    assert.equal(W.env.rt.fishBuyFail?.shot?.n, 1, '15 зарядов — докупаем');
    await W.F.fishPrepare();
    assert.equal(W.env.rt.fishBuyFail?.shot?.n, 1, 'неудача 0 с назад — повтор не раньше 30 с');
    clock.t += 31000; await W.F.fishPrepare();
    assert.equal(W.env.rt.fishBuyFail?.shot?.n, 2, 'через 30 с — повтор');
    const W2 = world({ shots: 21 }); await W2.F.fishPrepare();
    assert.equal(W2.env.rt.fishBuyFail, undefined, '21 заряд — не покупаем');
    assert.equal(W2.env.rt.fishNoShots, undefined);
  }
  // ---------- A2: заточка удочки из строки снаряжения («Вудка +2», без «+» — +0) ----------
  { const W = world();
    const L = t => { W.gearRod = t; return W.F.rodLvlGear(); };
    assert.equal(L('Вудка +2'), 2); assert.equal(L('Вудка'), 0); assert.equal(L('Fishing Rod +10'), 10); assert.equal(L('Удочка + 3'), 3);
    assert.equal(L('Вудка новачка +1'), null, 'незнакомый вид — не гадаем');
    assert.equal(L('Вудка не обрана'), null, 'не выбрана — null');
    assert.equal(L('Вудка +11'), null);
    W.gearRod = 'Вудка +2'; W.gearLoaded = false; assert.equal(W.F.rodLvlGear(), null, 'страница не дорисована — null');
    const W2 = world({ rt: {} }); W2.gearRod = 'Вудка +3';
    await W2.F.fishPrepare();
    assert.equal(W2.env.rt.rodLvl, 3, 'уровень записан на рыбалке — без похода в инвентарь');
  }
  // ---------- A3 + B1 + B5: заброс под лагом ----------
  // без ответа сервера на заброс: раньше «не клюнула» через 3,5 с; теперь — только по жёсткому пределу 8 с
  { const W = world({ rt: { rodLvl: 2 } });
    W.netAt = null; await W.F.fishing();
    assert.match(W.status, /не клюнула/);
    assert.ok(W.statusAt - W.castT >= 8000, `без ответа — не раньше 8 с (было ${W.statusAt - W.castT})`);
    assert.ok(W.sleepBeforeCast >= 20 && W.sleepBeforeCast <= 60, `реакция перед забросом 20–60 мс (${W.sleepBeforeCast})`);
    assert.equal(W.setRt.length, 1, 'одна запись памяти на заброс');
    assert.equal(W.setRt[0].fish.casts, 1); assert.equal(W.setRt[0].fish.nobite, 1); assert.equal(W.setRt[0].fishBaitStat.basic.casts, 1);
  }
  // лог 19:00:04.677: ответ на заброс через 3,9 с — «не клюнула» только после ответа (+300 мс на перерисовку)
  { const W = world({ rt: { rodLvl: 2 } });
    W.netAt = 3900; await W.F.fishing();
    const dt = W.statusAt - W.castT;
    assert.ok(dt >= 4200 && dt < 4500, `ответ через 3,9 с — решение после него (${dt})`);
  }
  // быстрый ответ — запасной признак срабатывает с 3,5 с, как раньше
  { const W = world({ rt: { rodLvl: 2 } });
    W.netAt = 400; await W.F.fishing();
    const dt = W.statusAt - W.castT;
    assert.ok(dt >= 3500 && dt < 3700, `быстрый ответ — 3,5 с (${dt})`);
  }
  // ---------- B5: поймана — весь учёт одной записью; сброс из меню не откатывается ----------
  { const W = world();
    W.F.fishStat({ casts: 1 }); W.F.fishStat({ bites: 1 });
    W.env.fishCast = { bait: 'basic', t: clock.t - 5000 }; W.env.fishShotsSess = 5;
    await W.F.fishCaught('White Fish');
    assert.equal(W.setRt.length, 1, 'одна запись на рыбу (было ≈8)');
    const p = W.setRt[0];
    assert.deepEqual([p.fish.casts, p.fish.bites, p.fish.caught, p.fish.byFish['White Fish']], [1, 1, 1, 1]);
    assert.equal(p.fishBaitStat.basic.caught, 1); assert.equal(p.fishSess.n, 1); assert.equal(p.fishSess.shots, 5); assert.equal(p.fishSinceProc, 1);
    W.F.fishStat({ casts: 1 });
    W.env.rt = { ...W.env.rt, fish: { casts: 0, reset: true } };   // меню «Сбросить статистику» — rt из хранилища заменил память
    W.setRt.length = 0; W.F.statFlush();
    assert.equal(W.setRt.length, 0, 'старое значение после сброса не возвращаем');
    assert.equal(W.env.rt.fish?.reset, true);
  }
  // ---------- C1: проба отката до 1,05 с (не ниже), отказ — назад; записи из нажатия не ждём ----------
  { const W = world();
    assert.equal((W.env.rt.fishCdLen = 0.9, W.F.fishCdLen()), 1050, 'нижняя граница 1,05 с');
    Object.assign(W.env.rt, { fishCdLen: 1.06, fishCdStat: { ok: 39, rej: 0 } });
    await W.F.fishAct('pumping');
    assert.equal(W.env.rt.fishCdLen, 1.05, '40-е чистое нажатие — на 10 мс короче');
    W.env.rt.fishCdStat = { ok: 79, rej: 0 }; await W.F.fishAct('pumping');
    assert.equal(W.env.rt.fishCdLen, 1.05, 'ниже 1,05 с не идём');
    assert.equal(W.setRt.length, 0, 'нажатие не пишет в хранилище — запись с исходом заброса');
    // 8.0.3: учится только ЧИСТЫЙ отказ — нажали ровно по своему откату (1,05 с) без лага → +30 мс (раньше gap+60 мс от любого отказа)
    W.env.FCD.pumping = clock.t - 1050;
    const fire = W.env.fire; W.env.fire = el => { fire(el); W.env.fishCdMsg++; };   // «Навичка ще перезаряджається»
    await W.F.fishAct('pumping');
    assert.ok(Math.abs(W.env.rt.fishCdLen - 1.08) < 1e-9, `отказ — откат с запасом (${W.env.rt.fishCdLen})`);
    assert.equal(W.env.rt.fishCdStat?.rej, 1);
  }
  // ---------- B4: пакет времени 6 ч; не хватает аден — самый большой из меньших ----------
  { const W = world({ cfg: { fishTimeAuto: true, fishTimeMin: 5, fishTimePack: '6h', shopReserve: 200000 } });
    let remain = '00:04:00', aden = '8 000 000'; const clicked = [];
    const q = W.env.$q;
    W.env.$q = s => s === '#fishing-time-remaining' ? { textContent: remain } : s === '#fishing-time-adena' ? { textContent: aden }
      : /data-fishing-time-package="(\w+)"/.test(s) ? { pack: s.match(/"(\w+)"/)[1], disabled: false,
        querySelector: () => ({ textContent: ({ '1h': 3000000, '2h': 5500000, '3h': 7500000, '6h': 14000000 })[s.match(/"(\w+)"/)[1]] + ' Adena' }) } : q(s); // 10.0.14: цена из UI.
    W.env.fire = el => { clicked.push(el.pack); remain = '06:04:00'; };
    assert.equal(await W.F.fishTimeTopUp(), true);
    assert.deepEqual(clicked, ['3h'], '8 млн при резерве 0,2 млн: 6 ч (14 млн) не по карману — берём 3 ч (7,5 млн)');
    W.env.rt.fishTimeBuyAt = 0; remain = '00:04:00'; aden = '20 000 000';
    assert.equal(await W.F.fishTimeTopUp(), true); assert.equal(clicked[1], '6h');
    W.env.rt.fishTimeBuyAt = 0; remain = '00:04:00'; delete W.env.cfg.fishTimePack;
    assert.equal(await W.F.fishTimeTopUp(), true); assert.equal(clicked[2], '6h', 'по умолчанию — 6 ч');
    W.env.rt.fishTimeBuyAt = 0; remain = '00:04:00'; aden = '2 000 000';
    assert.equal(await W.F.fishTimeTopUp(), false, 'ни на что не хватает — не покупаем'); assert.equal(clicked.length, 3);
  }
  assert.ok(content.includes("fishTimePack: '6h'") && popup.includes("fishTimePack: '6h'"), 'DEF_CFG и меню: 6 ч');
  assert.match(content, /once\('fishPack80', \(\) => \{ if \(C\('fishTimePack'\) === '1h'\) cf\.fishTimePack = '6h'; \}\);/, 'миграция — только если стоял 1 ч');
  // ---------- A2: перед переходом — запись дошла до хранилища ----------
  const rc = content.match(/async function rtCommit\(maxMs = 5000\) \{[\s\S]*?\n\}\n/);
  assert.ok(rc, 'rtCommit есть');
  { let calls = 0, t = 0; const sleeps = [];
    const mk = (seq) => new Function('rtWriter', 'sleep', 'TAG', 'console', 'Date', `let on = true; ${rc[0]}; return rtCommit;`)(
      { recover: async () => seq[Math.min(calls++, seq.length - 1)] }, async ms => { sleeps.push(ms); t += ms; }, 't', { warn() {} }, { now: () => t });
    assert.equal(await mk([{ ok: false, reason: 'backoff' }, { ok: false, reason: 'backoff' }, { ok: true }])(), true, 'повторяем, пока не запишется');
    assert.equal(sleeps.length, 2);
    calls = 0; t = 0; sleeps.length = 0;
    assert.equal(await mk([{ ok: false, reason: 'inactive' }])(), false, 'не вышло за 5 с — переход как раньше');
    assert.ok(t >= 5000 && t < 5500);
  }
  assert.match(content, /await setRt\(\{ fishService: next, rodGoalWaitingProof: !!rt\.rodGoalActive && !next \}\);\n    await rtCommit\(\);/, 'finish(): ждём запись до перехода');
  assert.ok((content.match(/await rtCommit\(\); (?:if \([^;]+; )?location\.href = /g) || []).length >= 7, 'служебные переходы рыбалки — после записи');
  assert.match(content, /L2V7Modules\.fishing = L2V7Factories\.fishing\(\{[^\n]*get rtCommit\(\)\{return rtCommit\}/, 'геттер rtCommit у модуля рыбалки');
  assert.ok((code.match(/await commit\(\); (?:if \([^;]+; )?location\.href = /g) || []).length >= 3, 'модуль: переходы после записи; недоступный магазин сохраняет услугу без перехода');
  // ---------- B1: главный цикл после шага рыбалки — 30 мс вместо 200 ----------
  assert.match(content, /else if \(fishNow\(\) && isFishing\(\)\) \{ await fishing\(\); await sleep\(30\); continue; \}/);
  assert.match(code, /const lines = rej \? \[\] : \(await env\.sleep\(20\), fishNewLines\(before\)\);/);
  // ---------- B3: обмен без постоянных пауз 0,3–0,5 + 0,6–1,0 с на материал ----------
  const ex = code.slice(code.indexOf('async function fishExchange'), code.indexOf('async function fishSvcDone'));
  assert.ok(!/env\.sleep\(env\.rnd\(600, 1000\)\)/.test(ex) && !/fshop-max-btn'\)\); await env\.sleep\(env\.rnd\(300, 500\)\)/.test(ex), 'старых пауз нет');
  assert.match(ex, /await env\.waitFor\(\(\) => \{ const b = btnQ\(\), i = inpQ\(\); return !!b && !b\.disabled && \(!i \|\| \+i\.value > 0\); \}, 1500, 40\);/);
  assert.match(ex, /await env\.sleep\(env\.rnd\(200, 300\)\);/);
  assert.match(ex, /if \(made\.length\) await env\.waitFor\(\(\) => proof\(\) !== p0, 1500, 50\);/, 'итог Proof — после обновления числа');
  console.log('PASS: 8.0 fishing — bait by availability + soulshots always (A1), rod level from gear row + commit before navigation (A2), no-bite only after cast response (A3), shots at ≤20 (A5), 30 ms loop / 20–60 ms reaction (B1), faster exchange (B3), 6h time pack with fallback (B4), one storage write per cast outcome (B5), cooldown probe to 1.05 s (C1)');
})().catch(e => { console.error(e); process.exitCode = 1; });

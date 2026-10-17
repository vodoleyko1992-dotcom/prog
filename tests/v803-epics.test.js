'use strict';
// 10.0.24: дополнительные геттеры владельца перед прежними зависимостями допустимы.
// 8.0.3 (эпики, разбор 11.10 — логи 4ee00a04/d089c7e2, снимок 75dac78f): Coin of Luck — «0» = не тратить; единые ворота перед любой
// тратой CoL (свежий список, жив, игра пускает, цифры босса, вердикт); 1 платный заход на появление; резерв не снимается на таймауте;
// разбор строки .l2-rb-row (подсказка «Недоступно»); список и цифры — из ответов сервера; смерть без подтверждённого сохранения HP — ждать
// следующего появления; магазин не покупает за Coin of Luck
const assert = require('node:assert/strict');
const { fs, path, vm, root, read, content, epicsSrc, raidSrc, EPICS, LV_RE, base, fx, clone, H, MIN, docOf, pageHtml, mk, QA, WEAK, listAlive, T0 } = require('./epic-harness.cjs');

(async () => {
  // ---------- T1: /game/epic-bosses → epicDb ----------
  {
    const { env, E, logs } = mk();
    assert.ok(await E.epicApiNote(fx, 'api', T0));
    const db = env.rt.epicDb;
    assert.equal(db.ak.canAttack, false); assert.equal(db.ak.deny, 'Epic Boss нижче дозволеного рівня.');
    assert.equal(db.orfen.canAttack, true); assert.equal(db.baium.canAttack, true, 'server shows no upper level limit');
    assert.equal(db.frintezza.lvl, 90); assert.equal(db.valakas.respH, 240); assert.equal(db.zaken.respH, 36);
    assert.ok(Object.values(db).every(d => d.alive === false && d.col === 1 && d.adena === 0 && d.paidN === 0));
    assert.equal(db.ak.until.hi, T0 + 12 * H); assert.equal(db.ak.until.lo, 0, 'never seen alive → only the upper bound');
    assert.equal(env.rt.epicApi.minLvl, 45); assert.equal(env.rt.epicApi.charLvl, 54);
    assert.match(env.rt.epicApi.keys, /attackBlockedReasonUk,.*respawnHours/); assert.ok(logs.some(l => /поля эпика/.test(l)), 'key set logged');
    // урезанный / не полный список не разбирается
    const cut = clone(fx); cut.bosses = [...cut.bosses.slice(0, 7), '…ещё 1'];
    assert.equal(await E.epicApiNote(cut, 'page', T0), null);
    const short = clone(fx); short.bosses.pop(); assert.equal(await E.epicApiNote(short, 'page', T0), null, 'length ≠ total');
    // жив → мёртв: окно [последний раз жив + 12 ч, впервые мёртв + 12 ч]; платные заходы появления обнуляются
    await E.epicApiNote(listAlive('l2dop_rb_29014'), 'api', T0 + H);
    assert.ok(logs.some(l => /🐉 Орфен появился/.test(l)));
    await E.epicDbSet('orfen', { paidN: 1 });
    await E.epicApiNote(fx, 'api', T0 + 2 * H);
    const o = env.rt.epicDb.orfen;
    assert.deepEqual([o.until.lo, o.until.hi], [T0 + 13 * H, T0 + 14 * H]); assert.equal(o.paidN, 0);
    assert.ok(logs.some(l => /Орфен убит — появится между/.test(l)));
    // время от сервера (если пришлёт) — точное
    const fx2 = clone(fx); fx2.bosses[1].respawnAt = new Date(T0 + 5 * H).toISOString();
    await E.epicApiNote(fx2, 'api', T0 + 3 * H); assert.equal(env.rt.epicDb.orfen.until.exact, true); assert.equal(env.rt.epicDb.orfen.until.hi, T0 + 5 * H);
    console.log('PASS T1: /game/epic-bosses parsed (deny, levels, respawn, CoL cost, dead-until window, key set), truncated lists ignored');
  }
  // ---------- T2: окно появления и расписание опроса ----------
  {
    const { env, E } = mk({ cfg: { epicList: 'orfen' } });
    // 8.0.8: «сейчас» передаём явно — раньше тест сравнивал с часами машины и падал, когда T0 + 12 ч оставалось в прошлом
    assert.deepEqual(clone(E.epicUntil({ alive: false, killT: T0, respH: 12 }, T0 + H)), { lo: T0 + 12 * H, hi: T0 + 12 * H, exact: true, late: false });
    const last = Date.now() - 30 * 1000;
    env.rt.epicApi = { t: last, minLvl: 45, charLvl: 54 };
    const now = Date.now(), set = d => { env.rt.epicDb = { orfen: { lvl: 50, canAttack: true, alive: false, respH: 12, ...d } }; };
    set({ killT: now - 11 * H });                         // точное время через час
    assert.equal(E.epicApiNext(now), now - 11 * H + 12 * H - 5 * MIN, 'nothing before lo − 5 min'); assert.equal(E.epicApiDue(now), false);
    set({ killT: now - 12 * H + 2 * MIN }); assert.equal(E.epicApiNext(now), last + MIN, 'exact window: every minute');
    set({ deadT: now - 11.9 * H, aliveT: now - 12.1 * H }); assert.equal(E.epicApiNext(now), last + 3 * MIN, 'window with both bounds: 3 min');
    set({ deadT: now - 6 * H }); assert.equal(E.epicApiNext(now), last + 15 * MIN, 'lower bound unknown: 15 min');
    set({ deadT: now - 13 * H }); assert.equal(E.epicApiNext(now), last + 10 * MIN, 'after the window: 10 min');
    set({ deadT: now - 6 * H, verdict: { v: 'strong' } }); assert.equal(E.epicApiNext(now), last + 2 * H, 'nothing suitable: 2 h');
    env.rt.epicApi = null; assert.equal(E.epicApiDue(now), true, 'never asked — ask now');
    console.log('PASS T2: dead-until window, poll schedule (none before window, 1/3/15 min inside, 10 min after, 2 h if nothing suitable)');
  }
  // ---------- T3: бюджет Coin of Luck / цена / единица ----------
  {
    const { env, E } = mk({ rt: { epicDb: { orfen: { col: 1, adena: 0, apiT: Date.now(), paidN: 0 } } } });
    const pr = E.epicPrice('orfen', { priceKnown: true, price: 1, priceUnit: 'Coin of Luck', priceText: '(1 Coin of Luck)' });
    assert.deepEqual([pr.known, pr.col], [true, 1]);
    assert.match(E.epicTpBudgetQuote(pr, 'orfen').why, /лимит Coin of Luck = 0 \(не тратить\)/);
    env.cfg.epicCoinDailyMax = 2; assert.equal(E.epicTpBudgetQuote(pr, 'orfen').ok, true);
    env.rt.epicTpBudget = [{ t: Date.now() - 1000, k: 'core', cost: 2, unit: 'Coin of Luck' }]; assert.equal(E.epicTpBudgetQuote(pr, 'orfen').ok, false, '2/2 per 24 h');
    env.rt.epicTpBudget = []; env.rt.epicDb.orfen.paidN = 1; assert.match(E.epicTpBudgetQuote(pr, 'orfen').why, /предел 1/);
    assert.equal(E.epicTpBudgetQuote({ known: true, col: 15, adena: 0 }, 'orfen', { kind: 'buff' }).ok, false, 'buff 15 > daily 2');
    env.cfg.epicCoinDailyMax = 20; assert.equal(E.epicTpBudgetQuote({ known: true, col: 15, adena: 0 }, 'orfen', { kind: 'buff' }).ok, true, 'buff ignores the per-spawn rule');
    env.cfg.epicCoinDailyMax = 2; env.rt.epicDb.orfen.paidN = 0; env.cfg.epicCoinKeep = 30;
    assert.match(E.epicTpBudgetQuote(pr, 'orfen').why, /неизвестен/);
    env.invQty = () => 30; assert.match(E.epicTpBudgetQuote(pr, 'orfen').why, /баланс 30, запас 30/);
    env.invQty = () => 31; assert.equal(E.epicTpBudgetQuote(pr, 'orfen').ok, true); env.cfg.epicCoinKeep = 0;
    assert.equal(E.epicTpBudgetQuote({ known: false }, 'orfen').ok, false, 'unknown price is refused even with a limit');
    assert.equal(E.unitOf('1 ?'), ''); assert.equal(E.unitOf('1 Монета удачі'), 'Coin of Luck'); assert.equal(E.unitOf('7 000 аден'), 'аден');
    const odd = E.epicPrice('orfen', { priceKnown: true, price: 1, priceUnit: E.unitOf('1 ?'), priceText: '1 ?' });
    assert.equal(odd.known, false); assert.equal(E.epicTpBudgetQuote(odd, 'orfen').ok, false, 'unrecognised unit → refuse');
    env.rt.epicDb.orfen.col = 0; assert.equal(E.epicPrice('orfen', { priceKnown: true, price: 1, priceUnit: 'Coin of Luck' }).col, 1, 'DOM says 1 CoL while API says 0 → the higher');
    env.rt.epicDb.orfen.vipFree = true; const vip = E.epicPrice('orfen', null);
    assert.equal(vip.free, true); const q = await E.epicTpBudgetReserve('orfen', vip);
    assert.equal(q.ok, true); assert.equal(q.cost, 0); assert.equal((env.rt.epicTpBudget || []).length, 0, 'VIP: nothing reserved'); assert.equal(env.rt.epicDb.orfen.paidN, 0);
    env.cfg.epicCoinDailyMax = 0; env.cfg.epicAdenaDailyMax = 0;
    assert.equal(E.epicTpBudgetQuote({ known: true, col: 0, adena: 8000 }, 'orfen').ok, true, 'adena limit 0 = no limit');
    env.cfg.epicCoinDailyMax = 2; assert.equal(E.epicTpBudgetQuote({ price: 1, priceKnown: true, priceUnit: 'Coin of Luck' }, 'ak').ok, true, 'old row-style call');
    console.log('PASS T3: CoL 0 = never, daily cap, 1 per spawn, keep balance, unknown price/unit refused, DOM vs API → higher, VIP free, adena as before');
  }
  // ---------- T4: вердикт по силам (базовый профиль, макс. HP 4843) ----------
  {
    const { env, E, setHero } = mk({ rt: { epicDb: { ak: { id: 'l2dop_rb_29001', canAttack: true, lvl: 40 } } } });
    env.rt.rbStats.l2dop_rb_29001 = { ...QA, src: 'api' };
    setHero(48);                                        // уровень, при котором игра пустила бы к Королеве
    const v = E.epicVerdict('ak');
    assert.equal(v.v, 'strong', v.why); assert.ok(Math.abs(v.sp - 2306) <= 5, 'special ≈0.9 × M.Atk: ' + v.sp); assert.ok(v.spPct >= 45);
    setHero(54); env.rt.epicDb.ak = { id: 'l2dop_rb_29001', canAttack: false, deny: 'Epic Boss нижче дозволеного рівня.', apiLvl: 54, lvl: 40 };
    assert.equal(E.epicVerdict('ak').v, 'level');
    assert.equal(E.epicVerdict('zaken').v, 'unknown', 'no stats → unknown (never pay)');
    // 8.0.3: цифры Орфена встроены (RB_KNOWN, лог 11.10 11:41: HP 487 686, M.Atk 3192) — он «не по силам» и без памяти (игрок умер дважды)
    assert.equal(E.epicVerdict('orfen').v, 'strong', 'Orfen built-in numbers → strong');
    env.rt.rbStats.l2dop_rb_29014 = { hp: 400000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' };
    const ok = E.epicVerdict('orfen'); assert.equal(ok.v, 'ok', ok.why);
    env.rt.rbStats.l2dop_rb_29014 = { hp: 9000000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' };
    const sl = E.epicVerdict('orfen'); assert.ok(['slow', 'pots'].includes(sl.v), sl.v + ' ' + sl.why);
    env.rt.rbStats.l2dop_rb_29014 = { hp: 400000, patk: 1100, matk: 700, mdef: 2400, pdef: 700, src: 'api' };
    const corr = E.epicVerdict('orfen'); assert.ok(corr.dps < base.rbDps * 0.5, 'M.Def correction is conservative: ' + corr.dps);
    env.rt.rbDb.l2dop_rb_29014 = { dps: 5000 }; assert.equal(E.epicVerdict('orfen').dps, 5000, 'measured DPS on it — no M.Def correction');
    // макс. HP героя неизвестно → «неизвестно», запасные 6000 HP не решают (на 6000 Королева прошла бы)
    const { env: e2, E: E2, setHero: sh2 } = mk({ meHp: () => null, rt: { epicDb: { ak: { id: 'l2dop_rb_29001', canAttack: true, lvl: 40 } } } });
    e2.rt.rbStats.l2dop_rb_29001 = { ...QA, src: 'api' }; sh2(48);
    assert.equal(E2.epicVerdict('ak').v, 'unknown');
    assert.equal(e2.rbPreCheck('l2dop_rb_29001', { ...QA, est: false }).spPct, 38, 'rbPreCheck alone would fall back to 6000 HP (2306 = 38 %)');
    assert.equal(e2.rbPreCheck('l2dop_rb_29001', { ...QA, est: false }, 1, 700, 4843).spPct, 48, 'hpOver wins over the fallback');
    console.log('PASS T4: verdicts — Queen Ant strong (2306 ≈48 %), level, unknown, ok, slow/pots, conservative DPS, unknown hero HP → unknown');
  }
  // ---------- T5: единые ворота epicPayGate ----------
  // 8.0.3: цифры Орфена теперь встроены (RB_KNOWN) — «незнакомого» эпика проверяем на Закене (29022)
  {
    const { env, E, calls } = mk({ rt: { epicDb: { zaken: { id: 'l2dop_rb_29022', col: 1, adena: 0, apiT: Date.now(), alive: true, canAttack: true, lvl: 60 } } } });
    const g0 = await E.epicPayGate('zaken');
    assert.equal(g0.ok, false); assert.match(g0.why, /лимит Coin of Luck = 0/); assert.equal(calls.length, 0, 'limit 0: not even asking the server');
    assert.equal((env.rt.epicTpBudget || []).length, 0);
    const net = u => /epic-bosses/.test(u) ? listAlive('l2dop_rb_29022') : /spawn\/l2dop_rb_29022\/info/.test(u) ? WEAK : null;
    const m = mk({ cfg: { epicCoinDailyMax: 2 }, net, rt: { epicDb: { zaken: { id: 'l2dop_rb_29022', col: 1, adena: 0, apiT: Date.now() - 3 * MIN, alive: true, canAttack: true, lvl: 60 } } } });
    const g = await m.E.epicPayGate('zaken');
    assert.equal(m.calls[0], '/game/epic-bosses?page=1', 'stale list (> 2 min) → fresh list first');
    assert.equal(m.calls[1], '/game/spawn/l2dop_rb_29022/info', 'no boss numbers → spawn info');
    assert.equal(g.ok, true, g.why); assert.equal(m.env.rt.rbStats.l2dop_rb_29022.from, 'api');
    await m.E.epicTpBudgetReserve('zaken', g.price); assert.equal(m.env.rt.epicDb.zaken.paidN, 1); assert.equal(m.env.rt.epicTpBudget.length, 1);
    const d = mk({ cfg: { epicCoinDailyMax: 2 }, net: u => /epic-bosses/.test(u) ? fx : WEAK, rt: { epicDb: { zaken: { id: 'l2dop_rb_29022', col: 1, apiT: 0, lvl: 60 } } } });
    const gd = await d.E.epicPayGate('zaken'); assert.equal(gd.ok, false); assert.match(gd.why, /мёртв/);
    const dd = mk({ cfg: { epicCoinDailyMax: 2 }, net, rt: { deaths1h: [Date.now() - 1000, Date.now() - 2000], epicDb: { zaken: { id: 'l2dop_rb_29022', apiT: 0, lvl: 60 } } } });
    const g2 = await dd.E.epicPayGate('zaken'); assert.equal(g2.ok, false); assert.match(g2.why, /2 смерти за последний час/);
    const nf = mk({ cfg: { epicCoinDailyMax: 2 }, net: () => null, rt: { epicDb: { zaken: { id: 'l2dop_rb_29022', apiT: 0, lvl: 60 } } } });
    assert.match((await nf.E.epicPayGate('zaken')).why, /не получен/, 'no list from the server → no payment');
    console.log('PASS T5: pay gate — limit 0 without network, fresh list then spawn info, ok → reserve (paidN 1), dead / deaths / no list → refuse');
  }
  // ---------- T6: дорога — эпик на карте, страница, таймаут, отказ сервера, повторная оплата ----------
  const pin = '<div><button class="l2-map-mob-pin l2-map-mob-pin--epic" data-spawn-id="l2dop_rb_29014" title="Орфен · ур. 50 · епік-бос"></button></div>';
  const alivePage = pageHtml.replace(/(data-spawn-id="l2dop_rb_29014"[\s\S]*?)l2-rb-row__status--dead"> · Убит/, '$1l2-rb-row__status--alive"> · Живий');
  const okDb = (x = {}) => ({ orfen: { id: 'l2dop_rb_29014', col: 1, adena: 0, apiT: Date.now(), alive: true, canAttack: true, lvl: 50, respH: 12, ...x } });
  const okStats = () => ({ ...clone(base.rbStats), l2dop_rb_29014: { hp: 400000, patk: 1100, matk: 700, mdef: 800, pdef: 700, src: 'api' } });
  {
    const m = mk({ doc: docOf(pin), cfg: { epicCoinDailyMax: 2 }, rt: { epicDb: okDb(), rbStats: okStats(), epic: { step: 'go', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен' } } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.step, 'arrive'); assert.equal(m.env.rt.epic.via, 'here'); assert.equal(m.loc.href, '', 'no epic page');
    assert.equal((m.env.rt.epicTpBudget || []).length, 0, 'free — nothing reserved'); assert.ok(m.logs.some(l => /он здесь, на этой карте — без телепорта/.test(l)));
    // подтверждённый отход → prep (только бесплатно) → go → он здесь, второй оплаты нет
    m.store['l2bot.epicLeave'] = JSON.stringify({ id: 'l2dop_rb_29014', at: Date.now(), ok: true });
    m.env.rt.epic = { step: 'retreatVerify', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', retreatT: Date.now() - 1000, retreatAttempt: { t: Date.now(), cur: 300000, max: 400000, chip: 100000, sec: 60, dps: 1666 } };
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.step, 'prep'); assert.equal(m.env.rt.epic.noPay, true); assert.equal(m.env.rt.rbDb.l2dop_rb_29014.dps, 1666, 'DPS on it from the attempt');
    await m.E.epicStep(); assert.equal(m.env.rt.epic.step, 'go');
    await m.E.epicStep(); assert.equal(m.env.rt.epic.via, 'here'); assert.equal((m.env.rt.epicTpBudget || []).length, 0, 'no second payment');
  }
  {   // страница: оплата → таймаут перехода без отказа сервера — резерв остаётся, шаг «прилёт» страницей
    const m = mk({ doc: docOf(alivePage), path: '/epic-bosses.html', search: '?page=1', cfg: { epicCoinDailyMax: 2 },
      rt: { epicDb: okDb(), rbStats: okStats(), epic: { step: 'go', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', mapChecked: true } } });
    await m.E.epicStep();
    assert.equal(m.fires.length, 1); assert.equal(m.fires[0].className, 'l2-rb-row__tp', 'the teleport button, not the name');
    assert.equal(m.env.rt.epicTpBudget.length, 1, 'reserve kept on transition timeout'); assert.equal(m.env.rt.epicDb.orfen.paidN, 1);
    assert.equal(m.env.rt.epic.step, 'arrive'); assert.equal(m.env.rt.epic.via, 'page');
    // сервер отказал (POST …/teleport, ответ в sessionStorage) → резерв снят, paidN откатан
    m.store['l2bot.epicTp'] = JSON.stringify({ path: '/game/epic-boss/teleport', status: 400, ok: false, msg: 'Недостатньо Coin of Luck', t: Date.now() });
    await m.E.epicStep();
    assert.equal(m.env.rt.epicTpBudget.length, 0); assert.equal(m.env.rt.epicDb.orfen.paidN, 0); assert.equal(m.env.rt.epic.step, 'pick');
    // второй раз: телепорт прошёл, но карты нет >90 с, логово не подтверждено → ждать следующего появления, страницей НЕ идти
    m.env.rt.epicDb.orfen.skipT = 0; m.store['l2bot.epicTp'] = null; delete m.store['l2bot.epicTp'];
    m.env.rt.epic = { step: 'arrive', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', via: 'page', at: Date.now() - 95000, tpT: Date.now() - 95000 };
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.step, 'pick'); assert.ok(m.env.rt.epicDb.orfen.skipT > Date.now() + 11 * H, 'until the next spawn'); assert.notEqual(m.loc.href, '/epic-bosses.html');
  }
  {   // Валакас (логова нет, tp:null): раньше через 90 с снова платил страницей (:331)
    const m = mk({ cfg: { epicCoinDailyMax: 2 }, path: '/town.html', rt: { epicDb: { valakas: { id: 'l2dop_rb_29028', respH: 240, alive: true } }, epic: { step: 'arrive', k: 'valakas', id: 'l2dop_rb_29028', name: 'Валакас', via: 'page', at: Date.now() - 95000 } } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.step, 'pick'); assert.notEqual(m.env.rt.epic.via, 'page'); assert.ok(m.env.rt.epicDb.valakas.skipT > Date.now() + 200 * H);
  }
  {   // логово за адену: только живой (свежий ответ сервера) и «по силам»; на месте — логово подтверждено, локация запомнена
    const zc = { sea_of_spores: { name: 'Sea of Spores', price: 6000 } };
    const m = mk({ path: '/town.html', rt: { epicDb: okDb(), rbStats: okStats(), zoneCat: zc, epic: { step: 'go', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', mapChecked: true } } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.via, 'zone'); assert.equal(m.env.rt.zoneGo.id, 'sea_of_spores');
    assert.deepEqual(m.env.rt.epicTpBudget.map(x => [x.cost, x.unit, x.kind]).join(), '6000,аден,lair', 'adena reserved, Coin of Luck not touched (limit 0)');
    // 8.0.3 (ревью, probe1): rt.zone обновляется только zoneHere при фарме — сразу после телепорта там прежняя зона фарма
    m.loc.pathname = '/map.html'; m.setDoc(docOf(pin)); m.env.rt.zone = 'blazing_swamp'; m.env.rt.zonePend = { id: 'sea_of_spores', t: Date.now() };
    await m.E.epicStep();
    assert.ok(m.env.rt.epicDb.orfen.lairOkT); assert.equal(m.env.rt.epicDb.orfen.seenZone, 'sea_of_spores', 'the lair flown to, not the stale farming zone'); assert.equal(m.env.rt.epic.step, 'fight');
    const d = mk({ path: '/town.html', net: () => fx, rt: { epicDb: okDb({ apiT: 0 }), rbStats: okStats(), zoneCat: zc, epic: { step: 'go', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', mapChecked: true } } });
    await d.E.epicStep();
    assert.equal(d.calls[0], '/game/epic-bosses?page=1', 'stale list → asked before the road'); assert.equal(d.env.rt.zoneGo, undefined, 'dead — no lair trip'); assert.equal(d.env.rt.epic.step, 'pick');
  }
  {   // кнопка не нажалась → резерв снят
    const m = mk({ doc: docOf(alivePage), path: '/epic-bosses.html', fireOk: false, cfg: { epicCoinDailyMax: 2 },
      rt: { epicDb: okDb(), rbStats: okStats(), epic: { step: 'go', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', mapChecked: true } } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epicTpBudget.length, 0); assert.equal(m.env.rt.epicDb.orfen.paidN, 0);
    // лимит 0 — на странице ничего не нажимаем
    const z = mk({ doc: docOf(alivePage), path: '/epic-bosses.html', rt: { epicDb: okDb(), rbStats: okStats(), epic: { step: 'go', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', mapChecked: true } } });
    await z.E.epicStep();
    assert.equal(z.fires.length, 0); assert.equal((z.env.rt.epicTpBudget || []).length, 0); assert.match(z.env.rt.epicDb.orfen.why, /лимит Coin of Luck = 0/);
    console.log('PASS T6: road — epic on this map without teleport, retreat → free only, page: reserve kept on timeout, refusal releases it, no second page payment (incl. Valakas), click failure releases');
  }
  // ---------- T7: смерть и сохранение HP ----------
  {
    const fight = { step: 'fight', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', died: true, kills0: 0, hpLog: [{ t: Date.now(), cur: 300000, max: 400000 }], startHp: 400000 };
    const m = mk({ cfg: { epicCoinDailyMax: 2 }, rt: { epicDb: okDb({ paidN: 1 }), rbStats: okStats(), epic: clone(fight) } });
    await m.E.epicStep();
    assert.equal(m.env.rt.epic.step, 'pick'); assert.ok(m.env.rt.epicDb.orfen.skipT > Date.now() + 11 * H, 'persist unknown → next spawn');
    const p = mk({ cfg: { epicCoinDailyMax: 2 }, rt: { epicDb: okDb({ paidN: 1, persist: true }), rbStats: okStats(), epic: clone(fight) } });
    await p.E.epicStep();
    assert.equal(p.env.rt.epic.step, 'prep'); assert.equal(p.env.rt.epic.noPay, true); assert.equal(p.env.rt.epic.deaths, 1);
    p.env.rt.epic.step = 'go'; p.env.rt.epic.mapChecked = true; p.loc.pathname = '/town.html';
    await p.E.epicStep();
    assert.equal(p.env.rt.epic.step, 'pick'); assert.equal((p.env.rt.epicTpBudget || []).length, 0, 'after death: no Coin of Luck even with a limit');
    const r = mk({ rt: { epicDb: okDb({ retreatsLife: 7 }), epic: { step: 'retreatVerify', k: 'orfen', id: 'l2dop_rb_29014', name: 'Орфен', retreatT: Date.now() - 1000 } } });
    r.store['l2bot.epicLeave'] = JSON.stringify({ id: 'l2dop_rb_29014', at: Date.now(), ok: true });
    await r.E.epicStep(); assert.equal(r.env.rt.epic.step, 'pick'); assert.match(r.env.rt.epicDb.orfen.why, /8 отходов/);
    const killed = mk({ rt: { epicDb: okDb({ paidN: 1 }), rbDb: { l2dop_rb_29014: { kills: 1 } }, epic: { ...clone(fight), died: false } } });
    await killed.E.epicStep();
    assert.equal(killed.env.rt.epicDb.orfen.paidN, 0); assert.equal(killed.env.rt.epicDb.orfen.until.exact, true); assert.ok(killed.logs.some(l => /следующее появление ровно в/.test(l)));
    const combat = read('modules/combat.js');
    assert.match(combat, /if \(reset \|\| keep\) await env\.epicDbSet\(ek, \{ persist: !!keep, persistT: Date\.now\(\) \}\);/);
    assert.match(combat, /Date\.now\(\) - \(last\.t \|\| 0\) >= 60000 && mob0\.cur <= last\.cur \+ mob0\.max \* 0\.02/);
    console.log('PASS T7: death without confirmed HP persistence → next spawn; with persistence → free retry only; 8 retreats → next spawn; kill → exact next spawn');
  }
  // ---------- T8: выбор ----------
  {
    const db = { ak: { lvl: 40, canAttack: false, apiLvl: 54, deny: 'Epic Boss нижче дозволеного рівня.', alive: true, apiT: Date.now() },
      core: { lvl: 50, canAttack: true, alive: true, apiT: Date.now(), col: 1, adena: 0, verdict: { v: 'strong', why: 'спецудар 60%' } },
      orfen: { lvl: 50, canAttack: true, alive: true, apiT: Date.now(), col: 1, adena: 0, verdict: { v: 'ok', why: 'ок' } },
      zaken: { lvl: 60, canAttack: true, alive: true, apiT: Date.now(), col: 1, adena: 0, verdict: { v: 'unknown', why: 'нет цифр' } },
      baium: { lvl: 75, canAttack: true, alive: true, apiT: Date.now(), col: 1, adena: 0, verdict: { v: 'ok', why: 'ок' } } };
    const m = mk({ cfg: { epicCoinDailyMax: 2, epicList: 'ak,core,zaken,baium,orfen' }, rt: { epicDb: clone(db), epicApi: { t: Date.now(), minLvl: 45, charLvl: 54 } } });
    assert.equal(m.E.epicPick()?.k, 'orfen');
    assert.match(m.E.epicPickWhy('ak'), /⛔/); assert.match(m.E.epicPickWhy('core'), /❌/); assert.match(m.E.epicPickWhy('zaken'), /❔/); assert.match(m.E.epicPickWhy('baium'), /выше героя/);
    m.env.rt.epicDb.orfen.alive = false; assert.equal(m.E.epicPick(), null, 'fresh «dead» from the server is excluded');
    // метки /game/map/spawns (в них нет isAlive — сервер показывает и убитых) эпика живым не делают
    assert.doesNotMatch(read('modules/mobfarm.js'), /epicDb|epicSeenNear/);
    m.env.cfg.epicCoinDailyMax = 0; m.env.rt.epicDb.orfen.alive = true;
    assert.equal(m.E.epicPick(), null, 'CoL limit 0, no free route — not picked'); assert.match(m.E.epicPickWhy('orfen'), /лимит Coin of Luck = 0/);
    m.setDoc(docOf(pin)); assert.equal(m.E.epicPick()?.k, 'orfen', 'on this map — free route');
    console.log('PASS T8: pick — level / strong / unknown / above hero+10 / dead excluded, CoL 0 without free route excluded, epic on this map picked');
  }
  // ---------- P0-8: платный «Повний баф» во время эпика — только в пределах лимита Coin of Luck ----------
  {
    // заход разрешён (живой по свежему ответу, «по силам», дорога выбрана) — тогда решает только лимит CoL
    const m = mk({ rt: { epic: { step: 'prep', k: 'orfen', route: 'page' }, epicDb: okDb(), rbStats: okStats() } });
    assert.equal(m.E.epicBuffCol(), false, 'limit 0 → free set');
    m.env.cfg.epicCoinDailyMax = 20; assert.equal(m.E.epicBuffCol(), true);
    const at = await m.E.epicBuffPay('mage'); assert.ok(at > 0, 'reservation time'); assert.equal(m.env.rt.epicTpBudget[0].kind, 'buff'); assert.equal(m.env.rt.epicDb?.orfen?.paidN || 0, 0, 'buff is not a paid entry');
    assert.equal(await m.E.epicBuffRelease(at, 'Недостатньо Coin of Luck'), true); assert.equal(m.env.rt.epicTpBudget.length, 0, 'explicit refusal → released');
    m.env.cfg.epicMode = false; assert.equal(m.E.epicBuffCol(), null, 'epic mode off — player choice as before'); m.env.cfg.epicMode = true;
    const hud = { querySelectorAll: () => [] };      // шапка с баффами есть, баффов нет — набор нужен
    const benv = { cfg: { townBuffSet: 'mage', epicMode: true }, rt: { epic: { step: 'fight', k: 'orfen' } }, TB_KEYS: { basic: [1068], mage: [1059] }, $q: s => s === '#l2-hud-active-buffs' ? hud : null,
      setRt: async () => {}, rec() {}, faCost: () => 1, epicBuffCol: () => false };
    const sbb = { console, Date, Math, JSON, document: { querySelectorAll: () => [] }, location: { pathname: '/map.html' } }; sbb.globalThis = sbb; vm.runInNewContext(read('modules/buffs.js'), sbb);
    const B = sbb.L2V7Factories.buffs(benv);
    const need = B.townBuffNeed();
    assert.equal(need?.set, 'basic', 'paid set downgraded to basic during an epic: ' + JSON.stringify(need));
    benv.epicBuffCol = () => null; assert.equal(B.townBuffNeed()?.set, 'mage', 'RB / outside an epic — player choice');
    const buffs = read('modules/buffs.js');
    assert.match(buffs, /if \(set !== 'basic' && env\.epicBuffCol\?\.\(\) === false\) set = 'basic';/);
    assert.match(buffs, /if \(set !== 'basic'\) \{ const p = await env\.epicBuffPay\?\.\(set\);/);
    assert.match(buffs, /const bossOn = !!\(env\.cfg\.rbMode \|\| env\.cfg\.rbHuntMode \|\| \(env\.cfg\.epicMode && env\.rt\.epic\?\.k && env\.rt\.epic\.step !== 'pick'\)\);\s+let H = \{\}; if \(bossOn\)/, 'Noblesse: both the HUD gate and the want');
    console.log('PASS P0-8/P2-3: paid town set during an epic only within the CoL limit (incl. restore/revive — state-derived), Noblesse in epics');
  }
  // ---------- P0-9: магазин не покупает за Coin of Luck ----------
  {
    const shop = price => `<div><span class="l2-gm-shop-adena__amount">50 000 000</span><button class="l2-gm-shop-pager-btn" disabled=""></button><button class="l2-gm-shop-pager-btn" disabled=""></button>
      <div class="l2-gm-shop-row l2-gm-shop-row--grade-b"><span class="l2-gm-shop-name">Avadon Circlet</span><span class="l2-gm-shop-price">${price}</span><button class="l2-gm-shop-buy">Купити</button></div></div>`;
    for (const [price, col] of [['30 Coin of Luck', true], ['<img alt="Coin of Luck" src="/icons/col.png"> 30', true], ['1 200 аден', false]]) {
      const d = docOf(shop(price)), fired = [];
      const sbe = { console, Date, Math, JSON, document: d, location: { pathname: '/gm-shop.html' } }; sbe.globalThis = sbe; vm.runInNewContext(read('modules/economy.js'), sbe);
      const Ec = sbe.L2V7Factories.economy({ cfg: { shopReserve: 200000, shopMaxSpend: 2000000 }, rt: {}, $q: s => d.querySelector(s), waitX: async f => f() || null, sleep: async () => {}, rnd: () => 0,
        fire: el => { fired.push(el); return true; }, shown: el => !!el, setVal() {}, rec() {}, setRt: async () => {} });
      const r = await Ec.shopBuyOne({ name: /Avadon Circlet/i, key: 'x' }, 1);
      if (col) { assert.equal(r.ok, false); assert.match(r.why, /Coin of Luck/); assert.ok(!fired.some(e => /l2-gm-shop-buy/.test(e.className)), 'Buy not pressed: ' + price); }
      else assert.ok(fired.some(e => /l2-gm-shop-buy/.test(e.className)), 'adena item is bought as before');
    }
    console.log('PASS P0-9: shop never buys items priced in Coin of Luck (text or currency icon); adena items as before');
  }
  // ---------- P0-4: строка списка (снимок 75dac78f) ----------
  {
    const m = mk({ doc: docOf(pageHtml), path: '/epic-bosses.html', search: '?page=1' });
    const rows = m.E.epicRowsParse();
    assert.equal(Object.keys(rows).length, 8);
    assert.equal(rows.ak.deny, 'Epic Boss нижче дозволеного рівня.', 'hint in the sibling .l2-rb-row__actions is read');
    assert.equal(rows.ak.name, 'Королева Муравьев'); assert.equal(rows.orfen.deny, '');
    assert.deepEqual(['ak', 'orfen', 'core', 'zaken', 'baium', 'antharas', 'valakas', 'frintezza'].map(k => rows[k].respH), [12, 12, 12, 36, 60, 72, 240, 60]);
    assert.equal(rows.frintezza.lvl, 90); assert.ok(Object.values(rows).every(r => r.alive === false && r.priceUnit === 'Coin of Luck' && r.price === 1 && r.tp));
    assert.equal(m.E.epicTpBtn('orfen').className, 'l2-rb-row__tp');
    // скрытая подсказка — не запрет; скрытый пейджер «1 / 1» не нажимаем
    const hid = mk({ doc: docOf(pageHtml.replace('<span class="l2-rb-row__attack-hint">', '<span class="l2-rb-row__attack-hint" hidden="">')), path: '/epic-bosses.html' });
    assert.equal(hid.E.epicRowsParse().ak.deny, '');
    await m.E.epicListScan();
    assert.ok(!m.fires.some(e => e.id === 'rb-pager-next'), 'hidden pager is not clicked'); assert.equal(m.env.rt.epicDb.ak.deny, 'Epic Boss нижче дозволеного рівня.');
    // окно босса на странице эпиков: #rb-modal-stats
    const sbr = { console, Date, Math, JSON, document: docOf(pageHtml), location: { pathname: '/epic-bosses.html' } }; sbr.globalThis = sbr; vm.runInNewContext(raidSrc, sbr);
    const st = sbr.L2V7Factories.raid({ cfg: {}, rt: {} }).rbModalStats();
    assert.deepEqual([st.hp, st.patk, st.matk, st.mdef, st.exp], [429898, 3150, 2562, 1823, 1179536]);
    console.log('PASS P0-4: .l2-rb-row parse (deny from the sibling hint, clean names, respawn hours, CoL unit), hidden hint/pager ignored, #rb-modal-stats');
  }
  // ---------- T9: исходники ----------
  {
    // 8.0.3 (fx-farm): полный список — epicNetList (bosses из поля eb hook.js, без обрезки до 8); поведение — в v803-zone.test.js
    assert.match(content, /\{ const eb = epicNetList\(d, path\);\s+if \(eb\) try \{ L2V7Modules\.epics\.epicApiNote\(eb, 'page'\)/);
    assert.match(content, /const m = path\.match\(\/\^\\\/game\\\/spawn\\\/\(l2dop_rb_\\d\+\)\\\/info\$\/\);\s+if \(m && d\.res\?\.stats\?\.maxHp > 0 && !d\.res\.error\) try \{ L2V7Modules\.raid\.rbInfoNote\(m\[1\], d\.res, 'page'\)/);
    assert.match(content, /d\.method === 'POST' && \/\\\/teleport\(\\\/\|\$\|\\\?\)\/\.test\(path\)/, 'teleport detector matches …/teleport too');
    { const tpRe = vm.runInNewContext(content.match(/d\.method === 'POST' && (\/.+?\/)\.test\(path\)/)[1]);
      assert.ok(['/game/raid-boss/teleport', '/game/epic-boss/teleport', '/game/epic-boss/teleport/29014'].every(p => tpRe.test(p)) && !tpRe.test('/game/teleports'), 'teleport path matcher'); }
    assert.match(content, /if \(rt\.epicScanReq\) \{ if \(fishNow\(\) \|\| isBattle\(\)\) L2V7Modules\.epics\.epicScanAll\('по кнопке'\)\.catch\(\(\) => \{\}\); else \{ await L2V7Modules\.epics\.epicScanAll\('по кнопке'\); return true; \} \}/, 'scan runs in the background on the battle page too (chain)');
    assert.match(content, /if \(epicOn\(\)\) L2V7Modules\.epics\.epicPollTick\(\)\.catch\(\(\) => \{\}\);/);
    assert.match(content, /once\('epicCol803', /); assert.match(content, /once\('epicDeaths803', \(\) => \{ if \(\+C\('epicMaxDeaths'\) === 10\) cf\.epicMaxDeaths = 3; \}\);/);
    const def = content.slice(content.indexOf('const DEF_CFG = {'), content.indexOf('\n', content.indexOf('const DEF_CFG = {')));
    for (const kv of ['epicCoinPerBoss: 1', 'epicCoinKeep: 0', 'epicMaxFightMin: 0', 'epicMaxRetreats: 8', 'epicMaxDeaths: 5', 'epicCoinDailyMax: 0']) assert.ok(def.includes(kv), kv);
    assert.match(content, /\{ k: 'frintezza', lvl: 90,/);
    const html = read('popup.html'), popup = read('popup.js'), ui = read('ui-v7.js');
    assert.match(html, /Coin of Luck на эпиков за 24 ч \(0 — НЕ тратить\)/); assert.match(ui, /epicCoinDailyMax:'Coin of Luck — ценная валюта \(донат, немного падает из Old Box и за TvT\)\. Ноль — бот не тратит их никогда/);
    assert.ok(!/0 — без лимита\) <input id="epicCoinDailyMax"/.test(html) && !/Ноль — лимита нет\.',\n\s+epicAdena/.test(ui.replace(/epicAdenaDailyMax:'[^']*'/, '')), 'no stale «0 = no limit» for CoL');
    assert.match(html, /<button id="epicScan"[^>]*>🔄 Проверить эпиков \(бесплатно\)<\/button>/); assert.match(html, /<div id="epicTable" class="zbox">/); assert.match(html, /id="epicSum"/);
    for (const id of ['epicCoinPerBoss', 'epicCoinKeep', 'epicMaxFightMin', 'epicMaxRetreats']) { assert.ok(html.includes(`id="${id}"`), id); assert.ok(popup.includes(`'${id}'`), id); assert.ok(def.includes(id), id); assert.ok(ui.includes(id + ":'"), id); }
    assert.match(popup, /epicMaxDeaths: 5, epicCheck: false/);   // 10.0.5: 3 → 5 (игрок 13.10 00:57)
    const bp = JSON.parse(read('base-profile.json')).cfg;
    assert.deepEqual([bp.epicMaxDeaths, bp.epicCoinDailyMax, bp.epicCoinPerBoss, bp.epicCoinKeep, bp.epicMaxFightMin, bp.epicMaxRetreats], [5, 0, 1, 0, 0, 8]);   // 10.0.5: смертей на эпика 3 → 5, предел боя эпика 30 → 0 (без предела)
    assert.equal((read('base-profile.json').match(/passw|"auth"/gi) || []).length, 0);
    // survival: смерть на эпике считается за его появление; стоп — 2 × «смертей на эпика» (≤20) за час, вне эпика — 3 за 30 мин
    const surv = read('modules/survival.js');
    assert.match(surv, /await env\.epicDbSet\(epicD\.k, \{ deathsLife:/); assert.match(surv, /epicCap = Math\.min\(20, 2 \* Math\.max\(1, \+env\.cfg\.epicMaxDeaths \|\| 5\)\)/);
    assert.match(content, /L2V7Modules\.survival = L2V7Factories\.survival\(\{[^\n]* get epicDbSet\(\) \{ return epicDbSet; \}/);
    console.log('PASS T9: network routing, menu button, migrations, defaults, Frintezza 90, menu labels, base profile without password, survival');
  }
  // ---------- T10: таблица эпиков в меню ----------
  {
    const js = read('popup.js'), a = js.indexOf('function renderEpics(');
    let i = js.indexOf('{', a), depth = 0; for (; i < js.length; i++) { if (js[i] === '{') depth++; else if (js[i] === '}' && --depth === 0) break; }
    const el = {}; const sb = { $: id => (el[id] ||= { textContent: '', innerHTML: '' }), Date, Math, String, Object };
    vm.runInNewContext(js.slice(a, i + 1), sb);
    const { env, E } = mk(); await E.epicApiNote(fx, 'api', Date.now());
    env.rt.epicDb.core.verdict = { v: 'strong', spPct: 48, why: 'спецудар 48 %' };
    sb.renderEpics({ epicDb: env.rt.epicDb, epicApi: env.rt.epicApi, epic: { step: 'pick' } }, { epicCoinDailyMax: 0, epicMode: false });
    const t = el.epicTable.innerHTML;
    assert.match(t, /Королева Муравьёв \(40\)<\/td><td>💀 до ~[^<]+<\/td><td title="[^"]*">⛔ игра не пускает/); assert.match(t, /❌ спецудар 48 %/); assert.match(t, /❔ нет цифр/);
    assert.match(t, /1 CoL — запрещено \(лимит 0\)/); assert.match(el.epicSum.textContent, /Coin of Luck: лимит 0 — не тратить/); assert.match(el.epicSum.textContent, /мин\. уровень босса 45/);
    assert.match(js, /\$\('epicScan'\)\.onclick = async \(\) => \{ try \{ await menuPatch\(\{ epicScanReq: Date\.now\(\) \}\);/);
    console.log('PASS T10: menu table (⛔ Queen Ant, ❌, 💀 until ~, ❔), «лимит 0 — не тратить», scan button → menuPatch({epicScanReq})');
  }
  // ---------- кнопка «Проверить эпиков»: список + цифры всех 8, вердикты, итог в журнал ----------
  {
    const m = mk({ net: u => /epic-bosses/.test(u) ? fx : WEAK, rt: { epicScanReq: Date.now(), rbStats: {} } });
    await m.E.epicScanAll('по кнопке');
    assert.equal(m.calls.filter(u => /spawn\//.test(u)).length, 6, '8.0.3: Орфен и Ядро — встроенные цифры, запрос только за остальными 6'); assert.equal(m.env.rt.epicScanReq, null); assert.ok(m.env.rt.epicScanT);
    assert.ok(Object.values(m.env.rt.epicDb).every(d => d.verdict?.v), 'verdicts for all 8'); assert.ok(m.logs.some(l => /проверка по кнопке: .*игра пускает к боссам от 45 ур\./.test(l)));
    console.log('PASS: «Проверить эпиков» — 1 list + spawn info GETs for the unknown ones (Orfen/Core built in), verdicts for all, summary in the log, request cleared');
  }
  console.log('PASS: all 8.0.3 epic safety tests');
})().catch(e => { console.error(e); process.exit(1); });

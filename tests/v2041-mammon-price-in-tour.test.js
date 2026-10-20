'use strict';
// 20.41 (игрок 20.10 «не покупает С кристаллы»): в туре РБ бот никогда не летал к кузнецу Маммона за ценами → план цели пуст →
// кристаллы C в закупку не попадали. Теперь разовый поход только за ценой (priceOnly) разрешён, пока тур простаивает ещё ≥ 3 мин
// (rt.rbHuntIdle); эпики, бой, обычные походы в туре и цепочка после победы — как раньше.
// Плюс: сырьё Маммона при непрочитанной/устаревшей сумке теперь запускает фоновое чтение сумки (не чаще раза в 5 мин).
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Promise, URLSearchParams,
  location: { pathname: '/map.html', search: '', href: '' }, document: { querySelectorAll: () => [], querySelector: () => null } };
sb.globalThis = sb; vm.runInNewContext(read('modules/mammon.js'), sb); vm.runInNewContext(read('modules/economy.js'), sb);

const GOAL = 910624;
function mk({ mode = 'raid', idle = 0, battle = false, rt = {}, cfg = {} } = {}) {
  const st = { mode, battle, recs: [], status: [] };
  const env = { rt: { char: 'Hero', mmEq: { tattoo: [GOAL, 0] }, rbHuntIdle: idle, ...rt },
    cfg: { mmGoalItem: GOAL, mmGoalLvl: 5, mmOrders: false, mmMailClaim: false, ...cfg },
    on: true, tabOwner: true, leaseEpoch: 1, routeLocation: sb.location,
    autonomyMode: () => st.mode, isBattle: () => st.battle, isFishing: () => false, fishState: () => null, fishNow: () => false, tvtSoon: () => false,
    payments: { blocked: () => false }, setRt: async p => { Object.assign(env.rt, p); return { ok: true }; },
    setStatus: s => st.status.push(s), rec: (...a) => st.recs.push(a.join(' ')), invQty: () => 0, ITEMS: {}, FARM: { res: {} }, $q: () => null };
  return { env, st, M: sb.L2V7Factories.mammon(env) };
}
const now = Date.now();

(async () => {
  // 1. modeFree: тур РБ — только priceOnly и только при простое ≥ 3 мин
  { const { M, env, st } = mk({ idle: now + 10 * 60000 });
    assert.equal(M.modeFree(), false, 'обычный поход в туре РБ запрещён');
    assert.equal(M.modeFree(true), false, 'цепочка после победы в туре — без похода');
    assert.equal(M.modeFree(false, false, true), true, 'за ценой — можно, тур ждёт ещё 10 мин');
    env.rt.rbHuntIdle = now + 60000; assert.equal(M.modeFree(false, false, true), false, 'тур скоро проснётся — нет');
    env.rt.rbHuntIdle = 0; assert.equal(M.modeFree(false, false, true), false, 'тур не простаивает — нет');
    env.rt.rbHuntIdle = now + 10 * 60000; st.battle = true; assert.equal(M.modeFree(false, false, true), false, 'в бою — нет');
    st.battle = false; env.rt.rbGo = { id: 'x' }; assert.equal(M.modeFree(false, false, true), false, 'переход к РБ — нет');
    env.rt.rbGo = null; env.rt.rbSess = { on: true }; assert.equal(M.modeFree(false, false, true), false, 'РБ-сессия — нет');
    env.rt.rbSess = null; st.mode = 'epic'; assert.equal(M.modeFree(false, false, true), false, 'эпики — никогда');
    st.mode = 'farm'; assert.equal(M.modeFree(), true, 'вне тура поведение прежнее');
  }
  // 2. want(): цена неизвестна, вещь у героя → поход к кузнецу помечен priceOnly
  { const { M } = mk({ idle: now + 10 * 60000 });
    const w = M.want(); assert.ok(w, 'есть дело у кузнеца'); assert.equal(w.kind, 'smith'); assert.equal(w.priceOnly, true); assert.ok(!w.up);
  }
  // 3. mmStep: в простое тура создаёт задачу кузнеца, в активном туре — нет
  { const { M, env } = mk({ idle: now + 10 * 60000 });
    assert.equal(await M.mmStep(), true); assert.equal(env.rt.mmJob.kind, 'smith'); assert.equal(env.rt.mmJob.priceOnly, true); assert.ok(!env.rt.mmJob.up);
  }
  { const { M, env } = mk({ idle: 0 });
    assert.equal(await M.mmStep(), false); assert.equal(env.rt.mmJob, undefined, 'тур идёт — к кузнецу не летим');
  }
  { const { M, env } = mk({ mode: 'epic', idle: now + 10 * 60000 });
    assert.equal(await M.mmStep(), false); assert.equal(env.rt.mmJob, undefined, 'эпики — не летим');
  }
  // 4. улучшение (цены известны) в туре даже при простое отдельным походом не идёт
  { const { M, env } = mk({ idle: now + 10 * 60000, rt: { mmSmithOk: { ok: true, id: GOAL, lvl: 0, t: now }, mmCost: { [`${GOAL}:0`]: { a: 1, col: 0, m: [] } } } });
    const w = M.want(); assert.equal(w?.up, true); assert.ok(!w.priceOnly);
    assert.equal(await M.mmStep(), false); assert.equal(env.rt.mmJob, undefined);
  }
  // 5. статус цели подсказывает, когда в туре будет поход за ценой
  { const { M, env } = mk({ idle: 0 }); M.goalNote(); assert.match(env.rt.mmGoalSt || '', /цены неизвестны — узнаю у кузнеца \(в туре РБ — когда тур ждёт РБ/); }

  // 6. economy: сумка неизвестна → фоновое чтение сумки, не чаще раза в 5 мин; свежая сумка — обычная проверка
  { let inv = null, kicks = 0;
    const env = { cfg: { shopAuto: true, shopShots: '1000/5000', shopHp: '300/1000', shopMp: '200/1000' }, rt: { weaponsT: Date.now(), weapons: [{ name: "Sprite's Staff", g: 'B', wt: 'двуруч. дубина', pa: 189, ma: 132, where: 'надето' }] },
      MAGE: '#mage', classWeaponTypes: () => ({ types: ['#mage'] }), BSPS_IDS: { NG: 3947, D: 3948, C: 3949, B: 3950, A: 3951, S: 3952 }, SHOT_IDS: { NG: 1835, D: 1463, C: 1464 },
      combatProfileKind: () => 'mage_summoner', heroLevel: () => 56, GRADE_LV: { NG: 0, D: 20, C: 40, B: 52, A: 61, S: 76 },
      pair: (v, d) => { const m = String(v ?? d).match(/(\d+)\s*\/\s*(\d+)/); return m ? [+m[1], +m[2]] : [0, 0]; },
      qty: () => null, slotsBy: () => [], shotSlot: () => null, invQty: id => inv ? (inv[id] ?? 0) : null, setRt: async () => {}, rec: () => {},
      invRefresh: async () => { kicks++; return {}; },
      mmShopWant: () => [{ key: 'mm1459', label: 'Кристал: ранг C (Маммон)', grade: 'C', sub: 'resources', ids: [1459], mm: [500, 500], name: /Кристал: ранг C/ }] };
    const E = sb.L2V7Factories.economy(env);
    assert.doesNotMatch(E.shopNeedByPanel(), /Кристал/, 'сумка неизвестна — не покупаем вслепую');
    await new Promise(r => setImmediate(r)); assert.equal(kicks, 1, 'запрошено чтение сумки');
    E.shopNeedByPanel(); await new Promise(r => setImmediate(r)); assert.equal(kicks, 1, 'не чаще раза в 5 мин');
    inv = { 1459: 120 }; assert.match(E.shopNeedByPanel(), /Кристал: ранг C \(Маммон\) 120 < 500/, 'свежая сумка — кристаллы в закупке');
    // без invRefresh в env (старые фабрики) — просто пропуск, без ошибки
    const env2 = { ...env, invRefresh: undefined }; inv = null; assert.equal(typeof sb.L2V7Factories.economy(env2).shopNeedByPanel(), 'string');
  }
  // 7. геттеры: invRefresh передан economy в content.js
  { const c = read('content.js'), i = c.indexOf('L2V7Modules.economy = L2V7Factories.economy('), seg = c.slice(i, c.indexOf('\n', i));
    assert.match(seg, /get invRefresh\(\) \{ return invRefresh; \}/); }
  console.log('v2041-mammon-price-in-tour: OK');
})().catch(e => { console.error(e); process.exit(1); });

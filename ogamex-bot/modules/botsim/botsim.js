/* ogamex-bot/modules/botsim/botsim.js — «Бот: симулятор боя». Owner: sim agent. Contract: specs/bot/BOT_CONTRACT.md C4,
 * design: specs/bot/BOT_DESIGN.md §0 (F2-F7) and §4.
 *
 * Pure, deterministic battle / loot / debris / expedition / espionage maths of the GALAXYZ engine (2Moons 1.8 fork).
 * Every formula is an exact port of upstream 2Moons [UPSTREAM]:
 *   includes/classes/missions/functions/calculateAttack.php   -> battle()
 *   includes/classes/missions/functions/calculateSteal.php    -> steal()
 *   includes/classes/missions/MissionCaseAttack.class.php     -> defender units (fleet + defense, missiles excluded), debris, moon chance
 *   includes/classes/missions/MissionCaseExpedition.class.php -> expedition(), expeditionFind()
 *   includes/classes/missions/MissionCaseSpy.class.php        -> spyNeeded()
 * battle()/steal() are checked against the PHP source itself with injected random numbers (tests/bot-sim-php, golden
 * cases in fixtures/bot/sim-golden). Upstream quirks kept on purpose (do not "fix" them):
 *   - attack is randomised per element type (rand(80,120) %), not per unit; losses use rand(0,200) % of the damage ratio;
 *   - rapid fire adds "shots x amount" of the shooter to the OPPOSITE side's amount total while losses are computed
 *     (later elements see a larger max_removePoints);
 *   - a unit type takes no loss when its whole shield (all units) divided by the amount >= the incoming damage;
 *   - 407/408/409 never shoot; defense rebuild rand(56,84) % per defense type at the end (also on a win);
 *   - PHP round() pre-rounds to 15 significant digits (round(28.499999999999996) === 29), ported as phpRound();
 *   - pirate/alien techs in expeditions are min(sender + bonus, 0) (never positive);
 *   - expedition resource find = round(min(free cargo, min(maxFactor, max(200, factor)) * points)) = min(free, sum(M+C)).
 * UMD: browser -> window.OGX.botSim (+ OGX.module 'botsim' when the core is loaded); node -> module.exports.
 * No DOM, no storage, no network. */
(function (root, factory) {
  'use strict';
  const S = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = S;
  if (root && root.OGX) {
    root.OGX.botSim = S;
    if (typeof root.OGX.module === 'function') {
      root.OGX.module({ name: 'botsim', title: 'Бот: симулятор боя', init() {} });
    }
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const MAX_ATTACK_ROUNDS = 6;              // constants.php
  const SPY_DIFFENCE_FACTOR = 1;            // constants.php
  const SPY_VIEW_FACTOR = 1;                // constants.php
  const MISSILES = new Set([502, 503]);
  const NO_SHOOT = new Set([407, 408, 409]); // calculateAttack.php: shield domes never shoot
  const DEFAULT_COMBAT_IDS = [204, 205, 206, 207, 211, 213, 215];

  // ------------------------------------------------------------------ RNG (xmur3 seed hash + sfc32)
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }
  /** Deterministic generator: int(min, max) inclusive like PHP mt_rand/rand, float() in [0,1). */
  function rng(seed) {
    const h = xmur3(String(seed === undefined ? 1 : seed));
    const next = sfc32(h(), h(), h(), h());
    return {
      seed,
      float: next,
      int(min, max) {
        min = Math.ceil(min); max = Math.floor(max);
        if (max < min) { const t = min; min = max; max = t; }
        return min + Math.floor(next() * (max - min + 1));
      },
    };
  }
  function toRng(opts) {
    if (opts && opts.rng && typeof opts.rng.int === 'function') return opts.rng;
    return rng(opts && opts.seed !== undefined ? opts.seed : 1);
  }

  // ------------------------------------------------------------------ PHP number helpers
  function roundHelper(v) { return v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5); }
  /** PHP 8.3 round($v) (places 0, PHP_ROUND_HALF_UP) incl. its pre-rounding to the FP precision (math.c _php_math_round). */
  function phpRound(value) {
    if (!Number.isFinite(value) || value === 0) return value;
    const precisionPlaces = 14 - Math.floor(Math.log10(Math.abs(value)));
    let tmp;
    if (precisionPlaces > 0 && precisionPlaces - 15 < 0) {
      tmp = roundHelper(value * Math.pow(10, precisionPlaces));
      tmp = tmp / Math.pow(10, Math.min(precisionPlaces, 60));
    } else {
      tmp = value;
      if (Math.abs(tmp) >= 1e15) return value;
    }
    return roundHelper(tmp);
  }

  // ------------------------------------------------------------------ catalog / units
  /** node only: evaluates shared/core/08-catalog-data.js (+ 09-catalog.js beside it) in a vm sandbox, returns OGX.catalog. */
  function loadCatalog(file) {
    if (typeof require !== 'function') throw new Error('loadCatalog is node-only');
    const fs = require('fs'); const path = require('path'); const vm = require('vm');
    const sb = { console }; sb.window = sb; sb.OGX = {}; vm.createContext(sb);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sb, { filename: file });
    const lookups = path.join(path.dirname(file), '09-catalog.js');
    if (fs.existsSync(lookups)) vm.runInContext(fs.readFileSync(lookups, 'utf8'), sb, { filename: lookups });
    return sb.OGX.catalog;
  }

  /** UnitTable from the GALAXYZ catalog: prices (level 1), CombatCaps attack/shield, pricelist capacity, rapid fire
   *  rf[target] = shots (2Moons 'sd' of the shooter). hullBase = (M+C)/10 (2Moons ignores 'structural'). */
  function unitTable(catalog) {
    const cat = catalog || (root && root.OGX && root.OGX.catalog);
    if (!cat || !Array.isArray(cat._data)) throw new Error('botSim.unitTable: no catalog');
    const list = cat._data.filter((o) => o && (o.type === 'ship' || o.type === 'defense') && o.price && o.props)
      .slice().sort((a, b) => a.id - b.id);
    const T = {};
    for (const o of list) {
      const metal = +o.price.metal || 0; const crystal = +o.price.crystal || 0; const deuterium = +o.price.deuterium || 0;
      const rf = {};
      for (const [t, s] of Object.entries(o.rapidfire || {})) if (+s) rf[+t] = +s;
      T[o.id] = {
        id: o.id, metal, crystal, deuterium,
        attack: NO_SHOOT.has(o.id) ? 0 : (+o.props.attack || 0),
        shield: +o.props.shield || 0,
        hullBase: (metal + crystal) / 10,
        capacity: +o.props.cargo || 0,
        speed: +o.props.speed || 0, fuel: +o.props.fuel || 0,
        rf,
        isDefense: o.type === 'defense',
        isShip: o.type === 'ship',
      };
    }
    return T;
  }

  let defaultTableCache = null;
  function defaultUnits() {
    if (defaultTableCache) return defaultTableCache;
    if (root && root.OGX && root.OGX.catalog && Array.isArray(root.OGX.catalog._data)) {
      defaultTableCache = unitTable(root.OGX.catalog);
      return defaultTableCache;
    }
    if (typeof require === 'function' && typeof __dirname === 'string') {
      const path = require('path'); const fs = require('fs');
      // source tree: ogx/ogamex-bot/modules/botsim ; suite copy: ogamex-suite/modules/bot/botsim -> both ../../../shared/core
      for (const rel of ['../../../shared/core/08-catalog-data.js', '../../../../shared/core/08-catalog-data.js']) {
        const f = path.resolve(__dirname, rel);
        if (fs.existsSync(f)) { defaultTableCache = unitTable(loadCatalog(f)); return defaultTableCache; }
      }
    }
    throw new Error('botSim: no unit table (pass units)');
  }
  function tableOf(opts) { return (opts && opts.units) || defaultUnits(); }

  /** RF[target] = [[shooter, shots], ...] in table (CombatCaps) order, exactly like calculateAttack builds $RF. */
  const rfCache = new WeakMap();
  function rfIndex(T) {
    let RF = rfCache.get(T);
    if (RF) return RF;
    RF = new Map();
    const ids = Object.keys(T).map(Number).sort((a, b) => a - b);
    for (const e of ids) {
      const sd = T[e].rf || {};
      for (const t of Object.keys(sd)) {
        const shots = +sd[t];
        if (!shots) continue;
        if (!RF.has(+t)) RF.set(+t, []);
        RF.get(+t).push([e, shots]);
      }
    }
    rfCache.set(T, RF);
    return RF;
  }

  const ZERO_RES = () => ({ metal: 0, crystal: 0, deuterium: 0 });
  function res(r) { r = r || {}; return { metal: +r.metal || 0, crystal: +r.crystal || 0, deuterium: +r.deuterium || 0 }; }
  function msuOf(r, rates) {
    const c = rates && rates.c !== undefined ? rates.c : 1.5; const d = rates && rates.d !== undefined ? rates.d : 3;
    return (+r.metal || 0) + (+r.crystal || 0) * c + (+r.deuterium || 0) * d;
  }

  /** Ships object or [[id, n], ...] -> ordered pairs; missiles and non-positive counts dropped. */
  function unitPairs(units, keepOrder) {
    let pairs;
    if (!units) pairs = [];
    else if (Array.isArray(units)) pairs = units.map((p) => [+p[0], +p[1]]);
    else if (typeof Map !== 'undefined' && units instanceof Map) pairs = [...units].map((p) => [+p[0], +p[1]]);
    else pairs = Object.keys(units).map((k) => [+k, +units[k]]);
    pairs = pairs.filter((p) => p[1] > 0 && !MISSILES.has(p[0]));
    if (!keepOrder) pairs.sort((a, b) => a[0] - b[0]);   // ships 202..220 then defense 401..411
    return pairs;
  }
  function pairsToObj(ids, amt) { const o = {}; for (let i = 0; i < ids.length; i++) o[ids[i]] = amt[i]; return o; }

  function sideTechs(side) {
    if (side.bonusPct) {
      const b = side.bonusPct;
      return [1 + (+b.attack || 0) / 100, 1 + (+(b.defense !== undefined ? b.defense : b.defence) || 0) / 100, 1 + (+b.shield || 0) / 100];
    }
    const t = side.tech || {}; const f = side.factor || {};
    return [
      1 + (0.1 * (+t.weapons || 0)) + (+f.Attack || 0),
      1 + (0.1 * (+t.shielding || 0)) + (+f.Defensive || 0),
      1 + (0.1 * (+t.armour || 0)) + (+f.Shield || 0),
    ];
  }
  // bonusPct = GALAXYZ fleetTable «Bonus» [UPSTREAM ShowFleetTablePage:281-283]: attack = 109·10 + Attack·100,
  // defense («defence» icon) = 110·10 + Defensive·100 -> shield multiplier, shield = 111·10 + Shield·100 -> hull multiplier.

  function prepSide(side, T, keepOrder) {
    const pairs = unitPairs(side.units, keepOrder);
    for (const [id] of pairs) if (!T[id]) throw new Error('botSim: unknown unit ' + id);
    return {
      ids: pairs.map((p) => p[0]),
      amt: pairs.map((p) => p[1]),
      start: pairs.map((p) => p[1]),
      techs: sideTechs(side),
    };
  }

  // ------------------------------------------------------------------ battle(): exact port of calculateAttack()
  function battle(opts) {
    const T = tableOf(opts);
    const R = toRng(opts);
    const FleetTF = opts.fleetDebrisPct !== undefined ? +opts.fleetDebrisPct : 30;
    const DefTF = opts.defDebrisPct !== undefined ? +opts.defDebrisPct : 0;
    const keepOrder = !!opts.keepOrder;
    const RF = rfIndex(T);
    const A = (opts.attackers || []).map((s) => prepSide(s, T, keepOrder));
    const D = (opts.defenders || []).map((s) => prepSide(s, T, keepOrder));
    const trace = opts.trace ? [] : null;

    const TRES = { attacker: 0, defender: 0 };
    const ARES = { metal: 0, crystal: 0 }; const DRES = { metal: 0, crystal: 0 };
    const STARTDEF = new Map();
    for (const a of A) for (let k = 0; k < a.ids.length; k++) {
      ARES.metal += T[a.ids[k]].metal * a.amt[k];
      ARES.crystal += T[a.ids[k]].crystal * a.amt[k];
    }
    TRES.attacker = ARES.metal + ARES.crystal;
    for (const d of D) for (let k = 0; k < d.ids.length; k++) {
      const e = d.ids[k]; const n = d.amt[k];
      if (e < 300) {
        DRES.metal += T[e].metal * n;
        DRES.crystal += T[e].crystal * n;
        TRES.defender += T[e].metal * n;
        TRES.defender += T[e].crystal * n;
      } else {
        STARTDEF.set(e, (STARTDEF.get(e) || 0) + n);
        TRES.defender += T[e].metal * n;
        TRES.defender += T[e].crystal * n;
      }
    }

    let attackAmountTotal = 0; let defenseAmountTotal = 0; let rounds = 0;
    for (let ROUNDC = 0; ROUNDC <= MAX_ATTACK_ROUNDS; ROUNDC++) {
      let attackDamageTotal = 0; let defenseDamageTotal = 0;
      attackAmountTotal = 0; defenseAmountTotal = 0;
      const attackAmount = []; const defenseAmount = [];
      const attArr = []; const defArr = [];   // per fleet: Map(element -> { def, shield, att })

      for (let f = 0; f < A.length; f++) {
        const a = A[f]; const [attTech, defTech, shieldTech] = a.techs;
        attackAmount[f] = 0;
        const m = new Map();
        for (let k = 0; k < a.ids.length; k++) {
          const e = a.ids[k]; const amount = a.amt[k]; const u = T[e];
          const thisAtt = amount * (u.attack) * attTech * (R.int(80, 120) / 100);
          const thisDef = amount * (u.shield) * defTech;
          const thisShield = amount * (u.metal + u.crystal) / 10 * shieldTech;
          m.set(e, { def: thisDef, shield: thisShield, att: thisAtt });
          attackDamageTotal += thisAtt;
          attackAmount[f] += amount;
          attackAmountTotal += amount;
        }
        attArr[f] = m;
      }
      for (let f = 0; f < D.length; f++) {
        const d = D[f]; const [attTech, defTech, shieldTech] = d.techs;
        defenseAmount[f] = 0;
        const m = new Map();
        for (let k = 0; k < d.ids.length; k++) {
          const e = d.ids[k]; const amount = d.amt[k]; const u = T[e];
          let thisAtt = amount * (u.attack) * attTech * (R.int(80, 120) / 100);
          const thisDef = amount * (u.shield) * defTech;
          const thisShield = amount * (u.metal + u.crystal) / 10 * shieldTech;
          if (NO_SHOOT.has(e)) thisAtt = 0;
          m.set(e, { def: thisDef, shield: thisShield, att: thisAtt });
          defenseDamageTotal += thisAtt;
          defenseAmount[f] += amount;
          defenseAmountTotal += amount;
        }
        defArr[f] = m;
      }
      if (trace) trace.push({ round: ROUNDC, attackers: A.map((a) => pairsToObj(a.ids, a.amt.slice())), defenders: D.map((d) => pairsToObj(d.ids, d.amt.slice())) });
      rounds = ROUNDC;
      if (ROUNDC >= MAX_ATTACK_ROUNDS || defenseAmountTotal <= 0 || attackAmountTotal <= 0) break;

      const attackPct = attackAmount.map((x) => x / attackAmountTotal);
      const defensePct = defenseAmount.map((x) => x / defenseAmountTotal);

      // attacker losses (defenseAmountTotal is mutated by rapid fire, as upstream)
      const attackerN = [];
      for (let f = 0; f < A.length; f++) {
        const a = A[f]; const out = [];
        for (let k = 0; k < a.ids.length; k++) {
          const e = a.ids[k]; const amount = a.amt[k];
          if (amount <= 0) { out[k] = 0; continue; }
          let moc = amount * (defenseDamageTotal * attackPct[f]) / attackAmount[f];
          const rfl = RF.get(e);
          if (rfl) {
            for (const [shooter, shots] of rfl) {
              for (let fID = 0; fID < D.length; fID++) {
                const r = defArr[fID].get(shooter);
                if (!r || !r.att || attackAmount[f] <= 0) continue;
                moc += r.att * shots / (amount / attackAmount[f] * attackPct[f]);
                defenseAmountTotal += amountOf(D[fID], shooter) * shots;
              }
            }
          }
          const ad = attArr[f].get(e);
          if ((ad.def / amount) >= moc) { out[k] = phpRound(amount); continue; }
          const maxRemove = Math.floor(amount * defenseAmountTotal / attackAmount[f] * attackPct[f]);
          moc -= Math.min(ad.def, moc);
          const remove = Math.max(Math.min(maxRemove, amount * Math.min(moc / ad.shield * (R.int(0, 200) / 100), 1)), 0);
          out[k] = Math.max(Math.ceil(amount - remove), 0);
        }
        attackerN[f] = out;
      }
      // defender losses (attackAmountTotal mutated)
      const defenderN = [];
      for (let f = 0; f < D.length; f++) {
        const d = D[f]; const out = [];
        for (let k = 0; k < d.ids.length; k++) {
          const e = d.ids[k]; const amount = d.amt[k];
          if (amount <= 0) { out[k] = 0; continue; }
          let moc = amount * (attackDamageTotal * defensePct[f]) / defenseAmount[f];
          const rfl = RF.get(e);
          if (rfl) {
            for (const [shooter, shots] of rfl) {
              for (let fID = 0; fID < A.length; fID++) {
                const r = attArr[fID].get(shooter);
                if (!r || !r.att || defenseAmount[f] <= 0) continue;
                moc += r.att * shots / (amount / defenseAmount[f] * defensePct[f]);
                attackAmountTotal += amountOf(A[fID], shooter) * shots;
              }
            }
          }
          const dd = defArr[f].get(e);
          if ((dd.def / amount) >= moc) { out[k] = phpRound(amount); continue; }
          const maxRemove = Math.floor(amount * attackAmountTotal / defenseAmount[f] * defensePct[f]);
          moc -= Math.min(dd.def, moc);
          const remove = Math.max(Math.min(maxRemove, amount * Math.min(moc / dd.shield * (R.int(0, 200) / 100), 1)), 0);
          out[k] = Math.max(Math.ceil(amount - remove), 0);
        }
        defenderN[f] = out;
      }
      for (let f = 0; f < A.length; f++) A[f].amt = attackerN[f].map(phpRound);
      for (let f = 0; f < D.length; f++) D[f].amt = defenderN[f].map(phpRound);
    }

    let won;
    if (attackAmountTotal <= 0 && defenseAmountTotal > 0) won = 'r';
    else if (attackAmountTotal > 0 && defenseAmountTotal <= 0) won = 'a';
    else won = 'w';

    // debris (CDR) + defense rebuild
    for (const a of A) for (let k = 0; k < a.ids.length; k++) {
      const u = T[a.ids[k]]; const n = a.amt[k];
      TRES.attacker -= u.metal * n;
      TRES.attacker -= u.crystal * n;
      ARES.metal -= u.metal * n;
      ARES.crystal -= u.crystal * n;
    }
    const DRESDefs = { metal: 0, crystal: 0 };
    const rebuilt = D.map(() => ({}));
    for (let f = 0; f < D.length; f++) {
      const d = D[f];
      for (let k = 0; k < d.ids.length; k++) {
        const e = d.ids[k]; const u = T[e]; const n = d.amt[k];
        if (e < 300) {
          DRES.metal -= u.metal * n;
          DRES.crystal -= u.crystal * n;
          TRES.defender -= u.metal * n;
          TRES.defender -= u.crystal * n;
        } else {
          TRES.defender -= u.metal * n;
          TRES.defender -= u.crystal * n;
          const lost = STARTDEF.get(e) - n;
          const giveback = phpRound(lost * (R.int(56, 84) / 100));
          d.amt[k] += giveback;
          if (giveback) rebuilt[f][e] = giveback;
          DRESDefs.metal += u.metal * (lost - giveback);
          DRESDefs.crystal += u.crystal * (lost - giveback);
        }
      }
    }
    ARES.metal = Math.max(ARES.metal, 0); ARES.crystal = Math.max(ARES.crystal, 0);
    DRES.metal = Math.max(DRES.metal, 0); DRES.crystal = Math.max(DRES.crystal, 0);
    TRES.attacker = Math.max(TRES.attacker, 0); TRES.defender = Math.max(TRES.defender, 0);
    const debAttMet = ARES.metal * (FleetTF / 100);
    const debAttCry = ARES.crystal * (FleetTF / 100);
    const debDefMet = (DRES.metal * (FleetTF / 100)) + (DRESDefs.metal * (DefTF / 100));
    const debDefCry = (DRES.crystal * (FleetTF / 100)) + (DRESDefs.crystal * (DefTF / 100));
    const debris = { metal: debAttMet + debDefMet, crystal: debAttCry + debDefCry };

    const lostValue = { attacker: ZERO_RES(), defender: ZERO_RES() };
    const sideOut = (s, who) => {
      const after = {}; const lost = {};
      for (let k = 0; k < s.ids.length; k++) {
        const e = s.ids[k]; after[e] = s.amt[k];
        const l = s.start[k] - s.amt[k];
        if (l > 0) {
          lost[e] = l;
          lostValue[who].metal += T[e].metal * l; lostValue[who].crystal += T[e].crystal * l; lostValue[who].deuterium += T[e].deuterium * l;
        }
      }
      return { after, lost };
    };
    const attackersOut = A.map((a) => sideOut(a, 'attacker'));
    const defendersOut = D.map((d, f) => Object.assign(sideOut(d, 'defender'), { rebuilt: rebuilt[f] }));

    // MissionCaseAttack: moon chance only for a planet (type 1) without a moon
    const moonFactor = opts.moonFactor !== undefined ? +opts.moonFactor : 1;
    const moonMax = opts.moonMax !== undefined ? +opts.moonMax : 20;
    const targetType = opts.targetType !== undefined ? +opts.targetType : 1;
    let moonChance = 0;
    if (targetType === 1 && !opts.hasMoon) moonChance = Math.min(phpRound((debris.metal + debris.crystal) / 100000 * moonFactor), moonMax);

    const out = {
      won, rounds,
      attackers: attackersOut, defenders: defendersOut,
      lostValue, debris, moonChance,
      debrisDetail: { attacker: { metal: debAttMet, crystal: debAttCry }, defender: { metal: debDefMet, crystal: debDefCry } },
      unitLost: { attacker: TRES.attacker, defender: TRES.defender },
      // ordered unit lists as upstream arrays (for the PHP comparison and callers that need the order)
      order: { attackers: A.map((a) => a.ids.map((e, k) => [e, a.amt[k]])), defenders: D.map((d) => d.ids.map((e, k) => [e, d.amt[k]])) },
    };
    if (trace) out.trace = trace;
    return out;
  }
  function amountOf(side, id) { const k = side.ids.indexOf(id); return k < 0 ? 0 : side.amt[k]; }

  // ------------------------------------------------------------------ steal(): calculateSteal() steps 1-5 (simulate)
  function capacityOf(ships, T) {
    let c = 0;
    for (const [id, n] of unitPairs(ships, true)) c += (T[id] ? T[id].capacity : 0) * n;
    return c;
  }
  /** fleets: [{ units, storageFactor, carried }] -> stolen Res (floats), exactly as calculateSteal(..., simulate=true). */
  function stealFleets(fleets, planet, T) {
    let capacity = 0;
    for (const f of fleets) {
      let c = f.capacity !== undefined ? +f.capacity : 0;
      if (f.capacity === undefined) for (const [id, n] of unitPairs(f.units, true)) c += T[id].capacity * n;
      c *= (1 + (+f.storageFactor || 0));
      const car = res(f.carried);
      c -= car.metal; c -= car.crystal; c -= car.deuterium;
      capacity += c;
    }
    const st = ZERO_RES();
    if (capacity <= 0) return st;
    const p = res(planet);
    st.metal = Math.min(capacity / 3, p.metal / 2); capacity -= st.metal;
    st.crystal = Math.min(capacity / 2, p.crystal / 2); capacity -= st.crystal;
    st.deuterium = Math.min(capacity, p.deuterium / 2); capacity -= st.deuterium;
    const old = st.metal;
    st.metal += Math.min(capacity / 2, p.metal / 2 - st.metal); capacity -= st.metal - old;
    st.crystal += Math.min(capacity, p.crystal / 2 - st.crystal);
    return st;
  }
  function steal(o) {
    const T = o.units || (o.ships ? defaultUnits() : null);
    return stealFleets([{ units: o.ships, capacity: o.ships ? undefined : (+o.capacity || 0), storageFactor: o.storageFactor, carried: o.carried }], o.planet, T);
  }
  /** Smallest integer capacity whose steal() takes metal/2, crystal/2 and deuterium/2 (bisection). */
  function minCapacityForLoot(planet) {
    const p = res(planet);
    const half = { metal: p.metal / 2, crystal: p.crystal / 2, deuterium: p.deuterium / 2 };
    const sum = half.metal + half.crystal + half.deuterium;
    if (sum <= 0) return 0;
    const ok = (cap) => {
      const s = stealFleets([{ capacity: cap }], p, null);
      return s.metal >= half.metal - 1e-6 && s.crystal >= half.crystal - 1e-6 && s.deuterium >= half.deuterium - 1e-6;
    };
    let lo = 0; let hi = Math.ceil(1.5 * sum) + 1;
    while (!ok(hi)) hi *= 2;
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (ok(mid)) hi = mid; else lo = mid; }
    return hi;
  }

  // ------------------------------------------------------------------ raid(): multi-run summary
  function pct(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))] : 0; }
  function sortNum(a) { return a.slice().sort((x, y) => x - y); }
  function mean(a) { let s = 0; for (const x of a) s += x; return a.length ? s / a.length : 0; }

  /** fuel = deuterium spent by the raid (converted with rates.d). Debris is reported, not counted in net. */
  function raid(o) {
    const T = tableOf(o);
    const R = toRng(o);
    const runs = Math.max(1, o.runs !== undefined ? +o.runs : 100);
    const rates = Object.assign({ c: 1.5, d: 3 }, o.rates || {});
    const fuelMsu = (+o.fuel || 0) * rates.d;
    const defenders = o.defenders || [o.defender || { units: {} }];
    const att = o.attacker;
    const W = { a: 0, r: 0, w: 0 };
    const aLoss = []; const aLossRes = []; const dLossRes = []; const dm = []; const dc = []; const loot = []; const lootRes = []; const net = [];
    const moon = []; const surv = {}; const survCap = [];
    const planet = res(o.planet);
    for (let i = 0; i < runs; i++) {
      const b = battle({ attackers: [att], defenders, rng: R, units: T, fleetDebrisPct: o.fleetDebrisPct, defDebrisPct: o.defDebrisPct, keepOrder: o.keepOrder, moonFactor: o.moonFactor, moonMax: o.moonMax, targetType: o.targetType, hasMoon: o.hasMoon });
      W[b.won]++;
      const after = b.attackers[0].after;
      const st = b.won === 'a' ? stealFleets([{ units: after, storageFactor: att.storageFactor, carried: att.carried }], planet, T) : ZERO_RES();
      const lm = msuOf(b.lostValue.attacker, rates);
      aLoss.push(lm); aLossRes.push(b.lostValue.attacker); dLossRes.push(b.lostValue.defender);
      dm.push(b.debris.metal); dc.push(b.debris.crystal);
      const lmsu = msuOf(st, rates);
      loot.push(lmsu); lootRes.push(st);
      net.push(lmsu - lm - fuelMsu);
      moon.push(b.moonChance);
      for (const id of Object.keys(after)) surv[id] = (surv[id] || 0) + after[id];
      survCap.push(capacityOf(after, T));
    }
    const meanRes = (arr) => { const r = ZERO_RES(); for (const x of arr) { r.metal += x.metal; r.crystal += x.crystal; r.deuterium += x.deuterium; } r.metal /= arr.length; r.crystal /= arr.length; r.deuterium /= arr.length; r.msu = msuOf(r, rates); return r; };
    const sm = sortNum(dm); const sc = sortNum(dc); const sl = sortNum(loot); const sn = sortNum(net); const sa = sortNum(aLoss);
    const survivors = {}; for (const id of Object.keys(surv)) survivors[id] = surv[id] / runs;
    return {
      runs, win: W.a / runs, draw: W.w / runs, loss: W.r / runs,
      attackerLoss: { mean: meanRes(aLossRes), p90: { msu: pct(sa, 0.9) } },
      defenderLoss: { mean: meanRes(dLossRes) },
      debris: {
        mean: { metal: mean(dm), crystal: mean(dc) },
        p10: { metal: pct(sm, 0.1), crystal: pct(sc, 0.1) },
        p50: { metal: pct(sm, 0.5), crystal: pct(sc, 0.5) },
        p90: { metal: pct(sm, 0.9), crystal: pct(sc, 0.9) },
      },
      loot: { mean: meanRes(lootRes), p10: { msu: pct(sl, 0.1) } },
      net: { mean: mean(net), p10: pct(sn, 0.1) },
      survivors: { mean: survivors, capacityP10: pct(sortNum(survCap), 0.1) },
      moonChance: { mean: mean(moon) },
    };
  }

  // ------------------------------------------------------------------ optimizeRaid()
  function isUndefended(side) { return unitPairs(side && side.units).length === 0; }
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
  function shipsText(ships) { return Object.keys(ships).filter((k) => ships[k] > 0).map((k) => k + '×' + ships[k]).join(', ') || '—'; }

  /** BOT_DESIGN §4.5. Options beyond C4 (all optional): surplusPct (cargo surplus over minCapacityForLoot, default 0;
   *  botfarm passes its own), timeOf(ships) -> roundtrip seconds (score = net / hours, else net), hint { [combatId]: n }
   *  (start of the doubling, e.g. from raid_rules escort tables), fleetDebrisPct/defDebrisPct, units.
   *  Every raid() evaluation with `runs` counts in `tried`; all evaluations share `seed` (common random numbers). */
  function optimizeRaid(o) {
    const T = tableOf(o);
    const rates = Object.assign({ c: 1.5, d: 3 }, o.rates || {});
    const available = Object.assign({}, o.available || {});
    const allow = Object.assign({}, o.maxShips || {});
    const sf = +o.storageFactor || 0;
    const winMin = o.winMin !== undefined ? +o.winMin : 0.99;
    // Aeternum farm (botfarm 0.3.2): a draw keeps the fleet and only loses the loot, so callers may accept a lower WIN share
    // (minWin) as long as a DEFEAT stays rare (maxDefeat). Defaults keep the old rule: win >= winMin (=> defeat <= 1 - winMin).
    const minWin = o.minWin !== undefined ? +o.minWin : winMin;
    const maxDefeat = o.maxDefeat !== undefined ? +o.maxDefeat : 1 - winMin;
    const winOk = (sim) => sim.win >= minWin && sim.loss <= maxDefeat + 1e-12;
    const maxLossShare = o.maxLossShare !== undefined ? +o.maxLossShare : 0.25;
    const runs = o.runs !== undefined ? +o.runs : 60;
    const seed = o.seed !== undefined ? o.seed : 1;
    const surplus = (o.surplusPct !== undefined ? +o.surplusPct : 0) / 100;
    // loot carriers: John's rule — Battle Transporters (217) only, no fallback ship; callers may still pass their own list
    const cargoIds = (o.cargoIds || [(root && root.OGX && root.OGX.catalog && root.OGX.catalog.transportShip) || 217]).filter((id) => T[id] && T[id].capacity > 0);
    const combatIds = (o.combatIds || DEFAULT_COMBAT_IDS).filter((id) => T[id] && T[id].attack > 0);
    const fuelOf = typeof o.fuelOf === 'function' ? o.fuelOf : () => 0;
    const timeOf = typeof o.timeOf === 'function' ? o.timeOf : null;   // ships -> roundtrip seconds
    const att0 = o.attackerTech || {};
    const limit = (id) => (+available[id] || 0) + (+allow[id] || 0);
    const planet = res(o.planet);
    const needCap = minCapacityForLoot(planet) * (1 + surplus);
    const halves = (planet.metal + planet.crystal + planet.deuterium) / 2;
    let tried = 0;

    const side = (ships) => Object.assign({ units: ships, storageFactor: sf }, att0.bonusPct ? { bonusPct: att0.bonusPct } : { tech: att0.tech || att0, factor: att0.factor });
    // confirmation pass: the bisection runs few battles per variant (60 runs cannot tell 0.955 from 0.99), so the chosen
    // fleet is re-simulated with more runs and an independent seed; below winMin it is enlarged and confirmed again.
    const confirmRuns = o.confirmRuns !== undefined ? Math.max(0, +o.confirmRuns) : Math.min(1000, Math.max(400, runs * 5));
    const confirmZ = o.confirmZ !== undefined ? +o.confirmZ : 1.645;
    // one-sided 95 % Wilson lower bound of the win share (z = confirmZ); all runs won always passes
    const winLow = (sim) => {
      const n = sim.runs; const p = sim.win; if (p >= 1) return 1;
      const z2 = confirmZ * confirmZ;
      return (p + z2 / (2 * n) - confirmZ * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
    };
    const evalShips = (ships, countTry = true, nRuns, seedX) => {
      if (countTry) tried++;
      const fuel = +fuelOf(ships) || 0;
      const sim = raid({ attacker: side(ships), defender: o.defender, planet, runs: nRuns || (countTry ? runs : 1), seed: seedX !== undefined ? seedX : seed, units: T, rates, fuel, fleetDebrisPct: o.fleetDebrisPct, defDebrisPct: o.defDebrisPct,
        targetType: o.targetType, hasMoon: o.hasMoon, moonFactor: o.moonFactor, moonMax: o.moonMax });
      const hours = timeOf ? Math.max(1, +timeOf(ships) || 0) / 3600 : 1;
      return { ships, sim, fuel, hours, score: sim.net.mean / hours };
    };
    const missingOf = (ships) => { const m = {}; for (const id of Object.keys(ships)) { const d = ships[id] - (+available[id] || 0); if (d > 0) m[id] = d; } return m; };
    const cargoCount = (id, extraCap) => Math.max(0, Math.ceil((needCap - extraCap) / (T[id].capacity * (1 + sf))));

    // undefended: cargo only, no combat simulation (tried 0)
    if (isUndefended(o.defender)) {
      let best = null;
      for (const c of cargoIds) {
        if (limit(c) <= 0) continue;
        const n = Math.min(cargoCount(c, 0), limit(c));
        if (n <= 0) continue;
        const cand = evalShips({ [c]: n }, false);
        if (!best || cand.score > best.score) best = cand;
      }
      if (!best) return { ok: false, ships: {}, missing: {}, sim: null, why: 'Нет транспортов для вывоза ресурсов', tried: 0 };
      const ok = best.sim.loot.mean.msu > 0 && best.sim.net.mean > 0;
      const full = stealOk(best, halves, rates);
      return {
        ok, ships: best.ships, missing: missingOf(best.ships), sim: best.sim, tried: 0,
        why: (ok ? 'Цель без защиты: только транспорты ' : 'Цель без защиты, но рейд невыгоден: ') + shipsText(best.ships) +
          `, добыча ≈ ${fmt(best.sim.loot.mean.msu)} МСУ` + (full ? '' : ' (транспортов меньше, чем нужно для половины ресурсов)') +
          (ok ? '' : `, итог ${fmt(best.sim.net.mean)} МСУ`),
      };
    }

    const cands = []; const rejects = [];
    const cargoOptions = cargoIds.filter((c) => limit(c) > 0);
    if (!cargoOptions.length) cargoOptions.push(null);
    for (const c of cargoOptions) {
      for (const e of combatIds) {
        const lim = limit(e);
        if (lim <= 0) continue;
        const build = (n, cn) => { const s = {}; s[e] = n; if (c !== null && cn > 0) s[c] = (s[c] || 0) + cn; return s; };
        const cargoFor = (n) => (c === null ? 0 : Math.min(limit(c) - (c === e ? n : 0), cargoCount(c, T[e].capacity * (1 + sf) * n)));
        const winAt = (n) => evalShips(build(n, cargoFor(n)));
        // doubling
        let hint = Math.max(1, Math.min(lim, Math.floor(+((o.hint || {})[e]) || 1)));
        let hiN = hint; let hiR = winAt(hiN);
        let loN = 0;
        while (!winOk(hiR.sim) && hiN < lim) { loN = hiN; hiN = Math.min(lim, hiN * 2); hiR = winAt(hiN); }
        if (!winOk(hiR.sim)) { rejects.push(`${e}: даже ${hiN} шт. — победа ${(hiR.sim.win * 100).toFixed(0)} %`); continue; }
        // bisection on win probability
        while (hiN - loN > 1) {
          const mid = Math.floor((loN + hiN) / 2);
          const r = winAt(mid);
          if (winOk(r.sim)) { hiN = mid; hiR = r; } else loN = mid;
        }
        // cargo re-check with survivors (p10 capacity), at most 3 iterations
        let cur = hiR;
        if (c !== null) {
          let cn = cur.ships[c] || 0;
          for (let it = 0; it < 3; it++) {
            const capP10 = cur.sim.survivors.capacityP10 * (1 + sf);
            const got = stealFleets([{ capacity: capP10 }], planet, null);
            const gotSum = got.metal + got.crystal + got.deuterium;
            if (gotSum >= 0.95 * halves) break;
            const deficit = needCap - capP10;
            const add = Math.max(1, Math.ceil(deficit / (T[c].capacity * (1 + sf))));
            const maxC = limit(c) - (c === e ? hiN : 0);
            if (cn >= maxC) break;
            cn = Math.min(maxC, cn + add);
            cur = evalShips(build(hiN, cn));
          }
        }
        if (winOk(cur.sim) && confirmRuns > 0) {
          let n = hiN;
          let conf = null;
          for (let k = 0; k < 10; k++) {
            conf = evalShips(cur.ships, true, confirmRuns, String(seed) + ':confirm' + k);
            conf.confirmed = true;
            conf.winLow = winLow(conf.sim);
            if ((conf.winLow >= minWin && conf.sim.loss <= maxDefeat + 1e-12) || n >= lim) break;
            n = Math.min(lim, Math.max(n + 1, Math.ceil(n * 1.25)));
            const cn = c === null ? 0 : Math.max(cur.ships[c] && c !== e ? cur.ships[c] : 0, cargoFor(n));
            cur = { ships: build(n, Math.min(cn, c === null ? 0 : limit(c) - (c === e ? n : 0))) };
          }
          cur = conf;
          hiN = n;
        }
        const s = cur.sim;
        if (!winOk(s) || (cur.confirmed && cur.winLow < minWin)) { rejects.push(`${e}: с транспортами победа ${(s.win * 100).toFixed(0)} %` + (cur.confirmed ? ` (проверка ${s.runs} боёв)` : '')); continue; }
        if (s.attackerLoss.mean.msu > maxLossShare * s.loot.mean.msu) { rejects.push(`${e}: потери ${fmt(s.attackerLoss.mean.msu)} > ${Math.round(maxLossShare * 100)} % добычи`); continue; }
        if (s.net.mean <= 0) { rejects.push(`${e}: итог ${fmt(s.net.mean)} МСУ ≤ 0`); continue; }
        cands.push(cur);
      }
    }
    // mixed fleets (o.mixed): every AVAILABLE combat ship scaled by k/1000 together — a single type is often too few on its own,
    // while the whole hangar wins. Variant 'need': cargo = what the loot needs; variant 'all': every available cargo ship too
    // (2Moons spreads the damage by unit COUNT, so the many Battle Transporters 217 soak shots for the warships). Own ships only.
    if (o.mixed) {
      const avC = combatIds.filter((e) => (+available[e] || 0) > 0);
      if (avC.length) {
        for (const c of cargoOptions) {
          for (const mode of c === null ? ['need'] : ['need', 'all']) {
            const avCargo = c === null ? 0 : (+available[c] || 0);
            if (mode === 'all' && !(avCargo > 0)) continue;
            const build = (k) => {
              const s = {}; let cap = 0;
              for (const e of avC) { const n = Math.max(1, Math.floor((+available[e]) * k / 1000)); s[e] = n; cap += T[e].capacity * (1 + sf) * n; }
              if (c !== null) {
                const want = mode === 'all' ? avCargo : Math.min(avCargo, cargoCount(c, cap));
                if (want > 0) s[c] = (s[c] || 0) + want;
              }
              return s;
            };
            const label = 'смешанный' + (mode === 'all' ? ' + все ' + c : '');
            let hiK = 1000; let hiR = evalShips(build(hiK));
            if (!winOk(hiR.sim)) { rejects.push(`${label}: весь флот — победа ${(hiR.sim.win * 100).toFixed(0)} %`); continue; }
            let loK = 0;
            while (hiK - loK > 8) {
              const mid = Math.floor((loK + hiK) / 2);
              const r = evalShips(build(mid));
              if (winOk(r.sim)) { hiK = mid; hiR = r; } else loK = mid;
            }
            // two sizes: the smallest that passes (fewest ships away) and the whole hangar (a draw costs the loot, so a higher win
            // share is often worth more than the ships it keeps home); the score (net per hour) picks
            for (const startK of hiK < 1000 ? [hiK, 1000] : [1000]) {
              let cur = startK === hiK ? hiR : evalShips(build(1000));
              if (confirmRuns > 0) {
                let k = startK; let conf = null;
                for (let it = 0; it < 10; it++) {
                  conf = evalShips(build(k), true, confirmRuns, String(seed) + ':mix' + mode + it);
                  conf.confirmed = true; conf.winLow = winLow(conf.sim);
                  if ((conf.winLow >= minWin && conf.sim.loss <= maxDefeat + 1e-12) || k >= 1000) break;
                  k = Math.min(1000, Math.max(k + 8, Math.ceil(k * 1.25)));
                }
                cur = conf;
              }
              const s = cur.sim;
              if (!winOk(s) || (cur.confirmed && cur.winLow < minWin)) { rejects.push(`${label}: победа ${(s.win * 100).toFixed(0)} %` + (cur.confirmed ? ` (проверка ${s.runs} боёв)` : '')); continue; }
              if (s.attackerLoss.mean.msu > maxLossShare * s.loot.mean.msu) { rejects.push(`${label}: потери ${fmt(s.attackerLoss.mean.msu)} > ${Math.round(maxLossShare * 100)} % добычи`); continue; }
              if (s.net.mean <= 0) { rejects.push(`${label}: итог ${fmt(s.net.mean)} МСУ ≤ 0`); continue; }
              cur.mixed = mode;
              cands.push(cur);
            }
          }
        }
      }
    }
    if (!cands.length) {
      return { ok: false, ships: {}, missing: {}, sim: null, tried, why: 'Нет подходящего состава: ' + (rejects.join('; ') || 'нет боевых кораблей') };
    }
    cands.sort((a, b) => b.score - a.score);
    const best = cands[0];
    const missing = missingOf(best.ships);
    const s = best.sim;
    return {
      ok: true, ships: best.ships, missing, sim: s, tried, mixed: best.mixed || null,
      why: `Состав ${shipsText(best.ships)}${best.mixed ? ' (смешанный, только свои корабли)' : ''}: победа ${(s.win * 100).toFixed(1)} %` + (s.draw > 0 ? `, ничья ${(s.draw * 100).toFixed(1)} %` : '') + ` (${s.runs} боёв), добыча ≈ ${fmt(s.loot.mean.msu)} МСУ, ` +
        `потери ≈ ${fmt(s.attackerLoss.mean.msu)} МСУ, итог ≈ ${fmt(s.net.mean)} МСУ` +
        (timeOf ? ` (${fmt(best.score)} МСУ/ч)` : '') +
        (Object.keys(missing).length ? `; построить: ${shipsText(missing)}` : '') +
        (cands.length > 1 ? `; проверено вариантов: ${cands.length}` : ''),
    };
  }
  function stealOk(c, halves) { return c.sim.loot.mean.metal + c.sim.loot.mean.crystal + c.sim.loot.mean.deuterium >= 0.95 * halves; }

  // ------------------------------------------------------------------ expeditions (MissionCaseExpedition::EndStayEvent)
  /** free = Σ pricelist capacity − cargo on board (no ShipStorage); points = Σ (M+C)·5/1000; max = min(free, 200·points). */
  function expeditionFind(o) {
    const T = tableOf(o);
    let cap = 0; let points = 0;
    for (const [id, n] of unitPairs(o.ships, true)) {
      cap += n * T[id].capacity;
      points += n * ((T[id].metal + T[id].crystal) * 5 / 1000);
    }
    const free = cap - (+o.cargoOnBoard || 0);
    return { free, points, max: phpRound(Math.min(free, 200 * points)) };
  }

  function expeditionOnce(R, ctx) {
    const { T, pairs, free, points, topPoints } = ctx;
    const ev = R.int(1, 9);
    R.int(1, 8);   // message text
    const out = { event: ev, res: null, dm: 0, ships: null, battle: null, lostAll: false, time: null };
    switch (ev) {
      case 1: {
        const size = R.int(0, 100); let factor = 0;
        if (10 < size) { R.int(1, 4); factor = R.int(10, 50); }
        else if (0 < size && 10 >= size) { R.int(1, 3); factor = R.int(50, 100); }
        else if (0 === size) { R.int(1, 2); factor = R.int(100, 200); }
        const ch = R.int(1, 6); let rid;
        if (ch > 3) rid = 'metal'; else if (ch > 1) { rid = 'crystal'; factor = factor / 2; } else { rid = 'deuterium'; factor = factor / 3; }
        const maxFactor = topPoints > 5000000 ? 12000 : topPoints > 1000000 ? 9000 : topPoints > 100000 ? 6000 : 2400;
        const founded = phpRound(Math.min(free, Math.min(maxFactor, Math.max(200, factor)) * points));
        out.res = ZERO_RES(); out.res[rid] = founded;
        break;
      }
      case 2: {
        const size = R.int(0, 100); let s = 0;
        if (10 < size) { s = R.int(100, 300); R.int(1, 5); }
        else if (0 < size && 10 >= size) { s = R.int(301, 600); R.int(1, 3); }
        else if (0 === size) { s = R.int(601, 3000); R.int(1, 2); }
        out.dm = s;
        break;
      }
      case 3: {
        const size = R.int(0, 100); let s = 0;
        if (10 < size) { s = R.int(10, 50); R.int(1, 4); }
        else if (0 < size && 10 >= size) { s = R.int(52, 100); R.int(1, 2); }
        else if (0 === size) { s = R.int(102, 200); R.int(1, 2); }
        const maxPoints = topPoints < 5000000 ? 4500 : 6000;
        let foundShips = Math.max(phpRound(s * Math.min(points, maxPoints)), 10000);
        const found = {};
        const have = new Set(pairs.map((p) => p[0]));
        for (const id of ctx.fleetIds) {
          if (!have.has(id) || id === 208 || id === 209 || id === 214) continue;
          const cost = T[id].metal + T[id].crystal;
          const maxFound = Math.floor(foundShips / cost);
          if (maxFound <= 0) continue;
          const cnt = R.int(0, maxFound);
          if (cnt <= 0) continue;
          found[id] = cnt;
          foundShips -= cnt * cost;
          if (foundShips <= 0) break;
        }
        out.ships = found;
        break;
      }
      case 4: {
        const type = R.int(1, 2); const size = R.int(0, 100);
        const target = []; let bonus; let roundFn; let factor;
        if (type === 1) {
          bonus = -3; roundFn = Math.floor;
          if (10 < size) { factor = (30 + R.int(-3, 3)) / 100; target.push([204, 5]); }
          else if (0 < size && 10 >= size) { factor = (50 + R.int(-5, 5)) / 100; target.push([206, 3]); }
          else { factor = (80 + R.int(-8, 8)) / 100; target.push([207, 2]); }
        } else {
          bonus = 3; roundFn = Math.ceil;
          if (10 < size) { factor = (40 + R.int(-4, 4)) / 100; target.push([204, 5]); }
          else if (0 < size && 10 >= size) { factor = (60 + R.int(-6, 6)) / 100; target.push([215, 3]); }
          else { factor = (90 + R.int(-9, 9)) / 100; target.push([213, 2]); }
        }
        for (const [id, n] of pairs) {
          const v = roundFn(n * factor);
          const k = target.findIndex((p) => p[0] === id);
          if (k >= 0) target[k][1] = v; else target.push([id, v]);
        }
        const t = ctx.tech;
        const enemy = {
          units: target.filter((p) => p[1]),
          tech: { weapons: Math.min((+t.weapons || 0) + bonus, 0), shielding: Math.min((+t.shielding || 0) + bonus, 0), armour: Math.min((+t.armour || 0) + bonus, 0) },
          factor: { Attack: 0, Defensive: 0, Shield: 0 },
        };
        const me = Object.assign({ units: pairs }, ctx.attackerSide);
        const b = battle({ attackers: [me], defenders: [enemy], rng: R, units: T, keepOrder: true, fleetDebrisPct: 0, defDebrisPct: 0, targetType: 0 });
        out.battle = { won: b.won, lost: b.attackers[0].lost, lostValue: b.lostValue.attacker, pirates: type === 1 };
        break;
      }
      case 5:
        out.lostAll = true; R.int(1, 4);
        break;
      case 6: {
        const chance = R.int(0, 100);
        const wrapper = [2, 2, 2, 2, 2, 2, 2, 3, 3, 5];
        const f = wrapper[R.int(0, 9)];
        if (chance < 75) { R.int(1, 6); out.time = { slow: true, factor: f }; }
        else { R.int(1, 3); out.time = { slow: false, factor: f }; }
        break;
      }
      default: break;
    }
    return out;
  }

  function expedition(o) {
    const T = tableOf(o);
    const R = toRng(o);
    const runs = Math.max(1, o.runs !== undefined ? +o.runs : 1000);
    const rates = Object.assign({ c: 1.5, d: 3 }, o.rates || {});
    const pairs = unitPairs(o.ships, true);
    const find = expeditionFind({ ships: pairs, cargoOnBoard: o.cargoOnBoard, units: T });
    const topPoints = o.topPoints !== undefined ? +o.topPoints : 1000000;
    const at = o.attackerTech || {};
    const attackerSide = at.bonusPct ? { bonusPct: at.bonusPct } : { tech: at.tech || at, factor: at.factor };
    // pirates/aliens use the sender's research levels; with only bonusPct known, levels ≈ floor(pct / 10)
    const tech = at.tech || (at.bonusPct ? { weapons: Math.floor((+at.bonusPct.attack || 0) / 10), shielding: Math.floor((+at.bonusPct.defense || 0) / 10), armour: Math.floor((+at.bonusPct.shield || 0) / 10) } : at);
    const fleetIds = Object.keys(T).map(Number).filter((id) => T[id].isShip).sort((a, b) => a - b);
    const ctx = { T, pairs, free: find.free, points: find.points, topPoints, tech, attackerSide, fleetIds };
    const fleetValue = ZERO_RES();
    for (const [id, n] of pairs) { fleetValue.metal += T[id].metal * n; fleetValue.crystal += T[id].crystal * n; fleetValue.deuterium += T[id].deuterium * n; }
    const fleetMsu = msuOf(fleetValue, rates);
    const cnt = { resources: 0, darkMatter: 0, ships: 0, battle: 0, blackHole: 0, time: 0, nothing: 0 };
    const names = [null, 'resources', 'darkMatter', 'ships', 'battle', 'blackHole', 'time', 'nothing', 'nothing', 'nothing'];
    const found = ZERO_RES(); let dm = 0; const shipsFound = {}; let shipsMsu = 0; let battleMsu = 0; let battleLostAll = 0; let slow = 0; let slowExtra = 0;
    for (let i = 0; i < runs; i++) {
      const r = expeditionOnce(R, ctx);
      cnt[names[r.event]]++;
      if (r.res) { found.metal += r.res.metal; found.crystal += r.res.crystal; found.deuterium += r.res.deuterium; }
      dm += r.dm;
      if (r.ships) for (const id of Object.keys(r.ships)) { shipsFound[id] = (shipsFound[id] || 0) + r.ships[id]; shipsMsu += msuOf({ metal: T[id].metal * r.ships[id], crystal: T[id].crystal * r.ships[id], deuterium: T[id].deuterium * r.ships[id] }, rates); }
      if (r.battle) { battleMsu += msuOf(r.battle.lostValue, rates); if (r.battle.won === 'r') battleLostAll++; }
      if (r.time && r.time.slow) { slow++; slowExtra += r.time.factor; }
    }
    const per = (x) => x / runs;
    const expected = { metal: per(found.metal), crystal: per(found.crystal), deuterium: per(found.deuterium) };
    expected.msu = msuOf(expected, rates);
    const shipsExp = {}; for (const id of Object.keys(shipsFound)) shipsExp[id] = per(shipsFound[id]);
    const freq = {}; for (const k of Object.keys(cnt)) freq[k] = per(cnt[k]);
    const bhMsu = per(cnt.blackHole) * fleetMsu;
    const evMsu = expected.msu + per(shipsMsu) - per(battleMsu) - bhMsu;
    const stayHours = o.stayHours !== undefined ? +o.stayHours : 1;
    return {
      probs: { resources: 1 / 9, darkMatter: 1 / 9, ships: 1 / 9, battle: 1 / 9, blackHole: 1 / 9, time: 1 / 9, nothing: 3 / 9 },
      freq, runs,
      find: { capByCargo: find.free, capByPoints: 200 * find.points, max: find.max, expected },
      dm: { expected: per(dm) },
      shipsFound: { expected: shipsExp, msu: per(shipsMsu) },
      battleLoss: { expectedMsu: per(battleMsu), lostAllShare: cnt.battle ? battleLostAll / cnt.battle : 0 },
      blackHoleLoss: { msu: fleetMsu },
      time: { slowShare: cnt.time ? slow / cnt.time : 0, slowExtraSec: slow ? stayHours * 3600 + slowExtra / slow : 0 },
      ev: { msu: evMsu, dm: per(dm) },
      fleetPoints: find.points, freeCargo: find.free, fleetValue: Object.assign(fleetValue, { msu: fleetMsu }),
    };
  }

  // ------------------------------------------------------------------ espionage (MissionCaseSpy)
  /** Probes needed so that probes·(1+spyPower) >= MinAmount + view offset (fleet 0, defense 1, buildings 3, research 5). */
  function spyNeeded(o) {
    const ours = Math.max(+o.ourSpy || 0, 1); const theirs = Math.max(+o.theirSpy || 0, 1);
    const mult = 1 + (+o.spyPower || 0);
    const diff = Math.abs(ours - theirs);
    const minAmount = (ours > theirs ? -1 : 1) * Math.pow(diff * SPY_DIFFENCE_FACTOR, 2);
    const add = { ships: 0, defense: 1, buildings: 3, research: 5 }[o.want || 'ships'];
    if (add === undefined) throw new Error('botSim.spyNeeded: want');
    const need = minAmount + add * SPY_VIEW_FACTOR;
    let n = Math.max(1, Math.ceil(need / mult));
    while (n * mult < need) n++;
    while (n > 1 && (n - 1) * mult >= need) n--;
    return n;
  }

  function debrisForRecyclers(debris, o) {
    o = o || {};
    const cap = (o.cap !== undefined ? +o.cap : 20000) * (1 + (+o.storageFactor || 0));
    const total = (+(debris && debris.metal) || 0) + (+(debris && debris.crystal) || 0);
    if (total <= 0 || cap <= 0) return 0;
    const margin = o.marginPct !== undefined ? +o.marginPct : 10;
    return Math.ceil(total * (1 + margin / 100) / cap);
  }

  return {
    version: VERSION,
    rng, unitTable, loadCatalog,
    battle, steal, stealFleets, minCapacityForLoot, raid, optimizeRaid,
    expedition, expeditionFind, spyNeeded, debrisForRecyclers,
    phpRound, msu: msuOf,
    _defaultUnits: defaultUnits,
  };
});

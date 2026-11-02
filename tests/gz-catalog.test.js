'use strict';
// OGX.catalog + OGX.calc against GALAXYZ (ogamex.eu/Aeternum, 2Moons fork): every expectation is a number printed on a REAL saved
// page (specs/galaxyz/fixtures/*-real-*.html, byte copies of eu/pages) or an upstream 2Moons vector marked [UPSTREAM].
// Pure Node: the non-DOM core files are loaded into a vm context (tests/core-ext.js nodeCore()); pages are read with regexes.
//   node tests/gz-catalog.test.js
const fs = require('fs');
const path = require('path');
const T = require('./lib');
const { assert } = T;
const { nodeCore } = require('./core-ext');

const OGX = nodeCore();
const C = OGX.calc;
const K = OGX.catalog;
const FIX = path.join(__dirname, '..', 'specs', 'galaxyz', 'fixtures');
const page = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
const plain = (o) => JSON.parse(JSON.stringify(o));
const num = (s) => +String(s).replace(/\./g, '');

/** List items of page=buildings|research|shipyard: { id, title, level, form, button, off }. */
function listItems(html) {
  const out = new Map();
  const body = html.slice(html.indexOf('<ul class="icons'));
  for (const chunk of body.split(/<li class="technology/).slice(1)) {
    const li = chunk.split('</li>')[0];
    const id = +(li.match(/data-technology="(\d+)"/) || [])[1];
    if (!id || out.has(id)) continue;
    const lvData = li.match(/class="level"[^>]*data-value="(\d+)"/);
    const lvText = li.match(/class="level"[^>]*>\s*([\d.]+)/);
    const title = (li.match(/title="([^"]*)"/) || [])[1] || '';
    out.set(id, {
      id, title: title.split('&lt;br')[0].split('<br')[0].trim(), level: lvData ? +lvData[1] : lvText ? num(lvText[1]) : null,
      form: /class="build_form"/.test(li), button: /<button class="upgrade"/.test(li), off: /data-status="off"/.test(li),
    });
  }
  return out;
}
/** Header stock: exact data-real values and the produced energy (t="free / produced"). */
function stock(html) {
  const real = (id) => Math.floor(+html.match(new RegExp(`id="${id}" data-real="([\\d.]+)"`))[1]);
  const en = html.match(/Imperium[^>]*t="([\d.]+)[\s\u00a0]*\/[\s\u00a0]*([\d.]+)"/);   // NBSP around the slash
  return { metal: real('current_metal'), crystal: real('current_crystal'), deuterium: real('current_deuterium'), energy: num(en[2]), energyFree: num(en[1]) };
}
function tickers(html) {
  return html.split('resourceTicker({').slice(1).map((c) => ({
    production: +c.match(/production:\s*\(?\s*([\d.]+)/)[1], limit: +c.match(/limit:\s*\[\s*[\d.]+\s*,\s*"?([\d.]+)"?/)[1],
  }));
}

const buildings = listItems(page('buildings-real-buildings.html'));
const research = listItems(page('buildings-real-research.html'));
const RESEARCH = Object.fromEntries([...research.values()].map((i) => [i.id, i.level]));
const LEVELS = Object.fromEntries([...buildings.values()].map((i) => [i.id, i.level]));
const OFFICERS = { 601: 18, 603: 3 };   // REAL officier.html (all others 0)
// The pages saved later (resources, imperium, fleetDealer, fleetStep*) show energy "2.502 / 49.544" = +20 %: Engineer 4 by then.
const OFFICERS_LATER = { 601: 18, 603: 4 };

T.test('catalog: GALAXYZ ids, real names from the list pages, lists and missions', async () => {
  assert.equal(K._data.length, 95);
  const pages = ['buildings-real-buildings.html', 'buildings-real-research.html', 'buildings-real-shipyard-fleet.html', 'buildings-real-shipyard-defense.html'];
  let n = 0;
  for (const p of pages) {
    for (const it of listItems(page(p)).values()) {
      const o = K.get(it.id);
      assert.ok(o, 'catalog has ' + it.id);
      assert.equal(o.en, it.title, `${p} ${it.id}`);
      assert.equal(K.idFromTitle(it.title), it.id, 'idFromTitle ' + it.title);
      n++;
    }
  }
  assert.equal(n, 19 + 19 + 19 + 13);
  assert.deepEqual(plain(K.list('research').map((o) => o.id)), [...research.keys()]);   // page order
  assert.deepEqual(plain(K.buildingIds('planet').sort((a, b) => a - b)), [...buildings.keys()].sort((a, b) => a - b));
  assert.deepEqual(plain(K.buildingIds('moon').sort((a, b) => a - b)), [14, 21, 22, 23, 24, 41, 42, 43]);
  assert.equal(K.get('small_ship_cargo').id, 202);
  assert.equal(K.get(217).en, 'Battle Transporter');
  assert.equal(K.get(217).civil, true);
  assert.equal(K.get(219).props.cargo, 20000000);   // Aeternum: 20 000 000 (battle report 2026-10-31, see the fleet cargo check)
  assert.equal(K.get(503).type, 'defense');
  assert.equal(K.get(503).missile, true);
  assert.equal(K.get(601).type, 'officer');
  assert.deepEqual(plain(K.get(603).bonus), { Attack: 0.05, Defensive: 0.05, Energy: 0.05 });
  assert.equal(K.get(71).priceKnown, false);
  assert.equal(K.get(212).page, 'shipyard');
  assert.equal(K.get(401).page, 'defense');
  assert.equal(K.get(1).gzPage, 'buildings');
  assert.deepEqual(plain(K.get(208).req), [[21, 4], [117, 3]]);   // REAL techtree.html
  assert.equal(K.get(202).rapidfire[210], 5);
  assert.ok(!K.fleetShipIds.includes(212));
  assert.equal(K.list().filter((o) => o.type === 'officer').length, 0);
  assert.equal(K.list('officer').length, 15);
  for (const id of K.shipIds) assert.ok(K.get(id).props && K.get(id).props.structural > 0, 'props ' + id);
  assert.equal(K.missionName(11), 'Добыча ТМ');
  assert.equal(K.missionName(15), 'Экспедиция');
  assert.equal(K.name(1), 'Рудник металла');
  assert.equal(K.shortName(220), 'Сборщик ТМ');
});

T.test('unit prices = fleetDealer CostInfo (the server\'s own price list)', async () => {
  const m = page('buildings-real-fleetDealer.html').match(/CostInfo\s*=\s*(\{.*?\});/s);
  const info = JSON.parse(m[1]);
  assert.ok(Object.keys(info).length >= 26);
  for (const [id, [, name, c]] of Object.entries(info)) {
    assert.equal(K.get(+id).en, name, 'name ' + id);
    assert.deepEqual(plain(C.cost(+id)), { metal: +c[901], crystal: +c[902], deuterium: +c[903], energy: +c[911] }, 'cost ' + id);
    assert.equal(K.get(+id).price.darkMatter, +c[921], 'dm ' + id);
  }
  assert.deepEqual(plain(C.unitCost(220, 3)), { metal: 180000, crystal: 210000, deuterium: 90000, energy: 0 });   // fork price, 1/100 of upstream
});

T.test('building/research prices explain every buy button (35/35, empty queues)', async () => {
  // A list item with requirements met shows button.upgrade exactly when the next level is affordable; energy prices are
  // compared with PRODUCED energy (2Moons getRestPrice). Conveyors 71-73 have no known price and are skipped.
  const check = (items, html, label) => {
    const s = stock(html);
    let n = 0;
    for (const it of items.values()) {
      if (it.off || K.get(it.id).priceKnown === false) continue;
      const c = C.cost(it.id, it.level + 1);
      const ok = c.metal <= s.metal && c.crystal <= s.crystal && c.deuterium <= s.deuterium && c.energy <= s.energy;
      assert.equal(ok, it.button, `${label} ${it.id} L${it.level}->${it.level + 1} ${JSON.stringify(c)}`);
      n++;
    }
    return n;
  };
  const n = check(buildings, page('buildings-real-buildings.html'), 'buildings') + check(research, page('buildings-real-research.html'), 'research');
  assert.equal(n, 15 + 19);   // 19 buildings minus University (off) and 71-73
  // spot values: metal mine 38->39 (mechanics.md §4), Expedition Research 1.75, Graviton energy x3
  assert.deepEqual(plain(C.cost(1, 39)), { metal: 294862195, crystal: 73715548, deuterium: 0, energy: 0 });
  assert.deepEqual(plain(C.cost(124, 7)), { metal: 114891, crystal: 229783, deuterium: 114891, energy: 0 });
  assert.deepEqual(plain(C.cost(199, 2)), { metal: 0, crystal: 0, deuterium: 0, energy: 900000 });
  assert.deepEqual(plain(C.cost(1, 0)), { metal: 0, crystal: 0, deuterium: 0, energy: 0 });
  assert.deepEqual(plain(C.costRange(2, 0, 2)), { metal: 48 + 72, crystal: 24 + 36, deuterium: 0, energy: 0 });
  // [UPSTREAM] tear-down = half the price of the current level
  assert.deepEqual(plain(C.downgradeCost(14, 3)), { metal: 800, crystal: 240, deuterium: 400, energy: 0 });
});

T.test('production, energy and storage = resources.html / overview.html', async () => {
  const res = page('buildings-real-resources.html');
  const tk = tickers(res);
  // levels from buildings.html, research from research.html, Tmax 72 from the planet list, 797 satellites from resources.html
  const p = C.production({ levels: LEVELS, ships: { 212: 797 }, tempMax: 72, research: RESEARCH, officers: OFFICERS_LATER });
  assert.ok(Math.abs(p.perHour.metal - tk[0].production) < 0.01, `metal ${p.perHour.metal} vs ${tk[0].production}`);
  assert.ok(Math.abs(p.perHour.crystal - tk[1].production) < 0.01, `crystal ${p.perHour.crystal} vs ${tk[1].production}`);
  assert.ok(Math.abs(p.perHour.deuterium - tk[2].production) < 0.01, `deut ${p.perHour.deuterium} vs ${tk[2].production}`);
  // table rows (rounded display): basic income, mine rows, bonus row
  assert.deepEqual(plain(p.breakdown.base), { metal: 440000, crystal: 220000, deuterium: 0 });
  assert.deepEqual(plain(p.breakdown.mines), { metal: 938100934, crystal: 432777527, deuterium: 191546210 });
  assert.deepEqual(plain(p.breakdown.bonus), { metal: 994386990, crystal: 389499775, deuterium: 203038982 });
  // header energy (free / produced): resources.html "2.502 / 49.544" (Engineer 4, = the Total row 2.502 and bonus 8.257),
  // overview.html "438 / 47.480" (Engineer 3 on officier.html, saved earlier)
  const sr = stock(res);
  assert.deepEqual([p.energy.production, p.energy.balance], [sr.energy, sr.energyFree]);
  assert.ok(Math.abs(p.energy.production - (10470 + 30817) - 8257) <= 1, 'bonus row energy 8.257');
  const p3 = C.production({ levels: LEVELS, ships: { 212: 797 }, tempMax: 72, research: RESEARCH, officers: OFFICERS });
  const so = stock(page('buildings-real-overview.html'));
  assert.deepEqual([p3.energy.production, p3.energy.balance], [so.energy, so.energyFree]);
  assert.equal(p.factor, 1);
  // storage: ticker limits at storage levels 18/17/16, and full storages of two spied planets (levels 20, 19)
  assert.deepEqual([22, 23, 24].map((id) => C.storageCapacity(LEVELS[id])), tk.map((t) => t.limit));
  assert.equal(C.storageCapacity(20), 11483000000);
  assert.equal(C.storageCapacity(19), 6263925000);
  assert.equal(C.storageCapacity(0), 50000);
  const spy = page('messages-real-spy.html');
  for (const v of ['11.483.000.000', '6.263.925.000']) assert.ok(spy.includes(v), 'spy report shows ' + v);
  // energy shortage scales mines; at 0 % only basic income; moons produce nothing
  const short = C.production({ levels: { 1: 20, 4: 10 }, tempMax: 40 });
  assert.ok(short.factor > 0 && short.factor < 1);
  assert.ok(Math.abs(short.perHour.metal - (440000 + 30 * 20 * Math.pow(1.1, 20) * short.factor * 22000)) < 1e-3);
  const off = C.production({ levels: { 1: 38, 4: 30 }, percents: { 1: 0 }, tempMax: 72 });
  assert.equal(off.perHour.metal, 440000);
  assert.equal(C.production({ levels: { 1: 10, 4: 10 }, isMoon: true }).perHour.metal, 0);
  // the fusion plant uses deuterium (upstream: only while something consumes energy)
  const fus = C.production({ levels: { 1: 10, 12: 10 }, research: { 113: 12 } });
  assert.ok(fus.energy.production > 0 && Math.abs(fus.perHour.deuterium + 10 * 10 * Math.pow(1.1, 10) * 22000) < 1e-6);
});

T.test('amountAt: grows up to storage, a full stock stays, negative production floors at 0', async () => {
  const r = { amount: 1000, storage: 4000, perHour: 3600, t: 0 };
  assert.equal(C.amountAt(r, 1000e3), 2000);
  assert.equal(C.amountAt(r, 1e7), 4000);
  assert.equal(C.amountAt({ amount: 5000, storage: 4000, perHour: 3600, t: 0 }, 1e6), 5000);
  assert.equal(C.amountAt({ amount: 5000, storage: 4000, perHour: -3600, t: 0 }, 1000e3), 4000);
  assert.equal(C.amountAt({ amount: 100, storage: 4000, perHour: -3600, t: 0 }, 1000e3), 0);
  assert.equal(C.secondsUntilFull(r, 0), 3000);
  assert.equal(C.timeUntilAffordable({ metal: 1600 }, { metal: r }, 0), 600);
});

T.test('times: 2Moons formulas, game speed unknown on Aeternum [UPSTREAM]', async () => {
  assert.equal(C.gz.gameSpeed, null);
  // mechanics.md §4 self-check: metal mine 38->39, Robotics 20, Nanite 10 at x1 = 24 681 s; x7 = 3 525 s
  assert.equal(C.buildTime(1, 39, { robotics: 20, nanite: 10 }), 24681);
  assert.equal(C.buildTime(1, 39, { robotics: 20, nanite: 10, gameSpeed: 7 }), 3525);
  assert.equal(C.buildTime(1, 39, { robotics: 20, nanite: 10, economySpeed: 7 }), 3525);
  assert.equal(C.buildTime(1, 39, { robotics: 20, nanite: 10, officers: { 605: 3 } }), Math.floor((294862195 + 73715548) / (2500 * 21) / 1024 * 0.7 * 3600));
  assert.equal(C.buildTime(1, 1, { robotics: 20, nanite: 10 }), 1);   // min_build_time
  // tear-down: half price, x1300
  assert.equal(C.buildTime(14, 3, { destroy: true }), Math.floor((800 + 240) / 2500 * 1300));
  // research: (m+c)/(1000*(1+lab)) / speed * 0.92^university
  assert.equal(C.researchTime(106, 13, { labLevel: 21 }), Math.floor((200 * 4096 + 1000 * 4096) / (1000 * 22) * 3600));
  assert.equal(C.researchTime(106, 13, { labLevel: 21, university: 2 }), Math.floor((1200 * 4096) / 22000 * 0.92 * 0.92 * 3600));
  // ships per unit with the shipyard; defence uses DefensiveTime (608 Minister of Defence -25 %/level)
  assert.equal(C.unitTime(202, { shipyard: 18, nanite: 10 }), 1);
  assert.equal(C.unitTime(214, { shipyard: 18 }), Math.floor(9000000 / (2500 * 19) * 3600));
  assert.equal(C.unitTime(401, { shipyard: 1, officers: { 608: 2 } }), Math.floor(2000 / 5000 * 0.5 * 3600));
  // IRN: labs counted only when they meet the research's lab requirement (Graviton needs lab 12)
  assert.equal(C.effectiveLab(199, 21, [11, 15, 8], 2), 21 + 15);
  assert.equal(C.effectiveLab(106, 21, [11, 15, 8], 3), 21 + 15 + 11 + 8);
});

T.test('fleet: speeds, flight times, fuel and cargo = fleetStep1 / fleetTable / overview', async () => {
  const st = C.shipStats(RESEARCH);
  // REAL fleetStep1 data.ships 208 speed 6000.000000000001, consumption 1000, fleetroom 7500 (Hyperspace Tech 8: no cargo bonus)
  const s1 = JSON.parse(page('fleet-real-fleetStep1.html').match(/data\s*=\s*(\{.*\});/)[1]);
  assert.equal(st[208].speed, s1.ships[208].speed);
  assert.equal(st[208].fuel, +s1.ships[208].consumption);
  assert.equal(st[208].cargo, +s1.fleetroom);
  assert.equal(C.missionSpeedFactor(3, {}), s1.gamespeed);
  assert.equal(C.missionSpeedFactor(1, { fleetSpeed: 3 }), 3);
  // REAL fleetTable tooltips "Speed:  6000" / "Speed:  220000000"
  const ft = page('fleet-real-fleetTable.html');
  const tips = [...ft.matchAll(/data-tooltip-content="Speed:\s*(\d+)"/g)].map((m) => +m[1]);
  assert.deepEqual(tips, [Math.round(st[208].speed), Math.round(st[210].speed)]);
  // fleet.md §4: from [2:68:5] with one colony ship at 100 % (distance, seconds, deuterium) — step2/3 show 1020 / 653 s / 118
  const gs = s1.gamespeed;
  for (const [to, d, sec, fuel] of [['2:68:5', 5, 47, 2], ['2:68:9', 1020, 653, 118], ['2:70:5', 2890, 1099, 331], ['3:68:5', 20000, 2888, 2287]]) {
    const dist = C.distance('2:68:5', to);
    const dur = C.flightDuration({ distance: dist, maxSpeed: C.fleetMaxSpeed({ 208: 1 }, st), speedFactor: gs });
    assert.deepEqual([dist, dur, C.fuel({ ships: { 208: 1 }, stats: st, distance: dist, duration: dur, speedFactor: gs })], [d, sec, fuel], to);
    assert.equal(C.fuel({ ships: { 208: 1 }, stats: st, distance: dist, duration: 0, variant: 'server', fleetSpeed: gs, speedPct: 10 }), fuel);
  }
  // no circular systems: [2:1:1] -> [2:400:1] is 399 systems
  assert.equal(C.distance('2:1:1', '2:400:1'), 2700 + 95 * 399);
  // REAL overview: 8290 recyclers [2:68:5] -> [2:87:8], combustion 12: one way 1601.3 s; events end 1602 s apart (DB rounding)
  const ov = page('buildings-real-overview.html');
  const ends = [...new Set([...ov.matchAll(/data-fleet-end-time="(\d+)"[^>]*>[\s\S]{0,400}?class="(?:flight|return) ownharvest/g)].map((m) => +m[1]))];
  assert.equal(st[209].speed, 4400);
  const dur = C.flightDuration({ distance: C.distance('2:68:5', '2:87:8'), maxSpeed: st[209].speed, speedFactor: gs });
  assert.equal(dur, 1601);
  if (ends.length === 2) assert.ok(Math.abs(Math.abs(ends[1] - ends[0]) - dur) <= 1, 'harvest events ' + ends);
  assert.equal(C.flightDuration({ distance: 5, maxSpeed: 1e9, speedFactor: 7 }), 5);   // fleetMinDuration
  assert.equal(C.flightDuration({ distance: 1020, maxSpeed: 6000, speedFactor: 7, flyFactor: 0.9 }), 653 * 0.9);
  // drive switches: Light Cargo impulse from impulse 5 (first speed value), Planet Bomber hyperspace from hyperspace 8
  const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`);
  near(C.shipSpeed(202, { 115: 12, 117: 4 }), 5000 * 2.2, '202 combustion');
  near(C.shipSpeed(202, { 115: 12, 117: 7 }), 5000 * 2.4, '202 impulse');
  assert.equal(C.shipFuel(202, { 117: 7 }), 20);
  near(C.shipSpeed(211, { 117: 7, 118: 8 }), 4000 * 3.4, '211 hyperspace');
  assert.equal(C.shipSpeed(212, RESEARCH), 0);
  // cargo: Storage expert 607 +50 %/level; slots 1 + computer + 3 per Commander level; expeditions floor(sqrt(astro))
  assert.equal(C.cargoCapacity(203, RESEARCH, null, { officers: { 607: 2 } }), 50000);
  assert.equal(C.fleetCargo({ 202: 2, 217: 1 }, st), 10000 + 40000000);   // 217: 40 000 000 on Aeternum (user, 2026-10-31)
  // REAL Aeternum battle report (2026-10-31): 102 probes + 4 510 Battle Transporters + 7 568 Battle Recyclers, no Storage expert,
  // stole 110 586 666 837 of each resource (equal thirds = the cargo was full): 3 x that = the fleet cargo, +-1 rounding
  assert.ok(Math.abs(C.fleetCargo({ 210: 102, 217: 4510, 219: 7568 }, C.shipStats({}, null)) - 3 * 110586666837) <= 2);
  assert.deepEqual(plain(C.slots({ computer: RESEARCH[108], astrophysics: RESEARCH[124] })), { fleet: 13, expedition: 2 });   // REAL "1 / 13", "0 / 2"
  assert.equal(C.slots({ computer: 12, officers: { 611: 1 } }).fleet, 16);
  assert.deepEqual(plain(C.statsFromStep1(s1.ships)[208]), { speed: s1.ships[208].speed, cargo: 7500, fuel: 1000, fuelConsumption: 1000, fuelCapacity: 7500 });
});

T.test('loot, debris, moon chance, expedition find [UPSTREAM 2Moons]', async () => {
  // calculateSteal: 100k/100k/10k, cargo 25 000 -> 1/3 metal, 1/2 crystal, rest deut, then top-up
  assert.deepEqual(plain(C.loot({ metal: 100000, crystal: 100000, deuterium: 10000 }, { cargo: 25000 })), { metal: 10000, crystal: 10000, deuterium: 5000, total: 25000 });
  assert.deepEqual(plain(C.loot({ metal: 100000, crystal: 100000, deuterium: 10000 })), { metal: 50000, crystal: 50000, deuterium: 5000, total: 105000 });
  // a full storage from the real spy report (Colony [2:72:6]) with 1000 Battle Transporters
  const L = C.loot({ metal: 11483000000, crystal: 11483000000, deuterium: 6263925000 }, { cargo: 1000 * 400000000 });
  assert.deepEqual([L.metal, L.crystal, L.deuterium], [5741500000, 5741500000, 3131962500]);
  assert.equal(C.lootPct('explorer'), 0.5);
  assert.deepEqual(plain(C.debris({ 202: 10, 401: 100 })), { metal: 6000, crystal: 6000, deuterium: 0 });
  assert.deepEqual(plain(C.debris({ 401: 100 }, { debrisDefensePct: 10 })), { metal: 20000, crystal: 0, deuterium: 0 });
  assert.equal(C.moonChance(150000), 2);
  assert.equal(C.moonChance(1e12), 20);
  // expedition: min(free cargo, 200 x sum((m+c) x 5/1000)) = min(cargo, total m+c of the fleet)
  const st = C.shipStats(RESEARCH);
  const f = C.expeditionMaxFind({ ships: { 203: 100, 210: 1 }, stats: st });
  assert.equal(f.points, (12000 * 100 + 1000) * 5 / 1000);
  assert.equal(f.normal.metal, Math.min(100 * 25000 + 5, 200 * f.points));
  assert.equal(C.expeditionMaxFind({ ships: { 204: 10 }, cargo: Infinity }).normal.metal, 40000);
  assert.equal(C.expeditionMaxFind({ ships: { 204: 10 } }).normal.metal, 500, 'the base cargo (10 x 50) limits by default');
  // BASE cargo (no Storage expert 607): 1 colony ship (208) = 7500 base cargo, cost 30000 M+C; officers never raise it
  const col = C.expeditionMaxFind({ ships: { 208: 1 }, cargoOnBoard: { metal: 1000 } });
  assert.deepEqual([col.points, col.cargoBase, col.free, col.normal.metal, col.limitedByCargo], [150, 7500, 6500, 6500, true]);
  assert.equal(C.baseCargo({ 208: 1, 203: 2 }), 7500 + 2 * 25000);
  // ship finds [UPSTREAM]: max(round(size x min(points, 4500 | 6000)), 10000)
  assert.deepEqual(plain(C.expeditionShipFind({ points: 150 })), { normal: 10000, rare: 15000, exceptional: 30000, cap: 4500, capKnown: false, capped: false });
  assert.deepEqual([C.expeditionShipFind({ points: 9000, topPoints: 5e6 }).exceptional, C.expeditionShipFind({ points: 9000, topPoints: 4e6 }).exceptional], [1200000, 900000]);
  // loot capacity: the 2Moons fill order takes metal only up to 1/3 + 1/2 of the rest -> metal alone needs 1.5 x
  assert.equal(C.lootCapacity({ metal: 1000 }), 1500);
  assert.equal(C.lootCapacity({ crystal: 1000 }), 1000);
  assert.equal(C.lootCapacity({ metal: 0 }), 0);
  for (const l of [{ metal: 900, crystal: 50, deuterium: 3 }, { metal: 12345, crystal: 6789, deuterium: 4321 }]) {
    const cap = C.lootCapacity(l), sum = (d) => d.metal + d.crystal + d.deuterium, tot = l.metal + l.crystal + l.deuterium;
    assert.ok(sum(C.distributeLoot(l, cap)) >= tot - 1e-6 && sum(C.distributeLoot(l, cap - 1)) < tot, 'smallest capacity ' + cap);
  }
  assert.equal(C.phalanxRange(1), 1);
  assert.equal(C.phalanxRange(5), 24);
  assert.equal(C.missileRange(7), 34);
});

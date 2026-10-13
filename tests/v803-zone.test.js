'use strict';
// 8.0.3 (fx-farm, логи 11.10 00:37 и 01:45): зона по одной общей строке («Pavel Ruins» у Фальстона), устаревшая зона и «мягкое окно»
// уровней после смерти, ★ цель стирается до отметок игры, список эпиков на пределе обрезки hook.js, зона РБ из устаревшей rt.zone
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
let finished = false;
process.on('exit', () => { if (!finished) { console.error('FAIL: v803-zone не дошёл до конца'); process.exitCode = 1; } });
const loadMod = (name, extra = {}) => {
  const sb = { console, Date, Math, JSON, location: { pathname: '/map.html', search: '', href: '' }, CSS: { escape: s => s }, ...extra };
  sb.globalThis = sb;
  vm.runInNewContext(read(`modules/${name}.js`), sb);
  return sb;
};
const B = JSON.parse(read('base-profile.json')), R = B.chars.Warlock.rt;
const content = read('content.js');

(async () => {
  // ---------- 1. зона по ближней странице: ≥3 общих имени, половина имён страницы, полоса уровней ----------
  const nav = loadMod('navigation');
  let page = [], pager = '1 / 13 (185)', recs = [];
  const nenv = { cfg: {}, rt: {}, heroLvl: () => 56, isRaidId: id => /^l2dop_(?:rb|eg)_/.test(id), pageItems: () => page,
    $q: sel => sel === '#map-mob-page-ind' ? { textContent: pager } : null, rec: (...a) => recs.push(a.join(' ')),
    setRt: p => { nenv.rt = { ...nenv.rt, ...p }; } };
  const N = nav.L2V7Factories.navigation(nenv);
  const it = (id, name, lvl) => ({ id, name, lvl, champ: false });
  // снимок /map.html 10:32:57 (тур РБ к Фальстону, cityId l2dop_goddard): «Моби 1/13 (185)», 1-я страница
  const falston = [it('l2dop_rb_25322', 'Агент Демона Фальстон', 66), it('dense_29251', 'Spiked Stakato Captain', 78), it('dense_29266', 'Tomb Preacher', 77),
    it('dense_29283', 'Tomb Guard', 75), it('dense_29250', 'Forgotten Ancient People', 77), it('dense_29265', 'Monastery Guardian', 78), it('dense_29238', 'Tomb Guard', 75),
    it('dense_29282', 'Spiked Stakato Shaman', 80), it('dense_29301', 'Tomb Preacher', 77), it('dense_29320', 'Forgotten Victim', 78), it('dense_29249', 'Spiked Stakato Shaman', 80),
    it('dense_29264', 'Forgotten Victim', 78), it('dense_29237', 'Spiked Stakato Shaman', 80), it('dense_29281', 'Forgotten Ancient People', 77), it('dense_29300', 'Spiked Stakato Nurse', 79)];
  const base = () => ({ zoneMobs: JSON.parse(JSON.stringify(R.zoneMobs)), zoneCat: R.zoneCat, zoneStat: {} });
  // (а) после телепорта тура (8.0.3: zone:null) — раньше «Pavel Ruins» по 2 общим именам (Spiked Stakato Shaman/Captain)
  page = falston; nenv.rt = { ...base(), zone: null };
  await N.zoneHere();
  assert.equal(nenv.rt.zone, 'out:Spiked Stakato Captain / Tomb Preacher', `Falston spot is not Pavel Ruins (${nenv.rt.zone})`);
  assert.deepEqual([nenv.rt.zoneCat[nenv.rt.zone].lo, nenv.rt.zoneCat[nenv.rt.zone].hi], [75, 80], 'out-zone band from the page, without the RB (66)');
  assert.ok(!nenv.rt.zoneMobs.pavel_ruins.includes('Tomb Guard'), 'Falston names are not added to Pavel Ruins');
  // (б) 8.0.2: зона не сбрасывалась — устаревшая «pavel_ruins» с 2 общими именами тоже не держится
  nenv.rt = { ...base(), zone: 'pavel_ruins' };
  await N.zoneHere();
  assert.match(nenv.rt.zone, /^out:/, 'stale pavel_ruins with 2 shared names is dropped');
  // (в) настоящий Pavel Ruins (мобы 46–54) — узнаётся без телепорта
  page = [it('a1', 'Epic Cannon Golem', 53), it('a2', 'Ginzu Golem Prodigy X', 52), it('a3', 'Horrifying Cannon Golem I', 48), it('a4', 'Spelunking Spider', 47),
    it('a5', 'Cruel Vice Golem', 49), it('a6', 'Probe Golem Prodigy IV', 46), it('a7', 'Epic Cannon Golem', 53)];
  nenv.rt = { ...base(), zone: null };
  await N.zoneHere();
  assert.equal(nenv.rt.zone, 'pavel_ruins', 'the real Pavel Ruins is recognised');
  // (г) Bee Hive (лог 01:45, 11:45:51): 3 общих имени из 11, уровни 15–35 в полосе зоны — текущая зона держится
  page = [it('b1', 'Turek Orc Warlord', 30), it('b2', 'Lesser Dark Horror', 15), it('b3', 'Ant Soldier', 35), it('b4', 'Ant Larva', 29), it('b5', 'Marsh Stakato Soldier', 33),
    it('b6', 'Marsh Stakato Drone', 35), it('b7', 'Pincer Spider', 17), it('b8', 'Ol Mahum Raider', 27), it('b9', 'Crimson Spider', 15), it('b10', 'Ant Captain', 31), it('b11', 'Dark Horror', 16)];
  nenv.rt = { ...base(), zone: 'bee_hive' };
  await N.zoneHere();
  assert.equal(nenv.rt.zone, 'bee_hive', 'own zone with 3 shared names and a fitting band is kept');
  // …а чужой её по тем же 3 именам из 11 не назначить (меньше половины страницы)
  nenv.rt = { ...base(), zone: null };
  await N.zoneHere();
  assert.match(nenv.rt.zone, /^out:/, 'a foreign zone needs at least half of the page names');
  // (д) полоса уровней: 3 общих имени, но уровни зоны (кэш спавнов) 20–24, а на странице — 77
  page = [it('c1', 'A', 77), it('c2', 'B', 77), it('c3', 'C', 77)];
  nenv.rt = { zone: null, zoneMobs: { z: ['A', 'B', 'C', 'D'] }, zoneCat: {}, spawns: { x1: ['A', 20], x2: ['B', 22], x3: ['C', 24] } };
  await N.zoneHere();
  assert.match(nenv.rt.zone, /^out:/, 'level band mismatch: not that zone');
  nenv.rt.spawns = { x1: ['A', 75], x2: ['B', 77], x3: ['C', 79] }; nenv.rt.zone = null;
  await N.zoneHere();
  assert.equal(nenv.rt.zone, 'z', 'same names in the band: that zone');
  // (е) дальняя страница списка (по расстоянию — соседние локации): зону не определяем, имена — в список текущей
  pager = '5 / 13 (185)'; page = falston; nenv.rt = { ...base(), zone: null };
  let wrote = 0; const set0 = nenv.setRt; nenv.setRt = p => { wrote++; set0(p); };
  await N.zoneHere();
  assert.equal(wrote, 0, 'far page with no zone: nothing written');
  nenv.rt.zone = 'pavel_ruins';
  await N.zoneHere();
  assert.equal(nenv.rt.zone, 'pavel_ruins', 'far page: the current zone is not re-detected');
  assert.equal(nenv.rt.zoneCat.pavel_ruins.hi, 80, 'far page does not rewrite the zone band');
  // (ж) out-зона на той же точке: повторный заход ничего не пишет (раньше полоса out-зоны переписывалась каждый раз)
  pager = '1 / 13 (185)'; nenv.rt = { ...base(), zone: null };
  await N.zoneHere(); wrote = 0;
  await N.zoneHere();
  assert.equal(wrote, 0, 'same out-zone, same page: no write');
  nenv.setRt = set0;
  // (з) перелёт «Телепортом» (zonePend) — как раньше: зона — куда летели
  nenv.rt = { ...base(), zone: 'bee_hive', zonePend: { id: 'pavel_ruins', t: Date.now() } }; page = falston.slice(0, 3);
  await N.zoneHere();
  assert.equal(nenv.rt.zone, 'pavel_ruins'); assert.equal(nenv.rt.zonePend, null);
  console.log('PASS 1: zone by the near page — ≥3 shared names, half of the page for a foreign zone, level band ±5; Falston (75–80) is not Pavel Ruins; far pages keep the zone');

  // ---------- 2. разовая чистка испорченной Pavel Ruins ----------
  const pavelFix = vm.runInNewContext(`(${content.match(/function pavelFix\(r, out\) \{[\s\S]*?\n\}/)[0]})`);
  const live = { zone: 'pavel_ruins', zoneStat: { pavel_ruins: { 51: { n: 201 }, 52: { n: 426 }, 56: { n: 141, exp: 1, sec: 1 } }, bee_hive: { 56: { n: 3 } } },
    zoneMobs: { pavel_ruins: [...R.zoneMobs.pavel_ruins, 'Tomb Guard', 'Tomb Preacher', 'Monastery Guardian'], bee_hive: ['Ant Larva'] },
    spawns: { d1: ['Tomb Guard', 75], d2: ['Tomb Preacher', 77], d3: ['Monastery Guardian', 78], d4: ['Spiked Stakato Captain', 78], d5: ['Epic Cannon Golem', 53] } };
  const out = pavelFix(live, {});
  assert.deepEqual(Object.keys(out.zoneStat.pavel_ruins), ['51', '52'], 'L55+ rows of Pavel Ruins are dropped');
  assert.deepEqual(out.zoneStat.bee_hive, live.zoneStat.bee_hive, 'other zones untouched');
  assert.ok(!out.zoneMobs.pavel_ruins.some(n => ['Tomb Guard', 'Tomb Preacher', 'Monastery Guardian', 'Spiked Stakato Captain'].includes(n)), 'foreign 60+ names removed');
  assert.ok(out.zoneMobs.pavel_ruins.includes('Epic Cannon Golem') && out.zoneMobs.pavel_ruins.includes('Spiked Stakato Shaman'), 'own and unknown-level names kept');
  assert.equal(out.zone, null, 'current zone re-detected by the map');
  assert.deepEqual(pavelFix({ zone: 'bee_hive', zoneStat: { pavel_ruins: { 52: {} } }, zoneMobs: {} }, {}), {}, 'clean memory: nothing to patch');
  assert.match(content, /once\('pavelZone803', \(\) => \{ pavelFix\(rt, rf\); \}\);/);
  // после чистки та же точка у Фальстона — снова не Pavel Ruins
  page = falston; nenv.rt = { zone: null, zoneMobs: out.zoneMobs, zoneCat: R.zoneCat, spawns: live.spawns };
  await N.zoneHere();
  assert.match(nenv.rt.zone, /^out:/, 'after the cleanup Falston is not Pavel Ruins');
  console.log('PASS 2: once pavelZone803 — Pavel Ruins L55+ rows and foreign 60+ names dropped, zone re-detected');

  // ---------- 3. «мягкое окно» уровней — только на своей локации и не из «фарма на месте» при автофарме ----------
  const mf = loadMod('mobfarm');
  const menv = { cfg: { lvlBelow: 3, lvlAbove: 20, lvlMin: 1, lvlMax: 99, searchChamp: false, zoneAuto: true }, PAGE_SIZE: 15,
    rt: { zone: 'bee_hive', hardMobs: {}, zoneMobs: {}, mobVal: {}, spawns: { s1: ['Ant Soldier', 35], s2: ['Ant Larva', 29], q1: ['Ol Mahum Raider', 27] } },
    heroLvl: () => 56, isRaidId: id => /^l2dop_/.test(id), campChampMin: () => 0, isBoss: () => false, campActive: () => false, campChampOpen: () => false,
    isQuestName: (n, q = []) => q.some(x => x.toLowerCase() === String(n).toLowerCase()), setRt: p => { Object.assign(menv.rt, p); } };
  const M = mf.L2V7Factories.mobfarm(menv);
  const rules = [{ neg: false, quest: true, champ: false, all: false, name: '' }, { neg: false, quest: false, champ: false, all: true, name: '' }];
  // 10.0.5 (игрок 13.10: «фарм мобов −5 лвл максимум»): «мягкое окно» открывает только до героя −5 — Ant Soldier 51 / Ant Larva 52
  // (ниже окна −3, но в пределах −5) им открываются, Ant Worker 35 — никогда
  menv.rt.spawns.s1 = ['Ant Soldier', 51]; menv.rt.spawns.s2 = ['Ant Larva', 52]; menv.rt.spawns.s5 = ['Ant Worker', 35];
  const sig = { ids: ['s1', 's2', 'q1', 's5'], quest: ['Ol Mahum Raider'] };
  const ids = () => Array.from(M.candidates(rules, sig, {}, 99), x => x.id);
  // лог: окно открыто в 11:43:44 в Sea of Spores без автофарма, в 11:45 — Bee Hive с автофармом
  menv.rt.lvlRelaxDown = { t: Date.now() - 120000 };
  assert.deepEqual(ids(), ['q1'], 'old record (no zone): only the ★ quest target, not Ant Soldier 35 / Ant Larva 29 at hero 56');
  menv.rt.lvlRelaxDown = { t: Date.now(), zone: 'sea_of_spores', auto: true };
  assert.deepEqual(ids(), ['q1'], 'window opened at another location does not apply');
  menv.rt.lvlRelaxDown = { t: Date.now(), zone: 'bee_hive', auto: false };
  assert.deepEqual(ids(), ['q1'], 'window opened without autofarm does not apply with autofarm on');
  menv.rt.lvlRelaxDown = { t: Date.now(), zone: 'bee_hive', auto: true };
  assert.deepEqual(ids().sort(), ['q1', 's1', 's2'], 'autofarm could not fly away from here: the window applies');
  menv.cfg.zoneAuto = false; menv.rt.lvlRelaxDown = { t: Date.now(), zone: 'bee_hive', auto: false };
  assert.deepEqual(ids().sort(), ['q1', 's1', 's2'], 'farm in place: window of this location applies (stay where left)');
  menv.rt.lvlRelaxDown = { t: Date.now() - 21 * 60000, zone: 'bee_hive', auto: false };
  assert.deepEqual(ids(), ['q1'], '20 min limit');
  // окно сверху — так же
  menv.cfg.zoneAuto = true; menv.rt.spawns.h1 = ['Tomb Guard', 80]; sig.ids.push('h1');
  menv.rt.lvlRelax = { t: Date.now(), up: 25, zone: 'out:Spiked Stakato Captain / Tomb Preacher', auto: true };
  assert.ok(!ids().includes('h1'), 'upper window of another location does not apply');
  menv.rt.lvlRelax.zone = 'bee_hive';
  assert.ok(ids().includes('h1'), 'upper window of this location applies');
  // уровень в шапке не прочитан — окно по последнему известному уровню (rt.lvl), а не «без окна»
  delete menv.rt.lvlRelax; menv.rt.lvlRelaxDown = null; menv.heroLvl = () => 0; menv.rt.lvl = 56;
  assert.deepEqual(ids(), ['q1'], 'no HUD level: the last known level keeps the window');
  const mfSrc = read('modules/mobfarm.js');
  assert.match(mfSrc, /lvlRelaxDown: \{ t: Date\.now\(\), zone: env\.rt\.zone \|\| null, auto: !!env\.cfg\.zoneAuto \}/);
  assert.match(mfSrc, /lvlRelax: \{ t: Date\.now\(\), up, zone: env\.rt\.zone \|\| null, auto: !!env\.cfg\.zoneAuto \}/);
  assert.match(mfSrc, /const downOn = relaxOk\(env\.rt\.lvlRelaxDown\);/); assert.match(mfSrc, /const relaxOn = relaxOk\(env\.rt\.lvlRelax\);/);
  console.log('PASS 3: soft level window only at its own location, a farm-in-place window does not apply under autofarm, last known level when the HUD is empty');

  // ---------- 4. автофарм при старте: сначала зона по этой карте и уровень героя ----------
  {
    const k = mfSrc.slice(mfSrc.indexOf("env.rec('B', 'локации', 'автофарм: при старте читаю список зон «Телепорта»');"), mfSrc.indexOf('let sig = aroundSig();'));
    const a = k.indexOf('await env.absorb();'), z = k.indexOf('if (await env.zoneForLevel()) return;'), c = k.indexOf('await env.setRt({ zoneAutoKick: null, zoneLvlT: 0 });');
    assert.ok(a > 0 && a < c && c < z, 'absorb (zone of this map) before clearing the kick and before zoneForLevel');
    assert.match(k, /if \(env\.rt\.zone && \(env\.heroLvl\(\) \|\| await env\.waitFor\(\(\) => env\.heroLvl\(\), 3000, 200\)\)\) \{/);
  }
  console.log('PASS 4: autofarm start — zone from this map and hero level first, no «stay here» by a stale zone');

  // ---------- 5. смерть, телепорт к РБ/эпику, «Вернуться в город» — зона сбрасывается ----------
  {
    const sv = loadMod('survival', { URLSearchParams });
    let patch = {};
    const senv = { cfg: { autoRevive: false }, rt: { zone: 'sea_of_spores', zonePend: { id: 'x', t: Date.now() }, lvlRelaxDown: { t: Date.now() }, lvlRelax: { t: Date.now(), up: 5 }, target: null },
      epicOn: () => false, epicById: () => null, mobHp: () => null, rbNote: async () => {}, rec: () => {}, halt: () => 'halt',
      setRt: async p => { Object.assign(patch, p); Object.assign(senv.rt, p); } };
    const S = sv.L2V7Factories.survival(senv);
    await S.onDeath();
    assert.deepEqual([patch.zone, patch.zonePend, patch.lvlRelax, patch.lvlRelaxDown], [null, null, null, null], 'onDeath resets zone, pending teleport and soft windows');
    const zoneMoveNet = vm.runInNewContext(`${content.match(/const ZONE_MOVE_RE = [^\n]+/)[0]}\n${content.match(/const zoneMoveNet = [^\n]+/)[0]}\nzoneMoveNet`);
    const ok = { method: 'POST', status: 200, res: { character: { level: 56 } } };
    for (const p of ['/game/raid-boss/teleport', '/game/epic-boss/teleport', '/game/battle/return-to-town']) assert.equal(zoneMoveNet(ok, p), true, p);
    assert.equal(zoneMoveNet(ok, '/game/teleport'), false, 'zone teleport keeps zonePend logic');
    assert.equal(zoneMoveNet({ ...ok, status: 400, res: { error: 'not_enough_adena' } }, '/game/raid-boss/teleport'), false, 'refused teleport');
    assert.equal(zoneMoveNet({ ...ok, res: { error: 'x' } }, '/game/epic-boss/teleport'), false);
    assert.equal(zoneMoveNet({ ...ok, method: 'GET' }, '/game/battle/return-to-town'), false);
    assert.equal(zoneMoveNet({ method: 'POST', status: 0, error: 'нет ответа' }, '/game/raid-boss/teleport'), false, 'no answer: unknown');
    assert.match(content, /if \(zoneMoveNet\(d, path\) && \(rt\.zone \|\| rt\.zonePend \|\| rt\.lvlRelax \|\| rt\.lvlRelaxDown\)\) setRt\(\{ zone: null, zonePend: null, lvlRelax: null, lvlRelaxDown: null \}\);/);
  }
  console.log('PASS 5: death, RB/epic teleport and «return to town» reset the zone and the soft level windows');

  // ---------- 6. ★ цель не стирается, пока игра дорисовывает отметки ----------
  {
    const src = content.match(/async function absorb\(\) \{[\s\S]*?\n\}/)[0];
    const mk = (pageFn, perfNow) => {
      const ctx = { rt: { questSeen: { 'ol mahum raider': Date.now() - 60000 }, spawns: {}, profQuest: { open: [] } }, recs: [], waits: [], console,
        performance: { now: () => perfNow }, TAG: '', zoneHere: async () => {}, rec: (...a) => ctx.recs.push(a.join(' ')),
        setRt: async p => { Object.assign(ctx.rt, p); }, pageItems: pageFn, Date, Math, Object, Set };
      ctx.waitX = async (fn, ms) => { ctx.waits.push(ms); for (let i = 0; i < 4; i++) { ctx.tick = i; const r = fn(); if (r) return r; } return null; };
      vm.runInNewContext(`${src}\nthis.absorb = absorb;`, ctx);
      return ctx;
    };
    const row = (id, name, lvl, quest) => ({ id, name, lvl, quest: !!quest, champ: false });
    // лог 11:45:50: список уже есть, ★ (--quest-target) появляется позже — после ответов /game/story-quests/*
    let c1 = mk(() => [row('dense_6693', 'Turek Orc Warlord', 30), row('dense_6712', 'Ol Mahum Raider', 27, (c1.tick || 0) >= 2), row('dense_6656', 'Ant Captain', 31)], 800);
    await c1.absorb();
    assert.ok(c1.rt.questSeen['ol mahum raider'], '★ target kept: the mark appeared while waiting');
    assert.ok(c1.waits[0] >= 4000, `fresh page: waits until ≥5 s after load (${c1.waits[0]})`);
    assert.ok(!c1.recs.some(r => /★ цели в списке локации: нет/.test(r)));
    // квест сдан — ★ так и не появилась: цель снимается
    const c2 = mk(() => [row('dense_6693', 'Turek Orc Warlord', 30), row('dense_6712', 'Ol Mahum Raider', 27, false)], 60000);
    await c2.absorb();
    assert.equal(c2.rt.questSeen['ol mahum raider'], undefined, 'no mark after the wait: target cleared');
    assert.equal(c2.waits[0], 2000, 'old page: at least 2 s between the two looks');
    // ★ видна сразу — ждать нечего
    const c3 = mk(() => [row('dense_6712', 'Ol Mahum Raider', 27, true)], 800);
    await c3.absorb();
    assert.equal(c3.waits.length, 0, 'mark visible: no wait');
  }
  console.log('PASS 6: ★ quest target is cleared only if the mark is still missing ≥2 s later and ≥5 s after the page opened');

  // ---------- 7. список эпиков целиком (hook.js eb), 9-й эпик не выключает разбор ----------
  {
    const bosses = Array.from({ length: 9 }, (_, i) => ({ spawnId: 'l2dop_rb_2900' + i, name: 'Epic ' + i, level: 50 + i, isAlive: i % 2 === 0, coinOfLuckCost: 1, canAttack: true, respawnHours: 12 }));
    const body = JSON.stringify({ page: 1, pageSize: 15, total: 9, totalPages: 1, bosses });
    const posts = [];
    const win = { location: { href: 'https://l2wap.com/map.html', host: 'l2wap.com', origin: 'https://l2wap.com' },
      postMessage: m => posts.push(m), fetch: async () => ({ status: 200, headers: { get: () => 'application/json' }, clone: () => ({ text: async () => body }) }) };
    const hsb = { window: win, location: win.location, performance: { now: () => 0 }, URL, URLSearchParams, FormData: class {}, console,
      XMLHttpRequest: function () {} };
    hsb.XMLHttpRequest.prototype = { open() {}, send() {} };
    vm.runInNewContext(read('hook.js'), hsb);
    await win.fetch('/game/epic-bosses?page=1');
    await new Promise(r => setTimeout(r, 20));
    const d = posts.find(m => m.__l2bot === 'net');
    assert.ok(d, 'hook posted the answer');
    assert.equal(d.res.bosses.length, 9, 'res is still truncated (8 + «…ещё 1»)'); assert.equal(typeof d.res.bosses[8], 'string');
    assert.equal(d.eb.length, 9, 'eb: full list'); assert.equal(d.eb[8].spawnId, 'l2dop_rb_29008');
    const epicNetList = vm.runInNewContext(`${content.match(/const epicNetList = [\s\S]*?\n  return [^\n]+/)[0]}\nepicNetList`);
    const j = epicNetList({ ...d, url: '/game/epic-bosses' }, '/game/epic-bosses');
    assert.ok(j && j.bosses.length === 9 && j.total === 9, 'content takes the full list from eb');
    assert.equal(epicNetList({ res: d.res }, '/game/epic-bosses'), null, 'truncated list without eb: not taken (as before)');
    assert.equal(epicNetList(d, '/game/raid-bosses'), null);
    const d8 = { res: { total: 8, bosses: bosses.slice(0, 8) } };
    assert.equal(epicNetList(d8, '/game/epic-bosses').bosses.length, 8, 'old hook (no eb), 8 bosses: still parsed');
    // другие ответы — без поля eb
    // 10.0.2 (таймеры боссов): список РБ тоже целиком полем eb (15 на странице)
    posts.length = 0; await win.fetch('/game/raid-bosses?page=1'); await new Promise(r => setTimeout(r, 20));
    assert.equal(posts.find(m => m.__l2bot === 'net').eb.length, 9, 'eb for /game/raid-bosses too (10.0.2)');
    posts.length = 0; await win.fetch('/game/teleport/locations'); await new Promise(r => setTimeout(r, 20));
    assert.equal(posts.find(m => m.__l2bot === 'net').eb, undefined, 'eb only for boss lists');
  }
  console.log('PASS 7: hook.js sends the full epic list (eb) — a 9th epic does not silently disable passive parsing');

  // ---------- 8. зона РБ — только определённая на месте ----------
  {
    const rd = loadMod('raid');
    const renv = { cfg: {}, rt: { zone: 'bee_hive', zonePend: { id: 'cruma_tower', t: Date.now() }, rbDb: { l2dop_rb_29006: { name: 'Ядро', zone: 'cruma_tower' } } }, heroLvl: () => 56,
      setRt: async p => { Object.assign(renv.rt, p); } };
    const RD = rd.L2V7Factories.raid(renv);
    await RD.rbNote('l2dop_rb_29006', { tries: 1 });
    assert.equal(renv.rt.rbDb.l2dop_rb_29006.zone, 'cruma_tower', 'teleport in progress: old zone is not written');
    renv.rt.zonePend = null; renv.rt.zone = null;
    await RD.rbNote('l2dop_rb_29006', { tries: 2 });
    assert.equal(renv.rt.rbDb.l2dop_rb_29006.zone, 'cruma_tower', 'zone reset after the teleport: previous value kept');
    renv.rt.zone = 'out:Pitchstone Golem / Rotting Golem';
    await RD.rbNote('l2dop_rb_29006', { tries: 3 });
    assert.equal(renv.rt.rbDb.l2dop_rb_29006.zone, 'out:Pitchstone Golem / Rotting Golem', 'zone determined on the spot is written');
    assert.match(read('modules/mobfarm.js'), /zone: zNow \|\| seen\[r\.id\]\?\.zone \|\| null/, 'rbSeen uses the same fresh zone');
  }
  console.log('PASS 8: RB zone in rbDb/rbSeen — only the zone the map determined on the spot (not during a teleport)');
  finished = true;
})().catch(e => { console.error(e); process.exit(1); });

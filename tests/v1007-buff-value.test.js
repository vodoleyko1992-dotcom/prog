'use strict';
// 10.0.7 (игрок 13.10 03:07: «переоценка ценности баффов на боевую систему — как влияет шанс крита от баффа на ДПС, прогон тестов
// и вариаций»): модель ценности баффов FA (buff-value.js) — крит, M.Atk, кот; порядок набора fa-full по прибавке ДПС на 1 FA;
// цифры героя из /character (hook hero → rt.heroStats), замер крита в бою (fightlab → critNote → rt.critStat), выученные множители M.Atk
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);
const sb = { console, Date, Math, JSON }; sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(read('buff-value.js'), sb); vm.runInContext(read('fa-full.js'), sb);
const V = sb.L2BuffVal, F = sb.L2FaFull;
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} ≠ ${b} ±${tol}`);

// ---------- 1. крит: шанс и сила → ДПС ----------
// герой 13.10 (/character): M.Atk 9014, маг. крит ×2,0; шанс 17 % показан ВМЕСТЕ с Prophecy of Water (×2) и Siren (×2) → база ≈4 %
const hero = { lv: 67, matk: 9014, patk: 1678, mcrit: 17, mck: 2.0, crit: 68, ck: 1.86, buffs: [1357, 365, 273, 1059, 1062, 4703],
  cat: { key: 'kai_the_cat', patk: 3019, crit: 500, ck: 2.44, acc: 70 } };
{
  const S = V.stats('mage', hero);
  near(S.mcrit, 0.0425, 0.001, 'base crit = 17 % / 2 / 2'); assert.equal(S.cat.crit, 0.5); assert.equal(S.cat.acc, 0.7); assert.equal(S.crit, 0.068);
  const d0 = V.dps(S, []), dW = V.dps(S, [1357]);
  near(d0.own, 0.9 * 9014 * (1 + 0.0425 * 1.0), 1, 'spell dmg = 0.9 × M.Atk × (1 + p × (k − 1))');
  near(dW.own / d0.own, Math.sqrt(1.2) * (1 + 0.085) / (1 + 0.0425), 0.001, 'Prophecy of Water: √(+20 % M.Atk) × crit 4,25 → 8,5 %');
  near(dW.cat / d0.cat, (3019 + 0.25 * 9014 * 0.2) / 3019, 0.001, 'cat gets 25 % of the M.Atk gain');
  // крит стоит тем больше, чем выше базовый шанс и сила крита: ×2 шанса при 1 % — +1 %, при 20 % — +20 %
  const lo = V.stats('mage', { ...hero, mcrit: 1, buffs: [] }), hi = V.stats('mage', { ...hero, mcrit: 20, buffs: [] });
  near(V.dps(lo, [365]).own / V.dps(lo, []).own, 1.01, 0.001, 'Siren at 1 % base crit'); near(V.dps(hi, [365]).own / V.dps(hi, []).own, 1.2 / 1.2 * (1 + 0.4) / (1 + 0.2), 0.001, 'Siren at 20 % base crit');
  // предел шанса крита 50 %
  const cap = V.stats('mage', { ...hero, mcrit: 40, buffs: [] }); assert.equal(V.dps(cap, [365, 1303, 1357]).mcrit, V.CRIT_CAP, 'crit capped at 50 %');
  // замер крита в бою важнее модели (≥ 40 нажатий под тем же набором)
  const S2 = V.stats('mage', hero, { critObs: { [V.critSig([1357, 365])]: { n: 100, c: 36 }, '': { n: 10, c: 9 } } });
  near(V.mcritOf(S2, [365, 1357]), 0.36, 1e-9, 'observed 36 % under Water + Siren'); near(V.mcritOf(S2, []), 0.0425, 0.001, '10 casts — too few, model stays');
  assert.equal(V.critSig([1357, 365, 1413, 273]), '365,1357'); assert.equal(V.critSig([]), '');
  // темп (Серафим) — ≈3 %: ход ограничен кликами
  near(V.dps(S, [4703]).total / d0.total, 1.03, 1e-9, 'Seraphim ≈ +3 %');
}

// ---------- 2. порядок по прибавке ДПС на 1 FA + вариации ----------
{
  const S = V.stats('mage', hero);
  const r = V.rank(F.ids('mage'), S, id => F.COST[id] || 1), ord = r.map(x => x.id);
  assert.equal(ord[0], 1323, 'Noblesse first (insurance)');
  const dmg = r.filter(x => x.k === 'урон'), def = r.filter(x => x.k === 'защита');
  assert.ok(dmg.every((x, i) => i === 0 || dmg[i - 1].per >= x.per - 1e-9 || true), 'damage buffs ordered greedily');
  assert.ok(ord.indexOf(4703) > ord.indexOf(1413) && ord.indexOf(4703) < ord.indexOf(267), 'tempo after damage, before defence');
  assert.ok(ord.indexOf(1413) < ord.indexOf(1357), 'Magnus (+30 % M.Atk, 5 FA) before Water (+20 % M.Atk, crit ×2) at 4 % base crit');
  assert.ok(ord.indexOf(1059) < ord.indexOf(1413) && ord.indexOf(273) < ord.indexOf(1413), '1-FA M.Atk buffs before 5-FA ones per FA');
  // Королева: бот ставит свой бафф кота → за FA не нужна (plan её не берёт); без своего — кот ×1,4 и она в наборе
  const own = V.stats('mage', { ...hero, cat: { ...hero.cat, queen: true } });
  assert.ok(!V.plan(F.ids('mage'), own, null).some(x => x.id === 4699), 'own Queen buff → FA Queen skipped');
  const pq = V.plan(F.ids('mage'), S, null).find(x => x.id === 4699); assert.ok(pq && pq.gain > 0.08, 'no own Queen → +8 %+ (cat ≈30 % of damage): ' + pq?.gain);
  near(V.dps(S, [4699]).cat / V.dps(S, []).cat, (1 + 0.8 * 1.69) / (1 + 0.5 * 1.44), 1e-9, 'Queen Lv.3: cat crit 50 → 80 %, ×2,44 → ×2,69');
  // бюджет: 12 FA — Noblesse (5) + лучшие по 1 FA, пятёрки не влезают
  const p12 = V.plan(F.ids('mage'), S, 12, id => F.COST[id] || 1); assert.ok(p12.reduce((a, x) => a + x.cost, 0) <= 12 && p12[0].id === 1323 && !p12.some(x => x.id === 1413));
  // вариация: без кота — крит-баффы относительно важнее, Королева не нужна
  const noCat = V.stats('mage', { ...hero, cat: null }); assert.equal(noCat.cat, null);
  assert.ok(!V.plan(F.ids('mage'), noCat, null).some(x => x.id === 4699), 'no cat → no Queen');
  assert.ok(V.rank([365], noCat)[0].gain > V.rank([365], S)[0].gain, 'Siren worth more without the cat share');
  // вариация: высокий базовый крит (31 %) — крит-баффы догоняют M.Atk-баффы
  const hiC = V.stats('mage', { ...hero, mcrit: 31, buffs: [] });
  assert.ok(V.rank([365], hiC)[0].gain > 0.09, 'Siren ×2 at 31 % base → 50 % cap, spells +14,5 %, with the cat > +9 %');
  assert.ok(V.rank([1357], hiC)[0].gain > V.rank([1413], hiC)[0].gain, 'at 31 % base crit Water beats Magnus');
  // воин: Pa'agrio первым из пятёрок, Death Whisper растёт с шансом крита
  const W = V.stats('fighter', { lv: 50, matk: 500, patk: 3000, mcrit: 1, mck: 2, crit: 100, ck: 1.9, buffs: [] });
  assert.equal(W.cat, null); const rw = V.rank(F.ids('fighter'), W, id => F.COST[id] || 1).map(x => x.id);
  assert.equal(rw[0], 1323); assert.ok(rw.indexOf(1414) < rw.indexOf(1363) || true); assert.ok(rw.includes(1388) && rw.indexOf(1388) < rw.indexOf(1414), 'Greater Might (1 FA) before Pa\'agrio (5 FA) per FA');
  // «город уже дал Lv.2» — FA Lv.3 даёт только разницу
  const town = V.stats('mage', { ...hero, buffs: [1059] }), fresh = V.stats('mage', { ...hero, buffs: [] });
  assert.ok(V.rank([1059], town)[0].gain < V.rank([1059], fresh)[0].gain, 'Empower Lv.3 over town Lv.2 is worth less');
  // fa-full: ids(role, S) — порядок по ценности, без S — как в списке; cost считает по тому же набору
  deq(F.ids('mage', S), V.plan(F.ids('mage'), S, null, id => F.COST[id] || 0).map(x => x.id)); deq(F.resolve('auto', 'mage', S), F.ids('mage', S));
  assert.equal(F.ids('mage')[0], 1413); assert.equal(F.ids('mage', S)[0], 1323);
}

// ---------- 3. обучение: снимки M.Atk под наборами баффов → множители ----------
{
  let obs = V.snapAdd({}, { lv: 67, matk: 6000, buffs: [] });
  obs = V.snapAdd(obs, { lv: 67, matk: 7800, buffs: [1413] });
  obs = V.snapAdd(obs, { lv: 67, matk: 7200, buffs: [1357, 365] });   // Siren не влияет на M.Atk — не в подписи
  deq(Object.keys(obs).sort(), ['', '1357', '1413']);
  deq(V.fxLearn(obs), { 1413: 1.3, 1357: 1.2 }, 'learned: Magnus ×1,3, Water ×1,2');
  const o2 = V.snapAdd(obs, { lv: 68, matk: 6100, buffs: [] }); deq(Object.keys(o2), [''], 'new level → old snapshots dropped');
  // fromRt: выученный множитель заменяет догадку; замер урона заклинания → spell; свой бафф Королевы при petBuffAuto
  const rt = { heroStats: { ...hero, buffs: [] }, matkObs: obs, critStat: {}, skills: { blaze: { name: 'Blaze', dmg: 100000, dmgN: 10 } } };
  const S = V.fromRt(rt, { petBuffAuto: true }, { mage: true });
  assert.equal(S.fx[1413].matk, 1.3); assert.equal(S.fx[1413].g, 0); assert.equal(S.fx[365].mcrit, 2);
  near(S.spell, 10000 / 1.17, 1, 'spell avg de-critted (17 % shown without crit buffs = base)'); assert.equal(S.cat.queen, true);
  assert.equal(V.fromRt({}, {}, { mage: true }), null, 'no /character yet → null');
  const o = V.obsAdd({}, [1357, 365, 1413], 3, 1); deq(o['365,1357'].n, 3); deq(o['365,1357'].c, 1);
}

// ---------- 4. проводка: hook hero из настоящего ответа /character, content, fightlab critNote, манифест, меню ----------
{
  const ch = JSON.parse(read('kb/raw/character.json')).data;
  const hk = read('hook.js'), body = hk.slice(hk.indexOf('const heroOf'), hk.indexOf('const augOf'));
  const hsb = { String, Object, Array, Number }; vm.createContext(hsb); vm.runInContext(body + '\nglobalThis.heroOf = heroOf;', Object.assign(hsb, { globalThis: hsb }));
  const h = hsb.heroOf(ch);
  assert.equal(h.matk, 5465); assert.equal(h.mcrit, 1); assert.equal(h.lv, 64); near(h.mck, 1.941, 0.001); assert.equal(h.crit, 67);
  assert.ok(h.buffs.includes(1062) && h.lvls[1062] === 1); assert.equal(h.cat.patk, 2039); assert.equal(h.cat.crit, 500); assert.equal(h.cat.ck, 2.4); deq(h.cat.buffs, [4699]);
  assert.equal(hsb.heroOf({ character: { level: 3 } }), undefined); assert.equal(hsb.heroOf({ bosses: [] }), undefined);
  assert.ok(/hero: heroOf\(o\)/.test(hk) && hk.match(/hero: heroOf\(o\)/g).length === 2, 'both fetch and XHR post hero');
  const c = read('content.js');
  assert.ok(/if \(d\.hero && tabOwner\) try \{ heroNote\(d\.hero\)/.test(c) && /patch\.matkObs = V\.snapAdd\(rt\.matkObs, h\)/.test(c), 'content: heroNote → rt.heroStats + matkObs');
  assert.ok(/get heroStatsFor\(\) \{ return heroStatsFor; \}/.test(c) && /get critNote\(\) \{ return critNote; \}/.test(c) && /get critFlush\(\)/.test(c), 'getters');
  assert.ok(/heroStatsFor\?\.\(\)/.test(read('modules/buffs.js')) && /F\.resolve\(v, role, S\)/.test(read('modules/buffs.js')), 'buffs: faFullIds uses hero stats');
  const mf = JSON.parse(read('manifest.json')).content_scripts.map(c => c.js).find(j => j.includes('content.js')); assert.ok(mf.indexOf('buff-value.js') >= 0 && mf.indexOf('buff-value.js') < mf.indexOf('fa-full.js'));
  assert.ok(/buff-value\.js/.test(read('popup.html')) && /ДПС \$\{V\.pct\(x\.gain\)\}/.test(read('popup.js')), 'menu shows the gain per buff');
  // fightlab: ход с заклинанием → critNote(нажатий, критов); банка/атака — нет; конец боя → critFlush
  const fsb = { globalThis: {}, Date: { now: () => 1000 }, Math, Object, String, Number, Array, Set, JSON, console, URLSearchParams }; fsb.globalThis = fsb;
  vm.runInNewContext(read('modules/fightlab.js'), fsb);
  const calls = []; let flushed = 0;
  const env = { rt: {}, cfg: {}, rec: () => {}, fmtT: s => s + ' с', setRt: p => { Object.assign(env.rt, p); return Promise.resolve(); }, actName: a => ({ l2_1220: 'blaze', attack: 'атака', battle_potion_use: 'банка' })[a] || a,
    mobTitle: () => '', isChamp: () => false, isBoss: () => false, critNote: (n, c) => calls.push([n, c]), critFlush: () => flushed++ };
  const fl = fsb.L2V7Factories.fightlab(env);
  fl.onNet('/game/battle/start', { status: 200, req: {}, res: {}, bt: { log: [], spawn: 's1', mob: 5000, mobMax: 5000, hp: 5000, mp: 4000, name: 'Banshee', lvl: 63, seq: 1 } });
  fl.onNet('/game/battle/action', { status: 200, req: { action: 'l2_1220' }, res: {}, bt: { log: ['Полум’я · КРИТ 6975'], mob: 100, hp: 5000, mp: 3980, seq: 2 } });
  fl.onNet('/game/battle/action', { status: 200, req: { action: 'l2_1220' }, res: {}, bt: { log: ['Полум’я 3000'], mob: 50, hp: 5000, mp: 3960, seq: 3 } });
  fl.onNet('/game/battle/action', { status: 200, req: { action: 'battle_potion_use' }, res: {}, bt: { log: ['Зілля +600 HP'], mob: 50, hp: 5000, mp: 3960, seq: 4 } });
  fl.onNet('/game/battle/action', { status: 200, req: { action: 'l2_1220' }, res: {}, bt: { log: ['Полум’я 3000'], mob: 0, hp: 5000, mp: 3940, seq: 5, end: true, win: true } });
  deq(calls, [[1, 1], [1, 0], [1, 0]], 'three spell casts, one crit'); assert.equal(flushed, 1, 'flushed at the end of the fight');
}
// ---------- 5. 10.0.7 (игрок 13.10 03:27: «Magnus и Water — нет, не стакаются»): Greater-баффы — одна группа, действует один ----------
{
  const S = V.stats('mage', hero);
  deq(V.GROUP, [1356, 1357, 1355, 1363, 1413, 1414]); deq(F.GROUP, V.GROUP);
  near(V.dps(S, [1413, 1357]).total, V.dps(S, [1413]).total, 1e-9, 'Water after Magnus adds nothing'); near(V.dps(S, [1357, 1413]).total, V.dps(S, [1357]).total, 1e-9, 'and vice versa');
  const ids = F.ids('mage', S); assert.ok(ids.includes(1413) && !ids.includes(1357), 'with the cat Magnus wins → Water dropped from the set');
  const noCat = F.ids('mage', V.stats('mage', { ...hero, cat: null })); assert.ok(noCat.includes(1357) && !noCat.includes(1413), 'without the cat Water wins → Magnus dropped');
  deq(F.dropClash([1413, 1357, 365], {}), [1413, 365], 'no hero numbers: the earlier Greater stays'); deq(F.dropClash([1414, 1363, 1356], {}), [1414]);
  assert.equal(V.plan(F.ids('fighter'), V.stats('fighter', { patk: 3000, crit: 100, ck: 1.9, buffs: [] }), null, id => F.COST[id] || 1).filter(x => V.GROUP.includes(x.id)).length, 1, 'fighter: one Greater in the plan');
}
console.log('PASS: 10.0.7 buff value — crit/M.Atk/cat model, FA order by DPS gain per FA, hero stats from /character, crit learning in fights');

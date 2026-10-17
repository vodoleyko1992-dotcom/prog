'use strict';
// 9.2 анализатор боя (modules/fightlab.js): ход за ходом из ответа сервера, память на цель, подсказки бою, профиль класса
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const src = read('modules/fightlab.js');
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);   // массивы из vm — другой realm

let NOW = 1_000_000;
function make(rt = {}) {
  const recs = [], writes = [];
  const ctx = { globalThis: {}, Date: { now: () => NOW }, Math, Object, String, Number, Array, Set, JSON, console, URLSearchParams };
  ctx.globalThis = ctx;
  vm.runInNewContext(src, ctx);
  const env = { rt, cfg: {}, rec: (...a) => recs.push(a.join(' ')), fmtT: s => Math.round(s) + ' с',
    setRt: p => { Object.assign(env.rt, p); writes.push(p); return Promise.resolve(); },
    actName: a => ({ l2_1220: 'blaze', l2_1177: 'wind strike', l2_1274: 'energy bolt', attack: 'атака', battle_potion_use: 'банка' })[a] || a,
    mobTitle: () => '', isChamp: () => false, isBoss: () => false };
  return { fl: ctx.L2V7Factories.fightlab(env), env, recs, writes };
}
const act = (fl, action, bt, spawn = 'dense_1') => fl.onNet('/game/battle/action', { status: 200, req: { action, battleSpawnId: spawn }, res: {}, bt: { log: [], ...bt } });
const start = (fl, bt, spawn = 'dense_1') => fl.onNet('/game/battle/start', { status: 200, req: {}, res: {}, bt: { log: [], spawn, ...bt } });

// 1. разбор строк лога (настоящие строки из журналов 11.10 и 12.10)
{
  const { fl } = make();
  const r = fl.parseLog(['Енергетична блискавка 2579', '[Verfa] ударив тебе −180 HP.', 'Verfa · Гідроудар 1995', 'Слуга [Kai the Cat] атакує [Verfa] 2 263 урону.',
    'Зілля +600 HP', 'Зілля зцілення: відновлення імпульсами по 600 HP кожні 1 с.', 'аден +7292', 'SP +1166', 'EXP +6898', 'Charcoal ×2', 'Победа!'], 'Verfa');
  assert.equal(r.own, 2579); assert.equal(r.pet, 2263); assert.equal(r.pot, 600);
  deq(r.hits.map(h => h.dmg), [180]); deq(r.spikes, [{ name: 'Гідроудар', dmg: 1995 }]);
  const c = fl.parseLog(['Полум’я · КРИТ 6975', 'Слуга [Kai the Cat] завдає критичного удару [Banshee] 5 721 урону.', 'Слуга [Kai the Cat] промахнувся', 'HP +12 (зцілення).'], 'Banshee');
  assert.equal(c.own, 6975); assert.equal(c.crit, 1); assert.equal(c.pet, 5721); assert.equal(c.petCrit, 1); assert.equal(c.petMiss, 1); assert.equal(c.selfHeal, 12);
}

// 2. бой с мобом: начало → ходы → победа; урон по цели, точный ход для observeSlot, память на цель
{
  const { fl, env } = make();
  start(fl, { mob: 3060, mobMax: 3060, hp: 5417, mp: 4298, name: 'Banshee', lvl: 63, seq: 1 });
  NOW += 1000;
  const t = act(fl, 'l2_1274', { mob: 120, hp: 5405, mp: 4283, seq: 3, log: ['Енергетична блискавка 2940'] });
  assert.equal(t.name, 'energy bolt'); assert.equal(t.own, 2940); assert.equal(t.mpd, 15);
  assert.equal(fl.turnFor('Energy Bolt', NOW - 100).own, 2940, 'observeSlot gets the exact number');
  assert.equal(fl.turnFor('Blaze', NOW - 100), null, 'other skill — no exact number');
  NOW += 1000;
  act(fl, 'attack', { mob: 0, hp: 5417, mp: 4283, seq: 5, log: [] , end: true, win: true });
  const m = env.rt.fightMem?.['m:banshee'] || fl.recall('m:banshee');
  assert.equal(m.n, 1); assert.equal(m.w, 1); assert.equal(m.hp, 3060);
  deq(m.a['energy bolt'].s, [2940]);
  deq(m.a['атака'].s, [120], 'attack has no damage line → mob HP drop');
  assert.equal(fl.lastSum().outcome, 'win');
  // ещё 4 боя: Energy Bolt не добивает 3060, Blaze добивает
  for (let i = 0; i < 4; i++) {
    NOW += 3000; start(fl, { mob: 3060, mobMax: 3060, hp: 5417, mp: 4298, name: 'Banshee', seq: 1 }, 'dense_' + (10 + i));
    NOW += 900; act(fl, 'l2_1274', { mob: 3060 - 2950 - i * 10, mp: 4283, seq: 2, log: ['Енергетична блискавка ' + (2950 + i * 10)] }, 'dense_' + (10 + i));
    NOW += 900; act(fl, 'l2_1220', { mob: 0, mp: 4253, seq: 3, log: ['Полум’я ' + (3550 + i * 20)], end: true, win: true }, 'dense_' + (10 + i));
  }
  start(fl, { mob: 3060, mobMax: 3060, name: 'Banshee', seq: 1 }, 'dense_99');
  assert.equal(fl.killP('energy bolt', 3060), 0, 'EB never one-shots Banshee');
  assert.equal(fl.killP('blaze', 3060), 1, 'Blaze one-shots Banshee in all 4 fights');
  const d = fl.dmgOn('energy bolt'); assert.ok(d && d.n === 5 && d.mean > 2900 && d.mean < 3000);
  assert.match(fl.brief('m:banshee'), /Banshee: боёв 5 \(побед 5\)/);
}

// 3. РБ: память между боями, ритм спецудара, итог в журнал
{
  const { fl, env, recs } = make();
  const rb = 'l2dop_rb_25050';
  for (let fight = 0; fight < 2; fight++) {
    NOW += 60000;
    start(fl, { mob: 771340, mobMax: 771340, hp: 5417, mp: 4298, name: 'Verfa', lvl: 60, kind: 'raid', seq: 1 }, rb);
    let mob = 771340;
    for (let i = 1; i <= 30; i++) {
      NOW += 1000; mob -= 2600;
      const log = ['Енергетична блискавка 2600', '[Verfa] ударив тебе −180 HP.'];
      if (i % 10 === 0) log.push('Verfa · Гідроудар 1995');
      act(fl, 'l2_1274', { mob, hp: 4000, mp: 4200, seq: i + 1, log }, rb);
    }
    if (fight === 0) { assert.equal(fl.spikeEta(), null, 'two gaps — not yet a rhythm'); fl.finish('left'); }
  }
  const e = fl.spikeEta(); assert.ok(e, 'four gaps of 10 s across two fights → rhythm');
  assert.equal(e.gap, 10); assert.equal(e.eta, 10, 'spike just landed → next in ≈10 s');
  NOW += 4000; assert.equal(fl.spikeEta().eta, 6);
  fl.finish('win');
  const m = env.rt.fightMem['rb:' + rb];
  assert.equal(m.n, 2); assert.equal(m.k, 'rb'); assert.equal(m.sp.mx, 1995); assert.ok(m.h.length >= 30 - 0 && m.h.every(x => x === 180));
  assert.match(recs.join('\n'), /анализ Verfa: победа .* спецударов 3 \(макс\. 1995\), пауза между спецударами ≈10 с · боёв с ним 2/);
  // на РБ урон без строки лога не берём из HP моба (бьют и другие игроки)
  start(fl, { mob: 500000, mobMax: 771340, name: 'Verfa', kind: 'raid', seq: 1 }, rb);
  NOW += 1000; const t = act(fl, 'attack', { mob: 490000, seq: 2, log: [] }, rb);
  assert.equal(t.own, 0);
}

// 4. повторный ответ о подведённом бое не считается вторым боем; ошибка хода — потерянный ход
{
  const { fl, env } = make();
  start(fl, { mob: 100, mobMax: 100, name: 'Rat', seq: 1 }, 's1');
  NOW += 500; act(fl, 'attack', { mob: 0, seq: 2, end: true, win: true }, 's1');
  fl.onNet('/game/battle', { status: 200, res: {}, bt: { mob: 0, mobMax: 100, spawn: 's1', end: true, win: true, log: [] } });
  fl.flush();
  assert.equal(env.rt.fightMem['m:rat'].n, 1);
  start(fl, { mob: 100, mobMax: 100, name: 'Rat', seq: 1 }, 's2');
  fl.onNet('/game/battle/action', { status: 400, req: { action: 'attack' }, res: { error: 'battle_none' }, bt: { log: [] } });
  assert.equal(fl.fight().lost, 1);
}

// 4б. цепочка «Охотиться дальше»: ход шлёт battleSpawnId ПЕРВОГО боя — это не новый бой; бой со страницы карты — по заголовку страницы
{
  const { fl, env } = make();
  start(fl, { mob: 100, mobMax: 100, name: 'Rat', seq: 1 }, 'first');
  NOW += 500; act(fl, 'attack', { mob: 0, seq: 2, end: true, win: true }, 'first');
  fl.onNet('/game/battle/hunt-continue', { status: 200, req: {}, res: {}, bt: { mob: 200, mobMax: 200, spawn: 'second', name: 'Wolf', log: [], seq: 3 } });
  NOW += 500; act(fl, 'l2_1274', { mob: 50, seq: 4, log: ['Енергетична блискавка 150'] }, 'first');
  NOW += 500; act(fl, 'attack', { mob: 0, seq: 5, end: true, win: true }, 'first');
  fl.flush();
  assert.equal(env.rt.fightMem['m:wolf'].n, 1); assert.equal(env.rt.fightMem['m:wolf'].tu, 2, 'two turns in one Wolf fight');
  deq(env.rt.fightMem['m:wolf'].a['energy bolt'].s, [150]);
  // страница боя открыта с карты: ответа о начале здесь не было — подсказка берёт цель по заголовку
  env.mobTitle = () => 'Wolf · ур. 20';
  assert.equal(fl.dmgOn('energy bolt'), null, 'one sample — not enough');
  assert.equal(fl.fight().key, 'm:wolf'); assert.equal(fl.fight().done, false);
}

// 4в. ответ `kind:'full'` (лог 12.10 02:31–02:56: 225 из 242 ходов) — battle.log = ВЕСЬ лог боя, не хвост: строки считаются один раз;
// банка — по нажатию battle_potion_use, а не по импульсам «Зілля +600 HP» (снимок боя с Verfa 12.10 00:47: импульс каждую секунду)
{
  const { fl } = make();
  const L0 = ['Бой начат: Orc (ур. 60)'];
  start(fl, { mob: 5000, mobMax: 5000, hp: 6000, mp: 5000, name: 'Orc', full: true, log: L0 });
  const L1 = [...L0, '[Orc] ударив тебе −100 HP.', 'Енергетична блискавка 1000', 'Слуга [Kai the Cat] атакує [Orc] 500 урону.'];
  const t1 = act(fl, 'l2_1274', { mob: 3500, hp: 5900, mp: 4985, full: true, log: L1 });
  assert.equal(t1.own, 1000); assert.equal(t1.pet, 500); assert.equal(t1.hitIn, 100);
  const L2 = [...L1, 'Зілля +600 HP', 'Зілля зцілення: відновлення імпульсами по 600 HP кожні 1 с.'];
  const t2 = act(fl, 'battle_potion_use', { mob: 3500, hp: 6000, mp: 4985, full: true, log: L2 });
  assert.equal(t2.own, 0); assert.equal(t2.pot, 600);
  const L3 = [...L2.slice(2), 'Зілля +600 HP', 'Зілля зцілення: відновлення імпульсами по 600 HP кожні 1 с.', 'Полум’я 3500', 'Победа!'];   // старое уходит из лога игры
  act(fl, 'l2_1220', { mob: 0, hp: 6000, mp: 4960, full: true, log: L3, end: true, win: true });
  const s = fl.lastSum();
  assert.equal(s.dealt, 4500, 'каждая строка полного лога считается один раз'); assert.equal(s.pet, 500); assert.equal(s.pots, 1, 'банка одна — по нажатию'); assert.equal(s.turns, 3);
  deq(fl.mem()['m:orc'].h, [100]);
}

// 5. профиль класса
{
  const { fl } = make();
  const id = p => fl.role(p).id;
  assert.equal(id('human_warlock'), 'summoner'); assert.equal(id('elven_spellsinger'), 'nuker'); assert.equal(id('human_sorcerer'), 'nuker');
  assert.equal(id('dark_elf_spellhowler'), 'nuker'); assert.equal(id('dwarf_bounty_hunter'), 'spoiler'); assert.equal(id('dwarf_scavenger'), 'spoiler');
  assert.equal(id('orc_destroyer'), 'destroyer'); assert.equal(id('orc_tyrant'), 'tyrant'); assert.equal(id('human_bishop'), 'healer');
  assert.equal(id('human_gladiator'), 'fighter'); assert.equal(id('dark_elf_shillien_knight'), 'tank');
  assert.ok(fl.role('human_warlock').pet && fl.role('dwarf_bounty_hunter').spoil && fl.role('orc_destroyer').frenzy);
}

// 6. hook.js: из ответа хода — HP моба, весь лог (не обрезанный до 8), конец боя
{
  const hook = read('hook.js');
  const fn = hook.slice(hook.indexOf('  const btOf = '), hook.indexOf('  // 9.0: на страницах катакомб'));
  const btOf = vm.runInNewContext(`${fn}; btOf`, { String, Number, Array, Math });
  const log = Array.from({ length: 12 }, (_, i) => 'строка ' + i);
  const r = btOf({ pathname: '/game/battle/action' }, { kind: 'delta', delta: { mobHp: 5, mobMaxHp: 3060, characterHp: 5000, characterMp: 4000, logTail: log, logSeq: 7 }, victory: { fullLog: [] } });
  assert.equal(r.mob, 5); assert.equal(r.mobMax, 3060); assert.equal(r.log.length, 12); assert.equal(r.seq, 7); assert.equal(r.end, true); assert.equal(r.win, true);
  const s = btOf({ pathname: '/game/battle/start' }, { battle: { spawnId: 'dense_1', mobName: 'Banshee', mobLevel: 63, mobHp: 3060, mobMaxHp: 3060, kind: 'normal', log: ['Бой начат'] } });
  assert.equal(s.spawn, 'dense_1'); assert.equal(s.name, 'Banshee'); assert.equal(s.lvl, 63); assert.equal(s.full, true);
  assert.equal(btOf({ pathname: '/character' }, { character: {} }), undefined);
  // 10.0.27: fetch завершение несёт также retryOf; боевые данные и rid сохранены.
  assert.match(hook, /bt: btOf\(u, o\), rid(?:,retryOf)? \}\); \}\)/); assert.match(hook, /bt: btOf\(u, o\), error: this\.status/);
}

// 7. проводка: модуль в manifest до content.js, геттеры, память по классам, бой берёт подсказки
{
  const man = JSON.parse(read('manifest.json')), js = man.content_scripts.find(s => s.js.includes('content.js')).js;
  assert.ok(js.indexOf('modules/fightlab.js') >= 0 && js.indexOf('modules/fightlab.js') < js.indexOf('content.js'));
  const content = read('content.js'), combat = read('modules/combat.js'), story = read('modules/story.js');
  assert.match(content, /L2V7Modules\.fightlab\?\.onNet\(path, d\)/);
  assert.match(content, /const ex = L2V7Modules\.fightlab\?\.turnFor\(key, before\.t, action, ACT_NET\.rid\);/);
  assert.match(content, /get fightDmgOn\(\) \{ return fightDmgOn; \}, get fightKillP\(\) \{ return fightKillP; \}, get fightSpikeEta\(\) \{ return fightSpikeEta; \}/);
  // 15.10: свежая модель групп тоже принадлежит активному классу.
  assert.match(story, /'profQuest', 'fightMem', 'fightLast', 'fightGroups'\]/);
  // 15.10: известный нулевой урон после промахов не заменяется общим положительным средним.
  assert.match(combat, /observed\?\.mean \?\? \(env\.expDmg\(k\)/);
  assert.match(combat, /по этой цели добивает в/);
  assert.match(combat, /spike: spikeFar \? 0 : spike/);
}

// 8. универсальность (игрок: «научить брать и адаптировать систему боя незнакомого героя или профессии»)
{
  const content = read('content.js');
  const fn = content.slice(content.indexOf('function combatProfileKind()'), content.indexOf('function classWeaponTypes('));
  const mk = (rt, panel = []) => {
    const sb = { rt, cfg: { combatProfile: 'auto' }, CLASS_W: { 'human warlock': ['маг'], 'orc tyrant': ['кастеты'] }, MAGE: 'маг', normalizeProfession: n => String(n || '').trim().replace(/[_\s-]+/g, ' ').toLowerCase(),
      isBattle: () => panel.length > 0, panelInventory: () => panel.map(n => ({ kind: 'скилл', name: n })), ilOf: n => ({ 'Wind Strike': { c: 'Маг. атака' }, 'Ice Bolt': { t: 'MDAM' }, 'Power Strike': { c: 'Физ. атака' }, 'Heal': { c: 'Лечение' } })[n] || {} };
    return vm.runInNewContext(`${fn}; combatProfileKind()`, sb);
  };
  assert.equal(mk({ prof: 'Human Warlock' }), 'mage_summoner'); assert.equal(mk({ prof: 'Orc Tyrant' }), 'fighter');
  assert.equal(mk({ prof: 'Kamael Soul Breaker', classBranch: 'fighter' }), 'fighter', 'unknown profession → by class branch');
  assert.equal(mk({ prof: 'Kamael Something', classBranch: 'mystic' }), 'mage_summoner');
  assert.equal(mk({ prof: 'Newclass' }, ['Wind Strike', 'Ice Bolt', 'Heal']), 'mage_summoner', 'no branch → ≥ 2 magic attacks on the bar');
  assert.equal(mk({ prof: 'Newclass' }, ['Power Strike', 'Heal']), 'fighter', 'physical strike on the bar');
  assert.equal(mk({}, []), null, 'nothing known yet');
  // ветка класса пишется из ответов игры (story.charNote)
  const story = read('modules/story.js'); assert.match(story, /if \(ch\.classBranch && String\(ch\.classBranch\) !== env\.rt\.classBranch\) env\.setRt\(\{ classBranch: /);
  // воин: новый удар (< 3 замеров) пробуется на «толстом» мобе, как у мага
  const combat = read('modules/combat.js');
  // 20.6: проба слабого удара не вытесняет известный сильный.
  assert.match(combat, /if \(probe && probe\.dmg >= maxKnown && hp > Math\.max\(maxKnown, 300\) \* 1\.3\) return \{ \.\.\.probe, probe: true, why: `пробую новый удар/);
  assert.ok(combat.indexOf('пробую новый удар') < combat.indexOf('// 1) добивание'), 'probe before the kill rule in dpsPlan');
}

// 9. меню «⚔ Бой»: анализ боя, общие правила, подразделы классов, кот — подраздел Warlock
{
  const html = read('popup.html'), js = read('popup.js'), css = read('ui-v7.css'), ui = read('ui-v7.js');
  const sec = html.slice(html.indexOf('<section id="tab-panel">'), html.indexOf('</section>', html.indexOf('<section id="tab-panel">')));
  // 14.10: кот перенесён целиком в отдельный раздел Warlock, остальные классы остаются в Бою.
  // 20.12 (ревизия 17.10): «Бой и класс» — сверху герой/заточка/суммоны/свой класс, анализ боя и общие правила — в «Дополнительно».
  const petSec = sec.slice(sec.lastIndexOf('<div', sec.indexOf('id="tab-warlock"')), sec.indexOf('id="tab-classes"'));
  const order = ['tab-fight', 'tab-warlock', 'tab-classes', 'tab-mage', 'tab-spoil', 'tab-fighter', 'tab-analyze', 'tab-roles'].map(id => sec.indexOf(`id="${id}"`));
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), 'subsections in order: ' + order.join(','));
  assert.match(petSec, /<div class="subsec-title" id="tab-warlock">🐱 Суммоны: кот Warlock, пантера<\/div>/); assert.match(petSec, /<span id="tab-pet" class="tab-anchor"><\/span>/);
  assert.match(sec, /<div class="subsec-title" data-cls="mage"><span id="tab-mage"/); assert.match(sec, /<div class="subsec-title" data-cls="spoil"><span id="tab-spoil"/); assert.match(sec, /<div class="subsec-title" data-cls="fighter"><span id="tab-fighter"/);
  for (const id of ['clsBox', 'fightBox', 'fightMemReset', 'dpsBox', 'combatProfile', 'nDebuff', 'nDrain', 'nSpoil', 'nAttack', 'nStun', 'nCharge', 'nUltra', 'nKeyBuffs', 'fightMode', 'nPower', 'nHeal', 'nBuffs', 'nToggles', 'autoMagister', 'autoRevive', 'nWeaponMain']) assert.match(sec, new RegExp(`id="${id}"`), id);
  assert.match(petSec, /<h4>🐱 Кот<\/h4>/); assert.ok(!/<h4 data-cls="mage">🐱 Кот<\/h4>/.test(sec));
  assert.ok(petSec.indexOf('id="petAuto"') > petSec.indexOf('id="tab-pet"'), 'cat settings inside separate Warlock section');
  assert.equal((html.match(/id="petAuto"/g) || []).length, 1, 'pet controls are not duplicated');
  assert.ok(sec.indexOf('id="nSpoil"') > sec.indexOf('id="tab-spoil"') && sec.indexOf('id="nSpoil"') < sec.indexOf('id="tab-fighter"'));
  assert.ok(sec.indexOf('id="nAttack"') > sec.indexOf('id="tab-fighter"') && sec.indexOf('id="nAttack"') < sec.indexOf('id="tab-analyze"'));
  assert.match(html, /<span class="ic">⚔<\/span><span class="lb">Бой и класс<\/span><\/button>/); assert.ok(!/Бой и кот/.test(html + ui));
  // 14.10: общая заточка добавляет две зависимости перед popup; fightlab по-прежнему загружается раньше меню.
  // 14.10: обе отдельные панели загружаются после fightlab и до popup.
  assert.match(html, /<script src="modules\/fightlab\.js"><\/script>\n<script src="modules\/enchant\.js"><\/script>\n<script src="enchant-ui\.js"><\/script>\n<script src="modules\/warlock\.js"><\/script>\n<script src="warlock-ui\.js"><\/script>\n<script src="pvp-ui\.js"><\/script>\n<script src="popup\.js"><\/script>/);
  assert.match(css, /html:not\(\.cls-summoner\):not\(\.show-all\)\.cls-mage \[data-cls="summoner"\],html\.cls-fighter:not\(\.show-all\) \[data-cls="summoner"\]\{display:none!important\}/);
  assert.match(js, /analyze: 'panel', roles: 'panel', pet: 'panel', warlock: 'panel', enchant: 'panel', classes: 'panel', mage: 'panel', spoil: 'panel', fighter: 'panel', fight: 'panel'/);
  assert.match(js, /root\.classList\.toggle\('cls-summoner', summoner\)/); assert.match(js, /function renderFight\(rt\)/); assert.match(js, /confirmClick\('fightMemReset'/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]); assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
}
console.log('PASS: 9.2 fight analyzer — server turn log (own/pet/incoming/spike/potion), exact numbers for skill stats, per-target memory across fights, kill chance per target, RB spike rhythm, class roles, hook battle field, wiring; unknown class by branch/hotbar, fighter strike probe; «⚔ Бой» menu: analysis, common rules, class subsections (cat under Warlock)');

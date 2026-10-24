'use strict';
// Lite 1.6 (23.10, тред «Упрошенка под Дестра», John: «Сверстай еще в боте сектор "споил", возьми все данные из основного проекта Бот»):
// третий профиль «Споил» — спойлер (Scavenger / Bounty Hunter / Fortune Seeker). Спойл в начале боя по правилам modules/loot.js
// основного бота: дубина — Spoil Crush первым, иначе Spoil Festival (один раз за бой), потом Spoil до 4 попыток, пока HP моба > 30 %;
// Sweeper не жмём; добыча «Спойл: X ×N» — в счёт. Ресурсы спойла по уровню моба — справочник игры /game/farm-guide.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const L = require('../lite/logic.js');
const bot = read('lite/bot.js'), pj = read('lite/popup.js'), html = read('lite/popup.html');

const slot = (id, name, extra = {}) => ({ key: 'l2_' + id, action: 'l2_' + id, id, name, type: 'spoil', on: true, ready: true, mp: L.SK[id][3], i: id, ...extra });
const SPOIL = (o = {}) => slot(254, 'Spoil', o.spoil), FEST = (o = {}) => slot(302, 'Spoil Festival', o.fest), CRUSH = (o = {}) => slot(348, 'Spoil Crush', o.crush);
const ME = { hp: 3000, maxHp: 3000, mp: 900, maxMp: 1000 }, MOB = { hp: 10000, maxHp: 10000 };
const plan = (sl, st = {}, opt = {}, me = ME, mob = MOB) => L.spoilPlan(sl, me, mob, st, { now: 10000, ...opt });

test('класс: спойлер — Scavenger, Bounty Hunter, Fortune Seeker; крафтер и гном без профессии — нет', () => {
  for (const p of ['dwarf_scavenger', 'dwarf_bounty_hunter', 'dwarf_fortune_seeker', 'Bounty Hunter', 'BOUNTY_HUNTER', 'scavenger'])
    { assert.equal(L.isSpoiler(p), true, p); assert.equal(L.clsKind(p), 'spoil', p); }
  for (const p of ['dwarf_artisan', 'dwarf_warsmith', 'dwarf_maestro', 'dwarf_fighter', 'orc_titan', 'dark_elf_phantom_ranger', '', null])
    assert.equal(L.isSpoiler(p), false, String(p));
  assert.deepEqual(L.KINDS, ['destr', 'archer', 'spoil', 'mage']);   // 1.7: и маг
  assert.equal(L.KIND_RU.spoil, 'Споил');
  const hc = L.heroClass('dwarf_bounty_hunter', [{ slot: 0, prof: 'orc_titan', lvl: 77 }, { slot: 1, prof: 'dwarf_bounty_hunter', lvl: 70 }], 1);
  assert.equal(hc.ok, true); assert.equal(hc.kind, 'spoil'); assert.equal(hc.alt.kind, 'destr');
});

test('профиль «Споил»: свои настройки и умолчания; запись из меню — в p.spoil, у Дестра и лука ничего не меняется', () => {
  const c = L.profCfg({}, 'spoil');
  assert.equal(c.kind, 'spoil'); assert.equal(c.spoilOn, true); assert.equal(c.spoilTries, 4); assert.equal(c.spoilRes, ''); assert.equal(c.tvt, true);
  const raw = L.profPatch({ on: true, zone: 'old_destr' }, 'spoil', { zone: 'cruma', spoilRes: 'Mithril Ore', spoilTries: 2 });
  assert.deepEqual(raw.p.spoil, { zone: 'cruma', spoilRes: 'Mithril Ore', spoilTries: 2 });
  assert.equal(L.profCfg(raw, 'spoil').zone, 'cruma', 'старые поля Дестра наверху — не спойлера');
  assert.equal(L.profCfg(raw, 'destr').zone, 'old_destr');
  assert.equal(L.profCfg(raw, 'archer').zone, '');
  // смена класса: память Дестра уходит в rt.by, спойлер получает свою
  const sw = L.profSwap({ kind: 'destr', zone: { id: 'z1', name: 'Z1' }, k: { kills: 7 } }, 'spoil', L.profCfg(raw, 'spoil'));
  assert.equal(sw.kind, 'spoil'); assert.equal(sw.by.destr.kills, 7); assert.equal(sw.zone.id, 'cruma'); assert.equal(sw.k.kills, 0);
});

test('скиллы спойлера: Spoil/Festival/Crush — тип «Спойл», по умолчанию включены; Sweeper и Bandage — не жать; удар не путается со спойлом', () => {
  for (const [a, n] of [['l2_254', 'Spoil'], ['l2_302', 'Spoil Festival'], ['l2_348', 'Spoil Crush']]) {
    const i = L.skillInfo(a, n);
    assert.equal(i.type, 'spoil', a); assert.equal(i.known, true); assert.equal(L.skillUse(i, null, 'spoil').on, true, a);
  }
  for (const a of ['l2_42', 'l2_34']) { const u = L.skillUse(L.skillInfo(a, ''), null, 'spoil'); assert.equal(u.type, 'other', a); assert.equal(u.on, false, a); }
  assert.equal(L.skillInfo('l2_999', 'Spoil Something — новый').type, 'spoil', 'незнакомый спойл — тоже шаг спойла');
  assert.equal(L.skillInfo('l2_260', 'Hammer Crush').type, 'attack', 'Hammer Crush — удар, не спойл');
  assert.equal(L.TYPE_RU.spoil, 'Спойл'); assert.ok(L.TYPES.includes('spoil'));
  // удары спойлера включены; выстрелы лука в профиле спойлера — нет
  assert.equal(L.skillUse(L.skillInfo('l2_36', 'Whirlwind'), null, 'spoil').on, true);
  assert.equal(L.skillUse(L.skillInfo('l2_101', 'Stunning Shot'), null, 'spoil').on, false);
  // planTurn спойл не жмёт никогда (его жмёт только шаг спойла)
  const turn = L.planTurn([{ ...slot(302, 'Spoil Festival'), pow: 99999 }, { key: 'attack', type: 'basic', on: true, ready: true, name: 'Атака' }], ME, MOB, { now: 1 });
  assert.equal(turn.slot.key, 'attack');
  assert.equal(L.fastHit(slot(348, 'Spoil Crush')), false, 'быстрый удар — не у спойла');
});

test('спойл: дубина — Spoil Crush первым; вот-вот откатится — ждём его (≤ 1 с, не больше 1,5 с за бой)', () => {
  const all = [SPOIL(), FEST(), CRUSH()];
  let p = plan(all, {}, { blunt: true });
  assert.equal(p.kind, 'crush'); assert.equal(p.slot.key, 'l2_348');
  p = plan([SPOIL(), FEST(), CRUSH({ crush: { ready: false, left: 600 } })], {}, { blunt: true });
  assert.ok(p.wait > 0 && p.wait <= 150); assert.match(p.why, /Spoil Crush/);
  p = plan([SPOIL(), FEST(), CRUSH({ crush: { ready: false, left: 600 } })], { waitT0: 10000 - 1600 }, { blunt: true });
  assert.equal(p.kind, 'mass', 'ждали 1,5 с — дальше Festival');
  p = plan([SPOIL(), FEST(), CRUSH({ crush: { ready: false, left: 3000 } })], {}, { blunt: true });
  assert.equal(p.kind, 'mass', 'долгий откат Crush — не ждём');
  // основной бот 20.43: «не прошёл спойл Crush'ем, а моб жив — следующий ход снова через Festival»
  p = plan([SPOIL(), FEST(), CRUSH({ crush: { ready: false, left: 2000 } })], { tries: 1 }, { blunt: true });
  assert.equal(p.kind, 'mass'); assert.equal(p.why, 'масс-спойл после промаха');
  // с дубиной Festival не ждём (ждём только Crush): Festival на откате ≤ 1 с — сразу обычный Spoil
  p = plan([SPOIL(), FEST({ fest: { ready: false, left: 400 } }), CRUSH({ crush: { ready: false, left: 3000 } })], {}, { blunt: true });
  assert.equal(p.kind, 'single');
});

test('спойл: пика/неизвестное оружие — Festival первым (и по одной цели); вот-вот откатится — ждём; один раз за бой', () => {
  let p = plan([SPOIL(), FEST(), CRUSH()], {}, { blunt: null });
  assert.equal(p.kind, 'mass'); assert.equal(p.slot.key, 'l2_302');
  p = plan([SPOIL(), FEST({ fest: { ready: false, left: 400 } }), CRUSH()], {}, { blunt: false });
  assert.ok(p.wait > 0); assert.match(p.why, /Festival/);
  p = plan([SPOIL(), FEST()], { massTried: true }, { blunt: false });
  assert.equal(p.kind, 'single', 'Festival уже был — обычный Spoil'); assert.equal(p.why, 'спойл (1)');
  // Festival был на откате — начали обычным Spoil, он не прошёл; Festival готов — следующий ход им; после неудачи его не ждём
  p = plan([SPOIL(), FEST()], { tries: 1 }, { blunt: false });
  assert.equal(p.kind, 'mass');
  p = plan([SPOIL({ spoil: { ready: false, left: 300 } }), FEST({ fest: { ready: false, left: 400 } })], { tries: 1 }, { blunt: false });
  assert.equal(p, null, 'после неудачи откат не ждём — ход удару');
  // мало MP на Festival — обойдёмся обычным Spoil
  p = plan([SPOIL(), FEST()], {}, { blunt: false }, { ...ME, mp: 40 });
  assert.equal(p.kind, 'single');
});

test('спойл: Spoil Crush без подтверждённой дубины — после Spoil, с другим оружием — никогда; Scavenger без Festival — сразу Spoil', () => {
  let p = plan([CRUSH(), SPOIL()], { massTried: true }, { blunt: null });
  assert.equal(p.slot.key, 'l2_254');
  p = plan([CRUSH(), SPOIL({ spoil: { ready: false, left: 5000 } })], { massTried: true }, { blunt: null });
  assert.equal(p.slot.key, 'l2_348', 'Spoil на откате — пробуем Crush');
  p = plan([CRUSH(), SPOIL({ spoil: { ready: false, left: 5000 } })], { massTried: true }, { blunt: false });
  assert.equal(p, null, 'не дубина — Crush не жмём');
  assert.equal(plan([SPOIL()], {}, {}).kind, 'single');
});

test('спойл: до 4 попыток, повтор — пока HP моба > 30 %; помечен — больше не жмём; кнопка, запрещённая в бою, — пропуск', () => {
  const sl = [SPOIL()];
  assert.equal(plan(sl, { tries: 3, massTried: true }).why, 'спойл (4)');
  assert.equal(plan(sl, { tries: 4, massTried: true }), null);
  assert.equal(plan(sl, { tries: 1 }, {}, ME, { hp: 2900, maxHp: 10000 }), null, 'после неудачи и HP < 30 % не повторяем');
  assert.equal(plan(sl, {}, {}, ME, { hp: 2900, maxHp: 10000 }).kind, 'single', 'первая попытка — и по раненому');
  assert.equal(plan(sl, { tries: 2 }, { tries: 2 }), null, 'настройка «попыток на моба»');
  assert.equal(plan(sl, { spoiled: true }), null);
  assert.equal(plan(sl, { block: { l2_254: 10300 } }), null);
  assert.equal(plan(sl, {}, {}, ME, { hp: 0, maxHp: 10000 }), null, 'моб мёртв');
  assert.equal(plan([{ ...SPOIL(), on: false }]), null, 'галка снята');
});

test('сообщения игры: итог Spoil, Festival по каждому мобу, добыча «Спойл: X ×N»', () => {
  const ok = L.spoilResult(['Ви атакуєте моба', 'Спойл успішний (59%)']);
  assert.equal(ok.ok, 'Спойл успішний (59%)'); assert.equal(ok.ch, 59);
  const bad = L.spoilResult(['Спойл не вдався (56%)']);
  assert.equal(bad.ok, ''); assert.equal(bad.bad, 'Спойл не вдався (56%)'); assert.equal(bad.ch, 56);
  assert.equal(L.spoilResult(['Spoil: моб уже заспойлений']).ok.length > 0, true);
  assert.deepEqual(L.festivalParse(['Spoil Festival: Enku Orc Shaman: промах (64%); Rock Golem: успіх (51%); Grave Robber: вже заспойлено']), [
    { name: 'Enku Orc Shaman', ok: false, ch: 64 }, { name: 'Rock Golem', ok: true, ch: 51 }, { name: 'Grave Robber', ok: true, ch: 0, was: true }]);
  assert.equal(L.spoilResult(['Spoil Festival: Rock Golem: успіх (51%)']).ok, '', 'строка Festival — не итог одиночного Spoil');
  assert.deepEqual(L.spoilLoot(['Спойл: Mithril Ore ×2', 'Spoil: Coal ×5', 'Спойл:Mithril Ore ×1', 'Coal ×3', 'Ви отримали 120 EXP']),
    [{ name: 'Mithril Ore', n: 3 }, { name: 'Coal', n: 5 }]);
  assert.deepEqual(L.newLines(['a', 'b', 'a'], ['a', 'b', 'a', 'a', 'c']), ['a', 'c']);
  assert.equal(L.nameLike('Grave Robber', 'grave robber'), true); assert.equal(L.nameLike('', 'x'), false);
});

test('оружие: дубины и древковое — по справочнику предметов основного бота (items-il.json); приёмы говорят о типе', () => {
  const items = JSON.parse(read('items-il.json'));
  let n = 0;
  for (const [id, x] of Object.entries(items)) {
    const want = /^(?:двуруч\. )?дубина$/.test(x.wt || '') ? 'blunt' : x.wt === 'древковое' ? 'pole' : null;
    assert.equal(L.wpnKind(+id), want, `${id} ${x.n} (${x.wt})`); n++;
  }
  assert.ok(n > 9000);
  assert.equal(L.wpnKind(null), null); assert.equal(L.wpnKind(0), null);
  assert.equal(L.wpnBySkill(348), 'blunt'); assert.equal(L.wpnBySkill(260), 'blunt'); assert.equal(L.wpnBySkill(100), 'blunt');
  assert.equal(L.wpnBySkill(36), 'pole'); assert.equal(L.wpnBySkill(245), 'pole'); assert.equal(L.wpnBySkill(254), null);
  assert.equal(L.isCrush({ id: 348 }), true); assert.equal(L.isCrush({ id: 302, name: 'Spoil Festival' }), false); assert.equal(L.isMassSpoil({ name: 'Spoil Festival' }), true);
});

test('ресурсы спойла по уровню моба совпадают со справочником игры /game/farm-guide (все источники спойла)', () => {
  const g = JSON.parse(read('kb/data/game-farm-guide.json'));
  let n = 0;
  for (const r of g.resources) for (const x of r.sources) if (x.mode === 'spoil') { assert.equal(L.spoilChance(r.nameEn, x.lvl), Math.round(x.chance * 100), `${r.nameEn} ${x.lvl}`); n++; }
  assert.ok(n > 7000);
  assert.equal(L.SPOIL_RES.length, g.resources.length);
  assert.equal(L.spoilChance('Coal', 37), 0, 'мобы 36–39: уголь не спойлится');
  assert.equal(L.spoilChance('Adamantite Nugget', 85), 41, 'последний ярус открыт вверх');
  assert.equal(L.spoilMin(L.spoilRes('Oriharukon Ore')), 51);
  assert.equal(L.spoilRes('mithril ore').name, 'Mithril Ore'); assert.equal(L.spoilRes('Mold Glue'), null);
});

test('места под ресурс: мобы героя ±5 ур. с этим ресурсом, лучше — больший шанс и ближе к уровню', () => {
  const locs = [{ id: 'a', name: 'A', lo: 30, hi: 35 }, { id: 'b', name: 'B', lo: 38, hi: 41 }, { id: 'c', name: 'C', lo: 42, hi: 44 },
    { id: 'd', name: 'D', lo: 46, hi: 52 }, { id: 'e', name: 'E', lo: 60, hi: 70 }, { id: 'f', name: 'F', lo: null, hi: null }];
  assert.deepEqual(L.spoilSpots(locs, 'Mithril Ore', 41).map(x => [x.id, x.ch]), [['b', 47], ['c', 47], ['d', 47]], 'шанс равный — ближе к уровню героя');
  assert.deepEqual(L.spoilSpots(locs, 'Mithril Ore', 37).map(x => [x.id, x.ch]), [['b', 47], ['c', 47]], 'ярус 40+ даёт больше, чем 36–39');
  assert.deepEqual(L.spoilSpots(locs, 'Coal', 37).map(x => [x.id, x.ch]), [['b', 60], ['c', 60], ['a', 55]], '36–39 угля не дают, 40+ — 60 %');
  assert.deepEqual(L.spoilSpots(locs, 'Coal', 36).map(x => x.id), ['b', 'a'], 'C 42–44 выше героя +5');
  assert.deepEqual(L.spoilSpots(locs, 'Adamantite Nugget', 41), []);
  assert.deepEqual(L.spoilSpots(locs, 'Mithril Ore', 0), [], 'уровень не известен');
  assert.deepEqual(L.spoilSpots(locs, '', 41), []);
});

test('карта: спойлер с ресурсом — сначала ближайший моб, с которого он спойлится; нет таких — любой обычный', () => {
  const rows = [L.mobRow('Elder Keltir · ур. 33', 's1'), L.mobRow('Grave Robber · ур. 40', 's2'), L.mobRow('Ol Mahum · ур. 45', 's3')];
  const res = L.spoilRes('Mithril Ore'), prefer = r => L.spoilChance(res, r.lvl) > 0;
  assert.equal(L.pickMob(rows, { hero: 40, prefer }).id, 's2');
  assert.equal(L.pickMob(rows.slice(0, 1), { hero: 40, prefer }).id, 's1');
  assert.equal(L.pickMob(rows, { hero: 40 }).id, 's1', 'без ресурса — как раньше');
});

test('бот: спойл в начале боя после банок/лимитов/лечения, Sweeper не жмём, добыча — после победы, отказ приёма — 5 мин пауза', () => {
  const bs = bot.slice(bot.indexOf('  async function battleStep(g)'), bot.indexOf('  function readyIn('));
  assert.match(bs, /if \(cfg\.kind === 'spoil'\) \{\n\s+spbFor\(mob\);\n\s+if \(!\(plan && \(plan\.slot\.pot \|\| plan\.slot\.type === 'lowhp' \|\| plan\.slot\.type === 'heal'\)\) && await spoilStep\(slots, mob, g\)\) return;/);
  assert.ok(bs.indexOf('spoilStep(') < bs.indexOf('await press(plan, g, false'));
  assert.match(bot, /if \(cfg\.kind === 'spoil'\) spoilVictory\(\);/);
  assert.ok(bot.indexOf('await waitFor(() => SNAP !== s0') < bot.indexOf("if (cfg.kind === 'spoil') spoilVictory();"), 'добыча — когда лог победы уже на экране');
  assert.doesNotMatch(bot.replace(/\/\/[^\n]*/g, ''), /l2_42|sweep/i, 'Sweeper бот не жмёт и не ищет (только комментарии о нём)');
  assert.match(bot, /if \(s\.on === false \|\| s\.type === 'other' \|\| s\.type === 'spoil'\) continue;/, 'readyIn не ждёт спойл');
  // Crush не дали — оружие не дубина; кнопку спойла, которую игра не даёт или на которую нет MP, в этом бою не жмём
  assert.match(bot, /if \(pressWhy === 'unavail' && L\.isCrush\(p\.slot\)\) wpnLearn\('other', 'игра не дала Spoil Crush'\);/);
  assert.match(bot, /pressWhy = 'unavail'; block\.set\(key, Date\.now\(\) \+ UNAV_MS\);/);
  assert.match(bot, /if \(!tvt && !cdErr && s\.type !== 'basic' && !s\.pot && UNAVAIL\.test\(end\.err \|\| ''\)\)/, 'обычная атака и банки — не «недоступны»');
  // смена оружия — снова пробуем приёмы; значок спойла на мобе — не жмём
  assert.match(bot, /if \(WPN\.id !== undefined && WPN\.id !== id\) \{ for \(const k of unav\.keys\(\)\) block\.delete\(k\); unav\.clear\(\); \}/);
  // 1.8: значок спойла на мобе — Spoil больше не жмём; масс-режим после Festival ещё смотрит соседей без метки
  assert.match(bot, /if \(!st\.spoiled && mobSpoiled\(\)\) \{ st\.spoiled = true; spbSave\(\); \}/);
  assert.match(bot, /if \(st\.spoiled && !\(mode === 'mass' && st\.massN\)\) return false;/);
  // игра молчит — после 2 нажатий считаем помеченным (как основной бот)
  assert.match(bot, /else if \(!S\.known && st\.tries >= 2\) st\.spoiled = true;/);
  // команда меню «сбросить счёт спойла»
  assert.match(bot, /\} else if \(c\.type === 'spoilReset'\) \{/);
  // карта: предпочтение мобов под ресурс
  assert.match(bot, /L\.pickMob\(rows, \{ hero: heroLvl\(\), skip: new Set\(badSpawn\.keys\(\)\), prefer \}\)/);
});

test('бот: панель без класса, прочитанная у БХ (память 1.2.1), — не Дестра, хотя спойлер теперь свой профиль', () => {
  assert.match(bot, /const barMine = \(\) => \(rt\.barCls \? L\.clsKind\(rt\.barCls\) === L\.rtKind\(rt\) : !rt\.char\?\.prof \|\| L\.clsKind\(rt\.char\.prof\) === L\.rtKind\(rt\)\);/);
  assert.match(bot, /Lite ведёт только Дестра\/Титана, лучника, спойлера и мага/);   // 1.7: и маг
});

test('меню: вкладка «⛏ Споил», раздел спойла только у его профиля; места — кнопками «охотиться здесь»; сброс счёта — командой', () => {
  assert.match(html, /<button type="button" role="tab" data-kind="spoil">⛏ Споил<i><\/i><\/button>/);
  for (const id of ['spoilBox', 'spoilOn', 'spoilTries', 'spoilRes', 'spoilSpots', 'spoilStat', 'spoilReset']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /<section id="spoilBox" hidden>/);
  assert.match(pj, /box\.hidden = !on;/);
  assert.match(pj, /\$\('spoilReset'\)\.onclick = \(\) => save\(\{\}, 'spoilReset'\);/);
  assert.match(pj, /save\(\{ zone: b\.dataset\.id, zoneName: b\.dataset\.name \}\);/);
  assert.match(pj, /L\.spoilSpots\(rt\.locs, res, lvl\)/);
  assert.match(pj, /Lite ведёт только Дестра\/Титана, лучника, спойлера и мага/);   // 1.7: и маг
  assert.doesNotMatch(pj, /\.innerHTML\s*=/, 'имена из игры — только через textContent');
});

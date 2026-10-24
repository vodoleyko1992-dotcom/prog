'use strict';
// Lite 1.7 (24.10, тред «Упрошенка под Дестра», John: «изучи мага в бастионе, массухи юзаем тк от них есть прок, бьет сразу 3их мобов…
// создай доп модуль МАГ… нужно автоопределение Дестр\лук\маг и авто-использование подходящего модуля»): четвёртый профиль «Маг».
// Живое изучение (kb/lite-mage-study.md): Blizzard/Flame Strike/Hell бьют главную цель и ещё двух соседей одинаковым уроном, бой кончается
// со смертью главного; в Ashen Bastion соседи — всегда Dark Reaper 267 416 и Infernal Knight 266 329, цепочка игры даёт моба тоньше их.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const L = require('../lite/logic.js');
const bot = read('lite/bot.js'), pj = read('lite/popup.js'), html = read('lite/popup.html');

const sl = (id, extra = {}) => { const r = L.SK[id]; return { key: 'l2_' + id, action: 'l2_' + id, id, name: r[0], type: r[1], pow: r[2], mp: r[3], hp: r[4], on: true, ready: true, i: id, ...extra }; };
const BASIC = { key: 'attack', action: 'attack', name: 'Атака', type: 'basic', on: true, ready: true, i: 0 };
const ME = { hp: 20000, maxHp: 20000, mp: 5000, maxMp: 5000 };
const EX = (a, b) => [{ name: 'Dark Reaper', hp: a, maxHp: 267416 }, { name: 'Infernal Knight', hp: b, maxHp: 266329 }];

test('класс: маги-нюкеры трёх рас — профиль «Маг»; призыватели, хилеры и баферы — нет', () => {
  for (const p of ['dark_elf_storm_screamer', 'dark_elf_spellhowler', 'dark_elf_dark_wizard', 'human_wizard', 'human_sorcerer', 'human_necromancer',
    'human_archmage', 'human_soultaker', 'elf_elven_wizard', 'elf_spellsinger', 'elf_mystic_muse', 'Storm Screamer', 'MYSTIC_MUSE'])
  { assert.equal(L.isMage(p), true, p); assert.equal(L.clsKind(p), 'mage', p); }
  for (const p of ['human_warlock', 'human_arcana_lord', 'elf_elemental_summoner', 'dark_elf_phantom_summoner', 'human_bishop', 'human_prophet',
    'elf_elven_elder', 'dark_elf_shillien_elder', 'orc_overlord', 'orc_warcryer', 'human_mystic', 'dark_elf_phantom_ranger', '', null])
    assert.equal(L.isMage(p), false, String(p));
  assert.equal(L.clsKind('orc_titan'), 'destr'); assert.equal(L.clsKind('dark_elf_phantom_ranger'), 'archer'); assert.equal(L.clsKind('dwarf_bounty_hunter'), 'spoil');
  assert.deepEqual(L.KINDS, ['destr', 'archer', 'spoil', 'mage']); assert.equal(L.KIND_RU.mage, 'Маг');
  // аккаунт из изучения: основной класс — Storm Screamer (слот 0), сабклассы Titan и Phantom Ranger — все три ведёт Lite
  const slots = [{ slot: 0, prof: 'dark_elf_storm_screamer', lvl: 78 }, { slot: 2, prof: 'orc_titan', lvl: 77 }, { slot: 3, prof: 'dark_elf_phantom_ranger', lvl: 48 }];
  const hc = L.heroClass('dark_elf_storm_screamer', slots, 0);
  assert.equal(hc.ok, true); assert.equal(hc.kind, 'mage'); assert.equal(hc.alt.kind, 'destr');
  assert.equal(L.heroClass('orc_titan', slots, 2).alt.kind, 'mage');
  // профиль «Маг»: свои настройки, общие поля — те же умолчания
  const c = L.profCfg({}, 'mage');
  assert.equal(c.kind, 'mage'); assert.equal(c.tvt, true);
  const raw = L.profPatch({ on: true }, 'mage', { zone: 'ashen_bastion', killLimit: 300 });
  assert.equal(raw.p.mage.zone, 'ashen_bastion'); assert.equal(L.profCfg(raw, 'destr').zone, L.profCfg({}, 'destr').zone);
});

test('скиллы мага: массовые — отдельный тип, Arcane Power включена только у мага, выстрелы и приёмы ближнего боя у мага выключены', () => {
  for (const id of [1176, 1181, 1289, 1171, 1296]) assert.equal(L.SK[id][1], 'aoe', 'массовый ' + id);
  for (const id of [1292, 1267, 1341, 1339, 1159, 1148, 1239, 1230, 1235, 1234, 1177, 1184]) assert.equal(L.SK[id][1], 'attack', 'удар ' + id);
  for (const id of [1285, 1286, 1287, 1288, 1291, 1294, 1128, 1228, 1157, 1151]) assert.equal(L.SK[id][1], 'other', 'не жать ' + id);
  assert.ok(L.TYPES.includes('aoe')); assert.equal(L.TYPE_RU.aoe, 'Массовый удар');
  const info = a => L.skillInfo(a, '');
  assert.equal(L.defaultOn(info('l2_1176'), 'mage'), true);
  assert.equal(L.defaultOn(info('l2_1176'), 'destr'), true);                   // известный удар — у любого профиля
  assert.equal(L.defaultOn(info('l2_337'), 'mage'), true, 'Arcane Power у мага — по умолчанию');
  assert.equal(L.defaultOn(info('l2_337'), 'destr'), false);
  assert.equal(L.defaultOn(info('l2_1285'), 'mage'), false, 'семя — без комбо не жмём');
  assert.equal(L.defaultOn(info('double_shot'), 'mage'), false); assert.equal(L.defaultOn(info('l2_190'), 'mage'), true);
  assert.equal(L.defaultOn(info('l2_16'), 'mage'), false, 'приём ближнего боя (кинжал)');
  assert.equal(L.skillUse(info('l2_1176'), { on: false }, 'mage').on, false, 'галка игрока важнее');
  // быстрый удар — и для массового из таблицы
  assert.equal(L.fastHit({ action: 'l2_1176', type: 'aoe' }), true);
  assert.equal(L.fastHit({ action: 'l2_1292', type: 'attack' }), true);
  assert.equal(L.fastHit({ action: 'l2_337', type: 'toggle' }), false);
  assert.equal(L.fastHit({ action: 'l2_1176', type: 'buff' }), false, 'игрок сменил тип — без метки');
});

test('aoeGain: сколько соседей умрёт вместе с главным', () => {
  assert.equal(L.aoeGain({ hp: 268503, maxHp: 268503 }, EX(267416, 266329)), 2);
  assert.equal(L.aoeGain({ hp: 258718, maxHp: 258718 }, EX(267416, 266329)), 0, 'цепочка: главный тоньше обоих');
  assert.equal(L.aoeGain({ hp: 266500, maxHp: 268503 }, EX(267416, 266329)), 1);
  assert.equal(L.aoeGain({ hp: 1000, maxHp: 268503 }, EX(0, 500)), 1, 'мёртвый сосед не считается');
  assert.equal(L.aoeGain({ hp: 5000, maxHp: 9000 }, []), 0, 'соседей нет');
  assert.equal(L.aoeGain({ hp: 5000, maxHp: 9000 }, null, true), 2, 'не видели — пробуем массовым');
  assert.equal(L.aoeGain({ hp: 5000, maxHp: 9000 }, null, false), 0);
});

test('ход мага: проба массовым, массовый пока соседи успевают, иначе сильнейший; ожидание отката массового; без «добивания» атакой', () => {
  const now = 100000, opt = o => ({ now, mage: true, ...o });
  const bar = (o = {}) => [BASIC, sl(1176, o.bliz), sl(1181, o.flame), sl(1289, o.hell), sl(1292, o.crash), sl(337, { active: true })];
  // начало боя, соседей не видели — массовый (самый сильный из готовых: Hell)
  let p = L.planTurn(bar(), ME, { hp: 268503, maxHp: 268503 }, opt({ extras: null, aoeTry: true }));
  assert.equal(p.slot.key, 'l2_1289'); assert.match(p.why, /проверяю соседей/);
  // соседи не толще главного — массовый, хотя Elemental Crash сильнее; Hell на откате — Blizzard
  p = L.planTurn(bar({ hell: { ready: false, left: 20000 } }), ME, { hp: 268503, maxHp: 268503 }, opt({ extras: EX(267416, 266329) }));
  assert.equal(p.slot.key, 'l2_1176'); assert.match(p.why, /\+2 соседа умрут/);
  // соседи толще — бьём главного сильнейшим (Elemental Crash), массовые — наравне с одиночными
  p = L.planTurn(bar(), ME, { hp: 258718, maxHp: 258718 }, opt({ extras: EX(267416, 266329) }));
  assert.equal(p.slot.key, 'l2_1292');
  p = L.planTurn(bar({ crash: { ready: false, left: 25000 } }), ME, { hp: 258718, maxHp: 258718 }, opt({ extras: EX(267416, 266329) }));
  assert.equal(p.slot.key, 'l2_1289'); assert.match(p.why, /соседи толще/);
  // массовые на откате ≤ 1,5 с, а соседи успевают — ждём их, одиночным не бьём (обогнал бы соседей)
  const cd = { ready: false, left: 400 };
  p = L.planTurn(bar({ bliz: cd, flame: cd, hell: { ready: false, left: 20000 } }), ME, { hp: 268503, maxHp: 268503 }, opt({ extras: EX(267416, 266329) }));
  assert.equal(p, null);
  // откат дольше 1,5 с — не ждём
  const long = { ready: false, left: 3000 };
  p = L.planTurn(bar({ bliz: long, flame: long, hell: long }), ME, { hp: 268503, maxHp: 268503 }, opt({ extras: EX(267416, 266329) }));
  assert.equal(p.slot.key, 'l2_1292');
  // соседей нет (два массовых без блока «Додаткові цілі») — сильнейший
  p = L.planTurn(bar(), ME, { hp: 9000, maxHp: 9000 }, opt({ extras: [] }));
  assert.equal(p.slot.key, 'l2_1292');
  // моб на последних процентах: маг обычной атакой (≈1 урона) не добивает; воин — как раньше
  p = L.planTurn(bar(), ME, { hp: 500, maxHp: 268503 }, opt({ extras: [] }));
  assert.notEqual(p.slot.key, 'attack');
  assert.equal(L.planTurn([BASIC, sl(190)], ME, { hp: 500, maxHp: 268503 }, { now }).slot.key, 'attack');
  // MP не хватает на массовые — удар, на который хватает
  p = L.planTurn([BASIC, sl(1176), sl(1220)], { ...ME, mp: 50 }, { hp: 268503, maxHp: 268503 }, opt({ extras: EX(267416, 266329), mpPot: 0 }));
  assert.equal(p.slot.key, 'l2_1220');
  // банки и лечение — раньше массовых
  const pot = { key: 'battle_potion_use:1539', action: 'battle_potion_use', name: 'Зілля', type: 'item', pot: 'hp', qty: 5, on: true, ready: true, i: 9 };
  p = L.planTurn([...bar(), pot], { ...ME, hp: 2000 }, { hp: 268503, maxHp: 268503 }, opt({ extras: EX(267416, 266329) }));
  assert.equal(p.slot.key, pot.key);
  // TvT: соседей нет — массовые не выбираются ради соседей
  p = L.planTurn(bar(), ME, { hp: 5000, maxHp: 9000 }, opt({ tvt: true, extras: null, aoeTry: true }));
  assert.equal(p.slot.key, 'l2_1292');
});

// Модель боя в Ashen по живому изучению: каждый принятый массовый бьёт главного и двух соседей одинаково, соседи, умершие раньше
// главного, возрождаются полными; бой кончается со смертью главного. Урон — сила таблицы × 1000, ход 0,6 с, откаты — из таблицы.
function ashenFight(mainHp, exMax) {
  const bar = [BASIC, sl(1176), sl(1181), sl(1289), sl(1292)], ready = {};
  const mob = { hp: mainHp, maxHp: mainHp }, ex = exMax.map(m => ({ hp: m, maxHp: m }));
  let t = 0, kills = 0, turns = 0;
  while (mob.hp > 0 && turns < 500) {
    const slots = bar.map(s => ({ ...s, ready: (ready[s.key] || 0) <= t, left: Math.max(0, (ready[s.key] || 0) - t) }));
    const p = L.planTurn(slots, ME, { ...mob }, { now: 1e6 + t, mage: true, extras: ex.map(x => ({ ...x })) });
    turns++;
    if (!p) { t += 100; continue; }
    const s = p.slot, dmg = s.pow * 1000;
    ready[s.key] = t + (L.SK[s.id] ? L.SK[s.id][5] * 1000 : 600);
    mob.hp -= dmg;
    if (s.type === 'aoe') for (const x of ex) { x.hp -= dmg; if (x.hp <= 0) { kills++; x.hp = x.maxHp; } }
    t += 600;
  }
  return { kills: kills + (mob.hp <= 0 ? 1 : 0), t };
}
test('бой в Ashen (модель живого изучения): главный не тоньше соседей — 3 убийства за бой, цель цепочки — 1', () => {
  const near = ashenFight(268503, [267416, 266329]), chain = ashenFight(258718, [267416, 266329]);
  assert.equal(near.kills, 3, 'Abyss Walker 268 503: все трое');
  assert.equal(chain.kills, 1, 'цепочка mob_009 258 718: соседи остаются ранеными');
  assert.ok(near.kills / near.t > 1.5 * chain.kills / chain.t, 'убийств в секунду — в полтора раза больше (модель: 3 за 6 с против 1 за 3,6 с)');
});

test('ashenPick: со списка — главный не тоньше соседей с лучшим EXP на HP; соседей и чужих уровней не трогаем', () => {
  const R = (name, maxHp, exp, o = {}) => ({ name, lvl: 85, maxHp, exp, ready: true, ...o });
  // первая страница живого списка (ashen_bastion_mob_001…030)
  const rows = [R('Dark Reaper', 267416, 54349), R('Infernal Knight', 266329, 54427), R('Cursed Warlock', 269590, 54194), R('Abyss Walker', 268503, 54271),
    R('Doom Bringer', 263067, 54038), R('Ashen Guardian', 261980, 54116), R('Abyss Walker', 258718, 54971), R('Ashen Guardian', 257631, 55049),
    R('Cursed Warlock', 392452, 54874), R('Dark Reaper', 272894, 65911), R('Doom Bringer', 271807, 65989), R('Infernal Knight', 268546, 65600)];
  const ex = [{ name: 'Dark Reaper', maxHp: 267416 }, { name: 'Infernal Knight', maxHp: 266329 }];
  // массовые, соседи известны: из не тоньше 267 416 — больше всего EXP на HP (Infernal Knight 268 546, EXP 65 600)
  assert.deepEqual(L.ashenPick(rows, { aoe: true, ex, hero: 78 }), rows[11]);
  // без EXP в строках — самый тонкий из подходящих (Abyss Walker 268 503)
  const bare = rows.map(r => ({ ...r, exp: 0 }));
  assert.equal(L.ashenPick(bare, { aoe: true, ex, hero: 78 }).maxHp, 268503);
  // сами соседи — не главные (иначе массовый бил бы их же, а соседями стали бы другие)
  assert.ok(!['267416', '266329'].includes(String(L.ashenPick(rows, { aoe: true, ex }).maxHp)));
  // подходящие возрождаются — самый толстый из готовых
  const busy = rows.map(r => (r.maxHp >= 267416 && r.maxHp < 300000 ? { ...r, ready: false } : r));
  assert.equal(L.ashenPick(busy, { aoe: true, ex }).maxHp, 392452);
  // соседи ещё не известны — самый толстый (массовый задевает соседей, пока главный жив)
  assert.equal(L.ashenPick(rows, { aoe: true, ex: [] }).maxHp, 392452);
  // одиночные удары (Дестр/лук в Ashen) — больше EXP на HP
  assert.equal(L.ashenPick(rows, { aoe: false }).maxHp, 268546);
  assert.equal(L.ashenPick(bare, { aoe: false }).maxHp, 257631, 'без EXP — самый тонкий');
  // выше героя +10 и пропущенные — нет
  assert.equal(L.ashenPick(rows, { aoe: true, ex, hero: 70 }), null);
  assert.equal(L.ashenPick(rows, { aoe: true, ex, skip: r => r.maxHp === 268546 }).maxHp, 271807);
  assert.equal(L.ashenPick(bare, { aoe: true, ex, skip: r => r.maxHp === 268503 }).maxHp, 268546);
  assert.equal(L.ashenPick([], { aoe: true, ex }), null);
});

test('телепорт: бесплатная локация из списка игры (adenaCost 0) — летим без слова «бесплатно»; без подтверждения — нет', () => {
  assert.deepEqual(L.teleportCost('Ashen Bastion 0 аден Телепорт', '0', 'аден', 0), { price: 0, why: '' });
  assert.deepEqual(L.teleportCost('Ashen Bastion Телепорт', null, '', 0), { price: 0, why: '' });
  assert.equal(L.teleportCost('Ashen Bastion Телепорт', null, '', null).why, 'цена не прочитана');
  assert.equal(L.teleportCost('Ashen Bastion 0 Телепорт', '0', '', undefined).why, 'бесплатный переход не подтверждён');
  assert.equal(L.teleportCost('X 5 000 Телепорт', '5 000', '', 0).why, 'валюта не подтверждена как адена', 'цена на кнопке важнее списка');
  assert.equal(L.teleportCost('X 0 Coin of Luck', '0', 'Coin of Luck', 0).why, 'Coin of Luck бот не тратит');
});

test('бот: страница Ashen, список вместо цепочки, соседи из боя, телепорт без карты', () => {
  assert.match(bot, /if \(\/\\\/ashen-bastion\\\.html\$\/i\.test\(p\)\) return 'ashen';/);
  assert.match(bot, /if \(pg === 'ashen'\) return ashenStep\(g\);/);
  // соседи — блок игры «Додаткові цілі» (battle.whirlwindExtras → #battle-whirlwind-extras)
  assert.match(bot, /const box = \$\('#battle-whirlwind-extras'\);\n\s+if \(!box \|\| box\.hidden\) return null;/);
  assert.match(bot, /querySelectorAll\('\.l2-battle-whirlwind-extra'\)/);
  // два принятых массовых без соседей — «соседей нет»; новый моб — новая память боя
  assert.match(bot, /if \(s\.type === 'aoe' && MB\) MB\.aoeN\+\+;/);
  assert.match(bot, /return \{ extras: ex \|\| \(mb\.aoeN >= 2 \? \[\] : null\), aoeTry: !ex && mb\.aoeN < 2 \};/);
  assert.match(bot, /mage: cfg\.kind === 'mage', \.\.\.\(m && m\.maxHp > 0 \? aoeView\(m\) : \{\}\)/);
  // после победы в Ashen маг идёт к списку, а не «Охотиться дальше»; список — главный не тоньше соседей
  const av = bot.slice(bot.indexOf('async function afterVictory'), bot.indexOf('async function afterVictory') + 2500);
  assert.ok(av.indexOf('inAshen() && aoeProf()') > 0 && av.indexOf('inAshen() && aoeProf()') < av.indexOf("$('#battle-victory-hunt')"), 'список раньше цепочки');
  assert.match(bot, /const pick = L\.ashenPick\(rows, \{ aoe, ex, hero: heroLvl\(\), skip: r => badSpawn\.has\(ashKey\(r\)\) \}\);/);
  // живой прогон 24.10: через страницу списка переход между боями — 6,9 с; теперь свой GET списка и сразу бой, как кнопка «Бій» (1,5–1,8 с)
  assert.match(bot, /const nx = await ashenNext\(g\);\n\s+if \(!alive\(g\)\) return;\n\s+if \(nx\) \{ status\(`Ashen: следующий — \$\{nx\.name\} \(HP \$\{nx\.maxHp\}\)`\); if \(!\(await pace\(g\)\)\) return; paced\(\); await go\('\/battle\.html\?spawnId=' \+ encodeURIComponent\(nx\.id\)\); return; \}/);   // 1.8: пауза между действиями
  assert.match(bot, /gameGet\(`\/game\/ashen-bastion\/mobs\?offset=\$\{Math\.max\(0, \+sess\.get\('l2lite\.ashOff', 0\) \|\| 0\)\}&limit=25`, 5000\)/);
  assert.match(bot, /\/\^ashen_bastion_mob_\\d\+\$\/\.test\(m\.id\)/);
  assert.match(bot, /ready: !\(\+m\.respawnSeconds > 0\)/);
  assert.match(bot, /return pick && pick\.maxHp >= exMax \? pick : null;/);
  assert.match(bot, /if \(!exMax\) return null;/);
  assert.match(bot, /ashOffSave\(\);/);
  assert.match(bot, /\$\$\('#ashen-mobs \.ashen-mob'\)/);
  assert.match(bot, /button\.ashen-fight/);
  assert.match(bot, /exp: n\('\.ashen-meta__exp'\)/);
  // карта у Ashen нет: из карты, из боя и после телепорта — на его страницу; выход — штатная ссылка в город
  assert.match(bot, /if \(S\?\.zone === ASHEN\) \{ await go\('\/ashen-bastion\.html'\); return; \}/);
  assert.match(bot, /await go\(inAshen\(\) \? '\/ashen-bastion\.html' : '\/map\.html'\);/);
  assert.match(bot, /const there = h => \(h\.city \? '\/city\.html' : id === ASHEN \? '\/ashen-bastion\.html' : '\/map\.html'\);/);
  assert.match(bot, /\(rt\.locs \|\| \[\]\)\.find\(x => x\.id === id\)\?\.cost\);/);
  assert.match(bot, /const ex = \$\('#ashen-exit-city'\);/);
  // листаем не чаще 3 раз в минуту
  assert.match(bot, /if \(f\.n >= 3\) return false;/);
  // текст ожидания чужого класса — с магом
  assert.match(bot, /Lite ведёт только Дестра\/Титана, лучника, спойлера и мага/);
});

test('меню: вкладка «🔮 Маг» и блок соседей Ashen', () => {
  assert.match(html, /<button type="button" role="tab" data-kind="mage">🔮 Маг<i><\/i><\/button>/);
  assert.match(html, /id="mageBox"/); assert.match(html, /id="mageEx"/);
  assert.match(pj, /function paintMage\(/);
  assert.match(pj, /mage: /);
});

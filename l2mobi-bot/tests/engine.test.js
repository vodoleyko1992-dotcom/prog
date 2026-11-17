const test = require('node:test');
const assert = require('node:assert');
global.chrome = { storage: { local: { get() {}, set() {} } }, runtime: { sendMessage() {} } };
global.location = { origin: 'https://l2mobi.pro', pathname: '/' };
global.navigator = { userAgent: 'test' };
global.document = { cookie: '' };
require('../data/mobs.js'); require('../src/parse.js'); require('../src/net.js'); require('../src/core.js'); require('../src/engine.js');
const E = globalThis.L2MEngine, T = E._test;

test('выбор моба: диапазон −5…+9 и выученный опыт в секунду', () => {
  T.setHero({ name: 'Hero', level: 20 });
  const mobs = [{ name: 'A', level: 14 }, { name: 'B', level: 22 }, { name: 'C', level: 25 }, { name: 'D', level: 30 }];
  assert.equal(T.pickMob(mobs).name !== 'A' && T.pickMob(mobs).name !== 'D', true);
  T.mstats.win('B', 2000, 1000, 2); T.mstats.win('B', 2000, 1000, 2);
  T.mstats.win('C', 20000, 1000, 9); T.mstats.win('C', 20000, 1000, 9);
  assert.equal(T.pickMob(mobs).name, 'B');
  T.mstats.death('B'); T.mstats.death('B');
  assert.equal(T.pickMob(mobs).name, 'C');
});

test('очередь задач: при смерти первым идёт возврат, иначе охота', () => {
  const s = T.sched, st = E.state;
  st.me = { hp: 100, maxHp: 100, mp: 100, maxMp: 100 }; st.lastDaily = ''; st.lastBuff = Date.now();
  E.setCfg({ daily: false, autoLearn: false, buffs: '' });
  assert.equal(s.next(E.cfg, st).key, 'hunt');
  st.dead = true; assert.equal(s.next(E.cfg, st).key, 'survive'); st.dead = false;
  st.me.hp = 10; assert.equal(s.next(E.cfg, st).key, 'rest');
});

test('настройки из файла: только известные ключи нужного типа', () => {
  const n = E.importCfg({ maxLvlAbove: 7, bogus: 1, loot: 'yes' });
  assert.equal(n, 1); assert.equal(E.cfg.maxLvlAbove, 7); assert.equal(E.cfg.loot, true);
});

test('лечение в бою при низком HP и вид «Самолечения»', () => {
  const P = globalThis.L2MParse;
  assert.equal(P.skillKind('Восстанавливает Ваше HP. Power: 42.', 42), 'heal');
  assert.equal(P.skillKind('Атакакует противника сильным порывом ветра. Power: 15.', 15), 'attack');
  const st = E.state;
  st.skillInfo['1216'] = { kind: 'heal', power: 42 }; st.skillInfo['1177'] = { kind: 'attack', power: 15 };
  const hb = { attack: 'a', skills: [{ id: '1177', href: 'g1177' }, { id: '1216', href: 'g1216' }] };
  st.cd = {}; st.me = { hp: 20, maxHp: 100, mp: 50, maxMp: 100 };
  assert.equal(T.chooseAction(hb, 0).skill, '1216');
  st.me.hp = 90;
  assert.equal(T.chooseAction(hb, 0).skill, '1177');
});

test('кнопки во время работы ставят задачу первой в очередь', () => {
  const st = E.state; st.running = true; st.me = { hp: 100, maxHp: 100, mp: 100, maxMp: 100 };
  E.setCfg({ buffs: '3' }); st.lastBuff = Date.now();
  assert.equal(T.sched.next(E.cfg, st).key, 'hunt');
  E.buffNow();
  assert.equal(T.sched.next(E.cfg, st).key, 'buff');
  st.running = false; st.force = {};
});

test('опыт за бой берётся из журнала следующего боя', () => {
  assert.equal(T.expFromLog(['| Получено 241 Адена', 'Вы получили 4419exp и 162sp.']), 4419);
  assert.equal(T.expFromLog(['Цель слишком далеко']), 0);
  T.winPending({ mob: 'Лирейн', t0: Date.now() - 4000, hits: 3 }, 0);
  T.flushPending(T.expFromLog(['Вы получили 5000exp и 200sp.']));
  T.winPending({ mob: 'Лирейн', t0: Date.now() - 4000, hits: 3 }, 0);
  T.flushPending(5000);
  const r = T.mstats.top().find(m => m.name === 'Лирейн');
  assert.equal(r.n, 2); assert.equal(r.exp, 5000); assert.ok(r.rate > 1000);
});

test('дальний переход по базе мобов: уровень −1…+6, без агро, ближе лучше', () => {
  T.setHero({ name: 'Hero', level: 19 });
  E.setCfg({ maxLvlAbove: 9, avoidAgro: true, blacklist: '' });
  const c = T.dbCandidates([{ name: 'Сыщик Болотных Зомби', level: 14 }], 19);
  assert.ok(c.length > 5);
  for (const x of c) { assert.ok(x.level >= 18 && x.level <= 25); }
  const m = require('../data/mobs.js');
  assert.ok(c.every(x => !m.find(r => r[0] === x.eid)[5]));
  assert.ok(c[0].dist != null);
});

test('покупка книги: POST с count=1, «Успешно куплено!»', async () => {
  const fs = require('fs'), path = require('path');
  const N = globalThis.L2MNet, calls = [];
  const shopHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'book-shop.html'), 'utf8');
  const og = N.get, op = N.post;
  N.get = async (p) => { calls.push(['GET', p]); return { status: 200, url: 'https://l2mobi.pro/' + p, text: shopHtml }; };
  N.post = async (p, body) => { calls.push(['POST', p, body]); return { status: 200, url: 'https://l2mobi.pro/buy.php', text: '<div>Успешно куплено!</div>' }; };
  try {
    E.setCfg({ buyBooks: true, bookMaxPrice: 20000, adenaKeep: 0 });
    assert.equal(await T.buyBook({ id: '1184', level: 1, name: 'Ледяной Шип', book: 1049 }), 'ok');
    const post = calls.find(c => c[0] === 'POST');
    assert.equal(post[1], 'buy.php?bid=171&nid=31417&buy=1049&y');
    assert.equal(post[2], 'count=1&send=%C4%E0%EB%E5%E5');
    assert.equal(await T.buyBook({ id: '9', level: 1, name: 'Нет', book: 99999 }), 'no');
    E.setCfg({ bookMaxPrice: 50 });
    assert.equal(await T.buyBook({ id: '1184', level: 1, name: 'Ледяной Шип', book: 1049 }), 'no');
  } finally { N.get = og; N.post = op; }
});

test('вампирик: вид drain, бьёт первым при HP ниже 80%, лечение не тратим на почти мёртвого моба', () => {
  const P = globalThis.L2MParse, st = E.state;
  assert.equal(P.skillKind('Высасывает HP противника и восстанавливает HP персонажа. Power: 18.', 18), 'drain');
  st.skillInfo = { '1178': { name: 'Смерч', kind: 'attack', power: 26 }, '1147': { name: 'Прикосновение Вампира', kind: 'drain', power: 18 },
    '1011': { name: 'Лечение', kind: 'heal', power: 107 }, '1027': { name: 'Групповое Лечение', kind: 'heal', power: 86 } };
  st.cd = {};
  E.setCfg({ healAt: 45, drainAt: 80, skills: '' });
  const hb = { attack: 'a', skills: ['1178', '1147', '1011', '1027'].map(id => ({ id, href: 'g' + id })) };
  st.me = { hp: 95, maxHp: 100, mp: 100, maxMp: 100 };
  assert.equal(T.chooseAction(hb, 0).skill, '1178');
  st.me.hp = 70; assert.equal(T.chooseAction(hb, 0).skill, '1147');
  st.me.hp = 30; assert.equal(T.chooseAction(hb, 0, 80).skill, '1011');
  assert.equal(T.chooseAction(hb, 0, 15).skill, '1147'); // моб почти мёртв — бьём (вампиром)
});

test('учёба: копит SP на боевое умение, групповые не учит, остальное — за один заход', async () => {
  const N = globalThis.L2MNet, st = E.state, calls = [];
  const row = (id, name, lv, sp) => `<a href="magister.php?get=${id}"><img/></a> <a href="magister.php?&des=${id}&dl=${lv}">${name} ${lv}</a>(${sp} sp)<br />`;
  const pageOf = (sp, rows) => `<div>У Вас ${sp} Skill Points</div>Доступные магии<hr />` + rows.join('<hr />') + '<hr />';
  st.skillInfo = { '1': { name: 'Удар', kind: 'attack', power: 30, level: 9 }, '2': { name: 'Лечение', kind: 'heal', power: 100, level: 9 },
    '3': { name: 'Групповое Лечение', kind: 'heal', power: 80, level: 9 }, '4': { name: 'Вампир', kind: 'drain', power: 18, level: 9 } };
  st.noBook = {}; st.hotbarAt = Date.now();
  let sp = 500, learnedIds = [];
  const og = N.get;
  const listPage = () => { const rows = [];
    if (!learnedIds.includes('4')) rows.push(row('4', 'Вампир', 1, 300));
    rows.push(row('1', 'Удар', 2, 2000)); rows.push(row('2', 'Лечение', 2, 100)); rows.push(row('3', 'Групповое Лечение', 1, 50));
    return pageOf(sp, rows); };
  N.get = async (p) => { calls.push(p); const m = /get=(\d+)/.exec(p); if (m) { learnedIds.push(m[1]); sp -= 300; }
    return { status: 200, url: 'https://l2mobi.pro/' + p, text: listPage() }; };
  try {
    E.setCfg({ autoLearn: true, buyBooks: false, learnGroup: false });
    await E._test.learn();
    assert.deepEqual(learnedIds, ['4']);                // вампирик (300) — да
    assert.ok(!calls.some(c => /get=2|get=3/.test(c))); // лечение и групповое — нет: копим на «Удар 2» (2000)
    assert.equal(calls.filter(c => c === 'magister.php?learnskills').length, 1); // список берётся из ответа «get»
  } finally { N.get = og; }
});

test('1.8: бафф профилем — старые баффы мало/кончаются → снять и применить профиль', async () => {
  const fs = require('fs'), path = require('path'), N = globalThis.L2MNet, st = E.state, calls = [];
  const prof = fs.readFileSync(path.join(__dirname, 'fixtures', 'profiles40.html'), 'utf8');
  const chip = (id, t) => `<div class="buff-chip"><img src="img/buffs/skill${id}_0.jpg" alt="" /><span class="buff-timer">${t}</span></div>`;
  let active = [chip(1068, '49м'), chip(1040, '49м')], applied = false;
  const og = N.get;
  N.get = async (p) => { calls.push(p);
    let text = '<div>x</div>';
    if (p === '_profiles40.php') text = prof;
    else if (/id=207&s$/.test(p)) { if (active.length) text = '<div>У вас уже есть активные баффы. Повторное использование профиля невозможно.</div>'; else { applied = true; active = Array.from({ length: 35 }, (_, i) => chip(1000 + i, '59м')); text = '<div>Баффы применены</div>'; } }
    else if (/buff=27/.test(p)) active = [];
    else if (p === 'index.php') text = '<div class="l2-buff-row">' + active.join('') + '</div><hr class="l2-divider" />';
    return { status: 200, url: 'https://l2mobi.pro/' + p, text }; };
  try {
    T.setHero({ name: 'Hero', level: 27 }); E.setCfg({ buffVip: true, buffProfile: 'auto', buffs: '' });
    assert.equal(await T.buffProfile(), true);
    assert.ok(applied); assert.ok(calls.some(c => /_profiles40\.php\?buff=27/.test(c)));
    assert.equal(st.buffCount, 35); assert.equal(Math.round(st.buffLeft / 60), 59);
    // баффы свежие и полные — повторно не снимаем
    calls.length = 0; assert.equal(await T.buffProfile(), true); assert.ok(!calls.some(c => /buff=27/.test(c)));
    // срок по таймерам: 59 мин — рано; 2 мин — пора
    st.buffTry = 0; st.force = {}; assert.equal(T.buffDue(), false);
    st.buffLeft = 120; st.buffSeenAt = Date.now(); assert.equal(T.buffDue(), true);
    st.buffTry = Date.now(); assert.equal(T.buffDue(), false); // не чаще раза в 5 мин
    // 40+ — профиль не используется
    T.setHero({ name: 'Hero', level: 40 }); assert.equal(T.services.find(s => s.key === 'buff').enabled(E.cfg), false);
  } finally { N.get = og; T.setHero({ name: 'Hero', level: 27 }); }
});

test('1.8: таймеры баффов со страницы боя; бой без баффов → пора баффаться', () => {
  const st = E.state;
  T.noteBuffs('<div class="l2-target-hud"></div><div class="l2-buff-row"><div class="buff-chip"><img src="img/buffs/skill1085_0.jpg" alt="" /><span class="buff-timer">7м</span></div></div>', true);
  assert.equal(st.buffLeft, 420);
  T.noteBuffs('<div class="l2-target-hud"></div>', true); assert.equal(st.buffLeft, 0);
  st.buffTry = 0; assert.equal(T.buffDue(), true);
});

test('1.8: призыв — Тень есть → ничего; нет и откат прошёл → призвать (Гекату не берём)', async () => {
  const N = globalThis.L2MNet, st = E.state, calls = [];
  st.skillInfo['1128'] = { name: 'Призвать Тень', kind: 'other', text: 'Вызывает Тень. Для вызова требуется 3 кристалла D класса. Отнимает 30% от получаемого опыта.' };
  st.skillInfo['1228'] = { name: 'Призвать Гекату', kind: 'other', text: 'Вызывает Silhouette… Отнимает 90% от получаемого опыта' };
  let pet = false;
  const bar = () => '<div class="l2bar-slot"><a href="actions.php?t=5&go=1228"><img/></a></div><div class="l2bar-slot"><a href="actions.php?t=5&go=1128"><img/></a></div>' + (pet ? '<div class="l2bar-pet-hp"><font>ХП:978</font> <font>МП:279</font></div>' : '');
  const og = N.get;
  N.get = async (p) => { calls.push(p); if (/go=1128/.test(p)) pet = true; return { status: 200, url: 'https://l2mobi.pro/' + p, text: bar() }; };
  try {
    await T.summonIfNeeded();
    assert.ok(calls.includes('actions.php?t=5&go=1128')); assert.ok(!calls.some(c => /go=1228/.test(c)));
    assert.deepEqual(st.pet, { hp: 978, mp: 279 });
    calls.length = 0; await T.summonIfNeeded(); assert.ok(!calls.some(c => /go=/.test(c)));
  } finally { N.get = og; }
});

test('1.8: учёба не покупает и не учит призывы', async () => {
  const N = globalThis.L2MNet, st = E.state, got = [];
  const row = (id, name, lv, sp) => `<a href="magister.php?get=${id}"><img/></a> <a href="magister.php?&des=${id}&dl=${lv}">${name} ${lv}</a>(${sp} sp)<br />`;
  st.skillInfo = { '1228': { name: 'Призвать Гекату', kind: 'other', text: 'Вызывает Silhouette', level: 1 }, '1266': { name: 'Вспышка Теней', kind: 'attack', power: 39, level: 1 } };
  st.noBook = {}; st.hotbarAt = Date.now();
  const og = N.get;
  N.get = async (p) => { const m = /get=(\d+)/.exec(p); if (m) got.push(m[1]);
    const rows = []; if (!got.includes('1266')) rows.push(row('1266', 'Вспышка Теней', 1, 100)); rows.push(row('1228', 'Призвать Гекату', 1, 10));
    return { status: 200, url: 'https://l2mobi.pro/' + p, text: '<div>У Вас 5000 Skill Points</div>Доступные магии<hr />' + rows.join('<hr />') + '<hr />' }; };
  try { E.setCfg({ autoLearn: true, buyBooks: false, learnSummon: false }); await T.learn(); assert.deepEqual(got, ['1266']); }
  finally { N.get = og; }
});

test('1.8: бьют во время отдыха — отдых прерывается, охота отвечает обидчику', async () => {
  const N = globalThis.L2MNet, st = E.state;
  let hp = 300;
  const og = N.get;
  N.get = async (p) => { if (p === 'player.php?parameters') hp -= 60;
    return { status: 200, url: 'https://l2mobi.pro/' + p, text: '<div>L2 MOBI</div><div>Громила -133</div><div>Ур. 27</div><div>HP</div><div>' + hp + ' / 693</div><div>CP</div><div>289 / 289</div><div>MP</div><div>100 / 562</div>' }; };
  const sl = globalThis.setTimeout;
  try {
    E.setCfg({ fightBack: true, fullRestore: false, restHp: 50, restMp: 20 });
    st.me = { hp: 300, maxHp: 693, mp: 100, maxMp: 562 }; st.hitBy = {}; st.underAttack = 0;
    globalThis.setTimeout = (f) => sl(f, 0);
    await T.restIfNeeded();
    assert.ok(st.underAttack > 0); assert.equal(T.lastAttacker(), 'Громила');
    assert.notEqual(T.services.find(s => s.key === 'rest').due(), true);
  } finally { N.get = og; globalThis.setTimeout = sl; st.underAttack = 0; }
});

test('1.9: Самобичевание — вид mana, в бою при MP < 45% и HP ≥ 55%, отдых по MP не нужен', () => {
  const P = globalThis.L2MParse, st = E.state;
  assert.equal(P.skillKind('Уменьшает ваше HP, чтобы восстановить MP.', 0), 'mana');
  assert.equal(P.skillKind('Высасывает HP из трупа и восстанавливает HP персонажа.', 0), 'other');
  assert.equal(P.skillKind('Магическая атака без элементной основы с близкого расстояния. Power: 25.', 25), 'other');
  st.skillInfo = { '1157': { name: 'Самобичевание', kind: 'mana', power: 0 }, '1178': { name: 'Смерч', kind: 'attack', power: 38 }, '1177': { name: 'Удар Ветра', kind: 'attack', power: 21 } };
  st.knownSkills = ['1157', '1178', '1177']; st.cd = {}; st.manaStat = { n: 0, gain: 0, bad: 0 }; st.mpCost = {};
  E.setCfg({ manaAt: 45, manaHp: 55, restHp: 50, restMp: 20, mpSave: 35 });
  const hb = { attack: 'a', skills: [{ id: '1178', href: 'g1178' }, { id: '1177', href: 'g1177' }, { id: '1157', href: 'g1157' }], items: [] };
  st.me = { hp: 600, maxHp: 664, mp: 60, maxMp: 540 };
  assert.equal(T.chooseAction(hb, 0).skill, '1157');
  st.me.hp = 200; assert.equal(T.chooseAction(hb, 0).skill, '1178'); // HP мало — не жжём
  st.me = { hp: 664, maxHp: 664, mp: 60, maxMp: 540 };
  assert.equal(T.services.find(s => s.key === 'rest').due(), false);
  st.manaStat.bad = 3; assert.equal(T.services.find(s => s.key === 'rest').due(), true);
  // экономный удар при малом MP: Смерч 38/40 MP хуже Удара Ветра 21/10 MP
  T.noteMpCost('1178', 300, 260); T.noteMpCost('1177', 300, 290);
  st.me.mp = 150; assert.equal(T.chooseAction(hb, 0).skill, '1177');
  st.me.mp = 400; assert.equal(T.chooseAction(hb, 0).skill, '1178');
  // зелье маны: MP < 15%, Самобичевание не работает
  st.me.mp = 40; const hb2 = Object.assign({}, hb, { items: [{ id: '728', href: 'u728' }] });
  assert.equal(T.chooseAction(hb2, 0).item, '728');
  st.manaStat.bad = 0;
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../src/parse.js');
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

test('мобы на карте', () => {
  const mobs = P.parseMapMobs(fx('map.html'));
  assert.ok(mobs.length >= 2);
  assert.deepStrictEqual(mobs[0].name, 'Гоблин');
  assert.strictEqual(mobs[0].level, 5);
  assert.strictEqual(mobs[0].hp, 126);
  assert.match(mobs[0].href, /^battle\.php\?spid=\d+&eid=\d+&edt=\d+&mdt=1&tymop=mob$/);
});

test('страница боя: полоски, цель, панель, каст, журнал', () => {
  const h = fx('battle.html');
  assert.deepStrictEqual(P.parseBars(h), { cp: 90, maxCp: 90, hp: 102, maxHp: 181, mp: 123, maxMp: 123, exp: 99 });
  assert.deepStrictEqual(P.parseTargetHud(h), { name: 'Бес [6]', hp: 35, maxHp: 147 });
  const hb = P.parseHotbar(h);
  assert.match(hb.attack, /&attack$/);
  assert.deepStrictEqual(hb.skills.map((s) => s.id), ['1177']);
  assert.ok(!P.isEditMode(h));
  const c = P.parseCasting(h);
  assert.ok(c.casting > 1700000000 && c.PN > 1);
  assert.strictEqual(P.parseBattleLog(h)[0], 'Ты нанес 43 урона. (х1) (х2)');
  assert.deepStrictEqual(P.parseHeroHeader(h), { name: 'Hero', level: 8 });
});

test('конец боя: добыча', () => {
  const e = P.parseBattleEnd(fx('battle-end.html'));
  assert.ok(e.takeAll);
  assert.ok(e.loot.includes('Адена 90'));
});

test('параметры героя', () => {
  const p = P.parseParameters(fx('parameters.html'));
  assert.strictEqual(p.level, 7);
  assert.strictEqual(p.maxHp, 181);
  assert.strictEqual(p.maxMp, 123);
  assert.ok(p.sp > 0);
});

test('VIP-баффер', () => {
  const b = P.parseBuffer(fx('buffer-vip.html'));
  assert.ok(b.length > 50);
  assert.deepStrictEqual(b.find((x) => x.id === 3), { href: 'buffer_vip_40.php?buff=3', id: 3, skill: 1085, name: 'Acumen' });
});

test('Алтарь: ссылки наград', () => {
  const c = P.parseAltarClaims(fx('altar.html'));
  assert.ok(c.some((x) => /claim_streak=1/.test(x)));
  assert.ok(c.some((x) => /spin=1&key=/.test(x)));
});

test('город: ссылки с токеном', () => {
  const t = P.townTokens(fx('town.html'));
  assert.match(t['1'], /^town\.php\?go=1&tk=[0-9a-f]{32}$/);
});

test('тревоги: страница входа и капча', () => {
  assert.deepStrictEqual(P.detectAlerts(fx('login.html')), ['logout']);
  assert.deepStrictEqual(P.detectAlerts('<div>Введите код с картинки</div>'), ['captcha']);
  assert.deepStrictEqual(P.detectAlerts(fx('map.html')), []);
  assert.deepStrictEqual(P.detectAlerts('<div>Вас убил Зеленый Гриб нанес урона.</div>'), []);
  assert.deepStrictEqual(P.detectAlerts('<div class="l2-bar-text">HP 0/211</div>'), ['dead']);
});

test('магистр, описание умения, панель', () => {
  const m = P.parseMagister(fx('magister.html'));
  assert.strictEqual(m.sp, 1558);
  assert.ok(m.list.length >= 15);
  assert.deepStrictEqual(m.list.find((x) => x.id === '1177'), { id: '1177', level: 2, name: 'Удар Ветра', sp: 240, book: null });
  assert.strictEqual(m.list.find((x) => x.id === '1184').book, 1049);
  assert.deepStrictEqual(P.parseSkillDesc(fx('skill-desc.html')).name, 'Проклятие: Яд');
  assert.deepStrictEqual(P.parseSkillDesc('<div>Hero - 10 уровень</div><div>Удар Ветра</div><div>Атакакует противника сильным порывом ветра. Power: 15.</div>'),
    { name: 'Удар Ветра', text: 'Атакакует противника сильным порывом ветра. Power: 15.', power: 15, kind: 'attack' });
  const slots = P.parseSlots(fx('hotbar-edit.html'));
  assert.deepStrictEqual(slots.filter((x) => x.skill), [{ slot: 0, skill: 'attack' }, { slot: 1, skill: '1177' }]);
  assert.ok(slots.length >= 10);
  assert.deepStrictEqual(P.parseSlotSkills(fx('slot-skills.html')).map((x) => x.id), ['1177', '27']);
});

test('куда качаться и карточка моба', () => {
  assert.deepStrictEqual(P.parseNearby(fx('nearby.html')).map((x) => x.level), [6, 7, 9]);
  const d = P.parseDroplist(fx('droplist.html'));
  assert.deepStrictEqual(d, { name: 'Зеленый Гриб', level: 9, agro: false, run: 'map.php?map&move_x=-9513&move_y=23544', x: -9513, y: 23544 });
  assert.deepStrictEqual(P.parseMapCoords('<div>× 1.0</div><div>606 : 1417</div>'), { x: 606, y: 1417 });
});

test('выбор моба (−5…+9) и действия', () => {
  global.chrome = undefined;
  global.document = { cookie: '' };
  require('../src/net.js');
  require('../src/journal.js');
  require('../src/engine.js');
  const E = global.L2MEngine;
  E._test.setHero({ name: 'Hero', level: 7 });
  const mobs = [{ name: 'Гремлин', level: 1, href: 'a' }, { name: 'Бес', level: 6, href: 'b' }, { name: 'Орк', level: 16, href: 'c' }, { name: 'Дракон', level: 17, href: 'd' }];
  assert.strictEqual(E._test.pickMob(mobs).href, 'c');
  E.setCfg({ blacklist: 'Орк' });
  assert.strictEqual(E._test.pickMob(mobs).href, 'b');
  E.setCfg({ maxLvlBelow: 0 });
  assert.strictEqual(E._test.pickMob(mobs), null);
  const hb = { attack: 'battle.php?x&attack', skills: [{ id: '27', href: 'battle.php?x&go=27' }, { id: '1177', href: 'battle.php?x&go=1177' }] };
  assert.deepStrictEqual(E._test.rotation(hb), ['1177']);
  assert.strictEqual(E._test.chooseAction(hb, 0).skill, '1177');
  E.state.cd['1177'] = 10_000;
  assert.strictEqual(E._test.chooseAction(hb, 5_000).label, 'атака');
});

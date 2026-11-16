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
});

test('выбор моба и действия', () => {
  global.chrome = undefined;
  global.document = { cookie: '' };
  require('../src/net.js');
  require('../src/engine.js');
  const E = global.L2MEngine;
  E._test.setHero({ name: 'Hero', level: 7 });
  const mobs = [{ name: 'Гремлин', level: 1, href: 'a' }, { name: 'Бес', level: 6, href: 'b' }, { name: 'Орк', level: 12, href: 'c' }];
  assert.strictEqual(E._test.pickMob(mobs).href, 'b');
  E.setCfg({ blacklist: 'Бес' });
  assert.strictEqual(E._test.pickMob(mobs).href, 'a');
  E.setCfg({ maxLvlBelow: 3 });
  assert.strictEqual(E._test.pickMob(mobs), null);
  const hb = { attack: 'battle.php?x&attack', skills: [{ id: '1177', href: 'battle.php?x&go=1177' }] };
  assert.strictEqual(E._test.chooseAction(hb, 0).skill, '1177');
  E.state.cd['1177'] = 10_000;
  assert.strictEqual(E._test.chooseAction(hb, 5_000).label, 'атака');
});

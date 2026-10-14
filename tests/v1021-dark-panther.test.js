'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { flowFixture } = require('./warlock-combat-fixture.cjs');

test('Dark Avenger summons Dark Panther automatically and measures its damage', async () => {
  const f = flowFixture('pet');
  f.env.combatProfileKind = () => 'fighter';
  f.summon.title = 'Summon Dark Panther';
  f.env.cfg.petAuto = true;
  let present = false;
  const fire = f.env.fire;
  f.env.petState = () => ({ t: Date.now(), has: present, key: 'dark_panther', hp: present ? 1000 : 0, maxHp: 1000 });
  f.env.fire = b => { if (b === f.summon) present = true; return fire(b); };
  await f.combat.battle();
  assert.equal(f.events.filter(x => x === 'Summon Dark Panther').length, 1);
  assert.equal(f.env.rt.petStat?.kai_the_cat?.summons, 1);
  assert.equal(f.env.rt.kills, 1);
});

test('ordinary fighter without a summon slot does not enter summon control', async () => {
  const f = flowFixture('fighter');
  f.env.cfg.petAuto = true;
  await f.combat.battle();
  assert.equal(f.events.includes('Summon Dark Panther'), false);
  assert.equal(f.env.rt.kills, 1);
});

test('Dark Avenger can resummon a low-HP panther before attacking', async () => {
  const f = flowFixture('pet');
  f.env.combatProfileKind = () => 'fighter';
  f.summon.title = 'Summon Dark Panther';
  Object.assign(f.env.cfg, { petAuto: true, petResummon: true, petResummonAt: 25, petHealPrefer: 'resummon' });
  f.env.petState = () => ({ t: Date.now(), has: true, key: 'dark_panther', hp: 100, maxHp: 1000 });
  f.env.fire = b => { f.events.push(b.title); f.env.on = false; return false; };
  await f.combat.battle();
  assert.equal(f.events.includes('Summon Dark Panther'), true);
});

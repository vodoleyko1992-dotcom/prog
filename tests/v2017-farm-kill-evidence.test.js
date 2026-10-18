'use strict';
// 18.10: явные смерти соседей сохраняются до обрезки лога; HP/спойл не являются убийствами.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const root = __dirname + '/../', source = fs.readFileSync(root + 'hook.js', 'utf8');
const btOf = vm.runInNewContext(source.slice(source.indexOf('  const btOf = '), source.indexOf('  const pvOf =')) + ';btOf');
const spawn = 'dense_fixture', death = name => 'Додаткова ціль повалена: ' + name + '.', loot = Array.from({length: 100}, (_, i) => 'Animal Bone ×' + (i + 1));
const plain = x => JSON.parse(JSON.stringify(x));
function fixture() {
  let now = 100000, rid = 0, pvp = false;
  const rt = {char: 'Hero', classCur: {prof: 'dwarf_bounty_hunter', slot: 1}}, box = {Date: {now: () => now}, URLSearchParams};
  vm.runInNewContext(fs.readFileSync(root + 'modules/fightlab.js', 'utf8'), box);
  const L = box.L2V7Factories.fightlab({rt, cfg: {}, routeLocation: {search: '?spawnId=' + spawn}, mobTitle: () => 'Plandо · ур.63', pvpPending: () => pvp, actName: x => x, setRt: async p => Object.assign(rt, p), rec() {}});
  const send = (path, data, options = {}) => {
    now = options.at ?? now + 1000;
    return L.onNet(path, {status: options.status ?? 200, rid: Object.hasOwn(options, 'rid') ? options.rid : ++rid, req: {action: 'attack'}, res: data,
      bt: btOf({pathname: path}, data), ...options.envelope});
  };
  const start = (revision = 1, battleSpawn = spawn) => send('/game/battle/start', {revision, battle: {spawnId: battleSpawn, mobName: 'Plandо', mobHp: 1000, mobMaxHp: 1000, logSeq: 0, log: []}});
  const victory = (names, extra = {}) => ({revision: 10, victory: {spawnId: spawn, mobName: 'Plandо', fullLog: ['Бой начат: Plandо', ...names.map(death), ...loot, 'Победа!']}, ...extra});
  return {rt, L, send, start, victory, setPvp: x => {pvp = x;}, get: since => plain(L.killsFor(spawn, since))};
}

test('raw fullLog keeps three explicit deaths before100 loot lines; bt.log retains40-line limit', () => {
  const f = fixture(), raw = f.victory(['Cave Maiden', 'Cave Maiden', 'Cave Howler']), bt = btOf({pathname: '/game/battle/action'}, raw);
  assert.equal(bt.log.length, 40); assert.equal(bt.log.some(x => /повалена/.test(x)), false);
  assert.deepEqual(plain(bt.killEvidence.full), ['Cave Maiden', 'Cave Maiden', 'Cave Howler']);
  f.start(); f.send('/game/battle/action', raw);
  assert.deepEqual(f.get().extras, ['Cave Maiden', 'Cave Maiden', 'Cave Howler']); assert.equal(f.get().win, true);
});

test('full victory evidence survives priority of unrelated delta.logTail', () => {
  const f = fixture(), raw = f.victory(['A', 'A', 'B'], {delta: {logSeq: 106, logTail: ['EXP +100']}}), bt = btOf({pathname: '/game/battle/action'}, raw);
  assert.deepEqual(plain(bt.log), ['EXP +100']); assert.deepEqual(plain(bt.killEvidence.full), ['A', 'A', 'B']);
  f.start(); f.send('/game/battle/action', raw); assert.equal(f.get().extras.length, 3);
});

test('full battle.log is an independent floor even when delta has priority', () => {
  const f = fixture(); f.start();
  f.send('/game/battle/action', {revision: 2, delta: {logSeq: 4, logTail: ['EXP +1']}, battle: {spawnId: spawn, mobName: 'Plandо', logSeq: 4, log: [death('A'), death('A'), death('B'), 'EXP +1']}});
  assert.deepEqual(f.get().extras, ['A', 'A', 'B']);
});

test('raw delta tail over40 lines keeps early deaths with absolute sequence positions', () => {
  const f = fixture(), tail = [death('A'), death('A'), death('B'), ...loot]; f.start();
  const raw = {revision: 2, delta: {mobHp: 500, logSeq: 103, logTail: tail}}, bt = btOf({pathname: '/game/battle/action'}, raw);
  assert.deepEqual(plain(bt.killEvidence.tail.map(x => x.seq)), [1, 2, 3]);
  f.send('/game/battle/action', raw); assert.deepEqual(f.get().extras, ['A', 'A', 'B']);
});

test('replayed full snapshots and repeated GET victory cannot double count', () => {
  const f = fixture(); f.start(); const raw = f.victory(['A', 'A', 'B']);
  f.send('/game/battle/action', raw); f.send('/game/battle', raw); f.send('/game/battle', raw);
  assert.deepEqual(f.get().extras, ['A', 'A', 'B']);
});

test('delta repeated sequence and partially overlapping sequence keep multiplicity exactly once', () => {
  const f = fixture(); f.start();
  for (const [revision, logSeq, names] of [[2, 2, ['A', 'A']], [3, 2, ['A', 'A']], [4, 3, ['A', 'B']]])
    f.send('/game/battle/action', {revision, delta: {mobHp: 500, logSeq, logTail: names.map(death)}});
  assert.deepEqual(f.get().extras, ['A', 'A', 'B']);
});

test('same rid is one unsequenced delta while distinct rid adds another same-name death', () => {
  const f = fixture(); f.start(); const raw = {delta: {mobHp: 500, logTail: [death('A')]}};
  f.send('/game/battle/action', raw, {rid: 50}); f.send('/game/battle/action', raw, {rid: 50}); f.send('/game/battle/action', raw, {rid: 51});
  assert.deepEqual(f.get().extras, ['A', 'A']);
});

test('unsequenced delta without request receipt is not a confirmed additional event', () => {
  const f = fixture(); f.start(); f.send('/game/battle/action', {delta: {mobHp: 500, logTail: [death('A')]}}, {rid: null});
  assert.equal(f.get(), null);
});

test('full after delta applies a floor; the following fresh delta adds a new equal name', () => {
  const f = fixture(); f.start();
  f.send('/game/battle/action', {revision: 2, delta: {mobHp: 500, logSeq: 2, logTail: [death('A'), death('A')]}});
  f.send('/game/battle', {revision: 2, battle: {spawnId: spawn, mobName: 'Plandо', mobHp: 500, logSeq: 2, log: [death('A'), death('A')]}});
  f.send('/game/battle/action', {revision: 3, delta: {mobHp: 400, logSeq: 3, logTail: [death('A')]}});
  assert.deepEqual(f.get().extras, ['A', 'A', 'A']);
});

test('GET ahead of action records full evidence but same-seq action does not repeat it', () => {
  const f = fixture(); f.start();
  f.send('/game/battle', {revision: 3, battle: {spawnId: spawn, mobName: 'Plandо', mobHp: 400, logSeq: 3, log: [death('A'), death('A'), death('B')]}});
  f.send('/game/battle/action', {revision: 3, delta: {mobHp: 400, logSeq: 3, logTail: [death('A'), death('A'), death('B')]}});
  assert.deepEqual(f.get().extras, ['A', 'A', 'B']);
});

for (const marker of ['Бой начат: New', 'Бій розпочато.', 'Бой начат']) test('old chain is excluded after last marker: ' + marker, () => {
  const f = fixture(), raw = f.victory([]); raw.victory.fullLog = ['Бой начат: Old', death('Old'), marker, death('New'), ...loot];
  f.send('/game/battle', raw); assert.deepEqual(f.get().extras, ['New']);
});

test('delta also excludes old-chain lines before its last battle start', () => {
  const f = fixture(); f.start();
  f.send('/game/battle/action', {revision: 2, delta: {mobHp: 500, logSeq: 4, logTail: [death('Old'), 'Бій розпочато.', death('New'), 'EXP +1']}});
  assert.deepEqual(f.get().extras, ['New']);
});

test('Russian markers, object lines and invisible/timestamp prefixes are supported', () => {
  const f = fixture(), raw = f.victory([]); raw.victory.fullLog = [{text: '[12:34:56] \u2060122\u200bБій розпочато.'}, {message: '[12:34] Дополнительная цель повержена: Cave Maiden.'}, {line: '\u2060123\u200bДодаткова ціль повалена: Cave Maiden.'}];
  f.send('/game/battle', raw); assert.deepEqual(f.get().extras, ['Cave Maiden', 'Cave Maiden']);
});

test('compact evidence is bounded to200 names without loot text', () => {
  const f = fixture(), raw = f.victory(Array(250).fill('A'.repeat(200)), {delta: {logSeq: 2, logTail: [death('B')]}}), bt = btOf({pathname: '/game/battle/action'}, raw);
  assert.equal(bt.killEvidence.full.length + bt.killEvidence.tail.length, 200);
  assert.ok(bt.killEvidence.full.every(x => x.length <= 80));
  f.send('/game/battle', raw); assert.equal(f.get().extras.length, 200);
});

test('old revision cannot add proof after a newer pending GET', () => {
  const f = fixture(); f.start();
  f.send('/game/battle', {revision: 5, battle: {spawnId: spawn, mobName: 'Plandо', mobHp: 400, logSeq: 1, log: [death('A')]}});
  f.send('/game/battle', {revision: 4, battle: {spawnId: spawn, mobName: 'Plandо', mobHp: 500, logSeq: 2, log: [death('Old'), death('Old')]}});
  assert.deepEqual(f.get().extras, ['A']);
});

test('different actor ID cannot modify existing proof', () => {
  const f = fixture(); f.send('/game/battle/start', {revision: 1, character: {id: 'fixture-owner'}, battle: {spawnId: spawn, mobName: 'Plandо', mobHp: 1000, log: []}});
  f.send('/game/battle/action', f.victory(['Other'], {character: {id: 'fixture-other'}})); assert.equal(f.get(), null);
});

test('late previous hero GET cannot create proof after owner switch', () => {
  const f = fixture(); f.rt.char = 'NewHero'; f.send('/game/battle', f.victory(['Old'], {character: {name: 'Hero'}})); assert.equal(f.get(), null);
});

test('class switch invalidates old proof and delayed old-class action', () => {
  const f = fixture(); f.start(); f.send('/game/battle/action', f.victory(['A'])); f.rt.classCur = {prof: 'human_warlock', slot: 0};
  assert.equal(f.get(), null); f.send('/game/battle/action', f.victory(['Old'], {revision: 20})); assert.equal(f.get(), null);
});

test('old-class GET and mismatching active slot cannot create kill proof', () => {
  for (const c of [{l2Profession: 'human_warlock'}, {l2Profession: 'dwarf_bounty_hunter', classSlots: {activeSlot: 0}}]) {
    const f = fixture(); f.send('/game/battle', f.victory(['Old'], {character: {name: 'Hero', ...c}})); assert.equal(f.get(), null);
  }
});

test('wrong action spawn, query spawn and since cannot leak previous fight proof', () => {
  const f = fixture(); f.start(); f.send('/game/battle/action', f.victory(['A']));
  assert.equal(f.L.killsFor('another-spawn'), null); assert.equal(f.get(f.get().t + 1), null); assert.ok(f.get(f.get().t));
  const raw = f.victory(['Other'], {revision: 20}); raw.victory.spawnId = 'another-spawn'; f.send('/game/battle/action', raw);
  assert.deepEqual(f.get().extras, ['A']);
});

test('fresh hunt at same spawn resets proof rather than inheriting earlier deaths', () => {
  const f = fixture(); f.start(); f.send('/game/battle/action', f.victory(['Old']));
  f.send('/game/battle/hunt-continue', {revision: 11, battle: {spawnId: spawn, mobName: 'Plandо', mobHp: 1000, logSeq: 0, log: []}});
  assert.equal(f.get(), null); f.send('/game/battle/action', f.victory(['New'], {revision: 12})); assert.deepEqual(f.get().extras, ['New']);
});

test('PvP pending and PvP defeat suppress PvE evidence', () => {
  for (const mode of ['pending', 'defeat']) {
    const f = fixture(); f.start(); if (mode === 'pending') f.setPvp(true);
    f.send('/game/battle/action', f.victory(['A']), {envelope: mode === 'defeat' ? {pv: {defeat: {name: 'Opponent'}}} : {}}); assert.equal(f.get(), null);
  }
});

test('error, blocked request and HTTP failure cannot confirm deaths', () => {
  for (const options of [{error: 'fixture'}, {blockedBy: 'fixture'}, {}]) {
    const f = fixture(); f.start(); f.send('/game/battle/action', f.victory(['A'], options), {status: Object.keys(options).length ? 200 : 500}); assert.equal(f.get(), null);
  }
});

test('defeat can retain confirmed additional kills but never claims a main victory', () => {
  const f = fixture(); f.start(); f.send('/game/battle/action', {revision: 2, defeat: {spawnId: spawn, mobName: 'Plandо', fullLog: [death('A'), ...loot, 'Поразка.']}});
  assert.deepEqual(f.get().extras, ['A']); assert.equal(f.get().win, false); assert.equal(f.get().lose, true);
});

test('HP zero, disappeared roster, spoil successes and reward lines do not invent deaths', () => {
  const f = fixture(); f.start(); f.send('/game/battle/action', {revision: 2, delta: {mobHp: 0, battleEnded: true, logSeq: 5, whirlwindExtras: [], logTail: ['Spoil Festival: A: успіх (100%); B: успіх (100%)', 'EXP +100', 'SP +10', 'A поруч: B −100', 'Перемога!']}});
  assert.equal(f.get(), null, 'mobHp zero is not an explicit server victory flag');
});

test('GET victory after reload exposes summary with zero turns, including placeholder ensure', () => {
  for (const placeholder of [false, true]) {
    const f = fixture(); if (placeholder) f.L.ensure(); f.send('/game/battle', f.victory(['A', 'A', 'B']));
    assert.equal(f.L.fight().turns, 0); assert.equal(f.get().win, true); assert.deepEqual(f.get().extras, ['A', 'A', 'B']);
  }
});

test('returned names are copied; repeated caller mutation cannot change proof', () => {
  const f = fixture(); f.send('/game/battle', f.victory(['A'])); const got = f.L.killsFor(spawn); got.extras.push('Fake'); assert.deepEqual(f.get().extras, ['A']);
});

test('full plus unsequenced tail is one confirmation even after a prior full GET', () => {
  const f = fixture(); f.start();
  f.send('/game/battle', {revision: 2, battle: {spawnId: spawn, mobName: 'Plandо', mobHp: 500, log: [death('A')]}});
  f.send('/game/battle/action', f.victory(['A'], {revision: 3, delta: {logTail: [death('A')]}}));
  assert.deepEqual(f.get().extras, ['A']);
});

test('unsequenced full floor covers action of its own revision but later revision is new', () => {
  const f = fixture(); f.start();
  f.send('/game/battle', {revision: 2, battle: {spawnId: spawn, mobName: 'Plandо', mobHp: 500, log: [death('A')]}});
  f.send('/game/battle/action', {revision: 2, delta: {mobHp: 500, logSeq: 10, logTail: [death('A')]}});
  assert.deepEqual(f.get().extras, ['A']);
  f.send('/game/battle/action', {revision: 3, delta: {mobHp: 400, logSeq: 11, logTail: [death('A')]}});
  assert.deepEqual(f.get().extras, ['A', 'A']);
});

test('empty sync logSeq cannot hide a later actual death at the same sequence', () => {
  const f = fixture(); f.start();
  f.send('/game/battle/sync', {logSeq: 20, changed: false});
  f.send('/game/battle/action', {revision: 2, delta: {mobHp: 500, logSeq: 20, logTail: [death('A')]}});
  assert.deepEqual(f.get().extras, ['A']);
});

test('empty victory fullLog falls back to complete battle.log', () => {
  const f = fixture(); f.send('/game/battle', {revision: 10, victory: {spawnId: spawn, fullLog: []}, battle: {spawnId: spawn, mobName: 'Plandо', mobHp: 0, log: [death('A'), ...loot]}});
  assert.deepEqual(f.get().extras, ['A']);
});

test('unsequenced kill receipt survives more than128 unrelated requests', () => {
  const f = fixture(); f.start(); const raw = {delta: {mobHp: 500, logTail: [death('A')]}};
  f.send('/game/battle/action', raw, {rid: 500});
  for (let i = 0; i < 140; i++) f.send('/game/battle/sync', {logSeq: i + 1}, {rid: 1000 + i});
  f.send('/game/battle/action', raw, {rid: 500}); assert.deepEqual(f.get().extras, ['A']);
});

test('new full without seq covers its delta even after an earlier sequenced full', () => {
  const f = fixture();
  f.send('/game/battle/start', {revision: 1, battle: {spawnId: spawn, mobName: 'Plandо', mobHp: 1000, logSeq: 0, log: ['Бой начат: Plandо']}});
  f.send('/game/battle/action', {revision: 2, delta: {logSeq: 1, logTail: [death('A')]}, battle: {spawnId: spawn, mobName: 'Plandо', mobHp: 500, log: [death('A')]}});
  assert.deepEqual(f.get().extras, ['A']);
  f.send('/game/battle/sync', {revision: 2, logSeq: 1, logTail: [death('A')]}); assert.deepEqual(f.get().extras, ['A']);
  f.send('/game/battle/action', {revision: 3, delta: {mobHp: 400, logSeq: 2, logTail: [death('A'), death('A')]}}); assert.deepEqual(f.get().extras, ['A', 'A']);
});

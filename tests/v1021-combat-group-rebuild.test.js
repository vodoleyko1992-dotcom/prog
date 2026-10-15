'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { flowFixture } = require('./warlock-combat-fixture.cjs');
const observed = require('./fixtures/combat-group-2026-10-15.json');
function model() {
 let now = 1000000;
 const env = { cfg: { catMode: true }, rt: { char: 'Fixture', catIn: 'disciples', skills: { 'flame strike': { aoe: 1 } } },
  actName: () => 'Flame Strike', setRt: async p => Object.assign(env.rt, p), rec() {} };
 const Clock = class extends Date { static now() { return now; } };
 const box = { console, Date: Clock, Math, URLSearchParams, location: { search: '?spawnId=sdms_test' } };
 vm.runInNewContext(fs.readFileSync(__dirname + '/../modules/fightlab.js', 'utf8'), box);
 const api = box.L2V7Factories.fightlab(env);
 const start = () => api.onNet('/game/battle/start', { status: 200, bt: { spawn: 'sdms_test', name: 'Nephilim Royal Guard', mob: observed.mainHp, mobMax: observed.mainHp, hp: 14917, mp: 5408, full: true, seq: 0, log: [] } });
 const hit = (lines = observed.lines, status = 200) => { now += 1000; return api.onNet('/game/battle/action', { status, req: { action: 'l2_1181' }, bt: { mob: 0, mobMax: observed.mainHp, hp: 14917, mp: 5370, full: true, seq: 1, log: lines } }); };
 return { api, env, start, hit, time: v => { now += v; } };
}
function choices(profile = 'mage') {
 const f = flowFixture('mage'), e = f.env, flame = { title: 'Flame Strike', getAttribute: () => null };
 f.slots.push(flame); f.hp.textContent = '3780 / 3780'; e.cfg.mageProbe = false;
 e.cfg.nPower = 'Blaze|Flame Strike'; e.combatProfileKind = () => profile;
 e.isChargeName = () => false; e.isForceName = () => false;
 e.rt.skills.blaze = { dmg: 50000 * 3, dmgN: 3 };
 e.rt.skills['flame strike'] = { dmg: 24864 * 3, dmgN: 3, aoe: 1, spl: 49728 * 3, splN: 3 };
 e.expDmg = k => k === 'атака' ? 1000 : (e.rt.skills[k.toLowerCase()]?.dmg || 0) / (e.rt.skills[k.toLowerCase()]?.dmgN || 1);
 e.skillMp = n => /flame/i.test(n) ? 38 : 29; e.ilOf = () => ({ c: 'Маг. атака', t: 'MDAM', mp: 38 });
 return { ...f, flame, pick: (mp = { cur: 5300, max: 5408 }) => f.combat.chooseAction({ block: {} }, mp) };
}
test('реальные строки: основной урон отдельно, две дополнительные цели и две смерти', () => {
 const f = model(), p = f.api.parseLog(observed.lines, 'Nephilim Royal Guard');
 assert.equal(p.own, 24864); assert.equal(p.splash.length, 2); assert.equal(p.extraKills.length, 2);
 assert.equal(p.splash.reduce((n, x) => n + x.damage, 0), 49728);
});
test('принятый АОЕ обучает дополнительные убийства; повтор fullLog не удваивает', () => {
 const f = model(); f.start(); f.hit(); f.hit(); const g = f.api.groupOn('Flame Strike', 3780);
 assert.equal(g.n, 1); assert.equal(g.kills, 2); assert.equal(g.targets, 2); assert.equal(g.damage, 24864);
});
test('ошибка API не обучает группу', () => { const f = model(); f.start(); f.hit(observed.lines, 500); assert.equal(f.api.groupOn('Flame Strike', 3780), null); });
test('модель не переносится в другую зону, режим, другую полосу HP или после 5 минут', () => {
 const f = model(); f.start(); f.hit();
 assert.equal(f.api.groupOn('Flame Strike', 500000), null);
 f.env.rt.catIn = 'witch'; assert.equal(f.api.groupOn('Flame Strike', 3780), null);
 f.env.rt.catIn = 'disciples'; f.env.cfg.catMode = false; assert.equal(f.api.groupOn('Flame Strike', 3780), null);
 f.env.cfg.catMode = true; f.time(300001); assert.equal(f.api.groupOn('Flame Strike', 3780), null);
});
test('новое АОЕ без дополнительной цели понижает ожидаемую выгоду', () => {
 const f = model(); f.start(); f.hit(); f.start(); f.hit(['Удар полум’я 24864']);
 const g = f.api.groupOn('Flame Strike', 3780); assert.equal(g.n, 2); assert.equal(g.kills, 1);
});
test('несколько подтверждённых наград при splash учитываются и без маркера смерти', () => {
 const f = model(); f.start(); f.hit(observed.lines.filter(l => !l.startsWith('Додаткова')).concat(['EXP +100', 'EXP +200', 'EXP +300', 'SP +10', 'SP +20', 'SP +30']));
 assert.equal(f.api.groupOn('Flame Strike', 3780).kills, 2);
});
for (const role of ['mage', 'fighter']) test(role + ': три убийства выигрывают у огромного оверкилла одного моба', () => {
 const f = choices(role), m = model(); m.start(); m.hit(); f.env.fightGroupOn = m.api.groupOn;
 assert.equal(f.pick().name, 'Flame Strike'); assert.match(f.pick().why, /по свежим боям/);
});
test('наблюдаемая нулевая выгода отменяет пробу и возвращает одиночное добивание', () => {
 const f = choices(), m = model(); m.start(); m.hit(['Удар полум’я 24864']); f.env.fightGroupOn = m.api.groupOn;
 assert.equal(f.pick().name, 'Blaze');
});
test('нет подтверждённого АОЕ — лишних целей не выдумываем', () => { const f = choices(); delete f.env.rt.skills['flame strike'].aoe; assert.equal(f.pick().name, 'Blaze'); });
test('локальный откат АОЕ не задерживает убийство; недостаток MP не создаёт бесплатный каст', () => {
 const f = choices(); f.env.memLeft = b => b === f.flame ? 10 : 0; assert.equal(f.pick().name, 'Blaze');
 f.env.memLeft = () => 0; assert.equal(f.pick({ cur: 35, max: 5408 }).name, 'Blaze');
});
test('видимые мёртвые соседи важнее истории успешных АОЕ', () => {
 const f = choices(), m = model(); m.start(); m.hit(); f.env.fightGroupOn = m.api.groupOn;
 const q = f.env.$q; f.env.$q = s => s === '#battle-whirlwind-extras' ? { textContent: 'Dead 0/3780' } : q(s);
 assert.equal(f.pick().name, 'Blaze');
});
test('полезный урон по живой группе ограничен её HP, а не тройным оверкиллом', () => {
 const f = choices(); const q = f.env.$q;
 f.env.$q = s => s === '#battle-whirlwind-extras' ? { textContent: 'A 100/3780 B 200/3780' } : q(s);
 const a = f.pick(); assert.equal(a.name, 'Flame Strike'); assert.equal(a.useful, 4080); assert.equal(a.sideKills, 2);
});
test('награды всех трёх мобов суммируются один раз, включая одинаковые EXP и тысячные пробелы', () => {
 const f = choices(), lines = ['EXP +1 000', 'EXP +1 000', 'EXP +1 000', 'SP +10', 'SP +20', 'SP +30', 'аден +2 000', 'аден +3 000', 'Coal ×6'];
 const r = f.combat.battleRewards(lines, '1000 EXP · 10 SP · 2000 аден', { exp: 1000, sp: 10, adena: 2000 });
 assert.equal(r.exp, 2000); assert.equal(r.sp, 50); assert.equal(r.adena, 3000);
});
test('нет строк наград — остаётся запасной lootline, без выдуманного ×3', () => {
 const f = choices(), r = f.combat.battleRewards(['Удар полум’я 24864', 'Coal ×6'], '1000 EXP · 10 SP · 2000 аден');
 assert.equal(r.exp, 1000); assert.equal(r.sp, 10); assert.equal(r.adena, 2000);
});
test('новая память групп хранится отдельно для каждого класса и очищается с памятью боя', () => {
 assert.match(fs.readFileSync(__dirname + '/../modules/story.js', 'utf8'), /'fightGroups'/);
 assert.match(fs.readFileSync(__dirname + '/../popup.js', 'utf8'), /fightMem: \{\}, fightLast: null, fightGroups: \{\}/);
});
test('одинаковые новые награды сохраняются при вытеснении старых из хвоста журнала', () => {
 const f = choices(), before = ['EXP +100', 'удар старого моба', 'EXP +100', 'ещё старое'];
 const after = ['EXP +100', 'удар нового моба', 'EXP +100', 'удар старого моба'];
 const fresh = f.combat.freshBattleLines(before, after);
 assert.deepEqual(Array.from(fresh), ['EXP +100', 'удар нового моба']);
 assert.equal(f.combat.battleRewards(fresh).exp, 100);
 assert.equal(f.combat.freshBattleLines(after, after).length, 0);
});
test('сквозной бой: две дополнительные смерти, их EXP/SP/адена и все предметы учитываются один раз', async () => {
 const f = flowFixture('mage'), e = f.env; let emitted = false;
 const lines = ['EXP +300', 'SP +30', 'аден +3000', 'Coal ×2', 'Додаткова ціль повалена: Side B.',
  'EXP +200', 'SP +20', 'аден +2000', 'Coal ×2', 'Додаткова ціль повалена: Side A.',
  'EXP +100', 'SP +10', 'аден +1000', 'Coal ×2', 'Полум’я 1000'];
 const source = fs.readFileSync(__dirname + '/../content.js', 'utf8');
 const box = { logLines: () => emitted ? lines : [] };
 vm.runInNewContext(source.slice(source.indexOf('const EXTRA_KILL ='), source.indexOf('// ---------- условия главы')), box);
 e.extraKillsInLog = box.extraKillsInLog; e.logLines = box.logLines;
 const fire = e.fire; e.fire = b => { const r = fire(b); if (b.title === 'Blaze') emitted = true; return r; };
 const start = { exp: e.rt.exp, sp: e.rt.sp, adena: e.rt.adena, kills: e.rt.kills };
 await f.combat.battle();
 assert.equal(e.rt.kills - start.kills, 3);
 assert.equal(e.rt.exp - start.exp, 600); assert.equal(e.rt.sp - start.sp, 60); assert.equal(e.rt.adena - start.adena, 6000);
 assert.equal(e.rt.loot.Coal, 6);
});
test('запоздалый ход прежнего класса не обучает новый класс', () => {
 const f = model(); f.start(); f.env.rt.classCur = { prof: 'different', slot: 1 }; f.hit();
 assert.equal(f.env.rt.fightGroups, undefined);
});
test('переключение режима во время запроса не переносит результат в новую зону', () => {
 const f = model(); f.start(); f.env.cfg.catMode = false; f.env.rt.zone = 'new-zone'; f.hit();
 assert.equal(f.api.groupOn('Flame Strike', 3780), null);
 f.env.cfg.catMode = true; assert.equal(f.api.groupOn('Flame Strike', 3780).kills, 2);
});
test('пустой видимый контейнер соседей — неизвестность, а не запрет АОЕ', () => {
 const f = choices(), q = f.env.$q; f.env.$q = s => s === '#battle-whirlwind-extras' ? { textContent: '', querySelectorAll: () => [] } : q(s);
 assert.equal(f.pick().name, 'Flame Strike'); assert.equal(f.pick().probe, true);
});
for (const role of ['mage', 'fighter']) test(role + ': на 35 MP АОЕ за 38 MP не выбирается', () => {
 const f = choices(role); assert.equal(f.pick({ cur: 35, max: 5408 }).name, 'Blaze');
});

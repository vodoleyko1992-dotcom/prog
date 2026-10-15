'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/../modules/tvt.js', 'utf8');
function fixture() {
 let now = 1900000000000, kills = 0;
 const base = now, queue = [], clicks = [], delays = [], reads = [];
 const roster = Array.from({ length: 8 }, (_, i) => ({ dataset: { characterId: 'enemy-' + i }, textContent: 'Enemy ' + i, title: 'Уровень ' + (i + 1), className: 'l2-tvt-nick', id: 'enemy-' + i }));
 const vt = { id: 'vt', title: 'Vampiric Touch', action: 'l2_1147' }, blaze = { id: 'blaze', title: 'Blaze', action: 'l2_1220' }, attack = { id: 'attack', title: 'Атака', action: 'attack' }, back = { id: 'back' };
 const catalog = [...Array.from({ length: 9 }, (_, i) => ({ skillId: 2000 + i, action: 'l2_' + (2000 + i), nameUk: 'Other ' + i, targetType: 'enemy', usable: true })), { skillId: 1220, action: 'l2_1220', nameUk: 'Blaze', mpCost: 29, usable: true, targetType: 'enemy', readyAt: null }];
 const deliver = () => { queue.sort((a, b) => a.t - b.t); while (queue.length && queue[0].t <= now) queue.shift().fn(); };
 const schedule = (ms, fn) => queue.push({ t: now + ms, fn });
 const env = { cfg: { tvtOn: true, nPower: 'Vampiric Touch, Blaze', nAttack: 'Атака', tvtPet: true }, rt: {}, on: true, tabOwner: true,
  TVT: { eventId: 'event', phase: 'ACTIVE', isRegistered: true, myTeam: 1, startsAt: now - 1000, t: now }, TVTC: { actN: 0, selectedTarget: null, t: now }, TVTS: { skills: catalog.slice(0, 8), complete: false },
  setRt: async p => Object.assign(env.rt, p), rec() {}, setStatus() {}, cleanTitle: n => n, ready: () => true,
  names: s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean), slotsBy: n => /vampiric/i.test(n) ? [vt] : /blaze/i.test(n) ? [blaze] : /атака/i.test(n) ? [attack] : [], slotAction: b => b.action,
  meHp: () => ({ pct: 100 }), meMp: () => ({ cur: 5408, max: 5408 }), forceCosts: () => [], hudForce: () => 0, forceNow: () => 0, forceMax: () => 0,
  $q: s => s === '#tvt-back-roster-btn' ? back : s === '#tvt-target-name' ? { textContent: env.TVTC.selectedTarget?.name || '—' } : s === '#tvt-target-hp' ? { textContent: env.TVTC.selectedTarget ? `${env.TVTC.selectedTarget.hp} / 4000` : '' } : s === '#tvt-battle-target-block' && env.TVTC.selectedTarget ? {} : null,
  shown: e => !!e, rnd: a => a, sleep: async ms => { delays.push(ms); now += ms; deliver(); },
  waitX: async (fn, timeout = 1000, interval = 25) => { const start = now; while (now - start < timeout) { deliver(); const r = fn(); if (r) return r; now += interval; } deliver(); return fn(); },
  gameGet: async path => { reads.push(path); return { ok: true, json: async () => ({ skills: catalog }) }; },
  fire: b => {
   clicks.push({ id: b.id, at: now - base });
   if (b === back) schedule(200, () => { env.TVTC.selectedTarget = null; env.TVTC.t = now; });
   else if (b.id.startsWith('enemy-')) schedule(200, () => { env.TVTC.selectedTarget = { characterId: b.id, name: b.textContent, hp: 4000, maxHp: 4000, cp: 1000, alive: true }; env.TVTC.t = now; });
   else if (b === blaze || b === attack) schedule(270, () => { env.TVTC.actN++; env.TVTC.actT = now; env.TVTC.selectedTarget.hp = 0; env.TVTC.selectedTarget.alive = false; env.TVTC.t = now; kills++; if (kills === 8) env.on = false; });
  } };
 const box = { console, Date: class extends Date { static now() { return now; } }, location: { pathname: '/tvt-arena.html' }, document: { querySelectorAll: () => roster } };
 vm.runInNewContext(source, box);
 return { env, T: box.L2V7Factories.tvt(env), clicks, delays, reads, vt, blaze, attack, catalog, elapsed: () => now - base, kills: () => kills };
}
test('лог 05:00: восемь однокнопочных убийств без повторов запрещённого VT и фиксированного ожидания новой цели', async () => {
 const f = fixture(); await f.T.tvtFight();
 assert.equal(f.kills(), 8); assert.equal(f.clicks.filter(x => x.id === 'vt').length, 0);
 assert.equal(f.clicks.filter(x => x.id === 'blaze').length, 8);
 assert.deepEqual(f.reads, ['/game/tvt/skills']); assert.equal(f.env.TVTS.skills.length, 10, 'не теряется Blaze за 8-м элементом');
 assert.ok(f.elapsed() < 8000, `синтетический replay с RTT200/270мс: ${f.elapsed()}мс`);
 assert.ok(!f.delays.includes(350), 'смена цели ждёт подтверждение, а не фиксированные350мс');
});
test('полный каталог: отсутствующий, unusable и небоевой targetType исключаются, базовая атака разрешена', async () => {
 const f = fixture(); await f.T.tvtSkillsRefresh(); assert.equal(f.T.tvtSkillAllowed(f.vt), false); assert.equal(f.T.tvtSkillAllowed(f.blaze), true); assert.equal(f.T.tvtSkillAllowed(f.attack), true);
 f.env.TVTS.skills.find(x => x.skillId === 1220).usable = false; assert.equal(f.T.tvtSkillAllowed(f.blaze), false);
 Object.assign(f.env.TVTS.skills.find(x => x.skillId === 1220), { usable: true, targetType: 'self' }); assert.equal(f.T.tvtSkillAllowed(f.blaze), false);
});
test('укороченный сетевой снимок не затирает уже загруженный полный каталог', async () => {
 const f = fixture(); await f.T.tvtSkillsRefresh();
 const core = fs.readFileSync(__dirname + '/../content.js', 'utf8'), a = core.indexOf("  if (path === '/game/tvt/skills' &&"), b = core.indexOf("  if (path === '/game/tvt/action')", a);
 const box = { path: '/game/tvt/skills', d: { res: { skills: [...f.catalog.slice(0, 8), '…ещё2'] } }, TVTS: f.env.TVTS, Date, tvtState: () => ({ id: 'event' }) };
 vm.runInNewContext(core.slice(a, b), box); assert.equal(box.TVTS.complete, true); assert.equal(box.TVTS.skills.length, 10);
});
test('Stop при загрузке каталога не меняет его и не начинает удар', async () => {
 const f = fixture(); f.env.gameGet = async () => { f.env.on = false; return { ok: true, json: async () => ({ skills: f.catalog }) }; };
 await f.T.tvtSkillsRefresh(); assert.equal(f.env.TVTS.complete, false); assert.equal(f.clicks.length, 0);
});

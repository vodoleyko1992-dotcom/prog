'use strict';
// Лог 17.10 15:00–15:02 (West Tyrant 57, TvT): Focused Force 69 раз «+1 енергія (1/4)» — энергия на арене не копится, MP ушло в 2,
// дальше 57 с обычная атака по 1 урону при 1013 банках MP «#728 — зілля …» на панели. Бот должен пить банку MP и не жать пустой заряд.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/../modules/tvt.js', 'utf8');
const slot = (id, title, action, qty) => ({ id, title, action, querySelector: s => s === '.l2-battle-hotbar-slot-uqty' && qty != null ? { textContent: String(qty) } : null });
function fixture({ mp = 2, hpPct = 100, maxClicks = 12 } = {}) {
 let now = 1900000000000;
 const queue = [], clicks = [], recs = [];
 const enemy = { dataset: { characterId: 'luk' }, textContent: 'luk', title: 'Уровень 59', className: 'l2-tvt-nick' };
 const bf = slot('bf', 'Burning Fist', 'l2_280'), ff = slot('ff', 'Focused Force', 'l2_50'), atk = slot('attack', 'Атака', 'attack');
 const mpPot = slot('mp728', '#728 — зілля: натисни для використання (1013 у сумці)', '', 1013), drug = slot('mp726', '#726 — зілля: натисни для використання (53 у сумці)', '', 53);
 const hpPot = slot('hp1061', '#1061 — зілля: натисни для використання (665 у сумці)', '', 665);
 const hotbar = [atk, hpPot, drug, mpPot, bf, ff];
 const catalog = [{ skillId: 280, action: 'l2_280', nameUk: 'Burning Fist', mpCost: 71, targetType: 'enemy', usable: true }, { skillId: 50, action: 'l2_50', nameUk: 'Focused Force', mpCost: 5, targetType: 'enemy', usable: true }];
 const st = { mp, hpPct };
 const deliver = () => { queue.sort((a, b) => a.t - b.t); while (queue.length && queue[0].t <= now) queue.shift().fn(); };
 const after = (ms, fn) => queue.push({ t: now + ms, fn });
 const env = { cfg: { tvtOn: true, nPower: 'Burning Fist', nCharge: 'Focused Force', nAttack: 'Атака', nMpPot: 'Зілля мани', tvtPet: false }, rt: {}, on: true, tabOwner: true,
  TVT: { eventId: 'ev', phase: 'ACTIVE', isRegistered: true, myTeam: 1, startsAt: now - 1000, t: now },
  TVTC: { actN: 0, selectedTarget: { characterId: 'luk', name: 'luk', hp: 6898, maxHp: 9827, cp: 0, alive: true }, t: now },
  TVTS: { skills: catalog, complete: true, event: 'ev' },
  setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), setStatus() {}, cleanTitle: n => n, ready: () => true,
  names: s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
  slotsBy: n => hotbar.filter(b => b.title.toLowerCase() === String(n).toLowerCase()), slotAction: b => b.action,
  meHp: () => ({ pct: st.hpPct }), meMp: () => ({ cur: st.mp, max: 1256 }), forceCosts: () => [], hudForce: () => null, forceNow: () => 0, forceMax: () => 0,
  hpPotPick: () => null,
  $q: s => s === '#tvt-target-name' ? { textContent: 'luk' } : s === '#tvt-target-hp' ? { textContent: '6898 / 9827' } : s === '#tvt-battle-target-block' ? {} : null,
  shown: e => !!e, rnd: a => a, sleep: async ms => { now += ms; deliver(); },
  waitX: async (fn, timeout = 1000, interval = 25) => { const t0 = now; while (now - t0 < timeout) { deliver(); const r = fn(); if (r) return r; now += interval; } deliver(); return fn(); },
  gameGet: async () => ({ ok: true, json: async () => ({ skills: catalog }) }),
  fire: b => {
   clicks.push(b.id); if (clicks.length >= maxClicks) env.on = false;
   const reply = (req, res) => after(300, () => { env.TVTC.actN++; env.TVTC.actT = now; T.tvtActNote(req, res); });
   if (b === mpPot) { st.mp = Math.min(1256, st.mp + 500); reply({ action: 'potion', itemId: 728 }, { itemId: 728, restoredHp: 0, restoredMp: 500, selfMp: st.mp }); }
   else if (b === hpPot) { st.hpPct = 100; reply({ action: 'potion', itemId: 1061 }, { itemId: 1061, restoredHp: 900, restoredMp: 0 }); }
   else if (b === ff && st.mp >= 5) { st.mp -= 5; reply({ action: 'skill', skillId: 50 }, { skillId: 50, skillLine: 'Концентрація сили: +1 енергія (1/4).', selfMp: st.mp }); }
   else if (b === bf && st.mp >= 71) { st.mp -= 71; catalog[0].readyAt = now + 5000; reply({ action: 'skill', skillId: 280 }, { skillId: 280, skillLine: 'Burning Fist: сила 1069.', selfMp: st.mp, skillReadyAt: now + 5000 }); }
   else if (b === atk) reply({ action: 'attack' }, { outcome: 'hit', damage: 1, nextBasicAttackAt: now + 1200 });
  } };
 const box = { console, Date: class extends Date { static now() { return now; } }, location: { pathname: '/tvt-arena.html' },
  document: { querySelectorAll: s => s === '.l2-battle-hotbar-slot' ? hotbar : [enemy] } };
 vm.runInNewContext(source, box);
 const T = box.L2V7Factories.tvt(env);
 return { env, T, clicks, recs, st };
}
test('MP 2 при банках «#728» на панели: первым действием пьёт банку MP, а не бьёт обычной атакой по 1 урону', async () => {
 const f = fixture({ mp: 2, maxClicks: 3 }); await f.T.tvtFight();
 assert.equal(f.clicks[0], 'mp728', f.clicks.join(','));
 assert.ok(f.clicks.includes('bf'), 'после банки — силовой удар: ' + f.clicks.join(','));
 assert.ok(f.recs.some(r => /пью банку MP/.test(r)));
});
test('заряд, который не растёт («1/4» подряд), больше не жмётся до конца события', async () => {
 const f = fixture({ mp: 1256, maxClicks: 14 }); await f.T.tvtFight();
 const ffN = f.clicks.filter(x => x === 'ff').length;
 assert.ok(ffN <= 3, `заряд нажат ${ffN} раз: ${f.clicks.join(',')}`);
 assert.ok(f.recs.some(r => /не копит энергию/.test(r)));
});
test('банки арены узнаются по ID: #728/#726 — MP, #1061 — HP; Mana Drug только если других нет', () => {
 const f = fixture();
 assert.equal(f.T.potKindOf({ title: '#728 — зілля: натисни' }), 'mp');
 assert.equal(f.T.potKindOf({ title: '#726 — зілля: натисни' }), 'mp');
 assert.equal(f.T.potKindOf({ title: '#1061 — зілля: натисни' }), 'hp');
 assert.equal(f.T.potKindOf({ title: 'Soul Breaker' }), null);
 assert.equal(f.T.arenaPot('mp').id, 'mp728');
 f.T.tvtActNote({ action: 'potion', itemId: 999 }, { restoredMp: 300 });
 assert.equal(f.T.potKindOf({ title: '#999 — зілля' }), 'mp', 'тип учится по restoredMp ответа');
});
test('HP 50 % на арене: банка «#1061 — зілля» пьётся, хотя её имя не узнаёт общий HP_POT_RE', async () => {
 const f = fixture({ mp: 1256, hpPct: 50, maxClicks: 1 }); await f.T.tvtFight();
 assert.equal(f.clicks[0], 'hp1061');
});
test('content.js передаёт каждый ответ /game/tvt/action в tvt.tvtActNote', () => {
 const core = fs.readFileSync(__dirname + '/../content.js', 'utf8');
 assert.match(core, /path === '\/game\/tvt\/action'\) try \{ L2V7Modules\.tvt\.tvtActNote\(d\.req/);
});

'use strict';
// 7.2.1: РБ-сессия с баффом за FA — покупка один раз, после смерти только Noblesse, конец → автофарм (ответы игрока 10.10)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const load = f => { const sb = { console, Date, Math, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/map.html' } }; sb.globalThis = sb; vm.runInNewContext(fs.readFileSync(path.join(root, f), 'utf8'), sb); return sb; };
const now = Date.now(), H3 = now + 3 * 3600000;
let hud = {}, buffTrips = 0, cfgSet = null;
const recs = [];
const env = { rt: { rbKills: 5, exp: 1000, adena: 500, deaths: [], faBal: { v: 82, t: now } },
  cfg: { rbSessBuffs: '1413, 1323, 4703', rbSessNob: true, faBuffs: '' },
  setRt: async p => Object.assign(env.rt, p), setCfg: async p => { cfgSet = p; Object.assign(env.cfg, p); }, rec: (...a) => recs.push(a.join(' ')), setStatus: () => {},
  hudBuffs: () => hud, townBuffStart: async () => { buffTrips++; return true; }, faCost: () => 1 };
const B = load('modules/buffs.js').L2V7Factories.buffs(env);
env.faIdsOf = B.faIdsOf;
const R = load('modules/raid.js').L2V7Factories.raid(env);
// 1. старт: баффов нет → бот идёт к бафферу, нужны все три
env.rt.rbSess = { on: true, start: now, bought: false };
assert.deepEqual([...B.faWanted()].sort(), [1323, 1413, 4703]);
(async () => {
  assert.equal(await R.rbSessTick(), true); assert.equal(buffTrips, 1, 'to the buffer');
  // 2. баффы на месте (3 ч) → сессия пошла, до конца баффа
  hud = { 1413: H3, 1323: H3, 4703: H3 + 1000 };
  assert.equal(await R.rbSessTick(), false);
  assert.equal(env.rt.rbSess.bought, true); assert.equal(env.rt.rbSess.until, H3);
  // 3. после смерти слетел Noblesse — снова нужен только он
  delete hud[1323];
  assert.deepEqual([...B.faWanted()], [1323], 'only Noblesse is re-bought');
  env.cfg.rbSessNob = false; assert.deepEqual([...B.faWanted()], [], 'unless switched off'); env.cfg.rbSessNob = true;
  assert.equal(await R.rbSessTick(), false, 'other buffs kept by Noblesse → session goes on');
  // 4. за 5 мин до конца баффы сессии больше не нужны (не докупать на новые 3 ч)
  env.rt.rbSess.until = Date.now() + 4 * 60000;
  assert.deepEqual([...B.faWanted()], []);
  // 5. за 2 мин до конца — итог и автофарм
  env.rt.rbSess.until = Date.now() + 60000; env.rt.rbKills = 9; env.rt.exp = 5000;
  assert.equal(await R.rbSessTick(), true);
  assert.equal(env.rt.rbSess.on, false); assert.equal(env.rt.rbSess.sum.kills, 4);
  assert.equal(cfgSet.zoneAuto, true); assert.equal(cfgSet.rbHuntMode, false);
  assert.match(recs.join('\n'), /окончена: бафф заканчивается .* РБ убито 4 .* режим «Автофарм», жду игрока/);
  // 6. смерть без Noblesse — баффы слетели совсем → конец (не тратим FA заново)
  env.rt.rbSess = { on: true, bought: true, until: Date.now() + 3600000 }; hud = {};
  assert.equal(await R.rbSessTick(), true); assert.match(env.rt.rbSess.sum.why, /смерть без Noblesse/);
  // 7. справочник FA: номера Prophecy и цены Greater (снимок баффера 22:27)
  const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  assert.match(content, /1357: \['Prophecy of Water', 5\], 1355: \['Prophecy of Wind', 5\]/);
  assert.match(content, /4703: \['Дар Серафима \(откат −30 %\)', 1\]/);
  console.log('PASS: RB session — buy once, re-buy only Noblesse after death, no re-buy at the end, summary + autofarm, ends if buffs lost');
})().catch(e => { console.error(e); process.exit(1); });

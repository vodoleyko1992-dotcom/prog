'use strict';
// 10.0.1 (лог 12.10 18:10–18:12, игрок: «не срабатывает автобафф под РБ перед рейдом на РБ»): фулл бафф за FA брался только в
// «РБ-сессии» (кнопка «🔥 Начать РБ-сессию»). Обычный «Тур РБ» полетел к Giant Marpanak, The 3rd Underwater Guardian и Roaring Lord
// Kastor без единого баффа за FA. Теперь тур берёт тот же набор (cfg.rbFaFull, по умолчанию вкл) — только перед вылетом к РБ
const assert = require('node:assert/strict');
const { vm, read } = require('./epic-harness.cjs');

const now = Date.now(), E3 = now + 3 * 3600000 - 60000;
let hud = {};
const hudEl = { querySelectorAll: () => Object.entries(hud).map(([id, e]) => ({ dataset: { skillId: id, expiresAt: String(e) }, getAttribute: () => '' })) };
const benv = { cfg: { rbSessBuffs: 'auto', rbSessNob: true, faBuffs: '', townBuffSet: 'basic', rbHuntMode: true, rbMode: true }, rt: { faBal: { v: 101, t: now }, rbHunt: { step: 'pick' }, tbT: 0 },
  TB_KEYS: { basic: [1068] }, IL: {}, FA_KNOWN: {}, $q: s => s === '#l2-hud-active-buffs' ? hudEl : null, setRt: async p => Object.assign(benv.rt, p), rec: () => {},
  heroRole: () => ({ mage: true }), epicFaOk: () => false, waitX: async f => f() || null, epicBuffCol: () => null, sleep: async () => {} };
const loc = { pathname: '/map.html', href: '/map.html' };
const bsb = { console, Date, Math, JSON, document: { querySelectorAll: () => [] }, location: loc };
bsb.globalThis = bsb; vm.createContext(bsb); vm.runInContext(read('fa-full.js'), bsb); vm.runInContext(read('modules/buffs.js'), bsb);
const B = bsb.L2V7Factories.buffs(benv), F = bsb.L2FaFull;
const mage = [...F.dropClash(F.ids({ mage: true }), {})];   // 10.0.7: из группы Greater (Magnus/Water не стакаются) в наборе один
benv.faCost = id => F.COST[id] || 1;
hud = { 1068: now + 20 * 3600000 };   // городской набор на месте

(async () => {
  // тур фармит мобов / читает список — FA не тратим
  assert.deepEqual([...B.faWanted()], [], 'tour picking/idle → no FA set');
  // вылет к выбранному РБ: «перед РБ …» → фулл бафф за FA
  assert.equal(await B.townBuffStart('перед РБ Giant Marpanak', true), true, 'tour before a RB → trip to the FA buffer');
  assert.deepEqual([...benv.rt.tbuff.fa], mage, 'whole mage set (22 FA) is bought');
  assert.equal(benv.rt.tbuff.step, 'fa'); assert.equal(loc.href, '/fast-aden-buffer.html');
  // шаг тура «go» / «fight» — набор нужен (после «Восстановить» тоже докупится)
  benv.rt.tbuff = null; benv.rt.tbT = 0;
  benv.rt.rbHunt = { step: 'go' }; assert.deepEqual([...B.faWanted()], mage, 'tour step go');
  // набор висит — не ходим
  hud = { 1068: now + 20 * 3600000, ...Object.fromEntries(mage.map(id => [id, E3])) };
  assert.equal(B.townBuffNeed(), null, 'set on the panel → no trip');
  // кончился один бафф — докупается только он
  hud[1413] = now + 30000; assert.deepEqual([...B.townBuffNeed().fa], [1413], 'only the expiring buff');
  hud[1413] = E3;
  // выключатель
  hud = { 1068: now + 20 * 3600000 };
  benv.cfg.rbFaFull = false; assert.deepEqual([...B.faWanted()], [], 'option off → as before'); delete benv.cfg.rbFaFull;
  // не тур (РБ между мобами) — как раньше
  benv.cfg.rbHuntMode = false; assert.deepEqual([...B.faWanted()], [], 'rbBetween alone → no FA set'); benv.cfg.rbHuntMode = true;
  // FA не хватает ни на один — не ходим
  benv.rt.faBal = { v: 0, t: now }; assert.deepEqual([...B.faWanted()], [], 'no FA → no trip'); benv.rt.faBal = { v: 101, t: now };
  // РБ-сессия идёт и уже купила — тур не докупает весь набор (только Noblesse по правилам сессии)
  benv.rt.rbSess = { on: true, bought: true, until: now + 2 * 3600000 };
  assert.deepEqual([...B.faWanted()], [1323], 'running RB session keeps its own rules'); benv.rt.rbSess = null;
  // проводка: умолчание, меню
  assert.match(read('content.js'), /epicFaFull: true, rbFaFull: true,/);
  assert.match(read('popup.html'), /id="rbFaFull" type="checkbox"/);
  assert.match(read('popup.js'), /'rbSessNob', 'rbFaFull',/); assert.match(read('popup.js'), /epicFaFull: true, rbFaFull: true/);
  console.log('PASS: 10.0.1 RB tour takes the FA full buff before flying to a RB (not while farming), only missing buffs, switch rbFaFull');
})().catch(e => { console.error(e); process.exit(1); });

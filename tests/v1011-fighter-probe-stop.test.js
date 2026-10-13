'use strict';
// 10.0.11 (лог 13.10 22:03–22:12, Knight alt1): Drain Health без цифры урона в логе игры → «пробую новый удар (замер 1/3)» 16 раз подряд.
// Проба воина — не больше PROBE_USES (8) нажатий; 5+ нажатий без единого замера урона — удара в ротации нет (как у мага)
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const dom = { slots: [], querySelectorAll(sel) { return sel === 'button' ? this.slots : []; }, querySelector(sel) { return sel === '#battle-mob-hp-val' ? { textContent: '1524/1524' } : null; } };
const sandbox = { console, Math, Date, document: dom, location: { pathname: '/battle.html' }, globalThis: null }; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'modules', 'combat.js'), 'utf8'), sandbox, { filename: 'combat.js' });
const make = (title, key, cd = 0) => ({ title, key, cdUntil: cd, disabled: false, getAttribute: () => null, querySelector: () => null });
function plan(skills, psCd = 0) {
  const atk = make('Атака', 'атака'), ps = make('Power Strike', 'power strike', psCd), dh = make('Drain Health', 'drain health');
  dom.slots = [atk, ps, dh];
  const cfg = { nAttack: 'Атака', nPower: 'Power Strike, Drain Health', nUltra: '', nCharge: '', nForce: '', fightMode: 'dps', skillMpMin: 0 };
  const rt = { skills, skillDb: {}, rbDb: {}, pots: {}, cdUntil: {}, cdUse: {} };
  const avg = k => { const p = skills[k]; return p && p.dmgN ? Math.round(p.dmg / p.dmgN) : 0; };
  const env = { SLOT: 'button', cfg, rt, HP_POT_RE: /healing/i,
    names: s => String(s || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean),
    isEquip: () => false, shown: x => x ? 1 : 0, slotKind: b => b === atk ? 'атака' : 'скилл',
    slotCd: () => null, slotAction: () => null, skKey: b => b.key,
    memLeft: b => Math.max(0, ((b.cdUntil || 0) - Date.now()) / 1000), uiTimer: b => Math.max(0, ((b.cdUntil || 0) - Date.now()) / 1000),
    combatCooldown: { skillWait: () => 0 }, battleSpawn: () => 1, ilOf: () => ({ reuse: 8000 }),
    $q: sel => dom.querySelector(sel), expDmg: k => avg(String(k).toLowerCase()),
    forceNow: () => 0, forceMax: () => 0, forceCosts: () => [], isChargeName: () => false, isForceName: () => false,
    cleanTitle: s => s, longFightMp: () => null, skillMp: () => 15, meHp: () => ({ cur: 2335, max: 2335, pct: 100 }),
    hpPotByDeficit: () => null, mpPotSlot: () => null, chargeValue: () => 0, turnSec: () => 1.2, actCost: () => 1,
    qty: () => 0, SK_NET: {}, setRt: async patch => Object.assign(rt, patch) };
  const C = sandbox.L2V7Factories.combat(env);
  return C.dpsPlan({ block: {} }, { cur: 280, max: 299 });
}
const PS = { uses: 61, dmg: 61 * 1028, dmgN: 61, cd: 1.8 }, ATK = { uses: 66, dmg: 33 * 369, dmgN: 33 };

// 1. как в логе: Drain Health нажат 26 раз, урон засчитан 1 раз (23) — пробы больше нет, в ход идёт Power Strike
{ const a = plan({ 'атака': ATK, 'power strike': PS, 'drain health': { uses: 26, dmg: 23, dmgN: 1, cd: 8.3 } });
  assert.ok(a && !/пробую/.test(a.why), 'после 8+ нажатий проба не повторяется: ' + a?.why);
  assert.equal(a.name, 'Power Strike'); }
// 2. новый удар (3 нажатия, 1 замер) на толстом мобе — проба как прежде
{ const a = plan({ 'атака': ATK, 'power strike': PS, 'drain health': { uses: 3, dmg: 23, dmgN: 1, cd: 8.3 } });
  assert.ok(a && /пробую новый удар \(замер 1\/3\)/.test(a.why), 'новый удар пробуем: ' + a?.why); assert.equal(a.name, 'Drain Health'); }
// 3. 5+ нажатий без единого замера урона — удара нет в ротации: Power Strike на откате → обычная атака, не Drain Health
{ const a = plan({ 'атака': ATK, 'power strike': PS, 'drain health': { uses: 6, dmg: 0, dmgN: 0, cd: 8.3 } }, Date.now() + 5000);
  assert.ok(a, 'ход есть'); assert.equal(a.key, 'attack', 'без замера урона Drain Health не жмётся: ' + a?.name + ' ' + a?.why); }
// 4. 4 нажатия без замера — ещё пробуем (не рубим раньше времени)
{ const a = plan({ 'атака': ATK, 'power strike': PS, 'drain health': { uses: 4, dmg: 0, dmgN: 0, cd: 8.3 } });
  assert.equal(a?.name, 'Drain Health', 'до 5 нажатий проба идёт: ' + a?.why); }
console.log('v1011-fighter-probe-stop: OK');

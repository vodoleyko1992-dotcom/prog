'use strict';
// 20.43–20.44: модель сервера и прогон шагов набора крафтера (modules/crafterkit.js) — общие для v2043-crafter-kit и v2044-crafter-kit-review.
// Сервер — по живым запросам 16.10/21.10: POST /character/equip (equip/unequip), POST /character/skills/cast {battleId:'l2_25'},
// POST /character/companion/dismiss. Часы — свои (Date.now внутри модуля), шаг главного цикла — K.step().
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = n => fs.readFileSync(path.join(root, n), 'utf8');
const ITEMS = JSON.parse(read('items-il.json'));
const GRADE_LV = { NG: 0, D: 20, C: 40, B: 52, A: 61, S: 76 };
const POLE = 299, YAKSA = 2503, BONE = 159, KNIGHT = 632, BRONZE = 626, VICTORY = 104, B_MACE = 171, CRYSTAL = 1459;

function hero(over = {}) {
  return { id: 7, name: 'Craft', revision: 100, level: 42, mp: 500, l2Profession: 'dwarf_warsmith', inBattle: false, activeSummon: null,
    inventory: { eq: { l1: { itemId: POLE, enchant: 0 }, l2: 0 },
      stacks: [{ itemId: YAKSA, qty: 1, enchant: 4, enchantPAtkBonus: 16, enchantMAtkBonus: 0 }, { itemId: BONE, qty: 1 }, { itemId: KNIGHT, qty: 1 },
        { itemId: BRONZE, qty: 1 }, { itemId: VICTORY, qty: 1 }, { itemId: B_MACE, qty: 1 }, { itemId: CRYSTAL, qty: 40 }] }, ...over };
}
// сервер: revision, сумка/надетое, голем; hook — подмена ответа на конкретный запрос
function server(h) {
  const S = { h, posts: [], gets: 0, hook: null };
  const res = (status, j) => ({ ok: status >= 200 && status < 300, status, json: async () => j });
  const tokenOf = s => `bag:${s.itemId}:${+s.enchant || 0}` + (s.enchantPAtkBonus || s.enchantMAtkBonus ? `:${+s.enchantPAtkBonus || 0}:${+s.enchantMAtkBonus || 0}` : '');
  const bagPut = v => { if (v && (+v.itemId || +v)) S.h.inventory.stacks.push(typeof v === 'object' ? { ...v, qty: 1 } : { itemId: +v, qty: 1 }); };
  S.get = async p => { S.gets++; assert.equal(p, '/character'); return res(200, { character: JSON.parse(JSON.stringify(S.h)) }); };
  S.post = async (p, b) => {
    S.posts.push([p, JSON.parse(JSON.stringify(b))]);
    if (S.hook) { const r = await S.hook(p, b, S); if (r) return r; }
    if (b.expectedRevision !== S.h.revision) return res(409, { error: 'revision' });
    const inv = S.h.inventory;
    if (p === '/character/equip' && b.action === 'equip') {
      const i = inv.stacks.findIndex(s => +s.itemId === b.itemId && tokenOf(s) === b.targetInstanceId);
      if (i < 0) return res(400, { messageUk: 'Предмет не знайдено' });
      const it = ITEMS[b.itemId], slot = it.wt === '—' ? 'l2' : 'l1';
      if (slot === 'l2' && ITEMS[inv.eq.l1?.itemId]?.two) return res(400, { messageUk: 'Дворучна зброя' });
      const [s] = inv.stacks.splice(i, 1); bagPut(inv.eq[slot]); inv.eq[slot] = { itemId: s.itemId, enchant: +s.enchant || 0, enchantPAtkBonus: s.enchantPAtkBonus, enchantMAtkBonus: s.enchantMAtkBonus };
      if (slot === 'l1' && it.two && inv.eq.l2) { bagPut(inv.eq.l2); inv.eq.l2 = 0; }
    } else if (p === '/character/equip' && b.action === 'unequip') { bagPut(inv.eq[b.slot]); inv.eq[b.slot] = 0; }
    else if (p === '/character/skills/cast') {
      assert.equal(b.battleId, 'l2_25'); const c = inv.stacks.find(s => +s.itemId === CRYSTAL);
      if (!c || c.qty < 7) return res(400, { messageUk: 'Немає кристалів' });
      c.qty -= 7; S.h.mp -= 88; S.h.activeSummon = { key: 'mechanic_golem', hp: 2400, maxHp: 2400, summonSkillId: 25 };
    } else if (p === '/character/companion/dismiss') { assert.equal(b.characterId, 7); S.h.activeSummon = null; }
    else return res(404, {});
    S.h.revision++;
    return res(200, { character: JSON.parse(JSON.stringify(S.h)) });
  };
  return S;
}
function make(o = {}) {
  const st = {}, clock = { now: 1792000000000 };
  const box = { console, JSON, sessionStorage: { getItem: k => st[k] ?? null, setItem: (k, v) => { st[k] = String(v); } }, Date: class extends Date { static now() { return clock.now; } } };
  vm.runInNewContext(read('modules/crafterkit.js'), box);
  const S = server(hero(o.hero)), recs = [], notes = [], pets = [];
  const M = { mode: o.mode || 'raid', role: 'crafter', loot: false, battle: false, pet: null, weapon: null };
  const env = { cfg: { crafterKit: true, ...o.cfg }, rt: { char: 'Craft', weapons: o.weapons || [] }, on: true, tabOwner: true,
    role: () => M.role, mode: () => M.mode, lootGoal: () => M.loot, isBattle: () => M.battle, busy: () => false, canAct: () => true, gearBusy: () => false,
    rec: (...a) => recs.push(a.join(' ')), setStatus: () => {}, itemsDb: async () => ITEMS, itemOf: id => ITEMS[id] ? { id, ...ITEMS[id] } : null, GRADE_LV, heroLevel: () => 42,
    gameGet: p => S.get(p), gamePost: (p, b) => S.post(p, b), equipNote: async b => notes.push(b), petNote: c => pets.push(c.activeSummon),
    petHas: re => !!M.pet && re.test(M.pet), weaponNow: () => M.weapon };
  const K = box.L2V7Factories.crafterkit(env);
  // прогон шагов, как главный цикл: true — набор держит цикл; время идёт на 1 с за шаг
  const drive = async (n = 30, dt = 1000) => { const out = []; for (let i = 0; i < n; i++) { out.push(await K.step()); clock.now += dt; } return out; };
  return { K, S, env, M, recs, notes, pets, clock, drive, box, st };
}
const eqOf = S => [S.h.inventory.eq.l1?.itemId || 0, S.h.inventory.eq.l2?.itemId || 0, S.h.activeSummon?.key || ''];

module.exports = { ITEMS, GRADE_LV, POLE, YAKSA, BONE, KNIGHT, BRONZE, VICTORY, B_MACE, CRYSTAL, hero, server, make, eqOf, read, vm };

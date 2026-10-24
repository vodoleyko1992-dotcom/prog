'use strict';
// 20.43 (John 21.10 13:37: «раздел сабкласс, выбрал сабкласс нажал старт, он его сменил и одел топ шмот и топ бижутерию, и оружие с щитом»):
// modules/subgo.js — план комплекта по снимкам живой игры 21.10 (Warsmith 49, Fortune Seeker 76, Arcana Lord 78; UID заменены)
// и шаг ядра: телепорт к Reorin → switch → надевание с повтором при 409.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
require(path.join(__dirname, '..', 'modules/subgo.js'));
const G = globalThis.L2SubGear;
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/subgo-2026-10-21.json'), 'utf8'));
const C = F.catalog, clone = o => JSON.parse(JSON.stringify(o));
const names = P => Object.fromEntries(Object.entries(P.slots).map(([k, v]) => [k, v ? v.id : null]));

// 1. Warsmith 49 после смены с основного: всё S/A сервер снял в сумку — надеваем C-комплект (как был до смены)
{ const P = G.planGear(F.ws, C, { wt: ['blunt', 'bigblunt'], shield: true });
  const n = names(P);
  assert.equal(n.l1, 2503, 'Yaksa Mace C'); assert.equal(n.l2, 2497, 'Full Plate Shield');
  assert.equal(P.slots.l1.token, 'bag:2503:4:16:0', 'заточенное оружие: токен с бонусами заточки');
  assert.equal(P.armor, 'heavy'); assert.equal(n.l3, 941301); assert.equal(n.l4, 941303); assert.equal(n.lh, 941302);
  assert.equal(n.lg, 2455, 'пустой слот тяжёлой — лёгкие перчатки'); assert.equal(n.lf, 2431);
  assert.deepEqual([n.lr1, n.lr2], [884, 884], 'два одинаковых кольца'); assert.equal(n.neck, 916);
  for (const k of ['l1', 'l2', 'l3', 'lh', 'le1', 'lr1', 'neck']) assert.ok(P.slots[k].grade === 'C', 'выше C на 49 не надевается: ' + k);
  const ops = G.diff(F.ws, P);
  assert.equal(ops.length, 12); assert.ok(ops.every(o => o.op === 'equip'));
  // итог живой проверки — надето всё, план пуст
  assert.equal(G.diff(F.ws0, G.planGear(F.ws0, C, { wt: ['blunt'], shield: true })).length, 0);
}
// 2. Warsmith на фарм: пика, без щита
{ const P = G.planGear(F.ws0, C, { wt: ['pole', 'blunt'], shield: false });
  assert.equal(P.slots.l1.id, 299, 'Orcish Poleaxe C'); assert.equal(P.slots.l2, null);
  const ops = G.diff(F.ws0, P);
  assert.ok(ops.some(o => o.op === 'equip' && o.slot === 'l1' && o.it.id === 299));
  assert.ok(!ops.some(o => o.op === 'equip' && o.slot === 'l2'));
  assert.deepEqual([ops[0].op, ops[0].slot], ['unequip', 'l2'], 'щит снимается до пики');
}
// 3. Fortune Seeker 76: дубина Elysian A (вид спойлера), клановый щит по UID, Apella — цельная броня, эпик-бижутерия
{ const P = G.planGear(F.fs, C), n = names(P);
  assert.equal(n.l1, 164, 'Елізій A — дубина спойлера, не клановое копьё'); assert.equal(n.l2, 9002285);
  assert.match(P.slots.l2.token, /^bag:9002285:0:[0-9a-f-]{36}$/, 'клановая вещь: токен с её UID (без него «Предмета немає в сумці»)');
  assert.equal(n.l3, 7864); assert.equal(n.l4, null, 'Apella Brigandine — цельная');
  assert.deepEqual([n.le1, n.le2].sort(), [6656, 6659]); assert.equal(n.lr1, 6658); assert.equal(n.neck, 8191);
  const ops = G.diff(F.fs, P), at = (op, slot) => ops.findIndex(o => o.op === op && o.slot === slot);
  assert.ok(at('unequip', 'le1') >= 0 && at('unequip', 'le2') >= 0, 'занятые серьги сначала снимаются');
  assert.ok(at('unequip', 'le2') < ops.findIndex(o => o.op === 'equip' && o.it.slot === 'earring'));
  assert.ok(!ops.some(o => o.slot === 'l4'), 'штаны цельная броня снимет сама');
  const b = G.body(ops.find(o => o.op === 'equip' && o.slot === 'l1'), 7);
  assert.deepEqual(b, { action: 'equip', itemId: 164, enchant: 0, targetInstanceId: 'bag:164:0', enchantPAtkBonus: 0, enchantMAtkBonus: 0, expectedRevision: 7 });
  assert.deepEqual(G.body({ op: 'unequip', slot: 'lr2' }, 8), { action: 'unequip', slot: 'lr2', expectedRevision: 8 });
}
// 4. Arcana Lord 78: магическое оружие (с Life Stone — токен aug-), клановая роба S, щит
{ const P = G.planGear(F.al, C), n = names(P);
  assert.equal(P.mage, true); assert.equal(P.armor, 'magic');
  assert.equal(n.l1, 9002284); assert.match(P.slots.l1.token, /^bag:9002284:25:aug-[0-9a-f-]{36}$/);
  assert.deepEqual([n.l3, n.l4, n.lh, n.lg, n.lf], [9002296, 9002297, 9002295, 9002298, 9002299]);
  assert.equal(n.l2, 9002285);
}
// 5. токены экземпляров как у игры
assert.equal(G.bagToken({ itemId: 5, enchant: 0 }, 'chest'), 'bag:5:0');
assert.equal(G.bagToken({ itemId: 5, enchant: 3, enchantPAtkBonus: 9, enchantMAtkBonus: 0, weaponEnchantHistory: ['physical', 'magic'] }, 'rhand'), 'bag:5:3:9:0:Hpm');
assert.equal(G.bagToken({ itemId: 5, enchant: 3 }, 'rhand'), null, 'без бонусов заточки токен не угадываем');
assert.equal(G.bagToken({ itemId: 910629, enchant: 0, specialGearLevel: 5 }, 'belt'), 'bag:910629:0:u5');
assert.equal(G.bagToken({ itemId: 5, rebirthWeaponAttack: 3 }, 'rhand'), null);
assert.equal(G.armorTypeOf({ nameUk: 'Кланові важкі штани', slot: 'legs' }), 'heavy');
assert.equal(G.armorTypeOf({ nameUk: 'Кланова бригандина', slot: 'chest' }), 'light');

// 6. шаг ядра: Warsmith (слот 2) → Fortune Seeker (слот 1): бесплатный телепорт в Oren, смена, надевание; 409 → повтор с serverRevision
(async () => {
  const W = clone(F.ws0); W.classSlots.activeSlot = 2;
  let near = false, rev = 100, conflictOnce = true; const posts = [], recs = [];
  const state = { ch: W };
  const res = (status, j) => ({ ok: status >= 200 && status < 300, status, json: async () => j });
  // 20.60 (лог 24.10 22:16): в памяти — оружие прежнего класса «надето»; своё надевание идёт мимо hook.js и передаётся обработчику оружия
  const notes = [];
  const env = { cfg: {}, rt: { char: 'Hero', subGo: { t: Date.now(), slot: 1, kit: 'auto', wt: 'auto', shield: 'auto' }, weaponsT: 1, weapons: [{ id: 299, where: 'надето' }] }, on: true, tabOwner: true,
    equipNote: async b => { notes.push(b); env.rt.weapons = [{ id: b.itemId, where: 'надето' }]; },
    isBattle: () => false, sleep: async () => {}, setStatus: () => {}, rec: (...a) => recs.push(a.join(' ')), rtCommit: async () => true,
    setRt: async p => { Object.assign(env.rt, p); return { ok: true }; }, classNote: ch => { env.noted = ch.l2Profession; },
    gameGet: async p => p === '/character' ? res(200, { character: clone(state.ch) }) : p === '/character/catalog-hints' ? res(200, C)
      : p === '/character/subclasses' ? res(200, { classes: { nearClassMaster: near } }) : p === '/game/teleport/locations' ? res(200, { locations: [{ teleportId: 'oren', vipFreeApplied: true, adenaCost: 0, baseAdenaCost: 12000 }] }) : res(404, {}),
    gamePost: async (p, b) => {
      posts.push([p, b]);
      if (b.expectedRevision !== rev) return res(409, { error: 'revision_conflict', serverRevision: rev });
      if (p === '/character/equip' && conflictOnce) { conflictOnce = false; rev++; return res(409, { error: 'revision_conflict', serverRevision: rev }); }
      rev++; state.ch.revision = rev;
      if (p === '/game/teleport') { near = true; return res(200, { character: clone(state.ch) }); }
      if (p === '/character/subclasses/switch') {   // как в игре: смена на FS 76 оставляет C-комплект
        const fs0 = clone(F.fs); fs0.revision = rev; state.ch = fs0; return res(200, { classes: {} }); }
      if (p === '/character/equip') {
        const eq = state.ch.inventory.eq, st = state.ch.inventory.stacks;
        if (b.action === 'unequip') { const v = eq[b.slot]; delete eq[b.slot]; st.push(typeof v === 'number' ? { itemId: v, qty: 1 } : { ...v, qty: 1 }); }
        else { const i = st.findIndex(s => G.bagToken(s, C.gearCatalog.find(g => g.itemId === s.itemId)?.slot) === b.targetInstanceId);
          if (i < 0) return res(400, { error: 'invalid_input', messageRu: 'Предмета немає в сумке.' });
          const [it] = st.splice(i, 1), slot = C.gearCatalog.find(g => g.itemId === b.itemId).slot;
          const key = { rhand: 'l1', lhand: 'l2', chest: 'l3', fullarmor: 'l3', legs: 'l4', head: 'lh', gloves: 'lg', feet: 'lf', neck: 'neck' }[slot]
            || (slot === 'earring' ? (eq.le1 ? 'le2' : 'le1') : eq.lr1 ? 'lr2' : 'lr1');
          if (eq[key]) { const v = eq[key]; st.push(typeof v === 'number' ? { itemId: v, qty: 1 } : { ...v, qty: 1 }); }
          if (slot === 'fullarmor' && eq.l4) { const v = eq.l4; delete eq.l4; st.push(typeof v === 'number' ? { itemId: v, qty: 1 } : { ...v, qty: 1 }); }
          eq[key] = { ...it }; delete eq[key].qty; }
        state.ch.revision = rev; return res(200, { character: clone(state.ch) });
      }
      return res(404, {});
    } };
  global.location = { href: '' };
  const M = globalThis.L2V7Factories.subgo(env);
  assert.equal(M.gearBusy(), true, 'пока есть команда — автонадевание ждёт');
  assert.equal(await M.step(), true);
  assert.equal(posts[0][0], '/game/teleport'); assert.deepEqual(posts[0][1], { teleportId: 'oren', expectedAdenaCost: 0, expectedRevision: 100 });
  assert.ok(posts.some(([p, b]) => p === '/character/subclasses/switch' && b.slot === 1));
  assert.equal(env.noted, 'dwarf_fortune_seeker', 'смена передана обработчикам класса');
  assert.equal(env.rt.subGo, null); assert.equal(env.rt.subGoSay.ok, true, env.rt.subGoSay.why);
  const eq = state.ch.inventory.eq, id = v => typeof v === 'number' ? v : v?.itemId;
  assert.equal(id(eq.l1), 164); assert.equal(id(eq.l2), 9002285); assert.equal(id(eq.l3), 7864); assert.equal(id(eq.neck), 8191);
  assert.deepEqual([id(eq.le1), id(eq.le2)].sort(), [6656, 6659]);
  assert.equal(location.href, '/map.html', 'после переодевания страница перечитывается');
  assert.equal(notes.length, 1, 'надетое оружие передано один раз');
  assert.deepEqual([notes[0].action, notes[0].itemId], ['equip', 164], 'память оружия — Елізій, не пика прежнего класса');
  // нет класса в слоте — отказ без запросов
  const n0 = posts.length; env.rt.subGo = { t: Date.now(), slot: 3 };
  assert.equal(await M.step(), true); assert.equal(env.rt.subGoSay.ok, false); assert.equal(posts.length, n0);
  // в бою — не начинаем
  env.rt.subGo = { t: Date.now(), slot: 0 }; env.isBattle = () => true;
  assert.equal(await M.step(), false); assert.ok(env.rt.subGo);
  console.log('v2043-subgo PASS');
})().catch(e => { console.error(e); process.exit(1); });

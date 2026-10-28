'use strict';
// 20.76+ (ревизия 28.10, группа craft): настоящий modules/craft.js в vm; модели сервера и durable-памяти — как в craft-mode-runtime.
// 1) сверка крафта при новой revision не требует точного равенства MP (реген вне боя) — иначе неизвестный исход висел вечно;
// 2) пункт очереди снят при той же revision — сверка раз в минуту, а не GET /character на каждом такте;
// 3) МП-банка не применена (та же revision и остаток), а MP уже хватает — намерение закрывается без учёта расхода, крафт продолжается.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(process.env.CRAFT_SOURCE || path.join(__dirname, '../modules/craft.js'), 'utf8');
const clone = x => structuredClone(x);
function world(opts = {}) {
  const w = { now: 1792671000000, posts: [], reads: [], notes: [], ss: new Map(), pots: 0, crafted: 0,
    disk: { char: 'Crafter', classCur: { prof: 'dwarf_maestro', slot: 2 }, craftQueue: [{ id: 'q', code: 'steel', n: opts.goal ?? 12 }] },
    hero: { name: 'Crafter', revision: 100, mp: opts.mp ?? 50, maxMp: opts.maxMp ?? 1000,
      inventory: { stacks: [{ itemId: 728, qty: opts.pots ?? 5 }, { itemId: 1865, qty: opts.raw ?? 100 }, { itemId: 1880, qty: 0 }] } } };
  w.qty = id => w.hero.inventory.stacks.find(x => x.itemId === id).qty;
  w.cost = opts.cost ?? 100;
  w.gets = url => w.reads.filter(x => x === url).length;
  w.book = () => ({ canCraftProfession: true, createItemLevel: 5, currentMp: w.hero.mp, maxMp: w.hero.maxMp,
    recipes: [{ code: 'steel', output: { itemId: 1880, nameEn: 'Steel', quantity: 1 },
      ingredients: [{ itemId: 1865, quantity: 1, have: w.qty(1865), nameEn: 'Iron' }],
      createItemLevel: 1, mpCost: w.cost, lockedReason: null, maxCraftable: Math.min(w.qty(1865), Math.floor(w.hero.mp / w.cost)) }] });
  w.apply = (url, b) => {
    if (b.expectedRevision !== w.hero.revision) return { ok: false, status: 409, json: async () => ({}) };
    w.hero.revision++;
    if (url === '/character/consumable/use') { assert.equal(b.itemId, 728); assert.ok(w.qty(728) > 0);
      w.hero.inventory.stacks[0].qty--; w.hero.mp = Math.min(w.hero.maxMp, w.hero.mp + 500); w.pots++; }
    else { assert.equal(url, '/game/craft/materials'); assert.ok(w.hero.mp >= b.craftCount * w.cost);
      w.hero.mp -= b.craftCount * w.cost; w.hero.inventory.stacks[1].qty -= b.craftCount; w.hero.inventory.stacks[2].qty += b.craftCount; w.crafted += b.craftCount; }
    return { ok: true, status: 200, json: async () => ({ character: clone(w.hero) }) };
  };
  w.reload = (hooks = {}) => {
    class Clock extends Date { static now() { return w.now; } }
    const ctx = { Date: Clock, sessionStorage: { getItem: k => w.ss.get(k), setItem: (k, v) => w.ss.set(k, v) } };
    vm.runInNewContext(source, ctx);
    const e = { cfg: { craftAuto: false, craftMode: true, craftMpPots: true, ...hooks.cfg }, rt: clone(w.disk), on: true,
      tabOwner: true, leaseEpoch: 1, gen: 1, currentMode: hooks.mode || 'craft', mode: () => e.currentMode,
      actionGeneration: () => e.gen, role: () => 'crafter', isBattle: () => false, busy: () => false, canAct: () => true, free: () => true,
      rec: (...x) => w.notes.push(x.join(' ')), invRefresh: async () => ({}),
      setRt: async p => { Object.assign(e.rt, clone(p)); const result = hooks.save ? await hooks.save(p, e, w) : { ok: true };
        if (result?.ok === true) Object.assign(w.disk, clone(p)); return result; },
      gameGet: async url => { w.reads.push(url);
        return { ok: true, status: 200, json: async () => url === '/character' ? { character: clone(w.hero) } : w.book() }; },
      gamePost: async (url, body) => { const b = clone(body); w.posts.push({ url, body: b });
        return hooks.post ? hooks.post(url, b, e, w) : w.apply(url, b); }
    };
    return { e, C: ctx.L2V7Factories.craft(e) };
  };
  return w;
}
const tick = (w, run, ms = 2000) => { w.now += ms; return run.C.step(); };
const crafts = w => w.posts.filter(x => x.url === '/game/craft/materials');
// первый POST крафта — обрыв (результат неизвестен), остальные — обычная модель сервера
const dropFirstCraft = (url, b, e, w) => { if (url === '/game/craft/materials' && !w.dropped) { w.dropped = 1; throw Error('network'); } return w.apply(url, b); };

test('сверка крафта: revision ушла вперёд, MP вырос регеном, выход и сырьё прежние — не скрафчен, крафт продолжается', async () => {
  const w = world({ mp: 300, goal: 1 }), a = w.reload({ post: dropFirstCraft });
  await a.C.step(); assert.equal(crafts(w).length, 1); assert.ok(w.disk.craftPending); assert.equal(w.disk.craftPending.mp0, 300);
  w.hero.revision++; w.hero.mp = 520; w.now += 20000;   // постороннее действие сдвинуло revision, за 20 с мана восстановилась
  const b = w.reload(); await b.C.step();
  assert.equal(w.disk.craftPending, null, 'неизменные выход и сырьё доказывают отказ и без равенства MP');
  assert.equal(w.crafted, 0); assert.equal(w.disk.craftMade, undefined);
  assert.match(w.notes.join('\n'), /не скрафчен \(revision героя ушла вперёд, выход и сырьё не изменились\)/);
  // обрыв связи — рецепт пропускается 5 мин, затем новый крафт с актуальной revision
  w.now += 5 * 60000 + 1000; await b.C.step();
  assert.equal(crafts(w).length, 2); assert.equal(crafts(w)[1].body.expectedRevision, 101); assert.equal(w.crafted, 1); assert.equal(w.disk.craftMade.q, 1);
});
test('сверка крафта: 409 без применения при другом MP — сверка снимает pending и повторяет крафт', async () => {
  const w = world({ mp: 300, goal: 1 }), a = w.reload({ post: (url, b, e, w) => {
    if (url === '/game/craft/materials' && !w.dropped) { w.dropped = 1; w.hero.revision++; w.hero.mp += 200; return { ok: false, status: 409, json: async () => ({}) }; }
    return w.apply(url, b); } });
  await a.C.step(); assert.ok(w.disk.craftPending); assert.equal(w.crafted, 0);
  await tick(w, a, 3000);
  assert.equal(w.disk.craftPending, null); assert.equal(crafts(w).length, 1);
  await tick(w, a, 2000);
  assert.equal(crafts(w).length, 2); assert.equal(crafts(w)[1].body.expectedRevision, 101); assert.equal(w.crafted, 1);
});
test('сверка крафта: сырьё списано, выхода нет (передан) — исход по-прежнему неизвестен, нового POST нет', async () => {
  const w = world({ mp: 300, goal: 1 }), a = w.reload({ post: dropFirstCraft });
  await a.C.step(); w.hero.revision += 2; w.hero.mp = 520; w.hero.inventory.stacks[1].qty -= 1; w.now += 20000;
  const b = w.reload(); await b.C.step(); await tick(w, b, 61000); await tick(w, b, 61000);
  assert.ok(w.disk.craftPending); assert.equal(crafts(w).length, 1);
});

for (const [name, opts] of [['режим крафта', {}], ['фоновый craftAuto', { mode: 'farm', cfg: { craftAuto: true } }]])
  for (const [how, change] of [['строка удалена', e => { e.rt.craftQueue = []; }], ['N уменьшено', e => { e.rt.craftQueue[0].n = 1; }]])
    test(`сверка крафта (${name}, ${how}) при той же revision: GET /character раз в минуту, не на каждом такте`, async () => {
      const w = world({ mp: 1000 }), a = w.reload({ ...opts, post: dropFirstCraft });
      await a.C.step(); assert.equal(crafts(w).length, 1); assert.ok(w.disk.craftPending);
      change(a.e); w.disk.craftQueue = clone(a.e.rt.craftQueue); w.now += 20000;
      const g0 = w.gets('/character');
      for (let n = 0; n < 60; n++) await tick(w, a, 1000);
      assert.equal(w.gets('/character') - g0, 1, 'за 60 тактов по 1 с — одна сверка');
      assert.equal(crafts(w).length, 1, 'неизвестный исход не повторяется'); assert.ok(w.disk.craftPending, 'pending сохраняется');
      assert.match(w.notes.join('\n'), /пункт очереди снят — исход прежнего запроса сверяю раз в минуту/);
      await tick(w, a, 1000); assert.equal(w.gets('/character') - g0, 2, 'через минуту — следующая сверка');
    });
// фон: смена очереди не обнуляет nextT (в режиме крафта обнуляет один раз — это отдельное штатное правило)
test('сверка крафта (фон): строка снята во время ACK повторной записи — тоже пауза до следующей сверки', async () => {
  const w = world({ mp: 1000 }); let armed = false;
  const a = w.reload({ mode: 'farm', cfg: { craftAuto: true }, post: dropFirstCraft,
    save: (p, e) => { if (armed && p.craftPending) { e.rt.craftQueue = []; w.disk.craftQueue = []; armed = false; } return { ok: true }; } });
  await a.C.step(); assert.ok(w.disk.craftPending); w.now += 20000; armed = true;
  const g0 = w.gets('/character');
  for (let n = 0; n < 30; n++) await tick(w, a, 1000);
  assert.equal(w.gets('/character') - g0, 1); assert.equal(crafts(w).length, 1); assert.ok(w.disk.craftPending);
});

test('МП-банка: та же revision и остаток, MP восстановился — намерение закрыто без расхода, крафт идёт с прежней revision', async () => {
  const w = world({ mp: 0, goal: 1 }), a = w.reload({ post: (url, b, e, w) => { if (url === '/character/consumable/use' && !w.dropped) { w.dropped = 1; throw Error('network'); } return w.apply(url, b); } });
  await a.C.step(); assert.ok(w.disk.craftMpPending); assert.equal(w.posts.length, 1);
  w.hero.mp = 500; w.now += 20000; const b = w.reload(); await b.C.step();
  assert.equal(w.disk.craftMpPending, null); assert.equal(w.disk.craftMpUsed, undefined, 'реген не засчитан как банка');
  assert.equal(w.posts.length, 1, 'банка не повторяется'); assert.match(w.disk.craftSay.why, /банка не понадобилась/);
  await tick(w, b);
  assert.equal(crafts(w).length, 1); assert.equal(crafts(w)[0].body.expectedRevision, 100); assert.equal(w.pots, 0); assert.ok(w.crafted >= 1);
});
test('МП-банка: несколько минут при прежней revision не держат крафт', async () => {
  const w = world({ mp: 0, goal: 3 }), a = w.reload({ post: (url, b, e, w) => { if (url === '/character/consumable/use' && !w.dropped) { w.dropped = 1; throw Error('network'); } return w.apply(url, b); } });
  await a.C.step(); w.hero.mp = 500; w.now += 20000;
  const b = w.reload(); for (let n = 0; n < 4; n++) await tick(w, b, 61000);
  assert.equal(w.disk.craftMpPending, null); assert.equal(w.crafted, 3); assert.equal(w.disk.craftMade.q, 3); assert.equal(w.pots, 0);
});
test('МП-банка закрыта как неприменённая, а запоздалый POST всё же дошёл первым — крафт получает 409, сверка без двойного расхода', async () => {
  const w = world({ mp: 0, goal: 1 }); let late = null;
  const post = (url, b, e, w) => {
    if (url === '/character/consumable/use' && !late) { late = b; throw Error('network'); }
    // старый запрос банки применился на сервере раньше нового крафта (MP 120 → 620, revision 101)
    if (url === '/game/craft/materials' && !w.lateDone) { w.lateDone = 1; w.apply('/character/consumable/use', late); }
    return w.apply(url, b);
  };
  const a = w.reload({ post });
  await a.C.step(); w.hero.mp = 120; w.now += 20000; const b = w.reload({ post }); await b.C.step();
  assert.equal(w.disk.craftMpPending, null); assert.equal(w.pots, 0);
  await tick(w, b); assert.equal(w.pots, 1); assert.equal(crafts(w).length, 1); assert.equal(crafts(w)[0].body.expectedRevision, 100); assert.equal(w.crafted, 0);
  assert.ok(w.disk.craftPending, '409 — исход сверяется');
  await tick(w, b, 3000); assert.equal(w.disk.craftPending, null, 'revision другая, выход и сырьё прежние — не скрафчен (MP изменила банка)');
  await tick(w, b, 2000); assert.equal(crafts(w).length, 2); assert.equal(crafts(w)[1].body.expectedRevision, 101);
  assert.equal(w.crafted, 1); assert.equal(w.pots, 1, 'банка потрачена один раз');
});

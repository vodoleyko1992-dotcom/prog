'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(process.env.CRAFT_SOURCE || path.join(__dirname, '../modules/craft.js'), 'utf8');
const clone = x => structuredClone(x), never = () => new Promise(() => {}), turn = () => new Promise(r => setImmediate(r));
const waitFor = async f => { for (let n = 0; n < 30 && !f(); n++) await turn(); assert.ok(f(), 'достигнут ожидаемый этап'); };
function world(opts = {}) {
  const w = { now: 1792671000000, posts: [], reads: [], notes: [], ss: new Map(), pots: 0, crafted: 0,
    disk: { char: 'Crafter', classCur: { prof: 'dwarf_maestro', slot: 2 }, craftQueue: [{ id: 'q', code: 'steel', n: opts.goal ?? 12 }] },
    hero: { name: 'Crafter', revision: 100, mp: opts.mp ?? 50, maxMp: opts.maxMp ?? 1000,
      inventory: { stacks: [{ itemId: 728, qty: opts.pots ?? 5 }, { itemId: 1865, qty: opts.raw ?? 100 }, { itemId: 1880, qty: 0 }] } } };
  w.qty = id => w.hero.inventory.stacks.find(x => x.itemId === id).qty;
  w.cost = opts.cost ?? 100; w.out = opts.output ?? 1;
  w.book = () => ({ canCraftProfession: opts.profession !== false, createItemLevel: 5, currentMp: w.hero.mp, maxMp: w.hero.maxMp,
    recipes: [{ code: 'steel', output: { itemId: 1880, nameEn: 'Steel', quantity: w.out },
      ingredients: [{ itemId: 1865, quantity: 1, have: w.qty(1865), nameEn: 'Iron' }],
      createItemLevel: opts.level ?? 1, mpCost: w.cost, lockedReason: opts.locked || null,
      maxCraftable: Math.min(w.qty(1865), Math.floor(w.hero.mp / w.cost)) }] });
  w.apply = (url, b) => {
    if (b.expectedRevision !== w.hero.revision) return { ok: false, status: 409, json: async () => ({}) };
    w.hero.revision++;
    if (url === '/character/consumable/use') { assert.equal(b.itemId, 728); assert.equal(b.quantity, 1); assert.ok(w.qty(728) > 0);
      w.hero.inventory.stacks[0].qty--; w.hero.mp = Math.min(w.hero.maxMp, w.hero.mp + 500); w.pots++; }
    else { assert.equal(url, '/game/craft/materials'); assert.ok(w.hero.mp >= b.craftCount * w.cost);
      w.hero.mp -= b.craftCount * w.cost; w.hero.inventory.stacks[1].qty -= b.craftCount;
      w.hero.inventory.stacks[2].qty += b.craftCount * w.out; w.crafted += b.craftCount * w.out; }
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
      gameGet: async url => { w.reads.push(url); if (hooks.get) await hooks.get(url, e, w);
        return { ok: true, status: 200, json: async () => url === '/character' ? { character: clone(w.hero) } : w.book() }; },
      gamePost: async (url, body) => { const b = clone(body); w.posts.push({ url, body: b });
        return hooks.post ? hooks.post(url, b, e, w) : w.apply(url, b); }
    };
    return { e, C: ctx.L2V7Factories.craft(e) };
  };
  return w;
}
// Каждый сценарий выполняет настоящую фабрику; отдельные модели сервера и durable-памяти переживают reload.
async function tick(w, run, ms = 2000) { w.now += ms; return run.C.step(); }

test('режим крафта: очередь чередует банки и партии до точной цели без фонового craftAuto', async () => {
  const w = world(), a = w.reload();
  for (let n = 0; n < 8; n++) await tick(w, a);
  assert.equal(w.crafted, 12); assert.equal(w.disk.craftMade.q, 12); assert.equal(w.pots, 3);
  assert.deepEqual(w.posts.map(x => x.url), ['/character/consumable/use','/game/craft/materials','/character/consumable/use','/game/craft/materials','/character/consumable/use','/game/craft/materials']);
  assert.match(w.disk.craftSay.why, /завершена/); assert.equal(w.disk.craftMpPending, null);
});
test('режим крафта использует MP до нуля, фоновый сохраняет прежний резерв и не пьёт банки', async () => {
  const w = world({ mp: 100, goal: 1 }), a = w.reload(); await a.C.step(); assert.equal(w.crafted, 1); assert.equal(w.pots, 0); assert.equal(w.hero.mp, 0);
  const bg = world({ mp: 100, goal: 1 }), b = bg.reload({ mode: 'farm', cfg: { craftAuto: true } }); await b.C.step();
  assert.equal(bg.posts.length, 0); assert.match(bg.disk.craftSay.why, /жду ману/);
});
test('maxCraftable=0 из-за MP: полное сырьё позволяет банку, реальная нехватка сырья — нет', async () => {
  const w = world({ mp: 0 }), a = w.reload(); await a.C.step(); assert.equal(w.pots, 1); assert.equal(w.crafted, 0);
  const raw = world({ mp: 0, raw: 0 }), b = raw.reload(); await b.C.step(); assert.equal(raw.posts.length, 0); assert.match(raw.disk.craftSay.why, /не хватает Iron/);
});
test('нехватка навыка/запрет профессии/причина сервера не тратят банки', async () => {
  for (const options of [{ level: 9 }, { profession: false }, { locked: 'Рецепт недоступен' }]) {
    const w = world({ mp: 0, ...options }); await w.reload().C.step(); assert.equal(w.posts.length, 0);
  }
});
test('выход рецепта по нескольку предметов: считает готовые штуки и останавливает очередь', async () => {
  const w = world({ mp: 1000, goal: 9, output: 3 }), a = w.reload(); await a.C.step(); await tick(w, a);
  assert.equal(w.crafted, 9); assert.equal(w.disk.craftMade.q, 9); assert.equal(w.posts[0].body.craftCount, 3); assert.equal(w.pots, 0);
});
test('банки выключены/закончились: ждёт MP и ничего не покупает', async () => {
  for (const options of [{ pots: 0 }, { cfg: { craftMpPots: false } }]) {
    const w = world(options), a = w.reload({ cfg: options.cfg }); await a.C.step();
    assert.equal(w.posts.length, 0); assert.match(w.disk.craftSay.why, /жду восстановление маны/);
  }
});
test('свежая регенерация между книгой и героем отменяет ненужную банку', async () => {
  const w = world({ mp: 0, goal: 1 }), a = w.reload({ get: url => { if (url === '/character') w.hero.mp = 100; } });
  await a.C.step(); assert.equal(w.pots, 0); assert.equal(w.posts.length, 0); await tick(w, a); assert.equal(w.crafted, 1);
});
test('цена рецепта выше maxMP: банки не тратит', async () => {
  const w = world({ mp: 0, maxMp: 50 }), a = w.reload(); await a.C.step(); assert.equal(w.posts.length, 0); assert.match(w.disk.craftSay.why, /банка не поможет/);
});
test('свежие MP снизились между книгой и персонажем: партия пересчитана и не превосходит MP', async () => {
  const w = world({ mp: 1000 }), a = w.reload({ get: url => { if (url === '/character') w.hero.mp = 200; } });
  await a.C.step(); assert.equal(w.posts[0].body.craftCount, 2); assert.equal(w.hero.mp, 0);
});
for (const bad of [{ name: 'Other' }, { revision: null }, { mp: null }, { maxMp: 0 }, { inventory: null }]) test('неполный/чужой герой не разрешает MP-банку: ' + JSON.stringify(bad), async () => {
  const w = world({ mp: 0 }), a = w.reload({ get: url => { if (url === '/character') Object.assign(w.hero, clone(bad)); } });
  await a.C.step(); assert.equal(w.posts.length, 0);
});
for (const [name, mutate] of [
  ['Stop', e => { e.on = false; }], ['владелец', e => { e.tabOwner = false; }], ['аренда', e => { e.leaseEpoch++; }],
  ['поколение', e => { e.gen++; }], ['режим', e => { e.currentMode = 'farm'; e.cfg.craftAuto = true; }], ['саб', e => { e.rt.classCur.slot = 3; }],
  ['очередь', e => { e.rt.craftQueue = []; }], ['банки выключены', e => { e.cfg.craftMpPots = false; }]
]) test('MP-банка: ' + name + ' во время durable ACK отменяет отправку', async () => {
  const w = world({ mp: 0 }), a = w.reload({ save: (p, e) => { if (p.craftMpPending) mutate(e); return { ok: true }; } });
  await a.C.step(); assert.equal(w.posts.length, 0);
  // 22.10: отменённая строка до первого POST достоверно не потратила банку; неизвестный отправленный исход ниже сохраняется.
  if (name === 'очередь') assert.equal(w.disk.craftMpPending, null); else assert.ok(w.disk.craftMpPending);
});
for (const failure of [undefined, false, { ok: false }, 'throw']) test('MP-банка: нет ACK ' + JSON.stringify(failure) + ' — нет POST', async () => {
  const w = world({ mp: 0 }), a = w.reload({ save: p => { if (!p.craftMpPending) return { ok: true }; if (failure === 'throw') throw Error('storage'); return failure; } });
  await a.C.step(); await tick(w, a, 20000); assert.equal(w.posts.length, 0);
});
test('MP-банка: reload после принятого POST без ответа сверяет расход и не пьёт вторую', async () => {
  const w = world({ mp: 0, goal: 1 }), a = w.reload({ post: (url, b) => { w.apply(url, b); return never(); } });
  void a.C.step(); await waitFor(() => w.posts.length === 1); assert.ok(w.disk.craftMpPending);
  w.now += 20000; const b = w.reload(); await b.C.step(); assert.equal(w.posts.length, 1); assert.equal(w.disk.craftMpUsed, 1);
  await tick(w, b); assert.equal(w.crafted, 1); assert.equal(w.pots, 1);
});
test('MP-банка: reload после prepare до POST отправляет ту же revision ровно один раз', async () => {
  const w = world({ mp: 0 }), a = w.reload({ save: (p, e) => { if (p.craftMpPending) e.on = false; return { ok: true }; } });
  await a.C.step(); assert.equal(w.posts.length, 0); w.now += 20000; await w.reload().C.step();
  assert.equal(w.pots, 1); assert.deepEqual(w.posts[0].body, { itemId: 728, quantity: 1, expectedRevision: 100 });
});
test('MP-банка: ответ 5xx без применения повторяет только тот же expectedRevision', async () => {
  const w = world({ mp: 0 }), a = w.reload({ post: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  await a.C.step(); w.now += 20000; await w.reload().C.step();
  assert.equal(w.posts.length, 2); assert.deepEqual(w.posts[0], w.posts[1]); assert.equal(w.pots, 1);
});
test('MP-банка: 409 после wire-успеха не снимает pending до GET', async () => {
  const w = world({ mp: 0 }), a = w.reload({ post: (url, b) => { w.apply(url, b); return { ok: false, status: 409, json: async () => ({}) }; } });
  await a.C.step(); assert.ok(w.disk.craftMpPending); await tick(w, a, 2000); assert.equal(w.disk.craftMpPending, null); assert.equal(w.pots, 1);
});
test('MP-банка: закрытая revision при неизменной сумке не разрешает отложенному запросу примениться', async () => {
  const w = world({ mp: 0 }), a = w.reload({ post: () => { throw Error('network'); } });
  await a.C.step(); w.hero.revision++; w.now += 20000; const b = w.reload(); await b.C.step();
  assert.equal(w.disk.craftMpPending, null); assert.equal(w.pots, 0); assert.equal(w.posts.length, 1);
  await tick(w, b); assert.equal(w.posts[1].body.expectedRevision, 101); assert.equal(w.pots, 1);
});
test('MP-банка: регенерация при прежней revision не считается доказательством расхода', async () => {
  const w = world({ mp: 0 }), a = w.reload({ post: () => { throw Error('network'); } });
  await a.C.step(); w.hero.mp = 500; w.now += 20000; const b = w.reload(); await b.C.step();
  assert.ok(w.disk.craftMpPending); assert.equal(w.disk.craftMpUsed, undefined); assert.equal(w.posts.length, 1);
});
test('MP-банка: старый снимок и противоречивый остаток не снимают pending и не повторяют POST', async () => {
  for (const change of [w => { w.hero.revision--; }, w => { w.hero.inventory.stacks[0].qty--; }]) {
    const w = world({ mp: 0 }), a = w.reload({ post: () => { throw Error('network'); } }); await a.C.step(); change(w); w.now += 20000;
    await w.reload().C.step(); assert.ok(w.disk.craftMpPending); assert.equal(w.posts.length, 1);
  }
});
test('MP-банка: снятый заказ, выключенные банки или другой режим не повторяют неизвестный POST', async () => {
  for (const change of [e => { e.rt.craftQueue = []; }, e => { e.cfg.craftMpPots = false; }, e => { e.currentMode = 'farm'; e.cfg.craftAuto = true; }]) {
    const w = world({ mp: 0 }), a = w.reload({ post: () => { throw Error('network'); } }); await a.C.step(); w.now += 20000;
    const b = w.reload(); change(b.e); await b.C.step(); assert.equal(w.posts.length, 1); assert.ok(w.disk.craftMpPending);
  }
});
test('MP-банка: потерянный ACK результата не позволяет следующий POST до durable settle', async () => {
  const w = world({ mp: 0 }), a = w.reload({ save: p => p.craftMpPending === null && p.craftMpUsed ? { ok: false } : { ok: true } });
  await a.C.step(); assert.equal(w.pots, 1); await tick(w, a, 20000); assert.equal(w.posts.length, 1); assert.ok(w.disk.craftMpPending);
  const b = w.reload(); await b.C.step(); assert.equal(w.disk.craftMpPending, null); assert.equal(w.disk.craftMpUsed, 1);
});
test('новая очередь/новый режим не ждут оставшуюся пятиминутную фоновую паузу', async () => {
  const w = world({ mp: 1000, goal: 1 }), a = w.reload(); a.e.rt.craftQueue = []; w.disk.craftQueue = [];
  await a.C.step(); a.e.rt.craftQueue = [{ id: 'new', code: 'steel', n: 1 }]; w.disk.craftQueue = clone(a.e.rt.craftQueue);
  await tick(w, a, 1); assert.equal(w.crafted, 1);
  const bg = world({ mp: 1000, goal: 1 }), b = bg.reload({ mode: 'farm', cfg: { craftAuto: true } }); b.e.rt.craftQueue = []; await b.C.step();
  b.e.rt.craftQueue = [{ id: 'q', code: 'steel', n: 1 }]; b.e.currentMode = 'craft'; await tick(bg, b, 1); assert.equal(bg.crafted, 1);
});
test('смена режима во время GET/ACK крафта отменяет POST, даже если фон включён', async () => {
  for (const phase of ['get', 'save']) {
    const w = world({ mp: 1000 }), a = w.reload({ get: (url, e) => { if (phase === 'get' && url === '/character') { e.currentMode = 'farm'; e.cfg.craftAuto = true; } },
      save: (p, e) => { if (phase === 'save' && p.craftPending) { e.currentMode = 'farm'; e.cfg.craftAuto = true; } return { ok: true }; } });
    await a.C.step(); assert.equal(w.posts.length, 0);
  }
});

test('выделенный режим не дополняет очередь планом Маммона и не тратит банки после цели', async () => {
  const w = world({ mp: 0, goal: 1 }), a = w.reload({ cfg: { mmGoalItem: 900000, craftMammon: true } });
  a.e.rt.mmGear = [{ id: 900000 }]; a.e.invSnapshot = () => ({ t: w.now + 100 });
  a.e.mammon = { craftPlan: () => ({ name: 'Цель', lvl: 0, to: 1, lv: [{}], craft: [{ id: 1880, qty: 100 }] }) };
  await a.C.step(); await tick(w, a); await tick(w, a);
  assert.equal(w.pots, 1); assert.equal(w.crafted, 1); assert.equal(a.C.wants().length, 0); assert.match(w.disk.craftSay.why, /завершена/);
});
test('legacy craftMode без getter mode разрешает отдельный крафт', async () => {
  const w = world({ mp: 100, goal: 1 }), a = w.reload(); delete a.e.mode;
  await a.C.step(); assert.equal(w.crafted, 1);
});
test('сырьё ушло между книгой и свежим героем: банкa не расходуется с новой revision', async () => {
  const w = world({ mp: 0 }), a = w.reload({ get: url => { if (url === '/character') { w.hero.inventory.stacks[1].qty = 0; w.hero.revision++; } } });
  await a.C.step(); assert.equal(w.posts.length, 0); assert.equal(w.pots, 0); assert.match(w.disk.craftSay.why, /Сырья/);
});
test('неизвестный POST банки не повторяется при противоречивой сумке без сырья', async () => {
  const w = world({ mp: 0 }), a = w.reload({ post: () => { throw Error('network'); } }); await a.C.step();
  w.hero.inventory.stacks[1].qty = 0; w.now += 20000; await w.reload().C.step();
  assert.equal(w.posts.length, 1); assert.ok(w.disk.craftMpPending); assert.match(w.disk.craftSay.why, /сырья/);
});
test('снятый до отправки заказ не держит следующую очередь при прежней revision', async () => {
  const w = world({ mp: 0 }), a = w.reload({ save: (p, e) => { if (p.craftMpPending) e.rt.craftQueue = []; return { ok: true }; } });
  await a.C.step(); assert.equal(w.posts.length, 0); assert.equal(w.disk.craftMpPending, null);
  w.disk.craftQueue = [{ id: 'new', code: 'steel', n: 1 }]; const b = w.reload(); await b.C.step(); await tick(w, b);
  assert.equal(w.pots, 1); assert.equal(w.crafted, 1); assert.equal(w.disk.craftMade.new, 1);
});
test('смена режима не теряет повтор ACK уже вычисленного результата банки в той же аренде', async () => {
  const w = world({ mp: 0 }), a = w.reload({ cfg: { craftAuto: true }, save: p => p.craftMpPending === null && p.craftMpUsed ? { ok: false } : { ok: true } });
  await a.C.step(); a.e.currentMode = 'farm'; await tick(w, a, 20000);
  assert.equal(w.posts.length, 1); assert.ok(w.disk.craftMpPending, 'не начинаем крафт до записи результата');
});

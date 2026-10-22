'use strict';
// 20.46: реальный модуль, отдельные память вкладки/диск/сервер. Уничтожение документа не вызывает catch старого fetch.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(process.env.CRAFT_SOURCE || path.join(__dirname, '../modules/craft.js'), 'utf8');
const copy = x => structuredClone(x), turn = () => new Promise(resolve => setImmediate(resolve));
const waitFor = async f => { for (let n = 0; n < 30 && !f(); n++) await turn(); assert.ok(f(), 'ожидаемая точка шага достигнута'); };
const never = () => new Promise(() => {});
function world(goal = 5) {
  const w = { now: 1792629000000, posts: [], saves: [], made: 0, notes: [],
    disk: { char: 'Warlock', craftQueue: [{ id: 'a', code: 'steel', nm: 'Steel', n: goal }] },
    hero: { name: 'Warlock', revision: 77, mp: 1000, inventory: { stacks: [{ itemId: 1880, qty: 0 }, { itemId: 1865, qty: 100 }] } } };
  w.apply = b => { assert.equal(b.expectedRevision, w.hero.revision); w.hero.revision++; w.hero.mp -= b.craftCount * 10;
    w.hero.inventory.stacks[0].qty += b.craftCount; w.hero.inventory.stacks[1].qty -= b.craftCount; w.made += b.craftCount; };
  w.reload = (opts = {}) => {
    class Clock extends Date { static now() { return w.now; } }
    const ctx = { Date: Clock }, rt = copy(w.disk);
    vm.runInNewContext(source, ctx);
    const e = { cfg: { craftAuto: true }, rt, on: true, tabOwner: true, leaseEpoch: 'owner-1', generation: 1,
      actionGeneration: () => e.generation, role: () => 'crafter', isBattle: () => false, busy: () => false,
      canAct: () => true, free: () => true, rec: (...a) => w.notes.push(a.join(' ')), invRefresh: async () => ({}),
      setRt: async p => { Object.assign(e.rt, copy(p)); w.saves.push(copy(p));
        const outcome = opts.save ? await opts.save(p, e, w) : { ok: true };
        if (outcome?.ok === true) Object.assign(w.disk, copy(p)); return outcome; },
      gameGet: async p => { if (opts.get) await opts.get(p, e, w);
        return { ok: true, status: 200, json: async () => p === '/character' ? { character: copy(w.hero) } : {
          canCraftProfession: true, createItemLevel: 4, currentMp: w.hero.mp, maxMp: 1000,
          recipes: [{ code: 'steel', output: { itemId: 1880, nameEn: 'Steel', quantity: 1 }, ingredients: [{ itemId: 1865, quantity: 1, have: 100 }],
            createItemLevel: 1, mpCost: 10, maxCraftable: opts.batch || 100 }] } }; },
      gamePost: async (p, body) => { const b = copy(body); w.posts.push(b);
        if (opts.post) return opts.post(b, e, w);
        if (b.expectedRevision !== w.hero.revision) return { ok: false, status: 409, json: async () => ({}) };
        w.apply(b); return { ok: true, status: 200, json: async () => ({ character: copy(w.hero) }) }; }
    };
    return { e, C: ctx.L2V7Factories.craft(e) };
  };
  return w;
}
test('20.46: POST ждёт подтверждённой записи намерения; цель и progress ещё не списаны', async () => {
  const w = world(); let release;
  const a = w.reload({ save: p => p.craftPending ? new Promise(r => { release = r; }) : { ok: true } });
  const running = a.C.step(); await turn();
  assert.equal(w.posts.length, 0, 'до ACK хранения не тратим сырьё/MP'); assert.equal(typeof release, 'function');
  assert.equal(w.disk.craftPending, undefined); release({ ok: true }); await running;
  assert.equal(w.posts.length, 1); assert.equal(w.made, 5); assert.equal(w.disk.craftMade.a, 5);
  assert.ok(w.saves.find(p => p.craftPending?.code === 'steel'), 'намерение записано до отправки');
});
test('20.46: сервер применил POST, документ исчез до ответа — reload засчитывает одну партию без второго POST', async () => {
  const w = world(), a = w.reload({ post: b => { w.apply(b); return never(); } });
  void a.C.step(); await waitFor(() => w.posts.length === 1);
  assert.ok(w.disk.craftPending, 'сохранилось намерение до fetch'); assert.equal(w.disk.craftMade, undefined);
  w.now += 20000; const b = w.reload(); await b.C.step();
  assert.equal(w.posts.length, 1); assert.equal(w.made, 5); assert.equal(w.disk.craftMade.a, 5); assert.equal(w.disk.craftPending, null);
  w.now += 5000; await b.C.step(); assert.equal(w.posts.length, 1);
});
test('20.46: перезагрузка после durable-prepare до POST — повтор той же revision применим ровно один раз', async () => {
  const w = world(); let a;
  a = w.reload({ save: (p, e) => { if (p.craftPending) e.on = false; return { ok: true }; } });
  await a.C.step(); assert.equal(w.posts.length, 0); assert.ok(w.disk.craftPending);
  w.now += 20000; await w.reload().C.step();
  assert.deepEqual(w.posts, [{ recipeCode: 'steel', craftCount: 5, expectedRevision: 77 }]); assert.equal(w.made, 5); assert.equal(w.disk.craftMade.a, 5);
});
for (const failure of [false, undefined, { ok: false } , 'throw']) test(`20.46: нет ACK подготовки (${JSON.stringify(failure)}) — ни POST, ни повторной траты`, async () => {
  const w = world(), a = w.reload({ save: p => { if (!p.craftPending) return { ok: true }; if (failure === 'throw') throw Error('storage'); return failure; } });
  await a.C.step(); w.now += 20000; await a.C.step();
  assert.equal(w.posts.length, 0); assert.equal(w.made, 0);
});
for (const [name, mutate] of [
  ['Stop', e => { e.on = false; }], ['потеря владельца', e => { e.tabOwner = false; }], ['другой герой', e => { e.rt.char = 'Other'; }],
  ['Stop→Start', e => { e.generation++; }], ['новая аренда', e => { e.leaseEpoch = 'owner-2'; }],
  ['запрет действия', e => { e.canAct = () => false; }], ['крафт выключен', e => { e.cfg.craftAuto = false; }]
]) test(`20.46: ${name} во время ACK подготовки отменяет отправку, намерение не освобождается`, async () => {
  const w = world(), a = w.reload({ save: (p, e) => { if (p.craftPending) mutate(e); return { ok: true }; } });
  await a.C.step(); assert.equal(w.posts.length, 0); assert.equal(w.made, 0); assert.ok(w.disk.craftPending);
});
test('20.46: смена поколения во время GET героя отменяет подготовку и POST', async () => {
  const w = world(), a = w.reload({ get: (p, e) => { if (p === '/character') e.generation++; } });
  await a.C.step(); assert.equal(w.posts.length, 0); assert.equal(w.disk.craftPending, undefined);
});
test('20.46: чужой/неполный снимок героя не даёт исходных остатков для POST', async () => {
  for (const bad of [{ name: 'Other' }, { inventory: null }, { revision: null }]) {
    const w = world(); Object.assign(w.hero, bad); await w.reload().C.step(); assert.equal(w.posts.length, 0);
  }
});
test('20.46: подтверждение результата не записалось — очередь не продолжает тратить, reload сверяет старую партию', async () => {
  const w = world(10), a = w.reload({ batch: 5, save: p => p.craftPending === null && p.craftMade ? { ok: false } : { ok: true } });
  await a.C.step(); assert.equal(w.made, 5); assert.ok(w.disk.craftPending);
  w.now += 30000; await a.C.step(); assert.equal(w.posts.length, 1, 'не начинаем следующую партию без ACK результата');
  const b = w.reload({ batch: 5 }); await b.C.step(); assert.equal(w.posts.length, 1); assert.equal(w.disk.craftMade.a, 5);
  w.now += 3000; await b.C.step(); assert.equal(w.made, 10); assert.equal(w.disk.craftMade.a, 10);
});
test('20.46: ACK результата потерян после записи — повтор той же settlement-записи не удваивает progress/stat', async () => {
  const w = world(); let lost = false;
  const a = w.reload({ save: p => { if (p.craftPending === null && p.craftMade && !lost) { lost = true; Object.assign(w.disk, copy(p)); return { ok: false }; } return { ok: true }; } });
  await a.C.step(); w.now += 3000; await a.C.step();
  assert.equal(w.posts.length, 1); assert.equal(w.disk.craftMade.a, 5); assert.equal(w.disk.craftStat.steel, 5);
});
test('20.46: 5xx без применения + reload повторяет только прежний recipe/count/revision', async () => {
  const w = world(), a = w.reload({ post: () => ({ ok: false, status: 500, json: async () => ({}) }) });
  await a.C.step(); assert.ok(w.disk.craftPending); w.now += 20000; await w.reload().C.step();
  assert.equal(w.posts.length, 2); assert.deepEqual(w.posts[0], w.posts[1]); assert.equal(w.made, 5); assert.equal(w.disk.craftMade.a, 5);
});
test('20.46: 409 на повтор прежней revision не освобождает неизвестный исход; затем GET засчитывает один раз', async () => {
  const w = world(), a = w.reload({ post: () => { throw new Error('network'); } });
  await a.C.step(); w.now += 20000;
  const b = w.reload({ post: () => { w.apply(w.posts[0]); return { ok: false, status: 409, json: async () => ({}) }; } });
  await b.C.step(); assert.ok(w.disk.craftPending); w.now += 3000; await b.C.step();
  assert.equal(w.posts.length, 2); assert.equal(w.made, 5); assert.equal(w.disk.craftMade.a, 5);
});
test('20.46: результат применён и выход потрачен до сверки — неопределённость не разрешает новый крафт', async () => {
  const w = world(), a = w.reload({ post: b => { w.apply(b); return never(); } });
  void a.C.step(); await waitFor(() => w.posts.length === 1);
  w.hero.inventory.stacks[0].qty = 0; w.hero.revision++; w.now += 20000;
  const b = w.reload(); await b.C.step(); w.now += 65000; await b.C.step();
  assert.equal(w.posts.length, 1); assert.ok(w.disk.craftPending); assert.equal(w.made, 5);
});
test('20.46: NOT_SENT достоверно не отправлял POST — намерение снимается без ложного unknown', async () => {
  const w = world(), a = w.reload({ post: () => { throw Error('action_cancelled'); } });
  assert.equal(await a.C.step(), false); assert.equal(w.made, 0); assert.equal(w.disk.craftPending, null);
  assert.doesNotMatch(w.notes.join('\n'), /результат неизвестен/);
});
test('20.46: удаление/уменьшение строки во время ACK подготовки отменяет первый POST', async () => {
  for (const change of [e => { e.rt.craftQueue = []; }, e => { e.rt.craftQueue[0].n = 1; }]) {
    const w = world(), a = w.reload({ save: (p, e) => { if (p.craftPending) { change(e); w.disk.craftQueue = copy(e.rt.craftQueue); } return { ok: true }; } });
    await a.C.step(); assert.equal(w.posts.length, 0); assert.ok(w.disk.craftPending);
  }
});
test('20.46: отставшая вкладка после передачи аренды не возвращает старый prepare поверх завершённой очереди', async () => {
  const w = world(10), a = w.reload({ batch: 5, save: (p, e) => { if (p.craftPending) { e.tabOwner = false; e.leaseEpoch = 'owner-2'; } return { ok: true }; } });
  await a.C.step(); assert.equal(w.posts.length, 0);
  w.now += 20000; const b = w.reload({ batch: 5 }); b.e.leaseEpoch = 'owner-2'; await b.C.step(); w.now += 3000; await b.C.step();
  assert.equal(w.made, 10); assert.equal(w.disk.craftMade.a, 10);
  a.e.rt = copy(w.disk); a.e.tabOwner = true; a.e.leaseEpoch = 'owner-3'; a.e.generation++;
  await a.C.step(); w.now += 20000; await a.C.step();
  assert.equal(w.made, 10); assert.equal(w.disk.craftMade.a, 10); assert.equal(w.disk.craftPending, null);
});
test('20.46: устаревший GET сверки не разрешает ни повторный POST, ни снятие pending', async () => {
  const w = world(), a = w.reload({ post: () => { throw Error('network'); } }); await a.C.step();
  w.now += 20000; w.hero.revision = 76; await w.reload().C.step();
  assert.equal(w.posts.length, 1); assert.ok(w.disk.craftPending);
});
test('20.46: первый видимый 409 после принятого wire-запроса сохраняет намерение до сверки, не делает новый заказ', async () => {
  const w = world(), a = w.reload({ post: b => { w.apply(b); return { ok: false, status: 409, json: async () => ({}) }; } });
  await a.C.step(); assert.ok(w.disk.craftPending); w.now += 4000;
  await w.reload().C.step(); assert.equal(w.posts.length, 1); assert.equal(w.made, 5); assert.equal(w.disk.craftMade.a, 5);
});

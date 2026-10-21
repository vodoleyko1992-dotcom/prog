'use strict';
// 20.43 (John 21.10 12:12: саб крафтера): свой крафт материалов — modules/craft.js. Книга рецептов — настоящий ответ
// GET /game/craft/materials от 21.10 (Warsmith 40, Create Item ещё не выучен).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = n => fs.readFileSync(path.join(root, n), 'utf8');
const BOOK = JSON.parse(read('tests/fixtures/craft-materials-2026-10-21.json'));
const open = (lvl = 4, mp = 484) => { const b = JSON.parse(JSON.stringify(BOOK)); b.createItemLevel = lvl; b.currentMp = mp;
  for (const r of b.recipes) { if (r.createItemLevel <= lvl) delete r.lockedReason;
    r.maxCraftable = r.createItemLevel > lvl ? 0 : Math.min(...r.ingredients.map(i => Math.floor(i.have / i.quantity))); } return b; };
function make(over = {}, box = { console }) {
  vm.runInNewContext(read('modules/craft.js'), box);
  const posts = [], recs = [], gets = [], env = { cfg: { craftAuto: true, craftMpKeep: 20 }, rt: { char: 'Warlock' }, on: true, tabOwner: true, role: () => 'crafter', isBattle: () => false,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), invRefresh: async () => ({}), book: open(), hero: { revision: 77 },
    gameGet: async p => { gets.push(p); return { ok: true, status: 200, json: async () => p === '/character' ? { character: env.hero } : env.book }; },
    gamePost: async (p, b) => { posts.push([p, b]); return { ok: true, status: 200, json: async () => ({ character: {} }) }; }, ...over };
  return { env, posts, recs, gets, box, C: box.L2V7Factories.craft(env) };
}
// цель Маммона с видимым уровнем и свежей сумкой; craftPlan — в порядке goalAll (полуфабрикаты первыми)
function mammonEnv(over = {}) {
  const snap = { t: Date.now() };
  const M = make({ invSnapshot: () => snap, mammon: { craftPlan: () => ({ name: 'Belt', lvl: 1, to: 2, lv: [{ L: 1, est: 0 }], craft: [{ id: 1887, qty: 3 }, { id: 1890, qty: 3 }] }) }, ...over });
  M.env.cfg.mmGoalItem = 123; M.env.rt.mmGear = [{ id: 123 }]; M.snap = snap; return M;
}
const ssBox = () => { const st = {}; return { console, sessionStorage: { getItem: k => st[k] ?? null, setItem: (k, v) => { st[k] = String(v); } } }; };
test('без навыка Create Item бот не крафтит и пишет причину', () => {
  const { C } = make(), p = C.pick(BOOK, [{ id: 1880, n: 10 }]);
  assert.equal(p.r, undefined); assert.match(p.why, /Create Item/);
});
test('количество ограничено нуждой, сырьём, маной (запас 20 %) и партией', () => {
  const { C } = make();
  let p = C.pick(open(), [{ id: 1880, n: 5 }]); assert.equal(p.r.code, 'steel'); assert.equal(p.count, 5);
  p = C.pick(open(), [{ id: 1880, n: 5000 }]); assert.equal(p.count, Math.floor((484 - Math.ceil(484 * 0.2)) / 10));   // 38 по мане
  p = C.pick(open(4, 100000), [{ id: 1880, n: 5000 }]); assert.equal(p.count, C.BATCH);
  p = C.pick(open(4, 50), [{ id: 1880, n: 5 }]); assert.equal(p.r, undefined); assert.equal(p.mpWait, true);
  p = C.pick(open(), [{ id: 1884, n: 30 }]); assert.equal(p.r.code, 'cord'); assert.equal(p.count, 2); assert.equal(p.out, 40);   // Cord ×20 за крафт
});
test('нет сырья на верхний рецепт — делается полуфабрикат из списка', () => {
  const { C } = make(), b = open();
  const p = C.pick(b, [{ id: 1894, n: 3 }, { id: 1882, n: 12 }]);   // Crafted Leather: нет Cord/Leather → Leather из шкур
  assert.equal(p.r.code, 'leather'); assert.match(C.pick(b, [{ id: 1894, n: 3 }]).why, /не хватает/);
});
test('шаг: выключено/не крафтер/бой — ни одного запроса', async () => {
  for (const o of [{ cfg: { craftAuto: false } }, { role: () => 'spoiler' }, { isBattle: () => true }, { on: false }]) {
    const { posts, C, env } = make(o); env.rt.craftQueue = [{ id: 'a', code: 'steel', n: 5 }]; assert.equal(await C.step(), false); assert.equal(posts.length, 0); }
});
test('шаг: список из меню → POST с revision, прогресс и журнал; готовое больше не крафтится', async () => {
  const { env, posts, recs, C } = make(); env.rt.craftQueue = [{ id: 'a', code: 'steel', nm: 'Steel', n: 5 }];
  assert.equal(await C.step(Date.now()), true);
  assert.deepEqual(JSON.parse(JSON.stringify(posts)), [['/game/craft/materials', { recipeCode: 'steel', craftCount: 5, expectedRevision: 77 }]]);
  assert.equal(env.rt.craftMade.a, 5); assert.ok(recs.some(r => /Steel ×5/.test(r))); assert.equal(env.rt.craftBook.lvl, 4);
  C.reset(); assert.equal(await C.step(Date.now() + 10 * 60000), false); assert.equal(posts.length, 1);
});
test('шаг: цель Маммона — план goalAll как есть (полуфабрикаты первыми), без повторного разворота', async () => {
  const { env, posts, C } = mammonEnv();
  assert.deepEqual(JSON.parse(JSON.stringify(C.wants().map(w => w.id))), [1887, 1890]);
  assert.equal(await C.step(), true); assert.equal(posts[0][1].recipeCode, 'varnish_of_purity'); assert.equal(posts[0][1].craftCount, 3);
  env.cfg.craftMammon = false; C.reset(); assert.equal(C.wants().length, 0);
});
test('Маммон: сумка не свежая — сначала перечитать; не прочиталась — для Маммона не крафтим (ревью 21.10)', async () => {
  let refresh = 0; const M = mammonEnv({ invSnapshot: () => null, invRefresh: async () => { refresh++; return null; } });
  assert.equal(await M.C.step(), false); assert.equal(refresh, 1); assert.equal(M.posts.length, 0); assert.match(M.env.rt.craftSay.why, /сумка не перечитана/);
  let fresh = null; const N = mammonEnv({ invSnapshot: () => fresh, invRefresh: async () => { fresh = { t: Date.now() + 1 }; return {}; } });
  assert.equal(await N.C.step(), true); assert.equal(N.posts.length, 1, 'после чтения сумки — крафт');
});
test('Маммон: после своего крафта сумка не перечиталась — тот же крафт не повторяется', async () => {
  const M = mammonEnv({ invRefresh: async () => null });
  assert.equal(await M.C.step(), true); assert.equal(M.posts.length, 1);
  assert.equal(await M.C.step(Date.now() + 5000), false); assert.equal(M.posts.length, 1, 'снимок сумки старше крафта');
  M.snap.t = Date.now() + 10; assert.equal(await M.C.step(Date.now() + 10000), false, 'повтор чтения сумки — через минуту');
  assert.equal(await M.C.step(Date.now() + 70000), true); assert.equal(M.posts.length, 2, 'свежая сумка — можно дальше');
});
test('Маммон: уровень не виден, сырьё у Skye, цена — оценка, снята «крафтить самому» — не крафтим и пишем причину', async () => {
  const cases = [[M => { M.env.rt.mmGear = []; }, /уровень вещи-цели/], [M => { M.env.rt.mmCraft = { at: { 1869: 15 } }; }, /у крафтера/],
    [M => { M.env.mammon.craftPlan = () => ({ name: 'Belt', lvl: 3, to: 4, lv: [{ L: 3, est: 1 }], craft: [{ id: 1880, qty: 12 }] }); }, /оценка/],
    [M => { M.env.cfg.subCraftSelf = false; }, /крафтить самому/]];
  for (const [set, re] of cases) { const M = mammonEnv(); set(M); assert.equal(await M.C.step(), false); assert.equal(M.posts.length, 0); assert.match(M.env.rt.craftSay?.why || '', re); }
  // оценка только на дальних уровнях — берём ближайший уровень с ценой кузнеца
  const M = mammonEnv(); M.env.mammon.craftPlan = s => s === 'next' ? { name: 'Belt', lvl: 1, to: 2, lv: [{ L: 1, est: 0 }], craft: [{ id: 1880, qty: 2 }] }
    : { name: 'Belt', lvl: 1, to: 5, lv: [{ L: 1, est: 0 }, { L: 2, est: 1 }], craft: [{ id: 1880, qty: 20 }] };
  assert.deepEqual(JSON.parse(JSON.stringify(M.C.wants().map(w => [w.id, w.n]))), [[1880, 2]]);
});
test('ответ на крафт не пришёл (обрыв/5xx) — повтора нет до сверки по сумке; сверка засчитывает или разрешает повтор', async () => {
  for (const fail of [async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }, async () => ({ ok: false, status: 502, json: async () => ({}) })]) {
    let calls = 0; const M = make({ gamePost: async (p, b) => { calls++; return fail(); } }); M.env.rt.craftQueue = [{ id: 'a', code: 'steel', nm: 'Steel', n: 5 }];
    M.env.hero = { revision: 77, inventory: { stacks: [{ itemId: 1880, qty: 3 }] } };
    assert.equal(await M.C.step(), true); assert.equal(calls, 1); assert.equal(M.env.rt.craftPending.have0, 3); assert.equal(M.env.rt.craftPending.rev, 77);
    assert.match(M.recs.join('\n'), /результат неизвестен/);
    // сервер скрафтил: revision другая, Steel 3 → 8
    M.env.hero = { revision: 78, inventory: { stacks: [{ itemId: 1880, qty: 8 }] } };
    assert.equal(await M.C.step(Date.now() + 20000), true); assert.equal(calls, 1, 'сверка без нового POST');
    assert.equal(M.env.rt.craftPending, null); assert.equal(M.env.rt.craftMade.a, 5); assert.match(M.recs.join('\n'), /сверка: скрафчено Steel ×5/);
  }
  const M = make({ gamePost: async () => { throw new Error('Failed to fetch'); } }); M.env.rt.craftQueue = [{ id: 'a', code: 'steel', nm: 'Steel', n: 5 }];
  assert.equal(await M.C.step(), true);
  assert.equal(await M.C.step(Date.now() + 20000), true); assert.equal(M.env.rt.craftPending, null, 'revision та же — не скрафчен');
  assert.equal(M.env.rt.craftMade, undefined); assert.match(M.recs.join('\n'), /не скрафчен \(герой не менялся\)/);
});
test('обрыв GET книги/героя не роняет главный цикл: шаг возвращает false и ставит паузу', async () => {
  const M = make({ gameGet: async () => { throw Object.assign(new Error('signal is aborted'), { name: 'AbortError' }); } });
  M.env.rt.craftQueue = [{ id: 'a', code: 'steel', n: 5 }];
  assert.equal(await M.C.step(), false); assert.match(M.recs.join(), /книга рецептов не прочитана \(нет ответа\)/);
  assert.equal(await M.C.step(Date.now() + 1000), false);
});
test('паузы и отказ рецепта переживают переход страницы (sessionStorage вкладки)', async () => {
  const box = ssBox(); let posts = 0;
  const A = make({ gamePost: async () => { posts++; return { ok: false, status: 400, json: async () => ({ messageRu: 'Недостаточно MP' }) }; } }, box);
  A.env.rt.craftQueue = [{ id: 'a', code: 'steel', n: 5 }]; assert.equal(await A.C.step(), true); assert.equal(posts, 1);
  vm.runInNewContext(read('modules/craft.js'), box); const B = box.L2V7Factories.craft(A.env);          // новая страница — новая фабрика
  assert.equal(await B.step(Date.now() + 5000), false); assert.equal(posts, 1, 'отказанный рецепт не повторён');
  const E = make({}, ssBox()); E.env.rt.craftQueue = [{ id: 'a', code: 'nope', n: 1 }]; assert.equal(await E.C.step(), false); const g = E.gets.length;
  vm.runInNewContext(read('modules/craft.js'), E.box); assert.equal(await E.box.L2V7Factories.craft(E.env).step(Date.now() + 1000), false); assert.equal(E.gets.length, g, 'пауза 5 мин держится');
});
test('запас MP не ниже порога банки в бою; тур РБ/поход (modeFree) — крафт ждёт', async () => {
  const M = make(); M.env.rt.craftQueue = [{ id: 'a', code: 'steel', n: 5000 }]; M.env.cfg.fighterMpPct = 25;
  assert.equal(await M.C.step(), true); assert.equal(M.posts[0][1].craftCount, Math.floor((484 - Math.ceil(484 * 0.35)) / 10));
  const F = make({ free: () => false }); F.env.rt.craftQueue = [{ id: 'a', code: 'steel', n: 5 }];
  assert.equal(await F.C.step(), false); assert.equal(F.gets.length, 0);
});
test('шаг: отказ игры — рецепт пропускается 30 мин; 409 — перечитать сразу', async () => {
  const { env, posts, C } = make({ gamePost: async (p, b) => { posts.push(b); return { ok: false, status: 400, json: async () => ({ messageRu: 'Недостаточно MP' }) }; } });
  env.rt.craftQueue = [{ id: 'a', code: 'steel', n: 5 }];
  assert.equal(await C.step(), true); assert.match(env.rt.craftSay.why, /Недостаточно MP/);
  const n = posts.length; await C.step(Date.now() + 5000); assert.equal(posts.length, n);
  const B = make({ gamePost: async () => ({ ok: false, status: 409, json: async () => ({}) }) }); B.env.rt.craftQueue = [{ id: 'a', code: 'steel', n: 5 }];
  assert.equal(await B.C.step(), true); assert.equal(B.env.rt.craftMade, undefined);
});
test('подключение: manifest, геттеры фабрики, умолчания, меню', () => {
  const man = JSON.parse(read('manifest.json')), js = man.content_scripts.flatMap(c => c.js);
  assert.ok(js.indexOf('modules/craft.js') > -1 && js.indexOf('modules/craft.js') < js.indexOf('content.js'));
  const src = read('modules/craft.js'), used = [...new Set([...src.matchAll(/env\.(\w+)/g)].map(m => m[1]))];
  const fac = read('content.js').match(/L2V7Modules\.craft = L2V7Factories\.craft\(\{([\s\S]*?)\}\);/)[1];
  for (const k of used) assert.match(fac, new RegExp(`get ${k}\\(\\)`), `нет геттера ${k}`);
  assert.match(read('defaults.js'), /craftAuto: false, craftMammon: true, craftMpKeep: 20/);
  assert.match(fac, /get free\(\) \{ return \(\) => L2V7Modules\.mammon\?\.modeFree\?\.\(\); \}/);
  assert.match(read('content.js'), /else if \(!\(await L2V7Modules\.craft\?\.step\?\.\(\)\)\) await tasksIdle\(\);/, 'ожидание без служебных задач — тоже крафт');
  // рецепты книги в справочнике Маммона совпадают с настоящей книгой 21.10
  const mb = { console }; vm.runInNewContext(read('modules/mammon.js'), mb); const R = mb.L2V7Factories.mammon({ cfg: {}, rt: {} }).MM_RECIPES;
  for (const r of BOOK.recipes) { const x = R[r.output.itemId]; assert.ok(x, `нет рецепта ${r.output.nameEn}`); assert.equal(x[0], r.output.quantity);
    assert.deepEqual(JSON.parse(JSON.stringify(x[1].map(i => [i[0], i[2]]).sort())), r.ingredients.map(i => [i.itemId, i.quantity]).sort(), r.output.nameEn); }
  for (const id of ['craftAuto', 'craftMammon', 'craftMpKeep', 'craftPick', 'craftAdd', 'craftList', 'craftBox']) assert.match(read('popup.html'), new RegExp(`id="${id}"`));
});

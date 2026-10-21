'use strict';
// 20.43 (John 21.10 12:12: саб крафтера): свой крафт материалов — modules/craft.js. Книга рецептов — настоящий ответ
// GET /game/craft/materials от 21.10 (Warsmith 40, Create Item ещё не выучен).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = n => fs.readFileSync(path.join(root, n), 'utf8');
const BOOK = JSON.parse(read('tests/fixtures/craft-materials-2026-10-21.json'));
const open = (lvl = 4, mp = 484) => { const b = JSON.parse(JSON.stringify(BOOK)); b.createItemLevel = lvl; b.currentMp = mp;
  for (const r of b.recipes) { if (r.createItemLevel <= lvl) delete r.lockedReason;
    r.maxCraftable = r.createItemLevel > lvl ? 0 : Math.min(...r.ingredients.map(i => Math.floor(i.have / i.quantity))); } return b; };
function make(over = {}) {
  const box = { console }; vm.runInNewContext(read('modules/craft.js'), box);
  const posts = [], recs = [], env = { cfg: { craftAuto: true, craftMpKeep: 20 }, rt: { char: 'Warlock' }, on: true, tabOwner: true, role: () => 'crafter', isBattle: () => false,
    setRt: async p => Object.assign(env.rt, p), rec: (...a) => recs.push(a.join(' ')), invRefresh: async () => ({}), book: open(),
    gameGet: async p => ({ ok: true, status: 200, json: async () => p === '/character' ? { character: { revision: 77 } } : env.book }),
    gamePost: async (p, b) => { posts.push([p, b]); return { ok: true, status: 200, json: async () => ({ character: {} }) }; }, ...over };
  return { env, posts, recs, C: box.L2V7Factories.craft(env) };
}
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
test('шаг: цель Маммона — план craftPlan, полуфабрикаты с конца', async () => {
  const { env, posts, C } = make({ mammon: { craftPlan: () => ({ name: 'Belt', lvl: 1, to: 2, craft: [{ id: 1890, qty: 3 }, { id: 1887, qty: 3 }] }) } });
  env.cfg.mmGoalItem = 123; env.book.recipes.find(r => r.code === 'mithril_alloy').maxCraftable = 0;
  assert.equal(await C.step(), true); assert.equal(posts[0][1].recipeCode, 'varnish_of_purity'); assert.equal(posts[0][1].craftCount, 3);
  env.cfg.craftMammon = false; C.reset(); assert.equal(C.wants().length, 0);
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
  for (const id of ['craftAuto', 'craftMammon', 'craftMpKeep', 'craftPick', 'craftAdd', 'craftList', 'craftBox']) assert.match(read('popup.html'), new RegExp(`id="${id}"`));
});

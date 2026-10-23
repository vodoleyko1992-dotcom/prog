'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
function chunk(t, begin, end) {
  const a = t.indexOf(begin), b = t.indexOf(end, a + begin.length);
  assert(a >= 0 && b > a, `Section missing: ${begin}`);
  return t.slice(a, b);
}
async function testItems() {
  let n = 0, now = 200000, fail = false;
  const c = vm.createContext({ TAG: '[test]', console: { warn() {} }, Date: { now: () => now },
    chrome: { runtime: { getURL: n => 'moz-extension:///'.concat(n) } },
    async fetch(url) {
      n++;
      assert(url.endsWith('items-il.json'));
      await new Promise(r => setTimeout(r, 2));
      if (fail) throw new Error('transient');
      return { ok: true, async json() { return { 1: { n: 'Test Sword', wt: 'меч' }, 2: { n: 'Other' } }; } };
    }
  });
  // 9.2.4: weaponWt убран вместе со сменой оружия ради баффа — конец вырезки по следующему комментарию
  vm.runInContext(chunk(src, 'let ITEMS =', '// баффы с общим слотом эффекта') + '\nthis.itemsDb=itemsDb;this.itemOf=itemOf;this.clear=()=>{ITEMS=null;itemsRetryAt=0;};', c);
  const [a, b] = await Promise.all([c.itemsDb(), c.itemsDb()]);
  assert.equal(n, 1, 'Concurrent item requests should share one fetch');
  assert.equal(a, b);
  assert.equal(c.itemOf('test sword').id, 1);
  assert.equal(c.itemOf(2).n, 'Other');
  c.clear(); fail = true;
  assert.equal(await c.itemsDb(), null, 'Temporary error should not force an empty permanent cache');
  assert.equal(await c.itemsDb(), null, 'Backoff avoids repeated failed fetches');
  assert.equal(n, 2);
  now += 30001; fail = false;
  assert(await c.itemsDb(), 'Retry succeeds after backoff');
  assert.equal(n, 3);
  assert.equal(c.itemOf('Test Sword').wt, 'меч');
  assert(!src.includes('        itemsDb(); farmDb().catch'), 'Remove unconditional item loading');
  assert(fs.readFileSync(path.join(root, 'modules/equipment.js'), 'utf8').includes('await env.itemsDb(); // рейтинг оружия'), 'Weapon auto-role load must remain accurate');
  console.log('PASS: lazy item loading, de-duplication, retry, item lookup');
}
async function testKnowledgeCaches() {
  let n = 0;
  let db = { farmDb: { res: { start: 1 } }, recipeDb: { rec: { init: 2 } } };
  const c = vm.createContext({ chrome: { storage: { local: {
    async get(key) { n++; await Promise.resolve(); return { [key]: db[key] }; }
  } } } });
  vm.runInContext(chunk(src, 'let FARM =', 'const isFarmPage') + '\nthis.farmDb=farmDb;', c);
  vm.runInContext(chunk(src, 'let RECIPES =', 'const recipeKey') + '\nthis.recipeDb=recipeDb;', c);
  await Promise.all([c.farmDb(), c.farmDb(), c.recipeDb(), c.recipeDb()]);
  assert.equal(n, 2, 'One storage read per cache');
  db = { farmDb: { res: { next: 3 } }, recipeDb: { rec: { later: 4 } } };
  assert(src.includes('if (ch.farmDb) FARM = ch.farmDb.newValue || null;'));
  assert(src.includes('if (ch.recipeDb) RECIPES = ch.recipeDb.newValue || null;'));
  vm.runInContext('FARM = { res: { next: 3 } }; RECIPES = { rec: { later: 4 } };', c);
  assert.equal((await c.farmDb()).res.next, 3);
  assert.equal((await c.recipeDb()).rec.later, 4);
  assert.equal(n, 2, 'Updated caches do not refetch unneeded data');
  console.log('PASS: resource/recipe read de-duplication and cache refresh');
}
async function testRetention() {
  const c = vm.createContext({});
  vm.runInContext(chunk(bg, 'function trimOldest(', 'let buf =') + '\nthis.trimOldest=trimOldest;', c);
  const deleted = new Set(), keys = [1, 20, 22, 300, 400];
  let finish;
  const done = new Promise(r => finish = r);
  const st = {
    openCursor() {
      let i = 0;
      const req = {};
      Object.defineProperty(req, 'onsuccess', { set(cb) {
        const next = () => setImmediate(() => {
          const key = keys[i];
          if (key == null) { cb({ target: { result: null } }); finish(); return; }
          cb({ target: { result: {
            key,
            delete() { deleted.add(key); },
            continue() { i++; next(); }
          } } });
          // Last cursor stops without continue() when enough keys were deleted.
          if (deleted.size === 2) finish();
        });
        next();
      } });
      return req;
    }
  };
  c.trimOldest(st, 2); await done;
  assert.deepEqual([...deleted], [1, 20]);
  assert.deepEqual(keys.filter(k => !deleted.has(k)), [22, 300, 400]);
  assert(src.includes("const RT_BULKY = ['forumTp', 'rbForum', 'zoneMobs', 'spawns']"), 'User progress must not be evicted');
  assert(bg.includes('buf = [...chunk, ...buf].slice(-10000)'), 'Log records must be retried after write errors');
  console.log('PASS: sparse ID retention, important state preserved, journal retry buffer');
}
(async () => {
  assert.equal(manifest.version, '20.54');
  await testItems();
  await testKnowledgeCaches();
  await testRetention();
  console.log('PASS: all stage-3 tests');
})().catch(e => { console.error(e); process.exitCode = 1; });

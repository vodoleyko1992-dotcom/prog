// 20.64 (файлы John 25.10: страница «Ошибки» Chrome — чтение хранилища в load() меню и предупреждение справочника предметов
// content.js): после ↻ расширения старая вкладка/окно не пишут ошибки на каждом обновлении; живое расширение — как раньше.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const cut = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert(i >= 0 && j > i, 'нет куска ' + a); return s.slice(i, j); };
(async () => {
  // content.js: itemsDb без расширения не трогает getURL и не предупреждает
  const cs = read('content.js'), code = cut(cs, 'let ITEMS = null', 'function itemOf(');
  const run = async (chrome, fetchOk) => {
    const warns = []; let urls = 0;
    const box = { chrome, TAG: '[t]', console: { warn: (...a) => warns.push(a.join(' ')) }, Date,
      fetch: async () => fetchOk ? { ok: true, json: async () => ({ 1: { n: 'Item' } }) } : Promise.reject(new Error('Failed to fetch')) };
    box.chrome.runtime.getURL = p => { urls++; if (!chrome.runtime.id) throw new Error('Extension context invalidated.'); return 'x/' + p; };
    vm.createContext(box); vm.runInContext(code + ';this.D = itemsDb;', box);
    const r = await box.D(); return { r, warns, urls };
  };
  let o = await run({ runtime: {} }, true);
  assert.strictEqual(o.r, null); assert.strictEqual(o.urls, 0); assert.strictEqual(o.warns.length, 0, 'мёртвый контекст — молча');
  o = await run({ runtime: { id: 'abc' } }, true);
  assert.ok(o.r && o.r[1].n === 'Item', 'живое расширение читает справочник');
  o = await run({ runtime: { id: 'abc' } }, false);
  assert.strictEqual(o.r, null); assert.strictEqual(o.warns.length, 1, 'живое расширение: сбой чтения предупреждает');

  // popup.js: load() не отдаёт необработанный отказ
  const pop = read('popup.js'), w = cut(pop, 'async function load() {', 'async function loadNow()');
  for (const [chrome, wantWarn] of [[{ runtime: {} }, 0], [{ runtime: { id: 'a' } }, 0], [{ runtime: { id: 'a' }, storage: { local: {} } }, 1]]) {
    const warns = [];
    const box = { chrome, console: { warn: (...a) => warns.push(a.join(' ')) }, loadNow: async () => { throw new TypeError("Cannot read properties of undefined (reading 'local')"); } };
    vm.createContext(box); vm.runInContext(w + ';this.L = load;', box);
    await box.L();   // не бросает
    assert.strictEqual(warns.length, wantWarn);
  }
  { const box = { chrome: {}, console, loadNow: async () => 7 }; vm.createContext(box); vm.runInContext(w + ';this.L = load;', box); assert.strictEqual(await box.L(), 7); }
  console.log('v2064-dead-context-quiet: PASS');
})().catch(e => { console.error(e); process.exit(1); });

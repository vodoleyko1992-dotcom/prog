'use strict';
// 14.10: стрелки игры раскрывают 1/2/3 ряда; перерисовка панели не должна оставлять ожидание на старом узле.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const sandbox = { console, document: null }; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../modules/combat.js'), 'utf8'), sandbox);
function fixture({ redraw = false, blocked = false, stalled = false, count = 3, metadata = true } = {}) {
  let current, clicks = 0, timeouts = 0; const records = [], rt = {};
  function panel(visible) {
    const down = { disabled: visible >= count };
    return { dataset: metadata ? { visibleRows: String(visible) } : {}, visible, down,
      querySelector: () => down,
      querySelectorAll(sel) { return Array.from({ length: sel.includes(':not') ? this.visible : count }, () => ({})); } };
  }
  current = panel(1);
  sandbox.document = { querySelectorAll: sel => current.querySelectorAll(sel) };
  const env = { rt, $q: sel => sel === '.l2-battle-hotbar' ? current : current.down,
    fire: () => { clicks++; if (blocked) return false; if (stalled) return true;
      if (redraw) current = panel(current.visible + 1);
      else { current.visible++; if (metadata) current.dataset.visibleRows = String(current.visible); current.down.disabled = current.visible >= count; }
      return true; },
    waitX: async predicate => { const value = predicate(); if (!value) timeouts++; return value || null; },
    rec: (...args) => records.push(args), setRt: patch => Object.assign(rt, patch) };
  return { combat: sandbox.L2V7Factories.combat(env), rt, records,
    state: () => ({ visible: current.visible, clicks, timeouts }) };
}
(async () => {
  const normal = fixture(); await normal.combat.hotbarRows3();
  assert.deepEqual(normal.state(), { visible: 3, clicks: 2, timeouts: 0 });
  assert.equal(normal.rt.rows3, 1);
  await normal.combat.hotbarRows3(); assert.equal(normal.state().clicks, 2, 'открытая панель не нажимается повторно');
  const redraw = fixture({ redraw: true }); await redraw.combat.hotbarRows3();
  assert.deepEqual(redraw.state(), { visible: 3, clicks: 2, timeouts: 0 }, 'после перерисовки проверяем новую панель');
  assert.equal(redraw.rt.rows3, 1, 'готовность подтверждается по текущей панели');
  const denied = fixture({ blocked: true }); await denied.combat.hotbarRows3();
  assert.deepEqual(denied.state(), { visible: 1, clicks: 1, timeouts: 0 }, 'отказ шлюза кликов не вызывает ожидание или новые клики');
  const stalled = fixture({ stalled: true }); await stalled.combat.hotbarRows3();
  assert.deepEqual(stalled.state(), { visible: 1, clicks: 1, timeouts: 1 }, 'нет прогресса — не нажимаем стрелку ещё два раза');
  assert.equal(stalled.rt.rows3, undefined);
  const fallback = fixture({ metadata: false }); await fallback.combat.hotbarRows3();
  assert.equal(fallback.state().visible, 3, 'старый DOM без data-visible-rows поддерживается');
  const short = fixture({ count: 2 }); await short.combat.hotbarRows3();
  assert.equal(short.state().visible, 2); assert.equal(short.rt.rows3, undefined);
  console.log('PASS: hotbar row navigation — redraw, denied click, no progress, fallback and idempotence');
})().catch(e => { console.error(e); process.exitCode = 1; });

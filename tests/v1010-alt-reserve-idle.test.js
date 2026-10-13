'use strict';
// 10.0.10 (лог 13.10 19:03–20:58, новый герой alt1 Human Fighter 19 ур. под Dark Avenger): 71 из 80 мин — на карте.
// 1) 19:41 закупка: 204 960 аден, резерв 200 000 из настроек Warlock → куплено 3 банки MP и 23 заряда души; герой бил по 1–5 урона.
//    Резерв — не больше половины адены героя (богатому Warlock правило ничего не меняет).
// 2) 19:44–20:56 «Целей нет, обновлю карту через 15 с» ×242 (72 мин подряд), бот молчал: все мобы «не по зубам» или ниже −5, автофарм ВЫКЛ.
//    Через 3 мин простоя и дальше раз в 10 мин — причина и совет в журнал; появилась цель — отсчёт сброшен.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const load = (f, extra = {}) => { const sb = { console, Date, Math, JSON, Object, Number, String, Array, Set, Map, RegExp, Promise, document: { querySelectorAll: () => [], querySelector: () => null }, location: { pathname: '/gm-shop.html', href: '' }, ...extra }; sb.globalThis = sb; vm.runInNewContext(read(f), sb); return sb; };

// 1. резерв: min(резерв из меню, половина адены)
{
  let adena = 204960;
  const env = { cfg: { shopReserve: 200000 }, rt: {}, $q: s => s === '.l2-gm-shop-adena__amount' ? { textContent: adena.toLocaleString('ru') } : null, pair: () => [0, 0], invQty: () => null, ITEMS: {}, names: () => [], slotsBy: () => [] };
  const E = load('modules/economy.js').L2V7Factories.economy(env);
  assert.equal(E.shopReserve(), 102480, 'бедный новичок: половина адены, не 200 000');
  adena = 101004906; assert.equal(E.shopReserve(), 200000, 'богатый Warlock: резерв из меню как прежде');
  assert.equal(E.shopReserve(0), 0); env.cfg.shopReserve = 0; assert.equal(E.shopReserve(5000), 0, 'резерв 0 остаётся 0');
  const eco = read('modules/economy.js');
  assert.match(eco, /const adena = shopAdena\(\), reserve = shopReserve\(adena\), money = adena - reserve/, 'покупка считает деньги по урезанному резерву');
  assert.match(eco, /половина адены, резерв из меню больше/, 'причина отказа объясняет урезанный резерв');
}
// 2. простой «Целей нет»: отсчёт, запись через 3 мин, повтор не чаще 10 мин, сброс при цели
{
  const mf = read('modules/mobfarm.js');
  assert.match(mf, /let farRecT = 0, lowRecT = 0, idleT0 = 0, idleRecT = 0, idleN = 0;/);   // PR #90: + idleN (растущая пауза)
  assert.match(mf, /if \(!idleT0\) idleT0 = Date\.now\(\);\n\s+else if \(Date\.now\(\) - idleT0 > 180000 && Date\.now\(\) - idleRecT > 600000\) \{/);
  assert.match(mf, /целей нет уже \$\{Math\.round\(\(now - idleT0\) \/ 60000\)\} мин: на карте \$\{items\.length\} мобов — \$\{nHard\} «не по зубам» \(2 ч\), \$\{nLow\} ниже героя −5, \$\{nHigh\} выше окна`/);
  assert.match(mf, /подбор локации ВЫКЛ: включите «🗺 Автофарм» или смените оружие\/зону сами/);
  assert.ok(mf.indexOf('idleT0 = 0; idleN = 0;                         // 10.0.10: цели есть') > mf.indexOf("env.setStatus(`Целей нет, обновлю карту через ${wait} с`);"), 'сброс отсчёта стоит у выбора цели');
  const before = mf.slice(0, mf.indexOf("env.setStatus(`Целей нет, обновлю карту через ${wait} с`);"));
  assert.match(before.slice(-2200), /if \(!cands\.length\) \{\n\s+\/\/ 10\.0\.10/, 'подсказка — в той же ветке «целей нет»');
}
console.log('PASS: 10.0.10 alt — adena reserve capped at half the purse, idle «Целей нет» loop explained in the journal');

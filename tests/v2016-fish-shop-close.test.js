'use strict';
// 23.10.2026: стенд получает новые зависимости темпа; прежние проверки отправок сохранены.
// 18.10 (скрин игрока 12:08, «не закрывает меню после докупки»): после покупки зарядов оплата ждёт сверки, общий запрет
// кликов при неизвестной оплате глотал «Закрыть» магазина рыбака. Закрытие окна разрешено, прочие кнопки — по-прежнему нет.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const core = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const slice = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
class Ev { constructor(type) { this.type = type; } }
const mk = (sel, text) => ({ textContent: text, value: '', events: [], closest: () => null, matches: s => s.split(',').map(x => x.trim()).includes(sel),
  scrollIntoView() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }), dispatchEvent(e) { this.events.push(e.type); } });
const c = { actionNote() {}, on: true, tabOwner: true, running: true, invBusy: false, rt: {}, window: {}, location: { pathname: '/fishing.html' }, PointerEvent: Ev, MouseEvent: Ev,
  L2V7Modules: { payments: { blocked: () => true, consumePermit: () => false }, pvp: { pending: () => false }, actions: { canAct: () => true } },
  isBattle: () => false, isMap: () => false, isFishing: () => true, $q: () => null, abHold: () => false, loginPage: () => false };
vm.createContext(c);
vm.runInContext(slice(core, 'const PAY_FREE_MAP =', '// Single-writer settings update.') + ';this.fire=fire;', c);
const close = mk('#fishing-shop-close', 'Закрыть');
assert.notEqual(c.fire(close), false, 'Закрыть магазин при ожидании сверки оплаты'); assert.ok(close.events.includes('click'));
assert.notEqual(c.fire(mk('#fishing-rod-select-close', 'Закрыть')), false, 'Закрыть выбор удочки');
assert.equal(c.fire(mk('button.l2-fishing-starter-buy-btn', 'Купить')), false, 'Купить при неизвестной оплате — запрещено');
c.isFishing = () => false;
assert.equal(c.fire(mk('#fishing-shop-close', 'Закрыть')), false, 'вне страницы рыбалки исключения нет');
console.log('PASS v2016-fish-shop-close: fisherman shop close button works while purchase awaits reconciliation');

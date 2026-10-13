// 10.0.8 (сборка): выключатель обхода «Cancel» — подписи режимов в меню видны как ВКЛ/ВЫКЛ, «always» отключает цену в champs.judge
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
const sel = /<select id="champCancel">([\s\S]*?)<\/select>/.exec(html); assert(sel, 'select champCancel');
assert(/value="paid">Обход ВКЛ/.test(sel[1]), 'paid = обход ВКЛ');
assert(/value="never">Обход ВКЛ/.test(sel[1]), 'never = обход ВКЛ (жёстко)');
assert(/value="always">Обход ВЫКЛ/.test(sel[1]), 'always = обход ВЫКЛ');
const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'champs.js'), 'utf8');
const ctx = { L2V7Factories: {}, L2V7Modules: {}, console }; vm.createContext(ctx); vm.runInContext(src, ctx);
function mk(mode) {
  const rt = { champLearn: {} }, cfg = { champCancel: mode };
  return ctx.L2V7Factories.champs({ get cfg() { return cfg; }, get rt() { return rt; }, setRt: p => Object.assign(rt, p), rec: () => {}, farmRate: () => ({ eps: 1000, sk: 3000 }), faPaidLeft: () => 3, heroLvl: () => 67 });
}
const red = { tier: 'red', lvl: 68, hp: 145000, exp: 207000 };
const on = mk('paid').judge(red), off = mk('always').judge(red), hard = mk('never').judge(red);
assert.equal(off.cancel, undefined, 'always: цена Cancel не считается');
assert.equal(on.cancel, true, 'paid: при платных баффах красный не цель');
assert.equal(hard.ok, false); assert(/таких не бью/.test(hard.why), 'never: оранжевых/красных не бить');
console.log('v1008-cancel-switch: PASS');

'use strict';
// 22.10: реальные контракты книги/сумки, рекурсивная цепочка, общий запас и отказ до расхода.
const test = require('node:test'), assert = require('node:assert/strict');
const { plan, MAX_DEPTH } = require('../craft-plan.js');
const copy = x => structuredClone(x);
const recipe = (code, item, ingredients, options = {}) => ({ code, output: { itemId: item, nameEn: code, quantity: 1 },
 ingredients: ingredients.map(([itemId, quantity]) => ({ itemId, quantity, have: 0, nameEn: 'Raw' + itemId })),
 createItemLevel: 1, mpCost: 10, successChance: 100, maxCraftable: 0, lockedReason: null, ...options });
const book = recipes => ({ canCraftProfession: true, createItemLevel: 9, currentMp: 0, maxMp: 1000, recipes });
const stock = rows => rows.map(([itemId, qty]) => ({ itemId, qty }));
const goal = (code, n, id = code) => ({ id, code, n });
const chain = () => book([
 recipe('cokes', 10, [[1, 3], [2, 3]]), recipe('synthetic', 11, [[3, 1], [10, 3]], { mpCost: 20, createItemLevel: 2 }),
 recipe('oriharukon', 12, [[11, 1], [3, 4], [4, 12]], { mpCost: 40, createItemLevel: 4 })
]);
const enough = () => stock([[1, 3], [2, 3], [3, 9], [4, 24], [10, 2], [11, 1]]);

test('цепочка Cokes→Synthetic→Oriharukon использует промежуточные из сумки и задаёт postorder', () => {
 const p = plan(chain(), [goal('oriharukon', 2)], {}, enough());
 assert.equal(p.goals[0].status, 'ready'); assert.equal(p.missing.length, 0); assert.equal(p.blocked.length, 0);
 assert.deepEqual(p.steps.map(s => [s.code, s.runs, s.n, s.intermediate]), [['cokes',1,1,true],['synthetic',1,1,true],['oriharukon',2,2,false]]);
 assert.equal(p.mpTotal, 110); for (const s of p.steps) { assert.equal(s.qid, 'oriharukon'); assert.equal(s.rootWant, 2); assert.equal(s.rootN, 2); }
});
test('дефицит любого базового сырья запрещает всю цель и не предлагает частичный расход', () => {
 const bag = enough(); bag.find(x => x.itemId === 1).qty = 1; bag.find(x => x.itemId === 2).qty = 0;
 const p = plan(chain(), [goal('oriharukon', 2)], {}, bag);
 assert.equal(p.goals[0].status, 'missing'); assert.equal(p.steps.length, 0); assert.ok(p.goals[0].steps.length > 0);
 assert.deepEqual(p.missing.map(x => [x.item,x.required,x.have,x.missing]), [[1,3,1,2],[2,3,0,3]]);
});
test('maxCraftable0 и MP0 не являются структурной нехваткой сырья', () => {
 const b = chain(); b.recipes.forEach(r => { r.maxCraftable = 0; r.lockedReason = 'Недостаточно MP'; });
 assert.equal(plan(b, [goal('oriharukon', 2)], {}, enough()).goals[0].status, 'ready');
});
test('стоимость конечного рецепта выше maxMP запрещает расход на всю промежуточную цепочку', () => {
 const b=book([recipe('mid',10,[[1,1]],{mpCost:10}),recipe('final',11,[[10,1]],{mpCost:100})]);b.maxMp=50;
 const p=plan(b,[goal('final',1)],{},stock([[1,10]]));assert.equal(p.steps.length,0);assert.equal(p.goals[0].status,'blocked');
 assert.match(p.blocked[0].reason,/100 MP.*50/);
 for(const maximum of [undefined,null,0,-1,'100',Infinity]) {
  const incomplete=copy(b);incomplete.maxMp=maximum;const q=plan(incomplete,[goal('mid',1)],{},stock([[1,1]]));
  assert.equal(q.steps.length,0);assert.match(q.blocked[0].reason,/Максимум MP/);
 }
});
test('изготовленные финальные штуки made уменьшают цель, существующий output в сумке — нет', () => {
 const b = book([recipe('a', 10, [[1, 1]])]), bag = stock([[1, 20],[10,100]]);
 const p = plan(b, [goal('a', 5)], { a: 3 }, bag); assert.equal(p.steps[0].runs, 2); assert.equal(p.steps[0].rootWant, 2);
 assert.equal(plan(b, [goal('a', 5)], { a: 5 }, bag).done, true);
 assert.equal(plan(b, [goal('a', 5)], { a: 9 }, bag).steps.length, 0);
});
test('несколько предметов в выходе: округление партии и reuse остатка у соседней ветки', () => {
 const b = book([recipe('a', 10, [[1,1]], { output: { itemId:10, nameEn:'A', quantity:3 } }),
  recipe('b',11,[[10,1]]),recipe('c',12,[[10,1]]),recipe('final',13,[[11,1],[12,1]])]);
 const p = plan(b, [goal('final', 1)], {}, stock([[1,1]]));
 assert.equal(p.goals[0].status, 'ready'); assert.deepEqual(p.steps.map(s => [s.code,s.runs,s.n]), [['a',1,3],['b',1,1],['c',1,1],['final',1,1]]);
});
test('два ингредиента не могут каждый использовать один и тот же запас сырья', () => {
 const b = book([recipe('a',10,[[1,3]]),recipe('b',11,[[1,3]]),recipe('final',12,[[10,1],[11,1]])]);
 const p = plan(b, [goal('final',1)], {}, stock([[1,3]]));
 assert.equal(p.steps.length,0); assert.deepEqual(p.missing.map(x => [x.required,x.have,x.missing]), [[6,3,3]]);
});
test('не обеспеченная первая цель откатывает резерв, следующая обеспеченная исполняется', () => {
 const b = book([recipe('a',10,[[1,3]])]), p = plan(b,[goal('a',3,'big'),goal('a',1,'small')],{},stock([[1,3]]));
 assert.deepEqual(p.goals.map(x => x.status), ['missing','ready']); assert.deepEqual(p.steps.map(x => x.qid), ['small']);
 assert.deepEqual(p.missing.map(x => [x.required,x.have,x.missing]), [[12,3,9]], 'общий запас вычтен только один раз для всей очереди');
});
test('глобальный дефицит не складывает have у нескольких missing целей', () => {
 const b = book([recipe('a',10,[[1,10]])]), p = plan(b,[goal('a',1,'x'),goal('a',1,'y')],{},stock([[1,5]]));
 assert.deepEqual(p.goals.map(g => g.missing[0].missing), [5,5]);
 assert.deepEqual(p.missing.map(x => [x.required,x.have,x.missing,x.qids]), [[20,5,15,['x','y']]]);
});
test('общий запас промежуточного также вычитается однажды из общего дефицита', () => {
 const b = book([recipe('a',10,[[1,2]]),recipe('b',11,[[10,2]])]), p = plan(b,[goal('b',1,'x'),goal('b',1,'y')],{},stock([[10,1],[1,0]]));
 assert.deepEqual(p.missing.map(x => [x.item,x.required,x.have,x.missing]), [[1,6,0,6]]);
});
test('финальный продукт предыдущей цели может быть сырьём следующей, как после fresh-пересчёта', () => {
 const b = book([recipe('a',10,[[1,1]]),recipe('b',11,[[10,3]])]), queue = [goal('a',3),goal('b',1)], bag = stock([[1,3]]);
 const p = plan(b,queue,{},bag); assert.deepEqual(p.steps.map(x => [x.code,x.runs]), [['a',3],['b',1]]);
 const next = plan(b,queue,{ a:3 },stock([[1,0],[10,3]])); assert.deepEqual(next.steps.map(x => [x.code,x.runs]), [['b',1]]);
});
test('цепочку можно выключить: показывается нехватка самого промежуточного материала', () => {
 const p = plan(chain(),[goal('oriharukon',2)],{},enough(),{chain:false});
 assert.equal(p.steps.length,0); assert.deepEqual(p.missing.map(x => [x.item,x.required,x.have,x.missing]), [[11,2,1,1]]);
});
test('цикл и self-cycle завершаются безопасным отказом, в том числе при запасе final item', () => {
 for (const b of [book([recipe('a',10,[[11,1]]),recipe('b',11,[[10,1]])]),book([recipe('a',10,[[10,1]])])]) {
  const p = plan(b,[goal('a',1)],{},stock([[10,5]])); assert.equal(p.steps.length,0); assert.match(p.blocked[0].reason,/Цикл/);
 }
});
test('неоднозначный producer не выбирается случайно', () => {
 const b = book([recipe('a',10,[[1,1]]),recipe('a2',10,[[2,1]]),recipe('final',11,[[10,1]])]);
 const p = plan(b,[goal('final',1)],{},stock([[1,1],[2,1]])); assert.equal(p.steps.length,0); assert.match(p.blocked[0].reason,/Неоднозначный/);
 const direct = plan(b,[goal('a',1)],{},stock([[1,1]])); assert.equal(direct.steps[0].code,'a','явно выбранный код не неоднозначен');
});
test('повтор code, изменённый output и неизвестный рецепт блокируются', () => {
 const r = recipe('a',10,[[1,1]]);
 for (const [b,q] of [[book([r,copy(r)]),goal('a',1)],[book([r]),{...goal('a',1),item:99}],[book([r]),goal('unknown',1)]]) {
  const p = plan(b,[q],{},stock([[1,1]])); assert.equal(p.steps.length,0); assert.equal(p.goals[0].status,'blocked');
 }
});
test('нет профессии/навыка или серверная блокировка: расход не планируется', () => {
 for (const change of [b => { b.canCraftProfession=false; },b => { b.createItemLevel=0; },b => { b.recipes[0].lockedReason='Рецепт запрещён'; }]) {
  const b=book([recipe('a',10,[[1,1]])]);change(b);const p=plan(b,[goal('a',1)],{},stock([[1,1]]));assert.equal(p.steps.length,0);assert.equal(p.goals[0].status,'blocked');
 }
});
test('неизвестная блокировка со слогом «ман» не принимается за нехватку маны', () => {
 for(const reason of ['Команда запрещена','Манипуляции запрещены','MP расходовать запрещено','Сырьё временно заблокировано','Недостаточно MP; команда запрещена']) {
  const b=book([recipe('a',10,[[1,1]],{lockedReason:reason})]),p=plan(b,[goal('a',1)],{},stock([[1,1]]));
  assert.equal(p.steps.length,0,reason);assert.equal(p.goals[0].status,'blocked',reason);
 }
 for(const reason of ['Недостатньо MP','Недостатньо: MP.','Недостаточно: маны.','Недостаточно маны','Не вистачає матеріалів','Not enough ingredients']) {
  const b=book([recipe('a',10,[[1,1]],{lockedReason:reason})]),p=plan(b,[goal('a',1)],{},stock([[1,1]]));
  assert.equal(p.goals[0].status,'ready',reason);
 }
});
test('живой Maestro: «Недостатньо: Mold Hardener.» даёт точную нехватку по свежей сумке', () => {
 // Проекция book+inventory из live-missing-repro22.10, без имени героя/сессии; have книги не заменяет переданную свежую сумку.
 const liveBook={createItemLevel:9,currentMp:1560,maxMp:1560,canCraftProfession:true,recipes:[{
  code:'maestro_holder',output:{itemId:4045,nameEn:'Maestro Holder',nameUk:'Тримач майстра',quantity:1},
  ingredients:[{itemId:1887,nameEn:'Varnish of Purity',nameUk:'Очищений лак',quantity:10,have:213},
   {itemId:4040,nameEn:'Mold Lubricant',nameUk:'Змащення форми',quantity:10,have:2583},
   {itemId:4041,nameEn:'Mold Hardener',nameUk:'Загартовувач форми',quantity:10,have:0}],
  createItemLevel:7,mpCost:183,successChance:100,maxCraftable:0,lockedReason:'Недостатньо: Mold Hardener.'
 }]};
 const bag=stock([[1887,213],[4040,2583]]),p=plan(liveBook,[goal('maestro_holder',1)],{},bag);
 assert.equal(p.goals[0].status,'missing');assert.deepEqual(p.blocked,[]);assert.deepEqual(p.steps,[]);
 assert.deepEqual(p.missing.map(x=>[x.item,x.required,x.have,x.missing]),[[4041,10,0,10]]);
 const updated=plan(liveBook,[goal('maestro_holder',1)],{},[...bag,{itemId:4041,qty:10}]);
 assert.equal(updated.goals[0].status,'ready','прежний текст блокировки не перекрывает подтверждённую свежую сумку');
});
test('названная в lockedReason нехватка промежуточного Cokes раскрывает цепочку', () => {
 const b=chain();b.recipes[1].ingredients[1].nameEn='Cokes';b.recipes[1].lockedReason='Недостатньо: Cokes.';
 const p=plan(b,[goal('synthetic',1)],{},stock([[1,9],[2,9],[3,1]]));
 assert.equal(p.goals[0].status,'ready');assert.deepEqual(p.steps.map(x=>[x.code,x.runs]),[['cokes',3],['synthetic',1]]);
});
test('префикс нехватки допускает только полное известное имя nameEn/nameUk/nameRu', () => {
 const r=recipe('a',10,[[1,1]]);Object.assign(r.ingredients[0],{nameEn:'Mold Hardener',nameUk:'Загартовувач форми',nameRu:'Отвердитель формы'});
 for(const reason of ['Недостатньо: Mold Hardener.','Недостатньо: Загартовувач форми.','Недостаточно: Отвердитель формы.']) {
  const b=book([{...copy(r),lockedReason:reason}]),p=plan(b,[goal('a',1)],{},[]);
  assert.equal(p.goals[0].status,'missing',reason);assert.deepEqual(p.blocked,[]);
 }
 for(const reason of ['Недостатньо: Hardener.','Недостатньо: Mold Hardener unknown.','Недостатньо: Unknown Resource.',
  'Недостатньо: Mold Hardener; команда запрещена.','Команда запрещена','Недостатньо: MP запрещено.']) {
  const b=book([{...copy(r),lockedReason:reason}]),p=plan(b,[goal('a',1)],{},stock([[1,1]]));
  assert.equal(p.goals[0].status,'blocked',reason);assert.deepEqual(p.steps,[]);
 }
});
test('явные шансы100/1 и отсутствующее поле допустимы, остальные не обещают достижение цели', () => {
 for (const chance of [100,1,undefined,99,0,0.6,null,'100']) {
  const b=book([recipe('a',10,[[1,1]],{successChance:chance})]),p=plan(b,[goal('a',1)],{},stock([[1,1]]));
  assert.equal(p.goals[0].status,[100,1,undefined].includes(chance)?'ready':'blocked',String(chance));
 }
});
test('небезопасные/отрицательные/дробные количества и переполнения отсекаются', () => {
 for (const qty of [-1,0,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'2']) {
  const b=book([recipe('a',10,[[1,qty]])]),p=plan(b,[goal('a',1)],{},stock([[1,10]]));assert.equal(p.steps.length,0);assert.equal(p.goals[0].status,'blocked');
 }
 const b=book([recipe('a',10,[[1,Number.MAX_SAFE_INTEGER]])]);assert.equal(plan(b,[goal('a',2)],{},stock([])).steps.length,0);
 const repeat=book([recipe('a',10,[[1,Number.MAX_SAFE_INTEGER],[1,1]])]),p=plan(repeat,[goal('a',1)],{},stock([[1,Number.MAX_SAFE_INTEGER]]));
 assert.equal(p.steps.length,0);assert.equal(p.goals[0].status,'blocked');assert.match(p.blocked[0].reason,/слишком велика/);
 const total=plan(b,[goal('a',1,'x'),goal('a',1,'y')],{},[]);assert.equal(total.steps.length,0);assert.deepEqual(total.missing,[]);
 assert.match(total.blocked[0].reason,/слишком велика/,'частичная сумма не выдаётся за общий дефицит');
});
test('неизвестная сумка, переполненная стопка, двойной ID цели и неверный progress не открывают расход', () => {
 const b=book([recipe('a',10,[[1,1]])]);
 for (const [q,m,s] of [[[goal('a',1)],{},null],[[goal('a',1)],{},[{itemId:1,qty:null}]],[[goal('a',1)],{},stock([[1,Number.MAX_SAFE_INTEGER],[1,1]])],
  [[goal('a',1),goal('a',1)],{},stock([[1,5]])],[[goal('a',1)],{a:-1},stock([[1,5]])]]) {
  assert.equal(plan(b,q,m,s).steps.length,0);
 }
});
test('глубина цепочки ограничена, неправильная книга и очередь дают понятный отказ', () => {
 const rs=[];for(let i=1;i<=MAX_DEPTH+2;i++)rs.push(recipe('r'+i,i,[[i+1,1]]));
 const p=plan(book(rs),[goal('r1',1)],{},[]);assert.equal(p.steps.length,0);assert.match(p.blocked[0].reason,/слишком длинная/);
 assert.match(plan(null,[goal('a',1)],{},[]).blocked[0].reason,/Книга/);assert.match(plan(book([]),null,{},[]).blocked[0].reason,/Очередь/);
});
test('план не меняет книгу, очередь, прогресс, сумку; повтор идентичен', () => {
 const b=chain(),q=[goal('oriharukon',2)],m={},s=enough(),before=JSON.stringify([b,q,m,s]);
 const a=plan(b,q,m,s),z=plan(b,q,m,s);assert.equal(JSON.stringify(a),JSON.stringify(z));assert.equal(JSON.stringify([b,q,m,s]),before);
});

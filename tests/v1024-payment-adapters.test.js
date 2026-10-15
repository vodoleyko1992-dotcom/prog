'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function attach(env){
 const box={console,Date};vm.runInNewContext(read('modules/payments.js'),box);
 env.tabOwner=true;env.on=true;env.leaseEpoch=1;env.autonomyMode=env.autonomyMode||(()=>'farm');env.rt.char=env.rt.char||'hero';env.rt.manualKickAt=1;
 env.setRt=async p=>{Object.assign(env.rt,p);return {ok:true}};env.rtCommit=async()=>true;
 const reload=()=>env.payments=box.L2V7Factories.payments(env);reload();return reload;
}
function shop(){
 const file=path.join(__dirname,'v1015-clan-economy.test.js'),source=fs.readFileSync(file,'utf8');
 const box={require:require('node:module').createRequire(file),__dirname,console,process,URLSearchParams};
 vm.runInNewContext(source.slice(0,source.indexOf('const descriptor='))+'\nthis.make=fixture;',box);
 const f=box.make(),reload=attach(f.env);let stock=0,pays=0,apply=true;
 f.env.rt.shop={t:123,step:'buy',need:[{key:'shots',grade:'A',buy:10,label:'A'}]};
 f.env.invQty=()=>stock;f.env.gameGet=async()=>({ok:true,json:async()=>({character:{name:f.env.rt.char,inventory:{stacks:[{itemId:3951,qty:stock}]}}})});
 const fire=f.env.fire;f.env.fire=b=>{if(f.env.payments.blocked()&&!f.env.payments.consumePermit())return false;if(b===f.confirm){pays++;if(apply)stock+=10}return fire(b)};
 return {...f,reload,apply:v=>apply=v,stock:v=>stock=v,pays:()=>pays,it:{key:'shots',grade:'A',ids:[3951],name:/Благословенн\S* заряд дух/i,label:'A'}};
}
test('GM: запас и done подтверждаются до снятия блокировки оплаты',async()=>{const f=shop(),r=await f.M.shopBuyOne(f.it,10);assert.equal(r.ok,true);assert.equal(f.pays(),1);assert.equal(f.env.payments.blocked(),false);assert.equal(f.env.rt.shop.done[0].qty,10);assert.equal(f.env.rt.shop.spent,500)});
test('GM: потерянный ответ и reload не вызывают вторую закупку',async()=>{const f=shop();f.apply(false);assert.equal((await f.M.shopBuyOne(f.it,10)).pending,true);f.reload();await f.M.shopStep();assert.equal(f.pays(),1);assert.ok(f.env.payments.blocked());f.stock(10);await f.M.shopStep();assert.equal(f.env.payments.blocked(),false);assert.equal(f.env.rt.shop.done.length,1)});
test('GM: неполный прирост запаса не выдаётся за завершённую покупку',async()=>{const f=shop();f.apply(false);await f.M.shopBuyOne(f.it,10);f.stock(5);assert.equal(await f.M.paymentReconcile(),false);assert.ok(f.env.payments.blocked())});
test('GM: storage failure перед confirm не нажимает покупку',async()=>{const f=shop();f.env.rtCommit=async()=>false;await f.M.shopBuyOne(f.it,10);assert.equal(f.pays(),0)});
test('GM: поздняя сверка не дописывает done в новую задачу игрока',async()=>{const f=shop();f.apply(false);await f.M.shopBuyOne(f.it,10);f.env.rt.shop={t:999,step:'count'};f.env.rt.manualKickAt++;f.stock(10);assert.ok(await f.M.paymentReconcile());assert.equal(f.env.rt.shop.step,'count');assert.equal(f.env.rt.shop.done,undefined)});
for(const event of ['character','lease','ownership','payment'])test(`GM: ${event} меняется во время GET — старая сверка не меняет задачу`,async()=>{
 const f=shop();f.apply(false);await f.M.shopBuyOne(f.it,10);const before=JSON.stringify(f.env.rt.shop), char=f.env.rt.char;
 f.env.gameGet=async()=>({ok:true,json:async()=>{
  if(event==='character')f.env.rt.char='other';if(event==='lease')f.env.leaseEpoch++;if(event==='ownership')f.env.tabOwner=false;
  if(event==='payment')f.env.rt.actionPayments.pending={...f.env.rt.actionPayments.pending,id:'new-payment'};
  return {character:{name:char,inventory:{stacks:[{itemId:3951,qty:10}]}}};
 }});
 assert.equal(await f.M.paymentReconcile(),false);assert.equal(JSON.stringify(f.env.rt.shop),before);assert.equal(f.env.rt.actionPayments.history,undefined);
});
function buffs(){
 let balance=20,pays=0,apply=true;const H={};
 const b={dataset:{skillId:'1357',cost:'5'},closest:()=>null,parentElement:null};
 const hud={querySelectorAll:()=>Object.entries(H).map(([id,exp])=>({dataset:{skillId:id,expiresAt:exp},getAttribute:()=> 'Buff Lv.3'}))};
 const box={console,Date,location:{pathname:'/fast-aden-buffer.html'},document:{querySelectorAll:s=>s==='.l2-fa-buy[data-skill-id]'?[b]:[]}};
 vm.runInNewContext(read('modules/buffs.js'),box);
 const env={on:true,rt:{char:'hero',tbuff:{step:'fa',fa:[1357],t:123}},cfg:{faBuffs:'1357',townBuffSet:'off'},FA_KNOWN:{1357:['Water']},TB_KEYS:{basic:[]},IL:{},
  faCost:()=>5,heroRole:()=> 'mage',$q:s=>s==='#l2-hud-active-buffs'?hud:s==='#fast-aden-balance'?{textContent:String(balance)}:s.startsWith('.l2-fa-buy')?b:null,
  pause:async()=>{},waitX:async f=>f(),sleep:async()=>{},rnd:()=>0,setStatus(){},rec(){},
  gameGet:async()=>({ok:true,json:async()=>({character:{name:'hero',activeBuffs:Object.entries(H).map(([id,exp])=>({skillId:+id,expiresAtMs:exp}))}})})};
 const reload=attach(env);env.fire=el=>{if(env.payments.blocked()&&!env.payments.consumePermit())return false;if(el===b){pays++;if(apply){balance-=5;H[1357]=Date.now()+3*3600000}}return true};
 return {env,B:box.L2V7Factories.buffs(env),H,reload,pays:()=>pays,apply:v=>apply=v};
}
test('FA: подтверждённый эффект удаляет только оплаченный навык из очереди',async()=>{const f=buffs();await f.B.townBuffStep();assert.equal(f.pays(),1);assert.equal(f.env.payments.blocked(),false);assert.equal(f.env.rt.actionPayments.history[0].quote.amount,5)});
test('FA: unknown после reload запрещает повтор; свежий эффект снимает блокировку',async()=>{const f=buffs();f.apply(false);await f.B.townBuffStep();assert.equal(f.pays(),1);f.reload();await f.B.townBuffStep();assert.equal(f.pays(),1);assert.ok(f.env.payments.blocked());f.H[1357]=Date.now()+3*3600000;assert.ok(await f.B.paymentReconcile());assert.equal(f.env.rt.tbuff.fa.length,0)});
test('FA: чужой действующий эффект не подтверждает оплату',async()=>{const f=buffs();f.apply(false);await f.B.townBuffStep();f.H[1413]=Date.now()+3*3600000;assert.equal(await f.B.paymentReconcile(),false)});
test('FA: поздний ответ не меняет новую очередь баффов',async()=>{const f=buffs();f.apply(false);await f.B.townBuffStep();f.env.rt.tbuff={step:'fa',fa:[1413],t:999};f.H[1357]=Date.now()+3*3600000;assert.ok(await f.B.paymentReconcile());assert.equal(f.env.rt.tbuff.fa[0],1413)});
test('FA: смена режима при durable prepare не отправляет клик',async()=>{const f=buffs();let once=true;f.env.rtCommit=async()=>{if(once){once=false;f.env.rt.manualKickAt++}return true};await f.B.townBuffStep();assert.equal(f.pays(),0)});
for(const event of ['character','lease','ownership','payment'])test(`FA: ${event} меняется во время GET — очередь баффов не перезаписывается`,async()=>{
 const f=buffs();f.apply(false);await f.B.townBuffStep();const before=JSON.stringify(f.env.rt.tbuff),char=f.env.rt.char;
 f.env.gameGet=async()=>({ok:true,json:async()=>{
  if(event==='character')f.env.rt.char='other';if(event==='lease')f.env.leaseEpoch++;if(event==='ownership')f.env.tabOwner=false;
  if(event==='payment')f.env.rt.actionPayments.pending={...f.env.rt.actionPayments.pending,id:'new-payment'};
  return {character:{name:char,activeBuffs:[{skillId:1357,expiresAtMs:Date.now()+3*3600000}]}};
 }});
 assert.equal(await f.B.paymentReconcile(),false);assert.equal(JSON.stringify(f.env.rt.tbuff),before);assert.equal(f.env.rt.actionPayments.history,undefined);
});
function raid(){
 const env={on:true,rt:{char:'hero',rbHunt:{step:'go',id:'boss',price:100},rbWant:null},setStatus(){}};attach(env);let fires=0;
 env.fire=()=>{if(env.payments.blocked()&&!env.payments.consumePermit())return false;fires++;return true};
 const source=read('modules/raid.js'),start=source.indexOf('async function rbTeleportFire('),end=source.indexOf('\nasync function paymentReconcile()',start);
 const box={env,console};vm.runInNewContext(source.slice(start,end)+'\nthis.fireTeleport=rbTeleportFire;',box);
 return {env,fire:()=>box.fireTeleport({}, {rbHunt:{...env.rt.rbHunt,step:'arrive'},rbWant:'boss'}),fires:()=>fires};
}
test('рейд: durable намерение и стадия arrive сохранены до единственного клика',async()=>{const f=raid(),steps=[];f.env.rtCommit=async()=>{steps.push(f.env.rt.rbHunt.step);return true};assert.ok(await f.fire());assert.equal(f.fires(),1);assert.deepEqual(steps,['go','arrive']);assert.ok(f.env.payments.blocked());assert.equal(await f.fire(),false);assert.equal(f.fires(),1)});
test('рейд: ошибка сохранения arrive отменяет неотправленный платёж',async()=>{const f=raid();let n=0;f.env.rtCommit=async()=>++n!==2;assert.equal(await f.fire(),false);assert.equal(f.fires(),0);assert.equal(f.env.rt.rbHunt.step,'go')});
test('рейд: наличие другого босса не подтверждает оплаченный маршрут',async()=>{
 const f=raid();await f.fire();f.env.isMap=()=>true;let rows=[{id:'other-boss'}];
 const source=read('modules/raid.js'),start=source.indexOf('async function paymentReconcile()'),end=source.indexOf('\nasync function rbGoStep()',start);
 const box={env:f.env,raidList:()=>rows};vm.runInNewContext(source.slice(start,end)+'\nthis.reconcile=paymentReconcile;',box);
 assert.equal(await box.reconcile(),false);assert.ok(f.env.payments.blocked());rows=[{id:'boss'}];assert.ok(await box.reconcile());assert.equal(f.env.payments.blocked(),false);
});

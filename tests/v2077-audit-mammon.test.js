'use strict';
// 20.76+ (ревизия 28.10, группа «mammon»):
// 1) передача предметов (саб → основной, hand:1) и прежняя отправка крафтеру: после «Считать оплату не прошедшей» квитанция ушла из ожидания,
//    а mmJob.cur (state 'sent', paymentId) оставался — mmStep каждый круг возвращал true (GET /character + «повтор запрещён»), фарм стоял до Stop.
//    Теперь задание снимается неудачей без повторной отправки.
// 2) isNear: 429/5xx/401 от GET /game/mammon/blacksmith/upgrades (или /character у торговца) считались «NPC далеко» → платный телепорт
//    500 000 адены. Теперь «далеко» — только 403 (кузнец) / известные координаты (торговец); сбой ответа — ожидание без оплаты.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const payCode=read('modules/payments.js');

// ---- 1) отправка: фикстура как в v1027-mail-unknown-payment (страница «Передача предмета» из v925-mammon-crafter) ----
const F=vm.runInNewContext(fs.readFileSync(__dirname+'/v925-mammon-crafter.test.js','utf8').split('(async () => {')[0]+'\n({mk,transferPage});',{require,console,__dirname});
function sendFixture(job){const T=F.transferPage();let count=0,inv=0;const f=F.mk({inv:{1869:115},pn:'/item-transfer.html',doc:T.doc,click:b=>{if(b===T.ok)count++;else T.click(b)},cfg:{mmCraftNote:false}});
 Object.assign(f.env,{on:true,tabOwner:true,leaseEpoch:1,rtCommit:async()=>true});Object.assign(f.env.rt,{char:'Hero',manualKickAt:0,mmJob:job});
 const set=f.env.setRt;f.env.setRt=async p=>{await set(p);return{ok:true}};const get=f.env.gameGet;f.sent=[];
 const ref=f.env.invRefresh;f.env.invRefresh=async()=>{inv++;return ref()};
 f.env.gameGet=async p=>p==='/character'?{ok:true,json:async()=>({character:{name:'Hero',id:'hero',revision:f.revision||10,inventory:{stacks:[{itemId:1869,qty:f.bag[1869]}]}}})}:p==='/game/mail/sent?page=1'?{ok:true,json:async()=>({items:f.sent})}:get(p);
 const box={};vm.runInNewContext(payCode,box);f.env.payments=box.L2V7Factories.payments(f.env);
 // как фон paymentDismissChange: ожидание → история «не прошла (решение игрока)», mmJob не трогается
 f.dismiss=()=>{const ap=f.env.rt.actionPayments||{},p=ap.pending;assert.ok(p,'перед снятием должна быть неподтверждённая оплата');
  f.env.rt.actionPayments={...ap,pending:null,history:[{...p,phase:'dismissed',confirmedAt:Date.now(),confirmation:{kind:'player-dismissed',spent:0}},...(ap.history||[])]};};
 return Object.assign(f,{count:()=>count,invCalls:()=>inv});
}
const handJob=()=>({kind:'send',cmd:true,hand:1,to:'Skye',step:'act',items:[[1869,15,'Iron Ore']],ret:{},retDone:true,note:null,t:Date.now()});

test('передача основному: после «Считать оплату не прошедшей» задание снимается, повторной отправки нет',async()=>{
 const f=sendFixture(handJob());
 assert.equal(await f.M.mmStep(),true);assert.equal(f.count(),1);const p=f.env.payments.pending();assert.ok(p);
 assert.equal(f.env.rt.mmJob.cur.state,'sent');assert.equal(f.env.rt.mmJob.cur.paymentId,p.id);
 assert.equal(await f.M.paymentReconcile(),false);assert.ok(f.env.payments.pending(),'сумка не изменилась — исход неизвестен');
 assert.equal(await f.M.mmStep(),true);assert.equal(f.env.rt.mmJob?.cur?.paymentId,p.id,'пока оплата ждёт — задание ждёт');
 f.dismiss();const inv0=f.invCalls();
 await f.M.mmStep();
 assert.equal(f.env.rt.mmJob,null,'задание с закрытой квитанцией не держит главный цикл');
 assert.equal(f.env.rt.mmLog[0].ok,false);assert.match(f.env.rt.mmLog[0].why,/закрыт без подтверждения/);
 assert.equal(f.count(),1,'повторного «Підтвердити» нет');assert.equal(f.invCalls(),inv0,'на закрытой квитанции GET /character не шлём');
 assert.equal(f.env.payments.pending(),null);
});
test('передача основному: старое задание с закрытой квитанцией не возвращается следующими кругами',async()=>{
 const f=sendFixture(handJob());await f.M.mmStep();f.dismiss();
 await f.M.mmStep();assert.equal(f.env.rt.mmJob,null);
 for(let i=0;i<5;i++)await f.M.mmStep();
 assert.equal(f.count(),1);assert.equal(f.env.rt.mmJob?.kind==='send'&&f.env.rt.mmJob?.cur?true:false,false);
});
test('прежняя отправка крафтеру (без hand): после снятия оплаты mmStep снимает задание и отдаёт цикл',async()=>{
 const job={kind:'send',to:'Skye',step:'act',items:[[1869,15,'Iron Ore']],t:Date.now()};const f=sendFixture(job);
 await f.M.sendStep(f.env.rt.mmJob);assert.equal(f.count(),1);const p=f.env.payments.pending();assert.ok(p);assert.equal(f.env.rt.mmJob.cur.paymentId,p.id);
 assert.equal(await f.M.mmStep(),true,'оплата ждёт — задание держится');assert.ok(f.env.rt.mmJob);
 f.dismiss();
 assert.equal(await f.M.mmStep(),false);assert.equal(f.env.rt.mmJob,null);assert.equal(f.count(),1);
 assert.ok(f.recs.some(r=>/исход закрыт без подтверждения/.test(r)));
});
test('прежняя отправка крафтеру: cur без квитанции (legacy) по-прежнему ждёт сверки',async()=>{
 const f=sendFixture({kind:'send',to:'Skye',step:'act',items:[[1869,15,'Iron Ore']],t:Date.now(),cur:{id:1869,nm:'Iron Ore',q:15,before:115,t:1}});
 assert.equal(await f.M.mmStep(),true);assert.ok(f.env.rt.mmJob.cur);assert.equal(f.count(),0);
});

// ---- 2) isNear: фикстура как в v2012-pay-mammon (настоящий payments.js), страница телепорта к NPC ----
function nearFixture(kind){
 const now=Date.now();const loc={pathname:kind==='smith'?'/mammon-blacksmith-loc.html':'/mammon-merchant-loc.html',search:'',href:''},events=[];
 const box={Date,console,URLSearchParams,Math,JSON,sessionStorage:{getItem:()=>null,setItem(){}},location:loc,document:{documentElement:{dataset:{}},querySelectorAll:()=>[],querySelector:()=>null,getElementById:()=>null}};
 vm.runInNewContext(payCode,box);
 const st={ups:200,char:200,hero:{x:0,y:0},npc:{x:50000,y:50000}},gets=[];let fired=0;
 const btn={disabled:false},cost={textContent:'500000'};
 const env={rt:{char:'Tank',manualKickAt:0},cfg:{},on:true,tabOwner:true,leaseEpoch:3,autonomyMode:()=> 'farm',canRun:()=>true,ITEMS:{},FARM:{res:{}},
  isBattle:()=>false,fishNow:()=>false,rec:(...a)=>events.push(a.join(' ')),setStatus:s=>events.push(s),sleep:async()=>{},waitX:async f=>f(),
  $q:s=>s==='#mammon-loc-teleport-btn'?btn:s==='#mammon-loc-cost'?cost:null,fire:()=>{fired++;return true},
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,
  gameGet:async p=>{gets.push(p);
   if(p==='/game/mammon/blacksmith/upgrades')return {ok:st.ups===200,status:st.ups,json:async()=>(st.ups===200?{items:[]}:{error:st.ups===403?'mammon_blacksmith_not_nearby':'x'})};
   if(p==='/character')return {ok:st.char===200,status:st.char,json:async()=>(st.char===200?{character:{name:'Tank',id:'tank',revision:9,adena:1000000,worldX:st.hero.x,worldY:st.hero.y}}:{})};
   if(p==='/game/mammon/merchant')return {ok:true,status:200,json:async()=>({mammonMerchant:{current:{id:'m1',worldX:st.npc.x,worldY:st.npc.y}},teleport:{adenaCost:500000}})};
   if(p==='/game/mammon/blacksmith')return {ok:true,status:200,json:async()=>({mammonBlacksmith:{current:{id:'b1',worldX:st.npc.x,worldY:st.npc.y}},teleport:{adenaCost:500000}})};
   return {ok:false,status:404,json:async()=>({})};}};
 env.payments=box.L2V7Factories.payments(env);vm.runInNewContext(read('modules/mammon.js'),box);const M=box.L2V7Factories.mammon(env);
 env.rt.mmJob={kind,step:'go',why:'тест',home:null,t:now,context:{char:'Tank',kick:0,mode:'farm'}};
 const paid=()=>!!(env.rt.actionPayments?.pending||(env.rt.actionPayments?.history||[]).length);
 return {env,M,loc,st,gets,events,paid,fired:()=>fired};
}
for(const status of [429,502,401])test(`кузнец: GET /upgrades ${status} — не «далеко», телепорт за 500 000 адены не оплачивается`,async()=>{
 const f=nearFixture('smith');f.st.ups=status;
 assert.equal(await f.M.isNear('smith'),null);
 for(let i=0;i<3;i++)assert.equal(await f.M.mmStep(),true);
 assert.equal(f.paid(),false,'платёж не подготовлен');assert.equal(f.fired(),0,'кнопка телепорта не нажата');
 assert.equal(f.env.rt.mmJob.step,'go');assert.ok(f.events.some(e=>/телепорт не оплачиваю/.test(e)));
});
test('кузнец: 403 mammon_blacksmith_not_nearby — телепорт по-прежнему работает',async()=>{
 const f=nearFixture('smith');f.st.ups=403;
 assert.equal(await f.M.isNear('smith'),false);
 assert.equal(await f.M.mmStep(),true);
 assert.ok(f.env.rt.actionPayments?.pending,'платёж телепорта подготовлен');assert.equal(f.env.rt.actionPayments.pending.quote.amount,500000);assert.equal(f.fired(),1);
});
test('кузнец: 200 — рядом, шаг act без телепорта',async()=>{
 const f=nearFixture('smith');assert.equal(await f.M.isNear('smith'),true);
 await f.M.mmStep();assert.equal(f.env.rt.mmJob.step,'act');assert.equal(f.paid(),false);assert.equal(f.fired(),0);
});
test('торговец: GET /character 429 — положение неизвестно, телепорт не оплачивается',async()=>{
 const f=nearFixture('order');f.st.char=429;
 assert.equal(await f.M.isNear('order'),null);
 for(let i=0;i<3;i++)assert.equal(await f.M.mmStep(),true);
 assert.equal(f.paid(),false);assert.equal(f.fired(),0);assert.equal(f.env.rt.mmJob.step,'go');
});
test('торговец: координаты известны и далеко — телепорт, рядом — act',async()=>{
 const far=nearFixture('order');assert.equal(await far.M.isNear('order'),false);await far.M.mmStep();assert.ok(far.env.rt.actionPayments?.pending);assert.equal(far.fired(),1);
 const near=nearFixture('order');near.st.npc={x:100,y:100};assert.equal(await near.M.isNear('order'),true);await near.M.mmStep();assert.equal(near.env.rt.mmJob.step,'act');assert.equal(near.paid(),false);
});
test('телепорт уже оплачен: сбой проверки положения не подтверждает и не снимает ожидание',async()=>{
 const f=nearFixture('smith');f.st.ups=403;await f.M.mmStep();const p=f.env.rt.actionPayments.pending;assert.ok(p);
 f.st.ups=502;assert.equal(await f.M.mmStep(),true);assert.equal(f.env.rt.actionPayments.pending?.id,p.id);assert.equal(f.fired(),1);
});

'use strict';
// 22.10: настоящие планировщик и runtime, отдельная модель revision/сумки и durable storage, без игры.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(f,'utf8'),runtime=read(process.env.CRAFT_SOURCE||path.join(__dirname,'../modules/craft.js')),
 planner=read(process.env.CRAFT_PLAN_SOURCE||path.join(__dirname,'../craft-plan.js'));
const copy=x=>structuredClone(x),never=()=>new Promise(()=>{}),turn=()=>new Promise(r=>setImmediate(r));
const waitFor=async f=>{for(let i=0;i<40&&!f();i++)await turn();assert.ok(f(),'достигнут ожидаемый этап');};
function world(options={}){
 const recipes=[
  {code:'cokes',output:{itemId:100,nameEn:'Cokes',quantity:options.cokesOutput||1},ingredients:[{itemId:1,nameEn:'Coal',quantity:1},{itemId:2,nameEn:'Charcoal',quantity:1}],createItemLevel:1,mpCost:10,successChance:100},
  {code:'synth',output:{itemId:101,nameEn:'Synthetic Cokes',quantity:1},ingredients:[{itemId:100,nameEn:'Cokes',quantity:3},{itemId:3,nameEn:'Ore',quantity:1}],createItemLevel:2,mpCost:20,successChance:100},
  {code:'ori',output:{itemId:102,nameEn:'Oriharukon',quantity:1},ingredients:[{itemId:101,nameEn:'Synthetic Cokes',quantity:1},{itemId:3,nameEn:'Ore',quantity:4},{itemId:4,nameEn:'Silver',quantity:12}],createItemLevel:4,mpCost:40,successChance:100}
 ];
 const w={now:1792671000000,posts:[],notes:[],alerts:[],clears:[],ss:new Map(),crafted:[],pots:0,
  disk:{char:'Crafter',classCur:{prof:'dwarf_maestro',slot:2},craftQueue:options.queue||[{id:'goal',code:'ori',n:2}]},
  hero:{name:'Crafter',revision:100,l2Profession:'dwarf_maestro',classSlots:{activeSlot:2},mp:options.mp??500,maxMp:1000,
   inventory:{stacks:Object.entries({1:6,2:6,3:10,4:24,100:0,101:0,102:0,728:3,...options.bag}).map(([itemId,qty])=>({itemId:+itemId,qty}))}},recipes};
 w.qty=id=>w.hero.inventory.stacks.find(x=>x.itemId===id)?.qty||0;
 w.setQty=(id,n)=>{let x=w.hero.inventory.stacks.find(x=>x.itemId===id);if(!x)w.hero.inventory.stacks.push(x={itemId:id,qty:0});x.qty=n;};
 w.book=()=>({canCraftProfession:true,createItemLevel:9,currentMp:w.hero.mp,maxMp:w.hero.maxMp,recipes:w.recipes.map(r=>({...copy(r),lockedReason:null,
  ingredients:r.ingredients.map(i=>({...i,have:w.qty(i.itemId)})),maxCraftable:Math.min(...r.ingredients.map(i=>Math.floor(w.qty(i.itemId)/i.quantity)),r.mpCost>0?Math.floor(w.hero.mp/r.mpCost):1000)}))});
 w.apply=(url,b)=>{
  if(b.expectedRevision!==w.hero.revision)return {ok:false,status:409,json:async()=>({})};
  if(url==='/character/consumable/use'){assert.equal(b.itemId,728);assert.equal(b.quantity,1);assert.ok(w.qty(728)>0);w.setQty(728,w.qty(728)-1);w.hero.mp=Math.min(1000,w.hero.mp+500);w.pots++;}
  else{assert.equal(url,'/game/craft/materials');const r=w.recipes.find(r=>r.code===b.recipeCode);assert.ok(r);assert.ok(w.hero.mp>=r.mpCost*b.craftCount);
   for(const i of r.ingredients){assert.ok(w.qty(i.itemId)>=i.quantity*b.craftCount);w.setQty(i.itemId,w.qty(i.itemId)-i.quantity*b.craftCount);}
   w.hero.mp-=r.mpCost*b.craftCount;w.setQty(r.output.itemId,w.qty(r.output.itemId)+r.output.quantity*b.craftCount);w.crafted.push([r.code,b.craftCount]);}
  w.hero.revision++;return {ok:true,status:200,json:async()=>({character:copy(w.hero)})};
 };
 w.reload=(hooks={})=>{
  class Clock extends Date{static now(){return w.now;}}
  const box={Date:Clock,sessionStorage:{getItem:k=>w.ss.get(k),setItem:(k,v)=>w.ss.set(k,v)}};vm.runInNewContext(planner,box);vm.runInNewContext(runtime,box);
  const e={cfg:{craftMode:true,craftAuto:false,craftChain:true,craftNotify:true,craftMpPots:true,...hooks.cfg},rt:copy(w.disk),on:true,tabOwner:true,leaseEpoch:1,gen:1,currentMode:'craft',
   mode:()=>e.currentMode,role:()=> 'crafter',actionGeneration:()=>e.gen,isBattle:()=>false,busy:()=>false,canAct:()=>true,free:()=>true,plan:box.L2CraftPlan.plan,
   rec:(...args)=>w.notes.push(args.join(' ')),notify:(...args)=>w.alerts.push(args),clearAlert:id=>w.clears.push(id),invRefresh:async()=>({}),
   setRt:async patch=>{Object.assign(e.rt,copy(patch));const r=hooks.save?await hooks.save(patch,e,w):{ok:true};if(r?.ok===true)Object.assign(w.disk,copy(patch));return r;},
   gameGet:async url=>{if(hooks.get)await hooks.get(url,e,w);return {ok:true,status:200,json:async()=>url==='/character'?{character:copy(w.hero)}:w.book()};},
   gamePost:async(url,body)=>{w.posts.push({url,body:copy(body)});return hooks.post?hooks.post(url,body,e,w):w.apply(url,body);}};
  return {e,C:box.L2V7Factories.craft(e)};
 };
 return w;
}
async function tick(w,a,ms=2000){w.now+=ms;return a.C.step();}
async function finish(w,a,n=8){for(let i=0;i<n;i++)await tick(w,a);}

test('полная цель: Cokes → Synthetic Cokes → Oriharukon, промежуточное не увеличивает progress',async()=>{
 const w=world(),a=w.reload();await a.C.step();assert.deepEqual(w.crafted,[['cokes',6]]);assert.equal(w.disk.craftMade?.goal,undefined);
 await tick(w,a);assert.deepEqual(w.crafted,[['cokes',6],['synth',2]]);assert.equal(w.disk.craftMade?.goal,undefined);
 await tick(w,a);await tick(w,a);assert.equal(w.disk.craftMade.goal,2);assert.equal(w.qty(102),2);assert.equal(w.posts.length,3);assert.equal(w.disk.craftStat.cokes,6);assert.equal(w.disk.craftStat.synth,2);
 assert.match(w.disk.craftSay.why,/завершена/);assert.equal(w.disk.craftPlan.goals[0].status,'done');
});
test('готовые промежуточные уменьшают цепочку, готовая цель в сумке не подменяет новый заказ',async()=>{
 const w=world({bag:{100:3,101:1,102:50}}),a=w.reload();await finish(w,a);assert.deepEqual(w.crafted,[['synth',1],['ori',2]]);
 assert.equal(w.qty(102),52);assert.equal(w.disk.craftMade.goal,2);
});
test('несколько штук на выходе: округление промежуточных партий не зачисляется конечной цели',async()=>{
 const w=world({cokesOutput:3}),a=w.reload();await finish(w,a);assert.deepEqual(w.crafted,[['cokes',2],['synth',2],['ori',2]]);assert.equal(w.disk.craftMade.goal,2);assert.equal(w.disk.craftStat.cokes,6);
});
test('не хватает сырья для всей цели: точный дефицит и0POST, даже если первый промежуточный сделать можно',async()=>{
 const w=world({bag:{4:23}}),a=w.reload();await a.C.step();assert.equal(w.posts.length,0);assert.equal(w.alerts.length,1);
 assert.match(w.alerts[0][2],/Silver: не хватает 1 \(нужно 24, есть 23\)/);assert.equal(w.disk.craftPlan.missing[0].missing,1);assert.match(w.disk.craftSay.why,/Не хватает сырья/);
});
test('другая полностью обеспеченная цель выполняется, заблокированная цепочка ничего не тратит',async()=>{
 const w=world({bag:{4:0},queue:[{id:'bad',code:'ori',n:2},{id:'good',code:'cokes',n:1}]}),a=w.reload();await a.C.step();assert.deepEqual(w.crafted,[['cokes',1]]);assert.equal(w.disk.craftMade.good,1);assert.equal(w.disk.craftMade.bad,undefined);assert.equal(w.alerts.length,1);
});
test('craftChain=false: сообщает о прямом недостающем материале и не запускает producers',async()=>{
 const w=world(),a=w.reload({cfg:{craftChain:false}});await a.C.step();assert.equal(w.posts.length,0);assert.match(w.alerts[0][2],/Synthetic Cokes/);assert.equal(w.disk.craftPlan.steps.length,0);
});
test('одинаковый дефицит не повторяет уведомление через reload и десять минут',async()=>{
 const w=world({bag:{4:0}}),a=w.reload();await a.C.step();w.now+=65000;await w.reload().C.step();w.now+=700000;await w.reload().C.step();assert.equal(w.alerts.length,1);
});
test('изменённый дефицит имеет cooldown, новая очередь уведомляет сразу',async()=>{
 const w=world({bag:{4:0}}),a=w.reload();await a.C.step();w.setQty(4,1);await tick(w,a,65000);assert.equal(w.alerts.length,1);
 await tick(w,a,700000);assert.equal(w.alerts.length,2);a.e.rt.craftQueue=[{id:'new',code:'ori',n:3}];await tick(w,a,1);assert.equal(w.alerts.length,3);
});
test('сырьё появилось: уведомление очищается, цепочка продолжает работу',async()=>{
 const w=world({bag:{4:0}}),a=w.reload();await a.C.step();w.setQty(4,24);await tick(w,a,65000);assert.deepEqual(w.clears,['craft-missing']);assert.equal(w.disk.craftShortageNote,null);assert.deepEqual(w.crafted,[['cokes',6]]);
});
test('выключенное оповещение и удалённая очередь очищают старый alert без POST',async()=>{
 for(const mutate of [e=>{e.cfg.craftNotify=false;},e=>{e.rt.craftQueue=[];}]){const w=world({bag:{4:0}}),a=w.reload();await a.C.step();mutate(a.e);await tick(w,a,1);assert.equal(w.alerts.length,1);assert.equal(w.clears.length,1);assert.equal(w.disk.craftShortageNote,null);assert.equal(w.posts.length,0);}
});
test('изменение режима очищает прежний alert даже при выключенном фоновом крафте',async()=>{
 const w=world({bag:{4:0}}),a=w.reload();await a.C.step();a.e.currentMode='farm';await tick(w,a);assert.equal(w.clears.length,1);assert.equal(w.disk.craftShortageNote,null);
});
test('нет ACK уведомления: расход закрыт, reload завершает outbox и уведомляет один раз',async()=>{
 const w=world({bag:{4:0}}),a=w.reload({save:p=>p.craftShortageNote?{ok:false}:{ok:true}});await a.C.step();assert.equal(w.alerts.length,0);assert.equal(w.posts.length,0);
 const b=w.reload();await tick(w,b);assert.equal(w.alerts.length,1);assert.equal(w.disk.craftShortageNote.notified,true);
});
test('reload после принятого промежуточного без ответа зачисляет только intermediate и продолжает цепочку',async()=>{
 const w=world(),a=w.reload({post:(url,b)=>{w.apply(url,b);return never();}});void a.C.step();await waitFor(()=>w.posts.length===1);assert.equal(w.disk.craftPending.intermediate,true);assert.equal(w.disk.craftPending.rootCode,'ori');
 w.now+=20000;const b=w.reload();await b.C.step();assert.equal(w.posts.length,1);assert.equal(w.disk.craftMade?.goal,undefined);assert.equal(w.disk.craftStat.cokes,6);await finish(w,b);assert.equal(w.disk.craftMade.goal,2);assert.equal(w.posts.filter(p=>p.body.recipeCode==='cokes').length,1);
});
test('unknown intermediate с прежней revision повторяет тот же запрос без лишнего target credit',async()=>{
 const w=world(),a=w.reload({post:()=>{throw Error('network');}});await a.C.step();w.now+=20000;const b=w.reload();await b.C.step();assert.deepEqual(w.posts[0],w.posts[1]);assert.equal(w.disk.craftMade?.goal,undefined);await finish(w,b);assert.equal(w.disk.craftMade.goal,2);
});
test('удаление цели до intermediatePOST освобождает известное несостоявшееся намерение',async()=>{
 const w=world(),a=w.reload({save:(p,e)=>{if(p.craftPending){e.rt.craftQueue=[];w.disk.craftQueue=[];}return {ok:true};}});await a.C.step();assert.equal(w.posts.length,0);assert.equal(w.disk.craftPending,null);
});
test('выключение цепочки во время ACK intermediate отменяет POST',async()=>{
 const w=world(),a=w.reload({save:(p,e)=>{if(p.craftPending)e.cfg.craftChain=false;return {ok:true};}});await a.C.step();assert.equal(w.posts.length,0);assert.equal(w.disk.craftPending,null);
});
for(const [label,mutate]of [['Stop',e=>e.on=false],['владелец',e=>e.tabOwner=false],['режим',e=>e.currentMode='farm'],['класс',e=>e.rt.classCur.slot=3]])test(label+' между книгой и свежим героем отменяет расход',async()=>{
 const w=world(),a=w.reload({get:(url,e)=>{if(url==='/character')mutate(e);}});await a.C.step();assert.equal(w.posts.length,0);
});
test('MP0 цепочка: одна банка, reload после неизвестного ответа не пьёт вторую',async()=>{
 const w=world({mp:0}),a=w.reload({post:(url,b)=>{w.apply(url,b);return never();}});void a.C.step();await waitFor(()=>w.posts.length===1);assert.equal(w.posts[0].url,'/character/consumable/use');assert.equal(w.disk.craftMpPending.rootCode,'ori');
 w.now+=20000;const b=w.reload();await b.C.step();await finish(w,b);assert.equal(w.pots,1);assert.equal(w.disk.craftMade.goal,2);assert.equal(w.qty(102),2);
});
test('дальнее сырьё цепочки ушло перед свежим GET для банки: банка не расходуется',async()=>{
 let reads=0;const w=world({mp:0}),a=w.reload({get:url=>{if(url==='/character'&&++reads===2){w.setQty(4,0);w.hero.revision++;}}});await a.C.step();assert.equal(w.posts.length,0);assert.equal(w.pots,0);assert.match(w.disk.craftSay.why,/Цепочка/);
});
test('same-revision retry банки не отправляется без сырья дальней части цепочки',async()=>{
 const w=world({mp:0}),a=w.reload({post:()=>{throw Error('network');}});await a.C.step();w.setQty(4,0);w.now+=20000;await w.reload().C.step();assert.equal(w.posts.length,1);assert.ok(w.disk.craftMpPending);assert.match(w.disk.craftSay.why,/цепочка/);
});
test('чужая свежая профессия, слот или имя закрывают цепочку до расхода',async()=>{
 for(const delta of [{name:'Other'},{l2Profession:'human_warlord'},{classSlots:{activeSlot:3}}]){const w=world(),a=w.reload({get:url=>{if(url==='/character')Object.assign(w.hero,delta);}});await a.C.step();assert.equal(w.posts.length,0);}
});
test('бесплатный рецепт при MP0 не тратит банку',async()=>{
 const w=world({mp:0,queue:[{id:'one',code:'cokes',n:1}]});w.recipes[0].mpCost=0;const a=w.reload();await a.C.step();assert.equal(w.pots,0);assert.deepEqual(w.crafted,[['cokes',1]]);
});

test('wake после явной свежей сверки снимает только паузу ожидания',async()=>{
 const w=world({bag:{4:0}}),a=w.reload();await a.C.step();w.setQty(4,24);a.C.wake();await tick(w,a,1);assert.deepEqual(w.crafted,[['cokes',6]]);
});
test('noticeSync очищает только старое оповещение, не создаёт новое без свежего плана',async()=>{
 const w=world({bag:{4:0}}),a=w.reload();await a.C.noticeSync();assert.equal(w.alerts.length,0);await a.C.step();a.e.cfg.craftNotify=false;await a.C.noticeSync();assert.equal(w.clears.length,1);assert.equal(w.disk.craftShortageNote,null);
});
test('известная устаревшая причина нехватки сырья не скрывает MP0 после свежего сырья',async()=>{
 const w=world({mp:0});const original=w.book;w.book=()=>{const b=original();b.recipes[0].lockedReason='Недостаточно материалов';return b;};const a=w.reload();await a.C.step();assert.equal(w.pots,1);
});

test('появившийся готовый промежуточный материал отменяет ненужную банку и быстро пересчитывает следующий шаг',async()=>{
 let reads=0;const w=world({mp:0}),a=w.reload({get:url=>{if(url==='/character'&&++reads===2){w.setQty(100,6);w.hero.revision++;}}});await a.C.step();assert.equal(w.pots,0);assert.equal(w.posts.length,0);assert.match(w.disk.craftSay.why,/Цепочка.*изменилась/);
 await tick(w,a,2000);assert.equal(w.pots,1);assert.equal(w.disk.craftMpPending,null);await finish(w,a);assert.equal(w.disk.craftMade.goal,2);assert.equal(w.posts.some(p=>p.body.recipeCode==='cokes'),false);
});
test('свежая смена класса перед банкой не расходует MP-предмет по прежней книге',async()=>{
 for(const delta of [{l2Profession:'human_warlord'},{classSlots:{activeSlot:3}}]){let reads=0;const w=world({mp:0}),a=w.reload({get:url=>{if(url==='/character'&&++reads===2)Object.assign(w.hero,delta);}});await a.C.step();assert.equal(w.posts.length,0);assert.equal(w.pots,0);}
});

test('неподтверждённое удаление note не очищает OSalert и не открывает новый расход',async()=>{
 const w=world({bag:{4:0}}),a=w.reload({save:p=>p.craftShortageNote===null?{ok:false}:{ok:true}});await a.C.step();assert.equal(w.alerts.length,1);
 w.setQty(4,24);await tick(w,a,65000);assert.equal(w.clears.length,0);assert.equal(w.posts.length,0);assert.equal(a.e.rt.craftShortageNote,null);assert.equal(w.disk.craftShortageNote.notified,true);
 w.setQty(4,0);w.now+=65000;await w.reload().C.step();assert.equal(w.alerts.length,1,'прежний OSalert остаётся виден, durable dedup его не теряет');assert.equal(w.clears.length,0);
});
test('ACK повтора удаления note очищает OSalert до nextT и следующая нехватка снова уведомляет',async()=>{
 let allow=false;const w=world({bag:{4:0}}),a=w.reload({save:p=>p.craftShortageNote===null&&!allow?{ok:false}:{ok:true}});await a.C.step();
 a.e.cfg.craftNotify=false;await a.C.noticeSync();assert.equal(w.clears.length,0);assert.equal(w.disk.craftShortageNote.notified,true);
 allow=true;await a.C.noticeSync();assert.deepEqual(w.clears,['craft-missing']);assert.equal(w.disk.craftShortageNote,null);
 a.e.cfg.craftNotify=true;await tick(w,a,65000);assert.equal(w.alerts.length,2);assert.equal(w.clears.length,1);
});
test('очистка note не затирает неподтверждённый результат MP-банки',async()=>{
 let allow=false;const w=world({mp:0}),a=w.reload({save:p=>p.craftMpPending===null&&p.craftMpUsed&&!allow?{ok:false}:{ok:true}});
 await a.C.step();assert.equal(w.pots,1);assert.ok(w.disk.craftMpPending);a.e.rt.craftShortageNote={signature:'old',notified:true};w.disk.craftShortageNote=copy(a.e.rt.craftShortageNote);a.e.cfg.craftNotify=false;
 await a.C.noticeSync();assert.ok(w.disk.craftMpPending);assert.equal(w.clears.length,0);assert.equal(w.posts.length,1);
 allow=true;await a.C.noticeSync();assert.equal(w.disk.craftMpPending,null);assert.equal(w.disk.craftMpUsed,1);assert.equal(w.disk.craftShortageNote,null);assert.deepEqual(w.clears,['craft-missing']);
});

test('чистая metadata-clear переживает gen/режим/класс/kick при прежнем char и lease',async()=>{
 let allow=false;const w=world({bag:{4:0}}),a=w.reload({save:p=>p.craftShortageNote===null&&!allow?{ok:false}:{ok:true}});await a.C.step();
 a.e.cfg.craftNotify=false;await a.C.noticeSync();assert.equal(w.clears.length,0);assert.equal(a.e.rt.craftShortageNote,null);assert.equal(w.disk.craftShortageNote.notified,true);
 a.e.gen++;a.e.currentMode='fish';a.e.rt.classCur.slot++;a.e.rt.manualKickAt=123;allow=true;await a.C.noticeSync();
 assert.deepEqual(w.clears,['craft-missing']);assert.equal(w.disk.craftShortageNote,null);assert.equal(w.posts.length,0);
});
test('metadata-clear не переносится на другой lease или другого персонажа',async()=>{
 for(const mutate of [e=>{e.leaseEpoch++;},e=>{e.rt.char='Other';}]){
  let allow=false;const w=world({bag:{4:0}}),a=w.reload({save:p=>p.craftShortageNote===null&&!allow?{ok:false}:{ok:true}});await a.C.step();
  a.e.cfg.craftNotify=false;await a.C.noticeSync();mutate(a.e);allow=true;await a.C.noticeSync();
  assert.equal(w.clears.length,0);assert.equal(w.disk.craftShortageNote.notified,true);assert.equal(w.posts.length,0);
 }
});

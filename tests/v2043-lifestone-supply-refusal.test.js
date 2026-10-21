'use strict';
// 20.43 (разбор 21.10): авто-ЛС докупает Gemstone через тот же /game/drops-shop/buy, где 20.10 22:03 пришёл HTTP 500
// {"message":"inventory_full"} (сумка 214 видов, Кристал C в 20.41). Свой список 4xx у ЛС этот ответ не знал: покупка висела
// «неизвестной», сверка ждала новую ревизию (а при отказе она прежняя), «Закрыть»/«Учесть» запрещены — бот стоял целиком.
// Теперь точный код отказа + свежий GET с той же ревизией и прежними остатками = покупки не было: резерв снят, пауза, удержание снято.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=n=>fs.readFileSync(n==='modules/lifestone.js'&&process.env.LS_MODULE_SOURCE||__dirname+'/../'+n,'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
const LS=10412,GEM=2134,AA_PRICE=160000,ADENA_PRICE=100000;
const FULL={statusCode:500,error:'Internal Server Error',message:'inventory_full'};
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
function fixture({ls=0,gem=0,limit=3,near=true,payments=true}={}){
 let time=100000,module,reply=null,getFail=null;
 const posts=[],gets=[],recs=[];
 const snap={name:'Hero',revision:10,adena:'50000000',worldX:near?114496:0,worldY:near?132416:0,inventory:{eq:{l1:{itemId:9002284,enchant:25,clanWeaponUid:'w'}},
  stacks:[{itemId:LS,qty:ls},{itemId:GEM,qty:gem},{itemId:5575,qty:5000000},{itemId:4037,qty:14},{itemId:920048,qty:9}]}};
 const lsShop={categories:[{categoryId:'life_stones',items:[{categoryId:'life_stones',itemKey:'s',itemId:LS,aaPrice:AA_PRICE}]}]};
 const gmShop={grades:[{grade:'S',sections:[{category:'consumable',items:[{category:'consumable',grade:'S',itemId:GEM,shopKey:'consumable/resource_gemstone_s',consumableSubtype:'resources',purchasable:true,priceAdena:ADENA_PRICE,priceCoinOfLuck:null}]}]}]};
 const merchant={mammonMerchant:{current:{id:'necropolis',worldX:114496,worldY:132416}},teleport:{adenaCost:0}};
 const change=(id,n)=>{const r=snap.inventory.stacks.find(x=>x.itemId===id);r.qty+=n;};
 const applied=(path,body)=>{
  if(path==='/game/mammon/teleport'){snap.worldX=114496;snap.worldY=132416;}
  else if(path==='/game/mammon/merchant/buy'){change(LS,body.qty);change(5575,-AA_PRICE*body.qty);}
  else if(path==='/game/drops-shop/buy'){change(GEM,body.qty);snap.adena=String(+snap.adena-ADENA_PRICE*body.qty);}
  else {change(LS,-1);change(GEM,-1);snap.inventory.eq.l1.augmentation={uid:'aug-'+snap.revision,outcomeId:'matk_6',grade:'S'};}
  snap.revision++;
 };
 const env={cfg:{autoLs:{targets:['matk_6'],maxAttempts:limit},shopReserve:200000,mmTpMax:500000},rt:{char:'Hero',manualKickAt:1},on:true,tabOwner:true,
  canPrepare:()=>true,canRun:()=>true,context:()=>'ctx',rec:(...a)=>recs.push(a.slice(2).join(' ')),setStatus:()=>{},
  setRt:async p=>{Object.assign(env.rt,clone(p));return {ok:true}},
  gameGet:async path=>{gets.push(path);if(getFail?.(path))throw Error('offline');
   const data=path==='/character'?{character:snap}:path==='/character/catalog-hints'?{itemGradeHints:{9002284:'S'},itemSlotHints:{9002284:'rhand'}}:path==='/game/mammon/merchant/shop'?lsShop:path==='/game/drops-shop'?gmShop:path==='/game/mammon/merchant'?merchant:{};
   return {ok:true,status:200,json:async()=>clone(data)};},
  gamePost:async(path,body,ms,id)=>{
   // Как настоящий gamePost: ЛС держит бота, пропускается только запрос с одноразовым разрешением.
   assert.equal(path==='/character/weapon-augmentation'?module.consumePermit(id,body):module.consumeSupplyPermit(id,path,body),true);
   posts.push({path,body:clone(body)});
   const r=reply?.(path,body);if(r)return r;
   applied(path,body);return {ok:true,status:200,json:async()=>({character:clone(snap),outcomeId:'matk_6',gemstonesSpent:1})};
  }};
 const box={console,Date:{now:()=>time},setTimeout,clearTimeout};vm.createContext(box);
 vm.runInContext(read('augment.js'),box);if(payments)vm.runInContext(read('modules/payments.js'),box);vm.runInContext(read('modules/lifestone.js'),box);
 module=box.L2V7Factories.lifestone(env);
 return {env,snap,posts,gets,recs,change,applied,get m(){return module},reload:()=>module=box.L2V7Factories.lifestone(env),
  reply:fn=>reply=fn,getFail:fn=>getFail=fn,advance:(ms=16000)=>time+=ms,start:async()=>{await module.command('prepare');await module.command('resume');},
  get s(){return env.rt.autoLs}};
}
const refuse=(body=FULL,status=500)=>()=>({ok:false,status,json:async()=>clone(body)});

test('Gemstone: 500 inventory_full при той же ревизии — отказ, резерв снят, пауза с причиной, удержание снято',async()=>{
 const h=fixture({ls:3});await h.start();h.reply(refuse());
 const before=h.gets.length;await h.m.step();await flush();
 assert.equal(h.posts.length,1);assert.equal(h.posts[0].path,'/game/drops-shop/buy');assert.equal(h.posts[0].body.qty,3);
 assert.ok(h.gets.slice(before).includes('/character'),'свежий GET после отказа');
 assert.equal(h.s.pending,null);assert.equal(h.s.reservedAdena,0);assert.equal(h.s.spentAdena,0);assert.equal(h.s.attempts,0);
 assert.equal(h.s.status,'paused');assert.equal(h.s.hold,false);assert.match(h.s.reason,/сумка полна/);
 assert.equal(h.s.supplies[0].status,'rejected');assert.equal(h.s.supplies[0].code,'inventory_full');assert.equal(h.s.supplies[0].qty,0);
 assert.ok(h.recs.some(x=>/Gemstone S ×3: сумка полна.*inventory_full.*покупки не было.*возвращаюсь к задачам/.test(x)),h.recs.join('\n'));
 assert.equal(await h.m.step(),false,'шаг ЛС больше не держит главный цикл');assert.equal(h.posts.length,1,'повтора нет');
 await h.m.command('close');assert.equal(h.s.status,'closed');
});
test('Life Stone: 500 inventory_full и not_enough_aa у Маммона — отказ; понятная причина про AA',async()=>{
 for(const [code,why] of [['inventory_full',/сумка полна/],['not_enough_aa',/не хватает AA/],['insufficient_ancient_adena',/не хватает AA/]]){
  const h=fixture({gem:3});await h.start();h.reply(refuse({...FULL,message:code}));await h.m.step();
  assert.equal(h.posts.length,1);assert.equal(h.posts[0].path,'/game/mammon/merchant/buy');
  assert.equal(h.s.pending,null,code);assert.equal(h.s.reservedAA,0);assert.equal(h.s.spentAA,0);assert.equal(h.s.hold,false);assert.match(h.s.reason,why);
  assert.equal(h.s.supplies[0].code,code);
 }
});
test('телепорт к Маммону: 500 not_enough_adena на прежнем месте — отказ «не хватает адены»',async()=>{
 const h=fixture({gem:3,near:false});await h.start();h.reply(refuse({...FULL,message:'not_enough_adena'}));await h.m.step();
 assert.equal(h.posts[0].path,'/game/mammon/teleport');assert.equal(h.s.pending,null);assert.match(h.s.reason,/не хватает адены/);assert.equal(h.s.hold,false);
});
test('после отказа игрок освобождает сумку и сам продолжает серию — покупка и вставка идут обычно',async()=>{
 const h=fixture({ls:3,limit:1});h.env.cfg.autoLs.maxAttempts=1;await h.start();h.reply(refuse());await h.m.step();assert.equal(h.s.hold,false);
 h.reply(null);await h.m.command('resume');assert.equal(h.s.hold,true);assert.equal(h.s.status,'running');
 await h.m.step();assert.equal(h.posts.length,2);assert.equal(h.s.spentAdena,ADENA_PRICE);await h.m.step();
 assert.equal(h.posts[2].path,'/character/weapon-augmentation');assert.equal(h.s.status,'done');
});
test('отказ, но ревизия сменилась — остаётся неизвестной; сверка по новой ревизии и прежним остаткам снимает её как прежде',async()=>{
 const h=fixture({ls:3});await h.start();h.reply(()=>{h.snap.revision++;return refuse()();});await h.m.step();
 assert.equal(h.s.pending?.refused,'inventory_full');assert.equal(h.s.reservedAdena,3*ADENA_PRICE);assert.equal(h.s.hold,true);assert.match(h.s.reason,/не подтвердило/);
 assert.equal(await h.m.step(),true,'до 15 с — только ожидание сверки');assert.equal(h.posts.length,1);
 h.advance();await h.m.step();assert.equal(h.s.pending,null);assert.equal(h.s.reservedAdena,0);assert.equal(h.s.spentAdena,0);assert.equal(h.s.supplies[0].status,'not_applied');assert.equal(h.posts.length,1);
});
test('отказ, но покупка на деле применилась — неизвестна до точной сверки, учтена ровно один раз, без второй покупки',async()=>{
 const h=fixture({ls:3});await h.start();h.reply((path,body)=>{h.applied(path,body);return refuse()();});await h.m.step();
 assert.ok(h.s.pending);assert.equal(h.s.spentAdena,0);assert.equal(h.s.reservedAdena,3*ADENA_PRICE);
 h.reload();h.advance();await h.m.command('reconcile');
 assert.equal(h.s.pending,null);assert.equal(h.s.spentAdena,3*ADENA_PRICE);assert.equal(h.s.reservedAdena,0);assert.equal(h.s.supplies[0].status,'confirmed');assert.equal(h.posts.length,1);
});
test('свежий GET после отказа не прочитан — код хранится в pending, автосверка через 15 с снимает отказ',async()=>{
 const h=fixture({ls:3});await h.start();let fail=false;h.reply(()=>{fail=true;return refuse()();});h.getFail(p=>fail&&p==='/character');
 await h.m.step();assert.equal(h.posts.length,1);assert.equal(h.s.pending?.refused,'inventory_full');assert.equal(h.s.status,'paused');assert.equal(h.s.hold,true);
 fail=false;h.advance();await h.m.step();assert.equal(h.s.pending,null);assert.equal(h.s.hold,false);assert.equal(h.s.reservedAdena,0);assert.equal(h.posts.length,1);
});
test('обычный 500, неточный код, 409 и 502 — по-прежнему неизвестно: pending и резерв держатся, повтора нет',async()=>{
 for(const [status,body] of [[500,{statusCode:500,error:'Internal Server Error',message:'Internal server error'}],[500,{...FULL,message:'inventory_full; db down'}],[500,{statusCode:500}],[409,{error:'revision_conflict',message:'inventory_full'}],[502,{error:'bad gateway'}]]){
  const h=fixture({ls:3});await h.start();h.reply(refuse(body,status));await h.m.step();
  assert.ok(h.s.pending,status+' '+JSON.stringify(body));assert.equal(h.s.pending.refused,undefined);assert.equal(h.s.reservedAdena,3*ADENA_PRICE);assert.equal(h.s.hold,true);
  h.advance();await h.m.step();assert.ok(h.s.pending,'сверка при той же ревизии не снимает неизвестную покупку');assert.equal(h.posts.length,1);
 }
});
test('без общего правила оплат (L2PayOutcome) 500 inventory_full остаётся неизвестным — безопасный запасной путь',async()=>{
 const h=fixture({ls:3,payments:false});await h.start();h.reply(refuse());await h.m.step();assert.ok(h.s.pending);assert.equal(h.s.reservedAdena,3*ADENA_PRICE);assert.equal(h.s.hold,true);
});
test('подделанный код в сохранённом pending (не из BIZ_REJECT) не снимает неизвестную покупку',async()=>{
 const h=fixture({ls:3});await h.start();h.reply(refuse({statusCode:500}));await h.m.step();h.s.pending.refused='revision_conflict';
 h.advance();await h.m.command('reconcile');assert.ok(h.s.pending);assert.equal(h.s.reservedAdena,3*ADENA_PRICE);
});

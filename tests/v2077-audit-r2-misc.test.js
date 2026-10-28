'use strict';
// 20.76+ (ревизия 28.10, группа «r2-misc»):
// 1) dailies.detourEnd: в старом режиме (autoTasks=null) галки «Катакомбы»/«Автофарм» в разделах не поднимают manualKickAt — объезд «50 рыб»
//    продолжался, а его конец записывал старый снимок prev и стирал выбор игрока. Теперь возвращаются только ключи, которые объезд записал сам
//    и которые с тех пор никто не менял.
// 2) mammon.teleport: платный телепорт к NPC (500 000) не сверял адену с резервом shopReserve — оставлял героя ниже резерва.
//    Теперь свежий кошелёк обязателен: ниже резерва — отказ без оплаты, кошелёк неизвестен — повтор без оплаты.
// 3) mammon.isNear (остаток): сбой GET /game/mammon/merchant без кэша координат считался «торговец далеко» → платный телепорт.
//    Теперь кэш только пока NPC не сменил место (rotatesAtMs), иначе null (повтор без оплаты).
// 4) equipment: каталог игры weaponType 'dual' переводился в 'дуалы', а классы (CLASS_W/items-il) ждут 'парные мечи' — новые дуалы
//    (кланы 9002276, Glory 920040) были «не в класс», и автосмена надевала более слабое оружие.
// Ревью 28.10: поход из Ashen Bastion после отказа без перелёта (резерв, «не улетели») возвращается на /ashen-bastion.html, а не на карту;
//    ответ 200 без блока mammonMerchant тоже считается сбоем координат (кэш только до rotatesAtMs).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

// ---------------- 1) дейлик «50 рыб»: конец объезда не стирает галки игрока ----------------
function daily(cfg={}){
 const loc={pathname:'/map.html',href:''},cfgs=[];
 const sb={console,Date,location:loc,sessionStorage:{getItem(){return null},setItem(){}}};sb.globalThis=sb;
 vm.runInNewContext(read('modules/dailies.js'),sb);
 const env={cfg:{dailyAuto:true,clanTasks:true,autoTasks:null,zoneAuto:true,fishMode:false,rbHuntMode:false,epicMode:false,catMode:false,...cfg},
  rt:{manualKickAt:111,daily:{day:'d1',t:Date.now(),tasks:{fishing_catch_50:{have:49,need:50,done:false}}}},on:true,tabOwner:true,
  gameGet:async()=>({ok:true,json:async()=>({unlocked:true,fishingSpot:{purchased:true},fishingTime:{canFish:true,remainingMs:3600000}})}),
  isBattle:()=>false,awayFree:()=>true,fishNow:()=>env.cfg.fishMode,heroLevel:()=>75,rec(){},setStatus(){},sleep:async()=>{},
  setRt:async p=>Object.assign(env.rt,p),setCfg:async p=>{cfgs.push(p);Object.assign(env.cfg,p)},gamePost:async()=>({ok:true,json:async()=>({})})};
 return {env,D:sb.L2V7Factories.dailies(env),cfgs,loc};
}
test('объезд «50 рыб»: галка «Катакомбы» во время объезда (manualKickAt прежний) переживает его конец',async()=>{
 const {env,D}=daily();await D.dailyStep();assert.ok(env.rt.dailyFish);assert.equal(env.cfg.fishMode,true);assert.equal(env.cfg.zoneAuto,false);
 Object.assign(env.cfg,{catMode:true});   // галка раздела в старом режиме: manualKickAt не меняется, объезд жив
 await D.fishNote();await D.dailyStep();
 assert.equal(env.rt.dailyFish,null,'объезд закончен');
 assert.equal(env.cfg.catMode,true,'выбор игрока не стёрт');
 assert.equal(env.cfg.fishMode,false,'записанная объездом рыбалка снята');
 assert.equal(env.cfg.zoneAuto,true,'нетронутый ключ возвращён из prev');
});
test('объезд «50 рыб»: «Автофарм» включён игроком во время объезда (prev — выкл) остаётся включённым',async()=>{
 const {env,D}=daily({zoneAuto:false});await D.dailyStep();assert.ok(env.rt.dailyFish);
 Object.assign(env.cfg,{zoneAuto:true});await D.fishNote();await D.dailyStep();
 assert.equal(env.rt.dailyFish,null);assert.equal(env.cfg.zoneAuto,true);assert.equal(env.cfg.fishMode,false);
});
test('объезд «50 рыб» без вмешательства игрока: все режимы возвращаются как были',async()=>{
 const {env,D,cfgs}=daily({rbHuntMode:true});await D.dailyStep();assert.equal(env.cfg.rbHuntMode,false);
 await D.fishNote();await D.dailyStep();
 assert.equal(env.rt.dailyFish,null);assert.equal(env.cfg.rbHuntMode,true);assert.equal(env.cfg.zoneAuto,true);assert.equal(env.cfg.fishMode,false);
 assert.deepEqual(JSON.parse(JSON.stringify(cfgs.at(-1))),{fishMode:false,rbHuntMode:true,epicMode:false,catMode:false,zoneAuto:true});
});

// ---------------- 2–3) Маммон: резерв адены перед телепортом, сбой GET координат торговца ----------------
const payCode=read('modules/payments.js');
function mm(kind,o={}){
 const now=Date.now(),loc={pathname:kind==='smith'?'/mammon-blacksmith-loc.html':'/mammon-merchant-loc.html',search:'',href:''},events=[];
 const box={Date,console,URLSearchParams,Math,JSON,sessionStorage:{getItem:()=>null,setItem(){}},location:loc,document:{documentElement:{dataset:{}},querySelectorAll:()=>[],querySelector:()=>null,getElementById:()=>null}};
 vm.runInNewContext(payCode,box);
 const st={ups:403,char:200,merchant:200,adena:o.adena??600000,hero:{x:0,y:0},npc:{x:50000,y:50000}};let fired=0;
 const btn={disabled:false},cost={textContent:o.cost||'500000'};
 const env={rt:{char:'Tank',manualKickAt:0,...(o.rt||{})},cfg:{shopReserve:200000,mmTpMax:500000,...(o.cfg||{})},on:true,tabOwner:true,leaseEpoch:3,autonomyMode:()=> 'farm',canRun:()=>true,ITEMS:{},FARM:{res:{}},
  isBattle:()=>false,fishNow:()=>false,rec:(...a)=>events.push(a.join(' ')),setStatus:s=>events.push(s),sleep:async()=>{},waitX:async f=>f(),
  $q:s=>s==='#mammon-loc-teleport-btn'?btn:s==='#mammon-loc-cost'?cost:s==='#mammon-loc-err'&&o.err?{textContent:o.err}:null,fire:()=>{fired++;return true},
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,
  gameGet:async p=>{
   if(p==='/game/mammon/blacksmith/upgrades')return {ok:st.ups===200,status:st.ups,json:async()=>(st.ups===200?{items:[]}:{error:'mammon_blacksmith_not_nearby'})};
   if(p==='/character')return {ok:st.char===200,status:st.char,json:async()=>(st.char===200?{character:{name:'Tank',id:'tank',revision:9,adena:st.adena,worldX:st.hero.x,worldY:st.hero.y}}:{})};
   if(p==='/game/mammon/merchant')return {ok:st.merchant===200,status:st.merchant,json:async()=>(st.merchant===200&&!st.merchantEmpty?{mammonMerchant:{current:{id:'m1',worldX:st.npc.x,worldY:st.npc.y}},teleport:{adenaCost:500000}}:{})};
   if(p==='/game/mammon/blacksmith')return {ok:true,status:200,json:async()=>({mammonBlacksmith:{current:{id:'b1',worldX:st.npc.x,worldY:st.npc.y}},teleport:{adenaCost:500000}})};
   return {ok:false,status:404,json:async()=>({})};}};
 env.payments=o.noPay?null:box.L2V7Factories.payments(env);vm.runInNewContext(read('modules/mammon.js'),box);const M=box.L2V7Factories.mammon(env);
 env.rt.mmJob={kind,step:'go',why:'тест',home:o.home||'z1',t:now,context:{char:'Tank',kick:0,mode:'farm'}};
 const paid=()=>!!(env.rt.actionPayments?.pending||(env.rt.actionPayments?.history||[]).length);
 return {env,M,st,events,paid,fired:()=>fired,loc};
}
for(const kind of ['order','smith'])test(`телепорт к ${kind==='order'?'торговцу':'кузнецу'}: 600 000 адены, резерв 200 000 — 500 000 не платим`,async()=>{
 const f=mm(kind);assert.equal(await f.M.mmStep(),true);
 assert.equal(f.paid(),false,'платёж не подготовлен');assert.equal(f.fired(),0,'кнопка не нажата');
 assert.equal(f.env.rt.mmJob,null,'задание закрыто');assert.equal(f.env.rt.mmLog[0].ok,false);assert.match(f.env.rt.mmLog[0].why,/ниже резерва/);
 assert.equal(f.env.rt.zoneGo,undefined,'герой не улетал — обратного маршрута нет');
 assert.equal(f.loc.href,'/map.html','обычная точка — на карту, как прежде');
});
// ревью 28.10: поход из Ashen Bastion после отказа без перелёта возвращается на страницу Ashen (на /map.html фарм Ashen не продолжается)
test('телепорт из Ashen Bastion ниже резерва — без оплаты и без платного zoneGo, обратно на /ashen-bastion.html',async()=>{
 const f=mm('order',{home:'ashen_bastion'});await f.M.mmStep();
 assert.equal(f.paid(),false);assert.equal(f.fired(),0);assert.equal(f.env.rt.mmJob,null);
 assert.equal(f.env.rt.zoneGo,undefined,'обратного телепорта нет — герой в Ashen');assert.equal(f.loc.href,'/ashen-bastion.html');
 assert.ok(f.events.some(e=>/ниже резерва.*остаюсь в Ashen Bastion/.test(e)));
});
test('Ashen Bastion, рыбалка выбрана — после отказа как прежде на /fishing.html',async()=>{
 const f=mm('order',{home:'ashen_bastion'});f.env.fishNow=()=>true;await f.M.mmStep();
 assert.equal(f.fired(),0);assert.equal(f.loc.href,'/fishing.html');
});
test('без журнала оплат: игра ответила ошибкой на странице телепорта из Ashen — «не улетели», обратно на /ashen-bastion.html',async()=>{
 const f=mm('order',{home:'ashen_bastion',adena:5000000,noPay:true,err:'Недостатньо адени'});await f.M.mmStep();
 assert.equal(f.fired(),1);assert.equal(f.env.rt.mmJob,null);assert.match(f.env.rt.mmLog[0].why,/не улетели/);
 assert.equal(f.env.rt.zoneGo,undefined);assert.equal(f.loc.href,'/ashen-bastion.html');
});
test('телепорт: адены хватает сверх резерва (800 000) — платим и летим',async()=>{
 const f=mm('order',{adena:800000});await f.M.mmStep();
 assert.ok(f.env.rt.actionPayments?.pending);assert.equal(f.env.rt.actionPayments.pending.quote.amount,500000);assert.equal(f.fired(),1);assert.equal(f.env.rt.mmJob.step,'act');
});
test('телепорт: бесплатный (VIP) при нуле адены — летим, резерв не мешает',async()=>{
 const f=mm('smith',{adena:0,cost:'Безкоштовно · VIP'});await f.M.mmStep();assert.equal(f.fired(),1);assert.equal(f.env.rt.mmJob.step,'act');
});
test('телепорт: кошелёк не прочитан (GET /character 502) — не платим, задание ждёт повтора',async()=>{
 const f=mm('smith');f.st.char=502;
 for(let i=0;i<3;i++)assert.equal(await f.M.mmStep(),true);
 assert.equal(f.paid(),false);assert.equal(f.fired(),0);assert.equal(f.env.rt.mmJob?.step,'go');
 assert.ok(f.events.some(e=>/запас адены перед платным телепортом не подтверждён/.test(e)));
});
for(const status of [429,502])test(`торговец: GET /game/mammon/merchant ${status}, кэша координат нет — не «далеко», телепорт не оплачивается`,async()=>{
 const f=mm('order',{adena:5000000});f.st.merchant=status;
 assert.equal(await f.M.isNear('order'),null);
 for(let i=0;i<3;i++)assert.equal(await f.M.mmStep(),true);
 assert.equal(f.paid(),false);assert.equal(f.fired(),0);assert.equal(f.env.rt.mmJob.step,'go');
});
// ревью 28.10: 200 без блока mammonMerchant (HTML техработ, пустое тело) — тоже не свежие координаты
test('торговец: GET координат 200 без mammonMerchant, кэша нет — положение неизвестно, телепорт не оплачивается',async()=>{
 const f=mm('order',{adena:5000000});f.st.merchantEmpty=true;
 assert.equal(await f.M.isNear('order'),null);
 for(let i=0;i<3;i++)assert.equal(await f.M.mmStep(),true);
 assert.equal(f.paid(),false);assert.equal(f.fired(),0);assert.equal(f.env.rt.mmJob.step,'go');
});
test('торговец: GET координат 200 без mammonMerchant, кэш свежий — решение по кэшу',async()=>{
 const f=mm('order',{adena:5000000,rt:{mmNpc:{order:{x:100,y:100,at:Date.now()+600000}}}});f.st.merchantEmpty=true;
 assert.equal(await f.M.isNear('order'),true);
});
test('торговец: GET координат 429, кэш свежий (место ещё не сменилось) — решение по кэшу',async()=>{
 const far=mm('order',{adena:5000000,rt:{mmNpc:{order:{x:50000,y:50000,at:Date.now()+600000}}}});far.st.merchant=429;
 assert.equal(await far.M.isNear('order'),false);await far.M.mmStep();assert.equal(far.fired(),1);
 const near=mm('order',{adena:5000000,rt:{mmNpc:{order:{x:100,y:100,at:Date.now()+600000}}}});near.st.merchant=429;
 assert.equal(await near.M.isNear('order'),true);
});
test('торговец: GET координат 429, кэш устарел (NPC сменил место) — положение неизвестно',async()=>{
 const f=mm('order',{adena:5000000,rt:{mmNpc:{order:{x:50000,y:50000,at:Date.now()-1000}}}});f.st.merchant=429;
 assert.equal(await f.M.isNear('order'),null);await f.M.mmStep();assert.equal(f.paid(),false);assert.equal(f.fired(),0);
});
test('торговец: GET координат 200 — прежнее поведение (далеко → телепорт)',async()=>{
 const f=mm('order',{adena:5000000});assert.equal(await f.M.isNear('order'),false);await f.M.mmStep();assert.equal(f.fired(),1);
});

// ---------------- 4) оружие: дуалы из каталога игры = «парные мечи» ----------------
const items=require('../items-il.json');
const CATALOG={catalogVersion:'t',gearCatalog:[
 {itemId:920040,nameUk:'Dual Blades of Glory',slot:'rhand',stats:{pAtk:450,mAtk:155,atkSpd:325,wpnCrit:80},grade:'S',requiredLevel:70,weaponType:'dual',weaponMode:'phys',blocksShield:true},
 {itemId:9002276,nameUk:'Кланові дуали',slot:'rhand',grade:'S',requiredLevel:76,weaponType:'dual',stats:{pAtk:484,mAtk:176,atkSpd:340,wpnCrit:100},weaponMode:'phys',blocksShield:true},
 {itemId:9002280,nameUk:'Клановий різак',slot:'rhand',grade:'S',requiredLevel:76,weaponType:'sword',stats:{pAtk:396,mAtk:176,atkSpd:399,wpnCrit:100},weaponMode:'phys',blocksShield:false}]};
const CLASS_W={duelist:['парные мечи'],gladiator:['парные мечи'],swordsinger:['парные мечи','меч']};
async function scan({prof,eqSlot,bag,rt={}}){
 let now=1e9;const calls=[];
 const rows=bag.map(r=>({dataset:{itemJson:JSON.stringify(r.item)},querySelector:s=>s==='.l2-char-bag-name'?{textContent:r.name}:s==='.l2-char-bag-equip--wear'?{wear:r.item.targetInstanceId}:null}));
 const img={className:'l2-char-slot-icon--filled',getAttribute:()=>'/icons/x.png',closest:()=>({})};
 const q=s=>s==='img[data-l2-slot="weapon"]'?img:s==='#char-bag-list'?{}:null;
 class Clock extends Date{static now(){return now}}
 const box={console,Date:Clock,document:{querySelectorAll:s=>s==='.l2-char-bag-row[data-item-json]'?rows:[]},location:{pathname:'/char.html',search:''}};
 vm.runInNewContext(read('modules/equipment.js'),box);
 const env={on:true,tabOwner:true,rt:{char:'Hero',prof,lvl:80,invScan:{step:'inv',t:1},panel:[{kind:'снаряжение',img:'x.png',name:'Equipped'}],...rt},cfg:{weaponClassEquip:true,weaponClassPick:true,nWeaponMain:''},
  itemOf:id=>items[id]?{id:+id,...items[id]}:null,itemByIcon:()=>null,$q:q,shown:e=>!!e,isChar:()=>true,normalizeProfession:x=>String(x).toLowerCase(),combatProfileKind:()=>'fighter',MAGE:'#mage',CLASS_W,GRADE_LV:{NG:0,D:20,C:40,B:52,A:61,S:76},heroLevel:()=>80,
  setStatus(){},setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},setCfg:async p=>Object.assign(env.cfg,p),itemsDb:async()=>items,baseName:s=>String(s||'').replace(/^\+\d+\s*/,''),itemJson:r=>JSON.parse(r.dataset.itemJson),waitX:async f=>f(),sleep:async ms=>{now+=ms},rnd:a=>a,pause:async()=>{},
  noticeText:()=>'',EQUIP_OK:/надіто/,rec:(...a)=>calls.push(['rec',a.join(' ')]),fire:b=>{calls.push(['wear',b.wear]);return true},
  gameGet:async url=>({ok:true,json:async()=>url==='/character/catalog-hints'?JSON.parse(JSON.stringify(CATALOG)):{character:{name:'Hero',inventory:{eq:{l1:eqSlot}}}}})};
 const M=box.L2V7Factories.equipment(env);
 if(!rt.skipScan)await M.invScanStep();
 return {env,M,wear:calls.filter(c=>c[0]==='wear'&&c[1]),now:()=>now};
}
const slot=id=>({itemId:id,enchant:0,enchantPAtkBonus:0,enchantMAtkBonus:0});
test('Duelist: надеты Dual Blades of Glory (каталог dual) — «в класс», на более слабые IL-дуалы из сумки не меняем',async()=>{
 const f=await scan({prof:'Duelist',eqSlot:slot(920040),bag:[{name:"Tallum Blade*Dark Legion's Edge",item:{itemId:6580,enchant:10,enchantPAtkBonus:50,enchantMAtkBonus:20,targetInstanceId:'bag:6580:10'}}]});
 const eq=f.env.rt.weapons.find(w=>w.where==='надето');assert.equal(eq.id,920040);assert.equal(eq.wt,'парные мечи');
 assert.equal(f.env.rt.weaponRec.eqInClass,true);assert.equal(f.wear.length,0,'не переодеваем');assert.doesNotMatch(f.env.cfg.nWeaponMain,/Tallum/,'выбор оружия не переписан на более слабое');
});
test('Swordsinger: надеты «Кланові дуали» — на клановый меч слабее не переодеваем',async()=>{
 const f=await scan({prof:'Swordsinger',eqSlot:slot(9002276),bag:[{name:'Клановий різак',item:{itemId:9002280,enchant:5,enchantPAtkBonus:20,enchantMAtkBonus:5,targetInstanceId:'bag:9002280:5'}}]});
 assert.equal(f.env.rt.weaponRec.eqInClass,true);assert.equal(f.wear.length,0);
});
test('Duelist: надеты Damascus*Damascus, в сумке «Кланові дуали» — апгрейд надевается',async()=>{
 const f=await scan({prof:'Duelist',eqSlot:slot(5706),bag:[{name:'Кланові дуали',item:{itemId:9002276,enchant:0,enchantPAtkBonus:0,enchantMAtkBonus:0,targetInstanceId:'bag:9002276:0'}}]});
 assert.equal(f.env.rt.weaponRec.main,'Кланові дуали');assert.deepEqual(f.wear.map(c=>c[1]),['bag:9002276:0']);
});
test('старый кэш каталога/памяти с видом «дуалы» тоже считается «парные мечи»',async()=>{
 const f=await scan({prof:'Duelist',eqSlot:slot(5706),bag:[],rt:{skipScan:true,weaponCatalog:{t:1e9,items:{9002276:{id:9002276,k:'W',n:'Кланові дуали',g:'S',wt:'дуалы',pa:484,ma:176,requiredLevel:76,weaponMode:'phys',source:'game-catalog'}}}}});
 assert.equal(f.M.weaponOf(9002276).wt,'парные мечи');
 const R=f.M.rankWeapons([{id:9002276,name:'Кланові дуали',wt:'дуалы',g:'S',pa:484,ma:176,requiredLevel:76}]);
 assert.equal(R.inClass({wt:'дуалы'}),true);assert.equal(R.main?.id,9002276);
});
test('меню: «в класс» в списке оружия тоже понимает старое «дуалы»',()=>{
 const src=read('popup.js'),m=src.match(/function fillWeapons\(rt, d\) \{[\s\S]*?\n  const inClass = (w => [^\n]+);/);assert.ok(m,'fillWeapons.inClass найден');
 const inClass=types=>vm.runInNewContext(`(()=>{const types=${JSON.stringify(types)};return ${m[1].replace(/;$/,'')}})()`);
 assert.equal(inClass(['парные мечи'])({wt:'дуалы'}),true);assert.equal(inClass(['парные мечи'])({wt:'парные мечи'}),true);
 assert.equal(inClass(['меч'])({wt:'дуалы'}),false);assert.equal(inClass(['#mage'])({wt:'лук'}),true);
});

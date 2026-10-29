'use strict';
// 20.67 (лог 27.10 11:44): после Rebirth human_wizard35 с Mew1225/3 исключался из полного баффа и подготовки кота.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fixture}=require('./warlock-fixture.cjs');
const cat=()=>({kind:'servitor',key:'mew_the_cat',summonSkillId:1225,summonSkillLevel:3,hp:1618,maxHp:1618,activeBuffs:[]});
function wizard(o={}){
 return fixture({...o,char:{level:35,l2Profession:'human_wizard',activeSummon:cat(),...o.char},rt:{classCur:{prof:'human_wizard',slot:0},...o.rt}});
}

test('Wizard35/Mew1225: полный набор оплачивается и подтверждается свежими эффектами',async()=>{
 const f=wizard();await f.step();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/character/town/buffer');
 assert.deepEqual(f.calls[0].body,{set:'summon',expectedRevision:100,expectedFeeAdena:'10000000',expectedFeeCoinOfLuck:0});
 assert.equal(f.status(),'active');assert.equal(f.env.rt.petFull.purchases,1);
 assert.equal(f.env.rt.petFull.lastReceipt.classKey,'0:human_wizard');
 assert.equal(f.env.rt.petFull.lastReceipt.petKey,'mew_the_cat');assert.ok(f.env.rt.petFull.expiresAt>f.now());
});
test('Wizard: та же покупка после победы, без повторной оплаты следующими победами',async()=>{
 const f=wizard({battle:true,win:true});await f.step({afterWin:true});assert.equal(f.status(),'active');
 for(let i=0;i<12;i++){f.tick(5000);await f.step({afterWin:true});}
 assert.equal(f.calls.length,1);
});
test('Wizard/Kat: точный поддержанный кот тоже получает полный набор',async()=>{
 const f=wizard({char:{activeSummon:{...cat(),key:'kat_the_cat',summonSkillId:1222}}});await f.step();
 assert.equal(f.calls.length,1);assert.equal(f.status(),'active');
});
test('профессии: Wizard и прежние суммонеры разрешены, остальные маги и воины — нет',()=>{
 const a=wizard().api();
 for(const p of ['wizard','human_wizard','human_warlock','arcana_lord','human_dark_avenger','dwarf_warsmith'])assert.equal(a.fullClass(p),true,p);
 for(const p of ['human_mystic','human_sorcerer','human_necromancer','human_warrior','orc_wizard',''])assert.equal(a.fullClass(p),false,p);
});
test('новый Wizard включает задачу автобаффа тем же путём, что котовод второй профессии',async()=>{
 const f=wizard({cfg:{petFullAuto:false,petBuffAuto:false,autoTasks:['quests']}}),writes=[];
 f.env.setCfg=async p=>{writes.push(p);Object.assign(f.env.cfg,p);};
 assert.equal(await f.api().autoEnableClass(f.ch),true);
 assert.equal(f.env.cfg.petFullAuto,true);assert.equal(f.env.cfg.petBuffAuto,true);
 assert.deepEqual(Array.from(f.env.cfg.autoTasks),['quests','petbuff']);assert.equal(writes.length,1);
 assert.equal(await f.api().autoEnableClass(f.ch),false);assert.equal(writes.length,1,'повторный снимок ничего не меняет');
});
test('автовключение Wizard не меняет конфигурацию при Stop, чужом герое и иной профессии',async()=>{
 for(const kind of ['stop','foreign','class']){
  const f=wizard({cfg:{petFullAuto:false,petBuffAuto:false,autoTasks:['quests']}});let changes=0;
  f.env.setCfg=async()=>{changes++;};
  if(kind==='stop')f.env.on=false;if(kind==='foreign')f.ch.name='other';if(kind==='class')f.ch.l2Profession='human_sorcerer';
  await f.api().autoEnableClass(f.ch);assert.equal(changes,0,kind);assert.equal(f.calls.length,0);
 }
});
test('выключенный автобаф, Stop и потеря вкладки запрещают и чтение, и оплату',async()=>{
 for(const kind of ['disabled','stop','owner']){
  const f=wizard({cfg:kind==='disabled'?{petFullAuto:false}:{}});
  if(kind==='stop')f.env.on=false;if(kind==='owner')f.env.tabOwner=false;
  assert.equal(await f.step(),false);assert.equal(f.gets.length,0,kind);assert.equal(f.calls.length,0,kind);
 }
});
test('Stop во время чтения каталога запрещает покупку и поход к бафферу',async()=>{
 const f=wizard({read:(p,e)=>{if(p==='/character/town/buffer/catalog')e.on=false;}});let trips=0;
 f.env.townBufferReady=()=>false;f.env.townBufferStart=async()=>{trips++;};await f.step();
 assert.equal(f.calls.length,0);assert.equal(trips,0);
});
test('после смены класса на Sorcerer либо чужого ответа покупка кота не разрешается',async()=>{
 for(const kind of ['class','foreign']){
  const f=wizard({read:(p,e,ch)=>{if(p==='/character'){if(kind==='class'){ch.l2Profession='human_sorcerer';e.rt.classCur={prof:'human_sorcerer',slot:0};}else ch.name='other';}}});
  await f.step();assert.equal(f.status(),'class');assert.equal(f.calls.length,0,kind);
  assert.deepEqual(f.gets,['/character']);
 }
});
test('Wizard: отсутствие, смерть и неподдержанный суммон не разрешают платный набор',async()=>{
 for(const p of [null,{...cat(),hp:0},{...cat(),key:'dark_panther',summonSkillId:283},{...cat(),key:'mechanic_golem',summonSkillId:25},{...cat(),kind:'pet'},{...cat(),summonSkillLevel:0}]){
  const f=wizard({char:{activeSummon:p}});await f.step();assert.equal(f.status(),'pet');assert.equal(f.calls.length,0);
 }
});
test('Wizard: CoL, неизвестная цена и нехватка адены на набор сохраняют запрет оплаты (20.82: лимита цены и резерва нет)',async()=>{
 for(const [kind,options,status] of [
  ['col',{catalog:c=>c.sets.find(x=>x.id==='summon').feeCoinOfLuck=1},'catalog'],
  ['unknown',{catalog:c=>delete c.sets.find(x=>x.id==='summon').feeAdena},'catalog'],
  ['adena',{char:{adena:'9999999'}},'adena']
 ]){const f=wizard(options);await f.step();assert.equal(f.status(),status,kind);assert.equal(f.calls.length,0,kind);}
});
test('Wizard: неизвестный результат платежа переживает reload без второй оплаты',async()=>{
 const f=wizard({post:()=>{throw Error('lost_response');}});await f.step();assert.equal(f.calls.length,1);assert.ok(f.env.rt.petFull.pending);
 f.reload();f.tick(61000);await f.step({forceRead:true});assert.equal(f.calls.length,1);assert.ok(f.env.rt.petFull.pending);
});
test('Wizard: потеря баффов после перепризыва не отменяет защиту оплаченного срока',async()=>{
 const f=wizard();await f.step();const end=f.env.rt.petFull.lastReceipt.expiresAt;
 f.tick(61000);f.ch.activeSummon=cat();f.ch.revision++;f.env.rt.petBornT=f.now();await f.step({afterWin:true});
 assert.equal(f.status(),'early-loss');assert.equal(f.calls.length,1);assert.equal(f.env.rt.petFull.nextCheckAt,end);
});

function prepare(o={}){
 const f=wizard({cfg:{petAuto:true,petBuffAuto:true,nPetBuffs:'',...o.cfg},char:{mp:5000,activeSummon:null,...o.char},rt:{startPrep:{id:1}}}),e=f.env,fires=[],nav=[];
 let page='/map.html';e.leaseEpoch='owner';e.canRun=()=>true;e.canAct=()=>true;e.startPrepWanted=()=>true;
 e.nativePanelPath=()=>page;e.nativeReturnPath=()=>page;e.nativePanelOpen=async()=>{};
 e.nativeNavigate=p=>{page=p;nav.push(p);};e.nativeFire=b=>{fires.push(b.id);return true;};
 e.nativePanel=()=>({hotbar:true,buffs:[],summon:{action:'l2_1225',skillId:1225,effectId:1225,name:'Summon Mew the Cat',mp:48,ready:true,button:{id:1225}}});
 return {...f,fires,nav,page:()=>page,prep:()=>f.api().startPrepare({buffs:false})};
}
test('подготовка Wizard после Старта призывает Mew родной кнопкой до начала задачи',async()=>{
 const f=prepare();assert.equal(f.api().startReady('summon'),false);
 assert.equal(await f.prep(),true);assert.deepEqual(f.nav,['/skill-panel.html']);await f.prep();assert.deepEqual(f.fires,[1225]);
 assert.equal(f.env.rt.petPrep.pending.kind,'summon');f.ch.activeSummon=cat();f.ch.revision++;
 await f.prep();assert.equal(f.env.rt.petPrep,null);assert.equal(f.api().startReady('summon'),true);
 assert.equal(f.page(),'/map.html');assert.ok(f.env.rt.petBornT>0);assert.equal(f.calls.length,0);
});
test('подготовка Wizard: Stop перед нативным кликом запрещает призыв',async()=>{
 const f=prepare();await f.prep();f.env.nativePanelOpen=async()=>{f.env.on=false;};await f.prep();assert.deepEqual(f.fires,[]);assert.equal(f.calls.length,0);
});
test('Wizard до второй профессии: отсутствующие Queen/Warrior/Final пропускаются, живой Mew не заменяется',async()=>{
 const missing=['Summon Feline Queen','Warrior Servitor','Final Servitor'];
 for(const present of [true,false]){
  const f=prepare({cfg:{nPetBuffs:missing.join(', ')},char:{activeSummon:present?cat():null}}),native=f.env.nativePanel;
  f.env.petBuffGuess=()=>null;f.env.nativePanel=()=>({...native(),missing,incomplete:true});
  await f.prep();
  if(!present){await f.prep();assert.deepEqual(f.fires,[1225]);f.ch.activeSummon=cat();f.ch.revision++;await f.prep();}
  assert.equal(f.api().startReady('summon'),true);
  await f.api().startPrepare({buffs:true});assert.equal(f.page(),'/skill-panel.html');
  await f.api().startPrepare({buffs:true});assert.equal(f.page(),'/map.html');assert.equal(f.api().startReady('pet'),true);
  assert.equal(f.env.rt.petPrep,null);assert.deepEqual(f.fires,present?[]:[1225]);assert.equal(f.calls.length,0);
 }
});
test('панель: Wizard и Warlock включают автобаф, другие маги остаются заблокированы',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../warlock-ui.js'),'utf8'),box={};vm.runInNewContext(source,box);
 for(const prof of ['human_wizard','human_warlock','human_sorcerer','human_mystic']){
  const state={on:false,cfg:{petFullAuto:false,fishMode:true},rt:{char:'hero',classCur:{prof}}},saves=[];
  const reset={},node={innerHTML:'',querySelectorAll:()=>[],querySelector:s=>s==='[data-reset]'?reset:null};
  const toggle={classList:{toggle(){}},setAttribute(){}};
  const ui=box.L2WarlockUI.mount(node,toggle,{getState:async()=>state,saveConfig:async p=>{Object.assign(state.cfg,p);saves.push(p);}});
  await ui.ready;const supported=['human_wizard','human_warlock'].includes(prof);assert.equal(toggle.disabled,!supported,prof);
  if(supported){await toggle.onclick();assert.equal(state.cfg.petFullAuto,true);assert.equal(saves.length,1);assert.equal(state.cfg.fishMode,true);assert.equal(state.on,false);}
 }
});
test('ядро включает подготовку Wizard лишь для выбранной задачи и включённого призыва',()=>{
 const content=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
 const body=content.slice(content.indexOf('function startPrepProf()'),content.indexOf('function startPrepKey()'));
 const b={cfg:{petAuto:true},rt:{classCur:{prof:'human_wizard',slot:0}},START_PREP_TASK:{quests:'квесты'},startPrepTask:()=> 'quests'};
 vm.runInNewContext(body+'this.eligible=startPrepEligible;',b);assert.equal(b.eligible(),true);
 b.cfg.petAuto=false;assert.equal(b.eligible(),false);b.cfg.petAuto=true;b.rt.classCur.prof='human_sorcerer';assert.equal(b.eligible(),false);
 b.rt.classCur.prof='human_wizard';b.startPrepTask=()=> 'fish';assert.equal(b.eligible(),false);
});

'use strict';
// 20.81 (лог 29.10 19:47–20:39): Rebirth РБ лечит кота как РБ; свежая смерть не ждёт старый 15-секундный таймер.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const RUN='00000000-0000-4000-8000-000000000001';
async function choice({role='raid',absent=false,age=100,lastAgo=5000,requestAge=age+50,metadata=true,hud=false,cd=0,mp=1000,mutate,noSummon=false}={}){
 const f=flowFixture('pet'),e=f.env,now=1000000000,heal={title:'Servitor Heal',getAttribute:()=>null},chosen=[],kit=[];
 f.box.Date={now:()=>now};f.slots.push(heal);
 Object.assign(e.cfg,{nPetBuffs:'',petBuffAuto:false,petHealAt:50,petResummonAt:25,petHealPrefer:'heal',petResummon:true});
 Object.assign(e.rt,{char:'RunHero',classCur:{prof:'human_wizard',slot:0},petSummonHp:{kai_the_cat:2599},petHealGain:[1200,1200,1200],
  petSummonT:now-lastAgo,petSummonOkT:now-lastAgo});
 const pet={t:now-age,...(metadata?{requestStartedAt:now-requestAge}:{}),has:!absent,key:'kai_the_cat',hp:absent?0:1000,maxHp:2599,...(hud?{hud:true}:{})};
 e.petState=()=>({...pet});e.antibotState=()=>false;e.pvpPending=()=>false;e.canAct=()=>true;
 e.meMp=()=>({cur:mp,max:1000,pct:mp/10});
 e.crafterKit={noSummon:r=>{kit.push(r);return noSummon;}};
 const il=e.ilOf,action=e.slotAction;
 e.ilOf=b=>b===heal?{target:'PET',c:'Лечение',mp:49}:il(b);
 e.slotAction=b=>b===heal?'l2_1127':action(b);
 e.combatCooldown.skillWait=a=>a===action(f.summon)?cd:0;e.slotCd=()=>null;
 if(role){
  const spawn=`rebirth_raid_${RUN}_1_1_25064_lv75_${role==='raid'?'raid_3':role==='champion'?'champion_1':'mob_1'}`;
  f.location.search='?spawnId='+spawn;e.rebirthSelected=()=>true;
  e.rebirthBattleProof=async({name,valid})=>({spawn,name,lvl:75,role,runId:RUN,current:valid});
 }
 e.gameBusy=()=>{if(mutate)mutate({e,pet});return{busy:false,end:0};};
 e.fire=b=>{chosen.push(b.title);e.on=false;return false;};
 try{await f.combat.battle();}catch(err){if(err.message!=='bounded-loop')throw err;}
 return{chosen,logs:f.logs,kit,rt:e.rt};
}

test('Rebirth raid_3 не попадает в «вне РБ не лечу»: слабое по фарм-модели лечение доступно',async()=>{
 const f=await choice();assert.equal(f.chosen[0],'Servitor Heal');assert.ok(!f.logs.some(x=>/вне РБ не лечу/.test(x)));
});
for(const role of ['mob','champion'])test(`${role} похода сохраняет прежнюю оценку полезности лечения`,async()=>{
 const f=await choice({role});assert.equal(f.chosen[0],'Blaze');assert.ok(f.logs.some(x=>/вне РБ не лечу/.test(x)));
});
test('новое серверное отсутствие кота через 5 секунд после призыва разрешает готовый призыв',async()=>{
 const f=await choice({absent:true});assert.equal(f.chosen[0],'Summon Kai the Cat');assert.ok(f.kit.includes(true),'Rebirth РБ передаётся в class-kit как РБ');
});
test('снимок отсутствия до прошлой попытки не разрешает ранний повтор призыва',async()=>{
 const f=await choice({absent:true,age:6000});assert.equal(f.chosen[0],'Blaze');
});
test('поздний GET, начатый до успешного призыва, не разрешает новый призыв',async()=>{
 const f=await choice({absent:true,requestAge:6000});assert.equal(f.chosen[0],'Blaze');
});
test('без причинной метки запроса сохраняются прежние 15сек',async()=>{
 const f=await choice({absent:true,metadata:false});assert.equal(f.chosen[0],'Blaze');
});
test('старый запрос не разрешает повтор даже когда получен спустя прежние 15сек',async()=>{
 const f=await choice({absent:true,lastAgo:20000,requestAge:21000});assert.equal(f.chosen[0],'Blaze');
});
test('HUD без нового серверного отсутствия сохраняет защитный интервал',async()=>{
 const f=await choice({absent:true,hud:true});assert.equal(f.chosen[0],'Blaze');
});
test('свежее отсутствие не обходит серверный КД призыва',async()=>{
 const f=await choice({absent:true,cd:3000});assert.equal(f.chosen[0],'Blaze');
});
test('новый снимок не разрешает ранний повтор в первые 2 секунды после призыва',async()=>{
 const f=await choice({absent:true,lastAgo:1000});assert.equal(f.chosen[0],'Blaze');
});
test('будущий снимок не является подтверждением отсутствия даже после прежних 15сек',async()=>{
 const f=await choice({absent:true,age:-100,lastAgo:20000});assert.equal(f.chosen[0],'Blaze');
});
test('свежее отсутствие не обходит запрет голема на РБ',async()=>{
 const f=await choice({absent:true,noSummon:true});assert.equal(f.chosen[0],'Blaze');assert.ok(f.kit.includes(true));
});
test('нехватка MP не разрешает призыв',async()=>{
 const f=await choice({absent:true,mp:10});assert.ok(!f.chosen.includes('Summon Kai the Cat'));
});
test('кот появился во время ожидания игры — отложенный призыв отменяется',async()=>{
 const f=await choice({absent:true,lastAgo:20000,mutate:({pet})=>{pet.has=true;pet.hp=2599;}});assert.equal(f.chosen[0],'Blaze');
});
test('поздний старый GET во время ожидания игры отменяет ранний призыв',async()=>{
 const f=await choice({absent:true,mutate:({pet})=>{pet.requestStartedAt=1000000000-6000;}});assert.equal(f.chosen[0],'Blaze');
});
test('пропавшая причинная метка во время ожидания не разрешает ранний призыв или горячий повтор',async()=>{
 const f=await choice({absent:true,mutate:({pet})=>{delete pet.requestStartedAt;}});assert.equal(f.chosen[0],'Blaze');
});
for(const kind of ['stop','owner','class','mode','captcha'])test(`перед призывом повторно проверяется ${kind}`,async()=>{
 const f=await choice({absent:true,lastAgo:20000,mutate:({e})=>{
  if(kind==='stop')e.on=false;else if(kind==='owner')e.tabOwner=false;else if(kind==='class')e.rt.classCur.prof='human_warlock';
  else if(kind==='mode')e.rebirthSelected=()=>false;else e.antibotState=()=>true;
 }});assert.equal(f.chosen.length,0);
});

// Повторные шаги одного боя: проверяется настоящий petStep, act подставлен только как квитанция принятия.
function timeline(result=true){
 const source=fs.readFileSync(path.join(__dirname,'../modules/combat.js'),'utf8'),start=source.indexOf('  async function petStep('),end=source.indexOf('\n  // шаг: лечение скиллом',start);
 let now=1000000000,calls=0;const slot={title:'Summon Kai the Cat'},pet={t:now-100,requestStartedAt:now-150,has:false,key:'kai_the_cat',hp:0,maxHp:2599};
 const ctx={petChecked:true,block:{},pet:{alive:false,summons:0,deaths:0},rebirth:{role:'raid'}};
 const env={cfg:{petAuto:true},rt:{petSummonT:now-5000,petSummonOkT:now-5000},petState:()=>pet,SLOT:'.slot',
  slotKind:()=> 'скилл',cleanTitle:s=>s,skillMp:()=>20,setRt:p=>{Object.assign(env.rt,p);return Promise.resolve();},rec:()=>{},
  antibotState:()=>false,waitFor:async fn=>fn(),crafterKit:{noSummon:()=>false}};
 const box={env,ctx,Date:{now:()=>now},document:{querySelectorAll:()=>[slot]},summonCombat:()=>true,raidTarget:()=>true,
  slotsBy:()=>[],servitorSummonSlot:()=>true,petPick:s=>s[0],ready:()=>true,affordable:()=>true,petKeyOf:s=>s.toLowerCase().replaceAll(' ','_'),
  NEXT:'next',AGAIN:'again',act:async(b,label,hp,needed)=>{if(needed&&!needed())return'lock';calls++;return result;}};
 vm.runInNewContext(source.slice(start,end)+'\nthis.step=petStep;',box);
 return{step:()=>box.step(null,{cur:1000}),tick:ms=>{now+=ms;},fresh:()=>{pet.t=now;pet.requestStartedAt=now-1;},calls:()=>calls};
}
test('один серверный снимок отсутствия не повторяет принятый призыв после отката навыка',async()=>{
 const f=timeline();await f.step();assert.equal(f.calls(),1);f.tick(2500);await f.step();assert.equal(f.calls(),1);
 f.fresh();await f.step();assert.equal(f.calls(),2,'новое подтверждённое отсутствие допускает следующую попытку');
});
test('потерянный клик сохраняет паузу 2сек, даже если сервер прислал новое отсутствие',async()=>{
 const f=timeline(false);await f.step();assert.equal(f.calls(),1);f.tick(500);f.fresh();await f.step();assert.equal(f.calls(),1);
 f.tick(1600);f.fresh();await f.step();assert.equal(f.calls(),2);
});

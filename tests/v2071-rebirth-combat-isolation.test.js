'use strict';
// 20.71: регрессии отдельного боя похода. По просьбе игрока при выпуске20.71 не запускались.
const test=require('node:test'),assert=require('node:assert/strict');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const RUN='00000000-0000-4000-8000-000000000001';
function fixture(role='champion'){
 const f=flowFixture('fighter'),e=f.env,state={live:true,selected:true,proofs:0,next:[],returned:0};
 const name=role==='raid'?'Rebirth Sejarr’s Servitor':role==='champion'?'Rebirth Champion · Wasp Worker':'Rebirth · Wyrm';
 const spawn=`rebirth_raid_${RUN}_2_1_25041_lv75_${role==='raid'?'raid_3':role==='champion'?'champion_1':'mob_300'}`;
 e.$q('#battle-mob-title').textContent=name+' · ур. 75';
 f.location.search='?spawnId='+spawn;
 Object.assign(e.rt,{char:'RunHero',classCur:{prof:'human_wizard',slot:0},hpMin:{[name.toLowerCase()]:1},
  hardMobs:{[name.toLowerCase()]:{t:Date.now(),why:'старый обычный фарм'}},shop:{urgent:true}});
 Object.assign(e.cfg,{champBlue:false,champOrange:false,champRed:false,champHpMult:1.5,lvlAbove:0,rbMaxAbove:0,campaign:true,questStop:true});
 e.rebirthSelected=()=>state.selected;e.antibotState=()=>false;e.pvpPending=()=>false;
 e.rebirthBattleProof=async({name:n,max,title,valid})=>{
  state.proofs++;assert.equal(n,name);assert.equal(max,1000);assert.ok(title.includes(name));
  return {spawn,name,lvl:75,role,runId:RUN,current:()=>state.live&&valid()};
 };
 e.rebirthReturn=async valid=>{if(valid())state.returned++;};
 e.nextFight=async ctx=>{state.next.push(ctx);};
 const forbidden=label=>()=>{throw Error('Обычная охота не участвует: '+label);};
 e.isBoss=forbidden('boss marker');e.isChamp=forbidden('champion marker');e.campRbOpen=forbidden('campaign RB');
 e.rbNote=forbidden('raid database');e.rbTimerKill=forbidden('raid timer');e.rbAssess=forbidden('raid prediction');
 e.trackQuest=forbidden('quest stop');e.tvtStep=forbidden('TvT');e.catPrefetch=forbidden('catacomb prefetch');
 e.champs={observe:forbidden('champion observation'),noteDamage:forbidden('champion damage'),tierOff:forbidden('champion colors'),
  judge:forbidden('champion economy'),learn:forbidden('champion verdict'),held:forbidden('champion hold')};
 return {...f,state,name,spawn};
}

for(const role of ['mob','champion','raid'])test(`подтверждённый ${role} похода бьётся без маркеров, цветов, старого HP и правил обычной охоты`,async()=>{
 const f=fixture(role),hard=JSON.stringify(f.env.rt.hardMobs),before=f.env.rt.sinceDeep;
 await f.combat.battle();
 assert.equal(f.state.proofs,1);assert.equal(f.events.filter(x=>x==='Атака').length,1);
 assert.equal(f.env.rt.kills,1);assert.equal(f.state.next.length,1);assert.equal(f.events.includes('map'),false);
 assert.equal(f.state.next[0].rebirth.role,role);assert.equal(f.state.next[0].rb,undefined);assert.equal(f.state.next[0].champ,false);
 assert.equal(f.env.rt.sinceDeep,before);assert.equal(JSON.stringify(f.env.rt.hardMobs),hard);
});

test('неподтверждённый поход не получает запасную атаку через обычный HP-фильтр',async()=>{
 const f=fixture();f.env.rebirthBattleProof=async()=>null;
 await f.combat.battle();assert.equal(f.events.filter(x=>x==='Атака').length,0);assert.equal(f.env.rt.kills,0);assert.equal(f.state.next.length,0);
});

test('Stop, смена класса или режима во время подтверждения отменяют первый удар',async()=>{
 for(const mutate of [f=>{f.env.on=false;},f=>{f.env.rt.classCur.prof='human_warlock';},f=>{f.state.selected=false;}]){
  const f=fixture(),read=f.env.rebirthBattleProof;f.env.rebirthBattleProof=async q=>{const p=await read(q);mutate(f);return p;};
  await f.combat.battle();assert.equal(f.events.filter(x=>x==='Атака').length,0);assert.equal(f.env.rt.kills,0);
 }
});

test('истёкший proof при ожидании хода не разрешает удар',async()=>{
 const f=fixture('raid');f.env.actionWait=async valid=>{f.state.live=false;return valid();};
 await f.combat.battle();assert.equal(f.events.filter(x=>x==='Атака').length,0);assert.equal(f.env.rt.kills,0);assert.equal(f.state.next.length,0);
});

test('победа обрабатывается, когда ответ убийства уже сделал живой proof неактуальным',async()=>{
 const f=fixture('raid'),fire=f.env.fire;f.env.fire=b=>{const r=fire(b);if(b===f.atk)f.state.live=false;return r;};
 await f.combat.battle();assert.equal(f.events.filter(x=>x==='Атака').length,1);assert.equal(f.env.rt.kills,1);assert.equal(f.state.next.length,1);
});

test('ошибка открытия боя возвращает в режим подземелий, без карты и фиктивной победы',async()=>{
 const f=fixture(),q=f.env.$q;f.env.$q=s=>s==='#battle-load-err'?{textContent:'rebirth_raid_invalid_spawn'}:s==='#battle-mob-hp-val'?null:q(s);
 await f.combat.battle();assert.equal(f.state.returned,1);assert.equal(f.events.includes('map'),false);assert.equal(f.env.rt.kills,0);assert.equal(f.state.next.length,0);
});

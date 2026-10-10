'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
function factory(name, document) {
 const sandbox={document, console, Date, location:{pathname:'/starter-story-quest.html',search:'',href:'https://l2wap.com/starter-story-quest.html',origin:'https://l2wap.com'}};
 sandbox.globalThis=sandbox;
 vm.runInNewContext(fs.readFileSync(path.join(root,'modules',name+'.js'),'utf8'),sandbox,{filename:name+'.js'});
 return {create:sandbox.L2V7Factories[name], sandbox};
}
(async()=>{
 const skills=[
  {title:'Атака',kind:'атака',cd:'attack'},
  {title:'Wind Strike',kind:'скилл',cd:'l2_1177',il:{c:'Маг. атака',t:'MDAM',pow:12,reuse:6000,mp:9}},
  {title:'Ice Bolt',kind:'скилл',cd:'l2_1184',il:{c:'Маг. атака',t:'MDAM',pow:8,reuse:8000,mp:10}},
  {title:'Heal',kind:'скилл',cd:'l2_1011',il:{c:'Лечение',t:'HEAL',mp:10}},
  {title:'Summon Kat the Cat',kind:'скилл',cd:'l2_1111',il:{c:'Призыв',t:'SUMMON',mp:20}},
  {title:'Might',kind:'скилл',cd:'l2_1068',il:{c:'Бафф',t:'BUFF',mp:10}},
 ].map(o=>({...o,disabled:false,className:'',getAttribute(k){return k==='aria-disabled'?null:k==='data-slot-cd'?this.cd:null}}));
 const busy=new Set();
 const doc={querySelectorAll(){return skills}, querySelector(){return null}};
 const env={SLOT:'.slot',cfg:{combatProfile:'auto',nPower:'Iron Punch',nAttack:'Атака',skillMpMin:35},
   rt:{prof:'Human Mage',skills:{}},combatProfileKind:()=> 'mage_summoner',$q(s){return s==='#battle-mob-hp-val'?{textContent:'500 / 500'}:null},
   shown(){return false},cleanTitle:s=>s, slotKind:b=>b.kind,isEquip(){return false},ilOf:b=>b.il,
   slotCd(){return null},memLeft(){return 0},slotAction:b=>b.cd,
   combatCooldown:{skillWait:k=>busy.has(k)?1000:0,skillKnown:()=>false},battleSpawn:()=>'mob-1',
   skKey:b=>b.title.toLowerCase(),names:s=>String(s||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),
   expDmg:s=>({'wind strike':250,'ice bolt':130,'атака':300}[String(s).toLowerCase()]||0),
   skillMp:s=>s==='Wind Strike'?9:10,
 };
 const combat=factory('combat',doc).create(env), ctx={block:{}};
 assert.equal(combat.chooseAction(ctx,{cur:200,max:300})?.name,'Wind Strike','strongest spell should be picked despite stale fighter role');
 busy.add('l2_1177');
 assert.equal(combat.chooseAction(ctx,{cur:200,max:300})?.name,'Ice Bolt','next ready spell used in chain');
 busy.add('l2_1184');
 assert.equal(combat.chooseAction(ctx,{cur:200,max:300}),null,'no forced physical attack when spells on CD');
 busy.clear();
 // 7.1.16-fix: мало MP и банка MP готова — ждём банку; банки нет — атака лучше, чем стоять
 env.mpPotSlot=()=>skills[0]; env.qty=()=>5;
 // 7.1.30: банка есть, но на дешёвое заклинание хватает — колдуем, банку пьёт свой блок (раньше стояли до 3 с)
 assert.match(String(combat.chooseAction(ctx,{cur:20,max:300})?.key),/^power:/,'potion available but spell affordable: cast');
 assert.equal(combat.chooseAction(ctx,{cur:5,max:300}),null,'nothing affordable and potion ready: wait for potion');
 env.mpPotSlot=()=>null;
 // 7.1.30: банки нет, MP 20 ниже резерва, но на дешёвое заклинание хватает — колдуем (режим экономии), атака — только когда не хватает ни на что
 const eco=combat.chooseAction(ctx,{cur:20,max:300}); assert.match(String(eco?.key),/^power:/); assert.match(String(eco?.why),/экономия MP|пробую|добивание/,'no potion, MP enough for cheapest spell: eco spell');
 assert.equal(combat.chooseAction(ctx,{cur:5,max:300})?.key,'attack','no MP and no potion: basic attack instead of standing');
 // остаток HP моба меньше удара атаки — добивание атакой, не заклинанием
 env.rt.skills['атака']={dmg:240,dmgN:3};   // атака измерена: ~80 урона
 env.$q=s=>s==='#battle-mob-hp-val'?{textContent:'3 / 500'}:null;
 assert.equal(combat.chooseAction(ctx,{cur:200,max:300})?.key,'attack','finish 3 HP with basic attack');
 env.$q=s=>s==='#battle-mob-hp-val'?{textContent:'134 / 500'}:null; delete env.rt.skills['атака'];
 assert.notEqual(combat.chooseAction(ctx,{cur:200,max:300})?.key,'attack','attack not measured: no attack finisher on 134 HP');
 env.$q=s=>s==='#battle-mob-hp-val'?{textContent:'500 / 500'}:null;
 assert.ok(!skills.filter(s=>s.kind==='скилл').some(s=>['Heal','Summon Kat the Cat','Might'].includes(combat.chooseAction(ctx,{cur:200,max:300})?.name)),'support skills not damage candidates');
 // Starter saga: no quest-specific DOM before network loads; avoid back-and-forth.
 let exits=0;
 const questEnv={rt:{},cfg:{campaign:true,campaignEvery:25},on:true,
   isCampaign:()=>false,isMail:()=>false,waitFor:async()=>null,$q:()=>null,shown:()=>false,
   setRt:async p=>Object.assign(questEnv.rt,p),rec:()=>{},setStatus:()=>{},
   goOutskirts:async()=>{exits++},sleep:async()=>{},rnd:()=>100};
 const quests=factory('quests',{querySelectorAll:()=>[]}).create(questEnv);
 await quests.goCampaign();
 assert.equal(exits,1,'known starter-story route must be processed, not redirected to quest-list');
 await quests.goCampaign();
 assert.equal(exits,2);
 assert.equal(quests.campOn(),false,'after two empty quest pages suspend campaign rather than loop');
 const pop=fs.readFileSync(path.join(root,'popup.js'),'utf8');
 assert.match(pop,/Date\.now\(\) - \(\+hbBg\.t \|\| 0\) < 70000/,'no false missing activity at 22 s');
 const config=fs.readFileSync(path.join(root,'modules/equipment.js'),'utf8');
 assert.match(config,/nAttack: mage \? '' :/,'mage auto-roles never restore physical attack');
 const core=fs.readFileSync(path.join(root,'content.js'),'utf8');
 assert.match(core,/starter-story-quest\|dion-campaign/,'detect starter saga by route');
 console.log('PASS: mage multi-spell rotation, cooldown, no melee, MP guard, starter-story route, loop breaker, heartbeat UI');
})().catch(e=>{console.error(e);process.exitCode=1});

'use strict';
// Настоящее MV3, локальный DOM панели из журнала07:15. Все HTTPS перехвачены harness, аккаунт не используется.
const assert=require('node:assert/strict');
const {harness,until}=require('./v1014-core-lifecycle-browser.cjs');
const skills=[['wild_sweep','Дикий розмах'],['war_cry','Бойовий клич'],['vicious_stance','Жорстка стійка'],
 ['detect_animal_weakness','Вразливість звірів'],['focus_attack','Зосереджений удар'],['howl','Звіриний рев'],
 ['detect_insect_weakness','Вразливість комах'],['thrill_fight','Азарт бою'],['whirlwind','Вихор'],
 ['thunder_storm','Грозова буря'],['detect_plant_weakness','Вразливість рослин'],['provoke','Провокація масова']];
(async()=>{const h=await harness({withPopup:false});try{
 await h.g.p.evaluate(skills=>{
  history.replaceState({},'','/battle.html?spawnId=sdms_warlord_fixture');
  const box=document.createElement('div');box.innerHTML='<div id="battle-mob-title">Fixture Mob · ур.48</div><div id="battle-mob-hp-val">10000/10000</div><div id="battle-log"></div>';
  for(const [key,name]of skills){const b=document.createElement('button');b.className='l2-battle-hotbar-slot';b.title=name;
   const cd=document.createElement('span');cd.dataset.slotCd=key;cd.hidden=true;b.append(cd);
   b.onclick=()=>document.body.dataset.unwantedClick='1';box.append(b);
  }
  document.body.append(box);
 },skills);
 await until(()=>h.g.core('panelInventory().length===12'));
 const result=await h.g.core(`(()=>{
  cfg=withRb({...L2EngineCore.rawTaskConfig(cfg),autoTasks:null,combatProfile:'fighter',nAttack:'',nCharge:'',nForce:'',nUltra:'',skillMpMin:0,mageProbe:false,fightMode:'dps'});
  rt.prof='Warlord';rt.lvl=48;rt.skills={};rt.skillDb={};
  const panel=panelInventory(),meta=panel.map(p=>({key:p.cdKey,id:ilOf(p)?.id,auto:ilOf(p)?.autoUse,kind:ilOf(p)?.c}));
  const roles=suggestRoles().roles;
  const support=panel.filter(p=>!['wild_sweep','whirlwind','thunder_storm'].includes(p.cdKey));
  cfg=withRb({...L2EngineCore.rawTaskConfig(cfg),nPower:support.map(p=>p.name).join(', ')});
  const ctx=()=>({block:{},rb:false,champ:false});
  const none=L2V7Modules.combat.dpsPlan(ctx(),{cur:5000,max:5000});
  const picks=[];
  for(const key of ['whirlwind','thunder_storm']){
   const p=panel.find(p=>p.cdKey===key);rt.skills[p.name.toLowerCase()]={dmgN:3,dmg:9000,uses:3};
   cfg=withRb({...L2EngineCore.rawTaskConfig(cfg),nPower:[...support.map(p=>p.name),p.name].join(', ')});
   const pick=L2V7Modules.combat.dpsPlan(ctx(),{cur:5000,max:5000});picks.push({key:slotAction(pick?.b),name:pick?.name});
  }
  cfg=withRb({...L2EngineCore.rawTaskConfig(cfg),nBuffs:'Азарт бою, Зосереджений удар, Провокація масова, Вразливість звірів'});
  return {meta,roles,none,picks,buffs:buffList()};
 })()`);
 assert.equal(result.meta.length,12);assert.ok(result.meta.every(x=>Number.isInteger(x.id)));
 for(const key of ['focus_attack','provoke','detect_animal_weakness','detect_insect_weakness','detect_plant_weakness'])assert.equal(result.meta.find(p=>p.key===key).auto,false);
 assert.equal(result.none,null,'поддержка в старой nPower не создаёт атакующее действие');
 assert.deepEqual(result.picks.map(p=>p.key),['whirlwind','thunder_storm']);
 assert.deepEqual(result.buffs,['азарт бою']);assert.doesNotMatch(result.roles.nPower,/Провокація|Вразливість|Зосереджений|Звіриний|Азарт/);
 assert.equal(await h.g.p.getAttribute('body','data-unwanted-click'),null);assert.equal(h.requests.some(r=>r.method!=='GET'),false);
 assert.deepEqual(h.errors,[]);console.log('PASS MV3 Warlord: 12 native identities, correct roles, stale support-only nPower → no attack; Whirlwind/Thunder Storm → damage; manual buffs excluded, zero clicks/POST/errors');
 }finally{await h.ctx.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});

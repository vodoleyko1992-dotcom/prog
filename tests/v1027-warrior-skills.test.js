'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync('content.js','utf8'),rt={skillDb:{}};
const cards=[['Wild Sweep','Массовая атака. MP 22, power 90. Откат: 17 с.'],['Stun Attack','MP 22, power 30. Откат: 13 с.'],['Power Smash','MP 22, power 90. Откат: 13 с.'],['War Cry','Селф-баф на 5 мин. MP 10. Откат: 180 с.'],['Old Skill','MP 49, сила 501. Перезарядка 17 с.']].map(([name,desc])=>({textContent:name,parentElement:{querySelector:s=>({textContent:s.includes('__desc')?desc:'Ранг: 1 / 15'})}}));
const box={console,Date,rt,document:{querySelectorAll:()=>cards},setRt:p=>Object.assign(rt,p),rec:()=>{}};
vm.createContext(box);vm.runInContext(fs.readFileSync('skills-il.js','utf8')+'\n'+core.slice(core.indexOf('const IL = typeof IL_DB'),core.indexOf('// ---------- база предметов'))+'\n'+core.slice(core.indexOf('function learnSkillDb()'),core.indexOf('// ---------- расчёт ДПС'))+'\n'+core.slice(core.indexOf('function skillMp('),core.indexOf('function powerK('))+'\nthis.api={ilOf,learnSkillDb,powerOf,skillMp};',box);
const a=box.api;assert.equal(a.learnSkillDb(),5);assert.equal(rt.skillDb['wild sweep'].power,90);assert.equal(rt.skillDb['wild sweep'].cd,17);assert.equal(rt.skillDb['old skill'].power,501);
for(const [key,id]of Object.entries({wild_sweep:245,power_smash:255,stun_attack:100,war_cry:78,vicious_stance:312})){
 const il=a.ilOf({cdKey:key,name:'локальное '+key});assert.equal(il.id,id);assert.equal(a.ilOf('локальное '+key).id,id);
}
assert.equal(a.ilOf('Дикий розмах').target,'AREA');assert.equal(a.ilOf('Дикий розмах').w,'древковое');assert.equal(a.powerOf('дикий розмах'),90);assert.equal(a.skillMp('Дикий розмах'),22);
assert.equal(a.ilOf({cdKey:'stun_attack'}).w,'дубина, двуруч. дубина');assert.equal(a.ilOf({cdKey:'war_cry'}).dur,300);assert.equal(a.ilOf({cdKey:'vicious_stance'}).o,'TOGGLE');
const panel=Object.keys({wild_sweep:1,power_smash:1,stun_attack:1,war_cry:1,vicious_stance:1}).map(cdKey=>({cdKey,name:'локальное '+cdKey,title:'локальное '+cdKey,kind:'скилл'}));
vm.runInContext(fs.readFileSync('modules/equipment.js','utf8'),box);
const env={normalizeProfession:()=>'',CLASS_W:{},isEquip:()=>false,cfg:{},rt:{},ilOf:a.ilOf,panelInventory:()=>panel,combatProfileKind:()=> 'fighter',noEffect:()=>false,isChargeName:()=>false,isForceName:()=>false,skillCost:()=>0,expDmg:()=>4000,ilNum:x=>Array.isArray(x)?x[0]:x,itemOf:()=>null,iconStem:x=>x,FREE_HIT:/x^/};
const roles=box.L2V7Factories.equipment(env).suggestRoles().roles;
assert.match(roles.nPower,/wild_sweep/);assert.doesNotMatch(roles.nPower,/war_cry|vicious_stance|stun_attack/);assert.match(roles.nBuffs,/war_cry/);assert.match(roles.nToggles,/vicious_stance/);assert.match(roles.nStun,/stun_attack/);
console.log('PASS Warrior metadata, native identities, polearm AREA, role classification, War Cry duration');
// Исправляем уже виденную неверную роль один раз, без отмены последующего ручного удаления.
(async()=>{
 Object.assign(env,{cfg:{autoRoles:true,nPower:'локальное war_cry, локальное vicious_stance',nBuffs:'Existing Buff',nToggles:'Existing Toggle'},rt:{panelKnown:panel.map(x=>x.name),weapons:[]},isBattle:()=>true,itemsDb:async()=>{},names:s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean),slotsBy:n=>panel.filter(x=>x.name.toLowerCase()===n),setCfg:async p=>Object.assign(env.cfg,p),setRt:async p=>Object.assign(env.rt,p),rec:()=>{},TAG:'test'});
 box.chrome={storage:{local:{get:async()=>({cfg:env.cfg})}}};
 const E=box.L2V7Factories.equipment(env);await E.autoRoles();assert.doesNotMatch(env.cfg.nPower,/war_cry|vicious_stance/);assert.match(env.cfg.nBuffs,/Existing Buff.*war_cry/);assert.match(env.cfg.nToggles,/Existing Toggle.*vicious_stance/);
 env.cfg.nBuffs='Existing Buff';await E.autoRoles();assert.equal(env.cfg.nBuffs,'Existing Buff');
 rt.skillDb['wild sweep']={mp:0};assert.ok(a.skillMp('Дикий розмах')>0,'старый неизвестный MP0 не бесплатен');rt.skillDb['wild sweep']={mp:0,mpKnown:true};assert.equal(a.skillMp('Дикий розмах'),0);
 env.rt.warriorRoles1027=[];env.cfg.nBuffs='Existing Buff';env.setCfg=async()=>{throw Error('save failed')};await assert.rejects(E.autoRoles(),/save failed/);assert.equal(env.rt.warriorRoles1027.length,0,'миграция только после сохранения');
 console.log('PASS role repair once, manual choices, failed save retry, unknown MP');
})().catch(e=>{console.error(e);process.exitCode=1});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../content.js','utf8');
function resources(sync){
 const slot={title:'#1466 — Заряд душі воїна ×3668',isConnected:true};
 const rt={weaponsT:1};let grade='B',clicks=0;
 const env={rt,shotGrade:()=>({g:grade}),shotsMage:()=>false,syncShotWeapon:async force=>{assert.equal(force,true);return sync(g=>grade=g)},shotSlot:()=>slot,on:true,tabOwner:true,shotsOn:()=>true,fire:()=>clicks++};
 const box={document:{querySelectorAll:()=>[slot]},Date};vm.createContext(box);vm.runInContext(fs.readFileSync(__dirname+'/../modules/resources.js','utf8'),box);
 return {run:()=>box.L2V7Factories.resources(env).keepShots(),clicks:()=>clicks};
}
test('лог22:41: кэш B, реальные A — правильный слот A остаётся без замены',async()=>{
 let checks=0;const f=resources(set=>{checks++;set('A');return true});await f.run();assert.equal(checks,1);assert.equal(f.clicks(),0);
});
test('недоступный GET оружия не позволяет заменить A по старому кэшу B',async()=>{
 const f=resources(()=>false);await f.run();assert.equal(f.clicks(),0);
});
test('актуальные и прежние серверные ошибки включают блокировку неверных зарядов',()=>{
 const start=source.indexOf("  if (path === '/game/battle/action' && /^(?:battle_)?");assert.ok(start>0);
 const code=source.slice(start,source.indexOf('\n  // 9.0',start));
 for(const error of ['battle_soulshot_grade_mismatch','battle_mystic_spiritshot_grade_mismatch','soulshot_grade_mismatch','mystic_spiritshot_grade_mismatch','skill_cooldown']){
  const rt={};const box={path:'/game/battle/action',d:{res:{error}},rt,setRt:p=>Object.assign(rt,p),rec:()=>{}};vm.createContext(box);vm.runInContext(code,box);assert.equal(!!rt.shotMismatchPending,error!=='skill_cooldown');
 }
});
test('перед заменой заряда принудительная сверка обходит десятиминутный кэш',async()=>{
 const rt={char:'Warlock',shotEquipCheckT:Date.now(),weaponsT:1,weapons:[{id:1,g:'B',where:'надето'}]};let gets=0;
 const box={Date,rt,on:true,tabOwner:true,setRt:async p=>Object.assign(rt,p),gameGet:async()=>{gets++;return {ok:true,json:async()=>({inventory:{eq:{l1:{itemId:2}}}})}},weaponEquipNote:async()=>{rt.weapons=[{id:2,g:'A',where:'надето'}]},rec:()=>{}};
 vm.createContext(box);vm.runInContext(source.slice(source.indexOf('async function syncShotWeapon('),source.indexOf('\nlet SHOP_BUY',source.indexOf('async function syncShotWeapon('))),box);
 assert.equal(await box.syncShotWeapon(true),true);assert.equal(gets,1);assert.equal(rt.weapons[0].g,'A');
});

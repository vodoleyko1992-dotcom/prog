'use strict';
// 10.0.18 (лог 14.10 22:59): старые 9999 сосок на панели не означают наличие S-зарядов духа.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../modules/economy.js','utf8');
function fixture(){
 const bag={};let slot={title:'#1467 — Заряд душі воїна ×9999'};
 const env={cfg:{shopAuto:true,shopShots:'1000/5000',shopHp:'0/0',shopMp:'0/0',shopSpirit:'0/0',shopSoul:'0/0',nShots:'Заряд душі воїна'},
 rt:{weaponsT:Date.now(),weapons:[{name:'Клановий кастер',g:'S',weaponMode:'magic',where:'надето'}]},
 MAGE:'#mage',classWeaponTypes:()=>({types:['#mage']}),combatProfileKind:()=> 'mage_summoner',heroLevel:()=>76,
 GRADE_LV:{NG:0,D:20,C:40,B:52,A:61,S:76},BSPS_IDS:{NG:3947,D:3948,C:3949,B:3950,A:3951,S:3952},SHOT_IDS:{NG:1835,D:1463,C:1464,B:1465,A:1466,S:1467},
 pair:v=>String(v).split('/').map(Number),invQty:id=>bag[id]??null,shotSlot:()=>slot,qty:()=>9999,slotsBy:()=>[],rec:()=>{},setRt:()=>{}};
 const box={document:{querySelectorAll:()=>[]},Date,Math};vm.runInNewContext(src,box);
 return {api:box.L2V7Factories.economy(env),bag,setSlot:x=>slot=x};
}
test('клановый S-кастер: старые S-заряды души на панели не скрывают нехватку S-зарядов духа',()=>{
 const f=fixture(),p=f.api.shopPlan().find(x=>x.key==='shots');assert.equal(p.ids[0],3952);assert.equal(f.api.shotGrade().g,'S');
 assert.equal(f.api.shopNeedByPanel(),'заряды S 0 < 1000');
 f.bag[3952]=550;assert.equal(f.api.shopNeedByPanel(),'заряды S 550 < 1000');
 f.bag[3952]=5000;assert.equal(f.api.shopNeedByPanel(),'');
 delete f.bag[3952];f.setSlot({title:'#3952 — Благословенний заряд духу ×9999'});assert.equal(f.api.shopNeedByPanel(),'');
});

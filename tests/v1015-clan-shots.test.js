'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=process.env.L2_RESOURCES_REVIEW||__dirname+'/../modules/resources.js';
function fixture(o={}){
 let modal=false,tab='',slots=[],now=1000000;const calls=[],recs=[];
 const el=(id,grade,qty=1000)=>({title:'#'+id+' — Благословенний заряд духу ×'+qty,isConnected:true,classList:{contains:n=>n==='l2-hotbar-shot--disabled'},querySelector:s=>s==='img'?{getAttribute:()=>'/icons/Etc_spell_shot_'+({A:'silver',S:'gold'}[grade])+'_i01_0.jpg'}:null});
 const A=el(o.oldSoul?1467:3951,o.oldSoul?'S':'A'),S=el(3952,'S');if(o.oldSoul)A.title='#1467 — Заряд душі воїна ×9999';slots=o.correct?[A,S]:[A];
 const empty={title:'empty'},consumable={title:'consumable',classList:{contains:()=>false}},close={title:'close'},pickS=el(3952,'S');
 pickS.title='Благословенний заряд духу ×1000';
 const doc={querySelectorAll:s=>s==='.l2-hotbar-shot--enabled, .l2-hotbar-shot--disabled'?slots:s==='.l2-battle-hotbar-slot--empty'?o.empty?[empty]:[]:s==='.l2-battle-hotbar-pick'?modal&&tab==='consumable'&&(o.stock!==false)?[pickS]:[]:[],querySelector:s=>s==='.l2-battle-hotbar-pick'&&modal?pickS:null};
 const env={on:true,tabOwner:true,cfg:{},rt:{weaponsT:1,shotSwapT:o.cooldown?now:0},shotGrade:()=>({g:'S'}),shotsMage:()=>true,shotSlot:()=>A,shotsOn:()=>false,qty:()=>1000,lastShotTry:0,rec:(...s)=>recs.push(s.join(' ')),setRt:async p=>Object.assign(env.rt,p),sleep:async()=>{},shown:x=>!!x,waitFor:async fn=>fn(),setStatus(){},TAG:'fixture',
 $q:s=>s==='.l2-battle-hotbar-modal #l2-bh-modal-tabs'&&modal?{}:s.includes('data-tab-key="consumable"')?consumable:s==='#l2-bh-modal-close'&&modal?close:null,
 fire:b=>{calls.push(b);if(b===empty)modal=true;else if(b===consumable)tab='consumable';else if(b===pickS){slots.push(S);modal=false;}else if(b===close)modal=false;return true}};
 const box={document:doc,Date:class extends Date{static now(){return now}},console:{log(){},info(){}},Math};vm.runInNewContext(fs.readFileSync(source,'utf8'),box);return{env,A,S,calls,recs,api:box.L2V7Factories.resources(env)};
}
for(const [name,opt]of Object.entries({noEmpty:{},noStock:{empty:true,stock:false},swapCooldown:{empty:true,cooldown:true}}))test('known equippedS rejects wrongA toggle after '+name,async()=>{const f=fixture(opt);await f.api.keepShots();assert.equal(f.calls.filter(x=>x===f.A).length,0,'must not submit known rejected grade3951')});
test('matching S slot still enables normally',async()=>{const f=fixture({correct:true});await f.api.keepShots();assert.equal(f.calls.filter(x=>x===f.S).length,1);assert.equal(f.calls.filter(x=>x===f.A).length,0)});
test('matching A weapon preserves A activation',async()=>{const f=fixture();f.env.shotGrade=()=>({g:'A'});await f.api.keepShots();assert.equal(f.calls.filter(x=>x===f.A).length,1)});

test('successful replacement enables new S slot',async()=>{const f=fixture({empty:true});await f.api.keepShots();assert.equal(f.calls.filter(x=>x===f.S).length,1);assert.equal(f.calls.filter(x=>x===f.A).length,0)});
test('equipment changes during slot modal: final toggle follows fresh A grade',async()=>{const f=fixture({empty:true});const wait=f.env.waitFor;f.env.waitFor=async fn=>{const out=await wait(fn);f.env.shotGrade=()=>({g:'A'});return out};await f.api.keepShots();assert.equal(f.calls.filter(x=>x===f.A).length,1);assert.equal(f.calls.filter(x=>x===f.S).length,0)});
for(const field of ['on','tabOwner'])test(field+' loss during slot modal prevents final toggle',async()=>{const f=fixture({empty:true});const wait=f.env.waitFor;f.env.waitFor=async fn=>{const out=await wait(fn);f.env[field]=false;return out};await f.api.keepShots();assert.equal(f.calls.filter(x=>x===f.A||x===f.S).length,0)});
test('unknown weapon grade preserves existing basic-profile activation',async()=>{const f=fixture();f.env.rt.weaponsT=0;await f.api.keepShots();assert.equal(f.calls.filter(x=>x===f.A).length,1)});

test('observed new weapon metadata pending blocks old activation even without weaponsT',async()=>{const f=fixture();f.env.rt.weaponsT=0;f.env.shotGrade=()=>({g:null,blocked:true});await f.api.keepShots();assert.equal(f.calls.length,0)});
test('observed weapon change during slot await blocks final old activation',async()=>{const f=fixture({empty:true});const wait=f.env.waitFor;f.env.waitFor=async fn=>{const out=await wait(fn);f.env.shotGrade=()=>({g:null,blocked:true});return out};await f.api.keepShots();assert.equal(f.calls.filter(x=>x===f.A||x===f.S).length,0)});

test('S-grade soulshots cannot replace S-grade blessed spiritshots for a mage',async()=>{const f=fixture({empty:true,oldSoul:true});await f.api.keepShots();assert.equal(f.calls.filter(x=>x===f.A).length,0);assert.equal(f.calls.filter(x=>x===f.S).length,1)});

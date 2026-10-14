'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
test('actual battle continues to victory and hunt while rejected-grade fallback stays untouched',async()=>{
 const f=flowFixture('mage'),{env,box}=f,shot={title:'#3951 — Благословенний заряд духу',isConnected:true,querySelector:()=>null};
 const all=box.document.querySelectorAll;box.document.querySelectorAll=s=>s==='.l2-hotbar-shot--enabled, .l2-hotbar-shot--disabled'?[shot]:all(s);
 Object.assign(env.rt,{weaponsT:1,shotSwapT:Date.now()});Object.assign(env,{shotGrade:()=>({g:'S'}),shotSlot:()=>shot,shotsOn:()=>false,lastShotTry:0});
 const qty=env.qty,fire=env.fire;env.qty=b=>b===shot?1000:qty(b);env.fire=b=>{if(b===shot){f.events.push('wrong-A-toggle');return false}return fire(b)};
 vm.runInContext(fs.readFileSync(process.env.L2_RESOURCES_REVIEW||__dirname+'/../modules/resources.js','utf8'),box);env.keepShots=box.L2V7Factories.resources(env).keepShots;
 await f.combat.battle();assert.equal(f.events.filter(x=>x==='wrong-A-toggle').length,0);assert.equal(f.events.filter(x=>x==='Blaze').length,1);assert.equal(env.rt.kills,1);assert.equal(f.events.filter(x=>x==='hunt').length,1);
});

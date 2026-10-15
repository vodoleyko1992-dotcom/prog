'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const mf=vm.runInNewContext(fs.readFileSync(__dirname+'/v1024-mammon-actions.test.js','utf8').split('const cases=')[0]+'\nfixture;', {require,console,__dirname});
for(const action of ['teleport','upgrade'])test(`Mammon ${action}: Stop after persisted job clears only unsent payment; resume is not stuck`,async()=>{
 const f=mf();if(action==='upgrade')f.loc.pathname='/mammon-blacksmith.html';
 const save=f.env.setRt;f.env.setRt=async p=>{const r=await save(p);if(p.mmJob?.payment)f.env.on=false;return r};
 await f.M[action](f.job,...(action==='upgrade'?[[f.item]]:[]));assert.equal(f.clicks.length,0);assert.equal(f.env.payments.pending(),null);assert.equal(f.env.rt.mmJob?.payment??null,null);
 f.env.setRt=save;f.env.on=true;await f.M[action](f.env.rt.mmJob,...(action==='upgrade'?[[f.item]]:[]));assert.equal(f.clicks.length,1);
});
for(const action of ['teleport','upgrade'])test(`Mammon ${action}: storage commit failure before click releases known unsent payment`,async()=>{
 const f=mf();if(action==='upgrade')f.loc.pathname='/mammon-blacksmith.html';let n=0;f.env.rtCommit=async()=>++n===1;
 await f.M[action](f.job,...(action==='upgrade'?[[f.item]]:[]));assert.equal(f.clicks.length,0);assert.equal(f.env.payments.pending(),null);assert.equal(f.env.rt.mmJob?.payment??null,null);
});
test('battle equipment: refused click cannot change weaponNow',async()=>{
 const env={rt:{weaponNow:'Old'},on:true,noticeText:()=>'',fire:()=>false,waitFor:async()=>false,setRt:async p=>Object.assign(env.rt,p),rec(){},pause:async()=>{},cleanTitle:x=>x,EQUIP_OK:/надето/};
 const box={};vm.runInNewContext(fs.readFileSync(__dirname+'/../modules/equipment.js','utf8'),box);
 assert.equal(await box.L2V7Factories.equipment(env).equip({title:'New'}),false);assert.equal(env.rt.weaponNow,'Old');
});

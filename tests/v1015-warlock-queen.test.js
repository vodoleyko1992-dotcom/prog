'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict'),root=require('node:path').resolve(__dirname,'..');
const source=root+'/modules/combat.js';
const fs2={...fs,readFileSync:(p,...a)=>fs.readFileSync(String(p)===root+'/modules/combat.js'?source:p,...a)};
const box={console,URLSearchParams,setTimeout,__dirname:root+'/tests',module:{exports:{}},require:n=>n==='node:test'?()=>{}:n==='fs'?fs2:require(n)};
vm.runInNewContext(fs.readFileSync(root+'/tests/v1014-combat-outcomes.test.js','utf8')+'\nmodule.exports={flowFixture};',box);
const b=require('./warlock-fixture.cjs');
function fixture(){const f=box.module.exports.flowFixture('pet'),w=b.fixture();f.env.warlock=w.api();f.env.petState=()=>({t:Date.now(),has:true,key:'kai_the_cat',hp:3000,maxHp:6500});f.env.cfg.nPetBuffs='Summon Feline Queen';f.env.cfg.petBuffAuto=true;f.env.slotAction=slot=>slot.title==='Summon Feline Queen'?'l2_1331':'other';return{f,w,pick:()=>f.combat.petBuffPick({block:{}},{pct:100},{cur:10000},{cur:100000})}}
test('actual petBuffPick does not overwrite active paid Queen after local timer says due',()=>{const x=fixture();x.w.apply();x.w.api().noteSnapshot(x.w.ch);assert.equal(x.pick(),null)});
test('actual petBuffPick permits missing pet Queen even if hero has own Queen',()=>{const x=fixture();x.w.ch.activeBuffs=[{skillId:4699,level:2,expiresAtMs:x.w.now()+1200000}];x.w.api().noteSnapshot(x.w.ch);assert.equal(x.pick().b.title,'Summon Feline Queen')});
test('expired pet Queen restores ordinary configured buff policy',()=>{const x=fixture();x.w.apply();x.w.tick(18001000);x.w.api().noteSnapshot(x.w.ch);assert.equal(x.pick().b.title,'Summon Feline Queen')});

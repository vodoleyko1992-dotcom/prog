'use strict';
const fs=require('fs'),vm=require('vm'),test=require('node:test'),assert=require('node:assert/strict'),root=require('node:path').resolve(__dirname,'..');
function load(file,exports,fsOverride=fs,transform=x=>x){const box={console,URLSearchParams,setTimeout,__dirname:root+'/tests',module:{exports:{}},require:n=>n==='node:test'?()=>{}:n==='fs'?fsOverride:require(n)};vm.runInNewContext(transform(fs.readFileSync(file,'utf8'))+'\nmodule.exports='+exports,box);return box.module.exports}
const override=fs;
const {flowFixture}=load(root+'/tests/v1014-combat-outcomes.test.js','{flowFixture}',override,s=>s.replace("pet={t:Date.now(),has:false}","pet={t:Date.now(),has:true,key:'kai_the_cat',hp:2898,maxHp:4366}"));
const {fixture}=require('./warlock-fixture.cjs');
function integrated(o={}){const f=flowFixture('pet'),w=fixture(o);Object.assign(f.env.rt,w.env.rt);Object.assign(f.env.cfg,w.env.cfg,{deepEvery:0});w.env.rt=f.env.rt;w.env.cfg=f.env.cfg;for(const k of ['on','tabOwner'])Object.defineProperty(w.env,k,{get:()=>f.env[k],set:v=>f.env[k]=v});w.env.isBattle=()=>true;w.env.victory=f.combat.victory;f.env.warlock=w.api();w.api().noteSnapshot(w.ch);return {...f,w};}

module.exports={integrated,flowFixture};

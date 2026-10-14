'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const src=fs.readFileSync(require('node:path').join(__dirname,'../content.js'),'utf8');
function policy(e){
 const box={cfg:e.cfg,rt:e.rt,FARM_EVERY:Number(src.match(/const FARM_EVERY = (\d+)/)[1]),farmMapOn:()=>!!e.farmMapOn?.(),campChampDue:()=>!!e.campChampOpen?.(),champHunt:()=>true,champEvery:()=>20,mapOff:()=>!e.cfg.deepEvery,rbDue:()=>e.rbDue(),campRbOpen:()=>e.campRbOpen(),searchActive:()=>true};
 vm.runInNewContext(src.slice(src.indexOf('const deepN ='),src.indexOf('// цепочка сама'))+'\nthis.api={deepN,mapDue}',box);return box.api;
}
for(const every of [0,1,10,50,999])test('ресурс: 49/50 независимо от общего интервала '+every,()=>{
 const e={cfg:{deepEvery:every},rt:{sinceDeep:49,deepHot:true},farmMapOn:()=>true,campChampOpen:()=>true,rbDue:()=>false,campRbOpen:()=>[]},p=policy(e);
 assert.equal(p.deepN(),50);assert.equal(p.mapDue([]),false);e.rt.sinceDeep=50;assert.equal(p.mapDue([]),true);
});
test('вне точки ресурса остаётся обычный поиск чемпионов',()=>{
 const e={cfg:{deepEvery:10},rt:{sinceDeep:9},farmMapOn:()=>false,rbDue:()=>false,campRbOpen:()=>[]},p=policy(e);assert.equal(p.deepN(),10);assert.equal(p.mapDue([]),false);e.rt.sinceDeep=10;assert.equal(p.mapDue([]),true);
});
for(const count of [49,50])test('настоящий nextFight: квест/deepHot/удачная цепочка не меняют границу '+count,async()=>{
 const f=flowFixture('mage'),e=f.env;f.setWon(true);e.cfg.deepEvery=10;e.cfg.priority='[квест]\n[все]';e.cfg.searchQuest=true;
 Object.assign(e.rt,{sinceDeep:count,deepHot:true,via:'chain',chainQ:Array(12).fill(1)});
 e.farmMapOn=()=>true;e.isQuestName=()=>true;e.searchActive=()=>true;e.questHere=()=>true;
 const p=policy(e);e.mapDue=p.mapDue;e.deepN=p.deepN;
 await f.farm.nextFight({name:'Safe Mob',killed:[],champ:false});
 assert.equal(f.events.includes('map'),count===50);assert.equal(f.events.includes('hunt'),count===49);
});
test('готовое дело вне боя прерывает ресурсную цепочку раньше 50',async()=>{
 const f=flowFixture('mage');f.setWon(true);f.env.farmMapOn=()=>true;f.env.mmChainWant=()=>({why:'ресурс собран'});await f.farm.nextFight({name:'Safe Mob',killed:[]});assert.ok(f.events.includes('map'));assert.ok(!f.events.includes('hunt'));
});
test('срочный РБ сохраняет приоритет над плановыми 50',()=>{
 const e={cfg:{deepEvery:0},rt:{sinceDeep:1},farmMapOn:()=>true,rbDue:()=>true,campRbOpen:()=>[]};assert.equal(policy(e).mapDue([]),true);
});
test('нецелевой моб главы не сокращает ресурсный интервал',async()=>{
 const f=flowFixture('mage'),e=f.env;f.setWon(true);e.farmMapOn=()=>true;e.campMobOpen=()=>['Other Mob'];e.isQuestName=()=>false;
 Object.assign(e.rt,{via:'chain',chainQ:Array(12).fill(0),eff:{chain:{sec:9},map:{sec:20}},sinceDeep:7});
 await f.farm.nextFight({name:'Safe Mob',killed:[]});assert.ok(f.events.includes('hunt'));assert.ok(!f.events.includes('map'));
});
for(const resource of [true,false])test('нецелевой моб рядом с ★ целью: ресурс='+resource,async()=>{
 const f=flowFixture('mage'),e=f.env;f.setWon(true);e.cfg.deepEvery=10;e.cfg.priority='[квест]\n[все]';e.cfg.searchQuest=true;
 e.farmMapOn=()=>resource;e.isQuestName=n=>n.toLowerCase()==='quest mob';e.searchActive=()=>true;
 Object.assign(e.rt,{questTargets:['Quest Mob'],zoneMobs:{z:['Quest Mob']},zone:'z',sinceDeep:1});
 await f.farm.nextFight({name:'Safe Mob',killed:[]});assert.equal(f.events.includes('map'),!resource);assert.equal(f.events.includes('hunt'),resource);
});
test('слабые случайные мобы остаются в цепочке, слишком сильный по-прежнему запрещён',async()=>{
 const box={console,URLSearchParams,setTimeout,__dirname,module:{exports:{}},require:n=>n==='node:test'?()=>{}:require(n)};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'v1014-combat-outcomes.test.js'),'utf8')+'\nmodule.exports={beforeFight}',box);
 for(const level of [1,69,70]){const f=await box.module.exports.beforeFight({level});assert.ok(f.events.includes('fight-entered'));assert.ok(!f.events.includes('map'));}
 const f=await box.module.exports.beforeFight({level:90},{lvlAbove:5});assert.ok(f.events.includes('map'));assert.ok(!f.events.includes('fight-entered'));
});

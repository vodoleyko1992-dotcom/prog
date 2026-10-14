'use strict';
// 14.10 21:45–22:03: Stone of Purity делал Buffalo Slave ресурсной целью и обходил запрет оранжевых чемпионов.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const s={console,Date,Math,JSON,CSS:{escape:x=>x},document:{querySelectorAll:()=>[]}};s.globalThis=s;vm.createContext(s);
for(const name of ['mobfarm','champs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../modules/'+name+'.js'),'utf8'),s);
let quest=false,campaign=false;
const env={cfg:{priority:'[квест]\n[все]',searchChamp:true,searchQuest:true,champFa:true,champBlue:true,champOrange:false,champRed:false,champMinLvl:0,
  lvlBelow:5,lvlAbove:5,lvlMin:1,lvlMax:99,noCancelMobs:false},
  rt:{lvl:74,spawns:{champ_o_goddard_0:['Buffalo Slave',72],dense_ordinary:['Buffalo Slave',72],dense_blue:['Buffalo Slave',72]}},
  PAGE_SIZE:15,NET_SPAWNS:{tier:{champ_o_goddard_0:'orange',dense_blue:'blue'}},
  heroLvl:()=>74,isRaidId:()=>false,isBoss:()=>false,isQuestName:()=>quest,
  campActive:()=>campaign,campChampOpen:()=>campaign,campChampMin:()=>0,campMobOpen:()=>[],campOpen:()=>[],
  farmRules:()=>[{farm:true,name:'buffalo slave'}],recipeRules:()=>[],rec:()=>{},setRt:async()=>{}};
env.champs=s.L2V7Factories.champs(env);const mf=s.L2V7Factories.mobfarm(env);env.champs.judge=c=>({ok:!env.champs.tierOff(c)});
const sig={ids:['champ_o_goddard_0','dense_ordinary','dense_blue'],quest:[]},types={champ_o_goddard_0:'champion',dense_ordinary:'passive',dense_blue:'champion'};
for(const mode of ['resource','quest','campaign']) {
  quest=mode==='quest';campaign=mode==='campaign';
  const picks=mf.candidates(mf.parseRules(),sig,types,99);
  assert.ok(!picks.some(x=>x.id==='champ_o_goddard_0'),mode+': запрещённый цвет не становится целью даже ради ресурса/FA');
  assert.ok(picks.some(x=>x.id==='dense_ordinary'),mode+': обычный Buffalo Slave остаётся целью');
  assert.ok(picks.some(x=>x.id==='dense_blue'),mode+': разрешённый синий остаётся целью');
}
(async()=>{
  let fired=0,writes=0;
  env.on=true;env.gotoPage=async()=>true;env.$q=()=>({closest:()=>null});
  env.setStatus=()=>{};env.pause=async()=>{};env.setRt=async()=>{writes++;};env.fire=()=>{fired++;};env.waitFor=async()=>true;env.isBattle=()=>true;
  const result=await mf.attackSpawn({id:'champ_o_goddard_0',idx:0,name:'Buffalo Slave',lvl:72,champ:true,tier:'blue'},()=> 'цель');
  assert.equal(result,false,'цвет перепроверяется непосредственно перед боем');assert.equal(fired,0);assert.equal(writes,0);
  console.log('PASS: map champion colors — resource, quest, campaign and stale candidate cannot bypass the orange ban');
})().catch(e=>{console.error(e);process.exitCode=1;});

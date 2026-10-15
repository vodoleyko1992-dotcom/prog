'use strict';
// Native story teleport fixture: own snapshot + quest atNpc, real durable payment module.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
module.exports=function attach(env,{kind='noblesse',target='rune',part=1,stage='return_to_ladd'}={}){
 const source=fs.readFileSync(path.join(__dirname,'../../modules/payments.js'),'utf8'),box={console,Date};vm.runInNewContext(source,box);
 env.rt.char ||= 'Hero';env.tabOwner ??= true;env.rtCommit ||= async()=>true;
 const set=env.setRt;env.setRt=async p=>{const r=await set(p);return r?.ok===false?r:{ok:true}};
 let arrived=false;const fire=env.fire,get=env.gameGet;
 env.gameGet=async url=>{
  const character={name:env.rt.char,id:'hero',revision:arrived?2:1};
  if(url==='/character')return {ok:true,status:200,json:async()=>({character})};
  if(url==='/game/story-quests/'+kind)return {ok:true,status:200,json:async()=>({character,quest:kind==='noblesse'?{part,atNpc:arrived,npc:{teleportId:target}}:{stage,location:{atLadd:arrived},npc:{ladd:{teleportId:target}}}})};
  return get(url);
 };
 env.payments=box.L2V7Factories.payments(env);
 env.fire=b=>{const isTp=b?.dataset?.noblesseTarget||b?.dataset?.subclassTarget;if(isTp&&!env.payments.consumePermit())return false;const r=fire(b);if(isTp&&r!==false)arrived=true;return r===undefined?true:r};
 return {arrived:()=>arrived};
};

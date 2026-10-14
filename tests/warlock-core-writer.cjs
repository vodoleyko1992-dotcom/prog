'use strict';
const fs=require('node:fs'),vm=require('node:vm'),{createPatchQueue}=require(require('node:path').join(__dirname,'../engine-core.js'));
const source=fs.readFileSync(require('node:path').join(__dirname,'../content.js'),'utf8');
const setRt=source.slice(source.indexOf('function setRt(p) {'),source.indexOf('\nconst RECENT =',source.indexOf('function setRt(p) {')));
const rtCommit=source.slice(source.indexOf('async function rtCommit(maxMs'),source.indexOf('\nconst rodLvlOf',source.indexOf('async function rtCommit(maxMs')));
module.exports=function attach(env,{prerendering=false}={}){
 const writes=[],disk=structuredClone(env.rt);let context;
 const writer=createPatchQueue(async p=>{writes.push(structuredClone(p));Object.assign(disk,structuredClone(p));return {ok:true}},()=>!context.tabIdle&&!context.document.prerendering);
 context={rt:env.rt,rtSizeT:Date.now(),RT_BULKY:[],tabIdle:!prerendering,document:{prerendering},rtWriter:writer,Date,console,TAG:'synthetic-core',sleep:async()=>{throw Error('unexpected retry: empty queue must resolve immediately')}};
 Object.defineProperty(context,'on',{get:()=>env.on});vm.createContext(context);vm.runInContext(setRt+'\n'+rtCommit,context);
 Object.defineProperty(env,'rt',{get:()=>context.rt,set:v=>context.rt=v,configurable:true});env.setRt=context.setRt;env.rtCommit=context.rtCommit;
 return {disk,writes,writer,activate:()=>{context.tabIdle=false;context.document.prerendering=false}};
};

'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root=path.join(__dirname,'..');
const bg=fs.readFileSync(path.join(root,'background.js'),'utf8');
const popup=fs.readFileSync(path.join(root,'popup.js'),'utf8');
const obj={on:true,lock:null,rt:{char:'West',kills:11,exp:250,epic:{step:'pick'}},cfg:{epicMode:true,fishMode:false,nAttack:'Iron Punch'}};
const changes=[];
const chrome={runtime:{getURL:p=>'moz-extension://mock-uuid/'+p},storage:{local:{
 async get(keys){const found={};for(const k of (typeof keys==='string'?[keys]:keys))if(Object.hasOwn(obj,k))found[k]=structuredClone(obj[k]);return found;},
 async set(o){changes.push(Object.keys(o));for(const [k,v] of Object.entries(o))obj[k]=structuredClone(v);}
}}};
const idx=bg.indexOf('const LOCK_TTL ='),end=bg.indexOf('const paint =',idx);
const ctx=vm.createContext({chrome,console,Date,URL,crypto:{randomUUID:()=>String(Math.random())},noteAlive(){}});
vm.runInContext(bg.slice(idx,end)+'\nthis.menuPatch=menuPatch;this.lockCommand=lockCommand;this.statePatch=statePatch;',ctx);
const sender=(id)=>({tab:{id,active:true},frameId:0,url:'https://l2wap.com/battle.html'});
(async()=>{
 const owner=await ctx.lockCommand({cmd:'lockAcquire',page:'/battle.html',vis:true,focus:true},sender(2));
 assert(owner.ok);
 const editor={url:'moz-extension://mock-uuid/popup.html?dock=1'};
 // The docked and normal menus must both authenticate by extension origin/path.
 assert.equal((await ctx.menuPatch({rtPatch:{epicListT:1}},editor)).ok,true);
 assert.equal((await ctx.menuPatch({rtPatch:{epicListT:1}}, {url:'https://l2wap.com/popup.html'})).ok,false);
 const p1=ctx.statePatch({patch:{kills:44},epoch:owner.epoch,src:'bot-2',expectedChar:'West'},sender(2));
 const p2=ctx.menuPatch({rtPatch:{shop:{step:'count'}},cfgPatch:{fishMode:true},on:true},editor);
 const [r1,r2]=await Promise.all([p1,p2]);
 assert(r1.ok&&r2.ok);
 assert.equal(obj.rt.kills,44);
 assert.equal(obj.rt.exp,250);
 assert.equal(obj.rt.epicListT,1);
 assert.equal(obj.rt.shop.step,'count');
 assert.equal(obj.cfg.fishMode,true);
 assert.equal(obj.cfg.nAttack,'Iron Punch');
 const config=await ctx.statePatch({cfgPatch:{nAttack:'Soul Breaker'},epoch:owner.epoch,expectedChar:'West'},sender(2));
 assert(config.ok);
 assert.equal(obj.cfg.nAttack,'Soul Breaker');
 assert.equal(obj.rt.kills,44);
 // UI must not overwrite entire configs/states with stale snapshots.
 assert(!popup.includes('chrome.storage.local.set({ rt: { ...rt'));
 assert(!popup.includes('chrome.storage.local.set({ cfg: { ...cfg'));
 // 14.10: rising-edge автомагистра атомарно сбрасывает только отметку проверки вместе с cfgPatch.
 assert(popup.includes('await menuPatch(magReset, { cfgPatch: n, expectedChar: formChar })'));
 assert(popup.includes('n.autoMagister === true && cfg.autoMagister !== true'));
 console.log('PASS: popup+inline-dock authentication, serialized UI/bot writes, cfg+rt isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});

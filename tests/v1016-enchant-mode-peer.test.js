'use strict';
// 15.10: независимые границы фактических env ядра — режим меняется после получения callback.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),core=read('content.js');
function binding(name){const i=core.indexOf('L2V7Modules.'+name+' = L2V7Factories.'+name+'('),j=core.indexOf('});',i);assert.ok(i>=0&&j>i,name);return core.slice(i,j+3)}
function capture(name){
 const calls=[],c={cfg:{enchantMode:false},rt:{char:'Hero'},on:true,tabOwner:true,fire:node=>{calls.push(node);return true},L2V7Factories:{[name]:env=>env},L2V7Modules:{}};
 vm.runInNewContext(binding(name),c);return {c,calls,env:c.L2V7Modules[name]};
}
for(const name of ['mammon','story','tvtshop','enemies'])test(name+': ранее полученный callback не нажимает кнопку после включения заточки',()=>{
 const f=capture(name),node={id:'native-paid-action'},click=f.env.fire;
 assert.equal(click(node),true);assert.equal(f.calls.length,1);
 f.c.cfg.enchantMode=true;assert.equal(click(node),false);assert.equal(f.calls.length,1);
 f.c.cfg.enchantMode=false;assert.equal(click(node),true);assert.equal(f.calls.length,2);assert.equal(f.calls[1],node);
});
test('реальный clanStep с env ядра не отправляет POST в режиме заточки и снова доступен после выхода',async()=>{
 const f=capture('dailies'),posts=[];
 Object.assign(f.c,{Date,console,location:{pathname:'/map.html'},isBattle:()=>false,rec(){},gamePost:async p=>{posts.push(p);return {ok:true,json:async()=>({})}},setRt:async p=>{Object.assign(f.c.rt,p);return {ok:true}}});
 f.c.cfg.clanTasks=true;f.c.cfg.enchantMode=true;
 f.c.rt.clanTasks={t:Date.now(),me:{id:'hero'},defs:[{id:'kill_monsters',n:'Охота',canTake:true,reward:{}}],active:[]};
 vm.runInNewContext(read('modules/dailies.js'),f.c);const daily=f.c.L2V7Factories.dailies(f.env);
 assert.equal(await daily.clanStep(),false);assert.deepEqual(posts,[]);assert.equal(f.env.on,false);
 f.c.cfg.enchantMode=false;assert.equal(await daily.clanStep(),true);assert.deepEqual(posts,['/game/clan-tasks/kill_monsters/take']);
});
function pvpFixture(){
 const clicks=[],gets=[],nodes={},c={Date,Math,console,location:{pathname:'/map.html',search:''},cfg:{enchantMode:true,autoRevive:true,pvpOnSight:true},rt:{char:'Hero',pvpTargets:{enemy:{id:'enemy',name:'Enemy',enabled:true}}},on:true,tabOwner:true,L2V7Modules:{},
  fire:node=>{clicks.push(node);return true},$q:s=>nodes[s],shown:b=>!!b&&!b.hidden,rec(){},setStatus(){},rtCommit:async()=>true,antibotState:()=>false,abHold:()=>false,
  pause:async()=>{},sleep:async()=>{},waitX:async fn=>fn(),isMap:()=>true,isBattle:()=>false,victory:()=>false,fishNow:()=>false,tvtSoon:()=>false,
  gameGet:async p=>{gets.push(p);return {ok:false}},setRt:async p=>{Object.assign(c.rt,p);return {ok:true}}};
 vm.createContext(c);vm.runInContext(read('modules/pvp.js'),c);vm.runInContext(binding('pvp'),c);
 return {c,clicks,gets,nodes,pvp:c.L2V7Modules.pvp};
}
test('реальный PvP через env ядра завершает обязательный возврат после смерти в режиме заточки',async()=>{
 const f=pvpFixture(),button={id:'map-defeat-tocity'};f.nodes['#map-defeat-tocity']=button;
 f.pvp.capture({name:'Enemy',id:'enemy',ev:'death',scope:'world'});
 assert.equal(await f.pvp.recoveryStep(),true);assert.deepEqual(f.clicks,[button]);assert.equal(f.pvp.pending(),true,'клик не считается подтверждённым воскрешением');
});
test('реальный PvP не начинает новую атаку в режиме заточки; после выхода снова проверяет цель',async()=>{
 const f=pvpFixture();assert.equal(await f.pvp.step(),false);assert.deepEqual(f.gets,[]);assert.deepEqual(f.clicks,[]);
 f.c.cfg.enchantMode=false;assert.equal(await f.pvp.step(),false);assert.deepEqual(f.gets,['/character']);assert.deepEqual(f.clicks,[]);
});
test('смена режима при очистке устаревшего rbGo не начинает следующий zoneScan',async()=>{
 const calls=[],c={Date,on:true,tabOwner:true,cfg:{enchantMode:false},rt:{rbGo:{t:Date.now()-120000},zoneScan:true},location:{href:''},
  isBattle:()=>false,isTeleport:()=>false,huntOn:()=>false,farmRbOn:()=>false,sleep:async()=>{},rbGoStep:async()=>{calls.push('rbGo')},zoneCatalogScan:async()=>{calls.push('zoneScan')}};
 c.autonomyMode=()=>c.cfg.enchantMode?'enchant':'farm';
 c.setRt=async patch=>{calls.push('clear');Object.assign(c.rt,patch);c.cfg.enchantMode=true;return {ok:true}};
 const start=core.indexOf('      if (rt.rbGo && !isBattle()) {'),end=core.indexOf('      if (rt.zoneGo && !isBattle()) {',start);assert.ok(start>0&&end>start);
 await vm.runInNewContext('(async()=>{while(on){if(autonomyMode()==="enchant")break;'+core.slice(start,end)+'\nbreak;}})()',c);
 assert.equal(c.rt.rbGo,null);assert.equal(c.cfg.enchantMode,true);assert.deepEqual(calls,['clear']);assert.equal(c.location.href,'');
});

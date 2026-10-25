'use strict';
// 20.41 (замер цикла катакомб, память 1,3 МБ: на моба 4 полные записи памяти по ≈0,65 с, экран победы ждал запись начала боя за ними,
// а список подземелья ≈0,3 с — «Охотиться дальше»): статистика обычного боя пишется отложенным пакетом, список подземелья для
// следующего моба читается уже в начале боя и переиспользуется на победе.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
function writer(){
 const src=read('content.js'),a=src.indexOf('function setRt(p) {'),b=src.indexOf(']);',src.indexOf('const RT_STAT_SOON',a))+']);'.length;   // 20.62: конец набора RT_STAT_SOON — не по последнему ключу
 const calls=[],c={rt:{char:'Hero'},rtSizeT:Date.now(),rtBigWarnT:0,RT_BULKY:['spawns'],rec(){},rtSizeTop:()=>'',tabIdle:false,document:{},Date,JSON,Object,Math,
  rtWriter:{defer:(p,ms)=>{calls.push(['defer',Object.keys(p).sort().join(','),ms]);return Promise.resolve({ok:true,deferred:true})},enqueue:p=>{calls.push(['enqueue',Object.keys(p).sort().join(',')]);return Promise.resolve({ok:true})}}};
 vm.runInNewContext(src.slice(a,b).replace(/^const RT_STAT_SOON/m,'globalThis.RT_STAT_SOON'),c);return {c,calls};
}
test('статистика победы — отложенным пакетом, память вкладки сразу',async()=>{
 const {c,calls}=writer();await c.setRt({kills:5,sinceDeep:2,target:null,adena:10,exp:20,sp:3});
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['defer','adena,exp,kills,sinceDeep,sp,target',8000]]);assert.equal(c.rt.kills,5);
 calls.length=0;for(const p of [{dps:{n:1}},{lootStat:{}},{lastWinT:1},{skills:{}},{via:'chain',catInT:1},{packLab:{},lastBattle:'/battle.html'}])await c.setRt(p);
 assert.ok(calls.every(x=>x[0]==='defer'),JSON.stringify(calls));
});
test('прочие записи (управление, метки, смешанные) — как раньше, сразу',async()=>{
 const {c,calls}=writer();
 for(const p of [{hardMobs:{}},{target:{name:'X'},mobClickAt:1,via:'dungeon',catInT:1},{kills:1,campaignDue:true},{battleReload:0},{farmQuota:{}}])await c.setRt(p);
 assert.ok(calls.every(x=>x[0]==='enqueue'),JSON.stringify(calls));assert.equal(calls.length,5);
});
test('бой: список подземелья читается в начале боя, на победе переиспользуется (до 4 с)',async()=>{
 const f=flowFixture('fighter'),seen=[];f.env.catPrefetch=ms=>{seen.push(ms||0);f.events.push('prefetch:'+(ms||0))};
 await f.combat.battle();
 const e=f.events,i0=e.indexOf('prefetch:0'),hit=e.indexOf('Атака'),i1=e.indexOf('prefetch:4000');
 assert.ok(i0>=0&&i0<hit,'до первого удара: '+e.join(' '));assert.ok(i1>hit&&i1<e.indexOf('hunt'),'на победе, до продолжения: '+e.join(' '));
 assert.deepEqual(seen,[0,4000]);
});
function dungeons(){
 let now=1_000_000;const gets=[],loc={pathname:'/battle.html',search:'?spawnId=sdms_necropolis_of_martyrdom_013',href:'https://l2wap.com/battle.html?spawnId=sdms_necropolis_of_martyrdom_013'};
 class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
 const env={cfg:{chain:true},rt:{},autonomyMode:()=> 'cat',gameGet:async p=>{gets.push(p);return{ok:true,json:async()=>({dungeon:{id:'x',mobs:[]}})}}};
 const box={console,Date:Clock,Math,URLSearchParams,document:{querySelectorAll:()=>[]},location:loc};
 vm.runInNewContext(read('modules/dungeons.js'),box);
 return {D:box.L2V7Factories.dungeons(env),gets,loc,step:ms=>now+=ms};
}
test('catPrefetch: свежий список той же страницы не перечитывается, старый и чужой — перечитываются',()=>{
 const {D,gets,loc,step}=dungeons();
 D.catPrefetch();assert.equal(gets.length,1);
 step(2500);D.catPrefetch(4000);assert.equal(gets.length,1,'моложе 4 с — тот же запрос');
 step(2000);D.catPrefetch(4000);assert.equal(gets.length,2,'старше 4 с — заново');
 loc.search='?spawnId=sdms_necropolis_of_martyrdom_032';loc.href='https://l2wap.com/battle.html'+loc.search;D.catPrefetch(4000);assert.equal(gets.length,3,'новый бой — свой список');
 D.catPrefetch();assert.equal(gets.length,4,'без срока — всегда заново (прежнее поведение)');
});
test('ядро передаёт срок переиспользования в модуль подземелий',()=>{
 assert.match(read('content.js'),/get catPrefetch\(\)\{return ms=>L2V7Modules\.dungeons\?\.catPrefetch\?\.\(ms\)\}/);
});
// 20.41 (ревью: ↺ сессии в меню в пределах 8 с после победы откатывался отложенной статистикой).
test('очередь: drop убирает ключи из обычной и отложенной очереди, остальное пишется',async()=>{
 const core=require('../engine-core.js'),sent=[],timers=[];
 const q=core.createPatchQueue(async b=>{sent.push(b);return{ok:true}},()=>true,()=>{},()=>Date.now(),{set:f=>timers.push(f),clear(){}});
 q.defer({kills:58,exp:1100,lootStat:{a:1}});q.drop(['kills','exp']);assert.deepEqual(Object.keys(q.peek()),['lootStat']);
 timers[0]();await new Promise(r=>setImmediate(r));assert.deepEqual(JSON.parse(JSON.stringify(sent)),[{lootStat:{a:1}}]);
});
test('изменение памяти из меню снимает свои неотправленные значения тех же ключей до пересборки rt',()=>{
 const src=read('content.js'),a=src.indexOf('chrome.storage.onChanged.addListener(ch => {'),b=src.indexOf('const timerPrevious = rt;',a),part=src.slice(a,b);
 assert.match(part,/_src === 'menu'[\s\S]*rtWriter\.drop\(keys\)/);assert.match(part,/JSON\.stringify\(o\[k\]\) !== JSON\.stringify\(n\[k\]\)/);
});
// 20.41 (ревью 2): уход со страницы (pageLeaving) остаток уже отправил pagehide — здесь только уход вкладки в фон.
test('вкладка уходит в фон: отложенная статистика пишется сразу (recover), пока замок ещё у неё',()=>{
 const src=read('content.js');assert.match(src,/addEventListener\('visibilitychange', \(\) => \{ if \(document\.hidden && !pageGone && tabOwner && leaseEpoch && !tabIdle\) rtWriter\.recover\(\)/);
 const core=require('../engine-core.js'),sent=[],q=core.createPatchQueue(async b=>{sent.push(b);return{ok:true}},()=>true,()=>{},()=>Date.now(),{set:()=>0,clear(){}});
 q.defer({exp:5});return q.recover().then(()=>assert.deepEqual(JSON.parse(JSON.stringify(sent)),[{exp:5}]));
});

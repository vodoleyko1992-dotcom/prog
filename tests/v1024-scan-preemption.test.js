'use strict';
// 10.0.24: TvT/смена режима прерывают ожидание DOM, а не только запрещают следующий клик.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8'),cases=[],test=(n,f)=>cases.push([n,f]);
for(const at of ['initial','row'])test(`farmScan уступает приоритет во время ${at} waitX`,async()=>{
 let allowed=true,clicks=0,parsed=0,polls=0;const writes=[];
 const button={getAttribute:()=>false},row={closest:()=>null,querySelector:s=>s==='.l2-farm-row__name'?{textContent:'Iron Ore'}:s==='.l2-farm-row__toggle'?button:null};
 const box={on:true,tabOwner:true,rt:{farmScan:true},L2V7Modules:{actions:{canAct:()=>allowed}},setStatus(){},$q:()=>at==='initial'?null:{},farmIcons:async()=>{},document:{body:{tagName:'BODY',querySelectorAll:s=>s==='.l2-farm-row'?Array(200).fill(row):[]}},fire(){clicks++},farmRowParse(){parsed++;return{}},setRt:async p=>writes.push(p),farmSave:async()=>{},draw(){},sleep:async()=>{},rnd:()=>0,rec(){}};
 box.waitX=async fn=>{polls++;const first=fn();if(first)return first;allowed=false;const interrupted=fn();assert.ok(interrupted,'ожидание прекращается при прерывании');return interrupted};
 const source=read('content.js');vm.runInNewContext(source.slice(source.indexOf('async function farmScan()'),source.indexOf('// раздел строки:'))+'\nthis.run=farmScan',box);await box.run();
 assert.equal(parsed,0);assert.equal(clicks,at==='row'?1:0);assert.equal(polls,at==='row'?2:1);assert.equal(writes.length,0);
});
for(const at of ['ready','rows'])test(`zoneCatalogScan уступает во время ${at}`,async()=>{
 let allowed=true,clicks=0,sleeps=0,polls=0;const writes=[];
 const block={querySelector:()=>null,querySelectorAll:()=>[]},button={dataset:{surroundingsKey:'giran'},closest:()=>block};
 const env={on:true,tabOwner:true,rt:{zoneScan:true},canAct:()=>allowed,setStatus(){},setRt:async p=>writes.push(p),fire(){clicks++},sleep:async()=>{sleeps++;if(at==='ready')allowed=false},rnd:()=>0,waitX:async fn=>{polls++;assert.equal(!!fn(),false);allowed=false;assert.ok(fn());return true}};
 const box={env,document:{querySelectorAll:()=>Array(50).fill(button)},zoneRows:()=>{throw Error('после прерывания не читаем следующие города')}};
 const source=read('modules/navigation.js'),start=source.indexOf('async function tpCitiesReady('),end=source.indexOf('// 8.0.3 (лог 11.10 10:32:55)',start);vm.runInNewContext(source.slice(start,end)+'\nthis.run=zoneCatalogScan',box);await box.run();assert.equal(writes.length,0);assert.equal(clicks,at==='ready'?0:1);assert.equal(polls,at==='ready'?0:1);assert.ok(sleeps<=4);
});
test('rbListScan прекращает waitX страниц и оставляет незавершённый скан в очереди',async()=>{
 const {mk,docOf}=require('./epic-harness.cjs');let allowed=true,polls=0;
 const m=mk({path:'/rb-bosses.html',search:'?page=1',doc:docOf('<div id="rb-pager-ind">1 / 2</div><div id="rb-list"><div class="l2-rb-row"><span class="l2-rb-row__label">Boss</span><span class="l2-rb-row__level">50</span><span class="l2-rb-row__status l2-rb-row__status--alive">Жив</span><button class="l2-rb-row__tp" data-spawn-id="boss">Телепорт</button></div></div><button id="rb-pager-next">Дальше</button>'),rt:{rbScan:true,rbList:{}},env:{canAct:()=>allowed,rnd:()=>0}});
 m.env.fire=()=>true;m.env.waitX=async fn=>{polls++;if(fn())return true;allowed=false;assert.ok(fn(),'waitX заканчивается при TvT');return true};
 await m.R.rbListScan();assert.equal(polls,2);assert.equal(m.env.rt.rbScan,true);assert.equal(Object.keys(m.env.rt.rbList).length,0);assert.equal(m.loc.href,'');
});
(async()=>{for(const[n,f]of cases){await f();console.log('PASS:',n)}})().catch(e=>{console.error(e);process.exitCode=1});

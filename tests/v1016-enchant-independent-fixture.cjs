'use strict';
// 15.10: выполнение серии требует явно выбранного отдельного режима заточки.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(process.env.ENCHANT_REVIEW_SOURCE || path.join(__dirname,'..','modules','enchant.js'),'utf8'),copy=x=>JSON.parse(JSON.stringify(x));
const cases=[];const test=(name,fn)=>cases.push([name,fn]);
function fixture(opts={}) {
 let clock=1000000;class Clock extends Date{static now(){return clock}}
 const snap={revision:7,adena:1000000,inventory:{eq:{l1:{itemId:8688,enchant:opts.level??3,enchantPAtkBonus:0,enchantMAtkBonus:(opts.level??3)*6}},stacks:[{itemId:910517,qty:20},{itemId:910527,qty:20},{itemId:4037,qty:200}]}},
 hints={itemSlotHints:{8688:'rhand',2376:'chest'},itemGradeHints:{8688:'A',2376:'B'},itemNamesEn:{8688:'Daimon Crystal',2376:'Avadon Breastplate'}},posts=[],tasks=[],events=[];
 const location={pathname:'/enchant.html',search:'?target=eq%3Al1&mode=magic',href:'',reload(){events.push('reload')}};
 const radios=[...['scroll:910517','scroll:910527'].map(value=>({value,name:'pay',checked:value==='scroll:910527'})),...['physical','magic','balanced'].map(value=>({value,name:'wmode',checked:value==='magic'}))];
 const count={value:'1',dispatchEvent(){}},button={disabled:false},panel={hidden:false};
 let module,afterSet=null,onGet=null,onPause=null,postedMode='normal',outcomes=[...(opts.outcomes||[true])];
 const q=sel=>{
  if(sel==='#enchant-target-panel')return panel;if(sel==='#enchant-submit')return button;if(sel==='#enchant-count')return count;
  if(sel==='.l2-enchant-selected-card__name')return {textContent:'+'+(opts.panelLevel??snap.inventory.eq.l1?.enchant??0)+' Daimon Crystal'};
  if(sel==='#enchant-scroll-chance')return {textContent:`Шанс успіху: ${opts.chance??(radios.find(x=>x.name==='pay'&&x.checked)?.value==='scroll:910517'?60:100)}%`};
  const m=sel.match(/input\[name="([^"]+)"\](?:\[value="([^"]+)"\]|:checked)/);if(m)return radios.find(x=>x.name===m[1]&&(m[2]?x.value===m[2]:x.checked));return null;
 };
 const env={cfg:{enchantMode:true,enchant:{enabled:true,maxAttempts:10,maxScrolls:10,scrollPolicy:opts.policy||'blessed',maxDropFromStart:5,maxDropFromPeak:5,maxConsecutiveFails:5}},rt:{},on:true,tabOwner:true,
  setRt:async p=>{Object.assign(env.rt,p);await afterSet?.(p);return {ok:true};},gameGet:async url=>{await onGet?.(url);return {ok:true,json:async()=>copy(url==='/character'?{character:snap}:hints)}},awayFree:()=>true,rec(){},setStatus:s=>events.push(s),
  waitX:async fn=>fn(),pause:async()=>onPause?.(),$q:q,fire:el=>{
   if(el===button){if(postedMode==='refused')return false;
    const selected=radios.find(x=>x.name==='pay'&&x.checked),req={expectedRevision:opts.requestRevision??snap.revision,targetInstanceId:new URLSearchParams(location.search).get('target'),payment:'scroll',count:+count.value,scrollItemId:+selected.value.slice(7),weaponEnchantMode:radios.find(x=>x.name==='wmode'&&x.checked).value};
    posts.push(copy(req));if(postedMode==='timeout')return true;
    if(postedMode==='409'){tasks.push(module.note(req,{},409));return true;}
    if(postedMode==='423'){tasks.push(module.note(req,{},423));return true;}
    const before=snap.inventory.eq.l1.enchant,ok=outcomes.length?outcomes.shift():true,after=ok?before+1:Math.max(0,before-1);
    snap.inventory.eq.l1.enchant=after;snap.inventory.eq.l1.enchantMAtkBonus=after*6;snap.revision++;snap.inventory.stacks.find(x=>x.itemId===req.scrollItemId).qty--;
    if(postedMode==='col')snap.inventory.stacks.find(x=>x.itemId===4037).qty--;
    const res={attemptedCount:1,successCount:+ok,failCount:+!ok,scrollConsumedCount:1,coinConsumed:postedMode==='col',previousEnchantLevel:before,currentEnchantLevel:after,updatedTargetInstanceId:req.targetInstanceId};
    tasks.push(module.note(req,res,200));return true;
   }
   if(el?.name){radios.filter(x=>x.name===el.name).forEach(x=>x.checked=x===el);return true;}return false;
  }};
 function create(){const box={console,Date:Clock,Math,location,URLSearchParams,Event:class{constructor(type,x){this.type=type;Object.assign(this,x)}},document:{querySelector:q}};vm.runInNewContext(source,box);return module=box.L2V7Factories.enchant(env)}
 create();
 const f={env,snap,hints,posts,events,location,radios,count,button,get M(){return module},create,advance:n=>clock+=n??2000,flush:async()=>{await Promise.all(tasks.splice(0))},
  set afterSet(f){afterSet=f},set onGet(f){onGet=f},set onPause(f){onPause=f},set mode(x){postedMode=x}};
 f.start=async()=>{const scan=await module.readItems(),candidate=scan.items.find(x=>x.targetInstanceId==='eq:l1');env.cfg.enchant.queue=[{...candidate,key:'weapon',targetLevel:opts.target??5,weaponMode:'magic',rules:opts.rules||{}}];return module.command('start')};
 f.tick=async()=>{f.advance();const r=await module.step();await f.flush();return r};return f;
}

module.exports={fixture};

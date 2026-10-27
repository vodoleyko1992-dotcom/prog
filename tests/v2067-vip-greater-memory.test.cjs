'use strict';
// 27.10.2026 (лог 01:47): вручную выбранный Magnus после Cancel должен возвращаться из своей подтверждённой квитанции.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.L2_TEST_ROOT||path.resolve(__dirname,'..');
const source=fs.readFileSync(process.env.VIP_BUFF_SOURCE||path.join(root,'modules/buffs.js'),'utf8');
const raw=JSON.parse(fs.readFileSync(path.join(root,'kb/raw/buffer-catalog.json'),'utf8'));
const GROUP=[1356,1357,1355,1363,1413,1414],RES=[1033,1182,1189,1191,1352],clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 let now=Date.now(),beforePause=null,lostFor=0,unknownFor=0;
 const catalog=clone(raw.data||raw),posts=[],events=[],loc={pathname:'/town-buffer.html',href:''};
 const row=id=>catalog.sets.find(x=>x.id===id);
 for(const id of ['mage','greater','resists']){row(id).feeAdena='0';row(id).feeCoinOfLuck=0;}
 const ch={name:'Hero',id:'own-wizard',level:35,revision:100,hp:1000,maxHp:1000,inBattle:false,classBranch:'mystic',l2Profession:'human_wizard',classSlots:{activeSlot:0},vip:{active:true,vipUntil:new Date(now+86400000).toISOString()},activeBuffs:[]};
 const env={on:true,tabOwner:true,leaseEpoch:'lease',cfg:{townBuffSet:'basic',vipBuffAuto:true,faBuffs:'',rbSessBuffs:'auto'},rt:{char:ch.name,manualKickAt:1,classCur:{prof:ch.l2Profession,slot:0}},routeLocation:loc,
  TB_KEYS:{basic:[1068,1045],mage:row('mage').skills.map(x=>x.skillId)},FA_KNOWN:{},IL:{},
  $q:s=>s==='#l2-hud-active-buffs'?{querySelectorAll:()=>ch.activeBuffs.map(x=>({dataset:{skillId:String(x.skillId),expiresAt:String(x.expiresAtMs)},getAttribute:k=>k==='title'?'Buff · Lv.'+x.level:''}))}:null,
  shown:()=>false,waitX:async fn=>fn(),sleep:async()=>{},pause:async()=>{if(beforePause){const fn=beforePause;beforePause=null;fn();}},
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true};},rtCommit:async()=>true,rec:(...xs)=>events.push(xs.join(' ')),setStatus:s=>events.push(s),autonomyMode:()=> 'farm',
  payments:{blocked:()=>false,pending:()=>null,prepare:async()=>{throw Error('VIP не оплачивает валюту');}},
  gameGet:async p=>({ok:true,status:200,json:async()=>clone(p==='/character'?{character:ch}:catalog)}),
  gamePost:async(p,q)=>{
   posts.push({path:p,...clone(q)});
   assert.equal(p,'/character/town/buffer');assert.equal(q.expectedFeeAdena,'0');assert.equal(q.expectedFeeCoinOfLuck,0);
   const selected=row(q.set);assert.ok(selected);assert.equal(selected.feeAdena,'0');assert.equal(selected.feeCoinOfLuck,0);
   assert.equal(q.expectedRevision,ch.revision);
   if(q.set==='greater'){assert.ok(Number.isSafeInteger(q.skillId));assert.ok(selected.skills.some(x=>x.skillId===q.skillId));}
   if(q.skillId===unknownFor)throw Error('запрос отправлен, результат неизвестен');
   const skills=selected.pickByIcon?selected.skills.filter(x=>x.skillId===q.skillId):selected.skills;
   ch.revision++;for(const x of skills)install([x.skillId],x.level);
   if(q.skillId===lostFor)throw Error('ответ успешного применения потерян');
   return {ok:true,status:200,json:async()=>({character:clone(ch)})};
  }
 };
 function install(ids,level){for(const id of ids){const skill=catalog.sets.flatMap(x=>x.skills).find(x=>x.skillId===id);assert.ok(skill,'навык есть в каталоге '+id);
  ch.activeBuffs=ch.activeBuffs.filter(x=>x.skillId!==id&&(!GROUP.includes(id)||!GROUP.includes(x.skillId)));
  ch.activeBuffs.push({...skill,level:level||skill.level,expiresAtMs:now+86400000});}}
 let B;
 function load(){class Clock extends Date{static now(){return now;}}const box={console,Date:Clock,Math,document:{querySelectorAll:()=>[]}};vm.runInNewContext(source,box);B=box.L2V7Factories.buffs(env);B.vipNote(ch);}
 function open(){env.rt.tbuff={t:++now,step:'town',set:'mage',vipFree:true,fa:[]};}
 const remove=ids=>{ch.activeBuffs=ch.activeBuffs.filter(x=>!ids.includes(x.skillId));};
 load();open();
 return {env,ch,catalog,posts,events,install,row,remove,open,get B(){return B;},reload(){env.rt=clone(env.rt);load();},
  set beforePause(fn){beforePause=fn;},set lostFor(id){lostFor=id;},set unknownFor(id){unknownFor=id;},
  async ticks(n=12){for(let i=0;i<n&&env.rt.tbuff&&env.on;i++)await B.townBuffStep();},
  greater(){return posts.filter(x=>x.set==='greater'&&GROUP.includes(x.skillId)).map(x=>x.skillId);},
  activeGroup(){return ch.activeBuffs.filter(x=>GROUP.includes(x.skillId)&&x.expiresAtMs>now).map(x=>x.skillId);},
  async confirmMagnus(){for(const x of row('mage').skills)install([x.skillId],x.level);install([1413,1323]);await this.ticks();assert.equal(B.vipSession().ready,true);assert.ok(env.rt.vipApplied.greaterIds.includes(1413));}
 };
}
function full(f,id=1413){assert.equal(f.env.rt.tbuff,null);assert.equal(f.B.vipSession().ready,true);assert.deepEqual(f.activeGroup(),[id]);
 const want=[...f.row('mage').skills.map(x=>x.skillId),id,1323,...RES];assert.ok(want.every(id=>f.ch.activeBuffs.some(x=>x.skillId===id)));}

test('Wizard35: подтверждённый ручной Magnus восстанавливается после Cancel вместе с mage, Noblesse и резистами',async()=>{
 const f=fixture();await f.confirmMagnus();const n=f.posts.length;f.remove([1413,1323,1059,1352]);assert.equal(f.B.vipSession().ready,false);assert.equal(f.B.townBuffNeed()?.vipFree,true);
 f.open();await f.ticks();assert.deepEqual(f.posts.slice(n).map(x=>[x.set,x.skillId]),[['mage',undefined],['greater',1413],['greater',1323],['resists',undefined]]);full(f);
});
test('выбор Magnus переживает сериализацию памяти и загрузку нового модуля',async()=>{
 const f=fixture();await f.confirmMagnus();f.remove([1413]);f.reload();f.open();await f.ticks();assert.deepEqual(f.greater(),[1413]);full(f);
});
test('живой вручную заменённый Greater важнее памяти; новая квитанция сохраняет уже его',async()=>{
 const f=fixture();await f.confirmMagnus();f.install([1356]);f.remove([1352]);f.open();await f.ticks();assert.deepEqual(f.greater(),[]);full(f,1356);
 f.remove([1356]);f.open();await f.ticks();assert.deepEqual(f.greater(),[1356]);full(f,1356);
});
test('истекающий живой ручной Greater обновляется собой, даже если в памяти другой выбор',async()=>{
 const f=fixture();await f.confirmMagnus();f.install([1356]);f.ch.activeBuffs.find(x=>x.skillId===1356).expiresAtMs=Date.now()+30000;
 f.open();await f.ticks();assert.deepEqual(f.greater(),[1356]);full(f,1356);
});
test('живой эффект ниже уровня свежего каталога не подменяет подтверждённый выбор',async()=>{
 const f=fixture();await f.confirmMagnus();f.install([1356]);f.ch.activeBuffs.find(x=>x.skillId===1356).level=0;
 f.open();await f.ticks();assert.deepEqual(f.greater(),[1413]);full(f);
});
for(const key of ['faBuffs','rbSessBuffs'])test('явный '+key+' важнее живого Greater и сохранённого Magnus',async()=>{
 const f=fixture();await f.confirmMagnus();f.env.cfg[key]='1414,1323';f.open();await f.ticks();assert.deepEqual(f.greater(),[1414]);full(f,1414);
});
for(const change of ['character','actor','profession','slot','set','schema','unchecked','catalog','malformed','ambiguous'])test('чужой или неподтверждённый выбор игнорируется: '+change,async()=>{
 const f=fixture();await f.confirmMagnus();const p=f.env.rt.vipApplied;
 if(change==='character')p.char='Other';if(change==='actor')p.actor='another-actor';if(change==='profession')p.prof='human_warlock';if(change==='slot')p.slot=1;
 if(change==='set')p.set='warrior';if(change==='schema')p.schema=1;if(change==='unchecked')p.bundleChecked=false;
 if(change==='catalog')f.row('greater').skills=f.row('greater').skills.filter(x=>x.skillId!==1413);
 if(change==='malformed')p.greaterIds=1413;if(change==='ambiguous')p.greaterIds=[1413,1356,1323];
 f.remove([1413]);f.open();await f.ticks();assert.deepEqual(f.greater(),[1357]);full(f,1357);
});
test('новый Wizard без подтверждённого ручного выбора сохраняет прежний автоматический Water',async()=>{
 const f=fixture();await f.ticks();assert.deepEqual(f.greater(),[1357]);full(f,1357);
});
test('истёкший VIP не разрешает восстановление платного Magnus из памяти',async()=>{
 const f=fixture();await f.confirmMagnus();f.remove([1413]);f.ch.vip={active:false,vipUntil:new Date(Date.now()-1000).toISOString()};f.row('greater').feeCoinOfLuck=5;
 f.open();const n=f.posts.length;await f.ticks(1);assert.equal(f.posts.length,n);assert.equal(f.env.rt.tbuff.vipFree,false);assert.equal(f.env.rt.tbuff.set,'basic');
});
for(const fee of ['5',undefined])test('CoL '+String(fee)+' не оплачивается ради сохранённого Magnus',async()=>{
 const f=fixture();await f.confirmMagnus();f.remove([1413]);if(fee===undefined)delete f.row('greater').feeCoinOfLuck;else f.row('greater').feeCoinOfLuck=fee;
 f.open();const n=f.posts.length;await f.ticks();assert.equal(f.posts.length,n);assert.equal(f.B.vipSession().ready,false);assert.ok(!f.env.rt.vipApplied.greaterIds.includes(1413));
});
test('потерянный успешный ответ Magnus сверяется после reload без второго POST',async()=>{
 const f=fixture();await f.confirmMagnus();f.remove([1413]);f.lostFor=1413;f.open();await f.ticks(1);assert.equal(f.env.rt.tbuff.vipRequest.phase,'sent');f.reload();await f.ticks();assert.deepEqual(f.greater(),[1413]);full(f);
});
test('неизвестный исход Magnus остаётся sent после reload, без повтора и подмены Water',async()=>{
 const f=fixture();await f.confirmMagnus();f.remove([1413]);f.unknownFor=1413;f.open();await f.ticks(1);f.reload();await f.ticks();assert.deepEqual(f.greater(),[1413]);assert.equal(f.env.rt.tbuff.vipRequest.phase,'sent');assert.equal(f.B.vipSession().ready,false);
});
for(const change of ['Stop','lease','class','disabled'])test('сохранённый выбор не обходит отмену перед отправкой: '+change,async()=>{
 const f=fixture();await f.confirmMagnus();f.remove([1413]);f.open();const n=f.posts.length;
 f.beforePause=()=>{if(change==='Stop')f.env.on=false;if(change==='lease')f.env.leaseEpoch='new';if(change==='class')f.env.rt.classCur.slot=1;if(change==='disabled')f.env.cfg.vipBuffAuto=false;};
 await f.ticks(1);assert.equal(f.posts.length,n);
});

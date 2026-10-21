'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(process.env.VIP_BUFF_SOURCE||path.join(root,'modules/buffs.js'),'utf8');
function fixture(){
 const now=Date.now(),events=[],posts=[],loc={pathname:'/town-buffer.html',href:''},H={};let pause=()=>{},lost=false,applied=true,status=200;
 const ch={name:'Hero',id:'actor',revision:10,hp:1000,inBattle:false,classBranch:'fighter',l2Profession:'dwarf_bounty_hunter',classSlots:{activeSlot:1},vip:{active:true,vipUntil:new Date(now+30*86400000).toISOString()},activeBuffs:[]};
 const skills=id=>[{skillId:id,level:3,durationSec:86400},{skillId:1045,level:5,durationSec:86400}];
 const catalog={sets:[{id:'warrior',feeAdena:'0',feeCoinOfLuck:0,skills:skills(1068)},{id:'mage',feeAdena:'0',feeCoinOfLuck:0,skills:skills(1059)}]};
 const env={on:true,tabOwner:true,leaseEpoch:1,cfg:{townBuffSet:'basic',vipBuffAuto:true,faBuffs:''},rt:{char:'Hero',manualKickAt:1,classCur:{slot:1},tbT:now-20*60000,tbuff:{t:now,step:'town',set:'warrior',vipFree:true,fa:[]}},TB_KEYS:{basic:[1068,1268,1086,1045],warrior:[1068,1045],mage:[1059,1045]},FA_KNOWN:{},IL:{},routeLocation:loc,
 $q:s=>s==='#l2-hud-active-buffs'?{querySelectorAll:()=>Object.entries(H).map(([id,e])=>({dataset:{skillId:id,expiresAt:e},getAttribute:k=>k==='title'?'Buff · Lv.'+(ch.activeBuffs.find(b=>b.skillId===+id)?.level||0):''}))}:null,
 setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rtCommit:async()=>true,sleep:async()=>{},waitX:async()=>null,shown:()=>false,pause:async()=>pause(),rec:(...a)=>events.push(a.join(' ')),setStatus:s=>events.push(s),autonomyMode:()=> 'farm',
 payments:{blocked:()=>false,pending:()=>null,prepare:async()=>{throw Error('VIP must not reserve paid currency')}},
 gameGet:async p=>({ok:true,json:async()=>structuredClone(p==='/character'?{character:ch}:catalog)}),
 gamePost:async(p,q)=>{posts.push({p,q});assert.equal(p,'/character/town/buffer');assert.equal(q.expectedFeeAdena,'0');assert.equal(q.expectedFeeCoinOfLuck,0);
  if(applied&&status===200){ch.revision++;ch.activeBuffs=catalog.sets.find(x=>x.id===q.set).skills.map(x=>({...x,expiresAtMs:Date.now()+86400000}));}
  if(lost)throw Error('lost');return{ok:status===200,status,json:async()=>status===200?{character:structuredClone(ch)}:{error:'price_changed'}};
 }};
 const box={console,Date,Math,document:{querySelectorAll:()=>[]}};vm.runInNewContext(source,box);const B=box.L2V7Factories.buffs(env);
 return{env,B,ch,catalog,H,posts,events,loc,set pause(f){pause=f},set lost(v){lost=v},set applied(v){applied=v},set status(v){status=v}};
}

// 20.37: Greater выбирается отдельной иконкой; сервер без skillId отвечает отказом.
// Шесть Greater исключают друг друга, Noblesse1323 сохраняется независимо.
function greaterFixture(){
 const f=fixture();f.catalog.sets.push({id:'greater',pickByIcon:true,feeAdena:'0',feeCoinOfLuck:0,skills:[{skillId:1356,level:1},{skillId:1323,level:1}]});
 f.env.gamePost=async(p,q)=>{
  f.posts.push({p,q});assert.equal(p,'/character/town/buffer');assert.equal(q.expectedFeeAdena,'0');assert.equal(q.expectedFeeCoinOfLuck,0);
  if(f.reject){return{ok:false,status:409,json:async()=>({error:'price_changed'})};}
  const row=f.catalog.sets.find(x=>x.id===q.set),group=[1356,1357,1355,1363,1413,1414];
  if(q.set==='greater'&&(!Number.isSafeInteger(q.skillId)||!row.skills.some(x=>x.skillId===q.skillId)))return{ok:false,status:400,json:async()=>({error:'skill_required'})};
  if(f.apply!==false){
   f.ch.revision++;const rows=q.set==='greater'?row.skills.filter(x=>x.skillId===q.skillId):row.skills;
   f.ch.activeBuffs=[...f.ch.activeBuffs.filter(b=>!rows.some(x=>x.skillId===b.skillId||group.includes(x.skillId)&&group.includes(b.skillId))),...rows.map(x=>({...x,expiresAtMs:Date.now()+86400000}))];
   for(const id of Object.keys(f.H))delete f.H[id];for(const b of f.ch.activeBuffs)f.H[b.skillId]=b.expiresAtMs;
  }
  if(f.lose===q.set)throw Error('lost response');
  return{ok:true,status:200,json:async()=>({character:structuredClone(f.ch)})};
 };
 return f;
}
const step=async(f,n=1)=>{for(let i=0;i<n;i++)await f.B.townBuffStep();};
test('перед возвращением нужны классовый набор и отдельные Greater/Noblesse иконки',async()=>{
 const f=greaterFixture();await step(f);assert.deepEqual(f.posts.map(x=>x.q.set),['warrior']);assert.ok(f.env.rt.tbuff,'после обычного набора маршрут не окончен');assert.notEqual(f.B.vipSession()?.ready,true);
 await step(f);assert.deepEqual(f.posts.map(x=>x.q.set),['warrior','greater']);assert.ok(f.env.rt.tbuff,'без Noblesse подготовка не окончена');assert.equal(f.posts[1].q.skillId,1356);
 await step(f);assert.deepEqual(f.posts.map(x=>x.q.set),['warrior','greater','greater']);assert.equal(f.posts[2].q.skillId,1323);assert.equal(f.env.rt.tbuff,null);assert.equal(f.env.rt.vipApplied.schema,2);assert.equal(f.env.rt.vipApplied.set,'warrior');assert.equal(f.env.rt.vipApplied.bundleChecked,true);assert.ok(f.env.rt.vipApplied.ids.includes(1356));assert.ok(f.env.rt.vipApplied.ids.includes(1323));assert.equal(f.B.vipSession().ready,true);
});
test('уже действующий классовый бафф не применяется снова ради сильного',async()=>{
 const f=greaterFixture();f.ch.activeBuffs=f.catalog.sets[0].skills.map(x=>({...x,expiresAtMs:Date.now()+86400000}));await step(f,2);assert.deepEqual(f.posts.map(x=>x.q.set),['greater','greater']);assert.deepEqual(f.posts.map(x=>x.q.skillId),[1356,1323]);assert.equal(f.env.rt.tbuff,null);
});
test('уже действующие оба набора завершают визит без POST',async()=>{
 const f=greaterFixture();f.ch.activeBuffs=f.catalog.sets.flatMap(x=>x.id==='mage'?[]:x.skills.map(y=>({...y,expiresAtMs:Date.now()+86400000})));await step(f);assert.equal(f.posts.length,0);assert.equal(f.env.rt.tbuff,null);
});
for(const [name,change]of Object.entries({paidAdena:r=>r.feeAdena='1',paidCoin:r=>r.feeCoinOfLuck=5,unknownFee:r=>r.feeFastAden=1,nullFee:r=>r.feeAdena=null,missingFee:r=>delete r.feeCoinOfLuck,emptySkills:r=>r.skills=[]}))test('сильный набор не покупается при '+name,async()=>{
 const f=greaterFixture();change(f.catalog.sets[2]);await step(f);assert.deepEqual(f.posts.map(x=>x.q.set),['warrior']);assert.equal(f.env.rt.tbuff,null);assert.equal(f.env.rt.vipApplied.bundleChecked,true);assert.equal(f.B.vipSession().ready,false,'платный/неизвестный Greater не объявлен готовым');
});
test('отсутствующий в каталоге сильный набор не блокирует РБ',async()=>{
 const f=greaterFixture();f.catalog.sets.pop();await step(f);assert.equal(f.env.rt.tbuff,null);assert.equal(f.posts.length,1);
});
test('перед вторым набором перечитывается цена: подорожавший greater не оплачивается',async()=>{
 const f=greaterFixture();await step(f);f.catalog.sets[2].feeCoinOfLuck=5;await step(f);assert.deepEqual(f.posts.map(x=>x.q.set),['warrior']);assert.equal(f.env.rt.tbuff,null);
});
test('потерянный ответ первого набора сверяется без повторения и затем готовится greater',async()=>{
 const f=greaterFixture();f.lose='warrior';await step(f);assert.equal(f.env.rt.tbuff.vipRequest.phase,'sent');await step(f);assert.equal(f.posts.length,1);assert.equal(f.env.rt.tbuff.vipRequest,null);await step(f,2);assert.deepEqual(f.posts.map(x=>x.q.set),['warrior','greater','greater']);assert.deepEqual(f.posts.filter(x=>x.q.set==='greater').map(x=>x.q.skillId),[1356,1323]);assert.equal(f.env.rt.tbuff,null);
});
test('неизвестный исход greater не повторяется и не объявляет готовность',async()=>{
 const f=greaterFixture();await step(f);f.apply=false;f.lose='greater';await step(f,4);assert.deepEqual(f.posts.map(x=>x.q.set),['warrior','greater']);assert.equal(f.env.rt.tbuff.vipRequest.set,'greater');assert.equal(f.env.rt.tbuff.vipRequest.skillId,1356);assert.equal(f.env.rt.tbuff.vipRequest.schema,2);assert.notEqual(f.B.vipSession()?.ready,true);
});
for(const [name,change]of Object.entries({Stop:f=>f.env.on=false,off:f=>f.env.cfg.vipBuffAuto=false,actor:f=>f.env.rt.char='Other',slot:f=>f.env.rt.classCur.slot=0}))test('последняя проверка перед greater: '+name,async()=>{
 const f=greaterFixture();await step(f);f.pause=()=>change(f);await step(f);assert.deepEqual(f.posts.map(x=>x.q.set),['warrior']);
});
test('сильный действующий Greater сохраняется, независимый Noblesse применяется отдельно',async()=>{
 const f=greaterFixture();await step(f);f.ch.activeBuffs.push({skillId:1356,level:2,expiresAtMs:Date.now()+86400000});await step(f);assert.deepEqual(f.posts.map(x=>x.q.set),['warrior','greater']);assert.equal(f.posts[1].q.skillId,1323);assert.equal(f.ch.activeBuffs.find(x=>x.skillId===1356).level,2);assert.equal(f.env.rt.tbuff,null);
});
test('старая квитанция только базового набора требует новой проверки каталога',()=>{
 const f=greaterFixture();f.B.vipNote(f.ch);f.env.rt.vipApplied={char:'Hero',actor:f.ch.id,set:'warrior',slot:1,prof:f.ch.l2Profession,skills:f.catalog.sets[0].skills};for(const x of f.catalog.sets[0].skills)f.H[x.skillId]=Date.now()+86400000;assert.equal(f.B.vipSession().ready,false);
});

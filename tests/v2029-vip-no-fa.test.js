'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(process.env.VIP_BUFF_SOURCE||path.join(root,'modules/buffs.js'),'utf8');
function fixture(){
 const now=Date.now(),events=[],posts=[],gets=[],H={},levels={},loc={pathname:'/town-buffer.html',href:''};let failed=false,pending=null,prepareCount=0;
 const ch={name:'Hero',id:'actor',revision:10,hp:1000,inBattle:false,classBranch:'fighter',l2Profession:'dwarf_bounty_hunter',classSlots:{activeSlot:1},vip:{active:true,vipUntil:new Date(now+86400000).toISOString()},activeBuffs:[]};
 const catalog={sets:[{id:'warrior',feeAdena:'0',feeCoinOfLuck:0,skills:[{skillId:1068,level:3},{skillId:1045,level:5}]},{id:'mage',feeAdena:0,feeCoinOfLuck:'0',skills:[{skillId:1059,level:3}]}]};
 const env={on:true,tabOwner:true,leaseEpoch:1,cfg:{townBuffSet:'basic',vipBuffAuto:true,faBuffs:'1414,1323',rbSessBuffs:'1414,1323',rbFaFull:true,rbHuntMode:true},rt:{char:'Hero',manualKickAt:1,classCur:{slot:1},tbT:now-20*60000,tbuff:{t:now,step:'town',set:'warrior',vipFree:true,fa:[1414,1323]},rbSess:{on:true,start:now-16*60000},rbHunt:{step:'go'},actionPayments:{history:[{id:'old-history'}]}},TB_KEYS:{basic:[1068],warrior:[1068,1045],mage:[1059]},FA_KNOWN:{},IL:{},routeLocation:loc,
  $q:s=>s==='#l2-hud-active-buffs'?{querySelectorAll:()=>Object.entries(H).map(([id,e])=>({dataset:{skillId:id,expiresAt:e},getAttribute:k=>k==='title'?'Бафф · Lv.'+(levels[id]||1):''}))}:null,
  setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rtCommit:async()=>true,setCfg:async p=>Object.assign(env.cfg,p),sleep:async()=>{},pause:async()=>{},rec:(...a)=>events.push(a.join(' ')),setStatus:s=>events.push(s),autonomyMode:()=> 'raid',faCost:()=>1,
  payments:{blocked:()=>!!pending,pending:()=>pending,prepare:async()=>{prepareCount++;throw Error('VIP attempted paid prepare')},confirm:async()=>{throw Error('unknown payment confirmed without evidence')}},
  gameGet:async p=>{gets.push(p);if(failed)throw Error('unavailable');return{ok:true,status:200,json:async()=>structuredClone(p==='/character'?{character:ch}:catalog)}},
  gamePost:async(p,q)=>{posts.push({p,q});assert.equal(p,'/character/town/buffer');assert.equal(q.expectedFeeAdena,'0');assert.equal(q.expectedFeeCoinOfLuck,0);ch.revision++;ch.activeBuffs=catalog.sets.find(x=>x.id===q.set).skills.map(x=>({...x,expiresAtMs:Date.now()+86400000}));for(const b of ch.activeBuffs){H[b.skillId]=b.expiresAtMs;levels[b.skillId]=b.level}return{ok:true,status:200,json:async()=>({character:structuredClone(ch)})}}};
 const box={console,Date,Math,document:{querySelectorAll:()=>[]},location:loc};vm.runInNewContext(source,box);const B=box.L2V7Factories.buffs(env);
 const renv={...env,get rt(){return env.rt},vipSession:()=>B.vipSession(),hudBuffs:()=>B.hudBuffs(),faFullIds:()=>B.faFullIds(),faLow:id=>B.faLow(id),townBuffStart:async()=>{events.push('start-free');return true}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'modules/raid.js'),'utf8'),box);const R=box.L2V7Factories.raid(renv);
 B.vipNote(ch);
 return{env,B,R,ch,catalog,H,levels,posts,gets,events,loc,get prepareCount(){return prepareCount},set failed(x){failed=x},set pending(x){pending=x}};
}
test('VIP запрещает все новые FA: сессия, тур, явный список и Noblesse; cfg/история сохраняются',()=>{
 const f=fixture(),cfg=JSON.stringify(f.env.cfg),history=JSON.stringify(f.env.rt.actionPayments.history);
 assert.deepEqual([...f.B.faWanted()],[]);assert.equal(f.B.tourFaWanted(),false);assert.deepEqual([...f.B.townBuffNeed().fa],[]);
 assert.equal(JSON.stringify(f.env.cfg),cfg);assert.equal(JSON.stringify(f.env.rt.actionPayments.history),history);
});
for(const [name,change]of Object.entries({autoOff:f=>f.env.cfg.vipBuffAuto=false,townOff:f=>f.env.cfg.townBuffSet='off',paidSet:f=>f.env.cfg.townBuffSet='mage',unknownClass:f=>{f.ch.classBranch='unknown';f.B.vipNote(f.ch)}}))test('активный VIP не разрешает FA при '+name,()=>{const f=fixture();change(f);assert.deepEqual([...f.B.faWanted()],[]);assert.equal(f.B.tourFaWanted(),false)});
test('подтверждённый бесплатный набор завершает старую очередь FA и принимается РБ-сессией',async()=>{
 const f=fixture();await f.B.townBuffStep();assert.equal(f.posts.length,1);assert.equal(f.env.rt.tbuff,null);assert.notEqual(f.loc.href,'/fast-aden-buffer.html');assert.equal(f.B.vipSession().ready,true);
 assert.equal(await f.R.rbSessTick(),false);assert.equal(f.env.rt.rbSess.on,true);assert.equal(f.env.rt.rbSess.bought,true);assert.equal(f.env.rt.rbSess.vip,true);assert.ok(f.env.rt.rbSess.until>Date.now());assert.equal(f.prepareCount,0);
});
test('старый FA-маршрут сначала перечитывает VIP и переходит к бесплатному набору без prepare',async()=>{
 const f=fixture();f.env.rt.vipBuff.t-=180000;f.env.rt.tbuff={t:Date.now(),step:'fa',fa:[1414]};f.loc.pathname='/fast-aden-buffer.html';await f.B.townBuffStep();
 assert.ok(f.gets.includes('/character'));assert.equal(f.env.rt.tbuff.step,'town');assert.equal(f.env.rt.tbuff.vipFree,true);assert.deepEqual([...f.env.rt.tbuff.fa],[]);assert.equal(f.loc.href,'/town-buffer.html');assert.equal(f.prepareCount,0);
});
test('сбой чтения после известного VIP удерживает FA-маршрут без покупки',async()=>{
 const f=fixture();f.failed=true;f.env.rt.vipBuff.t-=180000;f.env.rt.tbuff={t:Date.now(),step:'fa',fa:[1414]};await f.B.townBuffStep();assert.equal(f.prepareCount,0);assert.equal(f.env.rt.tbuff.step,'fa');assert.equal(f.posts.length,0);
});
for(const fee of ['feeAdena','feeCoinOfLuck'])test('цена '+fee+' не нулевая: 0 POST/FA, сессия ждёт без ложного timeout',async()=>{
 const f=fixture();f.catalog.sets[0][fee]=1;await f.B.townBuffStep();assert.equal(f.posts.length,0);assert.deepEqual([...f.B.faWanted()],[]);assert.equal(f.B.vipSession().ready,false);assert.equal(await f.R.rbSessTick(),true);assert.equal(f.env.rt.rbSess.on,true);assert.equal(f.prepareCount,0);
});
test('свежий сервер подтвердил окончание VIP — возвращается прежняя FA-политика',()=>{
 const f=fixture();f.ch.vip.active=false;f.B.vipNote(f.ch);assert.deepEqual([...f.B.faWanted()],[1414,1323]);assert.equal(f.B.tourFaWanted(),true);assert.equal(f.B.vipSession(),null);
});
test('VIP ещё действует последние 2 секунды: FA по-прежнему запрещены',()=>{
 const f=fixture();f.ch.vip.vipUntil=new Date(Date.now()+2000).toISOString();f.B.vipNote(f.ch);assert.equal(f.B.vipPreferred(),'');assert.deepEqual([...f.B.faWanted()],[]);
});
test('неизвестный прежний FA-платёж сверяется первым и не удаляется ради VIP',async()=>{
 const f=fixture(),p={id:'unknown-fa',kind:'fa-buff',char:'Hero',at:Date.now(),evidence:{ids:[1414],before:{},expectedLevels:{1414:1}},quote:{amount:5,currency:'FA'}};f.pending=p;await f.B.townBuffStep();assert.equal(f.env.payments.pending(),p);assert.equal(f.posts.length,0);assert.equal(f.prepareCount,0);assert.equal(f.env.rt.tbuff.step,'town');
});
for(const [name,change]of Object.entries({offline:f=>f.failed=true,wrongHero:f=>f.ch.name='Other',missingVIP:f=>delete f.ch.vip,malformedVIP:f=>f.ch.vip.active='false',missingIdentity:f=>delete f.ch.id}))test('без снимка VIP: '+name+' удерживает старую FA-очередь без prepare',async()=>{
 const f=fixture();delete f.env.rt.vipBuff;f.env.rt.tbuff={t:Date.now(),step:'fa',fa:[1414]};change(f);await f.B.townBuffStep();assert.equal(f.prepareCount,0);assert.equal(f.posts.length,0);assert.equal(f.env.rt.tbuff.step,'fa');assert.deepEqual([...f.env.rt.tbuff.fa],[1414]);
});
for(const [name,change]of Object.entries({Stop:f=>f.env.on=false,actor:f=>f.env.rt.char='Other',lease:f=>f.env.leaseEpoch++,kick:f=>f.env.rt.manualKickAt++}))test(name+' во время свежей проверки VIP не меняет очередь и не платит',async()=>{
 const f=fixture();f.env.rt.tbuff={t:Date.now(),step:'fa',fa:[1414]};const before=JSON.stringify(f.env.rt.tbuff),get=f.env.gameGet;f.env.gameGet=async p=>{const r=await get(p);change(f);return r};await f.B.townBuffStep();assert.equal(f.prepareCount,0);assert.equal(f.posts.length,0);assert.equal(JSON.stringify(f.env.rt.tbuff),before);
});
test('активный VIP с неверной датой окончания не разрешает FA',()=>{const f=fixture();f.ch.vip.vipUntil='invalid';f.B.vipNote(f.ch);assert.equal(f.B.vipPreferred(),'');assert.deepEqual([...f.B.faWanted()],[])});
test('active:true и прошедшая дата противоречат друг другу: FA закрыт до свежего active:false',async()=>{const f=fixture();f.ch.vip.vipUntil=new Date(Date.now()-1000).toISOString();f.B.vipNote(f.ch);assert.deepEqual([...f.B.faWanted()],[]);assert.equal(f.B.tourFaWanted(),false);assert.equal(f.B.vipSession().ready,false);assert.equal(await f.R.rbSessTick(),true);assert.equal(f.env.rt.rbSess.on,true);f.ch.vip.active=false;f.B.vipNote(f.ch);assert.deepEqual([...f.B.faWanted()],[1414,1323]);assert.equal(f.B.vipSession(),null)});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(process.env.VIP_BUFF_SOURCE||path.join(root,'modules/buffs.js'),'utf8');
function fixture(){
 const now=Date.now(),events=[],posts=[],loc={pathname:'/town-buffer.html',href:''},H={};let pause=()=>{},lost=false,applied=true,status=200;
 const ch={name:'Hero',id:'actor',revision:10,hp:1000,inBattle:false,classBranch:'fighter',l2Profession:'dwarf_bounty_hunter',classSlots:{activeSlot:1},vip:{active:true,vipUntil:new Date(now+30*86400000).toISOString()},activeBuffs:[]};
 const skills=id=>[{skillId:id,level:3,durationSec:86400},{skillId:1045,level:5,durationSec:86400}];
 const catalog={sets:[{id:'warrior',feeAdena:'0',feeCoinOfLuck:0,skills:skills(1068)},{id:'mage',feeAdena:'0',feeCoinOfLuck:0,skills:skills(1059)}]};
 const env={on:true,tabOwner:true,leaseEpoch:1,cfg:{townBuffSet:'basic',vipBuffAuto:true,faBuffs:''},rt:{char:'Hero',manualKickAt:1,classCur:{slot:1},tbT:now-20*60000,tbuff:{t:now,step:'town',set:'warrior',vipFree:true,fa:[]}},TB_KEYS:{basic:[1068,1268,1086,1045],warrior:[1068,1045],mage:[1059,1045]},FA_KNOWN:{},IL:{},routeLocation:loc,
 $q:s=>s==='#l2-hud-active-buffs'?{querySelectorAll:()=>Object.entries(H).map(([id,e])=>({dataset:{skillId:id,expiresAt:e},getAttribute:()=>''}))}:null,
 setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rtCommit:async()=>true,sleep:async()=>{},pause:async()=>pause(),rec:(...a)=>events.push(a.join(' ')),setStatus:s=>events.push(s),autonomyMode:()=> 'farm',
 payments:{blocked:()=>false,pending:()=>null,prepare:async()=>{throw Error('VIP must not reserve paid currency')}},
 gameGet:async p=>({ok:true,json:async()=>structuredClone(p==='/character'?{character:ch}:catalog)}),
 gamePost:async(p,q)=>{posts.push({p,q});assert.equal(p,'/character/town/buffer');assert.equal(q.expectedFeeAdena,'0');assert.equal(q.expectedFeeCoinOfLuck,0);
  if(applied&&status===200){ch.revision++;ch.activeBuffs=catalog.sets.find(x=>x.id===q.set).skills.map(x=>({...x,expiresAtMs:Date.now()+86400000}));}
  if(lost)throw Error('lost');return{ok:status===200,status,json:async()=>status===200?{character:structuredClone(ch)}:{error:'price_changed'}};
 }};
 const box={console,Date,Math,document:{querySelectorAll:()=>[]}};vm.runInNewContext(source,box);const B=box.L2V7Factories.buffs(env);
 return{env,B,ch,catalog,H,posts,events,loc,set pause(f){pause=f},set lost(v){lost=v},set applied(v){applied=v},set status(v){status=v}};
}
test('активный саб спойлера выбирает бесплатный набор воина, основной маг — мага',()=>{
 const f=fixture();f.B.vipNote(f.ch);assert.equal(f.B.vipPreferred(),'warrior');assert.equal(f.B.townBuffNeed().vipFree,true);
 f.ch.classBranch='mystic';f.ch.l2Profession='human_arcana_lord';f.ch.classSlots.activeSlot=0;f.env.rt.classCur.slot=0;f.B.vipNote(f.ch);assert.equal(f.B.townBuffNeed().set,'mage');
});
test('бесплатный набор подтверждается эффектами и не использует платёжный бюджет',async()=>{
 const f=fixture();await f.B.townBuffStep();assert.equal(f.posts.length,1);assert.equal(f.posts[0].q.set,'warrior');assert.equal(f.env.rt.tbOk,true);assert.equal(f.env.rt.tbuff,null);assert.equal(f.loc.href,'/map.html');assert.ok(f.events.some(x=>x.includes('0 Coin of Luck')));
});
test('VIP-маг определяется по свежему персонажу перед применением, а не старому имени Warlock',async()=>{
 const f=fixture();f.ch.classBranch='mystic';await f.B.townBuffStep();assert.equal(f.posts[0].q.set,'mage');
});
for(const [label,change]of Object.entries({expired:f=>f.ch.vip.vipUntil=new Date(Date.now()-1000).toISOString(),inactive:f=>f.ch.vip.active=false,malformed:f=>f.ch.vip.vipUntil='invalid'}))test('VIP '+label+' возвращает обычный набор без платного запроса',async()=>{
 const f=fixture();change(f);await f.B.townBuffStep();assert.equal(f.posts.length,0);assert.equal(f.env.rt.tbuff.set,'basic');assert.equal(f.env.rt.tbuff.vipFree,false);
});
for(const [label,change]of Object.entries({CoL:f=>f.catalog.sets[0].feeCoinOfLuck=15,adena:f=>f.catalog.sets[0].feeAdena='1',missing:f=>delete f.catalog.sets[0].feeCoinOfLuck,null:f=>f.catalog.sets[0].feeAdena=null,empty:f=>f.catalog.sets[0].skills=[]}))test('цена '+label+' не считается бесплатной',async()=>{
 const f=fixture();change(f);await f.B.townBuffStep();assert.equal(f.posts.length,0);assert.equal(f.env.rt.tbOk,false);
});
for(const [label,change]of Object.entries({Stop:f=>f.env.on=false,lease:f=>f.env.leaseEpoch++,actor:f=>f.env.rt.char='Other',kick:f=>f.env.rt.manualKickAt++,disabled:f=>f.env.cfg.vipBuffAuto=false,off:f=>f.env.cfg.townBuffSet='off',class:f=>f.env.rt.classCur.slot=0}))test(label+' во время паузы отменяет применение',async()=>{
 const f=fixture();f.pause=()=>change(f);await f.B.townBuffStep();assert.equal(f.posts.length,0);
});
test('неудачная durable-запись не отправляет запрос и не оставляет ложного sent',async()=>{
 const f=fixture();f.env.rtCommit=async()=>false;await f.B.townBuffStep();assert.equal(f.posts.length,0);assert.equal(f.env.rt.tbuff.vipRequest,undefined);
});
test('потерянный ответ сверяется после reload по эффектам без второго запроса',async()=>{
 const f=fixture();f.lost=true;await f.B.townBuffStep();assert.equal(f.posts.length,1);assert.ok(f.env.rt.tbuff.vipRequest);await f.B.townBuffStep();assert.equal(f.posts.length,1);assert.equal(f.env.rt.tbuff,null);assert.equal(f.env.rt.tbOk,true);
});
test('неизвестный исход без эффектов не повторяется даже после истечения VIP',async()=>{
 const f=fixture();f.applied=false;f.lost=true;await f.B.townBuffStep();f.ch.vip.active=false;for(let i=0;i<3;i++)await f.B.townBuffStep();assert.equal(f.posts.length,1);assert.ok(f.env.rt.tbuff.vipRequest);
});
test('отказ цены сервером не превращается в согласие на15CoL',async()=>{
 const f=fixture();f.status=409;await f.B.townBuffStep();assert.equal(f.posts.length,1);assert.equal(f.env.rt.tbuff.set,'basic');assert.equal(f.env.rt.tbuff.vipRequest,null);
});
test('сильный действующий бафф не понижается бесплатным VIP-набором',async()=>{
 const f=fixture();f.ch.activeBuffs=[{skillId:1068,level:4,expiresAtMs:Date.now()+86400000}];await f.B.townBuffStep();assert.equal(f.posts.length,0);
});
test('VIP не включает выключенный баффер, старый/чужой снимок или после смены саба',()=>{
 const f=fixture();f.B.vipNote(f.ch);f.env.cfg.townBuffSet='off';assert.equal(f.B.vipPreferred(),'');f.env.cfg.townBuffSet='basic';f.env.rt.vipBuff.t-=180000;assert.equal(f.B.vipPreferred(),'');
 f.B.vipNote(f.ch);f.env.rt.classCur.slot=0;assert.equal(f.B.vipPreferred(),'');assert.equal(f.B.vipNote({...f.ch,name:'Other'}),false);
});

test('Stop до отправки оставляет только prepared и после возобновления не ждёт несуществующий ответ',async()=>{
 const f=fixture();f.pause=()=>f.env.on=false;await f.B.townBuffStep();assert.equal(f.posts.length,0);assert.equal(f.env.rt.tbuff.vipRequest.phase,'prepared');
 f.env.on=true;f.pause=()=>{};await f.B.townBuffStep();assert.equal(f.env.rt.tbuff.vipRequest,null);await f.B.townBuffStep();assert.equal(f.posts.length,1);assert.equal(f.env.rt.tbuff,null);
});
test('отключение VIP при финальном durable flush ещё не допускает отправку',async()=>{
 const f=fixture();let n=0;f.env.rtCommit=async()=>{if(++n===2)f.env.cfg.vipBuffAuto=false;return true};await f.B.townBuffStep();assert.equal(f.posts.length,0);assert.equal(f.env.rt.tbuff.vipRequest,null);
});

test('после окончания VIP пропавший дополнительный эффект не вызывает цикл обычного баффера',()=>{
 const f=fixture();for(const id of f.env.TB_KEYS.basic)f.H[id]=Date.now()+86400000;
 f.env.rt.vipApplied={char:'Hero',ids:[271]};f.env.rt.hudLong={271:Date.now()+86400000};f.ch.vip.active=false;f.B.vipNote(f.ch);
 assert.equal(f.B.townBuffNeed(),null);
 delete f.H[1068];assert.equal(f.B.townBuffNeed().set,'basic');
});

test('обычный набор до привязки героя не требует памяти применения VIP',()=>{
 const f=fixture();delete f.env.rt.char;assert.equal(f.B.townBuffNeed().set,'basic');
});

'use strict';
// 20.12 (ревизия 17.10, аудит RB-1): рейдовый телепорт — явный отказ своего запроса (РБ убит другими, 4xx, 200 с error)
// снимает ожидание без паузы бота и на 30 мин запрещает этот перелёт; без ответа — сверка «ревизия и адена те же».
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const boss='l2dop_rb_25490';
function fixture(){
 let now=1_000_000_000_000,receipt=null;const clock=class extends Date{static now(){return now}};
 const loc={pathname:'/rb-bosses.html',search:'',href:''},pauses=[],logs=[],ch={name:'alt2',id:'alt2id',revision:20,adena:900000};
 const box={Date:clock,URL,URLSearchParams,CSS:{escape:s=>s},console,document:{querySelectorAll:()=>[]},location:loc};
 for(const f of ['modules/payments.js','modules/raid.js'])vm.runInNewContext(read(f),box);
 const env={on:true,tabOwner:true,cfg:{rbHuntMode:true},rt:{char:'alt2',classCur:{slot:0,prof:'human_warlord'},rbHunt:{id:boss,step:'go'},rbWant:boss,rbGo:{id:boss,t:now}},
  isMap:()=>loc.pathname==='/map.html',isBattle:()=>false,aroundSig:()=>({ids:[]}),LV_RE:/^([^\p{L}\d]*)(.+?)\s*[·•]\s*ур\.?\s*(\d+)/iu,
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,rec:(...a)=>logs.push(a.join(' ')),setStatus(){},
  pauseBot:msg=>{pauses.push(msg);env.on=false},heroLvl:()=>48,logLines:()=>[],activeBuffs:()=>[],raidPaymentNet:()=>receipt,
  gameGet:async()=>({ok:true,json:async()=>({character:{...ch}})})};
 env.payments=box.L2V7Factories.payments(env);const R=box.L2V7Factories.raid(env);
 const pay=async(ev={})=>{const p=await env.payments.prepare({kind:'raid-teleport',key:'raid:'+boss,quote:{amount:100000,currency:'Adena'},evidence:{id:boss,name:'Gwindorr',revision:20,adena:900000,charId:'alt2id',...ev}});assert.ok(p);assert.ok(env.payments.sent(p));return p};
 return {env,R,pay,pauses,logs,tick:ms=>now+=ms,now:()=>now,receipt:r=>receipt=r,ch:p=>Object.assign(ch,p)};
}
test('явный отказ своего телепорта — ожидание снято, бот не на паузе, перелёт 30 мин не повторяется',async()=>{
 const f=fixture(),p=await f.pay();f.receipt({t:f.now()+1,id:boss,status:409,paymentId:p.id,outcome:'rejected',ok:false});
 f.tick(70000);assert.equal(await f.R.paymentReconcile(),true);
 assert.equal(f.env.payments.pending(),null);assert.equal(f.pauses.length,0);assert.equal(f.env.on,true);
 const c=f.env.rt.actionPayments.history[0].confirmation;assert.equal(c.kind,'server-rejected');assert.equal(c.spent,0);
 assert.ok(f.env.rt.rbSkip[boss]>0);assert.equal(f.env.rt.rbGo,null);assert.ok(f.logs.some(x=>/адена не списана/.test(x)));
});
test('200 с error своего запроса — тоже отказ (не «квитанция»)',async()=>{
 const f=fixture(),p=await f.pay();f.receipt({t:f.now()+1,id:boss,status:200,paymentId:p.id,outcome:'rejected',ok:false});
 assert.equal(await f.R.paymentReconcile(),true);assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'server-rejected');
});
test('отказ чужого запроса (другой paymentId) не снимает ожидание',async()=>{
 const f=fixture();await f.pay();f.receipt({t:f.now()+1,id:boss,status:409,paymentId:'other',outcome:'rejected',ok:false});
 f.tick(70000);assert.equal(await f.R.paymentReconcile(),false);assert.ok(f.env.payments.pending());assert.equal(f.pauses.length,0);
});
test('без ответа: ревизия и адена те же дважды за ≥2 мин — телепорт не применился, бот работает дальше',async()=>{
 const f=fixture();await f.pay();
 f.tick(70000);assert.equal(await f.R.paymentReconcile(),false);assert.equal(f.pauses.length,0);
 f.tick(60000);assert.equal(await f.R.paymentReconcile(),false);f.tick(31000);assert.equal(await f.R.paymentReconcile(),true);
 assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'state-not-applied');assert.equal(f.pauses.length,0);
});
test('без ответа: адена уменьшилась — повтор запрещён, ожидание остаётся, паузы нет',async()=>{
 const f=fixture();await f.pay();f.ch({adena:800000});
 for(let i=0;i<10;i++){f.tick(31000);assert.equal(await f.R.paymentReconcile(),false)}
 assert.ok(f.env.payments.pending());assert.equal(f.pauses.length,0);
 assert.equal(await f.env.payments.prepare({kind:'raid-teleport',key:'raid:x',quote:{amount:1,currency:'Adena'}}),null);
});
console.log('PASS: v2012-pay-raid');

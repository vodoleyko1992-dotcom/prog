'use strict';
// 17.10, журналы 00:07–00:10: прилёт без пина, ручной бой, победа → вечная сверка оплаты.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const boss='l2dop_rb_25490',other='l2dop_rb_25050';
function fixture(){
 const loc={pathname:'/map.html',search:'',href:''},nodes={pins:[],links:[]},pauses=[];
 const box={URL,URLSearchParams,CSS:{escape:s=>s},console,document:{querySelectorAll:s=>s.includes('a.l2-map-mob-link--raid')?nodes.links:nodes.pins},location:loc};
 for(const f of ['modules/payments.js','modules/raid.js'])vm.runInNewContext(read(f),box);
 const env={on:true,tabOwner:true,cfg:{rbHuntMode:true},rt:{char:'alt2',classCur:{slot:0,prof:'human_warlord'},rbHunt:{id:boss,step:'arrive'},rbWant:boss},
  isMap:()=>loc.pathname==='/map.html',isBattle:()=>loc.pathname==='/battle.html',aroundSig:()=>({ids:[boss]}),
  LV_RE:/^([^\p{L}\d]*)(.+?)\s*[·•]\s*ур\.?\s*(\d+)/iu,
  setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,rec(){},setStatus(){},
  pauseBot:msg=>{pauses.push(msg);env.on=false},heroLvl:()=>48,logLines:()=>[],activeBuffs:()=>[]};
 env.payments=box.L2V7Factories.payments(env);
 let R=box.L2V7Factories.raid(env);
 const reload=()=>{env.payments=box.L2V7Factories.payments(env);R=box.L2V7Factories.raid(env)};
 const prepare=async()=>{const p=await env.payments.prepare({kind:'raid-teleport',key:'raid:'+boss,quote:{amount:100000,currency:'Adena'},evidence:{id:boss,name:'Gwindorr'}});assert.ok(p);assert.equal(env.payments.sent(p),true);assert.equal(env.payments.consumePermit(),true);return p};
 const link=(id=boss,href='/battle.html?spawnId='+id)=>({textContent:'Gwindorr · ур. 40 · рейд-боссHP 218 810',getAttribute:k=>k==='href'?href:null});
 return {env,loc,nodes,pauses,prepare,reload,link,get R(){return R}};
}
test('list-only boss is available to both payment reconciliation and arrive route after reload',async()=>{
 const f=fixture();await f.prepare();f.reload();f.nodes.links=[f.link()];
 const rows=f.R.raidList();assert.equal(rows.length,1);assert.equal(rows[0].id,boss);assert.equal(rows[0].name,'Gwindorr');assert.equal(rows[0].lvl,40);
 assert.equal(await f.R.paymentReconcile(),true);assert.equal(f.env.payments.blocked(),false);assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'target-arrival');
});
test('list and pin are deduplicated; existing pin metadata is retained',()=>{
 const f=fixture();f.nodes.links=[f.link()];f.nodes.pins=[{dataset:{spawnId:boss},getAttribute:()=> 'Gwindorr · ур. 40 · рейд-босс'}];assert.equal(f.R.raidList().length,1);assert.equal(f.R.raidList()[0].idx,0);
});
test('different boss and external/non-battle/missing-id links cannot confirm arrival',async()=>{
 const f=fixture();await f.prepare();f.nodes.links=[f.link(other),f.link(boss,'https://example.com/battle.html?spawnId='+boss),f.link(boss,'/rb-bosses.html?spawnId='+boss),f.link(boss,'/battle.html')];
 assert.equal(await f.R.paymentReconcile(),false);assert.ok(f.env.payments.pending());assert.equal(f.pauses.length,0);
});
test('manual battle with exact target closes waiting payment; another battle does not',async()=>{
 const f=fixture();await f.prepare();f.reload();f.loc.pathname='/battle.html';
 assert.equal(await f.R.paymentReconcile(other),false);assert.ok(f.env.payments.pending());
 assert.equal(await f.R.paymentReconcile(boss),true);assert.equal(f.env.payments.pending(),null);
});
test('a battle id without actual battle page does not prove arrival',async()=>{
 const f=fixture();await f.prepare();assert.equal(await f.R.paymentReconcile(boss),false);assert.ok(f.env.payments.pending());
});
test('saved target victory recovers old blocked payment after return to map/reload',async()=>{
 const f=fixture(),p=await f.prepare();p.at-=200000;
 f.env.rt.rbDb={[boss]:{kills:1,lastWin:Date.now(),victoryEvidence:{at:Date.now(),char:'alt2'}}};f.reload();
 assert.equal(await f.R.paymentReconcile(),true);assert.equal(f.pauses.length,0);assert.equal(f.env.payments.blocked(),false);assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'target-victory');
});
for(const kind of ['old','other-character','other-target'])test('unrelated victory cannot settle teleport: '+kind,async()=>{
 const f=fixture(),p=await f.prepare();f.env.rt.rbDb={[kind==='other-target'?other:boss]:{victoryEvidence:{at:kind==='old'?p.at-1:Date.now(),char:kind==='other-character'?'Other':'alt2'}}};
 assert.equal(await f.R.paymentReconcile(),false);assert.ok(f.env.payments.pending());
});
test('recording victory immediately settles matching payment, preserves new route and keeps one history entry',async()=>{
 const f=fixture();await f.prepare();f.env.rt.rbWant=other;f.env.rt.rbHunt={id:other,step:'pick'};
 await f.R.rbNote(boss,{kills:1});assert.equal(f.env.payments.pending(),null);assert.equal(f.env.rt.rbWant,other);assert.equal(f.env.rt.rbHunt.id,other);
 await f.R.paymentReconcile();assert.equal(f.env.rt.actionPayments.history.length,1);
});
for(const page of ['/map.html','/rb-bosses.html'])test('unknown teleport after one minute pauses with reserve retained on '+page,async()=>{
 const f=fixture(),p=await f.prepare();p.at-=61000;f.loc.pathname=page;f.reload();
 assert.equal(await f.R.paymentReconcile(),false);assert.equal(f.pauses.length,1);assert.match(f.pauses[0],/повтор запрещён/);assert.ok(f.env.payments.pending());assert.equal(await f.env.payments.prepare({key:'raid:new',kind:'raid-teleport',quote:{amount:1,currency:'Adena'}}),null);
});
test('late matching list arrival still recovers a timed out payment without another teleport',async()=>{
 const f=fixture(),p=await f.prepare();p.at-=61000;f.nodes.links=[f.link()];assert.equal(await f.R.paymentReconcile(),true);assert.equal(f.pauses.length,0);
});
test('receipt remains valid without map DOM; changed character/owner cannot settle it',async()=>{
 for(const kind of ['valid','character','owner']){const f=fixture(),p=await f.prepare();f.loc.pathname='/rb-bosses.html';f.env.raidPaymentNet=()=>({ok:true,id:boss,t:p.at});if(kind==='character')f.env.rt.char='Other';if(kind==='owner')f.env.tabOwner=false;
 assert.equal(await f.R.paymentReconcile(),kind==='valid');assert.equal(!!f.env.payments.pending(),kind!=='valid');}
});

test('real battle learning settles the manually opened exact boss before next turn',async()=>{
 const f=fixture();await f.prepare();f.loc.pathname='/battle.html';
 f.R.rbLearn({name:'Gwindorr',rb:{id:boss,hits:[]}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.env.payments.blocked(),false);assert.equal(f.env.rt.actionPayments.history[0].confirmation.kind,'target-battle');
});

for(const interrupted of [false,true])test('visible native link without pin/index opens only under active route: '+interrupted,async()=>{
 const f=fixture();let fired=0;f.env.$q=s=>s.startsWith('#map-mob-list a.')?f.link():null;f.env.shown=()=>true;
 f.env.fire=()=>{fired++;return true};f.env.waitFor=async()=>true;
 const original=f.env.setRt;f.env.setRt=async p=>{const r=await original(p);if(interrupted)f.env.rt.manualKickAt=1;return r};
 assert.equal(await f.R.rbPinAttack({id:boss,name:'Gwindorr',idx:-1},'Тур РБ'),!interrupted);assert.equal(fired,interrupted?0:1);
});

for(const href of ['/battle.html?spawnId='+boss+'_other','/rb-bosses.html?spawnId='+boss,'https://example.com/battle.html?spawnId='+boss])test('direct link fallback checks exact destination: '+href,async()=>{
 const f=fixture();let fired=0;f.env.$q=s=>s.startsWith('#map-mob-list a.')?f.link(boss,href):null;f.env.shown=()=>true;f.env.fire=()=>{fired++;return true};
 assert.equal(await f.R.rbPinAttack({id:boss,name:'Gwindorr',idx:-1},'Тур РБ'),false);assert.equal(fired,0);
});

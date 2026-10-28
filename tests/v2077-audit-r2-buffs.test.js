'use strict';
// 20.76+ (ревизия 28.10, круг 2, группа buffs): четыре находки.
// 1) Платный городской набор (15 CoL) с окном «Підтвердити» (20.55): разовое разрешение оплаты тратилось на кнопку набора (она только
//    открывает окно), а клик «Підтвердити» при ожидающей оплате блокировался шлюзом fire() — POST не уходил, оплата висела навсегда.
// 2) Явный отказ сервера (409/400, 2xx с error/ok:false) на покупку FA-баффа/городского набора не снимал «неизвестную» оплату — бот стоял.
// 3) VIP активен, бесплатный VIP-набор выключен (или классу не положен), в меню платный warrior/mage: под VIP каталог даёт 0 CoL, шаг
//    'town' не оплачивает — ≈3 похода каждые 13 мин весь срок VIP. Теперь бесплатный «basic».
// 4) VIP + свежий снимок «класс без набора»: каждый townBuffStart делал лишний GET /character.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
let T=Date.now();
class Clock extends Date{constructor(...a){a.length?super(...a):super(T);}static now(){return T;}}

// ---------- городской баффер: настоящие payments + buffs, fire() с тем же шлюзом оплаты, что content.js ----------
function town(o={}){
 T=Date.now();
 const store={},box={console,Date:Clock,document:{querySelectorAll:()=>[]},location:{pathname:'/town-buffer.html',search:'',href:''},sessionStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)}}};
 for(const m of ['payments','buffs'])vm.runInNewContext(read('modules/'+m+'.js'),box);
 const set=o.set||'warrior',fires=[],recs=[],posts=[],releases=[],reserved=new Set([777]),H={},srv=[],ov={hidden:true},D={result:''};
 const TB_KEYS={basic:[1068],warrior:[1068,1040],mage:[1059]};
 let B=null,canAccept=true;
 const el={[`#town-buffer-sets .l2-town-buffer-set-apply[data-set-id="${set}"]`]:{id:'apply'},
  '#town-buffer-confirm-fee':{get textContent(){return o.fee??'Ціна: 15 Coin of Luck'}},'#town-buffer-confirm-accept':{id:'accept',disabled:false},'#town-buffer-confirm-cancel':{id:'cancel'},
  get '#town-buffer-result-title'(){return {textContent:D.result}},
  '#l2-hud-active-buffs':{querySelectorAll:()=>Object.entries(H).map(([id,e])=>({dataset:{skillId:id,expiresAt:e},getAttribute:()=>''}))}};
 if(o.overlay!==false)el['#town-buffer-confirm-overlay']=ov;
 function post(){
  const paymentId=env.payments.claimRequest({method:'POST',path:'/character/town/buffer',rid:posts.length+1});
  posts.push({paymentId,pending:env.payments.pending()?.id||''});
  if(o.reject){D.result='Помилка: стан персонажа змінився';B.paymentNote('/character/town/buffer',{method:'POST',status:409,paymentId,req:{set,expectedRevision:5},res:{error:'revision_mismatch'}});return;}
  for(const id of TB_KEYS[set]){const e=T+86400000;H[id]=e;srv.push({skillId:id,level:2,expiresAtMs:e});}
  D.result='Баф накладено';
 }
 const fire=x=>{
  if(!x)return false;
  if(x.id==='accept'&&!canAccept)return false;                    // как actions.canAct()===false в content.fire — до шлюза оплаты
  if(env.payments.blocked()&&!env.payments.consumePermit()){fires.push('BLOCKED:'+x.id);return false;}   // content.js: оплата ждёт исхода
  fires.push(x.id);
  if(x.id==='apply'){if(o.overlay===false)post();else if(!o.noOpen)ov.hidden=false;}
  if(x.id==='accept'){ov.hidden=true;post();}
  if(x.id==='cancel')ov.hidden=true;
  return true;
 };
 const env={rt:{char:'Hero',manualKickAt:1,tbuff:{step:'town',set,fa:[],t:T},vipBuff:{char:'Hero',actor:'a',active:false,until:null,set:'',prof:'',slot:null,t:T}},
  cfg:{townBuffSet:set},on:true,tabOwner:true,leaseEpoch:1,lease:()=>1,canRun:()=>true,TB_KEYS,FA_KNOWN:{},IL:{},DEAD_RE:/без свідомості|знепритомн/,
  setStatus(){},rec:(...a)=>recs.push(a.join(' ')),setRt:async p=>{Object.assign(env.rt,p);return {ok:true}},rtCommit:async()=>true,
  $q:s=>el[s]||null,shown:x=>!!x,sleep:async()=>{},pause:async()=>{},rnd:a=>a,waitX:async f=>f(),autonomyMode:()=>'farm',routeLocation:box.location,fire,
  epicBuffPay:async()=>o.payAt===false?null:777,epicBuffRelease:async(at,why)=>{if(!reserved.delete(at))return false;releases.push([at,why]);return true;},
  gameGet:async p=>{
   if(p==='/character/town/buffer/catalog')return {ok:true,json:async()=>({sets:[{id:set,feeAdena:0,feeCoinOfLuck:o.catFee??15,skills:[{skillId:1068,level:2}]}]})};
   if(p==='/character')return {ok:true,json:async()=>({character:{name:'Hero',revision:6,activeBuffs:srv.map(x=>({...x}))}})};
   return {ok:false,json:async()=>null};
  }};
 env.payments=box.L2V7Factories.payments(env);B=box.L2V7Factories.buffs(env);
 return {env,box,store,fires,recs,posts,releases,reserved,H,ov,get B(){return B},set B(x){B=x},set canAccept(x){canAccept=x},
  history:()=>env.rt.actionPayments?.history||[],reload(){env.payments=box.L2V7Factories.payments(env);B=box.L2V7Factories.buffs(env);return B;}};
}

test('платный набор с окном: кнопка набора открывает окно без оплаты, «Підтвердити» уходит с оплатой, POST связан и сверен',async()=>{
 const f=town();await f.B.townBuffStep();
 assert.deepEqual(f.fires,['apply','accept']);
 assert.equal(f.posts.length,1,'POST /character/town/buffer ушёл');
 assert.ok(f.posts[0].pending&&f.posts[0].paymentId===f.posts[0].pending,'POST связан с ожидающей оплатой');
 assert.equal(f.env.payments.pending(),null,'оплата сверена по эффектам');
 assert.equal(f.history()[0].confirmation.kind,'effects-satisfied');assert.equal(f.history()[0].quote.amount,15);
 assert.equal(f.env.rt.tbuff,null);assert.equal(f.releases.length,0,'резерв CoL не снят — оплата прошла');
 assert.ok(f.recs.some(r=>/«warrior» — наложен/.test(r)));
});
for(const fee of ['Безкоштовно · VIP','Ціна: 10000000 адена','Ціна: 5 Coin of Luck',''])test(`платный набор: окно с ценой «${fee}» — не подтверждаем, оплаты нет, резерв снят`,async()=>{
 const f=town({fee});await f.B.townBuffStep();
 assert.ok(!f.fires.includes('accept'));assert.ok(f.fires.includes('cancel'));assert.equal(f.posts.length,0);
 assert.equal(f.env.payments.pending(),null);assert.equal(f.history().length,0,'оплата даже не готовилась');
 assert.equal(f.releases.length,1);assert.ok(f.recs.some(r=>/не подтверждаю/.test(r)));
});
test('«Підтвердити» не нажалась (fire=false): оплата снята как не отправленная, резерв снят, в журнале причина',async()=>{
 const f=town();f.canAccept=false;await f.B.townBuffStep();
 assert.equal(f.posts.length,0);assert.equal(f.env.payments.pending(),null,'оплата не висит');assert.equal(f.env.payments.blocked(),false);
 assert.equal(f.releases.length,1);assert.ok(f.recs.some(r=>/«Підтвердити» не нажалась/.test(r)));assert.ok(f.fires.includes('cancel'));
});
test('прежний путь без окна в разметке: prepare → sent → кнопка набора и есть оплата',async()=>{
 const f=town({overlay:false});await f.B.townBuffStep();
 assert.deepEqual(f.fires,['apply']);assert.equal(f.posts.length,1);assert.ok(f.posts[0].pending&&f.posts[0].paymentId===f.posts[0].pending);
 assert.equal(f.env.payments.pending(),null);assert.equal(f.history()[0].confirmation.kind,'effects-satisfied');
});
test('окно есть в разметке, но не открылось: оплата не готовилась, «Підтвердити» не жмём, резерв CoL снят',async()=>{
 const f=town({noOpen:true});await f.B.townBuffStep();
 assert.ok(!f.fires.includes('accept'));assert.equal(f.posts.length,0);assert.equal(f.history().length,0);assert.equal(f.env.payments.pending(),null);
 assert.equal(f.releases.length,1);
});
test('бесплатный basic: «Підтвердити» не нажалась — сразу итог, без ожидания «накладено» и круга воскрешения',async()=>{
 const f=town({set:'basic',fee:'Безкоштовно'});f.canAccept=false;await f.B.townBuffStep();
 assert.equal(f.posts.length,0);assert.equal(f.env.rt.revive,undefined);assert.equal(f.env.rt.tbuff,null);
 assert.ok(f.recs.some(r=>/«basic»: «Підтвердити» не нажалась/.test(r)));
});

// ---------- 2. явный отказ сервера ----------
test('городской набор: 409 на «Підтвердити» — оплата закрыта как не прошедшая (0 CoL), резерв снят один раз',async()=>{
 const f=town({reject:true});await f.B.townBuffStep();
 assert.equal(f.posts.length,1);assert.equal(f.env.payments.pending(),null);
 const h=f.history()[0].confirmation;assert.equal(h.kind,'server-rejected');assert.equal(h.status,409);assert.equal(h.spent,0);
 assert.equal(f.releases.length,1);assert.equal(f.reserved.size,0);assert.equal(f.env.rt.tbOk,false);assert.equal(f.env.rt.tbuff,null);
});
async function pendingTown(f){
 const P=await f.env.payments.prepare({key:'town:warrior',kind:'town-buff',quote:{amount:15,currency:'Coin of Luck'},evidence:{jobT:f.env.rt.tbuff.t,set:'warrior',ids:[1068,1040],before:{},payAt:777}});
 assert.ok(P);assert.equal(f.env.payments.sent(P),true);assert.equal(f.env.payments.consumePermit(),true);return P;
}
test('городской набор: отказ сервера переживает reload (sessionStorage) — сверка снимает оплату и резерв CoL',async()=>{
 const f=town(),P=await pendingTown(f);
 const paymentId=f.env.payments.claimRequest({method:'POST',path:'/character/town/buffer',rid:1});assert.equal(paymentId,P.id,'платный набор связывает свой POST');
 f.B.paymentNote('/character/town/buffer',{method:'POST',status:200,paymentId,req:{set:'warrior'},res:{ok:false,error:'not_enough_coin_of_luck'}});
 delete f.env.rt.faBuffReceipt;const B=f.reload();assert.ok(f.env.payments.pending());
 await B.townBuffStep();
 assert.equal(f.env.payments.pending(),null);assert.equal(f.history()[0].confirmation.kind,'server-rejected');assert.equal(f.history()[0].confirmation.spent,0);
 assert.deepEqual(f.releases.map(x=>x[0]),[777]);assert.equal(f.env.rt.tbuff.step,'town','шаг набора не продвинут — повтор разрешён');assert.ok(!f.env.rt.tbOk);
});
test('городской набор: отказ другого набора/чужой оплаты/другого героя не снимает ожидание',async()=>{
 for(const change of ['set','payment','char']){
  const f=town(),P=await pendingTown(f),d={method:'POST',status:409,paymentId:change==='payment'?'other':P.id,req:{set:change==='set'?'mage':'warrior'},res:{error:'x'}};
  if(change==='char')f.env.rt.char='Other';f.B.paymentNote('/character/town/buffer',d);f.env.rt.char='Hero';
  assert.equal(await f.B.paymentReconcile(),false);assert.equal(f.env.payments.pending().id,P.id);assert.equal(f.releases.length,0);
 }
});
test('городской набор: 5xx без кода — исход неизвестен, ожидание сохраняется',async()=>{
 const f=town(),P=await pendingTown(f);
 f.B.paymentNote('/character/town/buffer',{method:'POST',status:502,paymentId:P.id,req:{set:'warrior'},res:{error:'Bad gateway'}});
 assert.equal(await f.B.paymentReconcile(),false);assert.equal(f.env.payments.pending().id,P.id);
});

// FA-бафф: фикстура как tests/v204-fa-buff-receipt.test.js
async function fa(){
 T=Date.now();
 const store={},box={Date:Clock,console,document:{querySelectorAll:()=>[]},sessionStorage:{setItem:(k,v)=>store[k]=v,getItem:k=>store[k]}};
 for(const m of ['payments','buffs'])vm.runInNewContext(read('modules/'+m+'.js'),box);
 const srv=[];let posts=0;
 const e={rt:{char:'Hero',manualKickAt:1,tbuff:{t:123,step:'fa',fa:[273,1323]}},on:true,tabOwner:true,leaseEpoch:1,cfg:{},setRt:async p=>{Object.assign(e.rt,p);return{ok:true}},rtCommit:async()=>true,autonomyMode:()=>'raid',lease:()=>e.leaseEpoch,$q:()=>null,setStatus(){},rec(){},
  gameGet:async()=>({ok:true,json:async()=>({character:{name:e.rt.char,revision:294666,activeBuffs:srv}})}),gamePost:async()=>{posts++;throw Error('POST при сверке запрещён')},faBuffEvidence:async()=>null};
 e.payments=box.L2V7Factories.payments(e);let B=box.L2V7Factories.buffs(e);
 const P=await e.payments.prepare({kind:'fa-buff',key:'fa:1323',quote:{amount:1,currency:'FA'},evidence:{set:'mage',ids:[1323],balance:235,jobT:123,before:{},beforeLevels:{},expectedLevels:{1323:1}}});
 e.payments.sent(P);e.payments.consumePermit();
 const req={set:'mage',skillId:1323,expectedCostFastAden:1,expectedRevision:294665},url='/character/town/fast-aden-buffer/apply';
 assert.equal(e.payments.claimRequest({method:'POST',path:url,req}),P.id);
 return {e,P,srv,url,req,get B(){return B},reload(){e.payments=box.L2V7Factories.payments(e);B=box.L2V7Factories.buffs(e);return B;},posts:()=>posts};
}
for(const [name,res,status] of [['409',{error:'revision_mismatch'},409],['400 не хватает FA',{error:'not_enough_fast_aden'},400],['200 ok:false',{ok:false,error:'already_active'},200]])
 test('FA-бафф: отказ сервера '+name+' переживает reload — оплата закрыта без списания, очередь и Noblesse не тронуты',async()=>{
  const f=await fa();f.B.paymentNote(f.url,{method:'POST',status,paymentId:f.P.id,req:f.req,res});
  delete f.e.rt.faBuffReceipt;const B=f.reload();
  assert.equal(await B.paymentReconcile(),true);assert.equal(f.e.payments.pending(),null);
  const h=f.e.rt.actionPayments.history[0].confirmation;assert.equal(h.kind,'server-rejected');assert.equal(h.spent,0);
  assert.deepEqual([...f.e.rt.tbuff.fa],[273,1323]);assert.equal(f.e.rt.nobBuyT,undefined);assert.equal(f.posts(),0);
 });
test('FA-бафф: отказ, но свежий эффект уже на герое (повтор игры) — успех по эффекту, не отказ',async()=>{
 const f=await fa();f.B.paymentNote(f.url,{method:'POST',status:409,paymentId:f.P.id,req:f.req,res:{error:'revision_mismatch'}});
 f.srv.push({skillId:1323,level:1,expiresAtMs:T+3*3600000});
 assert.equal(await f.B.paymentReconcile(),true);assert.equal(f.e.rt.actionPayments.history[0].confirmation.kind,'effects-satisfied');assert.deepEqual([...f.e.rt.tbuff.fa],[273]);
});
test('FA-бафф: отказ чужой оплаты/другого героя игнорируется — ожидание сохраняется',async()=>{
 for(const change of ['payment','char']){
  const f=await fa(),d={method:'POST',status:409,paymentId:change==='payment'?'other':f.P.id,req:f.req,res:{error:'x'}};
  if(change==='char')f.e.rt.char='Other';f.B.paymentNote(f.url,d);f.e.rt.char='Hero';
  assert.equal(await f.B.paymentReconcile(),false);assert.equal(f.e.payments.pending().id,f.P.id);
 }
});

// ---------- 3–4. VIP: фикстура tests/v2029-vip-no-fa.test.js ----------
const vipSrc=read('tests/v2029-vip-no-fa.test.js');
const vbox={require:n=>n==='node:test'?()=>{}:require(n),__dirname:path.join(root,'tests'),console,Date:Clock,Math,process,structuredClone};
vm.runInNewContext(vipSrc.slice(0,vipSrc.indexOf("test('VIP запрещает")),vbox);
function vip(){T=Date.now();const f=vbox.fixture();f.env.rt.tbuff=null;f.gets.length=0;return f;}
// баффер городского набора для модели времени: basic бесплатный (окно «Безкоштовно»), платный под VIP — 0 CoL в каталоге
function townPage(f){
 const visits=[],ov={hidden:true},D={result:''};let set='';
 Object.defineProperty(f.loc,'href',{get:()=>visits.at(-1)||'',set:v=>visits.push(v),configurable:true});
 const hud=f.env.$q;
 f.env.$q=s=>{const m=s.match(/data-set-id="(\w+)"\]$/);if(m){set=m[1];return {id:'apply'};}
  return s==='#town-buffer-confirm-overlay'?ov:s==='#town-buffer-confirm-fee'?{textContent:set==='basic'?'Безкоштовно':'Безкоштовно · VIP'}:s==='#town-buffer-confirm-accept'?{id:'accept'}:s==='#town-buffer-confirm-cancel'?{id:'cancel'}
   :s==='#town-buffer-result-title'?{textContent:D.result}:hud(s);};
 f.env.waitX=async fn=>fn();f.env.fire=x=>{if(x?.id==='apply'){ov.hidden=false;D.result='';}if(x?.id==='cancel')ov.hidden=true;
  if(x?.id==='accept'){ov.hidden=true;D.result='Баф накладено';for(const id of f.env.TB_KEYS[set]){f.H[id]=T+86400000;f.levels[id]=1;}}return true;};
 f.env.DEAD_RE=/без свідомості/;f.env.rnd=a=>a;f.env.shown=()=>false;
 return visits;
}
async function hour(f,visits){
 for(let t=0;t<3600000;t+=15000){T+=15000;f.B.vipNote(f.ch);await f.B.townBuffStart('сторож: баффы слетели');if(f.env.rt.tbuff){f.loc.pathname='/town-buffer.html';await f.B.townBuffStep();}}
 return visits.filter(x=>x==='/town-buffer.html').length;
}
test('VIP + vipBuffAuto=false + в меню платный warrior: план — бесплатный basic',async()=>{
 const f=vip();f.env.cfg.vipBuffAuto=false;f.env.cfg.townBuffSet='warrior';
 assert.equal(f.B.townBuffNeed().set,'basic');
 assert.equal(await f.B.townBuffStart('баффов нет'),true);assert.equal(f.env.rt.tbuff.set,'basic');assert.ok(!f.env.rt.tbuff.vipFree);
 assert.equal(f.posts.length,0);assert.equal(f.prepareCount,0);
});
test('VIP + vipBuffAuto=false + warrior: за час один поход к бафферу, без ложного «не появились» и без оплаты',async()=>{
 const f=vip();f.env.cfg.vipBuffAuto=false;f.env.cfg.townBuffSet='warrior';const visits=townPage(f);
 const n=await hour(f,visits);
 assert.ok(n<=1,`походов к бафферу за час: ${n}`);assert.ok(f.H[1068]>T,'basic наложен');
 assert.ok(!f.events.some(x=>/так и не появились|цена платного набора не подтверждена/.test(x)),f.events.filter(x=>/бафф/.test(x)).slice(0,5).join(' | '));
 assert.equal(f.posts.length,0);assert.equal(f.prepareCount,0);
});
test('VIP + набор включён, но классу набора нет (свежий снимок): платный mage → бесплатный basic',()=>{
 const f=vip();f.env.cfg.townBuffSet='mage';f.ch.classBranch='unknown';f.B.vipNote(f.ch);
 assert.equal(f.env.rt.vipBuff.set,'');assert.equal(f.B.townBuffNeed().set,'basic');
});
test('без VIP платный warrior по-прежнему планируется (понижение только под VIP)',()=>{
 const f=vip();f.env.cfg.townBuffSet='warrior';f.ch.vip.active=false;f.B.vipNote(f.ch);
 assert.equal(f.B.townBuffNeed().set,'warrior');
});
test('VIP + набор включён и положен классу: прежний бесплатный VIP-набор, без понижения',()=>{
 const f=vip();f.env.cfg.townBuffSet='warrior';const n=f.B.townBuffNeed();assert.equal(n.set,'warrior');assert.equal(n.vipFree,true);
});
test('VIP + класс без набора, свежий снимок: 20 вызовов townBuffStart — ни одного лишнего GET /character',async()=>{
 const f=vip();f.ch.classBranch='unknown';f.B.vipNote(f.ch);f.H[1068]=T+86400000;f.gets.length=0;
 for(let i=0;i<20;i++){T+=1000;assert.equal(await f.B.townBuffStart('после победы'),false);}
 assert.equal(f.gets.filter(x=>x==='/character').length,0);assert.equal(f.posts.length,0);assert.equal(f.prepareCount,0);
});
test('VIP + класс без набора, снимок устарел: одна сверка, дальше без GET',async()=>{
 const f=vip();f.ch.classBranch='unknown';f.B.vipNote(f.ch);f.env.rt.vipBuff.t-=180000;f.H[1068]=T+86400000;f.gets.length=0;
 for(let i=0;i<20;i++){T+=1000;await f.B.townBuffStart('после победы');}
 assert.equal(f.gets.filter(x=>x==='/character').length,1);
});
test('VIP + класс без набора, но после снимка сменён класс: свежая сверка обязательна',async()=>{
 const f=vip();f.ch.classBranch='unknown';f.B.vipNote(f.ch);f.H[1068]=T+86400000;f.env.rt.classSwT=T+1;T+=10;f.gets.length=0;
 await f.B.townBuffStart('после победы');assert.equal(f.gets.filter(x=>x==='/character').length,1);
});

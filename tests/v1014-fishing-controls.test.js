'use strict';
// 10.0.14: реальные отказы воспроизведены с public fishing*.js ef25c9538ce4 в Chromium.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../modules/fishing.js'),'utf8');
function world(o={}){
 let now=1800000000000;class Clock extends Date{static now(){return now;}}
 const slots=Object.fromEntries(['fishing','basicBait','goodBait','soulshot'].map(k=>[k,{kind:k,disabled:false,n:k==='goodBait'?0:100,on:k==='basicBait'||k==='soulshot',get className(){return this.on?'toggle-on':'';}}]));
 const W={clicks:[],logs:[],location:{pathname:'/fishing.html',href:'/fishing.html',reload(){W.reloads++;}},reloads:0,remain:'00:00:00',adena:15000000,prices:{'1h':3000000,'2h':5500000,'3h':7500000,'6h':14000000},active:false};
 const target={textContent:'White Fish 140 / 140 Pumping',querySelector:s=>({textContent:/__name/.test(s)?'White Fish':/__hp/.test(s)?'140 / 140':'Pumping'})};
 const q=s=>{
  if(s==='#fishing-target')return W.active?target:null;
  if(s==='#fishing-time-remaining')return {textContent:W.remain};
  if(s==='#fishing-time-adena')return {textContent:String(W.adena)};
  if(s==='.l2-fishing-gear-item--rod')return {cloneNode:()=>({textContent:'Вудка +10',querySelectorAll:()=>[]})};
  let m=s.match(/data-slot="([^"]+)"/);if(m)return slots[m[1]];
  m=s.match(/data-fishing-time-package="([^"]+)"/);if(m&&W.prices[m[1]]!=null)return {pack:m[1],disabled:false,querySelector:()=>({textContent:String(W.prices[m[1]])+' '+(W.currency||'Adena')})};
  return null;
 };
 const env={on:true,cfg:{fishBait:'basic',fishShots:true,fishAutoBuy:false,fishAutoSetup:false,shopReserve:200000,fishTimeAuto:true,fishTimeMin:5,fishTimePack:'6h',...o.cfg},rt:{rodLvl:10,...o.rt},FCD:{},NET_FISH:{t:0},fishObs:{},fishMut:0,fishCdMsg:0,fishShotsSess:0,
 $q:q,shown:x=>!!x,qty:x=>x?.n??null,cdBusy:()=>false,ROD_NONE_RE:/не выбран/,ROD_RE:/удочк|вудк/i,GEAR_RE:/$^/,CD_RE:/перезаряд/i,autonomyMode:()=> 'fish',rnd:a=>a,
 setRt:async p=>Object.assign(env.rt,p),rtCommit:async()=>true,sleep:async ms=>{now+=ms;},waitFor:async(f,ms=1000,step=50)=>{let end=now+ms;while(env.on&&now<end){const r=f();if(r)return r;now+=step;}return null;},setStatus(){},rec:(...x)=>W.logs.push(x.join(' ')),idle:async()=>{},halt:async()=>{env.on=false;},names:x=>x.split(/[\n,]+/).filter(Boolean),
 fire:e=>{if(!env.on||!e)return;W.clicks.push(e);if(e.pack){W.remain='06:00:00';W.adena-=W.prices[e.pack];}if(e.kind==='soulshot')e.on=!e.on;},isNoBite:l=>/no_bite/.test(l?.cls||''),isBite:()=>false,isCast:()=>false,
 };
 env.waitX=env.waitFor;
 const document={body:{innerText:''},querySelectorAll:s=>/fishing-gear-row/.test(s)?[{textContent:'100 ON'}]:[]};
 const box={console,Date:Clock,Math,Number,JSON,Object,Array,Promise,document,location:W.location,sessionStorage:{getItem:()=>null,setItem(){}},setTimeout};
 vm.runInNewContext(source,box);Object.assign(W,{env,slots,document,box,F:box.L2V7Factories.fishing(env)});return W;
}
function shop(o={}){
 const W=world(o);const inp={type:'number',value:'1',max:'10000',focus(){},blur(){},dispatchEvent(){}};
 class Input{}Object.defineProperty(Input.prototype,'value',{set(v){this.value=v;}});W.box.HTMLInputElement=Input;W.box.Event=class{};
 const btn={buy:true},row={textContent:'Пакет ×10 — '+(o.price??1000)+' '+(o.currency??'Adena'),outerHTML:'<div>Fishing Lure</div>',querySelector:s=>s.includes('qty-input')?inp:s==='[data-preview="cost"]'?{textContent:String((o.price??1000)*+inp.value)+' '+(o.currency??'Adena')}:s.includes('buy-btn')?btn:null,querySelectorAll:s=>s==='input'?[inp]:s==='button'?[btn]:[]};row.closest=()=>row;
 const base=W.env.$q;const success={textContent:''};W.env.$q=s=>s==='#fishing-shop-open'?{open:true}:s==='#fishing-shop-close'?{close:true}:s==='#fishing-starter-offers'?{querySelector:()=>row}:s==='#fishing-starter-adena'?{textContent:o.balance==null?'—':String(o.balance)}:s==='#fishing-starter-success'?success:base(s);
 W.env.fire=e=>{if(!e||!W.env.on)return;W.clicks.push(e);if(e===btn){W.bought=+inp.value;W.spent=W.bought*(o.price??1000);W.slots.basicBait.n+=W.bought*10;success.textContent='Придбано Fishing Lure ×'+W.bought*10;}};return W;
}
let pass=0,fail=0;async function test(name,fn){try{await fn();pass++;console.log('PASS',name);}catch(e){fail++;console.error('FAIL',name,e.message);}}
module.exports={world,shop};
if(require.main===module)(async()=>{
 await test('выключенные заряды → серверный Soulshot OFF',async()=>{const W=world({cfg:{fishShots:false}});await W.F.fishPrepare();assert.equal(W.slots.soulshot.on,false);assert.equal(W.clicks.length,1);});
 await test('выключенные уже OFF → без повторного toggle',async()=>{const W=world({cfg:{fishShots:false}});W.slots.soulshot.on=false;await W.F.fishPrepare();assert.equal(W.clicks.length,0);});
 await test('цена времени с экрана сохраняет резерв',async()=>{const W=world();W.prices={'6h':14900000};assert.equal(await W.F.fishTimeTopUp(),false);assert.equal(W.clicks.length,0);});
 await test('подешевевшее время покупается по цене экрана',async()=>{const W=world();W.adena=12000000;W.prices={'6h':11000000};assert.equal(await W.F.fishTimeTopUp(),true);assert.equal(W.clicks[0].pack,'6h');});
 await test('неизвестная валюта времени не покупается',async()=>{const W=world();W.prices={'6h':10};W.currency='Coin of Luck';assert.equal(await W.F.fishTimeTopUp(),false);assert.equal(W.clicks.length,0);});
 await test('время истекло с рыбой → можно оплатить и продолжить',async()=>{const W=world();W.active=true;assert.equal(await W.F.fishTimeTopUp(),true);assert.equal(W.clicks.length,1);});
 await test('пополнение с активной рыбой не мешает до истечения',async()=>{const W=world();W.active=true;W.remain='00:04:00';assert.equal(await W.F.fishTimeTopUp(),false);});
 await test('покупка наживки сохраняет резерв',async()=>{const W=shop({balance:210000});assert.equal(await W.F.fishBuy('bait_x10',100,'наживка'),true);assert.equal(W.bought,10);});
 await test('закупка соблюдает лимит за раз',async()=>{const W=shop({balance:10000000,cfg:{shopMaxSpend:5000}});assert.equal(await W.F.fishBuy('bait_x10',100,'наживка'),true);assert.equal(W.bought,5);});
 await test('непрочитанный баланс не разрешает расход',async()=>{const W=shop();assert.equal(await W.F.fishBuy('bait_x10',100,'наживка'),false);assert.equal(W.spent,undefined);});
 await test('неизвестная валюта расходника не покупается',async()=>{const W=shop({balance:210000,price:1,currency:'Coin of Luck'});assert.equal(await W.F.fishBuy('bait_x10',1,'наживка'),false);assert.equal(W.spent,undefined);});
 await test('Stop во время GET незакрытого боя не отправляет в бой',async()=>{const W=world();W.env.gameGet=async()=>{W.env.on=false;return {ok:true,json:async()=>({character:{inBattle:true,battleSpawnId:'mob'}})};};await W.F.fishBattle('cast');assert.equal(W.location.href,'/fishing.html');});
 await test('Stop во время commit паузы не перезагружает рыбалку',async()=>{const W=world();W.location.href='/char.html';W.env.rtCommit=async()=>{W.env.on=false;};await W.F.fishSoft('пауза');assert.equal(W.location.href,'/char.html');});
 await test('разделка одной рыбы без ×1 учитывает Proof',async()=>{const W=world();const v=W.F.fishCutValue('Вы разрезали White Fish. Получено: Fish Oil ×25, Fish Scale ×5.');assert.ok(v);assert.equal(v.n,1);assert.equal(v.proof,2);});
 await test('потеря замка во время commit не возвращает рыбалку',async()=>{const W=world();W.location.href='/char.html';W.env.rtCommit=async()=>{W.env.tabOwner=false;};await W.F.fishSoft('пауза');assert.equal(W.location.href,'/char.html');});
 await test('неудачный toggle зарядов не разрешает заброс',async()=>{const W=world({cfg:{fishShots:false}});W.env.fire=()=>{};assert.equal(await W.F.fishPrepare(),false);});
 await test('срыв после сетевого обрыва учитывается при исчезновении цели',async()=>{const W=world();W.active=true;W.remain='01:00:00';W.env.cfg.reactMin=W.env.cfg.reactMax=0;W.slots.pumping={kind:'pumping',disabled:false};const lines=[];W.document.querySelectorAll=s=>s.includes('fishing-log')?lines:[];W.env.fire=()=>{W.active=false;W.env.NET_FISH={t:1800000000001,act:'pumping',err:'aborted'};lines.push({className:'l2-fishing-log-line--lost',textContent:'Рыба сорвалась!',querySelector:()=>null});};await W.F.fishFight();assert.equal(W.env.rt.fish?.lost,1);});
 await test('отклонённый cast не становится забросом без поклёвки',async()=>{const W=world();W.remain='01:00:00';W.env.cfg.fishTimeAuto=false;W.env.fire=b=>{if(b?.kind==='fishing')W.env.NET_FISH={t:1800000000100,ok:false,act:'cast',code:'revision_conflict'};};await W.F.fishing();assert.equal(W.env.rt.fish?.casts||0,0);assert.equal(W.env.rt.fish?.nobite||0,0);});
 await test('капча во время ответа отдаёт управление главному ожиданию без повторов',async()=>{const W=world();W.active=true;W.remain='01:00:00';W.env.cfg.reactMin=W.env.cfg.reactMax=0;W.slots.pumping={kind:'pumping',disabled:false};let blocked=false,attempts=0;W.env.antibotState=()=>blocked?'check':null;W.env.fire=()=>{attempts++;blocked=true;};await W.F.fishFight();assert.equal(attempts,1);assert.equal(W.reloads,0);assert.ok(!W.logs.some(x=>/15 с/.test(x)));});
 await test('обычная разделка многих рыб остаётся прежней',async()=>{const W=world();const v=W.F.fishCutValue('Вы разрезали White Fish ×10. Получено: Fish Oil ×25, Fish Scale ×5.');assert.equal(v.n,10);assert.equal(v.proof,2);});
 console.log(`${pass} passed / ${fail} failed`);if(fail)process.exitCode=1;
})();

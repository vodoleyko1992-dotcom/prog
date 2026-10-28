'use strict';
// 20.76+ (ревизия 28.10, группа buffs): три подтверждённые находки.
// 1) VIP активен, а бесплатный VIP-набор выключен галкой (vipBuffAuto=false) или классу не положен (vipBuff.set пуст):
//    townBuffStart отвечал true навсегда (охота стояла весь срок VIP), шаг 'fa' держал очередь вечно. Теперь — обычное
//    планирование (бесплатный basic, FA запрещены), очередь FA снимается без покупки.
// 2) VIP + Greater в каталоге не бесплатный: vipSession().ready=false навсегда → поход к бафферу раз в 1–2 мин и ложное
//    «баффы не появились». Теперь свежая (≤30 мин) проверка каталога держит, РБ-сессия идёт с основным набором.
// 3) Blessing of Queen (4699) в модели ценности был только баффом кота — воинский автонабор FA его выбрасывал.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),src=fs.readFileSync(path.join(__dirname,'v2029-vip-no-fa.test.js'),'utf8');
let T=Date.now();
class Clock extends Date{constructor(...a){a.length?super(...a):super(T);}static now(){return T;}}
const box={require:n=>n==='node:test'?()=>{}:require(n),__dirname,console,Date:Clock,Math,process,structuredClone};
vm.runInNewContext(src.slice(0,src.indexOf("test('VIP запрещает")),box);
const hrefs=f=>{const out=[];Object.defineProperty(f.loc,'href',{get:()=>out.at(-1)||'',set:v=>out.push(v),configurable:true});return out;};
const wear=(f,skills,ms=86400000)=>{for(const x of skills){const b={...x,expiresAtMs:T+ms};f.ch.activeBuffs=[...f.ch.activeBuffs.filter(y=>y.skillId!==x.skillId),b];f.H[x.skillId]=b.expiresAtMs;f.levels[x.skillId]=x.level;}};

// ---------- 1. VIP + бесплатный набор выключен / класс без набора ----------
test('VIP + vipBuffAuto=false, basic висит: охота не ждёт — false без GET/POST/FA',async()=>{
 T=Date.now();const f=box.fixture();f.env.cfg.vipBuffAuto=false;f.env.rt.tbuff=null;f.H[1068]=T+86400000;f.levels[1068]=3;f.gets.length=0;
 assert.equal(await f.B.townBuffStart('баффов нет'),false);
 assert.equal(f.gets.length,0);assert.equal(f.posts.length,0);assert.equal(f.prepareCount,0);assert.deepEqual([...f.B.faWanted()],[]);
});
test('VIP + vipBuffAuto=false, шапка пуста: идёт за бесплатным basic, без FA/VIP-запроса/оплаты',async()=>{
 T=Date.now();const f=box.fixture(),go=hrefs(f);f.env.cfg.vipBuffAuto=false;f.env.rt.tbuff=null;f.gets.length=0;
 assert.equal(await f.B.townBuffStart('баффов нет'),true);
 assert.ok(f.env.rt.tbuff,'поход начат, а не вечное ожидание');assert.equal(f.env.rt.tbuff.set,'basic');assert.deepEqual([...f.env.rt.tbuff.fa],[]);
 assert.ok(!f.env.rt.tbuff.vipFree);assert.deepEqual(go,['/town-buffer.html']);assert.equal(f.gets.length,0);assert.equal(f.posts.length,0);assert.equal(f.prepareCount,0);
});
test('VIP + класс без набора (classBranch не fighter/mystic): после свежей сверки — обычный basic, не вечное ожидание',async()=>{
 T=Date.now();const f=box.fixture();f.ch.classBranch='unknown';f.B.vipNote(f.ch);f.env.rt.vipBuff.t-=180000;f.env.rt.tbuff=null;f.gets.length=0;
 assert.equal(await f.B.townBuffStart('баффов нет'),true);
 assert.ok(f.gets.includes('/character'),'VIP перечитан');assert.equal(f.env.rt.tbuff?.set,'basic');assert.deepEqual([...f.env.rt.tbuff.fa],[]);assert.equal(f.posts.length,0);assert.equal(f.prepareCount,0);
});
test('VIP + набор включён, снимок устарел и сервер недоступен: прежнее ожидание без покупки',async()=>{
 T=Date.now();const f=box.fixture();f.env.rt.vipBuff.t-=180000;f.env.rt.tbuff=null;f.failed=true;
 assert.equal(await f.B.townBuffStart('баффов нет'),true);assert.equal(f.env.rt.tbuff,null);assert.equal(f.posts.length,0);assert.equal(f.prepareCount,0);
});
test('шаг fa при VIP и vipBuffAuto=false: очередь FA снята без покупки, бот возвращается',async()=>{
 T=Date.now();const f=box.fixture(),go=hrefs(f);f.env.cfg.vipBuffAuto=false;f.env.rt.tbuff={t:T,step:'fa',fa:[1414]};f.loc.pathname='/fast-aden-buffer.html';
 await f.B.townBuffStep();
 assert.equal(f.env.rt.tbuff,null);assert.deepEqual(go,['/map.html']);assert.equal(f.prepareCount,0);assert.equal(f.posts.length,0);
 assert.ok(f.events.some(x=>/очередь FA снята без покупки/.test(x)));
});
test('шаг fa при VIP и включённом наборе: прежний переход к бесплатному набору',async()=>{
 T=Date.now();const f=box.fixture();f.env.rt.tbuff={t:T,step:'fa',fa:[1414]};f.loc.pathname='/fast-aden-buffer.html';
 await f.B.townBuffStep();assert.equal(f.env.rt.tbuff.step,'town');assert.equal(f.env.rt.tbuff.vipFree,true);assert.equal(f.prepareCount,0);
});

// ---------- 2. VIP + платный Greater: нет похода раз в минуту ----------
function paidGreater(){
 T=Date.now();const f=box.fixture(),go=hrefs(f);
 f.catalog.sets.push({id:'greater',pickByIcon:true,feeAdena:'0',feeCoinOfLuck:5,skills:[{skillId:1356,level:1},{skillId:1323,level:1}]});
 wear(f,f.catalog.sets[0].skills);f.B.vipNote(f.ch);
 // применение добавляет эффекты к действующим (как сервер), Greater — одной выбранной иконкой
 f.env.gamePost=async(p,q)=>{f.posts.push({p,q});assert.equal(p,'/character/town/buffer');assert.equal(q.expectedFeeAdena,'0');assert.equal(q.expectedFeeCoinOfLuck,0);
  const row=f.catalog.sets.find(x=>x.id===q.set);assert.ok(row.feeCoinOfLuck===0||row.feeCoinOfLuck==='0','только бесплатный набор');
  f.ch.revision++;wear(f,q.set==='greater'?row.skills.filter(x=>x.skillId===q.skillId):row.skills);return{ok:true,status:200,json:async()=>({character:structuredClone(f.ch)})};};
 return {f,go};
}
async function firstVisit(f){await f.B.townBuffStep();assert.equal(f.env.rt.tbuff,null);assert.equal(f.posts.length,0,'Greater не бесплатный — POST нет');assert.equal(f.env.rt.vipApplied.greaterUnavailable,true);}
async function tick(f){
 T+=15000;f.B.vipNote(f.ch);const r=await f.B.townBuffStart('сторож: баффы слетели');
 if(f.env.rt.tbuff){f.loc.pathname='/town-buffer.html';await f.B.townBuffStep();}
 return r;
}
test('VIP + платный Greater: 25 мин без походов к бафферу и без ложного «не появились», ready=false сохраняется',async()=>{
 const {f,go}=paidGreater();await firstVisit(f);go.length=0;const gets0=f.gets.length;
 for(let i=0;i<100;i++)assert.equal(await tick(f),false);
 assert.equal(go.filter(x=>x==='/town-buffer.html').length,0);assert.ok(!f.events.some(x=>/так и не появились/.test(x)));
 assert.equal(f.gets.length,gets0,'нет лишних GET');assert.equal(f.B.vipSession().ready,false,'платный Greater не объявлен готовым');assert.equal(f.B.vipSession().greaterHeld,true);
 assert.equal(f.posts.length,0);assert.equal(f.prepareCount,0);
});
test('VIP + платный Greater: через 30 мин одна перепроверка каталога без POST, затем снова тишина',async()=>{
 const {f,go}=paidGreater();await firstVisit(f);go.length=0;
 for(let i=0;i<130;i++)await tick(f);
 assert.equal(go.filter(x=>x==='/town-buffer.html').length,1,'ровно одна перепроверка за 32,5 мин');
 assert.equal(f.posts.length,0);assert.ok(!f.events.some(x=>/так и не появились/.test(x)));assert.equal(f.B.vipSession().greaterHeld,true);
});
test('VIP + платный Greater: истекает основной набор — поход сразу; Greater подешевел — применяется при перепроверке',async()=>{
 const {f}=paidGreater();await firstVisit(f);
 T+=60000;f.B.vipNote(f.ch);assert.equal(f.B.townBuffNeed(),null);
 f.H[1068]=T+5*60000;assert.equal(f.B.townBuffNeed()?.vipFree,true,'основной набор кончается — нужен поход');f.H[1068]=T+86400000;
 f.catalog.sets.at(-1).feeCoinOfLuck=0;T+=31*60000;f.B.vipNote(f.ch);assert.equal(f.B.townBuffNeed()?.vipFree,true,'проверка каталога устарела');
 assert.equal(await f.B.townBuffStart('сторож'),true);f.loc.pathname='/town-buffer.html';
 for(let i=0;i<3&&f.env.rt.tbuff;i++)await f.B.townBuffStep();
 assert.deepEqual([...f.posts.map(x=>x.q.set)],['greater','greater']);assert.deepEqual([...f.posts.map(x=>x.q.skillId)],[1356,1323]);assert.equal(f.prepareCount,0);
});
test('VIP + платный Greater: РБ-сессия идёт с основным набором, а не ждёт вечно',async()=>{
 const {f}=paidGreater();await firstVisit(f);
 assert.equal(await f.R.rbSessTick(),false);assert.equal(f.env.rt.rbSess.vip,true);assert.equal(f.env.rt.rbSess.bought,true);
 assert.equal(f.env.rt.rbSess.until,f.H[1068]);assert.ok(!f.events.includes('start-free'));assert.equal(f.prepareCount,0);
});
test('VIP + платный основной набор: РБ-сессия по-прежнему ждёт (нет основного набора)',async()=>{
 T=Date.now();const f=box.fixture();f.catalog.sets[0].feeCoinOfLuck=1;await f.B.townBuffStep();
 assert.equal(f.B.vipSession().greaterHeld,false);assert.equal(await f.R.rbSessTick(),true);assert.ok(f.events.includes('start-free'));
});

// ---------- 3. Blessing of Queen — бафф героя-воина ----------
test('Blessing of Queen 4699 в автонаборе воина без кота; маг — как раньше',()=>{
 const sb={console,Date,Math,JSON};sb.globalThis=sb;vm.createContext(sb);
 for(const f of ['buff-value.js','fa-full.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),sb);
 const V=sb.L2BuffVal,F=sb.L2FaFull;
 const W=V.fromRt({heroStats:{lv:60,patk:4000,crit:150,ck:1.9,buffs:[]}},{},'fighter');assert.equal(W.cat,null);
 assert.ok(F.ids('fighter',W).includes(4699),'воин: Queen в наборе FA');
 const g=V.rank([4699],W)[0].gain;assert.ok(g>0.005,'прибавка ДПС героя-воина: '+g);
 const hero={lv:67,matk:9000,patk:1678,mcrit:4,mck:2,crit:70,ck:1.86,buffs:[],cat:{patk:3000,crit:500,ck:2.44,acc:70}};
 assert.ok(!F.ids('mage',V.fromRt({heroStats:hero},{petBuffAuto:true},'mage')).includes(4699),'маг со своим баффом Королевы — не берёт');
 assert.ok(F.ids('mage',V.fromRt({heroStats:hero},{petBuffAuto:false},'mage')).includes(4699),'маг без своего — берёт');
 assert.ok(!V.plan(F.ids('mage'),V.stats('mage',{...hero,cat:null}),null).some(x=>x.id===4699),'маг без кота — не берёт');
 const M=V.stats('mage',{...hero,cat:null});assert.equal(V.dps(M,[4699]).total,V.dps(M,[]).total,'урон мага от crit/ck не меняется');
});

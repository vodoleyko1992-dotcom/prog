'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
function cut(a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,'границы функций обучения');return source.slice(i,j);}
const code=cut('let LEARN = null','// селекторы:')+cut('const apiPath =','// Replace stale local fallbacks');
const clone=x=>JSON.parse(JSON.stringify(x)),NOW=1793270000000,KEY='GET /game/rebirth-raids/next';
const empty=(saved=NOW)=>({v:1,t0:NOW-86400000,saved,sel:{},pages:{},api:{},changes:[]});
function harness(initial=empty()){
 let now=NOW,stored=clone(initial),writes=[],session=new Map(),writeMode='ok',pending=[];
 const area={get:async()=>({learn:clone(stored)}),set:items=>{
  const snapshot=clone(items.learn);writes.push(snapshot);
  if(writeMode==='throw')throw Error('storage unavailable');
  if(writeMode==='reject')return Promise.reject(Error('storage unavailable'));
  if(writeMode==='defer')return new Promise((resolve,reject)=>pending.push({snapshot,resolve,reject}));
  stored=snapshot;return Promise.resolve();
 }};
 function page(opt={}){
  let timers=[],listeners={};class Clock extends Date{static now(){return now}}
  const box={console,Date:Clock,Math,JSON,Object,Array,String,Number,Map,Set,cfg:{autoLearn:true},tabIdle:!!opt.idle,document:{prerendering:!!opt.prerender},location:{pathname:'/battle.html'},learnPk:()=> 'battle',hashStr:()=>'',rec(){},isPrivate:()=>false,domSnapshot:()=>'',
   setTimeout:(cb,ms)=>{const t={cb,at:now+ms};timers.push(t);return t},setInterval:(cb,ms)=>{const t={cb,at:now+ms,repeat:ms};timers.push(t);return t},addEventListener:(name,cb)=>{listeners[name]=cb},
   sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},chrome:{storage:{local:area},runtime:{getManifest:()=>({version:'20.80'}),sendMessage(){}}}};
  vm.createContext(box);vm.runInContext(code+'\nthis.learnApiTest={load:learnLoad,net:learnNet,save:learnSave,get L(){return LEARN},get dirty(){return learnDirty},get savedT(){return learnSavedT}}',box);
  return {api:box.learnApiTest,box,hide:()=>listeners.pagehide(),tick:async ms=>{const end=now+ms;for(;;){const t=timers.filter(t=>t.at<=end).sort((a,b)=>a.at-b.at)[0];if(!t)break;now=t.at;if(t.repeat)t.at+=t.repeat;else timers=timers.filter(x=>x!==t);t.cb();await settle();}now=end;},reset:L=>vm.runInContext('LEARN='+JSON.stringify(L)+';learnDirty=true;',box)};
 }
 return {page,writes,session,get stored(){return stored},get now(){return now},set mode(v){writeMode=v},accept:async()=>{const p=pending.shift();assert.ok(p);stored=p.snapshot;p.resolve();await settle()},reject:async()=>{const p=pending.shift();assert.ok(p);p.reject(Error('storage unavailable'));await settle()}};
}
const net=p=>p.api.net(KEY,{status:200,res:{phase:'mobs',spawnId:'rebirth_raid_demo'}});
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
const entry=()=>({n:1,keys:{phase:1},forms:{success:{n:1,keys:{phase:1}}},st:{200:1},first:NOW-10000,last:NOW-10000,page:'battle'});

test('20.81: короткие переходы не отодвигают трёхминутное сохранение обучения',async()=>{
 const h=harness(empty(NOW-3600000));
 for(let i=0;i<61;i++){const p=h.page();await p.api.load();net(p);await p.tick(i?10000:1000);p.hide();await settle();}
 assert.ok(h.writes.length>=3,'за десять минут есть периодические записи');assert.ok(h.writes.length<=5,'не пишем большой learn после каждого боя');
 assert.ok(h.stored.api[KEY]?.n>=50,'новый Rebirth endpoint и счётчик дошли до отчёта');assert.ok(h.now-h.stored.saved<=180000);
});
test('20.81: новый endpoint сохраняется при уходе до отложенных 1,5 секунды',async()=>{
 const h=harness(),p=h.page();await p.api.load();net(p);await p.tick(500);p.hide();await settle();
 assert.equal(h.writes.length,1);assert.equal(h.stored.api[KEY].n,1);assert.equal(p.api.dirty,false);
});
test('20.81: обычные счётчики не вызывают запись на каждом коротком бою',async()=>{
 const L=empty();L.api[KEY]=entry();const h=harness(L);
 for(let i=0;i<10;i++){const p=h.page();await p.api.load();net(p);await p.tick(10000);p.hide();await settle();}
 assert.equal(h.writes.length,0);assert.equal(JSON.parse(h.session.get('l2botLearn')).L.api[KEY].n,11);
});
test('20.81: просроченный durable saved восстанавливается из sessionStorage без нового endpoint',async()=>{
 const L=empty(NOW-181000);L.api[KEY]=entry();const h=harness(L);h.session.set('l2botLearn',JSON.stringify({t:NOW-1000,L}));
 const p=h.page();await p.api.load();net(p);await p.tick(100);p.hide();await settle();assert.equal(h.writes.length,1);assert.equal(h.stored.api[KEY].n,2);
});
for(const mode of ['reject','throw'])test('20.81: '+mode+' записи не очищает dirty и резервную копию; повтор сохраняет данные',async()=>{
 const h=harness(),p=h.page();await p.api.load();net(p);await p.tick(100);p.hide();await settle();
 // Первая успешная выгрузка нужна только для общей одинаковой исходной точки.
 net(p);h.session.set('l2botLearn',JSON.stringify({t:h.now,L:p.api.L}));const saved=h.stored.saved;h.mode=mode;
 await p.api.save();await settle();assert.equal(p.api.dirty,true);assert.ok(h.session.has('l2botLearn'));assert.equal(h.stored.saved,saved);
 h.mode='ok';await p.api.save();await settle();assert.equal(h.stored.api[KEY].n,2);assert.equal(p.api.dirty,false);assert.equal(h.session.has('l2botLearn'),false);
});
test('20.81: изменения во время записи остаются dirty и не теряют sessionStorage',async()=>{
 const h=harness(),p=h.page();await p.api.load();net(p);h.mode='defer';p.api.save();await settle();net(p);p.hide();await settle();
 assert.equal(h.writes.length,1,'одна запись в полёте');await h.accept();assert.equal(h.stored.api[KEY].n,1);assert.equal(p.api.dirty,true);
 assert.equal(JSON.parse(h.session.get('l2botLearn')).L.api[KEY].n,2);h.mode='ok';await p.api.save();await settle();assert.equal(h.stored.api[KEY].n,2);
});
test('20.81: уход во время незавершённой записи сохраняет копию даже при dirty=false',async()=>{
 const h=harness(),p=h.page();await p.api.load();net(p);h.mode='defer';p.api.save();await settle();p.hide();await settle();
 assert.equal(JSON.parse(h.session.get('l2botLearn')).L.api[KEY].n,1);await h.reject();assert.equal(p.api.dirty,true);assert.ok(h.session.has('l2botLearn'));
});
test('20.81: наблюдение в ту же миллисекунду, что ACK, переживает следующую страницу',async()=>{
 const h=harness(),p=h.page();await p.api.load();net(p);h.mode='defer';p.api.save();await settle();net(p);p.hide();await settle();await h.accept();
 const next=h.page();await next.api.load();assert.equal(next.api.L.api[KEY].n,2);
});
for(const option of ['idle','prerender'])test('20.81: '+option+' запрещает persistent-запись и сохраняет dirty',async()=>{
 const h=harness(),p=h.page({[option]:true});await p.api.load();net(p);await p.api.save();await settle();assert.equal(h.writes.length,0);assert.equal(p.api.dirty,true);
});
test('20.81: sessionStorage другой эпохи t0 не возвращает сброшенное обучение',async()=>{
 const L=empty();L.api[KEY]=entry();const h=harness(L);const old=clone(L);old.t0--;old.api[KEY].n=99;h.session.set('l2botLearn',JSON.stringify({t:NOW+1,L:old}));
 const p=h.page();await p.api.load();assert.equal(p.api.L.t0,L.t0);assert.equal(p.api.L.api[KEY].n,1);
});
test('20.81: будущий saved не откладывает запись навсегда, используется допустимый t0',async()=>{
 const L=empty(NOW+86400000);L.api[KEY]=entry();const h=harness(L),p=h.page();await p.api.load();net(p);await p.tick(100);p.hide();await settle();assert.equal(h.writes.length,1);assert.equal(h.stored.api[KEY].n,2);
});
test('20.81: ACK прежнего объекта не очищает dirty и копию новой эпохи обучения',async()=>{
 const h=harness(),p=h.page();await p.api.load();net(p);h.mode='defer';p.api.save();await settle();const next=empty();next.t0=NOW;next.api[KEY]=entry();next.api[KEY].n=7;p.reset(next);p.hide();await settle();await h.accept();
 assert.equal(p.api.L.t0,NOW);assert.equal(p.api.dirty,true);assert.equal(JSON.parse(h.session.get('l2botLearn')).L.api[KEY].n,7);
});

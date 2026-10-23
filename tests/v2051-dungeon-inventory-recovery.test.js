'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.L2_DUNGEON_SOURCE||path.join(__dirname,'../content.js'),'utf8');
const automation=source.slice(source.indexOf('function automationSnapshot()'),source.indexOf('\n',source.indexOf('async function automationFlush(')));
const context=source.match(/^const invContext = .*;$/m)?.[0];
const begin=source.indexOf('async function inventoryRecover('),recover=source.slice(begin,source.indexOf('\n// 15.10, MV3 startup:',begin));
const ready=source.slice(source.indexOf('async function inventoryReady()'),source.indexOf('const actNet ='));
const current=ready.match(/  const key=invContext\(\),kick=.*\n  const current=\(\)=>.*;/)?.[0];
assert.ok(context&&current&&recover.includes('location.reload()'),'проверяем реальные функции и callback текущего preflight');
const clone=x=>JSON.parse(JSON.stringify(x));

// 20.51 (лог23.10 12:12): настоящий recovery и его actor/flush guards; управляются только внешние условия и ACK.
function fixture(options={}){
 let now=1800000000000,reloads=0,commits=0,ack=true,hook=null,writeError=false,readError=false,hero='Hero',antibot=null;
 const stored=options.stored||{},logs=[],snapshotWrites=[],route={id:'fixture-route',step:'arrive',paid:true};
 const box={Date:class extends Date{static now(){return now}},on:true,tabOwner:true,leaseEpoch:'fixture-lease',automationGeneration:1,
  cfg:{task:'cat',tvtOn:false,taskOnly:false},modeSig:c=>c.task,
  rt:{char:'Hero',classCur:{prof:'human_warlord',slot:3},manualKickAt:0,rbHunt:clone(route),actionPayments:{pending:null}},
  heroNick:()=>hero,INV_READY:'',invClassReady:()=>true,invQty:()=>null,
  location:{pathname:options.page||'/dungeon.html',search:options.search??'?dungeonId=necropolis_of_martyrdom',reload(){reloads++}},
  sessionStorage:{getItem(k){if(readError)throw Error('fixture read failure');return stored[k]??null},setItem(k,v){if(writeError)throw Error('fixture write failure');stored[k]=v;snapshotWrites.push({k,v})}},
  rec:(...x)=>logs.push(clone(x)),antibotState:()=>antibot,
  L2V7Modules:{actions:{canAct:()=>true},payments:{blocked:()=>false,pending:()=>null},navigation:{travelPending:()=>false},tvt:{tvtHold:()=>false}},
  rtCommit:async()=>{commits++;if(hook)await hook();return ack}};
 vm.createContext(box);vm.runInContext(automation+'\n'+context+'\n'+recover+'\n;this.invContext=invContext;this.captureCurrent=()=>{'+current+';return current;};',box);
 const active=box.captureCurrent(),baseline=clone(box.rt);
 return {box,stored,logs,snapshotWrites,baseline,active,run:()=>box.inventoryRecover(active),reloads:()=>reloads,commits:()=>commits,
  tick:ms=>{now+=ms},now:()=>now,ack:v=>ack=v,flushHook:f=>hook=f,hero:v=>hero=v,antibot:v=>antibot=v,writeError:v=>writeError=v,readError:v=>readError=v};
}
const unchanged=f=>assert.deepEqual(clone(f.box.rt),f.baseline,'recovery не сбрасывает маршрут, оплату и память героя');

for(const page of ['/dungeon.html','/map.html'])test('после повторных отказов можно перечитать только текущую безопасную страницу '+page,async()=>{
 const f=fixture({page});assert.equal(await f.run(),true);assert.equal(f.commits(),1);assert.equal(f.reloads(),1);unchanged(f);
 const marker=JSON.parse(f.stored['l2bot-inv-reload']);assert.deepEqual(marker,{char:'Hero',page,at:f.now()});
 assert.equal(f.logs.length,1);assert.deepEqual(f.logs[0].slice(0,2),['S','восстановление']);
 assert.equal(f.logs[0][2],'Сумка не подтверждена после нескольких попыток — перезагружаю '+(page==='/dungeon.html'?'страницу подземелья':'карту')+' и продолжу проверку');
});
for(const page of ['/battle.html','/mail.html','/fishing.html','/town-buffer.html','/dungeon.html.other','/catacombs.html'])test('recovery не запускается на '+page,async()=>{
 const f=fixture({page});assert.equal(await f.run(),false);assert.equal(f.commits(),0);assert.equal(f.reloads(),0);assert.equal(f.snapshotWrites.length,0);
});
test('перезагрузка подземелья ограничена пятью минутами и после нового документа',async()=>{
 const first=fixture();assert.equal(await first.run(),true);const next=fixture({stored:first.stored});assert.equal(await next.run(),false);assert.equal(next.reloads(),0);assert.equal(next.commits(),0);
 next.tick(299999);assert.equal(await next.run(),false);next.tick(1);assert.equal(await next.run(),true);assert.equal(next.reloads(),1);unchanged(next);
});
test('метка другой страницы не подменяет cooldown текущего подземелья',async()=>{
 const f=fixture({stored:{'l2bot-inv-reload':JSON.stringify({char:'Hero',page:'/map.html',at:1800000000000})}});assert.equal(await f.run(),true);assert.equal(f.reloads(),1);
});
for(const [name,change]of[
 ['Stop',f=>f.box.on=false],['владелец',f=>f.box.tabOwner=false],['аренда',f=>f.box.leaseEpoch='other'],['герой',f=>f.box.rt.char='Other'],['HUD',f=>f.hero('Other')],
 ['класс',f=>f.box.rt.classCur={prof:'human_warlock',slot:0}],['новый Start',f=>f.box.rt.manualKickAt++],['поколение',f=>f.box.automationGeneration++],['режим',f=>f.box.cfg.task='fish'],
 ['canAct',f=>f.box.L2V7Modules.actions.canAct=()=>false],['капча',f=>f.antibot({active:true})],['ожидающая оплата',f=>f.box.L2V7Modules.payments.pending=()=>({id:'pending'})],
 ['запись оплаты',f=>f.box.L2V7Modules.payments.blocked=()=>true],['перелёт',f=>f.box.L2V7Modules.navigation.travelPending=()=>true],['заброс',f=>f.box.rt.fishCastPending={id:'pending'}],
 ['воскрешение',f=>f.box.rt.revive=true],['PvE-пауза',f=>f.box.rt.pveBlockUntil=f.now()+1000],['TvT',f=>{f.box.cfg.tvtOn=true;f.box.L2V7Modules.tvt.tvtHold=()=>true}],['ручная задача',f=>f.box.cfg.taskOnly=true]
]){
 test('перед flush '+name+' запрещает recovery подземелья',async()=>{const f=fixture();change(f);assert.equal(await f.run(),false);assert.equal(f.reloads(),0);assert.equal(f.commits(),0);assert.equal(f.snapshotWrites.length,0)});
 test('после flush '+name+' повторно запрещает reload',async()=>{const f=fixture();f.flushHook(()=>change(f));assert.equal(await f.run(),false);assert.equal(f.reloads(),0);assert.equal(f.commits(),1);assert.equal(f.snapshotWrites.length,0)});
}
for(const [name,change]of[
 ['другой путь',f=>f.box.location.pathname='/map.html'],['другое подземелье',f=>f.box.location.search='?dungeonId=other']
])test('смена URL во время flush запрещает reload: '+name,async()=>{
 const f=fixture();f.flushHook(()=>change(f));assert.equal(await f.run(),false);assert.equal(f.commits(),1);assert.equal(f.reloads(),0);assert.equal(f.snapshotWrites.length,0);
});
for(const [name,change]of[
 ['путь боя',f=>f.box.location.pathname='/battle.html'],['параметр подземелья',f=>f.box.location.search='?dungeonId=other']
])test('смена URL между первичным guard и flush запрещает reload: '+name,async()=>{
 const f=fixture();f.box.INV_READY=f.box.invContext();f.box.invQty=()=>{change(f);return null};
 assert.equal(await f.run(),false);assert.equal(f.commits(),0);assert.equal(f.reloads(),0);assert.equal(f.snapshotWrites.length,0);
});
test('неподтверждённый flush сохраняет страницу и не пишет маркер',async()=>{const f=fixture();f.ack(false);assert.equal(await f.run(),false);assert.equal(f.commits(),1);assert.equal(f.reloads(),0);assert.equal(f.snapshotWrites.length,0)});
test('здоровый preflight отменяет лишнюю перезагрузку',async()=>{const f=fixture();f.box.INV_READY=f.box.invContext();f.box.invQty=()=>0;assert.equal(await f.run(),false);assert.equal(f.commits(),0);assert.equal(f.reloads(),0)});
test('здоровый preflight, появившийся во время flush, отменяет reload',async()=>{const f=fixture();f.flushHook(()=>{f.box.INV_READY=f.box.invContext();f.box.invQty=()=>0});assert.equal(await f.run(),false);assert.equal(f.commits(),1);assert.equal(f.reloads(),0)});
test('неизвестный исход записи маркера не допускает неконтролируемого reload',async()=>{const f=fixture();f.writeError(true);assert.equal(await f.run(),false);assert.equal(f.reloads(),0)});
test('ошибка чтения маркера не допускает неконтролируемого reload',async()=>{const f=fixture();f.readError(true);assert.equal(await f.run(),false);assert.equal(f.reloads(),0)});
test('невалидная прежняя метка не допускает цикла перезагрузок',async()=>{const f=fixture({stored:{'l2bot-inv-reload':'invalid'}});assert.equal(await f.run(),false);assert.equal(f.reloads(),0)});
test('пустая аренда не разрешает перезагрузку',async()=>{const f=fixture();f.box.leaseEpoch='';assert.equal(await f.run(),false);assert.equal(f.reloads(),0)});

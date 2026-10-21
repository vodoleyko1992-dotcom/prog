'use strict';
// 15.10: новый персонаж не наследует режим заточки; свой сохранённый профиль не теряет очередь и историю.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const E=require('../engine-core.js');
const source=fs.readFileSync(__dirname+'/../background.js','utf8');
const start=source.indexOf('async function switchCharacter('),end=source.indexOf('// 8.0.6 (Firefox',start);
assert.ok(start>=0&&end>start);
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture(extra={}) {
 const cfg={enchantMode:true,enchant:{enabled:true,queue:[{key:'old-item',targetLevel:15}],maxAttempts:20,maxScrolls:20},shopReserve:12345};
 const rt={char:'OldHero',enchant:{runId:'old-series',status:'paused',pending:{id:'old-pending',state:'unknown'}},enchantArchive:[{runId:'history'}]};
 const state={on:false,cfg,rt,...clone(extra)};
 const box={Date,LOCK_TTL:85000,serializeLock:fn=>fn(),chrome:{storage:{local:{get:async()=>clone(state),set:async patch=>Object.assign(state,clone(patch))}}}};
 vm.runInNewContext(source.slice(start,end),box);
 return {state,cfg:clone(cfg),rt:clone(rt),switch:()=>box.switchCharacter({nick:'NewHero',vis:true,src:'test',roles:[],defRt:{}},{tab:{id:1,active:true}})};
}
test('новый герой получает mode OFF и пустую очередь, старый профиль с pending сохраняется целиком',async()=>{
 const f=fixture();assert.equal((await f.switch()).ok,true);
 assert.equal(f.state.cfg.enchantMode,false);assert.equal(f.state.cfg.enchant.enabled,false);assert.deepEqual(f.state.cfg.enchant.queue,[]);
 assert.equal(f.state.cfg.enchant.maxAttempts,0);assert.equal(f.state.cfg.enchant.maxScrolls,0);assert.equal(f.state.cfg.shopReserve,12345);
 assert.equal(f.state.rt.char,'NewHero');assert.equal(f.state.rt.enchant,undefined);assert.equal(f.state.rt.enchantArchive,undefined);
 assert.deepEqual(f.state['cfg@OldHero'],f.cfg);assert.deepEqual(f.state['rt@OldHero'],f.rt);
});
test('возврат к известному герою восстанавливает его собственный режим, лимиты и неизвестную попытку',async()=>{
 const cfg={enchantMode:true,enchant:{enabled:true,queue:[{key:'own-item'}],maxAttempts:4,maxScrolls:3}};
 const rt={char:'NewHero',enchant:{runId:'own-series',status:'paused',pending:{id:'own-pending',state:'unknown'},totals:{attempts:2}},enchantArchive:[{runId:'own-history'}]};
 const f=fixture({'cfg@NewHero':cfg,'rt@NewHero':rt});assert.equal((await f.switch()).ok,true);
 assert.deepEqual(f.state.cfg,cfg);assert.deepEqual(f.state.rt.enchant,rt.enchant);assert.deepEqual(f.state.rt.enchantArchive,rt.enchantArchive);
});
test('старый профиль без нового флага не получает разрешение заточки от предыдущего героя',async()=>{
 const saved={enchant:{enabled:true,queue:[{key:'legacy'}],maxAttempts:8,maxScrolls:8}};
 const f=fixture({'cfg@NewHero':saved});assert.equal((await f.switch()).ok,true);
 assert.deepEqual(f.state.cfg,saved);assert.notEqual(f.state.cfg.enchantMode,true);assert.equal(f.state.cfg.enchant.queue[0].key,'legacy');
});
function menuFixture() {
 const session={runId:'run',status:'running',pending:{id:'pending',revision:7,state:'prepared'},totals:{attempts:3,reservedScrolls:1},history:[{id:'receipt3'}],items:[{key:'item',level:4}]};
 const state={on:false,cfg:{enchant:{enabled:true,queue:[{key:'item'}],maxAttempts:8,maxScrolls:9}},rt:{char:'Hero',enchant:clone(session),enchantArchive:[{runId:'past'}],keep:42}};
 let beforeLock=null;
 const writes=[],box={L2EngineCore:E,URL,Date,MAX_PATCH_KEYS:250,serializeLock:async fn=>{if(beforeLock)await beforeLock();return fn()},chrome:{runtime:{getURL:p=>'chrome-extension://fixture/'+p},storage:{local:{get:async()=>clone(state),set:async patch=>{writes.push(clone(patch));Object.assign(state,clone(patch));}}}}};
 const i=source.indexOf('async function menuPatch('),j=source.indexOf('async function switchCharacter(',i);assert.ok(i>=0&&j>i);vm.runInNewContext(source.slice(i,j),box);
 // 20.41: Start/Stop из меню после записи «on» зовут afterOnWrite (слушателя storage.onChanged в фоне нет)
 vm.runInNewContext(source.slice(source.indexOf('const paint ='),source.indexOf("chrome.storage.local.get('on').then(s => paintOn")),box);
 return {state,writes,session,lock:fn=>{beforeLock=fn},patch:m=>box.menuPatch({expectedChar:'Hero',rtPatch:{},...m},{url:'chrome-extension://fixture/popup.html'})};
}
for(const [name,selected,old] of [['вход из старого профиля',true,undefined],['выход',false,true],['повторный явный выбор',true,true]])test(name+': режим атомарно паузит серию и сохраняет каждый результат/лимит',async()=>{
 const f=menuFixture();if(old!==undefined)f.state.cfg.enchantMode=old;
 const cfg=clone(f.state.cfg.enchant);assert.equal((await f.patch({cfgPatch:{enchantMode:selected},rtPatch:{manualKickAt:123},on:true})).ok,true);
 assert.equal(f.state.on,true);assert.equal(f.state.cfg.enchantMode,selected);assert.equal(f.state.rt.enchant.status,'paused');assert.match(f.state.rt.enchant.reason,/Продолжить|продолжение/);
 const actual=clone(f.state.rt.enchant);delete actual.status;delete actual.reason;const expected=clone(f.session);delete expected.status;assert.deepEqual(actual,expected);
 assert.deepEqual(f.state.cfg.enchant,cfg);assert.deepEqual(f.state.rt.enchantArchive,[{runId:'past'}]);assert.equal(f.state.rt.keep,42);assert.equal(f.state.rt.manualKickAt,123);
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].rt.enchant.status,'paused');assert.equal(f.writes[0].cfg.enchantMode,selected);
});
test('ACK перед захватом очереди сохраняется; старый снимок меню не возвращает pending и счётчики',async()=>{
 const f=menuFixture(),stale=clone(f.session);
 f.lock(()=>{f.state.rt.enchant={...f.state.rt.enchant,pending:null,totals:{attempts:4,reservedScrolls:0},history:[{id:'receipt4'},...f.state.rt.enchant.history]}});
 assert.equal((await f.patch({cfgPatch:{enchantMode:false},rtPatch:{enchant:stale,manualKickAt:99}})).ok,true);
 assert.equal(f.state.rt.enchant.status,'paused');assert.equal(f.state.rt.enchant.pending,null);assert.equal(f.state.rt.enchant.totals.attempts,4);assert.equal(f.state.rt.enchant.totals.reservedScrolls,0);assert.equal(f.state.rt.enchant.history[0].id,'receipt4');
});
for(const patch of [{rtPatch:{}},{rtPatch:{manualKickAt:123},on:true},{cfgPatch:{shopReserve:555}},{cfgPatch:{enchant:{enabled:true,maxAttempts:10,maxScrolls:10}}}])test('обычная команда без выбора режима не паузит серию: '+JSON.stringify(patch),async()=>{
 const f=menuFixture();assert.equal((await f.patch(patch)).ok,true);assert.deepEqual(f.state.rt.enchant,f.session);
});
test('поздний ACK со статусом done не заменяется паузой при выборе другого режима',async()=>{
 const f=menuFixture();f.lock(()=>{f.state.rt.enchant={...f.state.rt.enchant,status:'done',pending:null,reason:'Все цели достигнуты'}});
 assert.equal((await f.patch({cfgPatch:{enchantMode:false}})).ok,true);assert.equal(f.state.rt.enchant.status,'done');assert.equal(f.state.rt.enchant.pending,null);assert.equal(f.state.rt.enchant.reason,'Все цели достигнуты');
});

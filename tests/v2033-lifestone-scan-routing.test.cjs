'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=n=>fs.readFileSync(__dirname+'/../'+n,'utf8'),popup=read('popup.js'),content=read('content.js');
const start=popup.includes('async function lsScanTab(')?popup.indexOf('async function lsScanTab('):popup.indexOf('async function lsCommand(');
const commands=popup.slice(start,popup.indexOf('async function lsAction(',start));
const clone=x=>JSON.parse(JSON.stringify(x));
function routing({on=false,lock=null,active=1,tabs=[{id:1},{id:2}],ready={2:true},char='Hero'}={}){
 const state={rt:{char,manualKickAt:7},on,lock},calls=[],box={Date,Number,Error,console,setTimeout,clearTimeout,controlGeneration:1,DOCKED:false};
 let probeHook=()=>{};
 box.activeTab=async()=>tabs.find(t=>t.id===active)||{id:active};
 box.chrome={storage:{local:{get:async()=>clone(state)}},tabs:{query:async()=>clone(tabs),sendMessage:async(id,m)=>{
  calls.push({id,...clone(m)});
  if(m.cmd==='lifestoneTarget'){await probeHook(id,m);if(ready[id]==='dead')throw Error('no receiver');if(ready[id]==='hang')return new Promise(()=>{});return ready[id]?{ok:true}:{ok:false,reason:'wrong hero'};}
  return ready[id]?{ok:true}:{ok:false,reason:'Персонаж изменился'};
 }}};
 vm.createContext(box);vm.runInContext(commands+'\nthis.scan=()=>lsCommand("scan","Hero");this.command=a=>lsCommand(a,"Hero");',box);
 return {box,state,calls,scan:()=>box.scan(),command:a=>box.command(a),hook:fn=>probeHook=fn};
}
test('OFF: первая вкладка чужого героя не блокирует чтение из второй, команды только одной вкладке',async()=>{
 const f=routing();await f.scan();assert.deepEqual(f.calls.filter(x=>x.cmd==='lifestoneCommand').map(x=>x.id),[2]);assert.ok(f.calls.some(x=>x.id===1&&x.cmd==='lifestoneTarget'));assert.deepEqual(f.calls.find(x=>x.cmd==='lifestoneCommand').scanContext,{on:false,kick:7});
});
test('ON: мёртвая сохранённая вкладка не скрывает подтверждённого владельца',async()=>{
 const f=routing({on:true,lock:{tab:9,t:Date.now()},ready:{9:'dead',2:true}});await f.scan();assert.deepEqual(f.calls.filter(x=>x.cmd==='lifestoneCommand').map(x=>x.id),[2]);
});
test('подтверждённая активная вкладка читается один раз без обхода остальных',async()=>{
 const f=routing({ready:{1:true,2:true}});await f.scan();assert.deepEqual(f.calls.filter(x=>x.cmd==='lifestoneCommand').map(x=>x.id),[1]);assert.equal(f.calls.filter(x=>x.cmd==='lifestoneTarget').length,1);
});
test('ни одна вкладка не подтвердила героя: никакой команды и понятная ошибка',async()=>{
 const f=routing({ready:{}});await assert.rejects(f.scan,/вкладк|обновите/i);assert.equal(f.calls.filter(x=>x.cmd==='lifestoneCommand').length,0);
});
for(const kind of ['hero','on','kick','generation'])test('изменение '+kind+' во время probe отменяет чтение без команды',async()=>{
 const f=routing({ready:{1:true}});f.hook(()=>{if(kind==='hero')f.state.rt.char='Other';if(kind==='on')f.state.on=true;if(kind==='kick')f.state.rt.manualKickAt++;if(kind==='generation')f.box.controlGeneration++;});
 await assert.rejects(f.scan,/измен|останов|обновите/i);assert.equal(f.calls.filter(x=>x.cmd==='lifestoneCommand').length,0);
});

test('зависший readonly probe ограничен таймером и не блокирует правильную вторую вкладку',async()=>{
 const f=routing({ready:{1:'hang',2:true}}),started=Date.now();await f.scan();assert.ok(Date.now()-started<3000);assert.deepEqual(f.calls.filter(x=>x.cmd==='lifestoneCommand').map(x=>x.id),[2]);
});
test('prepare/resume/reconcile используют прежний путь без probe и без fanout',async()=>{
 for(const action of ['prepare','resume','reconcile']){const f=routing({on:true,lock:{tab:2,t:Date.now()}});await f.command(action);assert.equal(f.calls.length,1);assert.equal(f.calls[0].id,2);assert.equal(f.calls[0].action,action);}
});
function probe(){
 const pos=content.indexOf('async function lifestoneTarget('),end=content.indexOf('async function lifestoneCommand(',pos);assert.ok(pos>=0,'readonly probe присутствует');
 const state={rt:{char:'Hero'},on:false},box={rt:{char:'Hero'},on:false,tabOwner:false,leaseEpoch:null,heroNick:()=> 'Hero',chrome:{storage:{local:{get:async()=>clone(state)}}}};
 vm.createContext(box);vm.runInContext(content.slice(pos,end)+'\nthis.probe=m=>lifestoneTarget(m);',box);return {state,box,run:()=>box.probe({char:'Hero',on:state.on})};
}
test('readonly OFF probe подтверждает героя без захвата lease, GET или записи',async()=>{const f=probe();assert.equal((await f.run()).ok,true);assert.equal(f.box.tabOwner,false);assert.equal(f.box.leaseEpoch,null);});
for(const kind of ['hud','memory','saved','mode','owner','lease'])test('readonly probe отклоняет '+kind,async()=>{
 const f=probe();if(kind==='hud')f.box.heroNick=()=> 'Other';if(kind==='memory')f.box.rt.char='Other';if(kind==='saved')f.state.rt.char='Other';if(kind==='mode')f.state.on=true;
 if(kind==='owner'||kind==='lease'){f.state.on=true;f.box.on=true;if(kind==='lease')f.box.tabOwner=true;}
 assert.equal((await f.run()).ok,false);
});
test('readonly ON probe подтверждает только работающего владельца',async()=>{const f=probe();f.state.on=true;f.box.on=true;f.box.tabOwner=true;f.box.leaseEpoch='owner';assert.equal((await f.run()).ok,true);});

for(const kind of ['on','kick'])test('command повторно отклоняет изменение '+kind+' после успешного probe до доставки сообщения',async()=>{
 const pos=content.indexOf('async function lifestoneCommand('),end=content.indexOf('\n// Автозаточка:',pos),records=[];
 const state={rt:{char:'Hero',manualKickAt:7},on:false},box={rt:{char:'Hero'},on:false,tabOwner:false,leaseEpoch:null,lifestoneCommandBusy:false,heroNick:()=> 'Hero',rec:(...a)=>records.push(a),chrome:{storage:{local:{get:async()=>clone(state)}}},tabLock:async()=>{throw Error('lease must not be acquired');}};
 vm.createContext(box);vm.runInContext(content.slice(pos,end)+'\nthis.command=m=>lifestoneCommand(m);',box);
 const result=await box.command({action:'scan',char:'Hero',scanContext:{on:kind==='on',kick:kind==='kick'?6:7}});
 assert.equal(result.ok,false);assert.match(result.reason,/Управление изменилось/);assert.equal(records.length,1);assert.equal(box.lifestoneCommandBusy,false);assert.equal(box.tabOwner,false);
});

test('сбой записи диагностического журнала не теряет отказ команды',async()=>{
 const pos=content.indexOf('async function lifestoneCommand('),end=content.indexOf('\n// Автозаточка:',pos);
 const box={lifestoneCommandBusy:true,rec:()=>{throw Error('log unavailable');}};vm.createContext(box);vm.runInContext(content.slice(pos,end)+'\nthis.command=m=>lifestoneCommand(m);',box);
 const result=await box.command({action:'scan'});assert.equal(result.ok,false);assert.match(result.reason,/Предыдущая команда/);
});

test('DOCK iframe без chrome.tabs отправляет чтение через runtime к своей игре',async()=>{
 const f=routing(),messages=[];f.box.DOCKED=true;delete f.box.chrome.tabs;f.box.activeTab=async()=>{throw Error('no tabs in dock');};f.box.chrome.runtime={sendMessage:async m=>{messages.push(clone(m));return {ok:true};}};
 await f.scan();assert.equal(messages.length,1);assert.deepEqual(messages[0],{cmd:'lifestoneDockCommand',action:'scan',char:'Hero',scanContext:{on:false,kick:7}});
});
for(const action of ['prepare','resume','pause','reconcile','acknowledge','close'])test('DOCK '+action+' использует тот же relay без chrome.tabs и смены команды',async()=>{
 const f=routing(),messages=[];f.box.DOCKED=true;delete f.box.chrome.tabs;f.box.chrome.runtime={sendMessage:async m=>{messages.push(clone(m));return {ok:true};}};await f.command(action);
 assert.deepEqual(messages,[{cmd:'lifestoneDockCommand',action,char:'Hero'}]);
});
test('DOCK показывает отказ текущей игры и не пробует другую вкладку',async()=>{
 const f=routing();f.box.DOCKED=true;delete f.box.chrome.tabs;f.box.chrome.runtime={sendMessage:async()=>({ok:false,reason:'Персонаж изменился'})};await assert.rejects(f.scan,/Персонаж изменился/);assert.equal(f.calls.length,0);
});

for(const kind of ['on','kick'])test('DOCK/manual scan отменяется при изменении '+kind+' во время захвата lease',async()=>{
 const pos=content.indexOf('async function lifestoneCommand('),end=content.indexOf('\n// Автозаточка:',pos),state={rt:{char:'Hero',manualKickAt:7},on:false};let calls=0;
 const box={rt:{char:'Hero',manualKickAt:7},on:false,tabOwner:false,leaseEpoch:null,lifestoneCommandBusy:false,heroNick:()=> 'Hero',rec:()=>{},quietErr:()=>{},rtWriter:{recover:async()=>({ok:true})},ipc:async()=>({ok:true}),chrome:{storage:{local:{get:async()=>clone(state)}}},L2V7Modules:{lifestone:{command:async()=>{calls++;return true;}}}};
 box.tabLock=async()=>{box.tabOwner=true;box.leaseEpoch='manual';if(kind==='on')box.on=true;else box.rt.manualKickAt++;return true;};
 vm.createContext(box);vm.runInContext(content.slice(pos,end)+'\nthis.command=m=>lifestoneCommand(m);',box);
 const result=await box.command({action:'scan',char:'Hero',scanContext:{on:false,kick:7}});assert.equal(result.ok,false);assert.match(result.reason,/Управление изменилось/);assert.equal(calls,0);
});

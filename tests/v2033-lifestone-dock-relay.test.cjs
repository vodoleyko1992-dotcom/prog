'use strict';
// Firefox: у встроенного меню нет tabs; адресатом команды остаётся только родитель iframe.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../background.js','utf8');
const fn=source.slice(source.indexOf('async function lifestoneDockCommand('),source.indexOf('\nchrome.runtime.onMessage.addListener',source.indexOf('async function lifestoneDockCommand(')));
function fixture(){
 const forwarded=[],reads=[],tabs=[],timerDelays=[],timers=new Map();let timerId=0;
 const state={on:false,rt:{char:'AuditHero',manualKickAt:10}},tab={id:7,url:'https://l2wap.com/char.html'};
 const sender={id:'bot@test',url:'moz-extension://bot-host/popup.html?dock=1',frameId:4,tab:{id:7,url:tab.url}};
 const request={cmd:'lifestoneDockCommand',action:'scan',char:'AuditHero',scanContext:{on:false,kick:10}};
 let answer={ok:true},fail=false,hung=false;
 const box={URL,console,chrome:{runtime:{id:'bot@test',getURL:p=>'moz-extension://bot-host/'+p,getManifest:()=>({version:'20.34'})},
  tabs:{get:async id=>{tabs.push(id);return {...tab}},sendMessage:async(...args)=>{forwarded.push(args);if(fail)throw Error('channel closed');if(hung)return new Promise(()=>{});return answer}},
  storage:{local:{get:async keys=>{reads.push(keys);return structuredClone(state)}}}},
  setTimeout:(cb,ms)=>{timerDelays.push(ms);timers.set(++timerId,cb);return timerId},clearTimeout:id=>timers.delete(id)};
 vm.createContext(box);vm.runInContext(fn+';globalThis.relay=lifestoneDockCommand',box);
 return {request,sender,state,tab,forwarded,reads,tabs,timers,timerDelays,run:()=>box.relay(request,sender),setAnswer:x=>answer=x,setFail:()=>fail=true,setHung:()=>hung=true};
}
test('Firefox dock scan routes once to actual parent/frame0 without tabs in menu or control mutations',async()=>{
 const f=fixture();f.request.tabId=999;f.sender.tab.url='https://ignored.invalid/';assert.equal((await f.run()).ok,true);
 assert.deepEqual(JSON.parse(JSON.stringify(f.forwarded)),[[7,{cmd:'lifestoneCommand',action:'scan',char:'AuditHero',scanContext:{on:false,kick:10}},{frameId:0}]]);
 assert.deepEqual(f.state,{on:false,rt:{char:'AuditHero',manualKickAt:10}});assert.deepEqual(f.tabs,[7]);assert.equal(f.timers.size,0);
});
for(const action of ['prepare','resume','pause','reconcile','acknowledge','close'])test('dock forwards existing '+action+' once; content retains authorization',async()=>{
 const f=fixture();f.request.action=action;f.request.injected={cmd:'install'};assert.equal((await f.run()).ok,true);
 assert.deepEqual(JSON.parse(JSON.stringify(f.forwarded)),[[7,{cmd:'lifestoneCommand',action,char:'AuditHero'},{frameId:0}]]);
});
const invalidSenders={
 foreignExtension:f=>f.sender.id='other@test',foreignHost:f=>f.sender.url='moz-extension://other-host/popup.html?dock=1',
 wrongProtocol:f=>f.sender.url='https://bot-host/popup.html?dock=1',foreignPage:f=>f.sender.url='https://l2wap.com/popup.html?dock=1',
 wrongPath:f=>f.sender.url='moz-extension://bot-host/other.html?dock=1',plainPopup:f=>f.sender.url='moz-extension://bot-host/popup.html',
 dockOff:f=>f.sender.url='moz-extension://bot-host/popup.html?dock=0',topFrame:f=>f.sender.frameId=0,
 missingFrame:f=>delete f.sender.frameId,missingTab:f=>delete f.sender.tab,negativeTab:f=>f.sender.tab.id=-1
};
for(const [name,change] of Object.entries(invalidSenders))test('dock rejects '+name+' before accessing game',async()=>{
 const f=fixture();change(f);assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,0);assert.equal(f.tabs.length,0);
});
for(const url of ['http://l2wap.com/char.html','https://l2wap.com.evil.test/char.html','moz-extension://bot-host/popup.html'])test('dock refuses non-game parent '+url,async()=>{
 const f=fixture();f.tab.url=url;assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,0);
});
test('navigating parent is not retried in another tab',async()=>{const f=fixture();f.tab.pendingUrl='https://l2wap.com/map.html';assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,0);});
test('changed character is rejected before forwarding',async()=>{const f=fixture();f.state.rt.char='OtherHero';assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,0);});
for(const change of [f=>f.state.on=true,f=>f.state.rt.manualKickAt=11,f=>delete f.request.scanContext,f=>f.request.scanContext.kick='10'])test('Stop/Start/stale or missing scan context never reaches content',async()=>{
 const f=fixture();change(f);assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,0);
});
test('unknown operation is rejected, never forwarded as arbitrary command',async()=>{const f=fixture();f.request.action='install';assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,0);});
test('content denial reaches menu and is not retried',async()=>{const f=fixture();f.setAnswer({ok:false,reason:'Персонаж изменился'});const r=await f.run();assert.equal(r.ok,false);assert.equal(r.reason,'Персонаж изменился');assert.equal(f.forwarded.length,1);});
test('closed channel reports failure without fallback or request replay',async()=>{const f=fixture();f.setFail();assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,1);assert.equal(f.timers.size,0);});
test('hung content response releases relay deadline without replay',async()=>{
 const f=fixture();f.setHung();const pending=f.run();for(let i=0;i<10&&!f.timers.size;i++)await Promise.resolve();assert.deepEqual(f.timerDelays,[30000]);
 [...f.timers.values()][0]();const r=await pending;assert.equal(r.ok,false);assert.match(r.reason,/не ответила/);assert.equal(f.forwarded.length,1);assert.equal(f.timers.size,0);
});
test('OFF Start wake is authorized only after on=true, and targets parent with exact actor/start',async()=>{
 const f=fixture();f.request.action='wake';f.request.startContext={on:true,kick:10};f.state.on=true;f.setAnswer({ok:true,running:true,owner:true,v:'20.34'});assert.equal((await f.run()).ok,true);
 assert.deepEqual(JSON.parse(JSON.stringify(f.forwarded)),[[7,{cmd:'kick',expectedChar:'AuditHero',expectedKick:10},{frameId:0}]]);
});
test('wake cannot start a stopped bot',async()=>{const f=fixture();f.request.action='wake';assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,0);});
for(const answer of [{ok:true,running:false,owner:true,v:'20.34'},{ok:true,running:true,owner:false,v:'20.34'},{ok:true,running:true,owner:true,v:'20.33'}])test('wake requires running owner ACK of current version',async()=>{
 const f=fixture();f.request.action='wake';f.request.startContext={on:true,kick:10};f.state.on=true;f.setAnswer(answer);assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,1);
});
const core=fs.readFileSync(__dirname+'/../content.js','utf8'),kick=core.slice(core.indexOf("  if (m.cmd === 'kick') {"),core.indexOf("  if (m.cmd === 'ping')"));
for(const field of ['storedHero','localHero','HUD','kick','stopped'])test('LS wake refuses stale '+field+' before starting main',async()=>{
 const state={on:true,rt:{char:'AuditHero',manualKickAt:10}},rt={char:'AuditHero'};let hud='AuditHero',starts=0,resolve;
 if(field==='storedHero')state.rt.char='OtherHero';if(field==='localHero')rt.char='OtherHero';if(field==='HUD')hud='OtherHero';if(field==='kick')state.rt.manualKickAt=11;if(field==='stopped')state.on=false;
 const answered=new Promise(r=>resolve=r),box={console,rt,heroNick:()=>hud,m:{cmd:'kick',expectedChar:'AuditHero',expectedKick:10},reply:resolve,main:()=>starts++,chrome:{storage:{local:{get:async()=>structuredClone(state)}}}};
 vm.createContext(box);vm.runInContext('(function(){'+kick+'})()',box);const r=await answered;assert.equal(r.ok,false);assert.match(r.reason,/изменились/);assert.equal(starts,0);
});

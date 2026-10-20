'use strict';
// Независимые гонки OFF Start → wake → resume: старый запуск не усыновляет новый.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=process.env.LS_REVIEW_ROOT||path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(root,n),'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
const content=read('content.js'),popup=read('popup.js'),background=read('background.js');
const kickBegin=content.indexOf("  if (m.cmd === 'kick') {"),kickEnd=content.indexOf("  if (m.cmd === 'ping')",kickBegin),kickSource=content.slice(kickBegin,kickEnd);
function kickFixture(changeAt,kind){
 let reads=0,changed=false,ack;const calls=[],state={on:true,cfg:{},rt:{char:'Hero',manualKickAt:10}};
 const box={Promise,Date,setTimeout,on:true,cfg:{},rt:clone(state.rt),hero:'Hero',automationGeneration:0,running:false,tabOwner:false,leaseEpoch:null,mergeCfg:x=>x,heartbeat(){},heroNick:()=>box.hero};
 function change(){changed=true;if(kind==='hero'){state.rt.char='OtherHero';box.hero='OtherHero';}if(kind==='kick')state.rt.manualKickAt++;if(kind==='stop')state.on=false;box.rt=clone(state.rt);box.on=state.on;box.automationGeneration++;}
 box.main=async()=>{calls.push({char:box.rt.char,kick:box.rt.manualKickAt});box.running=true;box.tabOwner=true;box.leaseEpoch='owned';};
 box.chrome={runtime:{getManifest:()=>({version:'20.34'})},storage:{local:{get:async()=>{reads++;if(!changed&&(changeAt==='stableRead'&&reads===2||changeAt==='ackRead'&&calls.length))change();return clone(state);}}}};
 vm.createContext(box);vm.runInContext('this.handle=function(m,reply){'+kickSource+'}',box);
 return {box,state,calls,run:async()=>{box.handle({cmd:'kick',expectedChar:'Hero',expectedKick:10},r=>ack=r);for(let n=0;n<60&&!ack;n++)await Promise.resolve();assert.ok(ack,'kick replies');return ack;}};
}
for(const kind of ['hero','kick','stop'])test('wake context change during stable state read prevents main: '+kind,async()=>{
 const f=kickFixture('stableRead',kind),answer=await f.run();assert.equal(answer.ok,false);assert.equal(f.calls.length,0,'old wake cannot start a different actor/start');
});
for(const kind of ['hero','kick','stop'])test('wake context change before ACK cannot acknowledge the replacement start: '+kind,async()=>{
 const f=kickFixture('ackRead',kind),answer=await f.run();assert.equal(answer.ok,false);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],{char:'Hero',kick:10});
});
test('unchanged explicit wake starts and acknowledges exactly its actor/start',async()=>{
 const f=kickFixture(),answer=await f.run();assert.equal(answer.ok,true);assert.equal(answer.owner,true);assert.equal(answer.running,true);assert.deepEqual(f.calls,[{char:'Hero',kick:10}]);
});
const relayBegin=background.indexOf('async function lifestoneDockCommand('),relaySource=background.slice(relayBegin,background.indexOf('\nchrome.runtime.onMessage.addListener',relayBegin));
function relayFixture(action,context){
 const calls=[],state={on:true,rt:{char:'Hero',manualKickAt:10}},sender={id:'audit',url:'moz-extension://audit-host/popup.html?dock=1',frameId:3,tab:{id:7}};
 const box={URL,Promise,setTimeout,clearTimeout,chrome:{runtime:{id:'audit',getURL:p=>'moz-extension://audit-host/'+p,getManifest:()=>({version:'20.34'})},tabs:{get:async()=>({url:'https://l2wap.com/augmentation.html'}),sendMessage:async(...args)=>{calls.push(clone(args));return{ok:true,running:true,owner:true,v:'20.34'};}},storage:{local:{get:async()=>clone(state)}}}};
 vm.createContext(box);vm.runInContext(relaySource+';this.run=lifestoneDockCommand;',box);return {state,calls,run:()=>box.run({action,char:'Hero',...(context?{startContext:context}:{})},sender)};
}
for(const action of ['wake','resume'])for(const kind of ['kick','off','falseOn'])test('dock '+action+' rejects the obsolete explicit start: '+kind,async()=>{
 const f=relayFixture(action,{on:kind!=='falseOn',kick:kind==='kick'?9:10});if(kind==='off')f.state.on=false;assert.equal((await f.run()).ok,false);assert.equal(f.calls.length,0);
});
test('wake requires a caller-captured start instead of adopting latest durable kick',async()=>{const f=relayFixture('wake');assert.equal((await f.run()).ok,false);assert.equal(f.calls.length,0);});
test('wake/resume forward the same captured start, never a replacement kick',async()=>{
 for(const action of ['wake','resume']){const f=relayFixture(action,{on:true,kick:10});assert.equal((await f.run()).ok,true);assert.equal(f.calls.length,1);const [id,m,options]=f.calls[0];assert.equal(id,7);assert.equal(options.frameId,0);assert.deepEqual(m,action==='wake'?{cmd:'kick',expectedChar:'Hero',expectedKick:10}:{cmd:'lifestoneCommand',action:'resume',char:'Hero',startContext:{on:true,kick:10}});}
});
const commandBegin=popup.indexOf('async function lsCommand('),commandSource=popup.slice(commandBegin,popup.indexOf('async function lsAction(',commandBegin));
function commandFixture(action,kind){
 const calls=[],state={rt:{char:'Hero',manualKickAt:10},on:true},box={DOCKED:true,controlGeneration:0};
 box.chrome={storage:{local:{get:async()=>{if(kind==='generation')box.controlGeneration++;return clone(state);}}},runtime:{sendMessage:async m=>{calls.push(clone(m));return{ok:true};}}};
 if(kind==='kick')state.rt.manualKickAt=11;if(kind==='off')state.on=false;
 vm.createContext(box);vm.runInContext(commandSource+';this.command=lsCommand;',box);return{calls,run:()=>box.command(action,'Hero',{on:true,kick:10})};
}
for(const action of ['wake','resume'])for(const kind of ['kick','off','generation'])test('popup '+action+' cannot replace captured context after await: '+kind,async()=>{const f=commandFixture(action,kind);await assert.rejects(f.run);assert.equal(f.calls.length,0);});
test('popup wake/resume retain caller startContext without touching unavailable tabs',async()=>{
 for(const action of ['wake','resume']){const f=commandFixture(action);await f.run();assert.deepEqual(f.calls,[{cmd:'lifestoneDockCommand',action,char:'Hero',startContext:{on:true,kick:10}}]);}
});

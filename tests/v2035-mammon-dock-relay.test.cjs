'use strict';
// 20.10.2026: анализ Маммона из iframe Firefox без chrome.tabs; вкладка определяется фоном.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('node:test');
const root = process.env.L2_SOURCE_ROOT || path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const begin = source.indexOf('async function mammonBagDockAnalyze(');
const relay = begin < 0 ? '' : source.slice(begin, source.indexOf('\nchrome.runtime.onMessage.addListener', begin));
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const uiSource = popup.slice(popup.indexOf('const mmBagUi ='), popup.indexOf('function renderMammon('));
const plain = x => JSON.parse(JSON.stringify(x));
function fixture() {
 const request = {cmd:'mammonBagDockAnalyze',expectedChar:'AuditHero',goalItem:920019,goalLvl:5};
 const sender = {id:'bot@test',url:'moz-extension://bot-host/popup.html?dock=1',frameId:2,tab:{id:7,url:'https://l2wap.com/char.html'}};
 const state = {on:false,rt:{char:'AuditHero'},cfg:{mmGoalItem:920019,mmGoalLvl:5},lock:null};
 const tab = {id:7,url:'https://l2wap.com/char.html'}, forwarded = [], tabs = [], timers = new Map(), delays = [];
 let answer = {ok:true}, failed = false, hung = false, id = 0;
 const box = {URL,Date,Number,Math,Promise,LOCK_TTL:90000,setTimeout:(fn,ms)=>{const key=++id;timers.set(key,fn);delays.push(ms);return key;},clearTimeout:key=>timers.delete(key),
  chrome:{runtime:{id:'bot@test',getURL:p=>'moz-extension://bot-host/'+p},storage:{local:{get:async()=>structuredClone(state)}},tabs:{
   get:async n=>{tabs.push(n);return structuredClone(tab);},
   sendMessage:async(...args)=>{forwarded.push(plain(args));if(failed)throw Error('channel closed');if(hung)return new Promise(()=>{});return answer;}
  }}};
 vm.createContext(box);
 if (!relay) throw Error('mammonBagDockAnalyze отсутствует: встроенное меню всё ещё вызывает недоступный chrome.tabs');
 vm.runInContext(relay+'\nglobalThis.runRelay=mammonBagDockAnalyze;',box);
 return {request,sender,state,tab,forwarded,tabs,timers,delays,run:()=>box.runRelay(request,sender),answer:x=>answer=x,fail:()=>failed=true,hang:()=>hung=true};
}
function uiFixture(docked=true) {
 const els={mmGoalItem:{value:'920019'},mmGoalLvl:{value:'5'},mmBagAnalyze:{},mmBagStatus:{}};
 const state={on:false,rt:{char:'AuditHero',classCur:{prof:'human_warlock',slot:0}},cfg:{mmGoalItem:920019,mmGoalLvl:5},lock:{tab:99,t:Date.now()}};
 const calls=[],timers=new Map();let timerId=0,answer={ok:true},hung=false,loads=0;
 const ctx={Date,Number,Math,JSON,Promise,DOCKED:docked,formChar:'AuditHero',$:id=>els[id],fmt:String,esc:String,
  setTimeout:(fn,ms)=>{const n=++timerId;timers.set(n,{fn,ms});return n;},clearTimeout:id=>timers.delete(id),load:async()=>{loads++;},
  activeTab:async()=>{assert.equal(docked,false,'iframe не должен обращаться к chrome.tabs.query через activeTab');return{id:7};},
  chrome:{storage:{local:{get:async()=>structuredClone(state)}},runtime:{sendMessage:async m=>{calls.push(['runtime',plain(m)]);return hung?new Promise(()=>{}):answer;}}}};
 if(!docked)ctx.chrome.tabs={sendMessage:async(...args)=>{calls.push(['tabs',...plain(args)]);return answer;}};
 vm.createContext(ctx);vm.runInContext(uiSource+'\nglobalThis.ui=mmBagUi;',ctx);ctx.ui.displayContext=ctx.mammonBagContext(state.rt,state.cfg);
 return{ctx,state,calls,els,timers,run:()=>ctx.analyzeMammonBag(),answer:x=>answer=x,hang:()=>hung=true,loads:()=>loads};
}
for(const on of [false,true])test('iframe без chrome.tabs: анализ при '+(on?'ON':'OFF')+' через runtime, без изменения запуска',async()=>{
 const f=uiFixture();f.state.on=on;const before=plain(f.state);assert.equal(f.ctx.chrome.tabs,undefined);
 await f.run();assert.equal(f.ctx.ui.error,'');assert.deepEqual(f.calls,[['runtime',{cmd:'mammonBagDockAnalyze',expectedChar:'AuditHero',goalItem:920019,goalLvl:5}]]);
 assert.deepEqual(f.state,before);assert.equal(f.els.mmBagAnalyze.disabled,false);assert.equal(f.timers.size,0);assert.equal(f.loads(),1);
});
for(const on of [false,true])test('отдельное меню сохраняет отправку в '+(on?'вкладку-владельца':'активную игру'),async()=>{
 const f=uiFixture(false);f.state.on=on;await f.run();assert.equal(f.ctx.ui.error,'');
 assert.deepEqual(f.calls,[['tabs',on?99:7,{cmd:'mammonBagAnalyze',expectedChar:'AuditHero',goalItem:920019,goalLvl:5}]]);
});
test('ошибка и таймаут relay видимы, прежний успешный анализ не изменяется',async()=>{
 const f=uiFixture();f.state.rt.mmBagAnalysis={t:123,status:'ok',char:'AuditHero'};f.answer({ok:false,reason:'Цель изменилась'});
 await f.run();assert.match(f.ctx.ui.error,/Цель изменилась/);assert.equal(f.state.rt.mmBagAnalysis.t,123);assert.equal(f.els.mmBagAnalyze.disabled,false);
 const hung=uiFixture();hung.hang();const pending=hung.run();for(let i=0;i<20&&!hung.timers.size;i++)await Promise.resolve();
 assert.equal(hung.timers.size,1);const timer=[...hung.timers.values()][0];assert.equal(timer.ms,20000);timer.fn();await pending;
 assert.match(hung.ctx.ui.error,/Не получен ответ/);assert.equal(hung.els.mmBagAnalyze.disabled,false);assert.equal(hung.calls.length,1);assert.equal(hung.timers.size,0);
});
test('фон выбирает только родительскую вкладку/frame0 и передаёт только команду анализа',async()=>{
 const f=fixture();f.request.tabId=999;f.request.action='upgrade';f.request.injected={cmd:'install'};f.sender.tab.url='https://untrusted.invalid/';f.answer({ok:true,private:'drop'});
 assert.deepEqual(plain(await f.run()),{ok:true});assert.deepEqual(f.tabs,[7]);
 assert.deepEqual(f.forwarded,[[7,{cmd:'mammonBagAnalyze',expectedChar:'AuditHero',goalItem:920019,goalLvl:5},{frameId:0}]]);assert.equal(f.timers.size,0);
 assert.deepEqual(f.state,{on:false,rt:{char:'AuditHero'},cfg:{mmGoalItem:920019,mmGoalLvl:5},lock:null});
});
const badSenders={foreignExtension:f=>f.sender.id='other@test',foreignOrigin:f=>f.sender.url='moz-extension://other/popup.html?dock=1',
 protocol:f=>f.sender.url='https://bot-host/popup.html?dock=1',path:f=>f.sender.url='moz-extension://bot-host/other.html?dock=1',
 regularPopup:f=>f.sender.url='moz-extension://bot-host/popup.html',dockOff:f=>f.sender.url='moz-extension://bot-host/popup.html?dock=0',
 mainFrame:f=>f.sender.frameId=0,noFrame:f=>delete f.sender.frameId,noTab:f=>delete f.sender.tab,negativeTab:f=>f.sender.tab.id=-1};
for(const[name,change]of Object.entries(badSenders))test('непроверенный sender '+name+' не обращается к вкладке',async()=>{
 const f=fixture();change(f);assert.equal((await f.run()).ok,false);assert.equal(f.tabs.length,0);assert.equal(f.forwarded.length,0);
});
for(const url of ['http://l2wap.com/char.html','https://l2wap.com.evil.test/char.html','moz-extension://bot-host/popup.html'])test('родитель не является HTTPS-игрой: '+url,async()=>{
 const f=fixture();f.tab.url=url;assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,0);
});
test('навигация родителя запрещает пересылку без поиска другой вкладки',async()=>{const f=fixture();f.tab.pendingUrl='https://l2wap.com/map.html';assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,0);});
for(const[name,change]of Object.entries({hero:f=>f.state.rt.char='OtherHero',goal:f=>f.state.cfg.mmGoalItem=920018,level:f=>f.state.cfg.mmGoalLvl=4,
 emptyHero:f=>f.request.expectedChar='',stringItem:f=>f.request.goalItem='920019',negativeItem:f=>f.request.goalItem=-1,fractionItem:f=>f.request.goalItem=1.5,
 zeroLevel:f=>f.request.goalLvl=0,tooHighLevel:f=>f.request.goalLvl=6,stringLevel:f=>f.request.goalLvl='5'}))test('чужой/несохранённый или некорректный контекст '+name+' отклонён',async()=>{
 const f=fixture();change(f);assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,0);
});
for(const on of [false,true])for(const age of [0,86000])test('чужая аренда запрещает анализ при on='+on+', возраст'+age,async()=>{const f=fixture();f.state.on=on;f.state.lock={tab:99,t:Date.now()-age};assert.equal((await f.run()).ok,false);assert.equal(f.forwarded.length,0);});
for(const owner of ['same','stale','none'])test('родительский анализ допускается при '+owner+' lock, остальные проверки остаются content',async()=>{
 const f=fixture();f.state.on=true;f.state.lock=owner==='none'?null:{tab:owner==='same'?7:99,t:owner==='stale'?Date.now()-90001:Date.now()};assert.equal((await f.run()).ok,true);assert.equal(f.forwarded.length,1);
});
test('content отказ и закрытый канал возвращаются один раз без повтора',async()=>{
 const denied=fixture();denied.answer({ok:false,reason:'Персонаж изменился',private:'drop'});assert.deepEqual(plain(await denied.run()),{ok:false,reason:'Персонаж изменился'});assert.equal(denied.forwarded.length,1);
 const failed=fixture();failed.fail();assert.equal((await failed.run()).ok,false);assert.equal(failed.forwarded.length,1);assert.equal(failed.timers.size,0);
});
test('зависший content ограничен20с без повтора, reason ограничен',async()=>{
 const f=fixture();f.hang();const pending=f.run();for(let i=0;i<20&&!f.timers.size;i++)await Promise.resolve();assert.deepEqual(f.delays,[20000]);[...f.timers.values()][0]();
 assert.equal((await pending).ok,false);assert.equal(f.forwarded.length,1);assert.equal(f.timers.size,0);
 const bounded=fixture();bounded.answer({ok:false,reason:'x'.repeat(1000)});const answer=await bounded.run();assert.equal(answer.ok,false);assert.ok(answer.reason.length<=240);
});

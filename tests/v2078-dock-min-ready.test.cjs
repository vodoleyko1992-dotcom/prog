'use strict';
// 20.78+ (скрин29.10): первый postMessage доку ушёл до загрузки popup — iframe ещё имел origin страницы игры.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
const begin=source.indexOf('let dockHb = 0, dockBorn = 0'),end=source.indexOf('// 7.2.1 (игрок 10.10',begin);
assert.ok(begin>=0&&end>begin,'настоящий обработчик пульса дока найден');
const code=source.slice(begin,end),same=(a,b,msg)=>assert.equal(JSON.stringify(a),JSON.stringify(b),msg);
function fixture(scheme='chrome'){
 const origin=scheme+'-extension://own-extension',gameOrigin='https://l2wap.com',posts=[],mismatches=[],listeners=[];
 let now=100000,current=null,serial=0;
 const makeFrame=()=>{const id=++serial,state={origin:gameOrigin};return{id,state,contentWindow:{postMessage(data,targetOrigin){
  posts.push({id,data:structuredClone(data),origin:targetOrigin});
  if(targetOrigin!==state.origin)mismatches.push({id,targetOrigin,recipientOrigin:state.origin});
 }}};};
 current=makeFrame();
 const document={hidden:false,querySelector:s=>s==='#l2bot-dock iframe'?current:null};
 const c={document,cfg:{dock:true},Date:class extends Date{static now(){return now}},
  URL:class{constructor(url){this.origin=String(url).match(/^[a-z-]+:\/\/[^/]+/)[0]}},
  chrome:{runtime:{getURL:p=>origin+'/'+p}},addEventListener:(type,fn)=>{if(type==='message')listeners.push(fn)},
  setInterval:()=>1,rec(){}};
 vm.createContext(c);vm.runInContext(code+'\nthis.api={setMin:value=>{dockShownMin=value;dockMinPost()},post:()=>dockMinPost(),read:()=>({dockHb,dockOrigin})};',c);
 const event=({source:sender=current?.contentWindow,from=origin,kind='hb',data}={})=>listeners.forEach(fn=>fn({source:sender,origin:from,data:data||{__l2dock:kind}}));
 const heartbeat=()=>{if(current)current.state.origin=origin;event();};
 const replace=()=>{const old=current;current=makeFrame();return old;};
 const clear=()=>{posts.length=0;mismatches.length=0;};
 return{c,origin,posts,mismatches,event,heartbeat,replace,clear,api:c.api,frame:()=>current,remove:()=>{current=null},tick:ms=>now+=ms};
}
const ready=(f,min=false)=>{f.api.setMin(min);f.heartbeat();f.clear();};

for(const scheme of ['chrome','moz'])test(scheme+': до собственного пульса iframe не получает postMessage с origin расширения',()=>{
 const f=fixture(scheme);f.api.setMin(false);f.api.setMin(true);f.api.post();
 same(f.posts,[],'ещё не загруженное окно игры не получает сообщение расширения');same(f.mismatches,[]);
});

for(const min of [false,true])test('собственный пульс передаёт последнее фактическое состояние, min='+min,()=>{
 const f=fixture();f.api.setMin(!min);f.api.setMin(min);f.clear();f.heartbeat();
 same(f.posts,[{id:f.frame().id,data:{__l2dock:'min',min},origin:f.origin}]);same(f.mismatches,[]);
});

test('после готовности смена свёрнутости сразу отправляется своему iframe',()=>{
 const f=fixture();ready(f);f.api.setMin(true);
 same(f.posts,[{id:f.frame().id,data:{__l2dock:'min',min:true},origin:f.origin}]);same(f.mismatches,[]);
});

test('замена iframe не переносит готовность предыдущего окна',()=>{
 const f=fixture();ready(f);f.replace();f.api.setMin(true);f.api.post();same(f.posts,[]);same(f.mismatches,[]);
 f.heartbeat();same(f.posts,[{id:f.frame().id,data:{__l2dock:'min',min:true},origin:f.origin}]);same(f.mismatches,[]);
});

test('запоздалый пульс удалённого iframe игнорируется до пульса нового',()=>{
 const f=fixture();ready(f);const old=f.replace();f.tick(1);f.event({source:old.contentWindow});same(f.posts,[]);
 f.api.setMin(true);same(f.posts,[],'старый пульс не разрешил сообщение ещё не загруженному новому окну');
 f.heartbeat();assert.equal(f.posts.length,1);assert.equal(f.posts[0].id,f.frame().id);same(f.mismatches,[]);
});

for(const from of ['chrome-extension://other-extension','moz-extension://other-extension','https://l2wap.com','null',''])test('пульс с чужим origin не разрешает отправку: '+from,()=>{
 const f=fixture(),foreign=[];f.api.setMin(false);f.clear();
 // Пульс другого расширения приходит от другого окна; прежнюю политику origin текущего iframe не меняем.
 const source=/^(chrome|moz)-extension:\/\//.test(from)?{postMessage:(...args)=>foreign.push(args)}:f.frame().contentWindow;
 f.event({from,source});same(f.posts,[]);same(foreign,[]);
 f.api.post();same(f.posts,[],'чужой origin не создал готовность');
});

test('другое окно с правильным origin расширения не получает состояние дока',()=>{
 const f=fixture(),foreign=[];f.api.setMin(false);f.clear();f.event({source:{postMessage:(...args)=>foreign.push(args)}});
 same(f.posts,[]);same(foreign,[]);f.api.post();same(f.posts,[]);
});

test('нет iframe: старый пульс и отправка состояния ничего не делают',()=>{
 const f=fixture();ready(f);const old=f.frame();f.remove();f.event({source:old.contentWindow});f.api.setMin(true);f.api.post();same(f.posts,[]);
});

test('выключенный док с очищенной свёрнутостью не получает сообщение',()=>{
 const f=fixture();ready(f);f.c.cfg.dock=false;f.api.setMin(null);f.remove();f.event();f.api.post();same(f.posts,[]);
});

test('пульс без известной свёрнутости не создаёт сообщение с null',()=>{
 const f=fixture();f.heartbeat();same(f.posts,[]);f.api.setMin(false);
 same(f.posts,[{id:f.frame().id,data:{__l2dock:'min',min:false},origin:f.origin}]);same(f.mismatches,[]);
});

test('сообщение другой формы не считается пульсом готовности',()=>{
 const f=fixture();f.api.setMin(false);f.clear();f.event({kind:'min'});f.event({data:{__l2dock:'hb-other'}});f.api.post();same(f.posts,[]);
});

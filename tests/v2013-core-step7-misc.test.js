'use strict';
// 20.13 (ревизия 17.10, шаг 7, участок core): автовход (core-a/M7), миграции once() без прямых записей (core-b/F10),
// alert() игры при выключенном боте (core-b/F11), приватность сетевого журнала (core-b/F12), предел объёма снимков (core-b/F13).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'),core=read('content.js'),bg=read('background.js'),hook=read('hook.js');
const slice=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i,a);return s.slice(i,j);};

// --- M7: автовход
function loginBox(opt={}){
 const calls={click:0,idle:[],alert:0,recs:[]},errEl={textContent:opt.err||'Неверный логин или пароль',hidden:false},pw={focus(){},closest:()=>form,isConnected:true},
  btn={textContent:'Войти'},form={querySelectorAll:s=>s.startsWith('button')?[btn]:[]};
 let pwReads=0;const auth={login:'fixture',pass:'synthetic',t:opt.authT||0};
 const box={rt:{},auth,automationSnapshot:()=>1,automationCurrent:()=>true,Date,
  document:{querySelectorAll:s=>s.includes('#login-msg')?[]:s.includes('password')?(opt.pwGone&&++pwReads>1?[]:[pw]):s.includes('[class*="error"]')?[errEl]:[]},
  shown:e=>!!e&&!e.hidden,halt:async()=>{},chrome:{storage:{local:{get:async()=>({auth:box.auth})}}},idle:async(ms,label)=>{calls.idle.push(label)},
  setRt:async p=>{Object.assign(box.rt,p);return {ok:true}},setStatus(){},rec:(...a)=>calls.recs.push(a.join(' ')),setVal(){},sleep:async()=>{},rnd:()=>0,
  fire:()=>{calls.click++},waitFor:async()=>false,loginPage:()=>true,$q:()=>null,location:{pathname:'/'},Node:{DOCUMENT_POSITION_FOLLOWING:4},
  abHold:()=>false,L2V7Modules:{},sendAlert:()=>{calls.alert++},fishNow:()=>false};
 vm.createContext(box);vm.runInContext(slice(core,'function accountLoginBlocked()','// ---------- сервер игры недоступен'),box);
 return {box,calls};
}
test('M7: поле пароля исчезло после записи попытки — без TypeError и без клика',async()=>{
 const {box,calls}=loginBox({pwGone:true});await box.autoLogin();assert.equal(calls.click,0);
});
test('M7: 3 раза «неверный пароль» подряд — автовход встаёт с уведомлением; новый пароль снимает паузу',async()=>{
 const {box,calls}=loginBox();
 for(let i=0;i<3;i++){box.rt.loginTries=[];await box.autoLogin();}
 assert.equal(calls.click,3);assert.ok(box.rt.loginOff?.t>0);assert.equal(calls.alert,1);assert.equal(box.rt.loginBad,0);
 box.rt.loginTries=[];await box.autoLogin();
 assert.equal(calls.click,3,'четвёртой попытки нет');assert.match(calls.idle.at(-1),/Автовход приостановлен/);
 box.auth={...box.auth,t:Date.now()};box.rt.loginTries=[];await box.autoLogin();
 assert.equal(calls.click,4,'сохранили новый пароль в меню — автовход снова пробует');
});
test('M7: прочие ошибки входа (сеть) не считаются неверным паролем',async()=>{
 const {box,calls}=loginBox({err:'Сервер не отвечает'});
 for(let i=0;i<5;i++){box.rt.loginTries=[];await box.autoLogin();}
 assert.equal(calls.click,5);assert.equal(box.rt.loginOff,undefined);assert.equal(calls.alert,0);
});
test('M7: удачный вход обнуляет счёт и паузу',()=>{
 assert.match(core,/await setRt\(\{ loginTries: \[\], loginBad: 0, loginOff: null \}\);/);
 assert.match(read('popup.js'),/auth: \{ login, pass: pass \|\| auth\.pass \|\| '', t: Date\.now\(\) \}/);
});

// --- F10: once() пишет только в rf/cf
test('F10: в теле разовых миграций нет прямых setRt/setCfg',()=>{
 const body=slice(core,'  const once = (flag, fn) =>','  if (Object.keys(cf).length) {');
 assert.doesNotMatch(body,/\bsetRt\(|\bsetCfg\(/);
 assert.match(body,/rf\.buffCancel = C;/);assert.match(body,/if \(n\) rf\.logAlias = A;/);
});

// --- F11: alert() глушится только при включённом боте
function alertBox(onAttr,sess={}){
 const shown=[],posted=[];
 const win={alert:m=>shown.push(m),postMessage:m=>posted.push(m)};
 const box={window:win,location:{pathname:'/catacombs.html',origin:'https://l2wap.invalid'},console:{warn(){}},String,document:{documentElement:{dataset:onAttr?{l2botOn:'1'}:{}}},
  sessionStorage:{getItem:k=>k in sess?sess[k]:null}};
 vm.createContext(box);vm.runInContext(slice(hook,"  if (/^\\/(?:catacombs|dungeon","  // 9.2.5: если кузнец"),box);
 win.alert('Недостатньо адени');return {shown,posted};
}
test('F11: бот включён — окно игры уходит в журнал; выключен — игрок видит окно',()=>{
 const a=alertBox(true);assert.equal(a.shown.length,0);assert.equal(a.posted[0].__l2bot,'alert');
 const b=alertBox(false);assert.deepEqual(b.shown,['Недостатньо адени']);assert.equal(b.posted.length,0);
 // ревью шага 7: страница ещё грузится (content.js не запущен, метки на <html> нет), но бот был включён на прошлой странице — окно глушим
 const e=alertBox(false,{'l2bot.on':'1'});assert.equal(e.shown.length,0);assert.equal(e.posted[0].__l2bot,'alert');
 // content держит метку по флагу on — на <html> и в sessionStorage; до чтения on из хранилища метку не трогает
 const ss={};const c={on:false,document:{documentElement:{dataset:{}}},setInterval(){},
  sessionStorage:{getItem:k=>k in ss?ss[k]:null,setItem:(k,v)=>{ss[k]=String(v)},removeItem:k=>{delete ss[k]}}};vm.createContext(c);
 vm.runInContext(slice(core,'let onMarkReady = false;','setInterval(onMark, 500);').replace('let onMarkReady','var onMarkReady'),c);
 ss['l2bot.on']='1';c.onMark();assert.equal(ss['l2bot.on'],'1','on ещё не прочитан — прошлую метку не снимаем');
 c.onMarkReady=true;c.on=true;
 c.onMark();assert.equal(c.document.documentElement.dataset.l2botOn,'1');assert.equal(ss['l2bot.on'],'1');
 c.on=false;c.onMark();assert.equal('l2botOn' in c.document.documentElement.dataset,false);assert.equal('l2bot.on' in ss,false);
 assert.match(core,/on = !!s\.on;\n  onMarkReady = true; onMark\(\);/);
 assert.match(core,/setInterval\(onMark, 500\);/);
});

// --- F12: приватные запросы в сетевом журнале — без тела запроса/ответа
test('F12: почта/чат/сообщения/поддержка/полученные передачи — приватны; бой, карта, claim — нет',()=>{
 const c={String};vm.createContext(c);vm.runInContext(slice(core,'const PRIVATE_NET','const fmtS = ')+';this.P=privateNet;',c);
 for(const p of ['/game/mail/sent','/game/mail/inbox?page=2','/game/chat/messages','/game/messages','/support/tickets','/game/item-transfer/received'])assert.equal(c.P(p),true,p);
 for(const p of ['/game/battle/action','/game/map/spawns','/game/item-transfer/claim','/game/item-transfer/send','/character','/game/dailies','/game/forum/drop'])assert.equal(c.P(p),false,p);
 const netRec=slice(core,'const priv = privateNet(path);',"// сообщения игры: тосты");
 assert.match(netRec,/data: priv \? \{ q: '\(приватно\)' \} :/);assert.match(netRec,/!secret && !priv \?/);
});

// --- F13: предел объёма снимков страниц
function fakeIdb(rows){
 const later=f=>setImmediate(f);
 function makeTx(){
  const tx={pending:0,oncomplete:null,check(){if(tx.pending===0)later(()=>{if(tx.pending===0&&tx.oncomplete&&!tx.done){tx.done=true;tx.oncomplete();}});}};
  const req=fn=>{const r={};Object.defineProperty(r,'onsuccess',{set(cb){tx.pending++;later(()=>{r.result=fn();cb({target:r});tx.pending--;tx.check();});}});return r;};
  const cursorReq=list=>{const r={};let i=0,cb=null;const step=()=>{tx.pending++;later(()=>{const v=list[i];r.result=v?{value:v,delete(){rows.delete(v.key)},continue(){i++;step();}}:null;cb({target:r});tx.pending--;tx.check();});};
   Object.defineProperty(r,'onsuccess',{set(f){cb=f;step();}});return r;};
  const st={count:()=>req(()=>rows.size),getKey:k=>req(()=>rows.has(k)?k:undefined),put:v=>{rows.set(v.key,v)},
   openCursor:()=>cursorReq([...rows.values()]),index:()=>({openCursor:()=>cursorReq([...rows.values()].sort((a,b)=>a.t-b.t))})};
  tx.objectStore=()=>st;return tx;
 }
 return {transaction:()=>makeTx()};
}
async function snapBox(rows,store={}){
 const sets=[];let now=1e12;
 const c={Date:{now:()=>++now},String,Number,Math,Promise,console:{warn(){}},setImmediate,writing:Promise.resolve(),MAX_SNAPS:1000,
  chrome:{storage:{local:{get:async k=>({[k]:store[k]}),set:async v=>{sets.push(v);Object.assign(store,v)}},onChanged:{addListener(){}}}}};
 const db=fakeIdb(rows);c.idb=async()=>db;c.txDone=tx=>new Promise(res=>{tx.oncomplete=res;tx.check();});
 vm.createContext(c);vm.runInContext('let writing=Promise.resolve();'+slice(bg,'const MAX_SNAP_BYTES','// скриншот экрана для автообучения')+';this.add=addSnap;this.flush=()=>writing;',c);
 return {c,sets,store};
}
test('F13: больше 50 МБ разметки — удаляются самые старые снимки; сумма считается один раз и хранится',async()=>{
 const MB=1024*1024,rows=new Map();
 for(let i=0;i<9;i++)rows.set('old'+i,{key:'old'+i,t:i+1,html:'x'.repeat(6*MB)});   // 54 МБ снимков старых версий, суммы в storage нет
 const b=await snapBox(rows);
 b.c.add({key:'new1',state:'s',html:'y'.repeat(2*MB)});await b.c.flush();
 assert.ok(rows.has('new1'));assert.ok(!rows.has('old0'),'самый старый удалён');assert.ok(rows.has('old1'),'лишнего не удаляем: ровно 50 МБ — в пределе');
 const total=[...rows.values()].reduce((a,r)=>a+r.html.length,0);assert.ok(total<=50*MB);
 assert.equal(b.store.snapbytes,total);assert.equal(b.store.snapcount,rows.size);
 b.c.add({key:'new1',state:'s',html:'y'});await b.c.flush();assert.equal(b.sets.length,1,'повтор того же ключа ничего не пишет');
});
test('F13: по числу (1000) — как раньше, удаляется один самый старый',async()=>{
 const rows=new Map();for(let i=0;i<1000;i++)rows.set('k'+i,{key:'k'+i,t:i+1,html:'z'});
 const b=await snapBox(rows,{snapbytes:1000});b.c.add({key:'n',state:'',html:'q'});await b.c.flush();
 assert.equal(rows.size,1000);assert.ok(!rows.has('k0')&&rows.has('n'));assert.equal(b.store.snapbytes,1000);
 assert.match(read('popup.js'),/snapcount: 0, snapbytes: 0,/);assert.match(read('popup.js'),/'snapcount', 'snapbytes'/);
 assert.match(bg,/до 20 000 событий/);assert.doesNotMatch(bg,/100 000 событий/);
});

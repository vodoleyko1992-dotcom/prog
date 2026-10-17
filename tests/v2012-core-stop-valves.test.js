'use strict';
// 20.12 (ревизия 17.10, аудит core-a/C1, core-a/C2, core-a/H2, core-b/F2, farm/Q-4): «клапаны» главного цикла.
// 1) сервер/вход/антибот раньше лимитов и PvP-восстановления; 2) отказ синхронизации лимитов не держит цикл вечно;
// 3) устаревший ключ limitRanges отбрасывается фоном; 4) вход не блокируется неизвестной оплатой/PvP; 5) пульс сторожа — от живости main().
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(base,p),'utf8'),core=read('content.js'),bg=read('background.js');
const slice=(src,a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i,'нет фрагмента '+a);return src.slice(i,j);};

// --- главный цикл: стенд из v1016-enchant-mode-core (настоящий main() из content.js)
const enchantCore=read('tests/v1016-enchant-mode-core.test.js');
const fixBox={require,console,URL,Date,Promise,Math,vm,assert,core};
vm.runInNewContext(slice(enchantCore,'function coreFixture(){',"test('выбранная заточка")+';this.mainFixture=mainFixture;',fixBox);
function loop(opt={}){
 const c=fixBox.mainFixture({recovery:true}),calls=c.calls,stop=name=>async()=>{calls.push(name);c.on=false;return true};
 c.cfg.enchantMode=false;   // обычный режим
 Object.assign(c,{serverDown:()=>!!opt.down,serverWait:stop('serverWait'),serverBack:async()=>{},loginPage:()=>!!opt.login,autoLogin:stop('autoLogin'),
  antibotGuard:stop('antibotGuard'),syncLimitRanges:async()=>{calls.push('sync');return false},
  limitSyncDue:()=>true,limitSyncBlock:ok=>!ok});
 if(opt.ab)c.ab='check';if(opt.ranges)c.cfg.limitRanges={dailyKillLimit:{min:1,max:2}};
 return c;
}
for(const [name,opt,want] of [['страница входа',{login:true},'autoLogin'],['сервер лежит',{down:true},'serverWait'],['проверка активности',{ab:true},'antibotGuard']])
 test(`${name} при висящем PvP-восстановлении и неудачной синхронизации лимитов: сначала ${want}`,async()=>{
  const c=loop({...opt,ranges:true});await vm.runInContext('main()',c);
  assert.ok(c.calls.includes(want),JSON.stringify(c.calls));
  assert.ok(!c.calls.includes('recovery'),'PvP-восстановление не раньше входа/сервера/антибота');
  assert.ok(!c.calls.includes('sync'),'лимиты не раньше входа/сервера/антибота');
 });
test('обычная страница: PvP-восстановление по-прежнему раньше задач',async()=>{const c=loop();await vm.runInContext('main()',c);assert.ok(c.calls.includes('recovery'),JSON.stringify(c.calls));});

// --- отказ синхронизации лимитов: 30 с ждём, потом один раз в журнал и дальше
test('limitSyncBlock: ждёт 30 с, затем пропускает цикл и пишет причину один раз',()=>{
 const recs=[],c={rec:(...a)=>recs.push(a.join(' ')),Date,Math};vm.createContext(c);
 vm.runInContext(slice(core,'const limitSync = {','// ---------- персонаж')+';this.B=limitSyncBlock;this.D=limitSyncDue;',c);
 const t0=1e9;
 assert.equal(c.B(false,t0),true);assert.equal(c.B(false,t0+10000),true);
 assert.equal(c.B(false,t0+31000),false);assert.equal(recs.length,1);assert.match(recs[0],/не синхронизируются/);
 assert.equal(c.D(t0+32000),false,'повтор синхронизации — не каждый круг');assert.equal(c.D(t0+62000),true);
 assert.equal(c.B(false,t0+62000),false);assert.equal(recs.length,1,'причина — один раз');
 assert.equal(c.B(true,t0+70000),false);assert.equal(c.D(t0+70001),true);
});

// --- фон: устаревший ключ диапазона (импорт ≤20.9) не даёт вечный ok:false
test('limitRangeChange отбрасывает неизвестный/неверный диапазон и обрабатывает остальные',()=>{
 const c={Date,Math,Number,Object,JSON};vm.createContext(c);
 vm.runInContext(slice(bg,'const FARM_QUOTA =','function dailyFishChange(')+';this.L=limitRangeChange;',c);
 const r=c.L({cfg:{limitRanges:{dailyAutoKillLimit:{min:5,max:9},fishMaxCasts:{min:0,max:3},dailyKillLimit:{min:10,max:12}}},rt:{limitRolls:{dailyAutoKillLimit:{value:7}}}},Date.now());
 assert.equal(r.ok,true,r.reason);
 assert.deepEqual(JSON.parse(JSON.stringify(r.dropped)).sort(),['dailyAutoKillLimit','fishMaxCasts']);
 assert.deepEqual(Object.keys(r.cfg.limitRanges),['dailyKillLimit']);
 assert.ok(r.cfg.dailyKillLimit>=10&&r.cfg.dailyKillLimit<=12);
 assert.equal(r.rt.limitRolls.dailyAutoKillLimit,undefined);
});

// --- вход: fire() пропускает кнопку входа при неизвестной оплате и PvP-pending
function fireBox(){
 const pwInput={type:'password'},form={querySelector:s=>s==='input[type="password"]'?pwInput:null};
 const mk=(text,tag='button')=>({textContent:text,value:'',events:[],closest:s=>s==='form'?form:null,matches:s=>s.split(',').map(x=>x.trim()).includes(tag),
  scrollIntoView(){},getBoundingClientRect:()=>({left:0,top:0,width:10,height:10}),dispatchEvent(e){this.events.push(e.type)}});
 class Ev{constructor(type){this.type=type}}
 const c={on:true,tabOwner:true,running:true,invBusy:false,rt:{},window:{},location:{pathname:'/'},PointerEvent:Ev,MouseEvent:Ev,
  L2V7Modules:{payments:{blocked:()=>true,consumePermit:()=>false},pvp:{pending:()=>true},actions:{canAct:()=>true}},
  isBattle:()=>false,isMap:()=>false,isFishing:()=>false,$q:()=>null,abHold:()=>false,loginPage:()=>true};
 vm.createContext(c);
 vm.runInContext(slice(core,'const PAY_FREE_MAP =','// Single-writer settings update.')+';this.fire=fire;',c); // 20.12: fire() после слияния с шагом 2 вызывает paymentFreeClick — берём вместе с ним
 return {c,mk};
}
test('кнопка «Войти» нажимается при неизвестной оплате и PvP-pending',()=>{
 const {c,mk}=fireBox(),btn=mk('Увійти');
 assert.equal(c.fire(btn),true);assert.ok(btn.events.includes('click'));
});
test('прочие кнопки при неизвестной оплате по-прежнему заблокированы',()=>{
 const {c,mk}=fireBox();assert.equal(c.fire(mk('Купити')),false);
 c.loginPage=()=>false;assert.equal(c.fire(mk('Увійти')),false,'не страница входа — защита оплаты прежняя');
});

// --- autoLogin: fire отказал → requestSubmit и причина в журнале (без пароля)
test('autoLogin при отказе fire отправляет форму напрямую и пишет причину',async()=>{
 const recs=[];let submitted=0;
 const form={requestSubmit(){submitted++},querySelectorAll:s=>/button/.test(s)?[btn]:[]};
 const pw={type:'password',isConnected:true,form,closest:()=>form,focus(){}};
 const btn={textContent:'Увійти',value:''};
 const c={rt:{},on:true,L2V7Modules:{payments:{blocked:()=>true},pvp:{pending:()=>false}},Node:{DOCUMENT_POSITION_FOLLOWING:4},
  automationSnapshot:()=>1,automationCurrent:()=>true,accountLoginBlocked:()=>false,stopBlockedLogin:()=>{},
  chrome:{storage:{local:{get:async()=>({auth:{login:'hero',pass:'SECRETPW'}})}}},idle:async()=>{},setRt:async p=>Object.assign(c.rt,p),
  document:{querySelectorAll:s=>s==='input[type="password"]'?[pw]:[]},shown:()=>true,setStatus:()=>{},rec:(...a)=>recs.push(a.join(' ')),
  setVal:()=>{},abHold:()=>false,sleep:async()=>{},rnd:a=>a,fire:()=>false,waitFor:async()=>null,loginPage:()=>true,$q:()=>null,fishNow:()=>false,location:{pathname:'/'}};
 vm.createContext(c);vm.runInContext(slice(core,'async function autoLogin()','// ---------- сервер игры недоступен')+';this.autoLogin=autoLogin;',c);
 await c.autoLogin();
 assert.equal(submitted,1,'форма отправлена через requestSubmit');
 assert.ok(recs.some(r=>/неподтверждённая оплата/.test(r)),JSON.stringify(recs));
 assert.ok(!recs.some(r=>r.includes('SECRETPW')),'пароль не в журнале');
});

// --- пульс сторожа: только пока main() жив
test('пульс таймера прекращается, если цикл не крутится дольше 2 мин, и возвращается со sleep()',()=>{
 let now=1e9,hb=0,tick=null;
 const c={on:true,tabOwner:true,running:true,heartbeat:()=>hb++,setInterval:fn=>{tick=fn},document:{visibilityState:'visible'},setTimeout:()=>{},bgSleep:()=>{},Date:{now:()=>now},Promise};
 vm.createContext(c);
 vm.runInContext(slice(core,'let loopT = Date.now();','const rnd = (a, b)')+';this.sleep=sleep;',c);
 tick();assert.equal(hb,1);
 now+=130000;tick();assert.equal(hb,1,'main() завис — пульса нет, фон перезагрузит вкладку');
 c.heartbeat=()=>{};c.sleep(10);c.heartbeat=()=>hb++;tick();assert.equal(hb,2,'цикл ожил (sleep) — пульс снова идёт');
});
test('главный цикл обновляет loopT на каждом круге',()=>{
 const m=slice(core,'async function main() {','// Магистр: актуальный');
 assert.match(m,/while \(on\) \{\s*loopT = Date\.now\(\);/);
});

// --- ревью шага 1: устаревший кадр действий + сервер лежит/страница входа — цикл не крутится на микрозадачах
function staleLoop(kind,refresh){
 const c=loop({[kind]:true}),calls=c.calls;let gen=2,frame=1,checks=0;
 c.L2V7Modules.actions={enterFrame:()=>{calls.push('enterFrame');if(refresh)frame=gen},canAct:()=>frame===gen};
 // как настоящие serverWait/autoLogin: при устаревшем кадре выходят сразу, без await
 const early=name=>async()=>{if(!c.L2V7Modules.actions.canAct())return;calls.push(name);c.on=false};
 c.serverWait=early('serverWait');c.autoLogin=early('autoLogin');
 const chk=()=>{if(++checks>50){calls.push('spin');c.on=false}return true};
 if(kind==='down')c.serverDown=chk;else c.loginPage=chk;
 c.sleep=async()=>{calls.push('sleep');c.on=false};
 return c;
}
for(const [kind,want] of [['down','serverWait'],['login','autoLogin']]){
 test(`${want}: устаревший кадр (поколение++) обновляется до ранней ветки`,async()=>{
  const c=staleLoop(kind,true);await vm.runInContext('main()',c);
  assert.ok(!c.calls.includes('spin'),'цикл крутился без паузы: '+JSON.stringify(c.calls));
  assert.ok(c.calls.indexOf('enterFrame')>=0&&c.calls.indexOf('enterFrame')<c.calls.indexOf(want),JSON.stringify(c.calls));
 });
 test(`${want}: даже если кадр не освежился, после ранней ветки настоящая пауза`,async()=>{
  const c=staleLoop(kind,false);await vm.runInContext('main()',c);
  assert.ok(!c.calls.includes('spin'),'цикл крутился без паузы: '+JSON.stringify(c.calls));
  assert.ok(c.calls.includes('sleep'),JSON.stringify(c.calls));
 });
}

'use strict';
// 20.41 (ревью 2): ↺ сессии / сброс лута / памяти боя из меню не откатывается пакетом статистики вкладки, который уже был
// в полёте (отложенная статистика до 8 с, пакет в очереди фона за записью меню). Вкладка снимает такие ключи и из пакета в
// полёте (drop), фон отсекает их по menuRev. Намерения/оплаты/маршруты — как раньше, последней записью вкладки.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=require('../engine-core.js'),read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r))};
function background(storage){
 const src=read('background.js'),cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);if(i<0||j<i)throw Error(a);return src.slice(i,j)};
 const hold=[],ctx={console,Date,URL,Number,JSON,Object,Math,Promise,Set,Array,String,L2EngineCore:core,MAX_PATCH_KEYS:400,LOCK_TTL:90000,lockQueue:Promise.resolve(),
  chrome:{runtime:{getURL:p=>'chrome-extension://x/'+p},storage:{local:{get:async keys=>{const r={};for(const k of keys)r[k]=clone(storage[k]??null);return r},
   set:async p=>{if(hold.length)await hold.shift();Object.assign(storage,clone(p))}}}}};
 vm.createContext(ctx);vm.runInContext(cut('function serializeLock(fn)','async function lockCommand(')+cut('function mergeTimerPatch(','// Реворк ядра'),ctx);
 const tab={frameId:0,url:'https://l2wap.com/battle.html',tab:{id:1}},menu={url:'chrome-extension://x/popup.html'};
 return {ctx,hold,state:(patch,extra={})=>ctx.statePatch({patch,epoch:'e1',src:'tab-1',expectedChar:'Hero',...extra},tab),menu:(rtPatch,extra={})=>ctx.menuPatch({rtPatch,...extra},menu)};
}
const store=()=>({on:true,lock:{k:'tab1',epoch:'e1',t:Date.now()},cfg:{},rt:{char:'Hero',kills:500,exp:9000,adena:7,rbGo:null}});
test('очередь: drop снимает ключи и из пакета в полёте — peek их не возвращает, неудачная отправка не вернёт их в очередь',async()=>{
 let release;const sent=[],q=core.createPatchQueue(b=>{sent.push(clone(b));return new Promise(r=>release=r)},()=>true,()=>{},()=>Date.now(),{set:()=>0,clear(){}});
 q.defer({kills:500,exp:9000});q.enqueue({mobClickAt:1});await flush();
 assert.deepEqual(sent,[{kills:500,exp:9000,mobClickAt:1}],'пакет уже ушёл');
 q.drop(['kills','exp']);assert.deepEqual(q.peek(),{mobClickAt:1});
 release({ok:false,reason:'x'});await flush();assert.deepEqual(q.peek(),{mobClickAt:1},'после неудачи статистика не вернулась');
});
test('фон: пакет со старым menuRev не пишет сброшенную меню статистику, прочие ключи пишет',async()=>{
 const S=store(),B=background(S);
 assert.equal((await B.menu({kills:0,exp:0,adena:0,sessT0:5})).ok,true);
 assert.equal(S.rt.menuRev,1);assert.deepEqual(S.rt.menuKeyRev,{kills:1,adena:1,exp:1});
 assert.equal((await B.state({kills:501,exp:9100,adena:8,rbGo:{step:'pay'},mobClickAt:2},{menuRev:0})).ok,true);
 assert.equal(S.rt.kills,0);assert.equal(S.rt.exp,0);assert.equal(S.rt.adena,0);assert.deepEqual(S.rt.rbGo,{step:'pay'},'намерение пишется как раньше');assert.equal(S.rt.mobClickAt,2);
 await B.state({kills:1,exp:12},{menuRev:1});assert.equal(S.rt.kills,1,'вкладка увидела сброс — пишет');assert.equal(S.rt.exp,12);
});
test('фон: без menuRev (старое сообщение) — прежняя запись; свои метки меню вкладка не перезаписывает',async()=>{
 const S=store(),B=background(S);await B.menu({lootStat:{}});
 await B.state({lootStat:{x:1},menuRev:0,menuKeyRev:{}});assert.deepEqual(S.rt.lootStat,{x:1});assert.equal(S.rt.menuRev,1);assert.deepEqual(S.rt.menuKeyRev,{lootStat:1});
});
test('меню: метка у статистики из команды меню; команды без статистики её не получают',async()=>{
 const S=store(),B=background(S);
 await B.menu({rbGo:null,fishTgt:null,manualKickAt:3});assert.equal(S.rt.menuRev,undefined,'команды меню без статистики — без метки');
 await B.menu({exp:0});assert.equal(S.rt.menuRev,1);assert.deepEqual(S.rt.menuKeyRev,{exp:1},'только ключи команды');
 await B.menu({fightMem:{},fightLast:null,fightGroups:{},packLab:null});assert.equal(S.rt.menuRev,2);assert.deepEqual(S.rt.menuKeyRev,{exp:1,fightMem:2,fightLast:2,fightGroups:2,packLab:2});
});
test('гонка целиком: ↺ в очереди фона, пакет вкладки ушёл до того, как вкладка увидела сброс',async()=>{
 const S=store(),B=background(S);let tabRt=clone(S.rt);
 const q=core.createPatchQueue(p=>B.state(p,{menuRev:+tabRt.menuRev||0}),()=>true,()=>{},()=>Date.now(),{set:()=>0,clear(){}});
 let release;B.hold.push(new Promise(r=>release=r));
 const reset=B.menu({kills:0,exp:0,sessT0:9});await flush();            // запись меню держит serializeLock
 q.defer({kills:501,exp:9100});const w=q.enqueue({mobClickAt:4});await flush();   // пакет вкладки встал в очередь за меню
 release();await reset;
 // onChanged меню во вкладке: снимаем статистику из очереди и пакета в полёте, память — свежая + наш остаток
 const keys=Object.keys(q.peek()).filter(k=>core.MENU_STAT_KEYS.includes(k));q.drop(keys);tabRt={...S.rt,...q.peek()};
 await w;assert.equal(S.rt.kills,0);assert.equal(S.rt.exp,0);assert.equal(S.rt.mobClickAt,4);assert.equal(tabRt.kills,0);assert.equal(tabRt.sessT0,9);
});
test('content: menuRev в каждой записи вкладки и в pagehide; сброс меню снимает только статистику (rbTimer и намерения — нет)',()=>{
 const src=read('content.js');
 assert.match(src,/patch => ipc\(\{ cmd: 'statePatch', patch, src: TAB_ID, epoch: leaseEpoch, expectedChar: rt\.char \|\| '', menuRev: \+rt\.menuRev \|\| 0 \}\)/);
 const a=src.indexOf("addEventListener('pagehide', () => {\n"),ph=src.slice(a,src.indexOf('});',a));assert.match(ph,/menuRev: \+rt\.menuRev \|\| 0/);
 const b=src.indexOf('chrome.storage.onChanged.addListener(ch => {'),part=src.slice(b,src.indexOf('const timerPrevious = rt;',b));
 assert.match(part,/stat = globalThis\.L2EngineCore\?\.MENU_STAT_KEYS \|\| \[\]/);assert.match(part,/keys = swap \? \[\] : Object\.keys\(q\)\.filter\(k => stat\.includes\(k\) && \(rev\(k\) \|\| JSON\.stringify/);assert.ok(!core.MENU_STAT_KEYS.includes('rbTimer'));
 for(const k of ['rbGo','actionPayments','actionOwner','fishCastPending','buffAt','farmQuota','dailyQuota'])assert.ok(!core.MENU_STAT_KEYS.includes(k),k);
});
test('↺ сессии и сбросы лута/памяти боя в меню целиком попадают под защиту (кроме намерений покупки баффов)',()=>{
 const pop=read('popup.js'),keys=s=>[...s.matchAll(/(\w+):/g)].map(m=>m[1]);
 const line=re=>keys(pop.match(re)[0]),sess=line(/menuPatch\(\{ kills: 0,[^\n]*/),loot=line(/menuPatch\(\{ lootStat: \{\}[^\n]*/),mem=line(/menuPatch\(\{ fightMem: \{\}[^\n]*/);
 for(const k of [...loot,...mem])assert.ok(core.MENU_STAT_KEYS.includes(k),k);
 for(const k of ['kills','exp','sp','adena','rbKills','loot','lootSpecial','lootValue'])assert.ok(sess.includes(k)&&core.MENU_STAT_KEYS.includes(k),k);
});
// Только pagehide/pageshow: переход, ждущий ответа сервера (beforeunload уже был), запись при уходе вкладки в фон не выключает.
test('уход со страницы пишет остаток один раз: скрытие документа при уходе не повторяет запись pagehide',()=>{
 const src=read('content.js');
 assert.match(src,/addEventListener\('visibilitychange', \(\) => \{ if \(document\.hidden && !pageGone && tabOwner && leaseEpoch && !tabIdle\) rtWriter\.recover\(\)/);
 assert.match(src,/let pageGone = false;[^\n]*\naddEventListener\('pageshow', \(\) => \{ pageGone = false; \}\);\naddEventListener\('pagehide', \(\) => \{ pageGone = true; \}\);/);
 const fired=[],box={document:{hidden:false},addEventListener:(t,f)=>fired.push([t,f])},a=src.indexOf('let pageGone = false;'),b=src.indexOf('function setRt(p) {');
 let recovers=0;Object.assign(box,{tabOwner:true,leaseEpoch:'e',tabIdle:false,rtWriter:{peek:()=>({}),recover:()=>{recovers++;return Promise.resolve()}},L2V7Modules:{},quietErr(){},chrome:{runtime:{sendMessage(){}}},rt:{}});
 box.document.addEventListener=(t,f)=>fired.push(['doc:'+t,f]);vm.runInNewContext(src.slice(a,b),box);
 const on=t=>fired.filter(x=>x[0]===t).forEach(x=>x[1]({}));
 box.document.hidden=true;on('doc:visibilitychange');assert.equal(recovers,1,'уход в фон — запись');
 on('pagehide');on('doc:visibilitychange');assert.equal(recovers,1,'выгрузка — без второй записи');
 on('pageshow');on('doc:visibilitychange');assert.equal(recovers,2,'после bfcache снова пишет');
});
// 20.41 (ревью 2, проверка исправлений): повторный ↺ тех же нулей, смена класса в полёте, кэш памяти боя модуля.
test('повторный ↺ при нулях в хранилище — тоже сброс: старая отложенная статистика не пишется',async()=>{
 const S=store(),B=background(S);await B.menu({kills:0,exp:0});assert.equal(S.rt.menuRev,1);
 await B.menu({kills:0,exp:0});assert.equal(S.rt.menuRev,2,'метка ставится и без изменения значения');
 await B.state({kills:2,exp:40},{menuRev:1});assert.equal(S.rt.kills,0);assert.equal(S.rt.exp,0);
 const src=read('content.js');assert.match(src,/rev = k => \+\(n\.menuKeyRev\?\.\[k\] \|\| 0\) !== \+\(o\.menuKeyRev\?\.\[k\] \|\| 0\)/);
});
test('смена класса со старым menuRev: память боя нового класса из classStash не отсекается',async()=>{
 const S=store();S.rt.classCur={prof:'human_warlock',slot:0};const B=background(S);await B.menu({fightMem:{},fightLast:null,fightGroups:{},packLab:null});
 await B.state({fightMem:{'m:x':{n:5}},packLab:{v:1},classCur:{prof:'bishop',slot:1,t:2},classStash:{}},{menuRev:0});
 assert.deepEqual(S.rt.fightMem,{'m:x':{n:5}});assert.deepEqual(S.rt.packLab,{v:1});assert.equal(S.rt.classCur.prof,'bishop');
 await B.state({fightMem:{'m:y':{n:1}},classCur:{prof:'bishop',slot:1,t:3}},{menuRev:0});assert.deepEqual(S.rt.fightMem,{'m:x':{n:5}},'тот же класс — обычная защита');
});
test('сброс памяти боя из меню сбрасывает и неписаный кэш модуля боя (rebase не возвращает старую память)',async()=>{
 const hook=read('hook.js'),btOf=vm.runInNewContext(hook.slice(hook.indexOf('  const btOf = '),hook.indexOf('  const pvOf ='))+';btOf');
 const seq=require('./fixtures/olkuth-battle-sequence.json'),spawn=seq[0].data.battle.spawnId;
 const make=()=>{let now=100000,rid=0,fail=true;const rt={char:'Hero',classCur:{prof:'warlock',slot:0}},writes=[];
  const env={rt,cfg:{},routeLocation:{search:'?spawnId='+spawn},mobTitle:()=>'Last Lesser Giant Olkuth',actName:x=>x,rec(){},
   setRt:p=>{if(!('fightMem' in p))return Promise.resolve({ok:true});writes.push(p);if(fail){fail=false;return Promise.resolve({ok:false,reason:'ownership_lost'})}Object.assign(rt,p);return Promise.resolve({ok:true})}};
  const box={Date:{now:()=>now},URLSearchParams};vm.runInNewContext(read('modules/fightlab.js'),box);const L=box.L2V7Factories.fightlab(env);
  return {rt,L,writes,run:async()=>{for(const e of seq){now=100000+e.at;L.onNet(e.path,{status:200,rid:++rid,req:{action:'test-action'},res:e.data,bt:btOf({pathname:e.path},e.data)})}await flush()}}};
 const a=make();await a.run();const n=a.writes.length;assert.ok(n>=1);
 a.rt.fightMem={};a.rt.menuKeyRev={fightMem:1};a.L.flush();await flush();
 assert.equal(a.writes.length,n,'после сброса старая память не дописывается');assert.deepEqual(a.rt.fightMem,{});
 const b=make();await b.run();const m=b.writes.length;b.rt.fightMem={};b.L.flush();await flush();
 assert.equal(b.writes.length,m+1,'без метки сброса — прежнее объединение и повтор');assert.ok(Object.keys(b.rt.fightMem).length);
});

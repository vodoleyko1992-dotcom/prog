'use strict';
// 20.43 (разбор 21.10): серия Life Stone после цели/лимита ('done') держала бота до «Закончить серию» — ни рыбалки, ни фарма, ни сторожа;
// ради TvT удержание снималось только у уже записанного героя, а записаться было нельзя (кнопка и POST под запретом ЛС).
// Теперь 'done' без неизвестной попытки снимает удержание, а открытая запись на TvT (свежий ответ сервера) прерывает серию.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=n=>fs.readFileSync(n==='modules/lifestone.js'&&process.env.LS_MODULE_SOURCE||__dirname+'/../'+n,'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
const DONE=/Серия завершена — возвращаюсь к задачам/;
function harness({ls=5,gem=5,limit=3,targets=['prominence'],outcome='tempest'}={}){
 let time=100000,seq=0,lose=false;const root={Date:{now:()=>time}};vm.createContext(root);vm.runInContext(read('augment.js'),root);vm.runInContext(read('modules/lifestone.js'),root);
 const snap={name:'Hero',revision:10,inventory:{eq:{l1:{itemId:123,enchant:7,clanWeaponUid:'weapon-a'}},stacks:[{itemId:10411,qty:ls},{itemId:2133,qty:gem}]}};
 const posts=[],recs=[];let next=outcome;
 const apply=id=>{snap.revision++;snap.inventory.stacks.forEach(r=>r.qty--);snap.inventory.eq.l1.augmentation={uid:'uid-'+(++seq),grade:'A',outcomeId:id};};
 const env={cfg:{autoLs:{targets,maxAttempts:limit}},rt:{char:'Hero'},on:true,tabOwner:true,canRun:()=>true,canPrepare:()=>true,context:()=>'context',
  rec:(...a)=>recs.push(a.slice(2).join(' ')),setStatus:()=>{},
  setRt:async p=>{Object.assign(env.rt,clone(p));return {ok:true}},gameGet:async p=>({ok:true,json:async()=>clone(p==='/character'?{character:snap}:{itemGradeHints:{123:'A'}})}),
  gamePost:async(p,body,ms,permit)=>{assert.equal(m.consumePermit(permit,body),true);posts.push(clone(body));const id=typeof next==='function'?next(posts.length):next;apply(id);
   if(lose){lose=false;throw Error('lost');}return {ok:true,status:200,json:async()=>({outcomeId:id,gemstonesSpent:1})};}};
 const m=root.L2V7Factories.lifestone(env);
 return {m,env,snap,posts,recs,apply,root,lose:()=>lose=true,outcome:v=>next=v,advance:(ms=16000)=>time+=ms,run:async()=>{await m.command('prepare');await m.command('resume');},get s(){return env.rt.autoLs}};
}
test('выбранный эффект получен — status done, удержание снято, журнал «возвращаюсь к задачам», новых трат нет',async()=>{
 const h=harness({outcome:'prominence'});await h.run();assert.equal(h.s.hold,true);await h.m.step();
 assert.equal(h.posts.length,1);assert.equal(h.s.status,'done');assert.equal(h.s.hold,false);assert.equal(h.s.pending,null);
 assert.ok(h.recs.some(x=>DONE.test(x)),h.recs.join('\n'));
 for(let i=0;i<3;i++){h.advance();assert.equal(await h.m.step(),false,'шаг ЛС не держит главный цикл');}assert.equal(h.posts.length,1);
});
test('лимит попыток исчерпан — удержание снято после последней сверенной попытки',async()=>{
 const h=harness({limit:2});await h.run();await h.m.step();assert.equal(h.s.status,'running');assert.equal(h.s.hold,true);
 h.advance();await h.m.step();assert.equal(h.posts.length,2);assert.equal(h.s.status,'done');assert.equal(h.s.hold,false);assert.match(h.s.reason,/лимит/);
 h.advance();assert.equal(await h.m.step(),false);assert.equal(h.posts.length,2);
});
test('цель уже стоит или материалы кончились без докупки (finish) — тоже done без удержания и без POST',async()=>{
 const a=harness();a.snap.inventory.eq.l1.augmentation={uid:'old',grade:'A',outcomeId:'prominence'};await a.run();await a.m.step();
 assert.equal(a.s.status,'done');assert.equal(a.s.hold,false);assert.equal(a.posts.length,0);assert.ok(a.recs.some(x=>DONE.test(x)));
 const b=harness({ls:0});b.env.cfg.autoLs.buyMaterials=false;await b.run();await b.m.step();
 assert.equal(b.s.status,'done');assert.equal(b.s.hold,false);assert.match(b.s.reason,/автодокупка выключена/);assert.equal(b.posts.length,0);
});
test('серия, завершённая старой версией (done + hold), отпускает бота на первом шаге; ровно одна строка журнала',async()=>{
 const h=harness({outcome:'prominence'});await h.run();await h.m.step();h.env.rt.autoLs={...h.s,hold:true};h.recs.length=0;
 assert.equal(await h.m.step(),true);assert.equal(h.s.hold,false);assert.equal(h.s.status,'done');assert.equal(h.recs.filter(x=>DONE.test(x)).length,1);
 assert.equal(await h.m.step(),false);assert.equal(h.posts.length,1);
});
test('неизвестная попытка держит бота, как раньше; после сверки с целью — done и удержание снято',async()=>{
 const h=harness({outcome:'prominence'});await h.run();h.lose();await h.m.step();
 assert.ok(h.s.pending);assert.equal(h.s.hold,true);assert.equal(await h.m.yieldToUrgent(),false,'pending не уступает даже TvT');
 assert.equal(await h.m.step(),true);assert.equal(h.posts.length,1);
 h.advance();await h.m.step();assert.equal(h.s.pending,null);assert.equal(h.s.status,'done');assert.equal(h.s.hold,false);assert.equal(h.posts.length,1);
});
test('ручная пауза и пауза после перезагрузки держат удержание; продолжение по-прежнему вручную',async()=>{
 const h=harness();await h.run();await h.m.command('pause');assert.equal(h.s.status,'paused');assert.equal(h.s.hold,true);assert.equal(await h.m.step(),true);
 const g=harness();await g.run();const fresh=g.root.L2V7Factories.lifestone(g.env);await fresh.step();assert.equal(g.s.status,'paused');assert.equal(g.s.hold,true);assert.equal(g.posts.length,0);
});
test('уступка TvT: идущая серия → пауза без удержания и строка журнала; завершённая остаётся done',async()=>{
 const h=harness();await h.run();assert.equal(await h.m.yieldToUrgent(),true);assert.equal(h.s.status,'paused');assert.equal(h.s.hold,false);assert.match(h.s.reason,/TvT/);
 assert.ok(h.recs.some(x=>/прервана ради TvT/.test(x)));
 const d=harness({outcome:'prominence'});await d.run();await d.m.step();d.env.rt.autoLs={...d.s,hold:true};await d.m.yieldToUrgent();assert.equal(d.s.status,'done');assert.equal(d.s.hold,false);
});

// Ядро: шаг loopGate из content.js с настоящими модулями tvt и lifestone.
function gate({tvtOn=true,stored=null,fresh=null,pending=false,status='paused',fail=false}={}){
 const src=read('content.js'),a=src.indexOf('  if (rt.autoLs?.hold && !rt.autoLs.pending && cfg.tvtOn) lsTvtPoll();'),b=src.indexOf('\n',src.indexOf('if (lifestoneCommandBusy || rt.autoLs?.hold',a));
 const d1=src.indexOf('let lsTvtReadT = 0;'),d2=src.indexOf('\n',src.indexOf('const lsTvtRegOpen =',d1));
 assert.ok(a>0&&b>a&&d1>0&&d2>d1,'фрагменты loopGate найдены');
 const clock={t:Date.parse('2026-10-21T03:00:00Z')},gets=[],steps=[];
 const box={console,Date:class extends Date{static now(){return clock.t}},setTimeout,clearTimeout,lifestoneCommandBusy:false,sleep:async()=>{}};vm.createContext(box);
 vm.runInContext(read('augment.js'),box);vm.runInContext(read('modules/lifestone.js'),box);vm.runInContext(read('modules/tvt.js'),box);
 const reg=()=>({phase:'REGISTRATION',eventId:'ev1',isRegistered:false,registrationEndsAt:new Date(clock.t+5*60000).toISOString(),registeredCount:3,maxPlayers:20,serverNow:new Date(clock.t).toISOString()});
 box.rt={char:'Hero',manualKickAt:1,tvt:stored==='reg'?{...reg(),t:clock.t-10*60000,off:0}:null,
  autoLs:{id:'series',char:'Hero',status,hold:true,reason:'Пауза игрока',pending:pending?{id:'p',t:clock.t,revision:9,ls:1,gem:1,uid:null}:null,attempts:0,maxAttempts:3,targets:['prominence'],configSig:'x',grade:'A',weapon:'w',base:'w',history:[]}};
 box.cfg={tvtOn,autoLs:{targets:['prominence'],maxAttempts:3}};
 const tenv={get cfg(){return box.cfg},get rt(){return box.rt},on:true,tabOwner:true,TVT:fresh==='reg'?{...reg(),t:clock.t,off:0}:null,setRt:async p=>Object.assign(box.rt,p),
  gameGet:async p=>{gets.push(p);if(fail)throw Error('offline');return {ok:true,json:async()=>reg()};}};
 const lenv={get cfg(){return box.cfg},get rt(){return box.rt},on:true,tabOwner:true,canRun:()=>false,canPrepare:()=>false,context:()=>'c',rec:()=>{},setStatus:()=>{},setRt:async p=>{Object.assign(box.rt,clone(p));return {ok:true}},gameGet:async()=>({ok:false}),gamePost:async()=>{throw Error('no POST')}};
 const tvt=box.L2V7Factories.tvt(tenv),ls=box.L2V7Factories.lifestone(lenv);
 box.L2V7Modules={tvt,lifestone:{...ls,step:async()=>{steps.push(1);return ls.step();}}};box.tvtSoon=()=>tvt.tvtSoon();
 vm.runInContext(src.slice(d1,d2)+'\nglobalThis.gate=async()=>{\n'+src.slice(a,b)+'\n return false; };',box);
 return {box,gets,steps,tenv,clock,run:()=>box.gate(),get s(){return box.rt.autoLs}};
}
const settle=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
test('ядро: открытая запись на TvT по свежему ответу снимает удержание ЛС — круг идёт дальше к tvtStep',async()=>{
 const g=gate({fresh:'reg'});assert.equal(await g.run(),false,'ЛС больше не заканчивает круг');
 assert.equal(g.s.hold,false);assert.equal(g.s.status,'paused');assert.match(g.s.reason,/TvT/);assert.equal(g.steps.length,0);
});
test('ядро: запись видна только в старом rt.tvt — сначала свежий GET /game/tvt (без ожидания), уступка на следующем круге',async()=>{
 const g=gate({stored:'reg'});assert.equal(await g.run(),true);assert.equal(g.s.hold,true,'старые данные не ставят серию на паузу');assert.equal(g.steps.length,1);
 await settle();assert.deepEqual(g.gets,['/game/tvt']);
 assert.equal(await g.run(),false);assert.equal(g.s.hold,false);
});
test('ядро: неизвестная попытка держит — ни опроса TvT, ни уступки, только шаг ЛС',async()=>{
 const g=gate({fresh:'reg',pending:true});assert.equal(await g.run(),true);await settle();assert.equal(g.s.hold,true);assert.ok(g.s.pending);assert.equal(g.gets.length,0);assert.equal(g.steps.length,1);
});
test('ядро: TvT выключен — нет опроса и уступки',async()=>{
 const g=gate({tvtOn:false,fresh:'reg'});assert.equal(await g.run(),true);await settle();assert.equal(g.s.hold,true);assert.equal(g.gets.length,0);
});
test('ядро: опрос /game/tvt при удержании ЛС — не чаще раза в 30 с',async()=>{
 const g=gate({fail:true});for(const dt of [0,5000,10000,10000,4000]){g.clock.t+=dt;await g.run();await settle();}
 assert.equal(g.gets.length,1,'за 29 с один опрос, хотя tvtRefresh сам пустил бы раз в 5 с');
 g.clock.t+=1000;await g.run();await settle();assert.equal(g.gets.length,2);assert.equal(g.s.hold,true);
});

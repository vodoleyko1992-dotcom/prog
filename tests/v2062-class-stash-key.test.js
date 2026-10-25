'use strict';
// 20.62 (жалоба John 25.10 «бот грузит ЦП и память»): тайник классов rt.classStash (память неактивных сабклассов, 600–870 КБ)
// живёт в своём ключе хранилища: «stash» у активного героя, «stash@Ник» у остальных, значение { char, v, _src }. Обычная запись rt
// и её рассылка storage.onChanged больше его не несут; в памяти вкладки и меню — по-прежнему rt.classStash.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const core=require('../engine-core.js'),read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'),clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const STASH={dwarf_maestro:{skills:{'hammer crush':{n:900}},t:5},human_arcana_lord:{skills:{blaze:{n:77}},t:4}};
function background(storage){
 const src=read('background.js'),cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);if(i<0||j<i)throw Error(a);return src.slice(i,j)};
 const sets=[],logs=[],ctx={console,Date,URL,Number,JSON,Object,Math,Promise,Set,Array,String,L2EngineCore:core,MAX_PATCH_KEYS:400,LOCK_TTL:90000,lockQueue:Promise.resolve(),
  buf:{push:x=>logs.push(x)},flush(){},
  chrome:{runtime:{getURL:p=>'chrome-extension://x/'+p},storage:{local:{get:async keys=>{const r={};for(const k of [].concat(keys))r[k]=clone(storage[k]);return r},
   set:async p=>{sets.push(clone(p));Object.assign(storage,clone(p))},remove:async()=>{}}}}};
 vm.createContext(ctx);vm.runInContext(cut('function serializeLock(fn)','async function lockCommand(')+cut('function mergeTimerPatch(','// Реворк ядра')+cut('async function switchCharacter(','// 8.0.6 (Firefox'),ctx);
 const tab={frameId:0,url:'https://l2wap.com/battle.html',tab:{id:1,active:true}};
 return {ctx,sets,logs,state:(patch,extra={})=>ctx.statePatch({patch,epoch:'e1',src:'tab-1',expectedChar:'Hero',...extra},tab),
  menu:(rtPatch,extra={})=>ctx.menuPatch({rtPatch,...extra},{url:'chrome-extension://x/popup.html'}),
  sw:(nick,extra={})=>ctx.switchCharacter({nick,epoch:'e1',vis:true,src:'tab-1',defRt:{kills:0},...extra},tab)};
}
const store=(rt={})=>({on:true,lock:{k:'tab1',epoch:'e1',t:Date.now()},cfg:{},rt:{char:'Hero',kills:5,classCur:{prof:'human_warlock',slot:0},...rt}});

test('statePatch: classStash уходит в ключ stash той же записью, rt его не содержит',async()=>{
 const S=store(),B=background(S);
 assert.equal((await B.state({classCur:{prof:'dwarf_maestro',slot:1,t:2},skills:{a:1},classStash:STASH})).ok,true);
 assert.equal(B.sets.length,1,'одна запись chrome.storage.local.set');
 const w=B.sets[0];assert.ok(w.rt&&w.stash,'rt и stash — в одном set');assert.equal('classStash' in w.rt,false);
 assert.deepEqual(w.stash,{char:'Hero',v:STASH,_src:'tab-1'});assert.equal(S.rt.classCur.prof,'dwarf_maestro');assert.deepEqual(S.rt.skills,{a:1});
 assert.equal('classStash' in S.rt,false,'в хранилище rt без тайника');
 // обычная запись дальше: тайник не трогается и в rt не возвращается
 await B.state({kills:6});assert.equal(B.sets.length,2);assert.equal('stash' in B.sets[1],false);assert.equal('classStash' in S.rt,false);assert.deepEqual(S.stash.v,STASH);
});
test('statePatch: пакет только с тайником большой rt не переписывает',async()=>{
 const S=store(),B=background(S);await B.state({classStash:{x:{t:1}}});
 assert.equal(B.sets.length,1);assert.deepEqual(Object.keys(B.sets[0]),['stash']);assert.deepEqual(S.stash.v,{x:{t:1}});
});
test('миграция: старое rt.classStash переносится один раз (обновление/запуск) и при первой записи statePatch/меню',async()=>{
 const S=store({classStash:STASH}),B=background(S);
 assert.equal(await B.ctx.stashMigrate('обновление'),true);
 assert.equal(B.sets.length,1);assert.equal('classStash' in S.rt,false);assert.deepEqual(S.stash,{char:'Hero',v:STASH,_src:'stash-move'});assert.equal(S.rt._src,'stash-move');
 assert.equal(B.logs.length,1,'строка в журнал');
 assert.equal(await B.ctx.stashMigrate('запуск браузера'),false,'повтор ничего не пишет');assert.equal(B.sets.length,1);
 // старое rt.classStash (например, импорт старого файла до переноса) — при любой записи statePatch
 const S2=store({classStash:STASH}),B2=background(S2);await B2.state({kills:7});
 assert.equal(B2.sets.length,1);assert.equal('classStash' in S2.rt,false);assert.deepEqual(S2.stash.v,STASH);assert.equal(S2.rt.kills,7);
 const S3=store({classStash:STASH}),B3=background(S3);await B3.menu({rbGo:null},{expectedChar:'Hero'});
 assert.equal('classStash' in S3.rt,false);assert.deepEqual(S3.stash.v,STASH);
 // свежий тайник из пакета важнее старого в rt
 const S4=store({classStash:STASH}),B4=background(S4);await B4.state({classStash:{y:{t:9}}});assert.deepEqual(S4.stash.v,{y:{t:9}});assert.ok(S4.rt,'rt тоже переписан (старое поле снято)');assert.equal('classStash' in S4.rt,false);
});
test('смена героя: тайники меняются местами той же записью, вкладке — память вместе с тайником',async()=>{
 const S={...store(),on:false,stash:{char:'Hero',v:STASH,_src:'tab-1'},'rt@Alt':{char:'Alt',kills:3},'stash@Alt':{char:'Alt',v:{orc_titan:{t:1}},_src:'x'}},B=background(S);
 const r=await B.sw('Alt');assert.equal(r.ok,true);assert.equal(B.sets.length,1);
 assert.deepEqual(r.rt.classStash,{orc_titan:{t:1}},'вкладка получает тайник нового героя');
 assert.equal('classStash' in S.rt,false);assert.equal(S.stash.char,'Alt');assert.deepEqual(S.stash.v,{orc_titan:{t:1}});
 assert.deepEqual(S['stash@Hero'],{char:'Hero',v:STASH,_src:'tab-1'});assert.equal('classStash' in S['rt@Hero'],false);
 // назад — свой тайник прежнего героя
 const back=await B.sw('Hero');assert.deepEqual(back.rt.classStash,STASH);assert.equal(S.stash.char,'Hero');
 // тот же герой — память с тайником, без записи
 const same=await B.sw('Hero');assert.equal(same.changed,false);assert.deepEqual(same.rt.classStash,STASH);
 // герой без тайника: пустая обёртка с его ником (вкладка увидит смену ключа stash и не оставит чужой тайник)
 const S2={...store(),on:false,stash:{char:'Hero',v:STASH}},B2=background(S2);const r2=await B2.sw('New');
 assert.equal(r2.rt.classStash,undefined);assert.deepEqual(S2.stash,{char:'New',v:null,_src:'tab-1'});
 // старая память rt@Ник с classStash внутри (до обновления) — в ключ stash
 const S3={...store(),on:false,'rt@Old':{char:'Old',classStash:{w:{t:2}}}},B3=background(S3);const r3=await B3.sw('Old');
 assert.deepEqual(r3.rt.classStash,{w:{t:2}});assert.equal('classStash' in S3.rt,false);assert.deepEqual(S3.stash.v,{w:{t:2}});
 // первый ник (char пуст) — тайник уходит к нему
 const S4={on:false,cfg:{},rt:{char:''},stash:{char:'',v:{a:{t:1}}}},B4=background(S4);const r4=await B4.sw('First');
 assert.deepEqual(r4.rt.classStash,{a:{t:1}});assert.equal(S4.stash.char,'First');
});
// Вкладка игры: настоящий код слушателя storage.onChanged (пересборка rt) поверх engine-core
function tab(rt,peek={},stored={}){
 const src=read('content.js'),a=src.indexOf('  const timerPrevious = rt;'),b=src.indexOf('  if (ch.rt?.newValue?.rbTimer) {',a);
 const code=src.slice(a,b),errs=[];
 const ctx={rt,DEF_RT:{kills:0},TAB_ID:'tab-me',L2EngineCore:core,quietErr:(t,e)=>errs.push(e),Object,String,JSON,
  rtWriter:{peek:()=>peek},chrome:{storage:{local:{get:async k=>({[k]:clone(stored[k])})}}}};
 vm.createContext(ctx);
 return {ctx,errs,on:ch=>{ctx.ch=ch;vm.runInContext('(()=>{'+code+'})()',ctx);return ctx.rt}};
}
test('вкладка: новый rt того же героя сохраняет тайник из памяти; ключ stash в событии важнее; своё эхо не применяется',async()=>{
 let T=tab({char:'Hero',kills:1,classStash:STASH});
 let r=T.on({rt:{newValue:{char:'Hero',kills:9,_src:'menu'}}});assert.equal(r.kills,9);assert.deepEqual(r.classStash,STASH,'обычная запись rt — тайник остаётся');
 r=T.on({rt:{newValue:{char:'Hero',kills:10,_src:'other'}},stash:{newValue:{char:'Hero',v:{z:{t:1}},_src:'other'}}});assert.deepEqual(r.classStash,{z:{t:1}});
 r=T.on({stash:{newValue:{char:'Hero',v:{q:{t:2}},_src:'other'}}});assert.deepEqual(r.classStash,{q:{t:2}},'событие только stash');assert.equal(r.kills,10);
 r=T.on({stash:{newValue:{char:'Hero',v:{old:{}},_src:'tab-me'}}});assert.deepEqual(r.classStash,{q:{t:2}},'своё эхо stash не откатывает память');
 r=T.on({rt:{newValue:{char:'Hero',kills:11,_src:'tab-me'}},stash:{newValue:{char:'Hero',v:{old:{}},_src:'tab-me'}}});assert.deepEqual(r.classStash,{q:{t:2}});
 r=T.on({stash:{newValue:{char:'Other',v:{x:{}},_src:'other'}}});assert.equal(r.classStash,undefined,'тайник другого героя не подставляется');
 // неподтверждённая очередь вкладки — поверх
 T=tab({char:'Hero',classStash:STASH},{classStash:{mine:{t:3}}});
 assert.deepEqual(T.on({rt:{newValue:{char:'Hero',_src:'menu'}},stash:{newValue:{char:'Hero',v:{z:{}},_src:'menu'}}}).classStash,{mine:{t:3}});
 // старое rt.classStash в событии (ещё не перенесено) — оно и видно
 T=tab({char:'Hero',classStash:STASH});assert.deepEqual(T.on({rt:{newValue:{char:'Hero',classStash:{leg:{}},_src:'menu'}}}).classStash,{leg:{}});
});
test('вкладка: смена героя — тайник нового из события; без ключа stash в событии — дочитывается из хранилища',async()=>{
 let T=tab({char:'Hero',classStash:STASH});
 let r=T.on({rt:{newValue:{char:'Alt',_src:'bg'}},stash:{newValue:{char:'Alt',v:null,_src:'bg'}}});assert.equal(r.classStash,undefined,'у нового героя тайника нет — старый не остаётся');
 T=tab({char:'Hero',classStash:STASH},{},{stash:{char:'Alt',v:{t1:{}}}});
 r=T.on({rt:{newValue:{char:'Alt',_src:'bg'}}});assert.equal(r.classStash,undefined,'до чтения — без чужого тайника');
 await new Promise(r=>setImmediate(r));assert.deepEqual(T.ctx.rt.classStash,{t1:{}});assert.deepEqual(T.errs,[]);
 T=tab({char:'Hero',classStash:STASH},{},{stash:{char:'Hero',v:STASH}});T.on({rt:{newValue:{char:'Alt',_src:'bg'}}});
 await new Promise(r=>setImmediate(r));assert.equal(T.ctx.rt.classStash,undefined,'обёртка прежнего героя не подходит новому');
});
test('вкладка/меню: загрузка складывает тайник в rt; ключ другого героя — нет; размер rt считается без тайника',()=>{
 const src=read('content.js');
 assert.match(src,/get\(\['cfg', 'rt', 'on', 'stash'\]\)\.then\(s => \{[^\n]*\n  cfg = mergeCfg\(s\.cfg\); rt = \{ \.\.\.DEF_RT, \.\.\.s\.rt \}; if \(L2EngineCore\.stashJoin\) rt = L2EngineCore\.stashJoin\(rt, s\.stash\);/);
 assert.match(src,/const fresh = await chrome\.storage\.local\.get\(\['rt', 'cfg', 'stash'\]\);\n\s*rt = \{ \.\.\.DEF_RT, \.\.\.\(fresh\.rt \|\| \{\}\) \}; if \(L2EngineCore\.stashJoin\) rt = L2EngineCore\.stashJoin\(rt, fresh\.stash\);/);
 assert.match(src,/size = JSON\.stringify\(\{ \.\.\.rt, classStash: undefined \}\)\.length/);
 assert.deepEqual(core.stashJoin({char:'Hero',a:1},{char:'Hero',v:STASH}).classStash,STASH);
 assert.equal(core.stashJoin({char:'Hero'},{char:'Alt',v:STASH}).classStash,undefined);
 assert.equal(core.stashJoin({char:'Hero'},{char:'Hero',v:null}).classStash,undefined);
 assert.deepEqual(core.stashJoin({char:'Hero',classStash:{leg:1}},{char:'Hero',v:STASH}).classStash,{leg:1},'старое поле в rt новее ключа');
 const pop=read('popup.js');assert.match(pop,/await liveStatusInto\(rt\); await stashInto\(rt\);/);assert.match(pop,/if \(ch\.stash\) STASH_C = ch\.stash\.newValue \?\? null;/);
});
test('меню: stashInto подставляет тайник своего героя один раз прочитанным ключом',async()=>{
 const pop=read('popup.js'),a=pop.indexOf('let STASH_C;'),b=pop.indexOf('async function load()',a);let gets=0;
 const ctx={L2EngineCore:core,Object,chrome:{storage:{local:{get:async k=>{gets++;return {[k]:{char:'Hero',v:STASH}}}}}}};vm.createContext(ctx);
 vm.runInContext(pop.slice(a,b)+';this.into=stashInto;this.set=v=>{STASH_C=v};',ctx);
 assert.deepEqual((await ctx.into({char:'Hero'})).classStash,STASH);await ctx.into({char:'Hero'});assert.equal(gets,1,'ключ читается один раз');
 assert.equal((await ctx.into({char:'Alt'})).classStash,undefined);ctx.set(null);assert.equal((await ctx.into({char:'Hero'})).classStash,undefined);
});
test('файл «Памяти бота»: прежний вид (classStash внутри rt) — выгрузка и загрузка туда-обратно',()=>{
 const storage={cfg:{a:1},rt:{char:'Hero',kills:5},stash:{char:'Hero',v:STASH,_src:'tab'},'rt@Alt':{char:'Alt',kills:2},'stash@Alt':{char:'Alt',v:{orc_titan:{t:1}}},
  'rt@Bare':{char:'Bare'},learn:{x:1}};
 const file=clone(core.stashFold(storage));
 assert.deepEqual(Object.keys(file).filter(k=>/^stash/.test(k)),[],'ключей stash в файле нет');
 assert.deepEqual(file.rt.classStash,STASH);assert.deepEqual(file['rt@Alt'].classStash,{orc_titan:{t:1}});assert.equal('classStash' in file['rt@Bare'],false);assert.deepEqual(file.learn,{x:1});
 const back=core.stashUnfold(file,'menu');
 assert.equal('classStash' in back.rt,false);assert.deepEqual(back.stash,{char:'Hero',v:STASH,_src:'menu'});assert.deepEqual(back['stash@Alt'].v,{orc_titan:{t:1}});
 assert.deepEqual(back['stash@Bare'],{char:'Bare',v:null,_src:'menu'},'герой без тайника — пустая обёртка (старый тайник не подставится)');
 assert.deepEqual(clone(core.stashFold(back)),file,'туда-обратно без потерь');
 // файл без пары rt — ключ stash не пишется
 assert.deepEqual(core.stashUnfold({stash:{char:'X',v:{}},cfg:{}}),{cfg:{}});
 const pop=read('popup.js');assert.match(pop,/const data = L2EngineCore\.stashFold\(Object\.fromEntries/);assert.match(pop,/const data = L2EngineCore\.stashUnfold\(Object\.fromEntries\(Object\.entries\(j\.data\)/);
});
test('смена класса (story.classNote) с тайником из ключа: та же семантика в памяти вкладки',()=>{
 const box={Date,console,sessionStorage:{setItem(){}}};vm.runInNewContext(read('modules/story.js'),box);
 const rt=core.stashJoin({char:'Hero',classCur:{prof:'human_warlock',slot:0},skills:{blaze:{n:5}}},{char:'Hero',v:{dwarf_maestro:{skills:{crush:{n:9}},t:1}}});
 const writes=[],env={get rt(){return rt},cfg:{},setRt:p=>{writes.push(p);Object.assign(rt,p)},rec(){},setStatus(){}};
 const S=box.L2V7Factories.story(env);S.classNote('dwarf_maestro',1,70);
 assert.deepEqual(rt.skills,{crush:{n:9}});assert.deepEqual(Object.keys(rt.classStash),['human_warlock']);
 const ch=core.stashSplitSet({rt:{...rt}},'tab');assert.equal('classStash' in ch.rt,false);assert.deepEqual(Object.keys(ch.stash.v),['human_warlock']);
});

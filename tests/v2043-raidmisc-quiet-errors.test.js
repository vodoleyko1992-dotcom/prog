'use strict';
// 20.43 (разбор 21.10): тихие ошибки кода в модулях — в журнал (env.quietErr). setRt при сбое записи не бросает ({ok:false}),
// поэтому пустые .catch у записей тура РБ и try/catch вокруг обучения/агро Warlord глушили только ошибки самого кода.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const content=read('content.js');
function core(){
  let now=1800000000000;const recs=[];
  const box={console,String,Object,Date:class extends Date{static now(){return now}},rec:(...a)=>recs.push(a)};
  vm.runInNewContext(content.slice(content.indexOf('const quietErrs = Object.create(null);'),content.indexOf('// 20.13 (ревизия 17.10, шаг 7, аудит «Код»)')),box);
  return{box,recs,tick:ms=>{now+=ms}};
}
test('modErr: ошибка кода — тег «ошибка кода: …», сеть/разбор ответа — свой тег или тишина при codeOnly; строка раз в 10 мин',()=>{
  const c=core();
  c.box.modErr('тур РБ: обучение',new TypeError("Cannot read properties of undefined (reading 'hits')"));
  assert.equal(c.recs.length,1);assert.deepEqual([c.recs[0][0],c.recs[0][1]],['S','ошибки']);
  assert.match(c.recs[0][2],/^ошибка кода: тур РБ: обучение: Cannot read properties of undefined/);
  c.box.modErr('тур РБ: обучение',new TypeError('x is not a function'));assert.equal(c.recs.length,1,'не чаще раза в 10 мин на тег');
  c.tick(600001);c.box.modErr('тур РБ: обучение',new TypeError('x is not a function'));assert.match(c.recs[1][2],/\(×2 за 10 мин\)/);
  c.box.modErr('квесты: прогресс',new TypeError('Failed to fetch'),true);c.box.modErr('квесты: прогресс',new SyntaxError('Unexpected token < in JSON'),true);
  assert.equal(c.recs.length,2,'сбой сети и разбора ответа с codeOnly — тихо, как раньше');
  c.box.modErr('справочник фарма',new Error('HTTP 500'));assert.equal(c.recs.at(-1)[2],'справочник фарма: HTTP 500','не ошибка кода — свой тег без «ошибка кода»');
  c.box.modErr('квесты (фон)',new ReferenceError('qNote is not defined'),true);assert.match(c.recs.at(-1)[2],/^ошибка кода: квесты \(фон\): qNote is not defined/);
});
test('тур РБ: сбой обучения в бою с РБ попадает в env.quietErr, бой продолжается',async()=>{
  const errs=[],rt={char:'Hero',rbDb:{},rbStats:{}};
  const env={rt,cfg:{rbHuntMode:true},heroLvl:()=>78,epicById:()=>null,logLines:()=>{throw new TypeError('logLines broken')},newLines:()=>[],activeBuffs:()=>[],rec:()=>{},
    setRt:async p=>{Object.assign(rt,p);return{ok:true}},quietErr:(tag,e)=>errs.push([tag,e.message])};
  const box={console,Math,Number,JSON,Date};box.globalThis=box;vm.runInNewContext(read('modules/raid.js'),box);const R=box.L2V7Factories.raid(env);
  const v=R.rbFlee({name:'Boss',rb:{id:'boss',hits:[],lp:[]}},{cur:9000,max:10000,pct:90},{cur:500000,max:1000000});
  assert.equal(v,null,'аварийный выход не сломан ошибкой обучения');
  assert.deepEqual(JSON.parse(JSON.stringify(errs)),[['тур РБ: обучение','logLines broken']]);
  // отложенная запись ударов РБ: ошибка кода в rbNote — тоже в журнал, а не необработанный отказ промиса
  Object.assign(env,{logLines:()=>['Boss ударив тебе −300 HP'],newLines:(a,b)=>b.slice(a.length),warlock:{raidContext:()=>({managed:true,key:'boss:A'})},rbNote:()=>Promise.reject(new TypeError('rbDb broken'))});
  R.rbLearn({name:'Boss',rb:{id:'boss',lp:[]}});await new Promise(r=>setImmediate(r));
  assert.deepEqual(JSON.parse(JSON.stringify(errs.slice(1))),[['тур РБ: запись ударов РБ','rbDb broken'],['тур РБ: запись ударов РБ','rbDb broken']]);
});
test('исходник: перечисленные тихие места переведены на quietErr, геттеры есть',()=>{
  const raid=read('modules/raid.js'),combat=read('modules/combat.js'),story=read('modules/story.js');
  assert.equal((raid.match(/try \{ rbLearn\(ctx\); \} catch \(e\) \{ env\.quietErr\?\.\('тур РБ: обучение', e\); \}/g)||[]).length,2);
  assert.match(raid,/try \{ rbWoundNote\(ctx\); \} catch \(e\) \{ env\.quietErr\?\.\('тур РБ: замер HP РБ', e\); \}/);
  assert.equal((raid.match(/\.catch\(e => env\.quietErr\?\.\('тур РБ: проба', e\)\)/g)||[]).length,4);
  assert.equal((raid.match(/\.catch\(e => env\.quietErr\?\.\('тур РБ: этап', e\)\)/g)||[]).length,2);
  assert.match(raid,/rbDpsLearn\(S\.id, dps\)\.catch\(e => env\.quietErr\?\.\('тур РБ: замер DPS', e\)\)/);
  assert.match(combat,/try \{ warlordSkipNote\(ctx\); \} catch \(e\) \{ env\.quietErr\?\.\('агро Warlord', e\); \}/);
  assert.match(story,/catch \(e\) \{ env\.quietErr\?\.\('квесты: прогресс', e, true\); \}/);
  assert.match(content,/storyTick\(\)\.catch\(e => modErr\('квесты \(фон\)', e\)\)/);
  assert.equal((content.match(/farmGuideSync\([^)]*\)\.catch\(e => modErr\('справочник фарма', e\)\)/g)||[]).length,2);
  assert.match(content,/await farmGuideRetry\(\)\.catch\(e => modErr\('справочник фарма', e\)\)/);
  for(const m of ['raid','combat','story']){
    const factory=content.slice(content.indexOf(`L2V7Modules.${m} = L2V7Factories.${m}({`)).split('\n')[0];
    assert.match(factory,/get quietErr\(\)\{return modErr\}/,`геттер quietErr у ${m}`);
  }
});
// Храповик: число пустых обработчиков ошибок в модулях, которые чистил этот пункт, не растёт. Новый код ошибки пишет через quietErr (ядро) /
// env.quietErr (модули). Пустые catch вокруг sessionStorage/DOM/необязательных API оставлены — они ожидаемы. Снизили число — уменьшите и предел.
// 20.43 (ревью ветки raidmisc): раньше пределы стояли на ВСЕ файлы точным числом коммита ветки — после слияния соседних веток 20.43 тест падал
// на чужих файлах (notify: background.js 46 > 37, menu: engine-core.js 2 > 1, lifestone/learn: content.js 154/153 > 152), хотя пустые catch
// в тур РБ никто не добавлял. Теперь пределы — только на modules/raid.js, combat.js, story.js; в content.js проверяются переведённые места.
const EMPTY_TRY=/\bcatch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}/g,EMPTY_PROMISE=/\.catch\??\.?\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*(?:\{\s*\}|undefined|null|void 0)\s*\)/g;
const CAP={'modules/raid.js':7,'modules/combat.js':33,'modules/story.js':4};
const emptyN=s=>(s.match(EMPTY_TRY)||[]).length+(s.match(EMPTY_PROMISE)||[]).length;
const overCap=rd=>Object.keys(CAP).map(f=>[f,emptyN(rd(f))]).filter(([f,n])=>n>CAP[f]).map(([f,n])=>`${f}: ${n} > ${CAP[f]}`);
test('храповик: пустых catch в модулях тура РБ, боя и квестов не больше, чем после 20.43; переведённые места content.js не опустели снова',()=>{
  assert.deepEqual(overCap(read),[],'новые пустые catch — используйте quietErr / env.quietErr');
  // в модуле тура РБ было 21 пустых обработчиков; остались только сетевые чтения /character и DOM
  assert.ok(CAP['modules/raid.js']<21);
  assert.doesNotMatch(content,/(?:farmGuideSync|farmGuideRetry|storyTick)\([^)]*\)\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(?:\{\s*\}|undefined|null|void 0)\s*\)/,'справочник фарма / опрос квестов — снова пустой catch');
});
test('храповик не зависит от соседних веток: пустые catch в других файлах не считаются, в своих модулях — считаются',()=>{
  const add=(s,k)=>s+'\n'+'try { x(); } catch (e) {}\n'.repeat(k);
  const others=['background.js','content.js','engine-core.js','popup.js','modules/buffs.js','modules/lifestone.js'];
  assert.deepEqual(overCap(f=>others.includes(f)?add(read(f),9):read(f)),[],'слияние веток с пустыми catch в чужих файлах не роняет тест');
  assert.deepEqual(overCap(f=>f==='modules/raid.js'?add(read(f),1):read(f)),[`modules/raid.js: ${CAP['modules/raid.js']+1} > ${CAP['modules/raid.js']}`]);
  assert.deepEqual(overCap(f=>f==='modules/story.js'?read(f)+'\nq().catch(() => {});':read(f)),[`modules/story.js: ${CAP['modules/story.js']+1} > ${CAP['modules/story.js']}`]);
});

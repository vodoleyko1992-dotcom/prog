'use strict';
// 20.68 (лог 27.10 12:45): воспроизводимая минутная пауза после одного сбоя собственной сверки типа цели.
// Скрытый ответ игрока не экспортирован: это проверка механизма, а не утверждение о причине его сетевого сбоя.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'v2066-quest-champion-kind.test.js'),source=fs.readFileSync(file,'utf8');
const box={require:require('node:module').createRequire(file),process,console,__dirname,Date,URL,structuredClone};
vm.runInNewContext(source.slice(0,source.indexOf("test('"))+'\nthis.fixture=fixture;',box);
const attacks=f=>f.events.filter(x=>x==='Атака').length;
const notes=f=>f.logs.filter(x=>x.startsWith('B | сверка боя |'));
function failing(f,stage,type,count=1){
 const get=f.env.gameGet,attempts=[];let remain=count;
 f.env.gameGet=async url=>{
  const r=await get(url),selected=stage==='character'?url==='/character':url.startsWith('/game/battle?');
  if(selected){attempts.push(f.state.now);if(remain-->0){
   if(type==='throw')throw Error('private-token=DO-NOT-LOG /internal/private-url');
   if(type==='json')return{...r,json:async()=>{throw Error('private-body=DO-NOT-LOG')}};
   return{...r,ok:false,status:503};
  }}
  return r;
 };
 return{attempts,fail:n=>remain=n};
}

for(const stage of ['character','battle'])for(const type of ['throw','http','json'])test(`${stage}/${type}: после одного отказа здоровый сервер проверяется через 3 с, без перезагрузки`,async()=>{
 const f=box.fixture(),m=failing(f,stage,type),base=f.state.now;
 await f.combat.battle();assert.equal(attacks(f),0);assert.equal(m.attempts.length,1);
 f.state.now=base+2999;await f.combat.battle();assert.equal(m.attempts.length,1,'до срока нового GET нет');
 f.state.now=base+3000;await f.combat.battle();assert.equal(m.attempts.length,2);assert.equal(attacks(f),1);
 assert.equal(f.events.includes('map'),false);assert.equal(f.state.posts.length,0,'сверка не создаёт POST');
 assert.equal(notes(f).length,1);assert.match(notes(f)[0],type==='http'?/HTTP 503.*через 3 с/:/ошибка чтения.*через 3 с/);
 assert.ok(!f.logs.join('\n').includes('DO-NOT-LOG'),'приватные ошибки не попадают в диагностику');
});

test('непрерывные сбои: 3→6→12 с с пределом 12 с, без запроса на каждом круге и без спама журнала',async()=>{
 for(const stage of ['character','battle']){
  const f=box.fixture(),m=failing(f,stage,'http',Infinity),start=f.state.now;
  for(let s=0;s<=60;s++){f.state.now=start+s*1000;await f.combat.battle();}
  assert.deepEqual(m.attempts.map(t=>(t-start)/1000),[0,3,9,21,33,45,57],stage);
  assert.equal(attacks(f),0);assert.equal(f.events.includes('map'),false);assert.equal(f.state.posts.length,0);
  assert.equal(notes(f).length,1,'одна причина в течение минуты');
  f.state.now=start+69000;await f.combat.battle();assert.equal(notes(f).length,2,'сохраняющийся отказ напоминается не чаще минуты');
 }
});

test('новое поколение боя сбрасывает ступень задержки, не наследуя ожидание прежнего контекста',async()=>{
 const f=box.fixture(),m=failing(f,'character','throw',2),start=f.state.now;
 await f.combat.battle();f.state.now=start+1000;f.state.generation++;await f.combat.battle();
 assert.equal(m.attempts.length,2,'новый контекст проверяется сразу');
 f.state.now=start+3999;await f.combat.battle();assert.equal(m.attempts.length,2);
 f.state.now=start+4000;await f.combat.battle();assert.equal(m.attempts.length,3);assert.equal(attacks(f),1);
 assert.equal(notes(f).length,2,'для нового контекста причина видна заново');
});

test('смена и возврат причины отказа не печатает прежнюю причину повторно в ту же минуту',async()=>{
 const f=box.fixture(),get=f.env.gameGet,start=f.state.now;let count=0;
 f.env.gameGet=async url=>{const r=await get(url);if(url==='/character'){if(++count===2)throw Error('private alternating error');return{...r,ok:false,status:503};}return r;};
 await f.combat.battle();f.state.now=start+3000;await f.combat.battle();f.state.now=start+9000;await f.combat.battle();
 assert.equal(notes(f).length,2);assert.equal(notes(f).filter(x=>x.includes('HTTP 503')).length,1);assert.equal(attacks(f),0);
});

test('сбой записи диагностики передаёт quietErr только безопасную причину и не держит повтор сверки',async()=>{
 const f=box.fixture(),m=failing(f,'character','http'),rec=f.env.rec,errors=[],privateError=new Error('token=DO-NOT-LOG https://private.invalid/actor-id');
 f.env.rec=(...args)=>{if(args[1]==='сверка боя')throw privateError;return rec(...args);};
 f.env.quietErr=(tag,error)=>{errors.push({tag,error,message:error.message});};
 const start=f.state.now;await f.combat.battle();assert.equal(attacks(f),0);assert.equal(errors.length,1);
 assert.equal(errors[0].tag,'диагностика сверки боя');assert.equal(errors[0].message,'Не удалось записать причину сверки боя');
 assert.notEqual(errors[0].error,privateError);assert.ok(!JSON.stringify(errors).includes('DO-NOT-LOG'));assert.ok(!JSON.stringify(errors).includes('private.invalid'));
 f.state.now=start+2999;await f.combat.battle();assert.equal(m.attempts.length,1);assert.equal(errors.length,1);
 f.state.now=start+3000;await f.combat.battle();assert.equal(attacks(f),1);assert.equal(m.attempts.length,2);assert.equal(f.state.posts.length,0);
});

test('успешная сверка сбрасывает ступень: новый одиночный отказ снова ждёт 3 с',async()=>{
 const f=box.fixture(),m=failing(f,'character','http',2),start=f.state.now;
 await f.combat.battle();f.state.now=start+3000;await f.combat.battle();
 f.state.now=start+9000;await f.combat.battle();assert.equal(attacks(f),1);
 m.fail(1);f.state.now=start+10000;await f.combat.battle();assert.equal(attacks(f),1);
 f.state.now=start+12999;await f.combat.battle();assert.equal(attacks(f),1);
 f.state.now=start+13000;await f.combat.battle();assert.equal(attacks(f),2);
 assert.equal(f.state.posts.length,0);
});

test('неполные схемы и неизвестный цвет сохраняют прежнюю паузу 15 с и запрет атаки',async()=>{
 for(const [kind,change,reason] of [
  ['type',d=>{d.battle.kind=''},/серверный тип цели неизвестен/],
  ['tier',d=>{d.battle.kind='champion';d.battle.championTier=''},/цвет чемпиона неизвестен/],
  ['target',d=>{d.battle.mobMaxHp=5000},/цель, уровень или HP/],
  ['identity',d=>{d.character.name='Other'},/герой, класс, ревизия или активный PvE-бой/]
 ]){
  const f=box.fixture();change(f.state.reply);const start=f.state.now;await f.combat.battle();const n=f.state.gets.length;
  f.state.now=start+14999;await f.combat.battle();assert.equal(f.state.gets.length,n,kind);
  f.state.now=start+15000;await f.combat.battle();assert.ok(f.state.gets.length>n,kind);
  assert.equal(attacks(f),0);assert.equal(f.events.includes('map'),false);assert.equal(f.state.posts.length,0);assert.equal(notes(f).length,1);
  assert.match(notes(f)[0],reason);
 }
});

test('после временного отказа Stop, чужой герой и запрещённый чемпион по-прежнему не разрешают удар',async()=>{
 for(const kind of ['Stop','foreign','champion']){
  const f=box.fixture(),m=failing(f,'character','throw');await f.combat.battle();f.state.now+=3000;
  if(kind==='Stop')f.env.on=false;
  if(kind==='foreign')f.state.reply.character.name='Other';
  if(kind==='champion'){f.state.reply.battle.kind='champion';f.state.reply.battle.championTier='red';}
  await f.combat.battle();assert.equal(attacks(f),0,kind);assert.equal(f.state.posts.length,0,kind);
  if(kind==='Stop')assert.equal(m.attempts.length,1,'Stop не посылает новый GET');
  assert.equal(f.events.includes('map'),kind==='champion','прежний запрет красного чемпиона');
 }
});

test('поздняя ошибка старого probe не увеличивает паузу и не пишет причину нового контекста',async()=>{
 const f=box.fixture(),get=f.env.gameGet,start=f.state.now;let release,seen,calls=0;
 const gate=new Promise(r=>release=r),began=new Promise(r=>seen=r);
 f.env.gameGet=async url=>{
  const r=await get(url);if(url==='/character'){
   calls++;if(calls===1){seen();await gate;throw Error('old-private-error');}
   if(calls===2)return{...r,ok:false,status:503};
  }return r;
 };
 const old=f.combat.battle();await began;f.state.generation++;f.state.now=start+1000;await f.combat.battle();
 assert.equal(notes(f).length,1);release();await old;assert.equal(notes(f).length,1);
 f.state.now=start+4000;await f.combat.battle();assert.equal(attacks(f),1,'новый probe сохранил собственные 3 с');
 assert.equal(f.state.posts.length,0);assert.ok(!f.logs.join('\n').includes('old-private-error'));
});

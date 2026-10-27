'use strict';
// 27.10, журнал 10:41: один успешный ход уже содержит те же КД в battle evidence.
// Настоящий hook → оба регистратора: HTTP-ответ игры и каждое доказательство хода сохраняются.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),plain=x=>JSON.parse(JSON.stringify(x));
const request={action:'l2_1220',battleSpawnId:'champ_o_cruma_marshlands_2',expectedRevision:602547};
function payload(){return {revision:602548,delta:{characterHp:2723,characterMp:1006,mobHp:41690,mobMaxHp:118540,logSeq:83,serverNowMs:1793061669626,
  skillCooldowns:{l2_1147:1793061670038,l2_1220:1793061670608},mysticSkillCdUntil:{l2_1147:1793061670038,l2_1220:1793061670608},
  logTail:['Полум’я — 2012 урона','[Marsh Stakato Soldier] ударив тебе — −278 HP.']}};}
async function hookEvent(body=payload(),options={}){
  const out=[],response=new Response(JSON.stringify(body),{status:options.status||200,headers:{'content-type':'application/json'}});
  const window={postMessage:x=>out.push(x),fetch:async()=>response,alert(){}};
  class X{open(){}send(){}addEventListener(){}}
  vm.runInNewContext(read('hook.js'),{window,location:{href:'https://l2wap.com/battle.html',origin:'https://l2wap.com',host:'l2wap.com'},
    URL,URLSearchParams,FormData,XMLHttpRequest:X,performance:{now:()=>1}});
  const returned=await window.fetch(options.path||'/game/battle/action',{method:options.method||'POST',body:JSON.stringify(request)});
  for(let i=0;i<30&&!out.some(x=>x.__l2bot==='net');i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(returned,response,'hook возвращает тот же ответ игры');assert.deepEqual(await returned.json(),body);
  const d=out.find(x=>x.__l2bot==='net');assert.ok(d,'hook передал ответ');return d;
}
function logger(config={}){
  const s=read('content.js'),a=s.indexOf('const netSeen ='),b=s.indexOf('const netOutage =',a),events=[];
  const box={cfg:{rec:true,netLog:true,...config},pageLeaving:false,NET_NOISE:/\/sync$/,privateNet:()=>false,hashStr:x=>x,
    rec:(...args)=>events.push(args),battleSpawn:()=>request.battleSpawnId,Date,Map,Object,Number};
  vm.runInNewContext(s.slice(a,b)+';globalThis.api={recordNetworkLog,logCooldownApi};',box);
  return {events,box,run(d,p='/game/battle/action'){
    box.api.logCooldownApi(d,p);box.api.recordNetworkLog(d,p,`${d.method} ${p}`,JSON.stringify(d.res||{}),false);
    return events;
  }};
}
const kinds=f=>f.events.map(x=>x[1]);
test('wizard: scalar skillCooldowns и тот же mystic map — один network event со всем исходным evidence',async()=>{
  const d=await hookEvent(),f=logger();f.run(d);
  assert.deepEqual(kinds(f),['сеть']);assert.deepEqual(plain(f.events[0][3].data.battle),plain(d.be));
  assert.deepEqual(plain(d.be.cooldowns),[{key:'l2_1147',until:1793061670038},{key:'l2_1220',until:1793061670608}]);
  f.run({...d,rid:d.rid+1});assert.deepEqual(kinds(f),['сеть','сеть'],'успешные POST по-прежнему пишутся каждый');
  assert.equal(f.events[1][3].data.rid,d.rid+1);
});
test('полностью сохранённые numeric timing и известный object cooldown тоже не дублируются',async()=>{
  const p=payload();Object.assign(p.delta,{globalCooldownUntilMs:1793061670200,cooldownUntilMs:1793061670300,skillRemainingMs:500,globalRemainingMs:300,mysticSkillCdUntil:1793061670400,
    skillCooldowns:{l2_1220:{skillId:1220,readyAtMs:1793061670608,remainingMs:982}}});
  const f=logger();f.run(await hookEvent(p));assert.deepEqual(kinds(f),['сеть']);
});
test('readyAtMs alias и массив object cooldown сохраняются в battle evidence полностью',async()=>{
  const p=payload();Object.assign(p,{readyAtMs:1793061671000});p.delta.skillCooldowns=[{skillId:1220,readyAt:1793061670608,remainingSec:1}];delete p.delta.mysticSkillCdUntil;
  const f=logger();f.run(await hookEvent(p));assert.deepEqual(kinds(f),['сеть']);
});
for(const [name,change] of Object.entries({
  'нет battle evidence':d=>delete d.be,
  'неизвестная schema':d=>d.be.schema=2,
  'другое действие':d=>d.be.request.action='l2_1147',
  'другая цель':d=>d.be.request.spawn='other',
  'нет rid':d=>delete d.rid,
  'skill deadline отличается':d=>d.be.cooldowns[0].until++,
  'mystic deadline отличается':d=>d.res.delta.mysticSkillCdUntil.l2_1220++,
  'mystic map не сохранён':d=>d.res.delta.mysticSkillCdUntil.extra=1793061672000,
  'неизвестный mystic формат':d=>d.res.delta.mysticSkillCdUntil='…',
  'неизвестное поле object cooldown':d=>d.res.delta.skillCooldowns.l2_1147={until:1793061670038,unknown:1},
  'skill cooldown строкой':d=>d.res.delta.skillCooldowns.l2_1147=String(d.res.delta.skillCooldowns.l2_1147),
  'serverNowMs отличается':d=>d.be.timing.serverNowMs++,
  'global deadline отсутствует':d=>d.res.delta.globalCooldownUntilMs=1793061670500,
  'cut cooldowns':d=>d.be.cut.cooldowns=1,
  'cut text':d=>d.be.cut.text=1,
  'cut extras':d=>d.be.cut.extras=1,
  'нет cut':d=>delete d.be.cut,
  'пустой cut':d=>d.be.cut={},
  'cut массивом':d=>d.be.cut=[],
  'пустой row cooldown':d=>d.be.cooldowns.unshift(null),
  'cooldown строкой':d=>d.be.cooldowns.unshift('unknown'),
  'cooldown массивом':d=>d.be.cooldowns.unshift([]),
  'timing массивом':d=>d.be.timing=[],
  'unknown nowMs alias':d=>{d.res.nowMs=d.res.delta.serverNowMs;delete d.res.delta.serverNowMs;delete d.be.timing.serverNowMs;},
  'mystic массивом':d=>d.res.delta.mysticSkillCdUntil=[1793061671000],
  'mystic unknown object':d=>d.res.delta.mysticSkillCdUntil={l2_1220:{deadline:1793061671000}},
  'network error':d=>d.error='connection lost',
  'HTTP 429':d=>d.status=429,
  'HTTP 200 ok false':d=>d.res.ok=false,
  'HTTP 200 error':d=>d.res.error='skill_cooldown',
  'HTTP 200 blockedBy':d=>d.res.blockedBy='skill',
  'HTTP 200 evidence отказ':d=>d.be.ok=false
}))test('сохраняет прежнюю отдельную диагностику: '+name,async()=>{
  const d=plain(await hookEvent());change(d);const f=logger();f.run(d);assert.deepEqual(kinds(f),['КД сервера','сеть']);
  assert.ok(f.events[0][3].data.cd);assert.equal(f.events[0][3].data.battle,undefined);
});
test('GET action/battle/sync не считаются гарантированно записанным POST',async()=>{
  for(const p of ['/game/battle/action','/game/battle','/game/battle/sync']){
    const d=await hookEvent(payload(),{method:'GET',path:p}),f=logger();f.run(d,p);assert.deepEqual(kinds(f),['КД сервера','сеть']);
  }
});
for(const layer of ['delta','battle'])for(const [key,value] of Object.entries({ok:false,error:'skill_cooldown',code:'skill_cooldown',blockedBy:'skill',reason:'not_ready'}))
test(`неизвестный отказ в ${layer}.${key} сохраняет диагностику через настоящий hook`,async()=>{
  const p=payload();p[layer]={...p.delta,[key]:value};const f=logger();f.run(await hookEvent(p));assert.deepEqual(kinds(f),['КД сервера','сеть']);
});
test('netLog off сохраняет КД, rec off выключает обе записи, POST вне action сохраняет КД',async()=>{
  const d=await hookEvent(),f=logger({netLog:false});f.run(d);assert.deepEqual(kinds(f),['КД сервера']);
  const off=logger({rec:false});off.run(d);assert.deepEqual(kinds(off),[]);
  const legacy=logger();legacy.run({...d,method:'PUT'});assert.deepEqual(kinds(legacy),['КД сервера','сеть']);
});
test('первый непокрытый отказ сразу после сжатого успешного хода не теряется из-за throttle',async()=>{
  const d=await hookEvent(),f=logger();f.run(d);f.run({...d,status:429,rid:d.rid+1});
  assert.deepEqual(kinds(f),['сеть','КД сервера','сеть']);
});

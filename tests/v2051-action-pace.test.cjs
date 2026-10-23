'use strict';
// 23.10.2026: общий темп не меняет отправку в очередь и не создаёт платёж до конца ожидания.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { createActionPace } = require('../engine-core.js');
function fixture(options = {}) {
  let now = 10000, delay = options.delay, saved = options.saved || 0, live = true;
  const sleeps = [], writes = [];
  const p = createActionPace({ clock: () => now, delay: () => delay,
    sleep: async ms => { sleeps.push(ms); now += ms; options.onSleep?.(f, ms); },
    read: () => saved, write: at => { saved = at; writes.push(at); }, ...options.env });
  const f = { p, sleeps, writes, now: () => now, advance: ms => { now += ms; },
    delay: value => { delay = value; }, stop: () => { live = false; }, wait: () => p.wait(() => live), saved: () => saved };
  return f;
}
for (const [value, expected] of [[undefined,1000],[NaN,1000],[Infinity,1000],[-1,500],[0,500],[500,500],[1234,1234],[5000,5000],[9000,5000]]) {
  test('пауза ограничена: '+String(value), () => assert.equal(fixture({delay:value}).p.gap(), expected));
}
test('первое действие без лишней задержки; ждём только остаток после фактической отправки', async () => {
  const f = fixture({delay:1000}); assert.equal(await f.wait(), true); assert.deepEqual(f.sleeps, []);
  f.p.note(); f.advance(650); assert.equal(f.p.left(),350); assert.equal(await f.wait(),true);
  assert.equal(f.now(),11000); assert.deepEqual(f.writes,[10000]);
});
test('ожидание серверного CD дольше настройки сохраняется', async () => {
  const f=fixture({delay:1000}); f.p.note(); f.advance(3300); await f.wait(); assert.equal(f.now(),13300); assert.equal(f.sleeps.length,0);
});
for (const [initial, changed, end] of [[1000,5000,15000],[5000,500,10500]]) {
  test('изменение бегунка во время ожидания '+initial+'→'+changed,async()=>{
    const f=fixture({delay:initial,onSleep:f=>f.delay(changed)});f.p.note();assert.equal(await f.wait(),true);assert.equal(f.now(),end);
  });
}
test('Stop прерывает ожидание, не создаёт новые отметки и не оставляет очередь отправок',async()=>{
  const f=fixture({delay:5000,onSleep:f=>f.stop()});f.p.note();assert.equal(await f.wait(),false);assert.equal(f.now(),10100);assert.deepEqual(f.writes,[10000]);
});
test('повторное ожидание учитывает действие, отправленное другим исполнителем',async()=>{
  let noted=false;const f=fixture({delay:1000,onSleep:f=>{if(!noted){noted=true;f.p.note();}}});f.p.note();await f.wait();assert.equal(f.now(),11100);
});
test('перезагрузка страницы сохраняет остаток паузы',async()=>{
  let now=10000,saved=0;const env={clock:()=>now,delay:()=>5000,sleep:async ms=>{now+=ms;},read:()=>saved,write:at=>{saved=at;}};
  createActionPace(env).note();now+=1500;const next=createActionPace(env);assert.equal(next.left(),3500);await next.wait();assert.equal(now,15000);
});
test('недоступное sessionStorage не отменяет темп в памяти страницы',async()=>{
  const f=fixture({delay:500,env:{read:()=>{throw Error('blocked');},write:()=>{throw Error('blocked');}}});f.p.note();await f.wait();assert.equal(f.now(),10500);
});
for (const at of [NaN,Infinity,-20,12000,'broken'])test('неверная сохранённая отметка не задерживает бота: '+at,()=>assert.equal(fixture({saved:at}).p.left(),0));
test('перевод часов назад не создаёт бесконечную паузу',()=>{const f=fixture();f.p.note();f.advance(-100);assert.equal(f.p.left(),0);});

function paymentFixture(wait) {
  let state={char:'Hero'}, seq=[];
  const env={get rt(){return state;},on:true,tabOwner:true,canRun:()=>true,actionWait:async valid=>{seq.push('wait');return wait(valid,seq);},
    setRt:async patch=>{seq.push('prepare');Object.assign(state,patch);return {ok:true};},rtCommit:async()=>true};
  const c={L2V7Factories:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../modules/payments.js'),'utf8'),c);
  return {api:c.L2V7Factories.payments(env),env,seq};
}
const spec={key:'test',kind:'shop',quote:{amount:100,currency:'Adena'}};
test('платёж готовится после ожидания, sent→permit остаётся синхронным',async()=>{
  const f=paymentFixture(valid=>valid());const p=await f.api.prepare(spec);assert.ok(p);assert.deepEqual(f.seq,['wait','prepare']);
  assert.equal(f.api.sent(p),true);assert.equal(f.api.consumePermit(),true);assert.deepEqual(f.seq,['wait','prepare']);assert.equal(f.api.consumePermit(),false);
});
test('Stop в паузе не создаёт подготовленный платёж',async()=>{
  let f;f=paymentFixture(()=>{f.env.on=false;return false;});assert.equal(await f.api.prepare(spec),null);assert.deepEqual(f.seq,['wait']);assert.equal(f.api.pending(),null);
});
test('смена героя в паузе не пишет платёж другому герою',async()=>{
  let f;f=paymentFixture(()=>{f.env.rt.char='Other';return true;});assert.equal(await f.api.prepare(spec),null);assert.deepEqual(f.seq,['wait']);
});

const content=fs.readFileSync(require.resolve('../content.js'),'utf8');
function contentWaitFixture() {
  let stamp=1, cls='main', live=true, challenge=false, now=10000;
  const p=createActionPace({clock:()=>now,delay:()=>5000,sleep:async ms=>{now+=ms;f.onSleep?.();}});
  const c={actionPace:p,automationSnapshot:()=>stamp,automationCurrent:s=>live&&s===stamp,rt:{get classCur(){return cls;}},antibotState:()=>challenge,abHold:()=>challenge==='check'};
  vm.runInNewContext(content.slice(content.indexOf('async function actionWait('),content.indexOf('function actionNote('))+';this.wait=actionWait;',c);
  const f={p,wait:c.wait,now:()=>now,change:()=>stamp++,class:()=>{cls='sub';},stop:()=>{live=false;},challenge:()=>{challenge='check';},blocked:()=>{challenge='blocked';}};return f;
}
for(const reason of ['change','class','stop','challenge'])test('ядро отменяет темп при '+reason,async()=>{const f=contentWaitFixture();f.p.note();f.onSleep=()=>f[reason]();assert.equal(await f.wait(),false);assert.equal(f.now(),10100);});

test('завершённая проверка с блоком PvE не держит выбранную рыбалку и обработку окна',async()=>{const f=contentWaitFixture();f.p.note();f.blocked();assert.equal(await f.wait(),true);assert.equal(f.now(),15000);});

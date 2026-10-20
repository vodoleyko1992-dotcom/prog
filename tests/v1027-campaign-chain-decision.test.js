'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const source=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
// Настоящие nextFight и mapDue: дальняя страница кампании, а не подменённое разрешение цепочки.
function fixture(o={}) {
 const f=flowFixture('fighter'),e=f.env;f.setWon(true);
 Object.assign(e.cfg,{priority:'[квест]\n[чемп]\n[все]',deepEvery:20,chain:true});
 Object.assign(e.rt,{sinceDeep:2,deepHot:true,via:'chain',chainQ:[0,1,1,1,1,1,0,0,0,0,0,0],eff:{chain:{sec:2.5},map:{sec:10}}});
 Object.assign(e,{campOn:()=>true,campEnabled:()=>true,campActive:()=>true,campMobOpen:()=>['Quest Mob'],searchActive:()=>true,deepN:()=>20});
 const policy={get cfg(){return e.cfg},get rt(){return e.rt},FARM_EVERY:50,farmMapOn:()=>!!e.farmMapOn?.(),campChampDue:()=>e.campChampOpen(),champHunt:()=>true,champEvery:()=>20,mapOff:()=>!e.cfg.deepEvery,rbDue:()=>e.rbDue(),campRbOpen:()=>e.campRbOpen(),searchActive:()=>e.searchActive()};
 vm.runInNewContext(source.slice(source.indexOf('const deepN ='),source.indexOf('// цепочка сама'))+'\nthis.api={deepN,mapDue}',policy);
 Object.assign(e,policy.api);Object.assign(e,o);return f;
}
const ctx={name:'Ol Mahum Legionnaire',killed:[],champ:false};
function result(f,hunt){assert.equal(f.events.includes('hunt'),hunt);assert.equal(f.events.includes('map'),!hunt)}
test('лог21:06:12: 43%, ≈6 с против10 — дальняя страница не отменяет выгодную цепочку',async()=>{
 const f=fixture();await f.farm.nextFight(ctx);result(f,true);
 assert.match(f.logs.join('\n'),/целей 43 %.*≈6 с.*≈10 с.*продолжаю цепочку/);
});
test('невыгодные 14%, ≈18 с против10 — карта за целью',async()=>{
 const f=fixture();f.env.rt.chainQ=[0,1,0,0,0,0,0,0,0,0,0,0];await f.farm.nextFight(ctx);result(f,false);
 assert.match(f.logs.join('\n'),/на карту за целью/);assert.doesNotMatch(f.logs.join('\n'),/продолжаю цепочку/);
});
test('меньше шести наблюдений не отменяет ранний поиск дальних целей',async()=>{
 const f=fixture();f.env.rt.chainQ=[1,0];await f.farm.nextFight(ctx);result(f,false);
});
for(const [label,configure] of [
 ['обычный срок поиска чемпионов',e=>{e.rt.sinceDeep=20}],
 ['чемпионы незавершённой главы',e=>{e.campChampOpen=()=>true}],
 ['РБ требует карты',e=>{e.rbDue=()=>true}],
 ['РБ главы',e=>{e.campRbOpen=()=>['boss'];e.rt.sinceDeep=3}],
 ['выключенная цепочка',e=>{e.cfg.chain=false}],
 ['не кампания',e=>{e.campMobOpen=()=>[]}]
])test(label+' сохраняет выход, журнал не обещает продолжение',async()=>{
 const f=fixture();configure(f.env);await f.farm.nextFight(ctx);result(f,false);assert.doesNotMatch(f.logs.join('\n'),/продолжаю цепочку/);
});
for(const n of [49,50])test('ресурсный интервал '+n+' не меняется кампанией',async()=>{
 const f=fixture();f.env.farmMapOn=()=>true;f.env.rt.sinceDeep=n;await f.farm.nextFight(ctx);result(f,n===49);
});
test('проверка кампании прерывает даже выгодную цепочку',async()=>{
 const f=fixture();f.env.rt.campaignDue=true;f.env.goCampaign=async()=>f.events.push('campaign');await f.farm.nextFight(ctx);
 assert.ok(f.events.includes('campaign'));assert.ok(!f.events.includes('hunt'));
});
test('срочная закупка сохраняет приоритет',async()=>{
 const f=fixture();f.env.rt.shop={urgent:true};await f.farm.nextFight(ctx);assert.equal(f.location.href,'/char.html');assert.ok(!f.events.includes('hunt'));
});
test('TvT сохраняет приоритет',async()=>{
 const f=fixture();f.env.tvtStep=async()=>{f.events.push('tvt');return true};await f.farm.nextFight(ctx);assert.equal(JSON.stringify(f.events),'["tvt"]');
});
test('Stop во время ожидания кнопки не запускает бой',async()=>{
 const f=fixture();f.env.waitFor=async()=>{f.env.on=false;return f.hunt};await f.farm.nextFight(ctx);assert.ok(!f.events.includes('hunt'));assert.ok(!f.events.includes('map'));
});
for(const [label,change] of [
 ['цепочка выключена',e=>{e.cfg.chain=false}],
 ['выбран режим заточки',e=>{e.autonomyMode=()=> 'enchant'}],
 ['новая ручная цель',e=>{e.rt.manualKickAt=123}],
 ['сменился персонаж',e=>{e.rt.char='other'}]
])test(label+' во время записи журнала запрещает устаревший hunt',async()=>{
 // 20.41: метка цепочки пишется без ожидания — смена, видимая к моменту записи решения, ловится проверкой сразу после неё
 const f=fixture(),e=f.env,write=e.setRt;e.setRt=p=>{const r=write(p);if(p.chainWhy==='chain')change(e);return r};
 await f.farm.nextFight(ctx);assert.ok(!f.events.includes('hunt'));
});
test('ручная смена режима во время ожидания кнопки отменяет продолжение',async()=>{
 const f=fixture();f.env.waitFor=async()=>{f.env.autonomyMode=()=> 'fish';return f.hunt};await f.farm.nextFight(ctx);assert.ok(!f.events.includes('hunt'));
});
for(const [label,change] of [
 ['персонаж',e=>{e.rt.char='other'}],
 ['режим',e=>{e.autonomyMode=()=> 'fish'}],
 ['ручная цель',e=>{e.rt.manualKickAt=123}]
])test('изменился '+label+' при записи решения о карте — старый маршрут отменён',async()=>{
 const f=fixture(),e=f.env,write=e.setRt;e.rt.sinceDeep=20;e.setRt=p=>{const r=write(p);if(p.chainWhy==='map')change(e);return r};   // 20.41: см. выше
 await f.farm.nextFight(ctx);assert.ok(!f.events.includes('map'));assert.ok(!f.events.includes('hunt'));
});
test('не появился следующий бой — честный переход на карту',async()=>{
 const f=fixture();f.env.waitFor=async()=>null;await f.farm.nextFight(ctx);result(f,false);assert.match(f.logs.join('\n'),/следующий бой не подтвердился/);assert.doesNotMatch(f.logs.join('\n'),/продолжаю цепочку/);
});
test('серия выгодных нецелевых побед не включает deepHot обратно до обычного срока',async()=>{
 const f=fixture();
 for(let i=0;i<4;i++) {f.setWon(true);f.env.rt.chainQ=[0,1,1,1,1,1,0,0,0,0,0,0];f.env.rt.sinceDeep=3+i;await f.farm.nextFight(ctx)}
 assert.equal(f.events.filter(x=>x==='hunt').length,4);assert.equal(f.events.filter(x=>x==='map').length,0);
 f.setWon(true);f.env.rt.sinceDeep=20;await f.farm.nextFight(ctx);assert.equal(f.events.filter(x=>x==='map').length,1);
});

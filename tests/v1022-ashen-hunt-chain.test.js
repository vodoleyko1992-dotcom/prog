'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
function fixture(opt={}) {
 const f=flowFixture('mage',opt);
 f.location.search='?spawnId=ashen_bastion_mob_001';f.location.href='/battle.html'+f.location.search;
 f.env.cfg.deepEvery=50;f.env.cfg.champEvery=50;f.env.rt.sinceDeep=500;f.env.mapDue=()=>true;
 return f;
}
test('Ashen: победа → штатная цепочка, без местного списка и без обычной карты',async()=>{
 const f=fixture();await f.combat.battle();assert.equal(f.events.filter(x=>x==='hunt').length,1);
 assert.match(f.location.href,/battle.html/);assert.ok(!f.events.includes('map'));assert.equal(f.env.rt.via,'chain');
});
test('Ashen: выключенная цепочка возвращает в местный список',async()=>{
 const f=fixture();f.env.cfg.chain=false;await f.combat.battle();assert.ok(!f.events.includes('hunt'));assert.equal(f.location.href,'/ashen-bastion.html');
});
test('Ashen: отказ hunt-continue даёт один клик и возврат к местному списку',async()=>{
 const f=fixture({huntFail:true});await f.combat.battle();assert.equal(f.events.filter(x=>x==='hunt').length,1);
 assert.equal(f.location.href,'/ashen-bastion.html');assert.ok(f.logs.some(x=>x.includes('не подтвердился')));assert.ok(!f.events.includes('map'));
});
for(const why of ['stop','lease','mode'])test('Ashen: '+why+' во время ожидания кнопки отменяет и клик, и возврат',async()=>{
 const f=fixture();f.setWon(true);f.env.waitFor=async fn=>{const result=fn();if(why==='stop')f.env.on=false;else if(why==='lease')f.env.tabOwner=false;else f.env.autonomyMode=()=> 'cat';return result;};
 await f.farm.nextFight({killed:[]});assert.ok(!f.events.includes('hunt'));assert.match(f.location.href,/battle.html/);
});
test('Ashen: медленный ответ hunt-continue дожидается второго окна и не выходит',async()=>{
 const f=fixture({huntFail:true});f.setWon(true);let waits=0;
 f.env.waitFor=async fn=>{waits++;if(waits===2)f.setNet({huntT:Date.now()+1,huntDoneT:0});if(waits===3){f.setWon(false);f.hp.textContent='1000 / 1000';}return fn();};
 await f.farm.nextFight({killed:[]});assert.equal(waits,3);assert.equal(f.events.filter(x=>x==='hunt').length,1);assert.match(f.location.href,/battle.html/);
});
test('Ashen: отсутствующая кнопка не блокирует фарм, используется местный список',async()=>{
 const f=fixture();f.setWon(true);const q=f.env.$q;f.env.$q=s=>s==='#battle-victory-hunt'?null:q(s);
 await f.farm.nextFight({killed:[]});assert.ok(!f.events.includes('hunt'));assert.equal(f.location.href,'/ashen-bastion.html');
});

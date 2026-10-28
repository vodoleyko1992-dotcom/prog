'use strict';
// 20.41 (аудит скорости 20.10): активный VIP + «Городской бафф: выкл.» — townBuffStart после каждой победы отвечал «жду» (true),
// nextFight выходил, и охота стояла с GET /character на каждом круге. Теперь: false без запросов и покупок; FA по-прежнему запрещены.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'v2029-vip-no-fa.test.js'),'utf8');
const box={require:n=>n==='node:test'?()=>{}:require(n),__dirname,console,Date,Math,process,structuredClone};
vm.runInNewContext(src.slice(0,src.indexOf("test('VIP запрещает")),box);
test('VIP + городской бафф выкл.: охота не ждёт, без GET/POST/FA',async()=>{
 const f=box.fixture();f.env.cfg.townBuffSet='off';f.env.rt.vipBuff.t-=180000;f.gets.length=0;
 assert.equal(await f.B.townBuffStart('баффы кончились'),false);
 assert.equal(f.gets.length,0);assert.equal(f.posts.length,0);assert.equal(f.prepareCount,0);assert.deepEqual([...f.B.faWanted()],[]);
});
// 20.76+ (ревизия 28.10): тест по названию проверял «набор включён», а в коде — vipBuffAuto=false; true значило вечное ожидание.
// Теперь выключенный бесплатный набор = обычный бесплатный basic (поход, true), без VIP-запроса/FA/оплаты. Ожидание при включённом
// наборе и недоступной сверке — tests/v2077-audit-buffs.test.js.
test('VIP + бесплатный набор выключен: обычный basic без платной замены и без FA',async()=>{
 const f=box.fixture();f.env.cfg.vipBuffAuto=false;f.gets.length=0;
 assert.equal(await f.B.townBuffStart('баффы кончились'),true);assert.equal(f.posts.length,0);assert.equal(f.prepareCount,0);
 assert.equal(f.env.rt.tbuff.set,'basic');assert.deepEqual([...f.env.rt.tbuff.fa],[]);assert.ok(!f.env.rt.tbuff.vipFree);assert.equal(f.gets.length,0);
});

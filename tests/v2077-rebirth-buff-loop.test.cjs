'use strict';
// Лог29.10 09:51–10:28: 491 круг к бафферу при полных HP/MP. Проверяем расхождение свежего VIP-снимка и HUD/памяти VIP.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const fixtureFile=path.join(__dirname,'v2073-rebirth-hero-buffs.test.cjs'),src=fs.readFileSync(fixtureFile,'utf8'),cut=src.indexOf("\ntest('");
assert.ok(cut>0,'стенд настоящей фабрики баффов найден');
const box={require:require('node:module').createRequire(fixtureFile),__dirname,path,console,URL,URLSearchParams,Date,structuredClone};
vm.runInNewContext(src.slice(0,cut)+'\nthis.make=fixture;',box);
const same=(a,b,msg)=>assert.equal(JSON.stringify(a),JSON.stringify(b),msg);
function full(f){f.hp=100;f.mp=100;Object.assign(f.ch,{hp:1000,maxHp:1000,mp:1000,maxMp:1000});return f;}
function basic(f,{server=true,hud=true}={}){
 const until=f.job.t+86400000;
 if(server)f.ch.activeBuffs=[{skillId:1040,level:2,expiresAtMs:until}];
 if(hud)f.H[1040]=until;
 return f;
}
function planned(f,set,vip=false){
 assert.ok(f.env.rt.tbuff,'нужный бафф не заменён пустым успешным восстановлением');
 assert.equal(f.env.rt.tbuff.step,'town');assert.equal(f.env.rt.tbuff.set,set);
 assert.equal(!!f.env.rt.tbuff.vipFree,vip);same(f.env.rt.tbuff.fa,[]);
 same(f.env.rt.tbuff.rebirthRecovery,f.marker,'свой маркер сохранён');
 assert.equal(f.env.rt.tbuff.then.step,'restore');assert.equal(f.env.rt.tbuff.then.buffDone,true);
 same(f.env.rt.tbuff.then.rebirthRecovery,f.marker,'маркер сохранён до восстановления');
 assert.equal(f.loc.href,'');assert.equal(f.env.rt.restoreRes,undefined);
 same(f.fires,[]);same(f.posts,[]);
}

for(const memory of ['missing','expired'])test('полныеHP/MP, свежийVIP и '+memory+' VIP-память: план mage вместо пустого restore',async()=>{
 const f=basic(full(box.make({vip:true})));
 // Полный VIP-набор включает basic: стенд не удаляет его эффекты при применении mage.
 f.catalog.sets.find(x=>x.id==='mage').skills.push({skillId:1040,level:2,durationSec:86400});
 if(memory==='expired'){f.B.vipNote(f.ch);f.tick(120001);}
 assert.equal(f.B.rebirthBuffNeed(),null,'по HUD basic готов, старая память VIP не разрешает mage');
 assert.equal(f.B.rebirthBuffNeed(f.ch).set,'mage','свежий собственный сервер подтверждает VIP-набор');
 await f.B.townBuffStep();planned(f,'mage',true);
 await f.B.townBuffStep();
 assert.equal(f.posts.length,1,'бесплатный VIP-набор применяется один раз');
 assert.equal(f.posts[0].body.set,'mage');assert.equal(f.posts[0].body.expectedFeeAdena,'0');assert.equal(f.posts[0].body.expectedFeeCoinOfLuck,0);
 assert.equal(f.env.rt.tbuff.step,'restore');assert.equal(f.env.rt.tbuff.buffDone,true);
 await f.B.townBuffStep();
 assert.equal(f.env.rt.tbuff,null);assert.equal(f.env.rt.restoreRes.ok,true);assert.equal(f.loc.href,'/rebirth-raids.html');
 assert.equal(f.B.rebirthBuffNeed(f.ch),null,'после подтверждённого VIP-набора новый поход к бафферу не нужен');
 assert.equal(f.posts.length,1);same(f.fires,[],'полные HP/MP не вызывают восстановление');
});

test('API: basic отсутствует; HUD ошибочно готов — свой restore планирует бесплатный basic',async()=>{
 const f=basic(full(box.make()),{server:false});
 assert.equal(f.B.rebirthBuffNeed(),null);assert.equal(f.B.rebirthBuffNeed(f.ch).set,'basic');
 await f.B.townBuffStep();planned(f,'basic');
});

test('API: basic готов; HUD ещё пустой — при полныхHP/MP лишнего basic и оплаты нет',async()=>{
 const f=basic(full(box.make()),{hud:false});
 assert.equal(f.B.rebirthBuffNeed().set,'basic');assert.equal(f.B.rebirthBuffNeed(f.ch),null);
 await f.B.townBuffStep();
 assert.equal(f.env.rt.tbuff,null);assert.equal(f.env.rt.restoreRes.ok,true);assert.equal(f.loc.href,'/rebirth-raids.html');
 same(f.fires,[]);same(f.posts,[]);
});

test('обычный restore продолжает использовать HUD, без нового чтения героя',async()=>{
 const f=full(box.make({own:false}));f.ch.activeBuffs=[{skillId:1040,level:2,expiresAtMs:f.job.t+86400000}];
 await f.B.townBuffStep();
 assert.equal(f.env.rt.tbuff.step,'town');assert.equal(f.env.rt.tbuff.set,'basic');
 assert.equal(f.env.rt.tbuff.rebirthRecovery,undefined);same(f.reads,[]);same(f.posts,[]);
});

test('городской бафф выключен: свежий снимок не создаёт basic или VIP-покупку',async()=>{
 const f=full(box.make({vip:true}));f.env.cfg.townBuffSet='off';
 await f.B.townBuffStep();
 assert.equal(f.env.rt.tbuff,null);assert.equal(f.env.rt.restoreRes.ok,true);same(f.fires,[]);same(f.posts,[]);
});

for(const point of ['get','json'])for(const change of ['stop','owner','lease','kick','marker'])test('рассинхрон VIP не обходит отмену после '+point+': '+change,async()=>{
 const f=basic(full(box.make({vip:true})));let changed=false;
 f.hook=async p=>{if(p!==point||changed)return;changed=true;
  if(change==='stop')f.env.on=false;if(change==='owner')f.env.tabOwner=false;if(change==='lease')f.env.leaseEpoch='new-lease';
  if(change==='kick')f.env.rt.manualKickAt++;if(change==='marker')f.env.rt.tbuff.rebirthRecovery={...f.marker,actor:'other'};
 };
 await f.B.townBuffStep();
 assert.equal(changed,true);assert.equal(f.loc.href,'');same(f.fires,[]);same(f.posts,[]);assert.equal(f.writes.length,0);
});

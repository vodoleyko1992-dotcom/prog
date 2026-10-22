'use strict';
// Совместная проверка: настоящий нормализатор серверного КД управляет планом/лечением локализованного Roar.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createBattleCooldown}=require('../battle-cooldown.js'),actual=require('./fixtures/warlord-cooldowns-20261022.json');
const read=p=>fs.readFileSync(__dirname+'/'+p,'utf8'),roar=actual.cases.find(x=>x.request.action==='battle_roar'),spawn=roar.request.battleSpawnId;
function fixture(){
 // Используем уже проверенный DOM/классовый стенд, заменяя его заглушку КД настоящей моделью.
 const support=read('v2048-warlord-battle-roar.test.js'),box={__dirname,console,require:x=>x==='node:test'?()=>{}:require(x)};
 vm.runInNewContext(support.slice(0,support.indexOf("test('активный Battle Roar")),box);
 const f=box.fixture();f.env.combatCooldown=createBattleCooldown(f.now);
 f.buffs([{id:1040,exp:f.now()+3600000}]);
 return f;
}
const plan=f=>f.C.battleRoarPlan(f.ctx,f.env.meHp(),f.env.meMp());
test('родной Battle Roar остаётся закрыт реальным178с КД после устаревания30с evidence и пропуска из sync',()=>{
 const f=fixture(),model=f.env.combatCooldown;
 assert.equal(plan(f)?.b,f.roar,'готовый слот без записи121 допускает начальную попытку');
 model.observe(roar.request,roar.response,roar.status,spawn);
 const remaining=roar.response.delta.skillCooldowns.l2_121-roar.response.serverNowMs+40;
 assert.ok(remaining>178000);assert.equal(f.C.ready(f.roar),false);assert.equal(plan(f),null);
 f.advance(35000);assert.equal(model.skillKnown('battle_roar',spawn),false);
 assert.equal(model.skillWait('battle_roar',spawn),remaining-35000);assert.equal(plan(f),null,'положительный срок сильнее устаревшего known');
 model.observeSync({serverNowMs:roar.response.serverNowMs+35000,skillCooldowns:{l2_287:roar.response.serverNowMs+35000}},spawn);
 assert.equal(plan(f),null,'пропущенный121 не означает готовность');
 f.advance(remaining-35000+1);assert.equal(model.skillWait('battle_roar',spawn),0);assert.equal(plan(f)?.b,f.roar);
});
test('истёкший реальный CD разрешает слот, но активный MaxHP эффект запрещает и подготовку, и ложное лечение',()=>{
 const f=fixture(),model=f.env.combatCooldown;
 model.observe(roar.request,roar.response,roar.status,spawn);f.advance(180000);
 assert.equal(model.skillWait('battle_roar',spawn),0);assert.equal(f.C.ready(f.roar),true);
 f.env.meHp=()=>({cur:6958,max:11035,pct:63});f.buffs([{id:121,exp:f.now()+2000}]);
 assert.equal(plan(f),null);assert.equal(f.C.healPick(f.ctx,f.env.meMp()),null);
 f.env.cfg.nHeal+=', Heal';assert.equal(f.C.healPick(f.ctx,f.env.meMp()),f.heal,'настоящая альтернатива лечения сохранена');
 f.advance(2001);assert.equal(plan(f)?.b,f.roar,'истечение HUD снова открывает первое применение');
});
test('словарь откатов чужого native-навыка не становится готовностью/запретом Roar по порядку полей',()=>{
 const f=fixture(),model=f.env.combatCooldown,server=roar.response.serverNowMs;
 model.observe({action:'lionheart',battleSpawnId:spawn},{serverNowMs:server,delta:{skillCooldowns:{l2_287:server+45000}}},200,spawn);
 const lionWait=model.skillWait('lionheart',spawn);
 assert.equal(model.skillKnown('battle_roar',spawn),false);assert.equal(plan(f)?.b,f.roar);
 model.observe({action:'lionheart',battleSpawnId:spawn},{serverNowMs:server+1,delta:{skillCooldowns:{l2_121:server+178000}}},200,spawn);
 assert.equal(model.skillWait('lionheart',spawn),lionWait,'чужой срок121 не перезаписывает Lionheart');
 assert.equal(plan(f),null,'явный121 блокирует настоящий Roar независимо от action последнего запроса');
});

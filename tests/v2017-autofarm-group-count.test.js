'use strict';
// 18.10, журнал 23:30–23:34: короткий DOM-хвост терял соседей среди добычи.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/v1014-combat-outcomes.test.js','utf8');
function fixture(extras=[],dom=[]){
 const box={require:n=>n==='node:test'?()=>{}:require(n),__dirname,console,URLSearchParams,Date,Math,setTimeout};
 vm.createContext(box);vm.runInContext(source.slice(0,source.indexOf('for(const role of')),box);
 const f=box.flowFixture('fighter');f.quota=[];f.quests=[];
 f.env.rt.char='Hero';f.env.battleKills=()=>({spawn:'first-mob',t:Date.now(),win:true,lose:false,extras});
 f.env.beginFarmQuota=async()=>({id:'test-ticket'});f.env.finishFarmQuota=async(t,lost,n)=>{f.quota.push({t,lost,n});return false};
 f.env.extraKillsInLog=lines=>lines.some(l=>/Ты нанёс/.test(l))?dom.map(name=>({name,exp:0,sp:0,adena:0,items:[]})):[];
 f.env.isQuestName=()=>true;f.env.trackQuest=async name=>{f.quests.push(name);return false};
 return f;
}
test('три смерти из полного ответа при пустом DOM дают четыре убийства и четыре в квоту',async()=>{
 const f=fixture(['Cave Maiden','Cave Maiden','Cave Howler']);await f.combat.battle();assert.equal(f.env.rt.kills,4);assert.equal(f.quota.at(-1).n,4);assert.equal(f.quests.filter(n=>n==='Cave Maiden').length,2);
});
test('одно совпавшее имя из DOM и полного ответа учитывается один раз, второе одноимённое сохраняется',async()=>{
 const f=fixture(['Cave Maiden','Cave Maiden','Cave Howler'],['Cave Maiden']);await f.combat.battle();assert.equal(f.env.rt.kills,4);assert.equal(f.quota.at(-1).n,4);
});
test('поздний DOM не дублирует уже подтверждённые сервером смерти',async()=>{
 const f=fixture(['Maiden','Howler','Knight']);let calls=0;f.env.extraKillsInLog=lines=>{calls++;return calls>2&&lines.length?[{name:'Maiden',exp:0,sp:0,adena:0,items:[]}]:[]};await f.combat.battle();assert.equal(f.env.rt.kills,4);assert.equal(f.quota.at(-1).n,4);
});
test('два одинаковых имени в DOM не схлопываются',async()=>{
 const f=fixture([],['Maiden','Maiden']);await f.combat.battle();assert.equal(f.env.rt.kills,3);assert.equal(f.quota.at(-1).n,3);
});
for(const kind of ['spawn','old','malformed'])test('чужое или повреждённое подтверждение не добавляет убийства: '+kind,async()=>{
 const f=fixture(['Maiden']);f.env.battleKills=()=>kind==='malformed'?{extras:[null,7,{}]}:{spawn:kind==='spawn'?'other-mob':'first-mob',t:kind==='old'?1:Date.now(),win:true,extras:['Maiden']};await f.combat.battle();assert.equal(f.env.rt.kills,1);assert.equal(f.quota.at(-1).n,1);
});
test('без подтверждения исчезновение соседей и большая награда не создают убийства',async()=>{
 const f=fixture();f.env.battleKills=()=>null;await f.combat.battle();assert.equal(f.env.rt.kills,1);assert.equal(f.quota.at(-1).n,1);
});
test('победа после reload передаёт полный счёт в восстановление сохранённой квоты',async()=>{
 const f=fixture(['A','A','B']);f.setWon(true);await f.combat.battle();assert.equal(f.quota.at(-1).n,4);assert.equal(f.env.rt.kills,0,'без точки начала сессии нельзя повторно увеличивать общий счётчик');
});
test('поражение после reload передаёт только подтверждённых соседей',async()=>{
 const f=fixture(['A','B']);f.env.battleKills=()=>({spawn:'first-mob',t:Date.now(),win:false,lose:true,extras:['A','B']});const q=f.env.$q;f.env.$q=s=>s==='#battle-defeat-root'?{}:q(s);await f.combat.battle();assert.equal(f.quota.at(-1).n,2);assert.equal(f.quota.at(-1).lost,true);assert.equal(f.env.rt.kills,0);
});
for(const kind of ['marker','hp'])test('поражение в активном бою сохраняет убитых соседей до ухода со страницы: '+kind,async()=>{
 const f=fixture(['A','A']);let dead=false,deaths=0;const q=f.env.$q,fire=f.env.fire,hp=f.env.meHp;
 f.env.$q=s=>s==='#battle-defeat-root'&&dead&&kind==='marker'?{}:q(s);
 f.env.meHp=()=>dead&&kind==='hp'?{cur:0,max:1000,pct:0}:hp();
 f.env.battleKills=()=>dead?{spawn:'first-mob',t:Date.now(),win:false,lose:true,extras:['A','A']}:null;
 f.env.fire=b=>{fire(b);f.setWon(false);f.hp.textContent='500 / 1000';dead=true;return true};f.env.onDeath=async()=>{deaths++;assert.equal(f.quota.at(-1)?.n,2)};
 await f.combat.battle();assert.equal(f.env.rt.kills,2);assert.equal(f.quota.at(-1).lost,true);assert.equal(deaths,1);
});
test('смена героя во время ожидания билета смерти не закрывает квоту нового героя',async()=>{
 const f=fixture(['A','A']);let dead=false,deaths=0;const q=f.env.$q,fire=f.env.fire;
 f.env.farmQuotaCached=()=>true;f.env.beginFarmQuota=async()=>{await new Promise(r=>setTimeout(r,10));f.env.rt.char='Other';return null};
 f.env.$q=s=>s==='#battle-defeat-root'&&dead?{}:q(s);f.env.fire=b=>{fire(b);f.setWon(false);f.hp.textContent='500 / 1000';dead=true;return true};f.env.onDeath=async()=>{deaths++};
 await f.combat.battle();assert.equal(f.quota.length,0);assert.equal(deaths,0);
});

'use strict';
// 20.43 (лог 21.10 15:47–15:51, Arcana Lord в катакомбах): после убивающего Flame Strike с причиной «АОЕ: проверяю дополнительную
// добычу» бот ещё 950 мс ждал (13 из 13 боёв, ответ хода → итог боя 965 ± 12 мс). Теперь окно замера закрывается победой/смертью
// моба, а проба одного умения в одном месте без модели группы ограничена тремя за 10 мин.
const fs=require('fs'),path=require('path'),test=require('node:test'),assert=require('node:assert/strict');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
const src=fs.readFileSync(path.join(__dirname,'../modules/combat.js'),'utf8');
function flame(){
 const f=flowFixture('mage'),{env}=f,fl={title:'Flame Strike',getAttribute:()=>null};
 f.slots.push(fl);f.hp.textContent='3924 / 3924';
 env.combatProfileKind=()=> 'fighter';env.cfg.nPower='Flame Strike';env.cfg.mageProbe=false;env.isChargeName=()=>false;env.isForceName=()=>false;
 env.cfg.catMode=true;env.rt.catIn='catacomb_of_dark_omens';
 env.rt.skills={'flame strike':{dmg:150000,dmgN:5,aoe:1}};env.expDmg=k=>k==='атака'?1:(env.rt.skills[k.toLowerCase()]?.dmg||0);
 env.skillMp=()=>28;env.ilOf=b=>b===fl?{c:'Маг. атака',t:'MDAM',mp:28}:null;env.fightGroupOn=()=>null;
 return {f,env,fl};
}
test('проба АОЕ выбирается без модели группы и после трёх проб в том же месте выключается на 10 мин',()=>{
 const {f,env}=flame();
 const a=f.combat.chooseAction({block:{}},{cur:6000,max:6209});
 assert.equal(a?.name,'Flame Strike');assert.match(a.why,/проверяю дополнительную добычу/);
 for(let i=0;i<3;i++)f.combat.aoeProbe.note('Flame Strike');
 const b=f.combat.chooseAction({block:{}},{cur:6000,max:6209});
 assert.ok(!/проверяю дополнительную добычу/.test(b?.why||''),'после 3 проб без модели — без пробы');
 env.rt.catIn='other_dungeon';
 assert.match(f.combat.chooseAction({block:{}},{cur:6000,max:6209})?.why||'',/проверяю/,'другое место — свой счёт');
});
test('модель группы есть — проба не нужна',()=>{
 const {f,env}=flame();env.fightGroupOn=()=>({n:1,kills:2,targets:2,damage:152620});
 const a=f.combat.chooseAction({block:{}},{cur:6000,max:6209});assert.equal(a?.name,'Flame Strike');assert.doesNotMatch(a.why,/проверяю/);assert.match(a.why,/доп\. убийств/);
});
test('убивающий удар пробы: победа без ожидания 950 мс',async()=>{
 const {f,env}=flame();env.cfg.catMode=false;const sleeps=[],waits=[];
 const w=env.waitFor;env.waitFor=async(fn,ms,st)=>{waits.push(ms);return w(fn,ms,st)};
 const s=env.sleep;env.sleep=async ms=>{sleeps.push(ms);return s(ms)};
 await f.combat.battle();
 assert.ok(f.events.includes('Flame Strike'),'удар Flame Strike: '+f.events.join(','));
 assert.ok(!sleeps.includes(950),'нет sleep(950)');
 // ревью: путь пробы действительно прошёл — окно замера (waitFor 950) открыто и проба засчитана (1 из 3)
 assert.ok(waits.includes(950),'окно пробы waitFor(…, 950): '+waits.join(','));
 assert.equal(f.combat.aoeProbe.capped('Flame Strike'),false);
 f.combat.aoeProbe.note('Flame Strike');assert.equal(f.combat.aoeProbe.capped('Flame Strike'),false,'2 из 3');
 f.combat.aoeProbe.note('Flame Strike');assert.equal(f.combat.aoeProbe.capped('Flame Strike'),true,'боевая проба была первой из трёх');
});
test('исходник: окно пробы закрывается победой/смертью/мёртвым мобом',()=>{
 assert.doesNotMatch(src,/await env\.sleep\(950\)/);
 assert.match(src,/env\.waitFor\(\(\) => victory\(\) \|\| defeat\(\) \|\| !\(mobHp\(\)\?\.cur > 0\), 950, 30\)/);
});

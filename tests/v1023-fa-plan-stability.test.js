'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const now=Date.now(),H={},levels={};let crit=1,role='mage';
 const box={Date,Math,console,location:{pathname:'/map.html'},document:{querySelectorAll:()=>[]}};
 vm.createContext(box);
 for(const file of ['buff-value.js','fa-full.js','modules/buffs.js'])vm.runInContext(fs.readFileSync(__dirname+'/../'+file,'utf8'),box);
 const hud={querySelectorAll:()=>Object.entries(H).map(([id,exp])=>({dataset:{skillId:id,expiresAt:exp},getAttribute:()=>`Buff · Lv.${levels[id]||3}`}))};
 const env={cfg:{rbSessBuffs:'auto',rbHuntMode:true,rbFaFull:true,townBuffSet:'off',faBuffs:''},rt:{rbHunt:{step:'fight'},faBal:{v:200,t:now}},TB_KEYS:{basic:[]},
 $q:s=>s==='#l2-hud-active-buffs'?hud:null,heroRole:()=>role,heroStatsFor:()=>box.L2BuffVal.stats(role,{matk:9000,mcrit:crit,mck:2,patk:1000,cat:null,buffs:[]}),
 faCost:id=>box.L2FaFull.COST[id]||1,setRt:async p=>Object.assign(env.rt,p),rec:()=>{}};
 const B=box.L2V7Factories.buffs(env);
 return {B,env,H,levels,now,crit:x=>crit=x,role:x=>role=x,group:()=>Array.from(B.faFullIds()).filter(id=>box.L2FaFull.GROUP.includes(id))};
}
test('авторанг меняется, но действующий Water сохраняется вместо покупки Magnus',()=>{
 const f=fixture();assert.deepEqual(f.group(),[1413]);f.H[1357]=f.now+3600000;
 assert.deepEqual(f.group(),[1357]);assert.equal(f.B.townBuffNeed().fa.includes(1413),false);
 f.crit(5);assert.deepEqual(f.group(),[1357]);
});
test('Magnus сохраняется при новом предпочтении Water, в том числе после пересоздания модуля',()=>{
 const f=fixture();f.crit(5);assert.deepEqual(f.group(),[1357]);f.H[1413]=f.now+3600000;
 assert.deepEqual(f.group(),[1413]);f.crit(1);assert.deepEqual(f.group(),[1413]);
 const g=fixture();g.crit(5);g.H[1413]=f.H[1413];assert.deepEqual(g.group(),[1413]);
});
test('истёкший или скоро истекающий бафф позволяет новый выбор',()=>{
 const f=fixture();f.H[1357]=f.now-1;assert.deepEqual(f.group(),[1413]);f.H[1357]=f.now+30000;assert.deepEqual(f.group(),[1413]);
});
test('явный список сессии сохраняет приоритет игрока над действующим автонабором',()=>{
 const f=fixture();f.H[1357]=f.now+3600000;f.env.cfg.rbSessBuffs='1413,1357,1323';assert.deepEqual(f.group(),[1413]);
});
test('общий явный список исключает конфликт из объединённой очереди покупки',()=>{
 const f=fixture();f.H[1413]=f.now+3600000;f.env.cfg.faBuffs='1357';const ids=Array.from(f.B.faWanted());
 assert.ok(ids.includes(1357));assert.ok(!ids.includes(1413));f.H[1357]=f.now+3600000;delete f.H[1413];assert.ok(!f.B.townBuffNeed().fa.includes(1413));
});
test('смена класса не сохраняет Greater из чужого автонабора',()=>{
 const f=fixture();f.H[1413]=f.now+3600000;f.role('fighter');assert.deepEqual(f.group(),[1414]);
});
test('выученный конфликт сохраняет активный бафф; низкий уровень допускает улучшение',()=>{
 const f=fixture();f.env.rt.faClash={1059:[273]};f.H[273]=f.now+3600000;let ids=Array.from(f.B.faFullIds());assert.ok(ids.includes(273));assert.ok(!ids.includes(1059));
 f.H[1059]=f.now+3600000;delete f.H[273];f.levels[1059]=2;ids=Array.from(f.B.faFullIds());assert.ok(f.B.faLow(1059));assert.ok(f.B.townBuffNeed().fa.includes(1059));
});
test('без шапки нет основания отправлять героя за отсутствующими баффами',()=>{
 const f=fixture();f.env.$q=()=>null;assert.equal(f.B.townBuffNeed(),null);assert.ok(f.B.faFullIds().length>0);
});

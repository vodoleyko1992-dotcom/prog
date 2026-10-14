'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function fixture(){
 const e={cfg:{champOrange:true,champRed:false,champCancel:'efficiency'},rt:{lvl:70,rbDps:1000,champLearn:{dps:{dps:1000,base:1000}}},heroLvl:()=>70,farmRate:()=>({eps:1000,sk:1}),faPaidLeft:()=>0};
 const b={};vm.runInNewContext(fs.readFileSync(root+'/modules/champs.js','utf8'),b);
 return {e,c:b.L2V7Factories.champs(e),mob:{tier:'orange',lvl:70,hp:8000,exp:100000,fa:0.2}};
}
test('быстрый оранжевый с запасом окупается',()=>{const f=fixture(),j=f.c.judge(f.mob);assert.equal(j.ok,true);assert.match(j.why,/выгодно/);assert.equal(j.lim,96)});
test('время и Cancel по отдельности проходят, суммарно невыгодны',()=>{const f=fixture();f.e.faPaidLeft=()=>1;const j=f.c.judge({...f.mob,hp:48000});assert.equal(j.ok,false);assert.match(j.why,/невыгодно/)});
test('нет платных баффов — нет выдуманной платы за Cancel',()=>{const f=fixture();assert.match(f.c.judge(f.mob).why,/Cancel ≈0 с/)});
test('переход через карту входит в стоимость',()=>{const f=fixture();f.e.rt.eff={map:{sec:200},chain:{sec:1}};assert.equal(f.c.judge(f.mob).ok,false)});
for(const key of ['hp','exp'])test('нет '+key+' — не идём на слепую пробу',()=>{const f=fixture();assert.equal(f.c.judge({...f.mob,[key]:0}).ok,false)});
test('нет темпа обычного фарма — прибыль неизвестна',()=>{const f=fixture();f.e.farmRate=()=>null;assert.equal(f.c.judge(f.mob).ok,false)});
test('незнакомая защита73+ увеличивает ETA и резерв',()=>{const f=fixture();delete f.e.rt.champLearn;const j=f.c.judge({...f.mob,lvl:73,hp:30000});assert.equal(j.ok,false);assert.equal(j.hard,true)});
test('красный запрещён независимо от огромной награды',()=>{const f=fixture();assert.equal(f.c.judge({...f.mob,tier:'red',exp:9999999}).off,true)});
test('ручное отключение оранжевых сохраняется',()=>{const f=fixture();f.e.cfg.champOrange=false;assert.equal(f.c.judge(f.mob).off,true)});
test('свежий отрицательный боевой вердикт не обходится выгодой',()=>{const f=fixture();f.e.rt.champLearn.v={orange:{t:Date.now(),gap:0,pow:{lvl:70,base:1000},why:'не пробиваю'}};assert.equal(f.c.judge(f.mob).ok,false)});
test('режим paid сохраняет прежнюю совместимость',()=>{const f=fixture();f.e.cfg.champCancel='paid';f.e.faPaidLeft=()=>1;assert.equal(f.c.judge({...f.mob,hp:48000}).ok,true)});
test('миграция включает условных оранжевых и оставляет красных запрещёнными',()=>{const s=fs.readFileSync(root+'/content.js','utf8'),line=s.split('\n').find(x=>x.includes("once('orangeValue1017'")),cf={champOrange:false,champRed:true,champCancel:'never'};vm.runInNewContext(line,{cf,once:(_,fn)=>fn()});assert.deepEqual(cf,{champOrange:true,champRed:false,champCancel:'efficiency'})});
test('настройки профиля и меню согласованы',()=>{const p=JSON.parse(fs.readFileSync(root+'/base-profile.json','utf8'));assert.equal(p.cfg.champCancel,'efficiency');assert.equal(p.cfg.champOrange,true);assert.equal(p.cfg.champRed,false);assert.match(fs.readFileSync(root+'/popup.html','utf8'),/value="efficiency"/)});
for(const via of ['map','chain'])test('реальный вход в бой: экономический допуск '+via,async()=>{
 const {flowFixture}=require('./warlock-combat-fixture.cjs'),f=flowFixture('mage'),e=f.env;
 Object.assign(e.cfg,{champOrange:true,champRed:false,champCancel:'efficiency'});
 Object.assign(e.rt,{via,rbDps:1000,target:{name:'Safe Mob',champ:true,tier:'orange',lvl:70,exp:100000,fa:0.2,valueT:Date.now()}});
 e.farmRate=()=>({eps:1000,sk:1});e.faPaidLeft=()=>0;e.heroLvl=()=>70;
 const b={};vm.runInNewContext(fs.readFileSync(root+'/modules/champs.js','utf8'),b);e.champs=b.L2V7Factories.champs(e);
 e.battleInfo=()=>({name:'Safe Mob',tier:'orange',lvl:70,max:1000,kind:'champion',t:Date.now()});
 await f.combat.battle();assert.equal(f.events.includes('map'),via==='chain');assert.equal(f.events.includes('Blaze'),via==='map');
});
for(const quest of [false,true])test('карта: невыгодный оранжевый не обходит расчёт через квест='+quest,()=>{
 const box={console,__dirname,require:n=>n==='node:test'?()=>{}:require(n),module:{exports:{}}};
 vm.runInNewContext(fs.readFileSync(root+'/tests/v1013-ultra-champion-gates.test.js','utf8')+'\nmodule.exports={fixture}',box);
 const f=box.module.exports.fixture(),e=f.env;Object.assign(e.cfg,{champOrange:true,champCancel:'efficiency'});e.farmRate=()=>({eps:1000,sk:1});e.isQuestName=()=>quest;
 Object.assign(e.NET_SPAWNS,{hp:{champ_o_test:1000000},exp:{champ_o_test:10000}});
 const picks=f.m.candidates(f.m.parseRules(),{ids:['champ_o_test','ordinary'],quest:quest?['Buffalo Slave']:[]},{champ_o_test:'champion',ordinary:'passive'},99);
 assert.ok(!picks.some(x=>x.id==='champ_o_test'));
});
test('отход оранжевого использует чистый бюджет без прежнего допуска30%',()=>{
 const f=fixture();const r=f.c.fleeCheck({champ:true,tier:'orange',lvl:70,chHp0:1000,chLim:20},{pct:100},{cur:700,max:1000},8);
 assert.equal(r.kind,'slow');
});
test('нулевой шанс FA и мизерныйEXP не получают фиктивную цену15с',()=>{const f=fixture();assert.equal(f.c.judge({...f.mob,hp:1,exp:1,fa:0}).ok,false)});
test('ниже героя−5 шансFA не добавляет несуществующую выгоду',()=>{const f=fixture();assert.equal(f.c.judge({...f.mob,lvl:60,hp:1000,exp:1}).ok,false)});

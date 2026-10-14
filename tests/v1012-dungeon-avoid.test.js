'use strict';
// Логи 14.10: подземелье повторно выбирало «не по зубам» и мобов, о снятии баффов которыми бот уже знал.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const s={console,Date,Math,JSON};s.globalThis=s;vm.createContext(s);
for(const name of ['dungeons','buffs','champs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../modules/'+name+'.js'),'utf8'),s);
const env={cfg:{catMin:0,catMax:0,lvlBelow:5,lvlAbove:5,noCancelMobs:true},rt:{hardMobs:{'lilim great mystic':{t:Date.now()}},
  buffCancel:{'nephilim royal guard':{t:Date.now(),n:3}}},campActive:()=>false,campChampOpen:()=>false};
const buffs=s.L2V7Factories.buffs(env);env.cancelRisk=(...args)=>buffs.cancelRisk(...args);
const d=s.L2V7Factories.dungeons(env),hard={id:'h',name:'Lilim Great Mystic',lvl:75},cancel={id:'c',name:'Nephilim Royal Guard',lvl:75},safe={id:'s',name:'Lilim Slayer',lvl:74};
assert.equal(d.catPick([hard,cancel,safe],74).id,'s','помеченные цели не выбираются снова');
assert.equal(d.catPick([hard,cancel],74),null,'все кандидаты запрещены — бой не начинается');
env.rt.hardMobs['lilim great mystic'].t=Date.now()-7200001;
assert.equal(d.catPick([hard],74).id,'h','метка «не по зубам» истекает через 2 часа');
env.cfg.noCancelMobs=false;assert.equal(d.catPick([cancel],74).id,'c','явно отключённое избегание снятия баффов сохраняется');
env.cfg.noCancelMobs=true;
assert.equal(d.catPick([{...hard,quest:true}],74).id,'h','явная квестовая цель остаётся доступной');
assert.equal(d.catPick([{...cancel,quest:true}],74).id,'c','квестовое исключение снятия баффов сохраняется');
env.rt.hardMobs['lilim great mystic'].t=Date.now();env.campActive=()=>true;env.campChampOpen=()=>true;
assert.equal(d.catPick([{...hard,champ:true}],74).id,'h','чемпион активной главы остаётся доступным');
// Цвет подземельного чемпиона проходит через hook, сохраняется в списке и фильтруется до квестовых исключений.
const hook=fs.readFileSync(path.join(__dirname,'../hook.js'),'utf8');
vm.runInContext(hook.slice(hook.indexOf('const dungMobs ='),hook.indexOf('// 9.2 (анализатор боя)'))+'this.dungMobs=dungMobs;',s);
const packet=s.dungMobs({pathname:'/game/dungeon/view'},{dungeon:{id:'saints',mobs:[
  {id:'champ_o_x',kind:'champion',name:'Orange',level:75,championTier:'orange'},
  {id:'blue',kind:'champion',name:'Blue',level:75,championTier:'blue'}]}});
assert.equal(packet.mobs[0][5],'orange','сетевой hook не выбрасывает цвет');
s.document={querySelectorAll:()=>[]};env.dungNet=()=>({...packet,t:Date.now()});env.heroLvl=()=>74;
env.cfg.champOrange=false;env.cfg.champRed=false;env.cfg.champBlue=true;env.cfg.champMinLvl=0;
env.champs=s.L2V7Factories.champs(env);
const list=d.mobList('saints').list;assert.equal(list[0].tier,'orange');
assert.equal(d.catPick(list,74).name,'Blue','оранжевый чемпион не выбирается в подземелье');
assert.equal(d.catPick([{...list[0],quest:true}],74),null,'цветовой запрет действует и на квестовую цель');
assert.equal(d.catPick([{...list[1],tier:'green'}],74).name,'Blue','зелёный разрешён вместе с синим');
console.log('PASS: dungeon target selection — hard/cancel memory, timeout, settings and quest exceptions');

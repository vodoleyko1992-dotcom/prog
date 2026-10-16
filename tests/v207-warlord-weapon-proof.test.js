'use strict';
// 17.10.2026, журнал00:52–00:57: надето Orcish Poleaxe, но оба агро блокирует имя последнего клика.
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const fixtureSrc=fs.readFileSync('tests/v206-warlord-two-pulls.test.js','utf8');
const box={console,Date,fs:{...fs,readFileSync:(p,...a)=>fs.readFileSync(p==='modules/combat.js'&&process.env.L2_COMBAT_SOURCE||p,...a)},vm};vm.createContext(box);vm.runInContext(fixtureSrc.slice(fixtureSrc.indexOf('function fixture(){'),fixtureSrc.indexOf('\nfunction withHowl()')),box);
const fixture=()=>{const f=box.fixture();f.env.rt.weapons[0].id=299;f.panel.push({action:'howl',title:'Звіриний рев',mp:31,disabled:false,getAttribute:()=>null});return f;};
for(const name of ['',undefined,'Меч гомункула C-grade.'])for(const action of ['provoke','howl'])test('надетая пика разрешает '+action+' при старом имени '+String(name),()=>{
 const f=fixture();f.env.rt.weaponNow=name;if(action==='howl')f.state.cd.provoke=5000;
 const a=f.C.warlordPullPlan(f.ctx,f.mp);assert.ok(a,'подтверждённая пика допускает план агро');assert.equal(f.C.chooseAction(f.ctx,f.mp)?.b.action,action);f.C.warlordPullResult(f.ctx,a,true);
 assert.equal(f.C.chooseAction(f.ctx,f.mp)?.b.action,'whirlwind');
});
for(const [name,change]of Object.entries({
 'смена оружия в полёте':f=>f.env.rt.weaponMetaPending={id:299},'снято':f=>f.env.rt.weapons[0].where='сумка',
 'неизвестное оружие':f=>f.env.rt.weapons[0].unknown=true,'не пика':f=>f.env.rt.weapons[0].wt='меч',
 'нет замера':f=>f.env.rt.weaponsT=0,'две надетых строки':f=>f.env.rt.weapons.push({...f.env.rt.weapons[0],id:999}),
 'новое подтверждённое ID не совпадает':f=>f.env.rt.weaponEq={id:999}
}))test('не обходит защиту: '+name,()=>{const f=fixture();f.env.rt.weaponNow='';change(f);assert.equal(f.C.warlordPullPlan(f.ctx,f.mp),null)});
test('штатная квитанция equip подтверждает пику без ручного клика по панели',async()=>{
 const f=fixture();f.env.rt.char='alt2';f.env.rt.weaponNow='';f.env.rt.weapons=[];f.env.rt.weaponsT=0;
 const core=fs.readFileSync('content.js','utf8'),begin=core.indexOf('async function weaponEquipNote(req) {');
 const item={k:'W',n:'Orcish Poleaxe',wt:'древковое',g:'C',pa:156,ma:0};
 const ctx={Date,rt:f.env.rt,setRt:async p=>Object.assign(f.env.rt,p),itemsDb:async()=>{},rec:()=>{},L2V7Modules:{equipment:{weaponItem:()=>item,resolveWeaponItem:async()=>item}}};
 vm.createContext(ctx);vm.runInContext(core.slice(begin,core.indexOf('// 10.0.19',begin)),ctx);
 await ctx.weaponEquipNote({action:'equip',itemId:299,expectedRevision:42});
 assert.equal(f.env.rt.weaponMetaPending,null);assert.equal(f.env.rt.weapons[0].where,'надето');
 assert.equal(f.C.warlordPullPlan(f.ctx,f.mp)?.b.action,'provoke');
});

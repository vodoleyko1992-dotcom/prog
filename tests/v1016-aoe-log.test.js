'use strict';
// 14.10, лог 16:20: наблюдаемый урон основной/дополнительных целей и атрибуция лечения проверяются отдельно.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{casts,observedLogs}=require('./fixtures/aoe-2026-10-14.json');
function damageCore(){
 const s=fs.readFileSync(path.join(root,'content.js'),'utf8'),a=s.indexOf('const splashDmg ='),b=s.indexOf('const cdWatch =',a),box={rt:{},setRt(){}};
 const na=s.indexOf('const NAME_ALIAS ='),nb=s.indexOf('for (const [a, b] of Object.entries(NAME_ALIAS))',na),ba=s.indexOf('const BUFF_RE ='),bb=s.indexOf('\n',ba);
 assert.ok(a>=0&&b>a&&na>=0&&nb>na&&ba>=0&&bb>ba);
 vm.runInNewContext(s.slice(na,nb)+s.slice(ba,bb)+'\n'+s.slice(a,b)+';globalThis.api={splashDmg,dmgFromLog};',box);return box.api;
}
test('семь принятых Flame Strike сохраняют отдельные основной и дополнительный урон',()=>{
 const c=damageCore();for(const x of casts){assert.equal(c.dmgFromLog('Flame Strike',x.damageLines),x.mainRawDamage,x.actionTime);assert.equal(c.splashDmg(x.damageLines),x.rawTotal-x.mainRawDamage,x.actionTime);}
 assert.equal(casts.reduce((n,x)=>n+x.mainRawDamage,0),99819);assert.equal(casts.reduce((n,x)=>n+c.splashDmg(x.damageLines),0),199638);
 assert.equal(casts.reduce((n,x)=>n+x.mpSpentObserved,0),266);
});
test('новый формат соседей поддерживает обычный и неразрывные тысячные пробелы',()=>{
 const c=damageCore();for(const sep of [' ','\u00a0','\u202f'])assert.equal(c.splashDmg(['Удар полум’я 12423',`Удар полум’я: додаткові цілі — A −12${sep}423, B −12${sep}423.`]),24846);
});
test('крит Flame Strike сохраняет отображённый дополнительный урон',()=>{assert.equal(damageCore().splashDmg(casts[6].damageLines),50020)});
test('старое древко и несколько строк сохраняют каждый удар по соседям',()=>{
 const c=damageCore(),lines=['Ты нанёс [Main] 50 урона.','Древко розсікло ворогів поруч: Alpha −111, Beta −222.'];
 assert.equal(c.splashDmg(lines),333);assert.equal(c.dmgFromLog('атака',lines),383);
 assert.equal(c.splashDmg(['Вихор вразив ворогів поруч: A −111.','Землетрус вразив ворогів поруч: B -222.']),333);
});
test('входящий урон, кот, лечение, энергия и гибель дополнительной цели не дают splash',()=>{
 assert.equal(damageCore().splashDmg(['[Mob] ударив тебе −250 HP.','Слуга [Kai] атакує [Mob] 900 урону.','HP +239 (зцілення).','Вампіризм +239 HP','Hurricane Assault: сила535, −2 енергії сили3247','Додаткова ціль повалена: Eva’s Seeker.']),0);
});
test('перестановка строки соседей не меняет основной урон заклинания',()=>{
 const c=damageCore(),main='Удар полум’я 12423',extra='Удар полум’я: додаткові цілі — A −700, B −900.';
 assert.equal(c.dmgFromLog('Flame Strike',[main,extra]),12423);assert.equal(c.dmgFromLog('Flame Strike',[extra,main]),12423);assert.equal(c.splashDmg([extra,main]),1600);
});
test('одна строка соседей не создаёт основной урон и при разрешённом fallback',()=>{
 const c=damageCore();for(const allowAlt of [false,true])assert.equal(c.dmgFromLog('Flame Strike',['Удар полум’я: додаткові цілі — A −700, B −900.'],allowAlt),0);
});
test('настоящий выбор бойца прибавляет отдельный splash к основному урону один раз',()=>{
 const c=damageCore(),lines=['Удар полум’я: додаткові цілі — A −700, B −900.','Удар полум’я 12423'];
 const {flowFixture}=require('./warlock-combat-fixture.cjs'),f=flowFixture('mage'),{env}=f,flame={title:'Flame Strike',getAttribute:()=>null};
 f.slots.push(flame);f.hp.textContent='20000 / 20000';const q=env.$q;env.$q=s=>s==='#battle-whirlwind-extras'?{textContent:'A 20000/20000 B 20000/20000'}:q(s);
 env.combatProfileKind=()=> 'fighter';env.cfg.nPower='Blaze|Flame Strike';env.cfg.mageProbe=false;env.isChargeName=()=>false;env.isForceName=()=>false;
 env.rt.skills.blaze={dmg:15000,dmgN:1};env.rt.skills['flame strike']={dmg:c.dmgFromLog('Flame Strike',lines),dmgN:1,aoe:1,spl:c.splashDmg(lines),splN:1};
 env.expDmg=k=>k==='атака'?1000:(env.rt.skills[k.toLowerCase()]?.dmg||0);env.skillMp=n=>n==='Flame Strike'?38:29;env.ilOf=()=>({c:'Маг. атака',t:'MDAM',mp:38});
 const action=f.combat.chooseAction({block:{}},{cur:5000,max:5314});assert.equal(env.rt.skills['flame strike'].dmg,12423);
 assert.equal(action.name,'Blaze','15000 > 12423 + 1600; повторное прибавление splash ошибочно выбрало бы Flame Strike');
});
function fightlab(){
 let now=1000000;class Clock extends Date{static now(){return now;}}
 const env={cfg:{},rt:{char:'Fixture',classCur:{prof:'human_arcana_lord'}},recoveryContext:()=> 'fresh-stable-fixture',pvpPending:()=>false,actName:a=>({l2_1181:'Flame Strike',l2_1331:'Summon Feline Queen',l2_1147:'Vampiric Touch'}[a]||a),setRt:async p=>Object.assign(env.rt,p),rec(){}};
 const box={console,Date:Clock,Math,URLSearchParams,location:{search:'?spawnId=l2dop_rb_fixture'}};vm.runInNewContext(fs.readFileSync(path.join(root,'modules/fightlab.js'),'utf8'),box);const api=box.L2V7Factories.fightlab(env);
 api.onNet('/game/battle',{status:200,bt:{name:'Fixture Boss',spawn:'l2dop_rb_fixture',kind:'raid',hp:14528,mp:5314,mob:1000000,mobMax:1000000,full:true,seq:0,log:[]}});
 const note=(log,action='l2_1181',seq=1)=>{now+=1000;return api.onNet('/game/battle/action',{status:200,req:{action},bt:{name:'Fixture Boss',spawn:'l2dop_rb_fixture',kind:'raid',hp:14767,mp:5276,mob:900000,mobMax:1000000,full:true,seq,log}})};return{api,note,env};
}
test('fightlab сохраняет основной урон и крит отдельно от соседей',()=>{
 const f=fightlab();for(const x of casts){const p=f.api.parseLog(x.damageLines,'Fixture Boss');assert.equal(p.own,x.mainRawDamage,x.actionTime);assert.equal(p.crit,x.crit?1:0);assert.equal(p.selfHeal,0);}
});
// Синтетический replay наблюдаемых строк; экспорт содержит обрезанные ответы сервера, а не полный native battle.log.
test('Flame Strike без строки лечения не обучает heal по изменению HUD239',()=>{const f=fightlab(),t=f.note(observedLogs.flame);assert.equal(t.selfHeal,0);assert.equal(f.api.healOn('Flame Strike'),null)});
test('Queen без строки лечения не обучает heal по изменению HUD239',()=>{const f=fightlab(),t=f.note(observedLogs.queen,'l2_1331');assert.equal(t.selfHeal,0);assert.equal(f.api.healOn('Summon Feline Queen'),null)});
test('VT239 и echo вампиризма дают одно восстановление239',()=>{const f=fightlab(),t=f.note(observedLogs.vampiric,'l2_1147');assert.equal(t.selfHeal,239);assert.equal(f.api.healOn('Vampiric Touch').mean,239);assert.equal(f.api.healOn('Vampiric Touch').n,1)});
test('повтор результата и полного хвоста не удваивает обучение лечения',()=>{const f=fightlab();f.note(observedLogs.vampiric,'l2_1147',1);f.note(observedLogs.vampiricRepeat,'l2_1147',1);assert.equal(f.api.healOn('Vampiric Touch').n,1)});
test('ожидание PvP очищает лечение и не обучается на чужом окне',()=>{const f=fightlab();f.note(observedLogs.vampiric,'l2_1147',1);f.env.pvpPending=()=>true;assert.equal(f.note(observedLogs.vampiricSecond,'l2_1147',2),null);assert.equal(f.api.healOn('Vampiric Touch'),null)});

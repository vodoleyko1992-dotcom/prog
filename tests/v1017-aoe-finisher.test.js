'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
function setup(){
 const f=flowFixture('mage'),e=f.env,flame={title:'Flame Strike',getAttribute:()=>null};
 f.slots.push(flame);f.hp.textContent='3732 / 3732';
 e.cfg.mageProbe=false;e.rt.skills.blaze={dmg:25449*3,dmgN:3};
 e.rt.skills['flame strike']={dmg:21264*3,dmgN:3,aoe:1,spl:42528*3,splN:3};
 e.expDmg=k=>{const p=e.rt.skills[k.toLowerCase()];return p?p.dmg/p.dmgN:0};
 e.skillMp=n=>n==='Flame Strike'?38:29;e.ilOf=()=>({c:'Маг. атака',t:'MDAM',mp:38});
 const row=(name,hp)=>({querySelector:s=>s.includes('__icon')?{alt:name}:{textContent:hp}});
 const panel={textContent:'3366/33663828/3828',querySelectorAll:()=>[row('Buffalo Slave','3366 / 3366'),row('Hot Springs Bandersnatch','3828 / 3828')]};
 const q=e.$q;e.$q=s=>s==='#battle-whirlwind-extras'?panel:q(s);
 return {...f,panel,flame,pick:(ctx={block:{}},mp={cur:5370,max:5408})=>f.combat.chooseAction(ctx,mp)};
}
test('панель игры: имена в alt, HP отдельных строк не склеиваются',()=>{const f=setup(),m=f.combat.extraMobs();assert.equal(m.length,2);assert.equal(m[0].name,'Buffalo Slave');assert.equal(m[1].cur,3828)});
test('слабая группа: готовый Flame Strike вместо дешёвого одиночного Blaze',()=>{const f=setup();assert.equal(f.pick().name,'Flame Strike');assert.match(f.pick().why,/АОЕ/)});
test('надёжность по текущей цели поддерживает групповое добивание',()=>{const f=setup();f.env.fightKillP=()=>1;assert.equal(f.pick().name,'Flame Strike')});
test('ненадёжный АОЕ не заменяет гарантированное одиночное добивание',()=>{const f=setup();f.env.fightKillP=n=>n==='Flame Strike'?0.5:1;assert.equal(f.pick().name,'Blaze')});
for(const kind of ['hidden','dead','unknown','blocked','mana','raid','economy'])test('нет приоритета АОЕ: '+kind,()=>{
 const f=setup();let ctx={block:{}},mp={cur:5370,max:5408};
 if(kind==='hidden')f.env.shown=x=>!!x&&x!==f.panel;
 if(kind==='dead')f.panel.querySelectorAll=()=>[{querySelector:s=>s.includes('__icon')?{alt:'Dead'}:{textContent:'0 / 3828'}}];
 if(kind==='unknown')delete f.env.rt.skills['flame strike'].aoe;
 if(kind==='blocked')ctx.block['power:Flame Strike']=Date.now()+60000;
 if(kind==='mana')mp.cur=35;
 if(kind==='raid')ctx.rb=true;
 if(kind==='economy')mp.cur=100;
 assert.equal(f.pick(ctx,mp).name,'Blaze');
});
test('АОЕ на локальном откате не задерживает готовое добивание',()=>{const f=setup();f.env.memLeft=b=>b===f.flame?10:0;assert.equal(f.pick().name,'Blaze')});
test('без изученных попаданий splash не делает заклинание надёжным',()=>{const f=setup();f.env.rt.skills['flame strike'].dmgN=1;assert.equal(f.pick().name,'Blaze')});
test('пробелы в HP соседей и отсутствие имени не теряют живую цель',()=>{const f=setup();f.panel.querySelectorAll=()=>[{querySelector:s=>s.includes('__icon')?{alt:''}:{textContent:'3 366 / 3\u00a0366'}}];assert.equal(f.combat.extraMobs()[0].cur,3366);assert.equal(f.pick().name,'Flame Strike')});
test('реальный battle сохраняет аварийный Vampiric Touch при доступном АОЕ',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const box={console,URLSearchParams,setTimeout,__dirname:__dirname,module:{exports:{}},require:n=>n==='node:test'?()=>{}:require(n)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'v1015-vampiric-decision.test.js'),'utf8'),box);
 const f=box.module.exports.setup({hero:2000,heal:900,pot:true,mob:500,kill:true,limit:1});
 const flame={title:'Flame Strike',getAttribute:()=>null};f.slots.push(flame);
 f.env.rt.skills['flame strike']={dmg:21264*3,dmgN:3,aoe:1,spl:42528,splN:1};
 const q=f.env.$q,il=f.env.ilOf;f.env.$q=s=>s==='#battle-whirlwind-extras'?{textContent:'A 3366/3366 B 3828/3828'}:q(s);
 f.env.ilOf=b=>b===flame?{c:'Маг. атака',t:'MDAM',mp:38}:il(b);
 await f.combat.battle();assert.equal(f.calls[0].name,'Vampiric Touch');
});

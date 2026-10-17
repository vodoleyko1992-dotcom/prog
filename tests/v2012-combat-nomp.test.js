'use strict';
// 20.12 (ревизия 17.10, аудит combat/C1): MP ниже цены выбранного баффа → act() отвечал 'lock', ветка делала continue без паузы,
// цикл боя крутился на микрозадачах (вкладка замирала, банки HP не пились). Теперь выбор проверяет ту же actionMp(), act() отвечает
// 'nomp' (слот на паузе), а каждый круг цикла гарантированно уступает макрозадаче.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const {flowFixture}=require('./warlock-combat-fixture.cjs');
function frenzyFixture(){
 const f=flowFixture('fighter'),frenzy={title:'Frenzy',getAttribute:()=>null},pot={title:'Зілля лікування',getAttribute:()=>null};
 f.slots.push(frenzy);
 Object.assign(f.env.cfg,{nKeyBuffs:'frenzy',nBuffs:'',stopHp:25});
 f.env.rt.skillDb={frenzy:{mp:20,mpKnown:true}};
 const il=f.env.ilOf,kind=f.env.slotKind,action=f.env.slotAction;
 f.env.ilOf=b=>b===frenzy?{id:176,pc:{hp:30},t:'BUFF'}:il(b);
 f.env.slotKind=b=>b===pot?'предмет':kind(b);
 f.env.slotAction=b=>b===frenzy?'l2_176':b===pot?'battle_potion_use':action(b);
 f.env.HP_POT_RE=/лікування|healing/i;f.env.buffActive=()=>false;f.env.hpPotPick=()=>pot;f.env.hpPots=()=>[pot];f.env.qty=()=>5;
 f.env.meHp=()=>({cur:200,max:1000,pct:20});f.env.meMp=()=>({cur:5,max:500,pct:1});
 return {...f,frenzy,pot};
}
test('HP 20 %, MP ниже цены Frenzy: бафф не выбирается, бот пьёт банку HP',async()=>{
 const f=frenzyFixture();
 try{await f.combat.battle();}catch(e){if(e.message!=='bounded-loop')throw e;}
 assert.ok(f.events.includes('Зілля лікування'),'банка HP выпита: '+JSON.stringify(f.events));
 assert.ok(!f.events.includes('Frenzy'));
});
test('act() при нехватке MP отвечает nomp, а не lock, и держит слот',async()=>{
 const f=frenzyFixture();let mpNow=500;f.env.meMp=()=>({cur:mpNow,max:500,pct:mpNow/5});
 // выбор видит достаточно MP, а к моменту клика (после gameFree) MP упал
 f.env.gameBusy=()=>{mpNow=5;return {busy:false,end:0};};
 try{await f.combat.battle();}catch(e){if(e.message!=='bounded-loop')throw e;}
 assert.ok(!f.events.includes('Frenzy'));
 assert.ok((f.combat.lostUntil.get('frenzy')||0)>Date.now(),'слот Frenzy на паузе после nomp');
});
test('исходник: act() возвращает nomp на проверке MP',()=>{
 const s=fs.readFileSync(root+'/modules/combat.js','utf8');
 assert.match(s,/!affordable\(b, env\.meMp\(\), 0\)\) \{[^\n]*return 'nomp'; \}/);
});
test('цикл боя уступает макрозадаче, даже если ветка делает continue без таймера',async()=>{
 const f=flowFixture('fighter');let macro=false,seenAfter=0,ticks=0;
 f.env.sleep=ms=>new Promise(r=>setTimeout(r,Math.min(ms,5)));
 f.env.spoilStep=async()=>true;               // модуль, сразу вернувший true без единого таймера
 setTimeout(()=>{macro=true;},0);
 f.env.antibotState=()=>{ticks++;if(macro)seenAfter++;if(ticks>30)throw Error('bounded-loop');return false;};
 try{await f.combat.battle();}catch(e){if(e.message!=='bounded-loop')throw e;}
 assert.ok(seenAfter>0,'за 30 кругов цикла не прошло ни одной макрозадачи');
});

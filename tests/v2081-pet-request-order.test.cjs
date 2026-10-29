'use strict';
// 20.81 (ревью раннего перепризыва): поздний GET до призыва не доказывает новую смерть кота.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),combat=fs.readFileSync(path.join(__dirname,'../modules/combat.js'),'utf8');
const petStart=core.indexOf('let PET = null;'),petEnd=core.indexOf('\n',core.indexOf('const petState = () =>',petStart));
const charLine=core.split('\n').find(l=>l.includes('const s = d.pet.activeSummon; petSet('));
const battleStart=core.indexOf('// 7.1.16-fix: слуга мага — из ответа сервера'),battleEnd=core.indexOf('// v5.5.1: темп обычной атаки',battleStart);
const stepStart=combat.indexOf('  async function petStep('),stepEnd=combat.indexOf('\n  // шаг: лечение скиллом',stepStart);
function fixture({store=new Map(),at=1000000000,rt={}}={}){
 let now=at,calls=0;const slot={title:'Summon Kai the Cat'},live={key:'kai_the_cat',hp:2599,maxHp:2599};
 const ctx={petChecked:true,block:{},pet:{alive:false,summons:0,deaths:0},rebirth:{role:'raid'}};
 const env={cfg:{petAuto:true},rt:{char:'Hero',petSummonT:now-5000,petSummonOkT:now-5000,...rt},SLOT:'.slot',slotKind:()=> 'скилл',
  cleanTitle:s=>s,skillMp:()=>20,setRt:p=>{Object.assign(env.rt,p);return Promise.resolve();},rec:()=>{},antibotState:()=>false,
  waitFor:async fn=>fn(),crafterKit:{noSummon:()=>false}};
 const box={env,ctx,rt:env.rt,Date:{now:()=>now},heroNick:()=> 'Hero',tabOwner:true,setRt:env.setRt,quietErr:()=>{},
  sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
  document:{querySelectorAll:()=>[slot]},summonCombat:()=>true,raidTarget:()=>true,slotsBy:()=>[],servitorSummonSlot:()=>true,
  petPick:s=>s[0],ready:()=>true,affordable:()=>true,petKeyOf:s=>s.toLowerCase().replaceAll(' ','_'),NEXT:'next',AGAIN:'again'};
 vm.createContext(box);
 vm.runInContext(core.slice(petStart,petEnd)+'\nthis.petState=petState;\nthis.applyCharacter=(d,netContext)=>{'+charLine+'};\nthis.applyBattle=(path,d,netContext)=>{'+core.slice(battleStart,battleEnd)+'};',box);
 env.petState=()=>box.petState();
 const receive=(source,started,pet=null)=>{
  if(source==='character')box.applyCharacter({pet:{name:'Hero',revision:1,activeSummon:pet}},{at:started});
  else box.applyBattle('/game/battle/'+(source==='battle-flat'?'sync':'action'),{
   res:source==='battle-full'?{battle:{activeSummon:pet}}:source==='battle-flat'?{activeSummon:pet}:{delta:{activeSummon:pet}}
  },{at:started});
 };
 box.act=async(b,label,hp,needed)=>{if(needed&&!needed())return'lock';calls++;receive('battle-delta',now,live);return true;};
 vm.runInContext(combat.slice(stepStart,stepEnd)+'\nthis.step=petStep;',box);
 return{env,store,receive,step:()=>box.step(null,{cur:1000}),tick:ms=>{now+=ms;},now:()=>now,calls:()=>calls,pet:()=>box.petState()};
}
for(const source of ['character','battle-delta','battle-full','battle-flat'])test(`${source}: поздний запрос до успешного призыва не повторяет его; новый запрос позволяет`,async()=>{
 const f=fixture();f.receive('character',f.now()-100);await f.step();assert.equal(f.calls(),1);assert.equal(f.pet().has,true);
 const summoned=f.env.rt.petSummonOkT;f.tick(2500);f.receive(source,summoned-4000);
 assert.equal(f.pet().has,false);assert.equal(f.pet().requestStartedAt,summoned-4000,'сохраняется начало запроса, а не только время прихода');
 await f.step();assert.equal(f.calls(),1,'поздний старый ответ не доказывает новую смерть');
 f.receive(source,f.now()-10);await f.step();assert.equal(f.calls(),2,'после нового запроса отсутствие доказано заново');
});
test('перенос PET через sessionStorage сохраняет причинную метку и запрет позднего старого ответа',async()=>{
 const f=fixture();f.receive('character',f.now()-100);await f.step();const summoned=f.env.rt.petSummonOkT;
 f.tick(2500);f.receive('character',summoned-4000);
 const r=fixture({store:f.store,at:f.now(),rt:{...f.env.rt}});
 assert.equal(r.pet().requestStartedAt,summoned-4000);await r.step();assert.equal(r.calls(),0);
 r.receive('character',r.now()-10);await r.step();assert.equal(r.calls(),1);
});

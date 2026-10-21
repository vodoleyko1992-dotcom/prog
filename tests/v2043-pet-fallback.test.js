'use strict';
// 20.43 (лог 21.10 15:49–15:50): запасной путь в бою — свежие данные о коте (delta, GET /character, перенос dungeon→battle),
// призыв первым действием, баффы кота в том же бою, без повтора баффов, поставленных вне боя.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict'),root=path.resolve(__dirname,'..');
const content=fs.readFileSync(root+'/content.js','utf8'),combatSrc=fs.readFileSync(root+'/modules/combat.js','utf8');
const box={console,URLSearchParams,setTimeout,__dirname:root+'/tests',module:{exports:{}},require:n=>n==='node:test'?()=>{}:require(n)};
vm.runInNewContext(fs.readFileSync(root+'/tests/v1014-combat-outcomes.test.js','utf8')+'\nmodule.exports={flowFixture};',box);
const W=require('./warlock-fixture.cjs');
let passed=0;const run=(n,f)=>{f();passed++;console.log('PASS '+n)};
// Блок PET из content.js — в отдельном контексте со своим sessionStorage.
function petBlock(nick,store=new Map()){
 const src=content.slice(content.indexOf('let PET = null;'),content.indexOf('const petState = () =>'))+content.slice(content.indexOf('const petState = () =>'),content.indexOf('\n',content.indexOf('const petState = () =>')));
 const sb={Date,JSON,Number,rt:{char:nick()},heroNick:nick,sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)}};
 vm.createContext(sb);vm.runInContext(src+';this.petSet=petSet;this.petState=petState;',sb);return {sb,store};
}
run('ответ хода: activeSummon из delta обновляет кота',()=>{
 assert.ok(content.includes("d.res.delta && typeof d.res.delta === 'object' && 'activeSummon' in d.res.delta ? d.res.delta : d.res"));
 const m=content.match(/const src = (d\.res\.battle[^\n]+?);\n/);assert.ok(m);
 const pick=d=>vm.runInNewContext(m[1],{d});
 assert.equal(pick({res:{delta:{activeSummon:null},battle:{}}}).activeSummon,null);
 assert.equal(pick({res:{battle:{activeSummon:{key:'k'}},delta:{activeSummon:null}}}).activeSummon.key,'k','полный battle важнее');
 assert.equal('activeSummon' in pick({res:{delta:{}}}),false);
});
run('собственный GET /character игры — свежий источник кота',()=>{
 const h=content.slice(content.indexOf('// 20.43: собственный GET /character игры'));
 assert.ok(/d\.pet\.activeSummon !== undefined\) \{\n\s+const s = d\.pet\.activeSummon; petSet\(\{ t: Date\.now\(\), has: !!s && \+s\.hp > 0/.test(h));
});
run('кот переносится через sessionStorage dungeon→battle: свежий и того же героя',()=>{
 let nick='hero';const a=petBlock(()=>nick);a.sb.petSet({t:Date.now(),has:false,key:'',hp:0,maxHp:0});
 const b=petBlock(()=>nick,a.store);assert.equal(b.sb.petState().has,false);
 const c=petBlock(()=>'other',a.store);assert.equal(c.sb.petState(),null,'чужой герой');
 const old=JSON.parse(a.store.get('l2bot.pet'));old.t-=11000;a.store.set('l2bot.pet',JSON.stringify(old));
 assert.equal(petBlock(()=>nick,a.store).sb.petState(),null,'старше 10 с');
 nick='';const e=petBlock(()=>nick,new Map([['l2bot.pet',JSON.stringify({t:Date.now(),has:true,char:'hero'})]]));assert.equal(e.sb.petState(),null);nick='hero';assert.equal(e.sb.petState().has,true,'имя появилось — восстановили');
 assert.ok(content.includes("const classSwitched = () => { PET = null; petRestored = true; try { sessionStorage.removeItem('l2bot.pet'); } catch (e) {} };"));
});
run('бой: призыв кота раньше включения зарядов',()=>{
 const loop=combatSrc.slice(combatSrc.indexOf('if ((s = await exitCheckStep(me, mob))'));
 const p=loop.indexOf('if ((s = await petStep(me, mp)) !== NEXT)'),k=loop.indexOf('await env.keepShots();'),st=loop.indexOf('if ((s = await stallStep(me, mob))');
 assert.ok(st>=0&&st<p&&p<k);assert.ok(loop.indexOf('if ((s = await healStep(me, mp))')>k);
 assert.ok(combatSrc.includes('env.rt.petSummonOkT = env.rt.petBornT = Date.now(); env.setRt({ petBornT: env.rt.petBornT, petSummonOkT: env.rt.petSummonOkT })'));
 const death=combatSrc.split('\n').find(l=>l.includes('ctx.pet.deaths++'));assert.ok(death&&death.includes('petBornT')&&!death.includes('petSummonOkT'),'смерть пишет только petBornT');
 assert.ok(combatSrc.includes('born = +env.rt.petSummonOkT || 0'));
});
function fx(o={}){
 // Слот фикстуры «Summon Feline Queen» играет роль Warrior Servitor (l2_1346): проверка не завязана на 1331.
 const f=box.module.exports.flowFixture('pet'),w=W.fixture({rt:o.rt});f.env.warlock=w.api();f.env.cfg.nPetBuffs='Summon Feline Queen';f.env.cfg.petBuffAuto=true;
 f.env.slotAction=s=>s.title==='Summon Feline Queen'?'l2_1346':'other';
 return {f,w,pick:()=>f.combat.petBuffPick({block:{}},{pct:100},{cur:10000},{cur:100000})};
}
run('после принятого призыва кот считается живым: баффы в этом же бою',()=>{
 const x=fx();x.f.env.petState=()=>({t:Date.now()-500,has:false});x.f.env.rt.petSummonOkT=Date.now();
 assert.equal(x.pick()?.n?.toLowerCase(),'summon feline queen');
 x.f.env.rt.petSummonOkT=Date.now()-1000;assert.equal(x.pick(),null,'«кота нет» новее призыва — баффа нет');
});
run('ревью 20.43: смерть кота в бою (petBornT новее «кота нет») — кот не считается живым',()=>{
 const x=fx();x.f.env.petState=()=>({t:Date.now()-500,has:false});x.f.env.rt.petBornT=Date.now();x.f.env.rt.petSummonOkT=Date.now()-60000;
 assert.equal(x.pick(),null,'мёртвому коту бафф не ставится');
});
run('бафф, поставленный вне боя, по свежему снимку не повторяется',()=>{
 const x=fx();x.f.env.petState=()=>({t:Date.now(),has:true,key:'kai_the_cat',hp:3000,maxHp:6500});
 x.f.env.rt.petRaidSkills={char:'hero',rows:[{effectId:1346,name:'Summon Feline Queen'}]};
 x.w.ch.activeSummon.activeBuffs=[{skillId:1346,level:1,expiresAtMs:x.w.now()+120000}];x.w.api().noteSnapshot(x.w.ch);
 assert.equal(x.pick(),null);
 x.w.ch.revision++;x.w.ch.activeSummon.activeBuffs=[];x.w.api().noteSnapshot(x.w.ch);assert.equal(x.pick()?.n?.toLowerCase(),'summon feline queen','нет эффекта — бафф ставится');
});
console.log(passed+' сценариев PASS');

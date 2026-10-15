'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync(__dirname+'/../content.js','utf8');
function fixture(){
 const box={rt:{skills:{}},fightDmg:()=>null,powerOf:k=>k==='blaze'?100:0};
 vm.runInNewContext(s.slice(s.indexOf('function damageSkill('),s.indexOf('function skillMp('))+s.slice(s.indexOf('function powerK('),s.indexOf('// «цена» действия'))+s.slice(s.indexOf('function damageSample('),s.indexOf('let lastObserve = 0;')),box);return box;
}
test('legacy inflated skill averages never feed prediction or power scaling; history survives',()=>{
 const f=fixture(),old={dmg:9000000,dmgN:9,uses:100,unknown:2,spl:800000,splN:9,usesU:3,cd:2};
 f.rt.skills={'атака':{...old},blaze:{...old}};
 assert.equal(f.expDmg('атака'),600);assert.equal(f.expDmg('blaze'),720);assert.equal(f.powerK(),0);
 const view=f.damageSkills().blaze;assert.equal(view.dmgN,0);assert.equal(view.uses,0);assert.equal(view.cd,2);assert.equal(view.usesU,3);
 f.damageSample(f.rt.skills.blaze,100,true,50);f.damageSample(f.rt.skills.blaze,200,true,100);
 assert.equal(f.expDmg('blaze'),150);assert.equal(f.powerK(),1.5);assert.equal(f.rt.skills.blaze.dmg,old.dmg);
 assert.equal(f.damageSkills().blaze.spl/f.damageSkills().blaze.splN,75);
 const reload=fixture();reload.rt=JSON.parse(JSON.stringify(f.rt));assert.equal(reload.expDmg('blaze'),150);
});
test('unknown samples cannot become zero damage/no-effect; confirmed miss remains distinguishable',()=>{
 const f=fixture(),p={dmg:900000,dmgN:10,uses:90};f.rt.skills.blaze=p;
 for(let i=0;i<6;i++)f.damageSample(p,0,false,null);
 const view=f.damageSkills().blaze;assert.equal(view.dmgN,0);assert.equal(view.uses-view.unknown,0);assert.equal(f.expDmg('blaze'),720);
 f.damageSample(p,0,true,null);assert.equal(f.damageSkills().blaze.uses-f.damageSkills().blaze.unknown,1);
 f.damageSample(p,4620,true,null);assert.equal(f.expDmg('blaze'),4620,'raw genuine overkill remains raw, not invented HP delta');
});
test('cohort rolling average and version gate do not mutate lifetime totals',()=>{
 const f=fixture(),p={dmg:123456,dmgN:50,damageEvidence:{v:0,dmg:999999,dmgN:100,uses:100}};f.rt.skills.blaze=p;
 assert.equal(f.expDmg('blaze'),720);for(let i=0;i<61;i++)f.damageSample(p,100,true,null);
 assert.equal(f.expDmg('blaze'),100);assert.equal(p.damageEvidence.dmgN,40);assert.equal(p.dmg,123456);
});

test('current fight fallback cannot carry damage across owner epoch on same URL',()=>{
 const f=fixture();f.location={search:'?spawnId=same'};f.leaseEpoch='lease1';
 vm.runInNewContext(s.slice(s.indexOf('let fightLearn ='),s.indexOf('// КД скилла —'))+s.slice(s.indexOf('function observeOwner()'),s.indexOf('function damageSample(')),f);
 f.fightNote('blaze',12345);f.fightNote('blaze',12345);assert.equal(f.expDmg('blaze'),12345);
 f.rt.classSwT=1;assert.equal(f.expDmg('blaze'),720);f.fightNote('blaze',100);f.fightNote('blaze',100);assert.equal(f.expDmg('blaze'),100);
 f.leaseEpoch='lease2';assert.equal(f.expDmg('blaze'),720);
});
test('real mage selection ignores legacy damage/uses, then honors fresh confirmed no-effect evidence',()=>{
 const {flowFixture}=require('./warlock-combat-fixture.cjs'),f=flowFixture('mage'),c=fixture();
 f.env.rt.skills.blaze={dmg:9999999,dmgN:30,uses:100,unknown:0};c.rt=f.env.rt;
 Object.defineProperty(f.env,'damageSkills',{get:()=>c.damageSkills()});f.env.expDmg=c.expDmg;
 assert.ok(f.combat.mageSpellSlots().some(b=>b.title==='Blaze'),'cleared old damage does not combine with legacy uses to blacklist Blaze');
 for(let i=0;i<6;i++)c.damageSample(f.env.rt.skills.blaze,0,false,null);
 assert.ok(f.combat.mageSpellSlots().some(b=>b.title==='Blaze'),'unknown is not six confirmed no-effect turns');
 for(let i=0;i<5;i++)c.damageSample(f.env.rt.skills.blaze,0,true,null);
 assert.equal(f.combat.mageSpellSlots().some(b=>b.title==='Blaze'),false);
 c.damageSample(f.env.rt.skills.blaze,100,true,null);
 assert.ok(f.combat.mageSpellSlots().some(b=>b.title==='Blaze'));
});
test('shared FA buff model ignores legacy spell/crit history and learns only fresh cohorts',()=>{
 const box={};vm.runInNewContext(fs.readFileSync(__dirname+'/../buff-value.js','utf8'),box);const V=box.L2BuffVal;
 const hero={matk:6000,patk:1000,mcrit:4,mck:2,buffs:[]},rt={heroStats:hero,skills:{blaze:{name:'Blaze',dmg:9e6,dmgN:9}},critStat:{'':{n:100,c:99}}};
 const base=V.fromRt({heroStats:hero},{},{mage:true});assert.equal(V.fromRt(rt,{},{mage:true}).spell,base.spell);
 assert.equal(Object.keys(V.fromRt(rt,{},{mage:true}).critObs).length,0);
 rt.skills.blaze.damageEvidence={v:1,dmg:5000,dmgN:5};const fresh=V.fromRt(rt,{},{mage:true});assert.ok(fresh.spell<1001);
 rt.critStat=V.obsAdd(rt.critStat,[],50,5);assert.equal(rt.critStat[''].n,150);assert.equal(rt.critStat[''].evidence.n,50);
 const learned=V.fromRt(rt,{},{mage:true});assert.equal(learned.critObs[''].n,50);assert.equal(learned.critObs[''].c,5);
 const clean={...rt,skills:{blaze:{name:'Blaze',damageEvidence:{v:1,dmg:5000,dmgN:5}}}};
 const ranked = state => JSON.stringify(V.rank([1413,1357,365,1303],state));
 assert.equal(ranked(learned),ranked(V.fromRt(clean,{},{mage:true})));
});
test('critical observation accumulator cannot cross class epoch; Stop keeps own accepted evidence',()=>{
 const f=fixture();vm.runInNewContext(fs.readFileSync(__dirname+'/../buff-value.js','utf8'),f);
 f.rt.char='Hero';f.tabOwner=true;f.on=true;f.combatProfileKind=()=> 'mage_summoner';f.L2V7Modules={buffs:{hudBuffs:()=>({})}};
 const writes=[];f.setRt=p=>{writes.push(p);Object.assign(f.rt,p)};
 vm.runInNewContext(s.slice(s.indexOf('function observeOwner()'),s.indexOf('function damageSample('))+s.slice(s.indexOf('let CRIT_ACC ='),s.indexOf('// 10.0.2 (Life Stone)')),f);
 f.critNote(2,1);f.rt.classSwT=123;f.critFlush();assert.equal(writes.length,0);
 f.critNote(3,1);f.on=false;f.critFlush();assert.equal(writes.length,1);assert.equal(f.rt.critStat[''].evidence.n,3);
});
test('debuff ratios start a new cohort, preserve history, and fall back to model until six samples',async()=>{
 const {flowFixture}=require('./warlock-combat-fixture.cjs'),f=flowFixture('mage');f.env.rt.debuffGain=Array(6).fill(3.1);
 assert.equal(f.combat.debuffGain(),null);
 for(let i=0;i<6;i++){const ctx={};f.combat.spellSample(ctx,'blaze',100);ctx.spellDmg.blaze.on=[110,1];await f.combat.debuffGainFlush(ctx);}
 assert.equal(f.combat.debuffGain().ratio,1.1);assert.equal(f.combat.debuffGain().n,6);
 assert.equal(f.env.rt.debuffGain[0],3.1);assert.equal(f.env.rt.debuffEvidence.ratios[0],1.1);
 const story=fs.readFileSync(__dirname+'/../modules/story.js','utf8');
 const keys=vm.runInNewContext(story.match(/const CLASS_KEYS = (\[[\s\S]*?\]);/)[1]);
 assert.ok(keys.includes('debuffEvidence'));assert.ok(keys.includes('critStat'));
});

test('debuff evidence cannot cross actor/epoch, including switch back, but own Stop may flush',async()=>{
 const {flowFixture}=require('./warlock-combat-fixture.cjs'),f=flowFixture('mage');f.env.rt.char='HeroA';
 const make=()=>{const ctx={};f.combat.spellSample(ctx,'blaze',100);ctx.spellDmg.blaze.on=[110,1];return ctx;};
 const old=make();f.env.rt.char='HeroB';await f.combat.debuffGainFlush(old);assert.equal(f.env.rt.debuffEvidence,undefined);
 f.env.rt.char='HeroA';await f.combat.debuffGainFlush(old);assert.equal(f.env.rt.debuffEvidence,undefined,'invalid owner is sticky');
 const epoch=make();f.env.rt.classSwT=10;await f.combat.debuffGainFlush(epoch);assert.equal(f.env.rt.debuffEvidence,undefined);
 const own=make();f.env.on=false;await f.combat.debuffGainFlush(own);assert.equal(f.env.rt.debuffEvidence.ratios[0],1.1);
});

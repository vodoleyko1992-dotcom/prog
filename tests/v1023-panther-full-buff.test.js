'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {fixture}=require('./warlock-fixture.cjs');
function panther(opts={}){
 const prof=opts.prof||'human_dark_avenger',f=fixture({...opts,rt:{classCur:{prof,slot:0},...opts.rt},char:{l2Profession:prof,...opts.char}});
 Object.assign(f.ch.activeSummon,{key:'dark_panther',summonSkillId:283});return f;
}
for(const prof of ['human_dark_avenger','human_hell_knight'])test(prof+' получает полный набор один раз с подтверждённой оплатой',async()=>{
 const f=panther({prof});await f.step();assert.equal(f.calls.length,1);assert.equal(f.status(),'active');assert.equal(f.env.rt.petFull.spent,10000000);assert.equal(f.env.rt.petFull.lastReceipt.petKey,'dark_panther');f.reload();f.tick(61000);await f.step();assert.equal(f.calls.length,1);
});
test('ручной полный бафф пантеры распознаётся без повторной покупки',async()=>{
 const f=panther();f.apply();await f.step();assert.equal(f.calls.length,0);assert.equal(f.status(),'active');assert.equal(f.api().summary().spent,0);assert.equal(f.env.rt.petFull.snapshot.petKey,'dark_panther');
});
for(const gate of ['off','dead','budget','wrong-key','wrong-skill','wrong-class'])test('пантере не покупаем при '+gate,async()=>{
 const f=panther();if(gate==='off')f.env.cfg.petFullAuto=false;if(gate==='dead')f.ch.activeSummon.hp=0;if(gate==='budget')f.env.cfg.petFullBudget=0;if(gate==='wrong-key')f.ch.activeSummon.key='kai_the_cat';if(gate==='wrong-skill')f.ch.activeSummon.summonSkillId=1276;if(gate==='wrong-class')f.ch.l2Profession='dwarf_artisan';await f.step();assert.equal(f.calls.length,0);
});
test('неопределённая покупка пантере не повторяется после reload',async()=>{
 const f=panther({post:()=>{throw Error('timeout')}});await f.step();assert.equal(f.status(),'unknown');f.reload();f.tick(16000);await f.step();assert.equal(f.calls.length,1);assert.equal(f.api().summary().reserved,10000000);
});
const raidFile=path.join(__dirname,'v1021-raid-buff-order.test.js'),source=fs.readFileSync(raidFile,'utf8'),box={require:require('node:module').createRequire(raidFile),console,Date};
vm.runInNewContext(source.slice(0,source.indexOf("test('"))+'\nthis.raidFixture=fixture;',box);
test('рейд танка ждёт включённый бафф пантеры, затем продолжает',async()=>{
 const f=box.raidFixture({state:'budget'});f.env.rt.classCur.prof='human_dark_avenger';await f.R.rbHuntStep();assert.equal(f.env.rt.rbHunt.step,'pick');assert.equal(f.catCalls(),1);assert.match(f.env.rt.rbHunt.next,/бафф суммона/);f.setCat('active');await f.R.rbHuntStep();assert.equal(f.env.rt.rbHunt.step,'go');
});
test('выключенная дополнительная задача не блокирует рейд танка',async()=>{
 const f=box.raidFixture({cat:false,state:'off'});f.env.rt.classCur.prof='human_dark_avenger';await f.R.rbHuntStep();assert.equal(f.catCalls(),0);assert.equal(f.env.rt.rbHunt.step,'go');
});

test('поддержка платного баффа не требует пантеру для обычной оценки силы танка',()=>{
 const f=panther({cfg:{petFullAuto:false}});f.ch.activeSummon=null;f.api().noteSnapshot(f.ch);assert.equal(f.api().raidContext('boss',{}, {preflight:true}),null);
});

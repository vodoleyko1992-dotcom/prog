'use strict';
// 20.45 (лог 22.10 09:03, John «не взял бафф на суммона перед РБ»): Warsmith с големом из набора РБ — платный полный бафф суммона
// теперь покупается; тур РБ не ждёт вечно, если купить нельзя по правилам (бюджет/срок прошлого суммона).
const fs=require('fs'),path=require('path'),vm=require('vm'),test=require('node:test'),assert=require('node:assert/strict'),{fixture}=require('./warlock-fixture.cjs');
const golem={kind:'servitor',key:'mechanic_golem',summonSkillId:25,summonSkillLevel:4,hp:3283,maxHp:3283,activeBuffs:[]};
const smith=o=>fixture({...o,rt:{classCur:{prof:'dwarf_warsmith',slot:2}},char:{l2Profession:'dwarf_warsmith',classSlots:{activeSlot:2},activeSummon:golem,...(o?.char||{})}});
test('Warsmith с живым големом покупает полный бафф суммона один раз',async()=>{const f=smith();await f.step();assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.set,'summon');assert.equal(f.status(),'active');assert.equal(f.env.rt.petFull.lastReceipt.classKey,'2:dwarf_warsmith');assert.equal(f.env.rt.petFull.lastReceipt.petKey,'mechanic_golem')});
test('Maestro тоже поддержан, Artisan и чужой суммон — нет',async()=>{const m=smith({char:{l2Profession:'dwarf_maestro'}});m.env.rt.classCur.prof='dwarf_maestro';await m.step();assert.equal(m.calls.length,1);
 const a=smith({char:{l2Profession:'dwarf_artisan'}});await a.step();assert.equal(a.calls.length,0);assert.equal(a.status(),'class');
 const c=smith({char:{activeSummon:{...golem,key:'kai_the_cat'}}});await c.step();assert.equal(c.calls.length,0);assert.equal(c.status(),'pet')});
test('без голема покупки нет',async()=>{const f=smith({char:{activeSummon:null}});await f.step();assert.equal(f.calls.length,0);assert.equal(f.status(),'pet')});
test('перепризванный голем до конца оплаченного срока не перекупается (early-loss)',async()=>{const f=smith({cfg:{petFullBudget:30000000},char:{adena:'50000000'}});await f.step();f.tick(61000);f.ch.activeSummon.activeBuffs=[];f.ch.revision++;await f.step();assert.equal(f.calls.length,1);assert.equal(f.status(),'early-loss')});
test('fullClass: классы платного баффа',()=>{const api=fixture().api();for(const p of ['human_warlock','human_arcana_lord','dark_avenger','dwarf_warsmith','dwarf_maestro','Warsmith'])assert.equal(api.fullClass(p),true,p);for(const p of ['dwarf_artisan','dwarf_bounty_hunter','human_sorcerer',''])assert.equal(api.fullClass(p),false,p)});
// raid.js: готовность к РБ — вырезаем проверку из исходника
const src=fs.readFileSync(path.join(__dirname,'../modules/raid.js'),'utf8');
const body=src.slice(src.indexOf('const SUMMON_NO_BUY'),src.indexOf('async function huntSet'));
function ready(prof,summary,cfg={petFullAuto:true}){const env={cfg,rt:{classCur:{prof}},warlock:{raidReady:()=>true,fullClass:p=>/warsmith|maestro|warlock|arcana/.test(p),summary:()=>summary}};return vm.runInNewContext(body+';rbSummonBuffReady()',{env,Date})}
test('тур РБ ждёт бафф голема, пока его можно купить',()=>{assert.equal(ready('dwarf_warsmith',{status:'travel'}),false);assert.equal(ready('dwarf_warsmith',{status:'active',expiresAt:Date.now()+3600000}),true)});
test('тур РБ с големом идёт без баффа, если купить нельзя по правилам',()=>{for(const st of ['budget','price','reserve','renew','early-loss','archived'])assert.equal(ready('dwarf_warsmith',{status:st}),true,st)});
test('кот Warlock при бюджете ждёт, как раньше',()=>{assert.equal(ready('human_warlock',{status:'budget'}),false)});
test('без автобафа или у другого класса тур не ждёт',()=>{assert.equal(ready('dwarf_warsmith',{status:'travel'},{petFullAuto:false}),true);assert.equal(ready('dwarf_bounty_hunter',{status:'travel'}),true)});
test('подготовка тура пишет причину пропуска один раз и не держит старый список классов',()=>{assert.match(src,/полный бафф суммона не беру/);assert.doesNotMatch(src,/hell_knight\)\$\/\.test\(env\.rt\.classCur/)});
test('меню разрешает автобаф голему',()=>{const ui=fs.readFileSync(path.join(__dirname,'../warlock-ui.js'),'utf8');assert.match(ui,/warsmith\|maestro/);assert.match(ui,/голему Warsmith \/ Maestro/)});

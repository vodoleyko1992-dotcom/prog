'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
let passed=0;
const run=async(name,f)=>{await f();passed++;console.log('PASS '+name)};
function setup(o={}){
 const f=fixture({cfg:{petFullAuto:false,petAuto:true,petBuffAuto:true,nPetBuffs:'Summon Feline Queen, Warrior Servitor, Final Servitor',...o.cfg},char:{mp:5000,...o.char},rt:o.rt});
 const e=f.env;let page=o.page||'/map.html',fires=[],nav=[],cfgWrites=[],logs=[];
 e.leaseEpoch='owner';e.canRun=()=>true;e.canAct=()=>true;e.classNote=ch=>{e.rt.classCur={slot:ch.classSlots.activeSlot,prof:ch.l2Profession}};
 e.setCfg=async p=>{Object.assign(e.cfg,p);cfgWrites.push({...p})};e.setStatus=t=>logs.push(t);e.rec=(...x)=>logs.push(x.join(' '));
 const row=(id,name)=>({action:'l2_'+id,skillId:id,effectId:id===1331?4699:id,name,mp:10,ready:true,button:{id}});
 const panel={summon:row(1276,'Summon Kai the Cat'),buffs:[row(1331,'Summon Feline Queen'),row(1346,'Warrior Servitor'),row(1349,'Final Servitor')]};
 e.nativePanel=()=>panel;e.nativePanelPath=()=>page;e.nativeReturnPath=()=>page;e.nativePanelOpen=async()=>{};
 e.nativeNavigate=p=>{nav.push(p);page=p};e.nativeFire=b=>{fires.push(b.id);return true};
 return {...f,e,panel,fires,nav,cfgWrites,logs,page:()=>page,prep:()=>f.api().raidPrepare(),enable:()=>f.api().autoEnableClass(f.ch),effect:id=>{f.ch.revision++;f.ch.activeSummon.activeBuffs.push({skillId:id,level:1,expiresAtMs:f.now()+120000})}};
}
(async()=>{
 for(const prof of ['human_warlock','human_arcana_lord','warlock','arcana_lord'])await run('выбран '+prof+' — полный бафф включён без изменения бюджета',async()=>{
  const f=setup({char:{l2Profession:prof},cfg:{petFullBudget:23000000,petFullReserve:600000,petFullMaxPrice:10000000},rt:{petFull:{spent:12000000,unknownReserved:1000000,budgetEpoch:33}}});
  await f.enable();assert.equal(f.e.cfg.petFullAuto,true);assert.equal(f.e.cfg.petBuffAuto,true);assert.equal(f.e.cfg.petFullBudget,23000000);assert.equal(f.e.cfg.petFullReserve,600000);assert.equal(f.e.rt.petFull.spent,12000000);assert.equal(f.e.rt.petFull.unknownReserved,1000000);assert.equal(f.e.rt.petFull.budgetEpoch,33);
 });
 await run('прочий класс не включает и не выключает настройки',async()=>{const f=setup({char:{l2Profession:'orc_titan'}});await f.enable();assert.equal(f.cfgWrites.length,0)});
 // 23.10.2026: новое решение игрока — на котоводе выключенный автобаф снова включается при подтверждении класса.
 await run('OFF на котоводе восстанавливается при повторном GET и reload',async()=>{const f=setup();await f.enable();f.e.cfg.petFullAuto=false;f.ch.revision++;await f.enable();assert.equal(f.e.cfg.petFullAuto,true);f.e.cfg.petFullAuto=false;f.reload();await f.enable();assert.equal(f.e.cfg.petFullAuto,true);assert.equal(f.cfgWrites.length,3)});
 await run('уход с класса и возврат снова включает бафф',async()=>{const f=setup();await f.enable();f.e.cfg.petFullAuto=false;f.ch.l2Profession='orc_titan';f.ch.revision++;await f.enable();f.ch.l2Profession='arcana_lord';f.ch.revision++;await f.enable();assert.equal(f.cfgWrites.length,2)});
 await run('новый Start включает на свежем снимке того же класса',async()=>{const f=setup();await f.enable();f.e.cfg.petFullAuto=false;f.e.rt.manualKickAt=123;f.ch.revision++;await f.enable();assert.equal(f.e.cfg.petFullAuto,true)});
 await run('старый ответ cat после свежего fighter не включает бафф',async()=>{const f=setup();f.ch.revision=200;f.ch.l2Profession='orc_titan';await f.enable();f.ch.revision=199;f.ch.l2Profession='human_warlock';await f.enable();assert.equal(f.cfgWrites.length,0)});
 for(const gate of ['off','owner','name','revision'])await run('автовключение закрыто: '+gate,async()=>{const f=setup();if(gate==='off')f.e.on=false;if(gate==='owner')f.e.tabOwner=false;if(gate==='name')f.ch.name='other';if(gate==='revision')delete f.ch.revision;await f.enable();assert.equal(f.cfgWrites.length,0)});
 await run('bare cat поддержан существующей платной логикой',async()=>{const f=setup({char:{l2Profession:'arcana_lord'},cfg:{petFullAuto:true}});await f.step();assert.equal(f.calls.length,1)});
 await run('перед РБ кот сначала призывается с родной панели и подтверждается свежим GET',async()=>{
  const f=setup({char:{activeSummon:null},cfg:{petBuffAuto:false}});assert.equal(f.api().raidReady(),false);await f.prep();assert.equal(f.nav[0],'/skill-panel.html');assert.equal(f.fires.length,0);await f.prep();assert.deepEqual(f.fires,[1276]);assert.equal(f.e.rt.petRaidPrep.pending.kind,'summon');await f.prep();assert.equal(f.fires.length,1);
  // 20.43 (разбор 21.10): неподтверждённое ожидание перечитывает /character не чаще раза в 1,5 с (первые 15 с после клика)
  f.tick(1500);f.ch.revision++;f.ch.activeSummon={kind:'servitor',key:'kai_the_cat',summonSkillId:1276,summonSkillLevel:10,hp:100,activeBuffs:[]};await f.prep();assert.equal(f.page(),'/map.html');assert.equal(f.e.rt.petRaidPrep,null);assert.equal(f.api().raidReady(),true);assert.equal(f.calls.length,0);
 });
 await run('три собственных баффа — каждый строго после подтверждения предыдущего',async()=>{
  const f=setup();await f.prep();await f.prep();assert.deepEqual(f.fires,[1331]);f.effect(4699);await f.prep();assert.deepEqual(f.fires,[1331,1346]);f.effect(1346);await f.prep();assert.deepEqual(f.fires,[1331,1346,1349]);f.effect(1349);await f.prep();assert.equal(f.api().raidReady(),true);assert.equal(f.page(),'/map.html');assert.equal(f.calls.length,0);
 });
 await run('Queen героя не подменяет отсутствующий бафф кота',async()=>{const f=setup({char:{activeBuffs:[{skillId:4699,expiresAtMs:1792009999999}]}});await f.prep();await f.prep();assert.deepEqual(f.fires,[1331])});
 await run('native OFF не покупает полный платный набор',async()=>{const f=setup({cfg:{petBuffAuto:false,petFullAuto:false}});assert.equal(await f.prep(),false);assert.equal(f.api().raidReady(),true);assert.equal(f.calls.length,0);assert.equal(f.fires.length,0)});
 // 20.43 (разбор 21.10): до 2 мин без подтверждения — без повтора и после reload/нового Start; один повтор после 2 мин — tests/v2043-warlock-raid-prep.test.js
 await run('неизвестный native после reload/нового Start в пределах 2 мин не повторяется',async()=>{const f=setup();await f.prep();await f.prep();f.reload();f.e.rt.manualKickAt=777;await f.prep();assert.deepEqual(f.fires,[1331]);assert.equal(f.e.rt.petRaidPrep.pending.skillId,1331);f.tick(1500);f.effect(4699);await f.prep();assert.deepEqual(f.fires,[1331,1346])});
 await run('Stop между свежим GET и родным кликом запрещает действие',async()=>{const f=setup({page:'/skill-panel.html'});f.e.nativePanelOpen=async()=>{f.e.on=false};await f.prep();assert.equal(f.fires.length,0)});
 await run('недостаток MP/откат/неполная панель ждёт до клика',async()=>{for(const kind of ['mp','cd','incomplete']){const f=setup({page:'/skill-panel.html'});if(kind==='mp')f.ch.mp=0;if(kind==='cd')f.panel.buffs[0].ready=false;if(kind==='incomplete')f.panel.incomplete=true;await f.prep();assert.equal(f.fires.length,0)}});
 await run('потеря конкретной кнопки до fire снимает точно не отправленную попытку',async()=>{const f=setup({page:'/skill-panel.html'});let n=0;f.e.nativePanel=()=>++n===1?f.panel:{...f.panel,buffs:[]};await f.prep();assert.equal(f.fires.length,0);assert.equal(f.e.rt.petRaidPrep.pending,null)});
 await run('свежий GET после перезагрузки подтверждает баффы без новой поездки',async()=>{const f=setup();await f.prep();for(const id of [4699,1346,1349])f.effect(id);await f.prep();f.reload();assert.equal(f.api().raidReady(),false);assert.equal(await f.prep(),false);assert.equal(f.api().raidReady(),true);assert.equal(f.nav.length,2)});
 await run('смена персонажа не наследует номер ревизии старого',async()=>{const f=setup();f.ch.revision=1000;await f.enable();f.e.rt.char='second';f.ch.name='second';f.ch.revision=1;await f.enable();assert.equal(f.cfgWrites.length,2)});
 await run('новый ответ класса во время записи исключает старый marker',async()=>{const f=setup();let release;f.e.setCfg=()=>new Promise(r=>release=r);const p=f.enable();f.ch.l2Profession='orc_titan';f.ch.revision++;await f.enable();release();await p;assert.equal(f.e.rt.petClassEntry,undefined)});
 await run('прерванная РБ-задача уступает основному режиму',async()=>{const f=setup();await f.prep();f.e.raidWanted=()=>false;assert.equal(await f.prep(),false);assert.equal(f.fires.length,0)});
 await run('нет petAuto — native вызов закрыт',async()=>{const f=setup({cfg:{petAuto:false},char:{activeSummon:null}});assert.equal(await f.prep(),false);assert.equal(f.nav.length,0)});
 await run('удержание или неизвестная попытка ЛС исключают native подготовку РБ',async()=>{for(const autoLs of [{hold:true,status:'running'},{hold:false,pending:{id:'ls-unknown'}}]){const f=setup({char:{activeSummon:null},rt:{autoLs}});assert.equal(await f.prep(),false);assert.equal(f.nav.length,0);assert.equal(f.fires.length,0);assert.equal(f.e.rt.petRaidPrep,undefined)}});
 await run('ЛС начат во время GET героя: поздняя подготовка кота не меняет страницу',async()=>{const f=setup({char:{activeSummon:null}}),get=f.e.gameGet;f.e.gameGet=async p=>{const r=await get(p);if(p==='/character')f.e.rt.autoLs={hold:true,status:'running'};return r};await f.prep();assert.equal(f.nav.length,0);assert.equal(f.fires.length,0);assert.equal(f.e.rt.petRaidPrep,undefined)});
 await run('ЛС начат во время открытия native панели: призыв не нажимается',async()=>{const f=setup({page:'/skill-panel.html',char:{activeSummon:null}});f.e.nativePanelOpen=async()=>{f.e.rt.autoLs={hold:true,status:'running'}};await f.prep();assert.equal(f.nav.length,0);assert.equal(f.fires.length,0);assert.equal(f.e.rt.petRaidPrep.pending,null)});
 await run('платный полный бафф кота также уступает серии и pending ЛС',async()=>{for(const autoLs of [{hold:true,status:'running'},{hold:false,pending:{id:'ls-unknown'}}]){const f=setup({cfg:{petFullAuto:true},rt:{autoLs}});await f.step();assert.equal(f.calls.length,0,'платный набор не запускается поверх ЛС');assert.equal(f.nav.length,0);assert.equal(f.fires.length,0)}});
 // Порядок интеграции: native подготовка раньше paid step и открытия боя; незавершённая поездка — раньше остальных сервисов.
 const raid=fs.readFileSync(path.join(__dirname,'../modules/raid.js'),'utf8'),content=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8');
 const beforeFull=raid.indexOf('await env.warlock?.step?.({ forceRead: true })');assert(beforeFull>0);assert(raid.lastIndexOf('await env.warlock?.raidPrepare?.()',beforeFull)>0);
 const go=raid.slice(raid.indexOf("if (H.step === 'go')"),raid.indexOf("if (H.step === 'arrive')"));assert(go.indexOf('await env.warlock?.raidPrepare?.()')>=0);assert(go.indexOf('await env.warlock?.raidPrepare?.()')<go.indexOf('!rbSummonBuffReady()'));
 // 20.43: ожидание подготовки уступает TvT (idleTvtBreak), порядок раньше заточки прежний
 const prepAt=content.indexOf('rt.petRaidPrep && !idleTvtBreak() && await L2V7Modules.warlock.raidPrepare()');assert(prepAt>0&&prepAt<content.indexOf('await enchantModePause();'));
 console.log(passed+' сценариев PASS');
})().catch(e=>{console.error(e);process.exitCode=1});

'use strict';
// 14.10: команды настоящего popup при off; никакого аккаунта/сетевых мутаций.
const {harness,until,delay}=require('./v1014-core-lifecycle-browser.cjs'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
(async()=>{const h=await harness();try{
 // 15.10: предложение изученного удара требует новой подтверждённой выборки; старые dmgN остаются только историей.
 await h.sw.evaluate(async()=>{const {rt,cfg}=await chrome.storage.local.get(['rt','cfg']);await chrome.storage.local.set({cfg:{...cfg,nPower:'',nMpPot:'',nHpPot:'',faBuffs:''},rt:{...rt,_src:'menu',panel:[{idx:0,kind:'скилл',name:'Audit Spell',title:'Audit Spell',img:''},{idx:1,kind:'предмет',name:'Audit Mana',title:'Mana potion',img:''},{idx:2,kind:'предмет',name:'Audit Healing',title:'Healing potion',img:''}],skills:{'audit spell':{dmgN:3,dmg:3000,damageEvidence:{v:1,dmgN:3,dmg:3000,uses:3,unknown:0}}},faCat:{900001:{name:'Audit FA One',cost:1},900002:{name:'Audit FA Two',cost:2}}},learn:{t0:Date.now(),pages:{map:{n:1,tok:{}}},sel:{},api:{},changes:[]}})});
 // 10.0.17: внешний снимок не наследует _src вкладки — иначе её обработчик справедливо игнорирует собственное эхо.
 await until(()=>h.g.core('rt.panel?.[0]?.name==="Audit Spell"'));
 await h.popup.reload();await until(()=>h.popup.evaluate(()=>!!document.querySelector('#suggest')?.onclick));
 await h.click('check');await until(()=>h.popup.locator('#slots').textContent().then(t=>/страницу боя/.test(t)));
 await h.click('suggest');await until(()=>h.popup.locator('#slots').textContent().then(t=>t.includes('Audit Spell')),30000);assert.equal((await h.get(['cfg'])).cfg.nPower,'','suggest remains reviewable before Apply');
 await h.click('apply');await until(async()=> (await h.get(['cfg'])).cfg.nPower==='Audit Spell');const roles=(await h.get(['cfg'])).cfg;assert.equal(roles.nMpPot,'Audit Mana');assert.equal(roles.nHpPot,'Audit Healing');assert.equal((await h.get(['on'])).on,false);console.log('PASS off panel report → real core suggestion → explicit Apply sets learned skill and potion roles');
 for(const id of ['900001','900002']){await h.popup.evaluate(id=>document.querySelector('#faPick').value=id,id);await h.click('faAdd');await until(async()=>String((await h.get(['cfg'])).cfg.faBuffs).includes(id));}
 // storage уже записан, но перерисовка popup намеренно отложена до 350 мс.
 await until(()=>h.popup.locator('#faList [data-fa-up="1"]').count());
 await h.popup.evaluate(()=>document.querySelector('#faList [data-fa-up="1"]').click());await until(async()=>String((await h.get(['cfg'])).cfg.faBuffs).replace(/\s/g,'')==='900002,900001');
 await until(()=>h.popup.locator('#faList').textContent().then(t=>t.indexOf('Audit FA Two')<t.indexOf('Audit FA One')));
 await h.popup.evaluate(()=>document.querySelector('#faList [data-fa-del="1"]').click());await until(async()=>String((await h.get(['cfg'])).cfg.faBuffs).replace(/\s/g,'')==='900002');console.log('PASS FA add/reorder/remove updates selected list while off without buying');
 const before=h.g.p.url();
 for(const [button,key] of [['faScanBtn','faScan'],['bagCheck','bagCheck'],['farmScan','farmScan'],['zoneScan','zoneScan'],['recipeScan','recipeScan'],['epicScan','epicScanReq'],['mmPoll','mmPollReq'],['mmGuideNow','farmGuideReq']]){
  await h.click(button);await until(async()=>!!(await h.get(['rt'])).rt[key]);assert.equal((await h.get(['on'])).on,false);assert.equal(h.g.p.url(),before);console.log('PASS off request queued',button);
 }
 // Старое управление кампанией скрыто в пользу разрешённых задач; проверяем только совместимость обработчика.
 assert.equal(await h.popup.locator('#campNow').isVisible(),false);
 await h.popup.evaluate(()=>document.querySelector('#campNow').click());
 await until(async()=>!!(await h.get(['rt'])).rt.campaignDue);assert.equal((await h.get(['on'])).on,false);assert.equal(h.g.p.url(),before);console.log('PASS hidden legacy campaign handler queues request without starting loop');
 await h.g.p.reload();await until(()=>h.g.core('typeof on!=="undefined"'));await delay(600);const queued=await h.get(['on','rt']);assert.equal(queued.on,false);assert.equal(queued.rt.faScan,true);assert.equal(queued.rt.recipeScan,true);assert.equal(h.g.p.url(),before);console.log('PASS queued read-only requests survive reload without starting loop');
 const download=async id=>{const pending=h.popup.waitForEvent('download');await h.click(id);const d=await pending;return fs.readFile(await d.path(),'utf8')};
 const report=await download('learnReport');assert.ok(report.includes('AuditHero'));assert.ok(report.includes('Настройки'));console.log('PASS actual learning report download while off');
 await h.g.p.evaluate(()=>{const input=document.createElement('input');input.type='password';input.value='synthetic-page-secret';input.setAttribute('value','synthetic-page-secret');document.body.append(input)});
 const dom=await download('recDom');assert.ok(dom.includes('map-mob-list'));assert.equal(dom.includes('synthetic-page-secret'),false);console.log('PASS current page snapshot while off strips password input value');
 assert.equal(h.requests.some(r=>r.method!=='GET'),false);assert.deepEqual(h.errors,[]);
}finally{await h.ctx.close()}})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});

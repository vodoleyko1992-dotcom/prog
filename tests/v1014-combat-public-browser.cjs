'use strict';
// 14.10: публичные JS игры → настоящий DOM Chromium → logLines ядра → боевые модули.
// Без аккаунта/cookie. Для офлайн-повтора: L2_PUBLIC_ASSETS=/путь/к/публичным/js.
// source /workspace/.local/l2tools/env.sh; NODE_USE_ENV_PROXY=1 node tests/v1014-combat-public-browser.cjs
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/opt/node-tools/node_modules/playwright');
const root=path.join(__dirname,'..'),names=['battle-log-uk-to-ru','battle-log-presentation','battle-log-row-layout','battle-log-reward-renderer','common'];
async function publicSource(name){
 if(process.env.L2_PUBLIC_ASSETS)return fs.readFileSync(path.join(process.env.L2_PUBLIC_ASSETS,name+'.js'),'utf8');
 const r=await fetch('https://l2wap.com/'+name+'.js',{headers:{'User-Agent':'Mozilla/5.0 L2BotPublicContractTest'},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error(name+': HTTP '+r.status);return r.text();
}
(async()=>{
 const source=Object.fromEntries(await Promise.all(names.map(async name=>[name,await publicSource(name)])));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM,args:['--no-sandbox']});
 try{
 const page=await browser.newPage();await page.setContent('<div id="battle-log"></div><div id="l2-pvp-incoming"><span id="l2-pvp-incoming-nick"></span><button id="l2-pvp-incoming-attack"></button></div>');
 for(const name of names.filter(x=>x!=='common'))await page.addScriptTag({content:source[name]});
 const core=fs.readFileSync(path.join(root,'content.js'),'utf8'),a=core.indexOf('function logLines()'),b=core.indexOf('function newLines(',a);assert.ok(a>=0&&b>a);
 await page.addScriptTag({content:'const $q=s=>document.querySelector(s), heavyPage=()=>false;'+core.slice(a,b)});
 const ca=source.common.indexOf('applyPvpIncoming: function')+'applyPvpIncoming: '.length,cb=source.common.indexOf('\n\n    /**',ca);assert.ok(ca>24&&cb>ca);
 await page.addScriptTag({content:'var global=window,pvpIncomingAttackInFlight=false;function trUi(k,v){return v};window.applyPublicIncoming='+source.common.slice(ca,cb).trim().replace(/,$/,'')+';'});
 for(const name of ['fightlab','raid','loot','enemies'])await page.addScriptTag({path:path.join(root,'modules',name+'.js')});
 const result=await page.evaluate(async()=>{
  window.L2={getUiLang:()=> 'ru',normalizePvpIncomingList:x=>x};
  const raw=['[Verfa] вдарив тебе: −250 HP.','Крит! [Verfa] завдав тобі −700 HP.','[Verfa] −300 HP.'],box=document.querySelector('#battle-log');
  const layout=L2BattleLogRowLayout.create({document}),reward=L2BattleLogRewardRenderer.create({document});
  for(const line of raw)layout.appendMobHitLogRow(box,L2BattleLogPresentation.formatBattleLogDisplayLine(line,{mobName:'Verfa',playerName:'Hero'}),'log-enemy-damage','12:00:00');
  reward.tryRenderEarly(box,'Спойл: Coal ×5',{showDropIcons:true});
  const dom=logLines(),env={rt:{},cfg:{farmRes:'Coal',farmNeed:5,resQuests:'Coal=5'},logLines:()=>dom,newLines:(a,b)=>b.slice(a.length),activeBuffs:()=>[],rbNote:async()=>{},mobHp:()=>null,$q:s=>document.querySelector(s),SPOIL_LOOT:/^(?:Спойл|Spoil)\s*:?\s*(.+?)\s*×\s*(\d+)/i,LOOT_RE:/^(.+?)\s*×\s*(\d+)$/,SPECIAL_RE:/^Особое (.+?) ×(\d+)$/,itemsDb:async()=>{},itemOf:()=>null,setRt:async p=>Object.assign(env.rt,p),rec(){}};
  const fl=L2V7Factories.fightlab(env),raid=L2V7Factories.raid(env),loot=L2V7Factories.loot(env),ctx={name:'Verfa',rb:{id:'test',lp:[]}};raid.rbLearn(ctx);
  await loot.sweepStep({name:'Verfa',spoiled:true,logStart:[]});await loot.trackLoot(dom,'Verfa',null);
  const clicks=[],pvpEnv={cfg:{},rt:{enemies:{enemy:{id:'enemy',name:'Enemy',kills:1}}},setRt:async p=>Object.assign(pvpEnv.rt,p),rec(){},heroLevel:()=>75,meHp:()=>({cur:1000,max:1000}),autonomyMode:()=> 'farm',fishNow:()=>false,tvtSoon:()=>false,isBattle:()=>true,isMap:()=>false,$q:s=>document.querySelector(s),shown:x=>!!x&&!x.hidden,fire:el=>{el.click();return true},sleep:async()=>{}};
  const enemies=L2V7Factories.enemies(pvpEnv);
  async function incoming(ids){applyPublicIncoming(ids.map(id=>({attackerCharacterId:id,attackerName:id==='enemy'?'Enemy':'Stranger',playerCombatMode:'world'})),x=>clicks.push(x.attackerCharacterId));enemies.onNet('/character',{pv:{incoming:ids.map(id=>({id,name:id==='enemy'?'Enemy':'Stranger'}))}});await enemies.step();}
  await incoming(['stranger','enemy']);const wrong=clicks.slice();await incoming(['enemy','stranger']);
  return {dom,rawHits:fl.parseLog(raw,'Verfa').hits,domHits:fl.parseLog(dom,'Verfa').hits,raidHits:ctx.rb.hits,spoil:env.rt.spoilStat,loot:env.rt.loot,farmGot:env.rt.farmGot,resGot:env.rt.resGot,pvpWrong:wrong,pvpClicks:clicks};
 });
 assert.deepEqual(result.rawHits.map(x=>[x.dmg,x.crit]),[[250,false],[700,true],[300,false]]);
 assert.deepEqual(result.domHits.map(x=>x.dmg),[250,700,300]);assert.deepEqual(result.raidHits,[250,700,300]);
 assert.match(result.dom.at(-1),/^Спойл:? Coal ×5$/);assert.equal(result.spoil.items.Coal,5);assert.equal(result.loot.Coal,5);assert.equal(result.farmGot.coal,5);assert.equal(result.resGot.coal,5);
 assert.deepEqual(result.pvpWrong,[]);assert.deepEqual(result.pvpClicks,['enemy']);
 console.log('PASS public Chromium: incoming raw/DOM/raid, automatic spoil → loot/resource goal, actual HUD incoming target');
 console.log(JSON.stringify({sha256:Object.fromEntries(names.map(n=>[n,crypto.createHash('sha256').update(source[n]).digest('hex').slice(0,12)])),dom:result.dom}));
 }finally{await browser.close()}
})().catch(e=>{console.error('FAIL',e.stack);process.exitCode=1});

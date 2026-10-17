'use strict';
// 17.10.2026: реальные DOM/клики Chromium и настоящие фабрики; сервер/аккаунт не используются.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/opt/node-tools/node_modules/playwright');
const root=path.join(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM,args:['--no-sandbox']});
 try{
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/*',r=>r.abort());
 await p.setContent('<meta charset="utf-8"><div id="battle-mob-title">Garden Guard · ур.48</div><div id="battle-mob-hp-val">2484 / 2484</div><div id="panel"></div><div id="bag"></div><img data-l2-slot="weapon" src="same-icon"><div id="notice">надето</div>');
 for(const name of ['combat','equipment'])await p.addScriptTag({path:path.join(root,'modules',name+'.js')});
 const result=await p.evaluate(async()=>{
  const panel=document.querySelector('#panel'),q=s=>document.querySelector(s),names=s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean),cleanTitle=s=>String(s||'').split(/\s*\(/)[0].trim();
  const add=(title,action,il={},kind='скилл')=>{const b=document.createElement('button');Object.assign(b,{title,action,il,kind});b.className='slot';panel.append(b);return b};
  const env={SLOT:'.slot',cfg:{nPower:'Wrong',nForce:'Wrong',nCharge:'',nStun:'',nUltra:'',nHeal:'',nDrain:'',nAttack:'',skillMpMin:35},rt:{char:'Hero',prof:'Warlord',classCur:{slot:0,prof:'human_warlord'},skills:{},skillDb:{}},
   names,cleanTitle,$q:q,shown:x=>!!x&&!x.hidden,isEquip:()=>false,ilOf:b=>b?.il,slotKind:b=>b.kind,slotAction:b=>b.action,slotCd:()=>null,skKey:b=>b.title.toLowerCase(),memLeft:()=>0,cdSpawn:()=> 'fixture',
   combatCooldown:{skillWait:()=>0},combatProfileKind:()=> 'fighter',skillMp:()=>0,forceCosts:()=>env.cfg.nForce?[{name:env.cfg.nForce,cost:1}]:[],forceNow:()=>3,forceMax:()=>3,
   expDmg:()=>1000,longFightMp:()=>null,mpPotSlot:()=>null,isChargeName:()=>false,isForceName:()=>false,turnSec:()=>1,meHp:()=>({cur:1000,max:1000,pct:100}),noEffect:()=>false};
  const C=L2V7Factories.combat(env),ctx=()=>({block:{},lastStun:0}),mp={cur:50,max:500};
  add('Wrong','wrong',{c:'Бафф',t:'BUFF'});const contamination=C.chooseAction(ctx(),mp)===null;
  panel.innerHTML='';env.cfg.nForce='';env.cfg.nPower='Power Strike';add('Power Strike','hit',{c:'Физ. атака',t:'PDAM',mp:100});const noMp=C.chooseAction(ctx(),mp)===null;
  const attack=add('Атака','attack',{},'атака');env.cfg.nAttack='Атака';const fallback=C.chooseAction(ctx(),mp)?.b===attack;
  panel.innerHTML='';env.cfg.nAttack='';env.cfg.nPower='Вихор';env.cfg.warlordAggro=true;env.cfg.stopHp=25;
  env.rt.weaponsT=Date.now();env.rt.weapons=[{id:299,where:'надето',wt:'древковое',inst:'eq:l1',ench:0}];
  env.battleInfo=()=>({name:'Garden Guard',max:2484,kind:'normal',t:Date.now()});add('Провокація','provoke',{c:'Агро',mp:57,autoUse:false});add('Вихор','whirlwind',{c:'Физ. атака',t:'PDAM',mp:49});
  const c=ctx(),pull=C.chooseAction(c,{cur:200,max:500});C.warlordPullResult(c,pull,true);const follow=C.chooseAction(c,{cur:143,max:500});
  const aggro=pull?.b.action==='provoke'&&follow?.b.action==='whirlwind';
  const key='power:Вихор';c.weaponContext=C.weaponContext();c.weaponBlocked=[key];c.block[key]=Infinity;env.rt.weapons[0].id=265;env.rt.prof='Tyrant';env.rt.classCur.prof='orc_tyrant';
  const release=C.chooseAction(c,{cur:200,max:500})?.b.action==='whirlwind';
  const bag=q('#bag');bag.innerHTML='<div class="l2-char-bag-row"><button class="l2-char-bag-equip--wear">Надеть</button></div>';const row=bag.firstChild;
  const weapon={id:299,inst:'bag:299:chosen',ench:3,name:'Pole',wt:'древковое',g:'C'};row.dataset.itemJson=JSON.stringify({itemId:299,targetInstanceId:weapon.inst});let selected=false,stopped=false,clicks=0,generation=1;
  const E={on:true,tabOwner:true,rt:{char:'Hero',prof:'Warlord'},actionGeneration:()=>generation,$q:q,shown:x=>!!x,itemJson:r=>JSON.parse(r.dataset.itemJson),
   noticeText:()=>q('#notice').textContent,EQUIP_OK:/надето/,pause:async()=>{},fire:b=>{b.click();clicks++;return true},waitX:async f=>f(),rec(){},
   gameGet:async()=>{if(stopped)generation++;return {ok:true,json:async()=>({character:{inventory:{eq:{l1:{itemId:299,enchant:3,targetInstanceId:selected?weapon.inst:'bag:299:other'}}}}})}}};
  const M=L2V7Factories.equipment(E);const stale=await M.wearFromBag(weapon)===false;selected=true;const sameIcon=await M.wearFromBag(weapon)===true;stopped=true;const oldFrame=await M.wearFromBag(weapon)===false;
  return {contamination,noMp,fallback,aggro,release,stale,sameIcon,oldFrame,clicks};
 });
 for(const [name,ok] of Object.entries(result))if(name!=='clicks'){assert.equal(ok,true,name);console.log('PASS Chromium:',name)}
 assert.equal(result.clicks,3);assert.deepEqual(errors,[]);
 }finally{await browser.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});

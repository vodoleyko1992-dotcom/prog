'use strict';
// 20.43 (John 21.10 13:09, скрин баффера): «Резісти» — бесплатная VIP-кнопка, берётся вместе с полным баффом.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.L2_TEST_ROOT||path.resolve(__dirname,'..');
const source=fs.readFileSync(process.env.VIP_BUFF_SOURCE||path.join(root,'modules/buffs.js'),'utf8');
const raw=JSON.parse(fs.readFileSync(path.join(root,'kb/raw/buffer-catalog.json'),'utf8'));
const nativeCatalog=raw.data||raw,GROUP=[1356,1357,1355,1363,1413,1414],RES=[1033,1182,1189,1191,1352];
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(role='mage'){
 let now=Date.now(),onPause=null;
 const catalog=clone(nativeCatalog),posts=[],events=[],applied=[],loc={pathname:'/town-buffer.html',href:''};
 const baseSet=role==='mage'?'mage':'warrior',chosen=role==='mage'?1357:1414;
 // Исторический каталог не является VIP-ценой: только локальный свежий quote даёт0/0.
 for(const row of catalog.sets){row.feeAdena='0';row.feeCoinOfLuck=0;}
 const ch={name:'Hero',id:'fixture-actor',revision:100,hp:1000,maxHp:1000,inBattle:false,classBranch:role==='mage'?'mystic':'fighter',l2Profession:role==='mage'?'human_arcana_lord':'human_warlord',classSlots:{activeSlot:0},vip:{active:true,vipUntil:new Date(now+86400000).toISOString()},activeBuffs:[]};
 let lostFor=null,skipFor=null;
 const row=id=>catalog.sets.find(x=>x.id===id),exp=()=>now+86400000;
 const install=(ids,level)=>{for(const id of ids){const skill=catalog.sets.flatMap(x=>x.skills).find(x=>x.skillId===id);assert.ok(skill,'навык есть в настоящем каталоге '+id);ch.activeBuffs=ch.activeBuffs.filter(x=>x.skillId!==id);ch.activeBuffs.push({...skill,level:level||skill.level,expiresAtMs:exp()});}};
 const env={on:true,tabOwner:true,leaseEpoch:'lease',cfg:{townBuffSet:'basic',vipBuffAuto:true,faBuffs:'',rbSessBuffs:'auto'},rt:{char:'Hero',manualKickAt:1,classCur:{prof:ch.l2Profession,slot:0},tbT:now-20*60000,tbuff:{t:now,step:'town',set:baseSet,vipFree:true,fa:[]}},routeLocation:loc,
  TB_KEYS:{basic:[1068,1045],warrior:row('warrior').skills.map(x=>x.skillId),mage:row('mage').skills.map(x=>x.skillId)},FA_KNOWN:{},IL:{},
  $q:s=>s==='#l2-hud-active-buffs'?{querySelectorAll:()=>ch.activeBuffs.map(x=>({dataset:{skillId:String(x.skillId),expiresAt:String(x.expiresAtMs)},getAttribute:k=>k==='title'?'Buff · Lv.'+x.level:''}))}:null,
  shown:()=>false,waitX:async fn=>fn(),sleep:async()=>{},pause:async()=>{if(onPause){const fn=onPause;onPause=null;fn();}},
  setRt:async patch=>{Object.assign(env.rt,patch);return {ok:true};},rtCommit:async()=>true,rec:(...xs)=>events.push(xs.join(' ')),setStatus:s=>events.push(s),autonomyMode:()=> 'farm',
  payments:{blocked:()=>false,pending:()=>null,prepare:async()=>{throw Error('VIP не резервирует платную валюту');}},
  gameGet:async p=>({ok:true,status:200,json:async()=>clone(p==='/character'?{character:ch}:catalog)}),
  gamePost:async(p,q)=>{
   posts.push({path:p,body:clone(q)});
   assert.equal(p,'/character/town/buffer');assert.equal(q.expectedFeeAdena,'0');assert.equal(q.expectedFeeCoinOfLuck,0);
   const selected=row(q.set);
   if(!selected)return {ok:false,status:400,json:async()=>({error:'buff_set_invalid'})};
   // Родной контракт: greater — одна иконка. Без skillId сервер не применяет набор.
   if(selected.pickByIcon&&(!Number.isSafeInteger(q.skillId)||!selected.skills.some(x=>x.skillId===q.skillId)))return {ok:false,status:400,json:async()=>({error:'buff_skill_invalid'})};
   if(selected.feeAdena!=='0'||selected.feeCoinOfLuck!==0)return {ok:false,status:409,json:async()=>({error:'buff_price_changed'})};
   if(q.expectedRevision!==ch.revision)return {ok:false,status:409,json:async()=>({error:'revision_conflict'})};
   const skills=selected.pickByIcon?selected.skills.filter(x=>x.skillId===q.skillId):selected.skills;
   if(skipFor!==q.skillId){
    ch.revision++;
    for(const x of skills){
     if(GROUP.includes(x.skillId))ch.activeBuffs=ch.activeBuffs.filter(b=>!GROUP.includes(b.skillId));
     ch.activeBuffs=ch.activeBuffs.filter(b=>b.skillId!==x.skillId);ch.activeBuffs.push({...x,expiresAtMs:exp()});applied.push(x.skillId);
    }
   }
   if(lostFor===q.skillId)throw Error('ответ потерян');
   return {ok:true,status:200,json:async()=>({character:clone(ch)})};
  }
 };
 class Clock extends Date{static now(){return now;}}
 const box={console,Date:Clock,Math,document:{querySelectorAll:()=>[]}};
 vm.runInNewContext(source,box);const B=box.L2V7Factories.buffs(env);B.vipNote(ch);
 const f={env,B,ch,catalog,posts,events,applied,loc,baseSet,chosen,install,row,
  installBase(){for(const skill of row(baseSet).skills)install([skill.skillId],skill.level);},
  open(){env.rt.tbuff={t:++now,step:'town',set:baseSet,vipFree:true,fa:[]};},
  expire(id){const b=ch.activeBuffs.find(x=>x.skillId===id);assert.ok(b);b.expiresAtMs=now-1;},
  set onPause(fn){onPause=fn;},set lostFor(id){lostFor=id;},set skipFor(id){skipFor=id;},
  async ticks(n=10){for(let i=0;i<n&&env.rt.tbuff&&env.on;i++)await B.townBuffStep();},
  greaterPosts(){return posts.filter(x=>x.body.set==='greater').map(x=>x.body);},
  activeGroup(){return ch.activeBuffs.filter(x=>GROUP.includes(x.skillId)&&x.expiresAtMs>now).map(x=>x.skillId);}
 };
 return f;
}

const resPosts=f=>f.posts.filter(x=>x.body.set==='resists').map(x=>x.body);
const hasRes=f=>RES.every(id=>f.ch.activeBuffs.some(b=>b.skillId===id&&b.expiresAtMs>Date.now()));
test('VIP: резисты берутся одной кнопкой без skillId, квитанция их помнит',async()=>{
 const f=fixture();await f.ticks(12);
 assert.equal(resPosts(f).length,1);assert.equal(resPosts(f)[0].skillId,undefined);assert.equal(resPosts(f)[0].expectedFeeAdena,'0');
 assert.ok(hasRes(f));assert.deepEqual(f.env.rt.vipApplied.resistIds,RES);assert.ok(RES.every(id=>f.env.rt.vipApplied.ids.includes(id)));
 assert.equal(f.env.rt.tbuff,null);assert.equal(f.B.vipSession().ready,true);assert.ok(f.events.some(e=>/резисты/.test(e)));
});
test('резисты уже висят — повторно не берутся',async()=>{
 const f=fixture();f.install(RES);await f.ticks(12);assert.equal(resPosts(f).length,0);assert.equal(f.B.vipSession().ready,true);
});
test('выключатель vipResists: резисты не берутся, бафф готов без них',async()=>{
 const f=fixture();f.env.cfg.vipResists=false;await f.ticks(12);assert.equal(resPosts(f).length,0);assert.equal(f.env.rt.tbuff,null);assert.equal(f.B.vipSession().ready,true);
});
test('резисты не бесплатны — не берутся, остальной VIP-бафф готов',async()=>{
 const f=fixture();f.row('resists').feeAdena='500000';await f.ticks(12);assert.equal(resPosts(f).length,0);assert.equal(JSON.stringify(f.env.rt.vipApplied.resistIds),'[]');assert.equal(f.B.vipSession().ready,true);
});
test('резисты слетели — снова к бафферу только за ними',async()=>{
 const f=fixture();await f.ticks(12);const n=f.posts.length;f.expire(1352);
 assert.equal(f.B.vipSession().ready,false);assert.equal(f.B.townBuffNeed()?.vipFree,true);
 f.open();await f.ticks(12);assert.deepEqual(f.posts.slice(n).map(x=>x.body.set),['resists']);assert.equal(f.B.vipSession().ready,true);
});
test('старая квитанция VIP без резистов перепроверяется по каталогу',async()=>{
 const f=fixture();await f.ticks(12);const n=f.posts.length;delete f.env.rt.vipApplied.resistIds;
 f.ch.activeBuffs=f.ch.activeBuffs.filter(b=>!RES.includes(b.skillId));
 assert.equal(f.B.vipSession().additionalReady,false);f.open();await f.ticks(12);
 assert.deepEqual(f.posts.slice(n).map(x=>x.body.set),['resists']);assert.deepEqual(f.env.rt.vipApplied.resistIds,RES);
});

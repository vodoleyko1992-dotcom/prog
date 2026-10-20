'use strict';
// 20.37: реальный Greater pickByIcon, точный skillId и один совместимый большой бафф.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.L2_TEST_ROOT||path.resolve(__dirname,'..');
const source=fs.readFileSync(process.env.VIP_BUFF_SOURCE||path.join(root,'modules/buffs.js'),'utf8');
const raw=JSON.parse(fs.readFileSync(path.join(root,'kb/raw/buffer-catalog.json'),'utf8'));
const nativeCatalog=raw.data||raw,GROUP=[1356,1357,1355,1363,1413,1414];
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
function confirmed(f){
 assert.equal(f.env.rt.tbuff,null,'маршрут завершён только после выбранного баффа');
 assert.equal(f.B.vipSession().ready,true,'действующие выбранные эффекты подтверждают готовность');
 const ids=f.env.rt.vipApplied?.ids||[];
 assert.equal(ids.filter(x=>GROUP.includes(x)).length,1,'в квитанции один совместимый Greater');
 assert.ok(ids.includes(1323),'Noblesse учтён независимо от Greater-группы');
}
for(const recent of [true,false])test('отсутствующий VIP Greater начинает новый визит сразу после base; recent='+recent,async()=>{
 const f=fixture();f.installBase();f.env.rt.tbuff=null;f.env.rt.tbT=Date.now()-(recent?10000:70000);f.env.rt.tbPauseUntil=Date.now()+600000;f.env.rt.tbOk=true;
 assert.equal(await f.B.townBuffStart('дополнительный VIP бафф',false),true);await f.ticks();assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1357,1323]);confirmed(f);
});
test('один сильный обычный эффект не выдаёт неполный базовый набор за полный VIP',async()=>{
 const f=fixture();f.install([1059],4);await f.ticks();assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1357,1323]);assert.equal(f.B.vipSession().additionalReady,true);assert.equal(f.B.vipSession().baseReady,false);assert.equal(f.B.vipSession().ready,false);assert.equal(f.B.townBuffNeed(),null);assert.equal(f.env.rt.tbOk,false);
});
test('смена выбора в паузе перед запросом отменяет старую иконку и сохраняет бесплатный маршрут',async()=>{
 const f=fixture();f.installBase();f.onPause=()=>f.env.cfg.faBuffs='1356';await f.ticks(1);assert.equal(f.posts.length,0);assert.equal(f.env.rt.tbuff.vipFree,true);await f.ticks();assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1356,1323]);confirmed(f);
});
test('присутствующий base после отказа Greater не снимает backoff следующими вызовами Start',async()=>{
 const f=fixture();f.installBase();f.env.rt.tbT=Date.now();f.env.rt.tbWant=f.row(f.baseSet).skills.map(x=>x.skillId);
 f.env.gamePost=async(p,q)=>{f.posts.push({path:p,body:clone(q)});return{ok:false,status:400,json:async()=>({error:'fixture_rejected'})};};
 await f.ticks(1);assert.equal(f.env.rt.tbOk,false);assert.equal(f.env.rt.tbuff,null);assert.equal(await f.B.townBuffStart('повтор',false),false);assert.equal(f.env.rt.tbOk,false);assert.equal(await f.B.townBuffStart('повтор',false),false);assert.equal(f.posts.length,1);
});

test('настоящий каталог требует выбор по иконке, Greater-группа содержит шесть взаимоисключающих эффектов',()=>{
 const greater=nativeCatalog.sets.find(x=>x.id==='greater');assert.equal(greater.pickByIcon,true);assert.match(greater.applyLabelUk,/іконку/);assert.deepEqual(greater.skills.map(x=>x.skillId),[...GROUP,1323]);
});
for(const role of ['mage','fighter'])test(role+': класс → точная иконка → Noblesse, без bulk-запроса и несовместимых баффов',async()=>{
 const f=fixture(role);await f.ticks();
 assert.equal(f.posts[0]?.body.set,f.baseSet);
 assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[f.chosen,1323]);
 assert.deepEqual(f.activeGroup(),[f.chosen]);confirmed(f);
});
test('наличие полного базового набора не мешает добавить выбранный Greater',async()=>{
 const f=fixture();f.installBase();await f.ticks();assert.ok(f.posts.every(x=>x.body.set==='greater'));assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1357,1323]);confirmed(f);
});
test('действующий совместимый Greater сохраняется до истечения при авто-выборе',async()=>{
 const f=fixture();f.installBase();f.install([1413]);await f.ticks();assert.deepEqual(f.activeGroup(),[1413]);assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1323]);confirmed(f);
});
for(const key of ['faBuffs','rbSessBuffs'])test('явный '+key+' выбирает указанную иконку вместо текущего большого баффа',async()=>{
 const f=fixture('fighter');f.installBase();f.install([1414]);f.env.cfg[key]='1356,1323';await f.ticks();assert.deepEqual(f.activeGroup(),[1356]);assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1356,1323]);confirmed(f);
});
test('явный список только Noblesse не меняет уже действующий Greater',async()=>{
 const f=fixture();f.installBase();f.install([1413]);f.env.cfg.faBuffs='1323';await f.ticks();assert.deepEqual(f.activeGroup(),[1413]);assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1323]);confirmed(f);
});
test('отсутствующий основной выбор заменяется доступной иконкой из свежего каталога',async()=>{
 const f=fixture();f.installBase();f.row('greater').skills=f.row('greater').skills.filter(x=>x.skillId!==1357);await f.ticks();const group=f.greaterPosts().map(q=>q.skillId).filter(x=>GROUP.includes(x));assert.equal(group.length,1);assert.ok(group[0]!==1357&&f.row('greater').skills.some(x=>x.skillId===group[0]));confirmed(f);
});
test('старый lower-level cache обычного набора не запрещает путь к дополнительному баффу',async()=>{
 const f=fixture();f.installBase();const first=f.row(f.baseSet).skills.find(x=>x.level>1);f.env.rt.tbLvl={[f.baseSet]:{[first.skillId]:first.level-1}};f.env.rt.tbuff=null;
 const need=f.B.townBuffNeed();assert.equal(need?.vipFree,true,'Greater должен планироваться отдельно от защиты обычного набора');
 assert.equal(await f.B.townBuffStart('перед РБ fixture',true),true);await f.ticks();assert.ok(f.posts.every(x=>x.body.set==='greater'));confirmed(f);
});
test('сильный обычный эффект не понижается и не отменяет выбранную дополнительную иконку',async()=>{
 const f=fixture();f.installBase();const first=f.row(f.baseSet).skills.find(x=>x.level>1);f.install([first.skillId],first.level+1);await f.ticks();assert.equal(f.ch.activeBuffs.find(x=>x.skillId===first.skillId).level,first.level+1);assert.ok(f.posts.every(x=>x.body.set==='greater'));confirmed(f);
});
test('истекает именно выбранный Greater: готовность снимается и обновляется та же иконка',async()=>{
 const f=fixture();await f.ticks();confirmed(f);f.expire(1357);assert.equal(f.B.vipSession().ready,false);assert.equal(f.B.townBuffNeed()?.vipFree,true);f.open();await f.ticks();assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1357,1323,1357]);confirmed(f);
});
test('старый base-only bundleChecked не выдаётся за проверенный дополнительный бафф',async()=>{
 const f=fixture();f.installBase();f.env.rt.vipApplied={char:'Hero',actor:f.ch.id,set:f.baseSet,slot:0,prof:f.ch.l2Profession,bundleChecked:true,skills:f.row(f.baseSet).skills,ids:f.row(f.baseSet).skills.map(x=>x.skillId)};assert.equal(f.B.vipSession().ready,false);await f.ticks();confirmed(f);
});
test('старая квитанция all7 восстанавливается в точный выбранный набор без бесконечного ожидания остальных',async()=>{
 const f=fixture();f.installBase();f.install([1413,1323]);const all=f.row(f.baseSet).skills.concat(f.row('greater').skills).map(x=>({skillId:x.skillId,level:x.level}));
 f.env.rt.vipApplied={char:'Hero',actor:f.ch.id,set:f.baseSet,slot:0,prof:f.ch.l2Profession,bundleChecked:true,skills:all,ids:all.map(x=>x.skillId)};f.env.rt.tbSetIds={[f.baseSet]:all.map(x=>x.skillId)};
 assert.equal(f.B.vipSession().ready,false);await f.ticks();confirmed(f);assert.deepEqual(f.activeGroup(),[1413]);assert.equal(f.B.townBuffNeed(),null,'старый all7 cache тоже нормализован');
});
test('старый sent bulk greater без skillId перепланируется по свежему0/0 quote',async()=>{
 const f=fixture();f.installBase();const all=f.row(f.baseSet).skills.concat(f.row('greater').skills).map(x=>({skillId:x.skillId,level:x.level}));
 f.env.rt.tbuff.vipRequest={phase:'sent',set:'greater',baseSet:f.baseSet,bundleChecked:true,greaterFree:true,bundleSkills:all,actor:f.ch.id,revision:f.ch.revision-1,skills:f.row('greater').skills.map(x=>({skillId:x.skillId,level:x.level}))};
 await f.ticks();assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1357,1323]);confirmed(f);
});
for(const change of ['Stop','lease','class','VIP off'])test(change+' перед применением отменяет точную иконку',async()=>{
 const f=fixture();f.installBase();f.onPause=()=>{if(change==='Stop')f.env.on=false;if(change==='lease')f.env.leaseEpoch='new';if(change==='class')f.env.rt.classCur.slot=1;if(change==='VIP off')f.env.cfg.vipBuffAuto=false;};await f.ticks(1);assert.equal(f.posts.length,0);
});
for(const type of ['missing fee','paid fee'])test(type+': дополнительная иконка не оплачивается и не попадает в готовую квитанцию',async()=>{
 const f=fixture();f.installBase();if(type==='missing fee')delete f.row('greater').feeCoinOfLuck;else f.row('greater').feeCoinOfLuck=5;await f.ticks();assert.equal(f.greaterPosts().length,0);assert.ok(!(f.env.rt.vipApplied?.ids||[]).includes(1357));
});
test('потерянный ответ успешно применённой иконки сверяется, повторного POST нет',async()=>{
 const f=fixture();f.installBase();f.lostFor=1357;await f.ticks();assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1357,1323]);confirmed(f);
});
test('неизвестный исход точной иконки не повторяется и не объявляется успехом',async()=>{
 const f=fixture();f.installBase();f.lostFor=1357;f.skipFor=1357;await f.ticks();assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1357]);assert.ok(f.env.rt.tbuff?.vipRequest);assert.equal(f.B.vipSession().ready,false);
});
for(const key of ['faBuffs','rbSessBuffs'])test('изменение '+key+' после готовой квитанции требует новой точной иконки',async()=>{
 const f=fixture();await f.ticks();confirmed(f);f.env.cfg[key]='1413,1323';assert.equal(f.B.vipSession().ready,false);assert.equal(f.B.townBuffNeed()?.vipFree,true);f.open();await f.ticks();assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1357,1323,1413]);assert.deepEqual(f.activeGroup(),[1413]);confirmed(f);
});
test('недоступный в каталоге явный выбор не ломает подтверждённый запасной Greater',async()=>{
 const f=fixture();f.row('greater').skills=f.row('greater').skills.filter(x=>x.skillId!==1357);await f.ticks();confirmed(f);f.env.cfg.faBuffs='1357,1323';assert.equal(f.B.vipSession().ready,true);
});
for(const change of ['same-slot profession','class ABA'])test(change+' во время паузы отменяет старый выбор иконки',async()=>{
 const f=fixture();f.installBase();f.onPause=()=>{const before={...f.env.rt.classCur};f.env.rt.classCur={...before,prof:'human_sorcerer'};if(change==='class ABA'){f.env.rt.classCur=before;f.env.rt.classSwT=1;}};await f.ticks(1);assert.equal(f.posts.length,0);assert.equal(f.env.rt.vipApplied,undefined);
});
test('смена профессии в том же слоте во время GET не применяет иконку старого класса',async()=>{
 const f=fixture();f.installBase();const get=f.env.gameGet;f.env.gameGet=async p=>{const r=await get(p);if(p==='/character')f.env.rt.classCur.prof='human_sorcerer';return r;};await f.ticks(1);assert.equal(f.posts.length,0);assert.equal(f.env.rt.vipApplied,undefined);
});
test('отложенный результат чужой профессии не записывает готовую VIP-квитанцию',async()=>{
 const f=fixture();f.installBase();f.install([1323]);const post=f.env.gamePost;f.env.gamePost=async(p,q)=>{const r=await post(p,q),d=await r.json();d.character.l2Profession='human_sorcerer';return {...r,json:async()=>d};};await f.ticks(1);assert.equal(f.posts.length,1);assert.equal(f.env.rt.vipApplied,undefined);assert.ok(f.env.rt.tbuff?.vipRequest);
});
test('sent иконка прежнего класса не блокирует новую бесплатную подготовку после switch',async()=>{
 const f=fixture();f.installBase();f.lostFor=1357;f.skipFor=1357;await f.ticks(1);assert.equal(f.env.rt.tbuff.vipRequest.schema,2);f.lostFor=null;f.skipFor=null;
 f.ch.classBranch='fighter';f.ch.l2Profession='human_warlord';f.ch.classSlots.activeSlot=1;f.ch.activeBuffs=[];f.env.rt.classCur={prof:'human_warlord',slot:1};f.env.rt.classSwT=1;f.B.vipNote(f.ch);
 await f.ticks(12);assert.deepEqual(f.greaterPosts().map(q=>q.skillId),[1357,1414,1323]);assert.deepEqual(f.activeGroup(),[1414]);confirmed(f);
});

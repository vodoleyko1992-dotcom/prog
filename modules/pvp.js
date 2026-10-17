/* 14.10: явные цели «Атаковать при встрече» и подтверждённая мировая PvP-смерть.
   Обычный лист врагов остаётся в enemies.js. Только кнопки игры; своих POST нет. */
(function(root){'use strict';root.L2V7Factories ||= Object.create(null);
root.L2V7Factories.pvp=function(env){
const DID='6f573aad-08ee-4713-9d76-33f5fd4afc93', low=s=>String(s||'').trim().toLowerCase();
const state={heroes:[],heroesT:0,self:null,selfIdentity:null,profiles:{},waitT:0,closing:null,seedRetryChar:''};
const receiptKey=()=> 'l2bot.pvpReturn@'+env.rt.char;
const receiptRead=()=>{try{return JSON.parse(sessionStorage.getItem(receiptKey())||'null')}catch(_){return null}};
const receiptSave=P=>{try{sessionStorage.setItem(receiptKey(),JSON.stringify(P))}catch(_){}};
const receiptClear=()=>{try{sessionStorage.removeItem(receiptKey())}catch(_){}};
const recovery=()=>{const P=env.rt.pvpRecovery,C=state.closing?.char===env.rt.char?state.closing:null;if(P||C)return P&&C&&(P.ev!==C.ev||P.t!==C.t)?P:C||P;const R=receiptRead();return R?.char&&R.char===env.rt.char&&R.phase==='returned'&&(!R.ev||!(env.rt.pvpResolved||[]).includes(R.ev))?R:null};
const same=(P,T)=>P&&P.char===env.rt.char&&(!T||T.char===env.rt.char)&&recovery()?.t===P.t&&recovery()?.ev===P.ev;
async function persist(P,T){const w=await env.setRt({pvpRecovery:P});return w?.ok===true&&same(P,T)&&await env.rtCommit()===true&&same(P,T)}
const token=()=>({char:env.rt.char,kick:env.rt.manualKickAt||0});
const active=T=>!!env.on&&!!env.tabOwner&&(!T||T.char===env.rt.char&&T.kick===(env.rt.manualKickAt||0))&&!env.antibotState?.()&&!env.abHold?.();
const targets=()=>env.rt.pvpTargets||{};
const exact=(t,h)=>!!t?.enabled&&!!t.id&&String(t.id)===String(h?.id||'')&&low(t.name)===low(h?.name);
const pending=()=>!!recovery();
function world(pd){return pd&&pd.name&&!pd.arena&&(!pd.scope||pd.scope==='world')&&!/tvt|arena/i.test(location.pathname)}
function capture(pd,owner){
 if(!world(pd))return;
 const ev=String(pd.ev||'');if(ev&&(env.rt.pvpResolved||[]).includes(ev))return;
 const old=recovery();
 if(old&&(!ev||old.ev===ev))return;
 state.closing=null;
 // ACK только подтверждает показ сообщения; смерть снимает отдельный return-to-town.
 env.setRt({pvpRecovery:{ev,id:String(pd.id||''),name:String(pd.name),t:Date.now(),char:env.rt.char,back:'/map.html',heroId:owner?.id||state.self?.id||'',revision:Number.isFinite(owner?.revision)?owner.revision:state.self?.revision??null}});
}
function selfNote(c){
 if(!c||!c.id||(c.name?low(c.name)!==low(env.rt.char):String(c.id)!==state.selfIdentity?.id))return;
 if(state.selfIdentity?.char===env.rt.char&&state.selfIdentity.id===String(c.id)&&Number.isFinite(c.revision)&&Number.isFinite(state.selfIdentity.revision)&&c.revision<state.selfIdentity.revision)return;
 state.selfIdentity={char:env.rt.char,id:String(c.id),name:c.name||env.rt.char,revision:Number.isFinite(c.revision)?c.revision:null,t:Date.now()};
 if(!Object.hasOwn(c,'clanId'))return;
 state.self={...state.selfIdentity,clanId:c.clanId==null?'':String(c.clanId)};
}
async function profileClan(id,name,T){
 const k=T.char+':'+id,C=state.profiles[k],now=Date.now();
 if(C&&low(C.name)===low(name)&&now-C.t<(C.known?30000:5000))return C.known?C:null;
 state.profiles[k]={name,t:now,known:false}; // отказ/отсутствие поля не запускает GET каждый тик
 try{
  const r=await env.gameGet('/game/player/'+encodeURIComponent(id)+'/profile');if(!active(T)||pending()||!r?.ok)return null;
  const j=await r.json();if(!active(T)||pending())return null;const p=j?.profile;
  if(!p||String(p.id||'')!==id||low(p.name)!==low(name)||!Object.hasOwn(p,'clanId'))return null;
  return state.profiles[k]={name,t:Date.now(),known:true,clanId:p.clanId==null?'':String(p.clanId)};
 }catch(_){return null}
}

function heroesNote(rows){state.heroes=rows;state.heroesT=Date.now()}
function rawHeroes(rows){return rows.filter(Boolean).map(h=>({id:String(h.characterId||''),name:String(h.name||''),lvl:+h.level||0,
 party:!!h.isPartyMember,clanId:h.clanId==null?'':String(h.clanId),clanKnown:Object.hasOwn(h,'clanId'),
 atk:h.battleOnNameClick===true||h.showPkButton===true,ok:h.pvpAllowed,why:String(h.pvpBlockedReasonUk||''),col:h.pvpNickColor||''}))}
function onNet(path,d){
 const owner=d.pv?.owner||d.res?.character||(path==='/character'?d.res:null);if(owner?.name&&low(owner.name)!==low(env.rt.char))return;
 if(d.pv?.defeat&&(d.status==null||d.status>=200&&d.status<300))capture(d.pv.defeat,owner);
 const c=d.res?.character||(path==='/character'?d.res:null);selfNote(c);
 if(d.pv?.heroes)heroesNote(d.pv.heroes);
 if(/pvp_defeat_pending/.test(String(d.res?.error||'')+' '+String(d.res?.message||''))&&!pending())
  env.setRt({pvpRecovery:{ev:'',name:'',id:'',t:Date.now(),char:env.rt.char,back:'/map.html'}});
 if(path==='/game/battle/return-to-town'&&d.method==='POST'&&d.status>=200&&d.status<300&&c&&!d.res?.error&&pending()){
  const P=recovery(),id=String(c.id||''),knownId=P.heroId||state.self?.id;
  if(P.char!==env.rt.char||!id||(knownId?id!==knownId:low(c.name)!==low(env.rt.char)))return;
  const rev=d.req?.expectedRevision;
  if(Number.isFinite(P.revision)&&(!Number.isFinite(rev)||rev<P.revision))return;
  const R={...P,phase:'returned',heroId:id,returnedAt:Date.now(),returnRevision:Number.isFinite(c.revision)?c.revision:null};
  receiptSave(R); // синхронное доказательство ответа переживает Stop/reload до очереди background
  env.setRt({pvpRecovery:R});

 }
}
async function seedConfirmed(){
 if((env.rt.pvpSeedDremia1410&&state.seedRetryChar!==env.rt.char)||env.rt.char!=='Warlock')return false;
 const e=env.rt.enemies?.[DID];if(e?.id!==DID||low(e.name)!=='dremia'||!(e.kills>0))return false;
 const char=env.rt.char;
 // Передаём только намерение: background объединяет цель со свежим списком и присылает canonical storage echo.
 const saved=await env.setRt({pvpSeedDremia1410:true});
 if(env.rt.char===char)state.seedRetryChar=saved?.ok===true?'':char; // повтор только intent; canonical marker не сбрасываем
 return saved?.ok===true&&env.rt.char===char;
}
function verdict(t,h){
 if(!exact(t,h))return 'цель выключена или изменился ID/ник';
 if(env.cfg.pvpOnSight===false)return 'атака при встрече выключена';
 if(pending())return 'сначала вернуться в город после PvP-смерти';
 const S=state.self;
 if(!S||S.char!==env.rt.char||Date.now()-S.t>30000||h.clanKnown!==true)return 'проверяю свою группу и клан';
 if(h.id===S.id)return 'это наш персонаж';
 if(h.party)return 'в одной группе с нами';
 if(S.clanId&&h.clanId===S.clanId)return 'в одном клане с нами';
 if(h.atk!==true||h.ok===false)return h.why||'игра не разрешает атаку';
 return '';
}
function pick(){
 if(Date.now()-state.heroesT>15000)return null;
 return state.heroes.map(h=>({h,t:targets()[h.id]})).find(x=>!verdict(x.t,x.h))||null;
}
function occupied(){const r=env.rt;return env.cfg.enchantMode===true||pending()||!!(r.shop||r.rbGo||r.zoneGo||r.revive||r.tbuff||r.magister||r.invScan||r.fishSvc||r.mmJob||r.tsJob||r.storyJob||r.petBufferTrip||r.petFull?.pending||r.enchant?.pending||r.enchant?.status==='running')||env.fishNow?.()||env.tvtHold?.()||env.tvtSoon?.()}
async function refresh(){
 const T=token();if(!active(T)||pending())return false;
 if(!state.self||state.self.char!==T.char||Date.now()-state.self.t>30000){
  if(!state.selfIdentity||state.selfIdentity.char!==T.char||Date.now()-state.selfIdentity.t>30000){
   const r=await env.gameGet('/character');if(!active(T)||pending()||!r?.ok)return false;
   const j=await r.json();if(!active(T)||pending())return false;selfNote(j.character||j);
  }
  const I=state.selfIdentity;
  if(I?.char===T.char&&(!state.self||state.self.id!==I.id||Date.now()-state.self.t>30000)){
   const c=await profileClan(I.id,I.name,T);if(!active(T)||pending())return false;
   if(c)state.self={...I,clanId:c.clanId,t:c.t};
  }
 }
 if(Date.now()-state.heroesT>=5000){
  const r=await env.gameGet('/game/map/around');if(!active(T)||pending()||!r?.ok)return false;
  const j=await r.json();if(!active(T)||pending())return false;
  if(Array.isArray(j.nearbyHeroes))heroesNote(rawHeroes(j.nearbyHeroes));
 }
 // Только явная точная цель и лишь отсутствующее поле; null — штатный ответ «без клана».
 for(const h of state.heroes){
  if(h.clanKnown||h.party||!exact(targets()[h.id],h))continue;
  const c=await profileClan(h.id,h.name,T);if(!active(T)||pending())return false;
  if(c&&state.heroes.includes(h)){h.clanId=c.clanId;h.clanKnown=true}
 }
 return true;
}

async function recoveryStep(){
 if(!pending()){
  const shout=env.$q('#map-defeat-shout');
  if(env.shown(env.$q('#map-defeat-root'))&&/Вас\s+(?:вбив|убил)\s+(?:гравець|игрок)/i.test(shout?.textContent||''))capture({name:'игрок',scope:'world'});
 }
 if(!pending())return false;
 let P=recovery();const T=token();if(P.char!==T.char)return true;
 const saved=receiptRead();
 if(saved?.char===T.char&&saved.t===P.t&&saved.ev===P.ev&&saved.phase==='returned')P=saved;
 if(P.phase==='returned'){
  state.closing=P;
  if(!(await persist(P,T))||!same(P,T))return true;
  const patch={pvpRecovery:null,pvpResolved:P.ev?[...(env.rt.pvpResolved||[]).filter(x=>x!==P.ev),P.ev].slice(-30):env.rt.pvpResolved||[],revive:{t:P.returnedAt,url:'/map.html',revived:true,source:'pvp'},target:null,rbCur:null};
  const w=await env.setRt(patch);
  if(w?.ok===true&&await env.rtCommit()===true&&same(P,T)){state.closing=null;receiptClear()}
  return true;
 }
 if(!active(T))return true;
 if(!(await persist(P,T))||!active(T)||!same(P,T))return true;
 if(env.cfg.autoRevive===false){env.setStatus('PvP: персонаж погиб — автовоскрешение выключено');return true}
 const btn=()=>[env.$q('#map-defeat-tocity'),env.$q('#battle-defeat-tocity')].find(b=>env.shown(b)&&!b.disabled);
 // 20.12 (ревизия 17.10, аудит core-a/C1): на странице входа и на незагруженной странице игры ничего не делаем — раньше каждый круг
 // уводил на /map.html, и main() не доходил до автовхода/ожидания сервера. Вход ведёт main(); незагруженная страница — ждём до 15 с,
 // потом прежний переход на карту (восстановление страницы)
 if(!btn()&&env.loginPage?.()){state.loadT=0;env.setStatus('PvP: персонаж погиб — жду входа в игру');return true}
 if(!btn()&&env.gameLoaded&&!env.gameLoaded()){state.loadT||=Date.now();if(Date.now()-state.loadT<15000){env.setStatus('PvP: жду загрузки страницы игры');await env.sleep(500);return true}}
 else state.loadT=0;
 if(!btn()&&!env.isMap()&&!env.isBattle()){
  if(!active(T)||!same(P,T))return true;
  if(await env.rtCommit()!==true||!active(T)||!same(P,T))return true;
  location.href='/map.html';await env.sleep(1000);return true;
 }
 const b=btn()||await env.waitX(btn,4000,150);
 if(!active(T)||!same(P,T))return true;
 env.setStatus('PvP: «Вернуться в город» — жду подтверждения игры');
 if(!b){
  if(env.isBattle()&&!/[?&]pvpDeath=1(?:&|$)/.test(location.search)&&await env.rtCommit()===true&&active(T)&&same(P,T))location.href='/battle.html?pvpDeath=1';
  return true;
 }
 if(Date.now()-state.waitT<5000)return true;
 await env.pause();if(!active(T)||!same(P,T)||!env.shown(b)||b.disabled)return true;
 if(env.fire(b)!==false)state.waitT=Date.now();
 // Ни ACK, ни HP>0, ни исчезновение DOM не доказывают возврат. onNet ждёт 2xx+character.
 return true;
}
async function step(){
 if(!active()||env.cfg.pvpOnSight===false||!Object.values(targets()).some(t=>t.enabled)||occupied())return false;
 if(env.isBattle()&&!env.victory())return false;
 if(!env.isMap()&&!env.isBattle())return false;
 const T=token();if(!(await refresh())||!active(T)||occupied())return false;
 let p=pick();if(!p)return false;
 if(env.isBattle()){
  if(!env.victory()||!active(T))return false;
  await env.toMap();return true;
 }
 if(Date.now()-(env.rt.pvpAttempt?.t||0)<5000)return true; // только защита от двойного клика, не запрет по силе/поражениям
 const id=p.h.id,sel=`#map-hero-list li[data-character-id="${CSS.escape(id)}"] .l2-map-hero-name-link--battle`;
 const b=await env.waitX(()=>{const x=env.$q(sel);return env.shown(x)&&!x.disabled?x:null},3000,150);
 const valid=()=>active(T)&&!occupied()&&!verdict(targets()[id],state.heroes.find(h=>h.id===id))&&env.$q(sel)===b&&env.shown(b)&&!b.disabled;
 if(!b||!valid())return false;
 await env.pause();if(!valid())return false;
 const old={pvpAttempt:env.rt.pvpAttempt||null,enemyHunt:env.rt.enemyHunt||null},now=Date.now();
 const patch={pvpAttempt:{id,name:p.t.name,t:now},enemyHunt:{id,name:p.t.name,t:now,via:'onSight'}};
 const writing=env.setRt(patch); // setRt ядра меняет память синхронно; reserve и fire в одном JS task
 if(!valid()){const undo=env.setRt(old);await writing;await undo;return false}
 const fired=env.fire(b);const undo=fired===false?env.setRt(old):null;await writing;if(undo)await undo;
 if(fired!==false)env.rec('B','PvP',`Атаковать при встрече: ${p.t.name} — явно заданная цель, обычная оценка силы не ограничивает атаку`);
 return fired!==false;
}
return{onNet,capture,pending,recoveryStep,step,seedConfirmed,targets,exact,verdict,pick,refresh,rawHeroes,_state:state};
};})(globalThis);

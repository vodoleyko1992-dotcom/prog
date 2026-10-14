'use strict';
// 14.10: реальные raid/epics/survival, DOM и ответы переходов заменены управляемой игрой.
const test=require('node:test'),assert=require('node:assert/strict');
const {mk,docOf,vm,read}=require('./epic-harness.cjs');
const boss={id:'l2dop_rb_25159',name:'Verfa',lvl:55,idx:-1};
const pin=`<button class="l2-map-mob-pin" data-spawn-id="${boss.id}"></button>`;
function pinFixture(html=''){
 const m=mk({doc:docOf(pin+html),cfg:{epicMode:false},env:{tabOwner:true}});m.env.isBattle=()=>m.loc.pathname==='/battle.html';
 m.env.waitFor=async fn=>fn();m.env.fire=el=>{if(!m.env.on||!m.env.tabOwner)return false;m.fires.push(el);return true};return m;
}
for(const field of ['on','tabOwner'])test(`РБ: потеря ${field} при ожидании окна не открывает прямой battle URL`,async()=>{
 const m=pinFixture();m.env.waitFor=async()=>{m.env[field]=false;return null};await m.R.rbPinAttack(boss,'РБ');
 assert.equal(m.loc.href,'');assert.equal(m.fires.length,1);assert.ok(!m.env.rt.target);
});
test('РБ: Stop при записи выбранной цели не открывает прямой battle URL',async()=>{
 const m=pinFixture(),set=m.env.setRt;m.env.setRt=async p=>{await set(p);if(p.target)m.env.on=false};await m.R.rbPinAttack(boss,'РБ');assert.equal(m.loc.href,'');
});
test('РБ: старое окно другого NPC не получает кнопку «В бой»',async()=>{
 const m=pinFixture('<div id="map-mob-modal"><div id="map-mob-modal-sub">NPC 29014</div><button id="map-mob-modal-battle">В бой</button></div>');
 await m.R.rbPinAttack(boss,'РБ');assert.ok(!m.fires.some(x=>x.id==='map-mob-modal-battle'));assert.equal(m.loc.href,'/battle.html?spawnId='+boss.id);
});
test('РБ: своё подтверждённое окно открывает бой один раз',async()=>{
 const m=pinFixture('<div id="map-mob-modal"><div id="map-mob-modal-sub">NPC 25159</div><button id="map-mob-modal-battle">В бой</button></div>');
 const fire=m.env.fire;m.env.fire=el=>{const ok=fire(el);if(el.id==='map-mob-modal-battle')m.loc.pathname='/battle.html';return ok};
 await m.R.rbPinAttack(boss,'РБ');assert.equal(m.fires.filter(x=>x.id==='map-mob-modal-battle').length,1);assert.equal(m.env.rt.target.name,boss.name);assert.equal(m.loc.href,'');
});
const epicId='l2dop_rb_29014',guardId='l2dop_eg_orfen';
const epicMap=`<button class="l2-map-mob-pin l2-map-mob-pin--epic" data-spawn-id="${epicId}" title="Орфен · ур. 50 · эпик-босс"></button><button class="l2-map-mob-pin l2-map-mob-pin--epic_guard" data-spawn-id="${guardId}" title="Охрана · ур. 50 · миньон"></button>`;
for(const field of ['on','tabOwner'])test(`эпик: потеря ${field} в attackSpawn не начинает миньона прямым URL`,async()=>{
 const m=mk({doc:docOf(epicMap),rt:{epic:{step:'arrive',k:'orfen',id:epicId,tries:1,seenSaved:true}},env:{tabOwner:true,aroundSig:()=>({ids:[guardId]})}});
 m.env.attackSpawn=async()=>{m.env[field]=false;return false};await m.E.epicStep();assert.equal(m.loc.href,'');
});
test('РБ: окно подменилось во время await записи цели — чужой «В бой» не нажимается',async()=>{
 const m=pinFixture('<div id="map-mob-modal"><div id="map-mob-modal-sub">NPC 25159</div><button id="map-mob-modal-battle">В бой</button><dl id="map-mob-modal-stats"><dt data-stat="hp">HP</dt><dd>1000</dd><dt data-stat="patk">P.Atk</dt><dd>10</dd><dt data-stat="matk">M.Atk</dt><dd>10</dd></dl></div>');
 const set=m.env.setRt;m.env.setRt=async p=>{await set(p);if(p.target)m.env.$q('#map-mob-modal-sub').textContent='NPC 29014'};
 await m.R.rbEngage(boss,'РБ');assert.ok(!m.fires.some(x=>x.id==='map-mob-modal-battle'));assert.equal(m.loc.href,'/battle.html?spawnId='+boss.id);
});
function chapterFixture(){
 const doc=docOf(`<div id="map-mob-list" data-l2-around-sig="1|dummy:0|p0|lv75"><a class="l2-map-mob-link" href="/battle.html?spawnId=dummy">Mob · ур. 74</a></div><div id="map-mob-page-ind">1 / 1 (1)</div><button class="l2-map-mob-pin--raid" data-spawn-id="${boss.id}"></button>`);
 const m=mk({doc,cfg:{epicMode:false,rbMode:false,rbRestHp:95},env:{tabOwner:true,serverDown:()=>false,farmRbOn:()=>false,campRbOpen:()=>[{name:boss.name}],raidList:()=>[{...boss,idx:0}],nameLike:(a,b)=>a===b,rbVerdictBlocks:()=>false,gotoPage:async()=>false,rand:()=>0,rnd:()=>0,isBoss:()=>false,isChamp:()=>false,isRaidId:()=>false,QUEST:/★/,PAGE_SIZE:15}});
 const box={console,Date,Math,URLSearchParams,CSS:{escape:s=>s},location:m.loc,document:doc};vm.createContext(box);vm.runInContext(read('modules/mobfarm.js'),box);m.F=box.L2V7Factories.mobfarm(m.env);
 m.env.waitFor=async fn=>fn();m.env.isBattle=()=>false;m.env.rbEngage=m.R.rbEngage;m.env.rbModalIs=m.R.rbModalIs;
 return m;
}
for(const field of ['on','tabOwner'])test(`РБ главы: потеря ${field} в ожидании метки не начинает бой URL`,async()=>{
 const m=chapterFixture();m.env.waitFor=async(fn,ms)=>{if(ms===3000){m.env[field]=false;return null}return fn()};await m.F.map();assert.equal(m.loc.href,'');
});
function recoveryFixture(opt={}){
 const id=opt.epic?epicId:boss.id;
 const m=mk({path:'/battle.html',search:'?spawnId='+id,doc:docOf('<button id="battle-defeat-tocity">В город</button>'),cfg:{epicMode:!!opt.epic},
 rt:{zone:'old-zone',catIn:'witch',target:{rb:true,name:opt.epic?'Орфен':boss.name},rbCur:'stale-id',rbDb:{[id]:{name:opt.epic?'Орфен':boss.name,lvl:50,verdict:'ok'}},rbWound:{[id]:{cur:700,max:1000,t:Date.now()}},
 ...(opt.epic?{epic:{step:'fight',k:'orfen',id,startHp:1000,kills0:0,hpLog:[]},epicDb:{orfen:{id,persist:opt.persist,alive:true,respH:12}}}:{})}});
 Object.assign(m.env,{epicOn:()=>!!opt.epic,epicDbSet:m.E.epicDbSet,mobHp:()=>({cur:700,max:1000}),mobName:()=>boss.name,rbNote:m.R.rbNote,rnd:()=>0,byText:()=>null,waitFor:async fn=>fn(),
 isCity:()=>m.loc.pathname==='/city.html',isBattle:()=>m.loc.pathname==='/battle.html',halt:async why=>{m.env.on=false;m.logs.push('HALT '+why)}});
 m.env.fire=el=>{m.fires.push(el);if(el.id==='battle-defeat-tocity'){m.loc.pathname='/city.html';m.loc.search='';m.setDoc(docOf('<a class="l2-town-miru-item--buffer-statue" href="/town-buffer.html">Статуя</a>'));}else if(el.className==='l2-town-miru-item--buffer-statue')m.loc.pathname='/town-buffer.html';return true};
 const sb={console,Date,Math,URLSearchParams,location:m.loc,document:{querySelectorAll:()=>[]},sessionStorage:{getItem:k=>m.store[k]||null,setItem:(k,v)=>m.store[k]=v}};
 vm.createContext(sb);vm.runInContext(read('modules/survival.js'),sb);m.S=sb.L2V7Factories.survival(m.env);
 if(opt.hang)m.store['l2bot.srvHang']=JSON.stringify({t:Date.now(),why:'ответ завис'});return m;
}
for(const hang of [false,true])test(`смерть РБ → город → статуя → восстановление; зависание=${hang}`,async()=>{
 const m=recoveryFixture({hang});await m.S.onDeath();assert.equal(m.loc.pathname,'/city.html');assert.equal(m.env.rt.zone,null);assert.equal(m.env.rt.catIn,null);assert.equal(m.env.rt.target,null);
 assert.equal(m.env.rt.rbDb[boss.id].verdict,hang?'ok':'no');assert.equal(m.env.rt.deathLog.length,1);assert.ok(m.env.rt.rbWound[boss.id]);
 await m.S.reviveStep();assert.equal(m.loc.pathname,'/town-buffer.html');assert.equal(m.env.rt.revive,null);assert.equal(m.env.rt.tbuff.step,'restore');assert.equal(m.env.rt.tbuff.back,'/map.html');
 assert.equal(m.fires.length,2);
});
test('третья смерть из постоянной истории останавливает, даже если текущий счётчик сброшен',async()=>{
 const m=recoveryFixture();m.env.rt.deaths=[];m.env.rt.deathLog=[Date.now()-20000,Date.now()-10000];await m.S.onDeath();assert.equal(m.env.on,false);assert.equal(m.fires.length,0);assert.ok(m.logs.some(x=>x.includes('3 смерти за 30 минут')));
});
for(const persist of [false,true])test(`эпик: смерть → восстановление → решение о повторе при сохранении HP=${persist}`,async()=>{
 const m=recoveryFixture({epic:true,persist});await m.S.onDeath();await m.S.reviveStep();
 assert.equal(m.env.rt.epic.died,true);assert.equal(m.env.rt.epicDb.orfen.deathsLife,1);assert.equal(m.env.rt.epic.hpLog[0].cur,700);
 m.loc.pathname='/map.html';m.env.rt.tbuff=null;await m.E.epicStep();
 assert.equal(m.env.rt.epic.step,persist?'prep':'pick');assert.equal(m.env.rt.epicDb.orfen.deaths,1);assert.equal((m.env.rt.epicTpBudget||[]).length,0);
 if(persist){assert.equal(m.env.rt.epic.noPay,true);assert.equal(m.env.rt.epic.deaths,1)}else assert.ok(m.env.rt.epicDb.orfen.skipT>Date.now());
});
for(const ack of [true,false,'stale'])test(`эпик: отступление с ответом ${ack} даёт соответствующий следующий шаг`,async()=>{
 const at=Date.now();const m=mk({rt:{epic:{step:'retreatVerify',k:'orfen',id:epicId,retreatT:at,retreatAttempt:{t:at,cur:700,max:1000,dps:500}},epicDb:{orfen:{id:epicId,alive:true}}}});
 m.store['l2bot.epicLeave']=JSON.stringify({id:epicId,at:ack==='stale'?at-1000:at+1,ok:ack===true});await m.E.epicStep();
 assert.equal(m.env.rt.epic.step,ack===true?'prep':ack===false?'pick':'retreatVerify');assert.equal(m.fires.length,0);
 if(ack===true){assert.equal(m.env.rt.epic.noPay,true);assert.equal(m.env.rt.epicDb.orfen.retreatsLife,1);assert.equal(m.env.rt.rbDb[epicId].dps,500)}
 if(ack===false)assert.ok(m.env.rt.epicDb.orfen.leaveBadUntil>Date.now());
});
test('эпик: подтверждённая победа завершает заход и очищает лимиты текущего появления',async()=>{
 const m=mk({rt:{epic:{step:'fight',k:'orfen',id:epicId,kills0:0,deaths:1},rbDb:{[epicId]:{kills:1}},epicDb:{orfen:{id:epicId,alive:true,paidN:1,deathsLife:1,retreatsLife:2,respH:12}}}});
 await m.E.epicStep();assert.equal(m.env.rt.epic.step,'pick');assert.equal(m.env.rt.epicDb.orfen.alive,false);assert.equal(m.env.rt.epicDb.orfen.kills,1);assert.equal(m.env.rt.epicDb.orfen.paidN,0);assert.ok(m.env.rt.epicDb.orfen.until.lo>Date.now());
});
test('РБ: отход сохраняет снятое HP и попытку, завершение тура возвращается к выбору',async()=>{
 const m=mk({cfg:{epicMode:false,shopAuto:false},rt:{rbHunt:{step:'fight',id:boss.id,name:boss.name},rbDb:{},rbWound:{[boss.id]:{cur:700,max:1000,t:Date.now()}}}});let out=0;
 Object.assign(m.env,{rnd:()=>0,toOutskirts:async()=>out++});await m.R.rbRetreat({name:boss.name,rb:{id:boss.id,start:1000}}, {cur:700,max:1000},'лечусь');
 assert.equal(m.env.rt.rb[boss.id].chip,300);assert.equal(m.env.rt.rb[boss.id].attempts,1);assert.equal(m.env.rt.rbPending,true);assert.equal(out,1);
 await m.R.rbHuntStep();assert.equal(m.env.rt.rbHunt.step,'pick');assert.ok(m.env.rt.rbHunt.last.includes('вернусь добить'));assert.equal(m.R.rbWounded(boss.id),true);
});
function teleportFixture(tour=false){
 const id='l2dop_rb_99999',g={id,name:'Audit Raid',lvl:54,page:1,price:1000,unit:'аден',alive:true,t:Date.now()};
 const doc=docOf(`<div id="rb-list"><div class="l2-rb-row"><span class="l2-rb-row__label">Audit Raid</span><span class="l2-rb-row__level">54</span><span class="l2-rb-row__status l2-rb-row__status--alive">Живой</span><span class="l2-rb-row__price">1000 аден</span><button class="l2-rb-row__tp" data-spawn-id="${id}">Телепорт</button></div></div>`);
 const m=mk({path:'/rb-bosses.html',search:'?page=1',doc,cfg:{epicMode:false},rt:{rbGo:tour?null:g,rbHunt:tour?{...g,step:'go'}:null,rbList:{[id]:g},rbStats:{[id]:{hp:1000,patk:1,matk:1,mdef:1,pdef:1,src:'api'}},rbDb:{}},env:{tabOwner:true}});
 m.env.fire=el=>{if(!m.env.on||!m.env.tabOwner)return false;m.fires.push(el);return true};m.run=()=>tour?m.R.rbHuntStep():m.R.rbGoStep();m.id=id;return m;
}
for(const tour of [false,true])for(const field of ['on','tabOwner'])test(`${tour?'тур':'разовый'} РБ: потеря ${field} перед телепортом сохраняет job и не считает платный переход`,async()=>{
 const m=teleportFixture(tour);m.env.pause=async()=>{m.env[field]=false};await m.run();
 assert.equal(m.loc.href,'');assert.equal(m.fires.length,0);assert.equal((m.env.rt.rbGoCnt?.[m.id]||[]).length,0);assert.equal(m.env.rt.rbGoTried?.[m.id]||0,0);
 assert.ok(tour?m.env.rt.rbHunt?.step==='go':m.env.rt.rbGo?.id===m.id);
});
test('РБ: после принятого клика Stop сохраняет резерв, но не уводит на карту из старого шага',async()=>{
 const m=teleportFixture();m.env.fire=el=>{m.fires.push(el);m.env.on=false;return true};await m.run();
 assert.equal(m.loc.href,'');assert.equal(m.fires.length,1);assert.equal(m.env.rt.rbGoCnt[m.id].length,1);
});
for(const tour of [false,true])test(`${tour?'тур':'разовый'} РБ: после паузы и restart платный телепорт выполняется один раз`,async()=>{
 const m=teleportFixture(tour);m.env.pause=async()=>{m.env.on=false};await m.run();assert.equal((m.env.rt.rbGoCnt?.[m.id]||[]).length,0);
 m.env.on=true;m.env.pause=async()=>{};m.env.fire=el=>{m.fires.push(el);m.loc.pathname='/map.html';return true};await m.run();
 assert.equal(m.fires.length,1);assert.equal(m.env.rt.rbGoCnt[m.id].length,1);assert.equal(m.env.rt.rbWant,m.id);
 if(tour){assert.equal(m.env.rt.rbHunt.step,'arrive');assert.equal(m.env.rt.zone,null);assert.equal(m.env.rt.zonePend,null)}else assert.equal(m.env.rt.rbGo,null);
});
for(const tour of [false,true])for(const timeout of [4000,8000])test(`${tour?'тур':'разовый'} РБ: Stop при загрузке ${timeout===4000?'страницы':'кнопки'} не теряет job`,async()=>{
 const m=teleportFixture(tour);m.env.waitX=async(fn,ms)=>{if(ms===timeout){m.env.on=false;return null}return fn()};await m.run();
 assert.equal(m.loc.href,'');assert.equal(m.fires.length,0);assert.equal((m.env.rt.rbGoCnt?.[m.id]||[]).length,0);assert.ok(tour?m.env.rt.rbHunt?.step==='go':m.env.rt.rbGo?.id===m.id);
});
for(const tour of [false,true])test(`${tour?'тур':'разовый'} РБ: новый ручной режим во время pause отменяет старый телепорт`,async()=>{
 const m=teleportFixture(tour);m.env.pause=async()=>{m.env.rt.manualKickAt=Date.now();if(tour)m.env.rt.rbHunt={step:'pick'};else m.env.rt.rbGo=null};await m.run();
 assert.equal(m.fires.length,0);assert.equal((m.env.rt.rbGoCnt?.[m.id]||[]).length,0);assert.equal(m.loc.href,'');
});
for(const tour of [false,true])test(`${tour?'тур':'разовый'} РБ: резерв и клик не разделены ожиданием storage, Stop после клика не повторяет переход`,async()=>{
 const m=teleportFixture(tour),set=m.env.setRt;let release;
 // Как core.setRt: память и очередь меняются синхронно, ответ storage приходит позже.
 m.env.setRt=p=>{const result=set(p);return p.rbGoCnt?new Promise(resolve=>{release=resolve}):result};
 const running=m.run();for(let i=0;i<20&&!release;i++)await Promise.resolve();
 assert.ok(release);assert.equal(m.fires.length,1);m.env.on=false;release({ok:true});await running;
 assert.equal(m.loc.href,'');assert.equal(m.env.rt.rbGoCnt[m.id].length,1);assert.equal(m.fires.length,1);
});
for(const tour of [false,true])test(`${tour?'тур':'разовый'} РБ: отклонённый fire возвращает только резерв и разрешает успешный restart`,async()=>{
 const m=teleportFixture(tour);m.env.rt.unrelated=37;m.env.fire=()=>false;await m.run();
 assert.equal(m.loc.href,'');assert.equal((m.env.rt.rbGoCnt?.[m.id]||[]).length,0);assert.equal(m.env.rt.rbGoTried?.[m.id]||0,0);
 assert.ok(tour?m.env.rt.rbHunt?.step==='go':m.env.rt.rbGo?.id===m.id);assert.equal(m.env.rt.unrelated,37);
 m.env.fire=el=>{m.fires.push(el);m.loc.pathname='/map.html';return true};await m.run();
 assert.equal(m.fires.length,1);assert.equal(m.env.rt.rbGoCnt[m.id].length,1);assert.equal(m.env.rt.rbWant,m.id);
});

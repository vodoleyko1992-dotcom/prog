'use strict';
// 23.10, Firefox20.51: Monster80 выбран, но outside-каталог его не разрешает; подтверждён штатный боевой action.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=process.env.L2_MONSTER_SOURCE_ROOT||__dirname+'/..',read=p=>fs.readFileSync(root+'/'+p,'utf8'),core=read('content.js');
function fixture(saved={},detectId=80){
 const meta={88:{action:'detect_dragon_weakness',name:'Вразливість драконів',en:'Detect Dragon Weakness',mp:30},
  359:{action:'eye_hunter',name:'Око мисливця',en:'Eye of Hunter',mp:39},360:{action:'eye_slayer',name:'Око вбивці',en:'Eye of Slayer',mp:40}}[detectId]||{action:'detect_monster_weakness',name:'Вразливість монстрів',en:'Detect Monster Weakness',mp:24};
 let now=1792714960000,net=0,owner='lease1',generation=1,hud=[],wait={},global=0,clicks=0,receipt=null;
 const box={console,Date:class extends Date{static now(){return now}},location:{pathname:'/battle.html',search:'?spawnId=local_1'}};vm.createContext(box);
 vm.runInContext(read('skills-il.js')+'\n'+core.slice(core.indexOf('const IL = typeof IL_DB'),core.indexOf('// ---------- база предметов'))+'\nthis.ilOf=ilOf;',box);
 const b={name:meta.name,title:meta.name+' ('+meta.en+')',cdKey:meta.action,kind:'скилл',disabled:false,hidden:false,className:'',getAttribute:k=>k==='data-slot-cd'?meta.action:null};
 const panel=[b];box.document={querySelectorAll:()=>panel,documentElement:{dataset:{}}};
 const env={on:true,tabOwner:true,canAct:()=>true,isBattle:()=>true,pvpPending:()=>false,evidenceOwner:()=>owner,actionGeneration:()=>generation,heroNick:()=>env.rt.char,battleExitContext:()=> 'cat',
  cfg:{nBuffs:meta.name},rt:{char:'Hero',classCur:{prof:'human_warlord',slot:3},manualKickAt:1,skills:{},skillDb:{},...saved},SLOT:'.slot',
  ilOf:box.ilOf,names:s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean),cleanTitle:s=>s.split(/\s*\(/)[0].trim(),slotAction:b=>b.cdKey,slotKind:b=>b.kind,
  slotCd:()=>null,memLeft:()=>0,skKey:b=>b.title.toLowerCase(),shown:e=>!!e&&!e.hidden,activeBuffs:()=>hud,noEffect:()=>false,meMp:()=>({cur:100,max:100}),
  combatCooldown:{skillWait:k=>wait[k]||0,globalWait:()=>global},cdSpawn:()=> 'local_1',battleSpawn:()=> 'local_1',
  setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rtCommit:async()=>true,actNet:()=>({start:net,startRid:net,t:now,startOwner:owner}),actReceipt:()=>receipt};
 vm.runInContext(read('modules/combat.js'),box);const C=box.L2V7Factories.combat(env),ctx={block:{},seq:[]};
 const snap=(patch={})=>({name:'Hero',l2Profession:'human_warlord',classSlots:{activeSlot:3},revision:100,snapshotGeneratedAt:now,requestStartedAt:now,inBattle:true,monsterBuffs:[],
  activeBuffs:[],learnedBattleSkillsDetail:[{battleId:'l2_'+detectId,level:1,mpCost:meta.mp}],...patch});
 const act=async(button,status,hp,needed,checked)=>{assert.equal(checked,true);assert.equal(button,b);if(!needed())return'lock';clicks++;const i=needed.monsterIntent;assert.equal(C.armMonsterRequest(needed.monsterIntent),true);const token=C.monsterRequestToken({monsterToken:i.token,path:'/game/battle/action',method:'POST',rid:net+1,req:{action:meta.action,expectedRevision:i.baseRevision}});net++;receipt={rid:net,owner,action:meta.action,ok:true,t:now,monsterToken:token,expectedRevision:i.baseRevision,revision:i.baseRevision+1,requestStartedAt:now};return true;};
 return{C,env,ctx,b,panel,snap,act,id:detectId,meta,box,now:()=>now,advance:n=>now+=n,clicks:()=>clicks,sent:()=>{net++;receipt=null},receipt:r=>receipt=r,owner:v=>owner=v,generation:()=>generation++,hud:v=>hud=v,wait:(k,v)=>wait[k]=v,global:v=>global=v};
}
const note=(f,p={})=>{assert.equal(typeof f.C.noteMonsterSnapshot,'function');return f.C.noteMonsterSnapshot(f.snap(p));};
const run=(f,act=f.act)=>{assert.equal(typeof f.C.managedMonsterStep,'function');return f.C.managedMonsterStep(f.ctx,act);};
test('четыре Detect остаются generic autoUse:false; новый путь80 использует native act при пустом outside-каталоге',async()=>{
 const f=fixture();for(const id of [75,80,87,88,104])assert.equal(f.env.ilOf({cdKey:'l2_'+id,name:''}).autoUse,false);
 assert.equal(f.C.ready(f.b),false);note(f,{castableSelfBuffs:[]});await run(f,async(...args)=>{assert.ok(f.env.rt.monsterNativeIntent);return f.act(...args)});assert.equal(f.clicks(),1);
});
for(const n of ['Detect Monster Weakness','Вразливість монстрів','l2_80'])test('выбор80 по роли '+n,async()=>{const f=fixture();f.env.cfg.nBuffs=n;note(f);assert.equal(await run(f),true);assert.equal(f.clicks(),1);});
for(const [name,patch]of Object.entries({missingComplete:{monsterBuffs:undefined},unknownBuffs:{monsterBuffs:null},noLearned:{learnedBattleSkillsDetail:[]},unknownPrice:{learnedBattleSkillsDetail:[{battleId:'l2_80',level:1}]},negativePrice:{learnedBattleSkillsDetail:[{battleId:'l2_80',level:1,mpCost:-1}]},wrongHero:{name:'Other'},wrongClass:{l2Profession:'human_gladiator'},wrongSlot:{classSlots:{activeSlot:2}},badRevision:{revision:null},oldGenerated:{snapshotGeneratedAt:1792714900000},futureGenerated:{snapshotGeneratedAt:1792714980000},oldRequest:{requestStartedAt:1792714900000},notBattle:{inBattle:false}}))
 test('неизвестное/несвежее состояние не разрешает80: '+name,async()=>{const f=fixture();note(f,patch);assert.equal(await run(f),false);assert.equal(f.clicks(),0);});
for(const [name,change]of Object.entries({role:f=>f.env.cfg.nBuffs='',stop:f=>f.env.on=false,owner:f=>f.env.tabOwner=false,canAct:f=>f.env.canAct=()=>false,pvp:f=>f.env.pvpPending=()=>true,notBattle:f=>f.env.isBattle=()=>false,
 changedOwner:f=>f.owner('new'),changedGeneration:f=>f.generation(),mode:f=>f.env.battleExitContext=()=> 'fish',lowMP:f=>f.env.meMp=()=>({cur:23}),unknownMP:f=>f.env.meMp=()=>null,nativeCD:f=>f.wait('detect_monster_weakness',900),numericCD:f=>f.wait('l2_80',900),globalCD:f=>f.global(900),hidden:f=>f.b.hidden=true,unavailable:f=>f.env.noEffect=()=>true,expired:f=>f.advance(30001)}))
 test('до/после записи intent проверяется '+name,async()=>{const f=fixture();note(f);const save=f.env.setRt;f.env.setRt=async p=>{const r=await save(p);change(f);return r};await run(f);assert.equal(f.clicks(),0);});
test('положительный HUD, свой или ручной80 не обновляются',async()=>{
 for(const mode of ['hud','snapshot','packet']){const f=fixture();note(f);if(mode==='hud')f.hud([{id:80}]);if(mode==='snapshot')note(f,{monsterBuffs:[{skillId:80,expiresAtMs:f.now()+600000}]});if(mode==='packet')f.C.noteToggleBattle({be:{revision:101},res:{delta:{battleBuffIcons:[{l2SkillId:80}]}}});assert.equal(await run(f),false);assert.equal(f.clicks(),0);}
});
test('цена из tooltip текущего learned допускается только при multiplier1; IL80 не источникMP',async()=>{
 const f=fixture();note(f,{learnedBattleSkillsDetail:[{battleId:'l2_80',level:1,hintUk:'MP 24, відкат 3 с.'}],skillMpCostMul:1});assert.equal(await run(f),true);
 const g=fixture();note(g,{learnedBattleSkillsDetail:[{battleId:'l2_80',level:1,hintUk:'MP 24'}],skillMpCostMul:0.5});assert.equal(await run(g),false);
});
test('новый бой/запрос отзывает старое отсутствие; replay равной revision не освежает снимок',async()=>{
 const f=fixture();note(f);f.C.noteToggleBattle({be:{revision:101},res:{}});assert.equal(await run(f),false);f.advance(30001);note(f);assert.equal(await run(f),false);
 const g=fixture();note(g);g.C.noteToggleBattle({req:{action:'attack',expectedRevision:100}});assert.equal(await run(g),false);g.advance(10);note(g,{revision:101});assert.equal(await run(g),true);
});
test('отправленный неизвестный результат переживает reload и новый GET без спама630с',async()=>{
 const f=fixture();note(f);await run(f,async()=>{f.sent();return'lock'});assert.equal(await run(f),false);
 const g=fixture(JSON.parse(JSON.stringify(f.env.rt)));g.owner('new');g.advance(100);note(g,{revision:101});assert.equal(await run(g),false);
 g.advance(630000);note(g,{revision:102});assert.equal(await run(g),true);assert.equal(g.clicks(),1);
});
test('подтверждённый nativeACK не повторяется по старому GET, свежий post-ACK OFF послеCD позволяет восстановить cancel',async()=>{
 const f=fixture();note(f);await run(f);assert.equal(await run(f),false);f.advance(3001);note(f,{revision:101});assert.equal(await run(f),true);assert.equal(f.clicks(),2);
});
test('неотправленный отказ не делает630с unknown; повтор после новыхMP/CD разрешён',async()=>{
 const f=fixture();note(f);await run(f,async()=> 'nomp');assert.equal(await run(f),false);f.advance(701);assert.equal(await run(f),true);assert.equal(f.clicks(),1);
});
test('нет durable ACK/flush — нет nativeклика; обычный бой не зацикливается на новом intent',async()=>{
 for(const mode of ['save','flush','throw']){const f=fixture();note(f);if(mode==='save')f.env.setRt=async()=>({ok:false});if(mode==='flush')f.env.rtCommit=async()=>false;if(mode==='throw')f.env.setRt=async()=>{throw Error('offline')};assert.equal(await run(f),false);assert.equal(f.clicks(),0);assert.equal(await run(f),false);}
});
test('hook делает полную выборку80 до обрезки общих60 баффов',()=>{
 const src=read('hook.js'),a=src.indexOf('  const petOf ='),b=src.indexOf('  // 20.12',a),box={};vm.createContext(box);vm.runInContext(src.slice(a,b)+'\nthis.petOf=petOf;',box);
 const all=Array.from({length:65},(_,i)=>({skillId:1000+i}));all.push({skillId:80,expiresAt:1792715560000});const p=box.petOf({pathname:'/character'},{character:{name:'Hero',revision:1,activeBuffs:all}});
 assert.equal(p.activeBuffs.length,60);assert.equal(p.monsterBuffs.length,1);assert.equal(p.monsterBuffs[0].skillId,80);
 const empty=box.petOf({pathname:'/character'},{character:{name:'Hero',revision:1,activeBuffs:all.slice(0,65)}});assert.deepEqual(JSON.parse(JSON.stringify(empty.monsterBuffs)),[]);
 assert.equal(box.petOf({pathname:'/character'},{character:{name:'Hero',revision:1}}).monsterBuffs,null);
});

test('оба пути80 разделяют неизвестный630с fence',async()=>{
 const key=JSON.stringify(['Hero','human_warlord',3,80]),f=fixture({detectOutsideIntent:{[key]:{at:1792714960000,baseRevision:99,phase:'unknown'}}});note(f);assert.equal(await run(f),false);
 const g=fixture({monsterNativeIntent:{[key]:{at:1792714960000,baseRevision:99,phase:'unknown'}}});Object.assign(g.env,{detectGate:()=>true,detectTask:()=> 'cat'});
 const box={location:{pathname:'/map.html',search:''},Date:class extends Date{static now(){return g.now()}}};vm.createContext(box);vm.runInContext(read('modules/buffs.js'),box);const B=box.L2V7Factories.buffs(g.env);
 const snap=g.snap({inBattle:false,castableSelfBuffs:[{battleId:'l2_80',mpCost:24}],battleHotbarSlots:[{k:'a',a:'detect_monster_weakness'}]});B.detectOutsideSnapshot(snap,g.now(),'inventory');assert.equal(B.detectOutsidePlan(),null);
});
for(const [name,change]of Object.entries({token:r=>r.monsterToken='manual',rid:r=>r.rid=999,owner:r=>r.owner='other',action:r=>r.action='attack',expected:r=>r.expectedRevision=99,revision:r=>r.revision=100,start:r=>r.requestStartedAt-=1}))test('чужая/старая ACK не сокращаетunknown fence: '+name,async()=>{
 const f=fixture();note(f);await run(f,async(...args)=>{const result=await f.act(...args);const r=f.env.actReceipt();change(r);return result;});
 assert.equal(Object.values(f.env.rt.monsterNativeIntent)[0].phase,'unknown');f.advance(3001);note(f,{revision:101});assert.equal(await run(f),false);
});
test('answered fence требует ревизию не старее своегоACK',async()=>{
 const f=fixture();note(f);await run(f,async(...args)=>{const result=await f.act(...args);f.env.actReceipt().revision=105;return result;});f.advance(3001);note(f,{revision:101});assert.equal(await run(f),false);note(f,{revision:105});assert.equal(await run(f),true);
});
test('короткие2с бои с GETразв5с получают80 изполного штатногоstart без ручногоresync',async()=>{
 const f=fixture();note(f);f.advance(2000);f.C.noteToggleBattle({path:'/game/battle/action',rid:7,req:{action:'attack',expectedRevision:100}},f.now());f.C.noteToggleBattle({rid:7,be:{revision:101},res:{}});
 assert.equal(f.C.noteMonsterSnapshot(f.snap({revision:101,snapshotGeneratedAt:null,nativeBattleSnapshot:true,requestRid:7,learnedBattleSkillsDetail:null})),true);
 assert.equal(await run(f),true);assert.equal(f.clicks(),1);
});
test('battle extractor принимаеттолькополныйcharacter.activeBuffs, неpartialdelta',()=>{
 const src=read('hook.js'),a=src.indexOf('  const monsterOf ='),b=src.indexOf('  // 20.12',a),box={};vm.createContext(box);vm.runInContext(src.slice(a,b)+'\nthis.monsterOf=monsterOf;',box);
 const c={name:'Hero',revision:100,l2Profession:'human_warlord',classSlots:{activeSlot:3},inBattle:true,activeBuffs:[]};
 assert.deepEqual(JSON.parse(JSON.stringify(box.monsterOf({pathname:'/game/battle/start'},{character:c}).monsterBuffs)),[]);
 assert.equal(box.monsterOf({pathname:'/game/battle/action'},{character:{...c,activeBuffs:undefined},delta:{battleBuffIcons:[]}}),undefined);
 assert.equal(box.monsterOf({pathname:'/game/battle/action'},{delta:{character:c}}),undefined);
});

test('настоящийhookstart передаёт только80 action/revision дляclaim, чужиеполяневыходят',()=>{
 const src=read('hook.js'),a=src.indexOf('  function start(u, method, req)'),b=src.indexOf('  // 20.42',a),messages=[],box={TRACK:/./,STORY_TP:/^\/never$/,ridN:0,mutationN:0,storyRetry:null,Date,Number,location:{origin:'https://local.invalid'},window:{postMessage:d=>messages.push(d)},document:{documentElement:{dataset:{l2botMonster:JSON.stringify({token:'native-test',revision:100,action:'detect_monster_weakness',at:Date.now()})}}}};
 vm.createContext(box);vm.runInContext(src.slice(a,b)+'\nthis.start=start;',box);box.start({pathname:'/game/battle/action'},'POST',{action:'detect_monster_weakness',expectedRevision:100,unrelated:'private'});
 assert.deepEqual(JSON.parse(JSON.stringify(messages[0].req)),{action:'detect_monster_weakness',expectedRevision:100});assert.equal(messages[0].monsterToken,'native-test');
 box.start({pathname:'/game/battle/action'},'POST',{action:'attack',expectedRevision:100});assert.equal(messages[1].req,undefined);
});

test('claim не вооружён во время ожиданияact, только непосредственно перед своимclick',async()=>{
 const f=fixture();note(f);await run(f,async(b,status,hp,needed)=>{
  const i=needed.monsterIntent;assert.equal(f.C.monsterRequestToken({path:'/game/battle/action',method:'POST',rid:88,monsterToken:i.token,req:{action:'detect_monster_weakness',expectedRevision:100}}),'');
  return f.act(b,status,hp,needed,true);
 });assert.equal(Object.values(f.env.rt.monsterNativeIntent)[0].phase,'answered');
});

test('два запроса в одну мс: полный ответ первого не снимает fence второго',async()=>{
 const f=fixture();note(f);f.advance(1000);const at=f.now();
 for(const rid of [7,8])f.C.noteToggleBattle({path:'/game/battle/action',rid,req:{action:'attack',expectedRevision:100}},at);
 f.C.noteToggleBattle({rid:7,be:{revision:101},res:{}});note(f,{revision:101,nativeBattleSnapshot:true,requestRid:7,requestStartedAt:at});assert.equal(await run(f),false);
 f.C.noteToggleBattle({rid:8,be:{revision:102},res:{}});note(f,{revision:102,nativeBattleSnapshot:true,requestRid:8,requestStartedAt:at});assert.equal(await run(f),true);
});

test('штатный post-action GET той жеrevision сохраняет причиннуюсвежесть безосвеженияTTL',async()=>{
 const f=fixture();note(f);f.advance(1000);const at=f.now();f.C.noteToggleBattle({path:'/game/battle/action',rid:7,req:{action:'attack',expectedRevision:100}},at);f.advance(250);
 f.C.noteToggleBattle({rid:7,be:{revision:101},res:{}});note(f,{revision:101,nativeBattleSnapshot:true,requestRid:7,requestStartedAt:at});
 f.advance(100);note(f,{revision:101,requestRid:8});assert.equal(await run(f),true);assert.equal(f.clicks(),1);
 const g=fixture();note(g);g.advance(30001);note(g,{requestRid:10});assert.equal(await run(g),false,'TTL равнойrevisionнеосвежён');
});

for(const name of ['Detect Dragon Weakness','Вразливість драконів','l2_88'])test('Dragon88выбранкакnativeбафф, реальнаяцена30MP: '+name,async()=>{
 const f=fixture({},88);f.env.cfg.nBuffs=name;note(f);assert.equal(f.env.ilOf(f.b).id,88);assert.equal(f.env.ilOf(f.b).autoUse,false);assert.equal(f.C.ready(f.b),false);assert.equal(await run(f),true);assert.equal(Object.values(f.env.rt.monsterNativeIntent)[0].id,88);
 const g=fixture({},88);g.env.meMp=()=>({cur:29,max:100});note(g);assert.equal(await run(g),false,'не берём27MPизIL');
});
test('native Dragon в старомnPower не попадаетвудары дажеприautoRolesOFF',()=>{
 const f=fixture({},88);f.env.cfg.autoRoles=false;f.env.cfg.nBuffs='';f.env.cfg.nPower=f.meta.name;
 const src=read('modules/combat.js'),a=src.indexOf('function nonOffenseSkill('),b=src.indexOf('// 17.10.2026, реворк боя:',a),box={env:f.env};vm.createContext(box);vm.runInContext(src.slice(a,b)+'\nthis.blocked=nonOffenseSkill;',box);
 assert.equal(box.blocked(f.b),true);assert.equal(f.env.ilOf(f.b).managedDetect,true);
});
for(const mode of ['active','nativeCD','numericCD','unknown','roleRemoved'])test('Dragon88 guards '+mode,async()=>{
 const f=fixture({},88);note(f);if(mode==='active')f.hud([{id:88}]);if(mode==='nativeCD')f.wait('detect_dragon_weakness',3000);if(mode==='numericCD')f.wait('l2_88',3000);if(mode==='roleRemoved')f.env.cfg.nBuffs='';
 if(mode==='unknown'){await run(f,async()=>{f.sent();return'lock'});const g=fixture(JSON.parse(JSON.stringify(f.env.rt)),88);g.owner('new');g.advance(100);note(g,{revision:101});assert.equal(await run(g),false);return;}
 assert.equal(await run(f),false);assert.equal(f.clicks(),0);
});
test('80и88 имеютраздельныеMP/active/intent; подтверждённый80 не мешает88',async()=>{
 const f=fixture(),g=fixture({},88);f.panel.push(g.b);f.env.cfg.nBuffs=f.meta.name+', '+g.meta.name;
 note(f,{monsterBuffs:[{skillId:80,expiresAtMs:f.now()+600000}],learnedBattleSkillsDetail:[{battleId:'l2_80',level:1,mpCost:24},{battleId:'l2_88',level:1,mpCost:30}]});
 const plan=f.C.managedMonsterPlan(f.ctx);assert.equal(plan.id,88);assert.equal(plan.cost,30);
 assert.equal(await run(f,async(button,status,hp,needed,checked)=>{assert.equal(button,g.b);assert.equal(needed.monsterIntent.id,88);return'lock'}),true);
 const all=Object.values(f.env.rt.monsterNativeIntent);assert.equal(all.length,0,'noPOST не создалunknown80или88');
});
test('unknown80 не блокирует88, unknown88 не блокирует80',async()=>{
 for(const phase of ['prepared','unknown'])for(const [unknown,active]of [[80,88],[88,80]]){const key=JSON.stringify(['Hero','human_warlord',3,unknown]);const f=fixture({monsterNativeIntent:{[key]:{id:unknown,at:1792714960000,until:1792715590000,baseRevision:100,phase}}},active);note(f);assert.equal(await run(f),true);assert.equal(f.clicks(),1);}
});
test('hook80/88 сохраняетобе полныевыборкиидаётDragonMP30, aliasesиCD',()=>{
 const src=read('hook.js'),a=src.indexOf('  const petOf ='),b=src.indexOf('  // 20.12',a),box={};vm.createContext(box);vm.runInContext(src.slice(a,b)+'\nthis.petOf=petOf;this.monsterOf=monsterOf;',box);
 const c={name:'Hero',revision:100,activeBuffs:[...Array.from({length:65},(_,i)=>({skillId:1000+i})),{skillId:80},{skillId:88}],learnedBattleSkillsDetail:[{battleId:'l2_88',l2SkillId:88,level:1,mpCost:30}],battleHotbarSlots:[{k:'a',a:'detect_dragon_weakness'}],skillCooldowns:{l2_88:1792714963000,detect_dragon_weakness:1792714963000}};
 const p=box.petOf({pathname:'/character'},{character:c});assert.deepEqual(JSON.parse(JSON.stringify(p.monsterBuffs.map(x=>x.skillId))),[80,88]);assert.equal(p.learnedBattleSkillsDetail[0].mpCost,30);assert.equal(p.battleHotbarSlots[0].a,'detect_dragon_weakness');assert.equal(p.skillCooldowns.l2_88,1792714963000);
 const bstate=box.monsterOf({pathname:'/game/battle/action'},{character:c});assert.equal(bstate.learnedBattleSkillsDetail[0].mpCost,30);assert.equal(bstate.monsterBuffs.length,2);
});
test('Dragon nativeCDl2_88 истекаетпо3с безIL10с вmainиLite',()=>{
 for(const file of ['battle-cooldown.js','lite/battle-cooldown.js']){let now=10000;const box={};vm.createContext(box);vm.runInContext(read(file),box);const C=box.L2BattleCooldown.createBattleCooldown(()=>now);C.observe({action:'detect_dragon_weakness',battleSpawnId:'local'},{serverNowMs:now,skillCooldowns:{l2_88:13000}},200,'local');assert.ok(C.skillWait('detect_dragon_weakness','local')>0);now=13041;assert.equal(C.skillWait('detect_dragon_weakness','local'),0);}
});
function dragonRoles(){
 const src=read('tests/v2050-detect-monster.test.js'),a=src.indexOf('function rolesFixture()'),b=src.indexOf("test('автороли добавляют",a);
 const rows={88:['detect_dragon_weakness','Detect Dragon Weakness','Вразливість драконів',30]},ids=[88],names=s=>String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean),exact={'detect dragon weakness':88,'вразливість драконів':88};
 const box={read,vm,Date,rows,ids,names,exact};vm.createContext(box);vm.runInContext(src.slice(a,b)+'\nthis.fixture=rolesFixture;',box);return box.fixture();
}
test('автороли одинраз убираютстарыйDragonизсиловых иназначаютвnBuffs; прочиеимена/ручноеудаление сохраняются',async()=>{
 const f=dragonRoles();f.env.cfg.nBuffs='Свій бафф, Вразливість монстрів';f.env.cfg.nPower='Вихор, Вразливість драконів';f.env.cfg.nStun='Грозова буря, Detect Dragon Weakness';await f.E.autoRoles();
 assert.equal(f.env.cfg.nPower,'Вихор');assert.equal(f.env.cfg.nStun,'Грозова буря');assert.match(f.env.cfg.nBuffs,/Свій бафф/);assert.match(f.env.cfg.nBuffs,/Вразливість монстрів/);assert.match(f.env.cfg.nBuffs,/драконів/);assert.equal(f.env.rt.warlordDetectRoles2050[88],true);
 f.env.cfg.nBuffs='Свій бафф, Вразливість монстрів';await f.E.autoRoles();assert.equal(f.env.cfg.nBuffs,'Свій бафф, Вразливість монстрів');
});
test('авторолиOFF сохраняютролиDragon; потерянныйcfgACK не ставитодноразовуюотметку',async()=>{
 const f=dragonRoles();f.env.cfg.autoRoles=false;f.env.cfg.nPower='Вразливість драконів';await f.E.autoRoles();assert.equal(f.env.cfg.nPower,'Вразливість драконів');assert.equal(f.env.rt.warlordDetectRoles2050,undefined);
 const g=dragonRoles();g.env.setCfg=async()=>({ok:false});await g.E.autoRoles();assert.equal(g.env.rt.warlordDetectRoles2050,undefined);
});

for(const key of ['nPower','nStun','nForce'])test('разовоеисправление88 не стираетсвежуюручнуюправку '+key,async()=>{
 const f=dragonRoles();f.env.cfg[key]='Вихор, Вразливість драконів';let writes=0;f.env.setCfg=async p=>{writes++;Object.assign(f.env.cfg,p);return{ok:true}};
 f.box.chrome.storage.local.get=async()=>({cfg:{...f.env.cfg,[key]:'Мій новий удар'}});await f.E.autoRoles();assert.equal(writes,0);assert.equal(f.env.rt.warlordDetectRoles2050,undefined);
});

// 24.10 (лог 10:54, Dreadnought): Око мисливця359/Око вбивці360 — тот же native-самобафф боя, что80/88.
for(const id of [359,360])test('Eye '+id+' ставится native-кнопкой один раз, ценаMP с сервера, активный не повторяется',async()=>{
 const f=fixture({},id);f.env.cfg.nBuffs=f.meta.name;note(f);assert.equal(f.env.ilOf(f.b).id,id);assert.equal(f.env.ilOf(f.b).autoUse,false);assert.equal(f.C.ready(f.b),false,'не generic-бафф');
 assert.equal(await run(f),true);assert.equal(f.clicks(),1);assert.equal(Object.values(f.env.rt.monsterNativeIntent)[0].id,id);
 const g=fixture({},id);g.env.meMp=()=>({cur:f.meta.mp-1,max:100});note(g);assert.equal(await run(g),false);
 // Настоящий learned без mpCost и подсказка без «MP N» (магистр показывает MP 0): цена — верх справочника 70/71.
 const real={learnedBattleSkillsDetail:[{battleId:'l2_'+id,level:1,hintUk:'+30% P.Atk, 10 хв. Відкат 2 с.'}]},il=id===359?70:71;
 for(const name of [f.meta.name,id===359?'Eye of the Hunter':'Eye of the Slayer']){const r=fixture({},id);r.env.cfg.nBuffs=name;r.env.meMp=()=>({cur:500,max:500});note(r,real);assert.equal(await run(r),true,name);assert.equal(r.clicks(),1);}
 const low=fixture({},id);low.env.meMp=()=>({cur:il-1,max:500});note(low,real);assert.equal(await run(low),false,'MP ниже оценки');
 const none=fixture({},id);none.env.meMp=()=>({cur:500,max:500});note(none,{learnedBattleSkillsDetail:[]});assert.equal(await run(none),false,'не выучен — оценка не подставляется');
 const h=fixture({},id);note(h,{monsterBuffs:[{skillId:id,expiresAtMs:h.now()+600000}]});assert.equal(await run(h),false);
 const k=fixture({},id);k.wait(f.meta.action,3000);note(k);assert.equal(await run(k),false);
});
test('hook: eye_slayer/eye_hunter — claim и полные выборки359/360',()=>{
 const src=read('hook.js'),a=src.indexOf('  function start(u, method, req)'),b=src.indexOf('  // 20.42',a),messages=[],box={TRACK:/./,STORY_TP:/^\/never$/,ridN:0,mutationN:0,storyRetry:null,Date,Number,location:{origin:'https://local.invalid'},window:{postMessage:d=>messages.push(d)},document:{documentElement:{dataset:{l2botMonster:JSON.stringify({token:'eye',revision:7,action:'eye_slayer',at:Date.now()})}}}};
 vm.createContext(box);vm.runInContext(src.slice(a,b)+'\nthis.start=start;',box);box.start({pathname:'/game/battle/action'},'POST',{action:'eye_slayer',expectedRevision:7});
 assert.deepEqual(JSON.parse(JSON.stringify(messages[0].req)),{action:'eye_slayer',expectedRevision:7});assert.equal(messages[0].monsterToken,'eye');
 const s2=read('hook.js'),c0=s2.indexOf('  const petOf ='),c1=s2.indexOf('  // 20.12',c0),bx={};vm.createContext(bx);vm.runInContext(s2.slice(c0,c1)+'\nthis.petOf=petOf;this.monsterOf=monsterOf;',bx);
 const c={name:'Hero',revision:100,activeBuffs:[{skillId:359},{skillId:360},{skillId:1}],learnedBattleSkillsDetail:[{battleId:'eye_hunter',l2SkillId:359,level:1,mpCost:39},{battleId:'l2_360',level:1,mpCost:40}]};
 const p=bx.petOf({pathname:'/character'},{character:c});assert.deepEqual(JSON.parse(JSON.stringify(p.monsterBuffs.map(x=>x.skillId))),[359,360]);assert.equal(p.learnedBattleSkillsDetail[0].mpCost,39);
 const m=bx.monsterOf({pathname:'/game/battle/action'},{character:c});assert.equal(m.learnedBattleSkillsDetail.length,2);assert.equal(m.learnedBattleSkillsDetail[1].mpCost,40);
});
test('откаты сервера: eye_slayer→l2_360, earthquake→l2_347, shock_blast→l2_361 (main и Lite)',()=>{
 for(const file of ['battle-cooldown.js','lite/battle-cooldown.js'])for(const [a,id] of [['eye_slayer',360],['eye_hunter',359],['earthquake',347],['shock_blast',361]]){
  let now=10000;const box={};vm.createContext(box);vm.runInContext(read(file),box);const C=box.L2BattleCooldown.createBattleCooldown(()=>now);
  C.observe({action:a,battleSpawnId:'local'},{serverNowMs:now,skillCooldowns:{['l2_'+id]:14700}},200,'local');assert.ok(C.skillWait(a,'local')>0,a);now=14741;assert.equal(C.skillWait(a,'local'),0,a);}
});

// John 24.10 (скрин панели): все Вразливості и оба Ока складываются — служба ставит каждый выбранный, не один из них.
test('80, 88, 359, 360 выбраны вместе — ставятся по очереди все четыре',async()=>{
 const ids=[80,88,359,360],fx=ids.map(id=>fixture({},id)),f=fx[0];for(const g of fx.slice(1))f.panel.push(g.b);
 f.env.cfg.nBuffs=fx.map(g=>g.meta.name).join(', ');f.env.meMp=()=>({cur:4000,max:4490});
 const learned=[{battleId:'l2_80',level:1,mpCost:24},{battleId:'l2_88',level:1,mpCost:30},{battleId:'l2_359',level:1},{battleId:'l2_360',level:1}];
 const on=[],seen=[];
 for(let i=0;i<4;i++){note(f,{revision:100+i*10,learnedBattleSkillsDetail:learned,monsterBuffs:on.map(id=>({skillId:id,expiresAtMs:f.now()+600000}))});
  const plan=f.C.managedMonsterPlan(f.ctx);assert.ok(plan,'шаг '+i);assert.equal(seen.includes(plan.id),false);seen.push(plan.id);on.push(plan.id);f.advance(31);}
 assert.deepEqual([...seen].sort((a,b)=>a-b),ids);
 note(f,{revision:200,learnedBattleSkillsDetail:learned,monsterBuffs:ids.map(id=>({skillId:id,expiresAtMs:f.now()+600000}))});assert.equal(f.C.managedMonsterPlan(f.ctx),null,'все активны — не повторяем');
});

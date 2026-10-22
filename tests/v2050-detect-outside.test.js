'use strict';
// 20.50: native Detect-ID не доказывает outside усиление; подготовка только штатной панелью и своим ACK.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8'),source=read('modules/buffs.js');
const ids=[75,87,104],action={75:'detect_insect_weakness',87:'detect_animal_weakness',104:'detect_plant_weakness'};
function fixture(saved){
 let now=1792661383119,gate=true,gen=1,opened=0,nav=[],fired=[];const buttons=Object.fromEntries(ids.map(id=>[id,{id}]));
 const page={pathname:'/map.html',search:'',get href(){return this.pathname+this.search},set href(v){nav.push(v);this.pathname=v.split('?')[0];this.search=v.includes('?')?'?'+v.split('?')[1]:''}};
 const env={on:true,tabOwner:true,leaseEpoch:'lease1',cfg:{nBuffs:'Detect Animal Weakness, Detect Insect Weakness, Detect Plant Weakness'},
  rt:{char:'Hero',classCur:{prof:'human_warlord',slot:3},manualKickAt:1,dailyStart:1,...saved},routeLocation:page,
  names:s=>String(s||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean),heroNick:()=>env.rt.char,
  detectGate:()=>gate,detectTask:()=> 'farm',actionGeneration:()=>gen,detectTab:()=> 'tab1',detectLineage:()=>null,
  setRt:async p=>{Object.assign(env.rt,p);return{ok:true}},rtCommit:async()=>true,rec:()=>{},setStatus:()=>{},
  meMp:()=>({cur:500,max:500}),detectPanelOpen:async()=>{opened++},fire:b=>{fired.push(b);return true},
  detectPanel:()=>({hotbar:true,slots:ids.map(id=>({id,action:action[id],button:buttons[id],ready:true,cost:null}))})};
 const box={console,Date:class extends Date{static now(){return now}},location:page};vm.createContext(box);vm.runInContext(source,box);const B=box.L2V7Factories.buffs(env);
 const snap=(patch={})=>({name:'Hero',l2Profession:'human_warlord',classSlots:{activeSlot:3},revision:100,snapshotGeneratedAt:now,inBattle:false,mp:500,maxMp:500,skillMpCostMul:1,
  learnedBattleSkillsDetail:ids.map(id=>({battleId:'l2_'+id,level:1,hintUk:'Селф-баф на 10 хв. MP '+({75:14,87:18,104:21}[id])+', відкат 10 с.'})),
  battleHotbarSlots:ids.map(id=>({k:'a',a:action[id]})),activeBuffs:ids.map(skillId=>({skillId,expiresAtMs:now+500000,battleDerived:true})),...patch});
 const note=async(patch={},path='/character',dpatch={})=>{assert.equal(typeof B.detectOutsideNote,'function');return B.detectOutsideNote(path,{status:200,pet:snap(patch),...dpatch},now)};
 const request=async(id,revision=100,rid=7)=>B.detectOutsideRequest({path:'/character/skills/cast',method:'POST',rid,req:{battleId:'l2_'+id,expectedRevision:revision}},now);
 const ack=async(id,revision=100,rid=7,patch={})=>note({revision:revision+1,activeBuffs:ids.map(skillId=>({skillId,expiresAtMs:now+600000})),...patch},'/character/skills/cast',{rid,req:{battleId:'l2_'+id,expectedRevision:revision}});
 return{B,env,page,snap,note,request,ack,nav,fired,opened:()=>opened,now:()=>now,advance:n=>now+=n,gate:v=>gate=v,generation:()=>gen++,key:id=>JSON.stringify(['Hero','human_warlord',3,id])};
}
async function queue(f){assert.equal(typeof f.B.detectOutsideQueue,'function');return f.B.detectOutsideQueue()}
async function step(f){assert.equal(typeof f.B.detectOutsideStep,'function');return f.B.detectOutsideStep()}
test('native IDs без outside ACK не мешают создать подготовку и перейти штатно на панель',async()=>{
 const f=fixture();await f.note();assert.equal(await queue(f),true);assert.ok(f.env.rt.detectOutside);await step(f);
 assert.deepEqual(f.nav,['/skill-panel.html']);assert.equal(f.fired.length,0);
});
test('intent durable до native fire, собственный outsideACK создаёт точный proof и завершает возврат',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);await step(f);
 assert.equal(f.fired.length,1);const i=f.env.rt.detectOutsideIntent[f.key(87)];assert.ok(i&&i.id);assert.equal(i.baseRevision,100);
 await f.request(87);await f.ack(87);const p=f.env.rt.detectOutsideProof[f.key(87)];assert.equal(p.expiresAt,f.now()+600000);assert.equal(p.revision,101);
 await step(f);await step(f);assert.equal(f.env.rt.detectOutside,null);assert.equal(f.page.pathname,'/map.html');assert.equal(await queue(f),false);
});
for(const [name,change]of Object.entries({stop:f=>f.env.on=false,lease:f=>f.env.tabOwner=false,held:f=>f.gate(false),
 class:f=>f.env.rt.classCur.prof='human_gladiator',slot:f=>f.env.rt.classCur.slot=2,role:f=>f.env.cfg.nBuffs='',
 stale:f=>f.advance(30001),unknownMP:f=>f.env.meMp=()=>null,zeroMP:f=>f.env.meMp=()=>({cur:0,max:500})}))
 test('не начинает подготовку: '+name,async()=>{const f=fixture();await f.note();change(f);assert.equal(await queue(f),false);assert.equal(f.fired.length,0)});
for(const [name,patch]of Object.entries({unknownLearned:{learnedBattleSkillsDetail:null},unknownPanel:{battleHotbarSlots:null},wrongChar:{name:'Other'},wrongClass:{l2Profession:'orc_titan'},wrongSlot:{classSlots:{activeSlot:2}},inBattle:{inBattle:true},unknownRevision:{revision:null},missingBuffs:{activeBuffs:null}}))
 test('нет свежего собственного outside snapshot: '+name,async()=>{const f=fixture();await f.note(patch);assert.equal(await queue(f),false)});
for(const [name,change]of Object.entries({stop:f=>f.env.on=false,lease:f=>f.env.leaseEpoch='lease2',class:f=>f.env.rt.classCur.prof='orc_titan',
 slot:f=>f.env.rt.classCur.slot=2,role:f=>f.env.cfg.nBuffs='',generation:f=>f.generation(),mp:f=>f.env.meMp=()=>({cur:1,max:500})}))
 test('перепроверяет перед кликом после открытия панели: '+name,async()=>{
  const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);
  f.env.detectPanelOpen=async()=>{change(f)};await step(f);assert.equal(f.fired.length,0);
 });
test('native battle fallback не подтверждает outside proof',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);await step(f);await f.request(87);
 await f.note({revision:101},'/game/battle/action',{rid:7,req:{action:action[87],expectedRevision:100}});
 assert.equal(f.env.rt.detectOutsideProof?.[f.key(87)],undefined);
});
test('unknown ACK/reload возвращается к фарму без повтора того же Detect',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);await step(f);await f.request(87);
 f.advance(21000);await step(f);await step(f);assert.equal(f.page.pathname,'/map.html');
 const g=fixture(JSON.parse(JSON.stringify(f.env.rt)));g.env.cfg.nBuffs=f.env.cfg.nBuffs;await g.note({revision:101});g.advance(130000);await g.note({revision:102});
 assert.equal(await queue(g),false);assert.equal(g.fired.length,0);
});
test('proof после reload требует свежий context/revision и ровно тот outside expiry',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);await step(f);await f.request(87);await f.ack(87);
 const g=fixture(JSON.parse(JSON.stringify(f.env.rt)));g.env.cfg.nBuffs=f.env.cfg.nBuffs;g.env.rt.detectOutside=null;
 assert.equal(await queue(g),false,'без свежего character нет права на поход');
 await g.note({revision:101,activeBuffs:ids.map(skillId=>({skillId,expiresAtMs:g.now()+600000}))});assert.equal(await queue(g),false,'own proof подтверждён');
 await g.note({revision:102,activeBuffs:ids.map(skillId=>({skillId,expiresAtMs:g.now()+500000}))});assert.equal(await queue(g),true,'другой срок native ID не подтверждает outside');
});
test('старый/чужой ACK не завершает заменённое намерение',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);await step(f);await f.request(87);
 f.env.rt.detectOutsideIntent[f.key(87)]={...f.env.rt.detectOutsideIntent[f.key(87)],id:'replacement',rid:99};
 await f.ack(87);assert.equal(f.env.rt.detectOutsideProof?.[f.key(87)],undefined);
});
test('отказ записи intent не делает click и отпускает job с backoff',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);f.env.setRt=async()=>({ok:false});
 await step(f);assert.equal(f.fired.length,0);
});
test('timeout отсутствующей панели не держит маршрут бесконечно',async()=>{
 const f=fixture();await f.note();await queue(f);await step(f);f.env.detectPanel=()=>({hotbar:false,slots:[]});f.advance(13000);await step(f);await step(f);
 assert.equal(f.page.pathname,'/map.html');assert.equal(f.env.rt.detectOutside,null);
});
test('hook сохраняет native a, learned Detect hint и полный outside cast expiry дальше8 строки',()=>{
 const src=read('hook.js'),a=src.indexOf('  const petOf ='),b=src.indexOf('  // 20.12',a),box={};vm.createContext(box);vm.runInContext(src.slice(a,b)+'\nthis.petOf=petOf;',box);
 const f=fixture(),c=f.snap({activeBuffs:[...Array.from({length:12},(_,i)=>({skillId:1000+i,expiresAt:123})),{skillId:87,expiresAt:f.now()+600000}]});
 const p=box.petOf({pathname:'/character/skills/cast'},{character:c});assert.ok(p);assert.equal(p.battleHotbarSlots[0].a,action[75]);
 assert.match(p.learnedBattleSkillsDetail[0].hintUk,/MP 14/);assert.equal(p.activeBuffs.find(x=>x.skillId===87).expiresAtMs,f.now()+600000);
});

test('потерянный ACK разрешает одну новую попытку только после630с и свежего post-deadline revision',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);await step(f);await f.request(87);
 f.advance(21000);await step(f);await step(f);assert.equal(f.env.rt.detectOutside,null);assert.equal(f.env.rt.detectOutsideIntent[f.key(87)].phase,'unknown');
 f.advance(609000);assert.equal(await queue(f),false,'старый снимок после срока не становится свежим');
 await f.note({revision:100});assert.equal(await queue(f),false,'та же revision не выпускает неизвестный запрос');
 await f.note({revision:102,snapshotGeneratedAt:f.now()-1000});assert.equal(await queue(f),false,'снимок создан до полного срока');
 await f.note({revision:103});assert.equal(await queue(f),true);await step(f);await step(f);assert.equal(f.fired.length,2);
});
for(const [name,patch]of Object.entries({castable:{castableSelfBuffs:[{battleId:'l2_87',readyRemainingSec:10}]},numeric:{skillCooldowns:{l2_87:1792661383119+10000}},native:{skillCooldowns:{detect_animal_weakness:1792661383119+10000}}}))
 test('явный серверный CD запрещает outside: '+name,async()=>{const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note(patch);assert.equal(await queue(f),false);f.advance(10001);assert.equal(await queue(f),true)});
test('server CD перепроверяется после durable intent непосредственно перед fire',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);
 const save=f.env.setRt;f.env.setRt=async p=>{const r=await save(p);if(p.detectOutsideIntent)await f.note({revision:100,skillCooldowns:{l2_87:f.now()+10000}});return r};
 await step(f);assert.equal(f.fired.length,0);assert.equal(f.env.rt.detectOutsideIntent[f.key(87)].phase,'notSent');
});
for(const response of [{ok:false},{accepted:false},{blockedBy:'global'},{error:'refused'}])
 test('явный отрицательный ответ не создаёт outside proof: '+JSON.stringify(response),async()=>{
  const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);await step(f);await f.request(87);
  await f.note({revision:101},'/character/skills/cast',{rid:7,req:{battleId:'l2_87',expectedRevision:100},res:response});assert.equal(f.env.rt.detectOutsideProof?.[f.key(87)],undefined);
 });
test('outside ACK без snapshotGeneratedAt подтверждается только по собственному request и revision',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);await step(f);await f.request(87);
 await f.ack(87,100,7,{snapshotGeneratedAt:null});assert.ok(f.env.rt.detectOutsideProof?.[f.key(87)]);await step(f);await step(f);assert.equal(f.env.rt.detectOutside,null);
});
for(const stage of ['queue','nav','intent','finish'])for(const failure of ['false','commitfalse','throw'])
 test('optimistic storage '+failure+' отпускает job без повторов: '+stage,async()=>{
  const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();
  if(stage!=='queue')await queue(f);if(['intent','finish'].includes(stage))await step(f);if(stage==='finish'){await step(f);await f.request(87);await f.ack(87);await step(f);}
  if(failure==='commitfalse')f.env.rtCommit=async()=>false;
  else f.env.setRt=async p=>{Object.assign(f.env.rt,p);if(failure==='throw')throw Error('storage');return{ok:false}};
  if(stage==='queue')assert.equal(await queue(f),false);else await step(f);
  assert.equal(f.env.rt.detectOutside,null);const count=f.fired.length;await step(f);assert.equal(await queue(f),false);assert.equal(f.fired.length,count);
 });
test('переход передаёт только свежий owned snapshot в той же lineage, стартовый GET не нужен',async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);
 const g=fixture(JSON.parse(JSON.stringify(f.env.rt)));g.env.cfg.nBuffs=f.env.cfg.nBuffs;g.page.pathname='/skill-panel.html';g.env.leaseEpoch='lease2';g.env.detectLineage=()=> 'lease1';await step(g);
 assert.equal(g.fired.length,1);assert.equal(g.env.rt.detectOutsideIntent[g.key(87)].lease,'lease2');
});
for(const [name,change]of Object.entries({otherTab:g=>g.env.detectTab=()=> 'tab2',otherOwner:g=>g.env.detectLineage=()=> 'otherLease',stale:g=>g.advance(30001),stop:g=>g.env.on=false,class:g=>g.env.rt.classCur.prof='human_gladiator',role:g=>g.env.cfg.nBuffs='',manualStart:g=>g.env.rt.manualKickAt=2}))
 test('carry отвергается при смене контекста: '+name,async()=>{
  const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();await queue(f);await step(f);
  const g=fixture(JSON.parse(JSON.stringify(f.env.rt)));g.env.cfg.nBuffs=f.env.cfg.nBuffs;g.page.pathname='/skill-panel.html';g.env.leaseEpoch='lease2';g.env.detectLineage=()=> 'lease1';change(g);await step(g);assert.equal(g.fired.length,0);
 });
test('hook проецирует только numeric/native DetectCD без чужих ключей',()=>{
 const src=read('hook.js'),a=src.indexOf('  const petOf ='),b=src.indexOf('  // 20.12',a),box={};vm.createContext(box);vm.runInContext(src.slice(a,b)+'\nthis.petOf=petOf;',box);
 const f=fixture(),p=box.petOf({pathname:'/character'},{character:f.snap({skillCooldowns:{l2_87:f.now()+10000,detect_plant_weakness:f.now()+5000,l2_1:f.now()+10000,l2_75:'future'}})});
 assert.deepEqual(JSON.parse(JSON.stringify(p.skillCooldowns)),{l2_87:f.now()+10000,detect_plant_weakness:f.now()+5000});
});

function withActions(f){
 const box={Date:class extends Date{static now(){return f.now()}}};vm.createContext(box);vm.runInContext(read('modules/actions.js'),box);
 const env={get rt(){return f.env.rt},get cfg(){return f.env.cfg},get on(){return f.env.on},get tabOwner(){return f.env.tabOwner},
  mode:()=> 'farm',routeMode:()=> 'farm',lease:()=>f.env.leaseEpoch,actionGeneration:f.env.actionGeneration,
  get setRt(){return f.env.setRt},get rtCommit(){return f.env.rtCommit},setStatus:()=>{},rec:()=>{},id:()=> 'owner1',page:()=> f.page.href,
  paymentPending:()=>null,isBattle:()=>false,interrupted:()=>false,challengeHold:()=>false,jobs:()=>[{key:'detectOutside',run:f.B.detectOutsideStep}]};
 const A=box.L2V7Factories.actions(env);f.env.releaseDetectJob=id=>A.releaseExpired('detectOutside',id);A.enterFrame();return A;
}
for(const afterCast of [false,true])for(const failure of ['false','commitfalse','throw'])
 test('actual actions dispatcher storage '+failure+' не держит фарм после60с; cast='+afterCast,async()=>{
  const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';const A=withActions(f);await f.note();await queue(f);await A.dispatch();if(afterCast)await A.dispatch();
  const count=f.fired.length,savedIntent=JSON.stringify(f.env.rt.detectOutsideIntent);
  if(failure==='commitfalse')f.env.rtCommit=async()=>false;else f.env.setRt=async p=>{Object.assign(f.env.rt,p);if(failure==='throw')throw Error('storage');return{ok:false}};
  await A.dispatch();assert.ok(f.env.rt.detectOutside);f.advance(61000);await f.B.detectOutsideMaintain();
  assert.equal(f.env.rt.detectOutside,null);assert.equal(f.env.rt.actionOwner,null);assert.equal(await A.dispatch(),false);
  assert.equal(f.fired.length,count);assert.equal(JSON.stringify(f.env.rt.detectOutsideIntent),savedIntent);assert.equal(await queue(f),false);
 });
test('scoped release не трогает другой owner и не обходит lease/generation',async()=>{
 const f=fixture();const A=withActions(f);await f.note();await queue(f);await A.dispatch();const id=f.env.rt.detectOutside.id;
 assert.equal(A.releaseExpired('shop',id),false);assert.equal(A.releaseExpired('detectOutside','other'),false);
 f.env.rt.actionOwner={...f.env.rt.actionOwner,key:'shop'};assert.equal(A.releaseExpired('detectOutside',id),false);
 f.env.rt.actionOwner={...f.env.rt.actionOwner,key:'detectOutside'};f.env.leaseEpoch='lease2';assert.equal(A.releaseExpired('detectOutside',id),false);assert.ok(f.env.rt.detectOutside);
});

for(const changedActor of [true,false])test('late storage failure не очищает заменённый job actor='+changedActor,async()=>{
 const f=fixture();f.env.cfg.nBuffs='Detect Animal Weakness';await f.note();let resolve,started;
 const start=new Promise(r=>started=r);f.env.setRt=p=>{Object.assign(f.env.rt,p);started();return new Promise(r=>resolve=r)};
 const pending=queue(f);await start;if(changedActor)f.env.rt.char='Other';const replacement={id:'replacement',char:f.env.rt.char};f.env.rt.detectOutside=replacement;
 resolve({ok:false});assert.equal(await pending,false);assert.equal(f.env.rt.detectOutside,replacement);
});
test('loopGate выполняет bounded cleanup в новом owned кадре до ранних веток и dispatch режима',async()=>{
 const src=read('content.js'),a=src.indexOf('async function loopGate()'),b=src.indexOf('  if((Object.keys(cfg.limitRanges||{}).length',a),events=[];
 const box={L2V7Modules:{actions:{enterFrame:()=>events.push('frame')},buffs:{detectOutsideMaintain:async()=>events.push('cleanup')}},
  serverDown:()=>true,serverWait:async()=>events.push('server'),sleep:async()=>{}};
 vm.createContext(box);vm.runInContext(src.slice(a,b)+'}',box);await box.loopGate();assert.deepEqual(events,['frame','cleanup','server']);
});

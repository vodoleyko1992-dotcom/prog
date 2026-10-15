'use strict';
// 10.0.21 (лог 15.10 00:49): полный HP-delta DPS Uruka переносится на другого РБ только при том же составе.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./warlock-fixture.cjs');
const source=fs.readFileSync(path.join(__dirname,'../modules/raid.js'),'utf8');
const URUKA='l2dop_rb_25527',HEKATON='l2dop_rb_25299',DPS=49804;
const uruka={hp:10727566,patk:12479,matk:9729,pdef:8600,mdef:9949,src:'api'};
const hekaton={hp:5500896,patk:7714,matk:6088,pdef:9511,mdef:10842,src:'api'};
function make() {
 const f=fixture({cfg:{petFullAuto:false},rt:{classCur:{prof:'human_arcana_lord',slot:0}}}),env=f.env;
 Object.assign(f.ch,{level:77,l2Profession:'human_arcana_lord',mAtk:8000,pAtk:1300,pDef:1400,mDef:1100,maxHp:14917,
  activeBuffs:[{skillId:1356,level:1,expiresAtMs:f.now()+3600000}]});
 env.shotContext=()=> 'BSPS-S:on';f.api().noteSnapshot(f.ch);
 Object.assign(env.cfg,{rbProbe:false,rbRetreatHp:20,stopHp:25,rbRestHp:95,rbMaxKillMin:20});
 Object.assign(env.rt,{rbDb:{},rbStats:{[URUKA]:{...uruka},[HEKATON]:{...hekaton},next:{...uruka,patk:1000,matk:1000}},
  rbList:{[URUKA]:{lvl:80},[HEKATON]:{lvl:80},next:{lvl:80}},fightMem:{[URUKA]:{dps:5197}},petStat:{kai_the_cat:{dmg:999999999,hits:100}}});
 Object.assign(env,{warlock:f.api(),heroLvl:()=>f.ch.level,meHp:()=>({cur:14171,max:f.ch.maxHp,pct:95}),logLines:()=>[],newLines:()=>[],activeBuffs:()=>[],
  potModel:()=>({H:600,C:2,n:1000,rate:2000,pool:568000}),epicOn:()=>false,epicById:()=>null,fmtT:x=>String(Math.round(x)),fmtK:x=>String(Math.round(x))});
 const box={console,Math,Number,Date:{now:f.now}};box.globalThis=box;vm.runInNewContext(source,box);
 f.R=box.L2V7Factories.raid(env);env.rbNote=f.R.rbNote;
 f.ctx={name:'Uruka',rb:{id:URUKA,samples:[],hits:[]}};
 f.sample=(sec,dps=DPS)=>{f.api().noteSnapshot(f.ch);return f.R.rbAssess(f.ctx,env.meHp(),{cur:uruka.hp-sec*dps,max:uruka.hp});};
 f.measure=(seconds=25,dps=DPS)=>{for(let i=0;i<=seconds;i++){if(i)f.tick(1000);f.sample(i,dps);}return f;};
 return f;
}
const approx=(a,b)=>assert.ok(Math.abs(a-b)<0.01,`${a} != ${b}`);
const baseline=()=>1150*.85;
test('измеренный Uruka снимает ложный отказ Hekaton по времени, не используя неполный fightlab DPS',()=>{
 const f=make(),env=f.env;env.rt.rbDb[HEKATON]={sp:2500,hitP90:200};
 assert.equal(f.R.rbPreCheck(HEKATON,hekaton).kind,'unmeasured');f.measure();
 const expected=DPS*.8*Math.min(8600/9511,9949/10842);approx(f.R.rbDpsOn(HEKATON),expected);
 const v=f.R.rbPreCheck(HEKATON,hekaton);assert.equal(v.ok,true);assert.ok(v.t<180);assert.match(v.why,/по другому РБ/);
 env.rt.rbPreSkip={[HEKATON]:{t:f.now(),kind:'slow'}};assert.equal(f.R.rbTeleportCheck(HEKATON,{lvl:80},true),null);
});
test('точный собственный замер имеет приоритет, кот второй раз не добавляется',async()=>{
 const f=make().measure();approx(f.R.rbDpsOn(URUKA),DPS);approx(f.R.rbDpsOn('next'),DPS*.8);
 await f.R.rbDpsLearn('next',12345);assert.equal(f.R.rbDpsOn('next'),12345);
});
for(const [kind,change,expected] of [
 ['физическая защита',s=>s.pdef*=2,DPS*.4],['магическая защита',s=>s.mdef*=4,DPS*.2],
 ['меньшая защита',s=>{s.pdef/=2;s.mdef/=2;},DPS*.8]
])test('перенос консервативен: '+kind,()=>{const f=make().measure();change(f.env.rt.rbStats.next);approx(f.R.rbDpsOn('next'),expected);});
test('более высокий уровень снижает перенос; более низкий не повышает его',()=>{
 const f=make().measure();f.env.rt.rbList.next.lvl=85;approx(f.R.rbDpsOn('next'),DPS*.8*.6/.85);
 f.env.rt.rbList.next.lvl=70;approx(f.R.rbDpsOn('next'),DPS*.8);
});
test('переход к другой цели сохраняет powerKey, но не точный ключ DPS/потери HP',()=>{
 const f=make(),a=f.api().raidContext(URUKA,uruka),b=f.api().raidContext(HEKATON,hekaton);
 assert.ok(a.powerKey);assert.equal(a.powerKey,b.powerKey);assert.notEqual(a.key,b.key);
 f.measure();assert.equal(f.env.rt.rbStats.next.loss,undefined);
});
for(const kind of ['hero','class','slot','level','heroBuff','heroStats','petType','petRank','petBuff','petStats','resummon','shots','unknownShots','missingPet','expired'])test('другой состав не получает старый перенос: '+kind,()=>{
 const f=make().measure(),env=f.env;
 if(kind==='hero'){env.rt.char='other';f.ch.name='other';}
 if(kind==='class'){env.rt.classCur.prof='human_warlock';f.ch.l2Profession='human_warlock';}
 if(kind==='slot'){env.rt.classCur.slot=1;f.ch.classSlots.activeSlot=1;}
 if(kind==='level')f.ch.level++;
 if(kind==='heroBuff')f.ch.activeBuffs=[];
 if(kind==='heroStats')f.ch.maxHp=14674;
 if(kind==='petType')f.ch.activeSummon.key='mew_the_cat';
 if(kind==='petRank')f.ch.activeSummon.summonSkillLevel++;
 if(kind==='petBuff')f.ch.activeSummon.activeBuffs=[{skillId:4699,level:3,expiresAtMs:f.now()+60000}];
 if(kind==='petStats')f.ch.activeSummon.pAtk++;
 if(kind==='resummon')env.rt.petBornT=f.now();
 if(kind==='shots')env.shotContext=()=> 'BSPS-S:off';
 if(kind==='unknownShots')env.shotContext=()=> 'unknown';
 if(kind==='missingPet')f.ch.activeSummon=null;
 if(kind==='expired')f.tick(31000);else f.api().noteSnapshot(f.ch);
 assert.ok(f.R.rbDpsOn('next')<1200);
});
test('истёкший бафф без нового GET немедленно блокирует перенос',()=>{
 const f=make();f.ch.activeBuffs[0].expiresAtMs=f.now()+26000;f.measure();f.tick(1001);approx(f.R.rbDpsOn('next'),baseline());
});
test('свежий снимок прежнего состава не оживляет межбоссовый источник старше 30 минут',()=>{
 const f=make().measure();f.tick(f.env.rt.rbDpsSample.t+30*60000-f.now());f.api().noteSnapshot(f.ch);approx(f.R.rbDpsOn('next'),DPS*.8);
 f.tick(1);f.api().noteSnapshot(f.ch);approx(f.R.rbDpsOn('next'),baseline());approx(f.R.rbDpsOn(URUKA),DPS);
});
test('источник без времени или с будущим/нечисловым временем не переносится',()=>{
 for(const bad of [undefined,NaN,Infinity,'wrong','1792000000000']){const f=make().measure();f.env.rt.rbDpsSample.t=bad;assert.ok(f.R.rbDpsOn('next')<1200);}
 const f=make().measure();f.env.rt.rbDpsSample.t=f.now()+1;approx(f.R.rbDpsOn('next'),baseline());
});
for(const kind of ['sourceDefense','targetDefense','sourceLevel','targetLevel','sourceEstimated','targetEstimated','sourceEpic','targetEpic'])test('неполные цифры и эпики исключены: '+kind,()=>{
 const f=make(),env=f.env;
 if(kind==='sourceDefense')delete env.rt.rbStats[URUKA].mdef;
 if(kind==='targetDefense')delete env.rt.rbStats.next.pdef;
 if(kind==='sourceLevel')delete env.rt.rbList[URUKA];
 if(kind==='targetLevel')delete env.rt.rbList.next;
 if(kind==='sourceEstimated')env.rt.rbStats[URUKA].est=true;
 if(kind==='targetEstimated')env.rt.rbStats.next.est=true;
 if(kind==='sourceEpic')env.rt.rbStats[URUKA].kind='epic';
 if(kind==='targetEpic')env.rt.rbStats.next.kind='epic';
 f.measure();assert.ok(f.R.rbDpsOn('next')<1200);
});
test('цифры из встроенного справочника тоже доступны до первого посещения цели',()=>{
 const f=make().measure();delete f.env.rt.rbStats[HEKATON];assert.ok(f.R.rbDpsOn(HEKATON)>30000);
});
test('нет переноса из короткого окна или единственного критического удара',()=>{
 const short=make().measure(8);assert.equal(short.env.rt.rbDpsSample,undefined);approx(short.R.rbDpsOn('next'),baseline());
 const burst=make();for(let i=0;i<=25;i++){if(i)burst.tick(1000);burst.sample(i,i?200000/i:0);}assert.equal(burst.env.rt.rbDpsSample,undefined);
});
test('перерыв, смена баффа или перепризыв до 20 секунд сбрасывают окно, а не учат смешанный DPS',()=>{
 for(const change of ['pause','buff','resummon']){const f=make().measure(15);if(change==='pause')f.tick(20000);else if(change==='buff')f.ch.activeBuffs=[];else f.env.rt.petBornT=f.now();
  for(let i=16;i<=30;i++){f.tick(1000);f.sample(i);}assert.equal(f.env.rt.rbDpsSample,undefined);approx(f.R.rbDpsOn('next'),baseline());}
});
test('перепризыв после полного замера сбрасывает также точный DPS того же босса',()=>{
 const f=make().measure();f.env.rt.petBornT=f.now();f.api().noteSnapshot(f.ch);approx(f.R.rbDpsOn(URUKA),baseline());
});
test('перенос не создаёт новый источник и не накапливает резерв при выборе цепочки целей',()=>{
 const f=make().measure(),raw=JSON.stringify(f.env.rt.rbDpsSample);assert.ok(f.env.rt.rbDpsSample);
 for(let i=0;i<5;i++){f.R.rbDpsOn(HEKATON);f.R.rbPreCheck('next',f.env.rt.rbStats.next);approx(f.R.rbDpsOn('next'),DPS*.8);}
 assert.equal(JSON.stringify(f.env.rt.rbDpsSample),raw);assert.equal(f.env.rt.rbDb.next,undefined);
});
test('старый голый DPS и прямое обучение конкретной цели не выдают себя за полный HP-delta источник',async()=>{
 const f=make();f.env.rt.rbDps=60000;await f.R.rbDpsLearn(URUKA,DPS);assert.equal(f.env.rt.rbDpsSample,undefined);approx(f.R.rbDpsOn('next'),baseline());
});
test('исходные защиты сохраняются с окном и не подменяются поздним обновлением чужой цели',()=>{
 const f=make().measure();f.env.rt.rbStats[URUKA].pdef*=5;approx(f.R.rbDpsOn(HEKATON),DPS*.8*Math.min(8600/9511,9949/10842));
});
test('точный запрет времени сообщает о переносе; проверки спецудара и банок остаются',()=>{
 const f=make().measure(),st=f.env.rt.rbStats.next;
 let v=f.R.rbPreCheck('next',{...st,hp:100000000});assert.equal(v.kind,'slow');assert.match(v.why,/по другому РБ/);assert.doesNotMatch(v.why,/состав ещё не измерен/);
 f.env.rt.rbDb.next={sp:8000,hitP90:100};assert.equal(f.R.rbPreCheck('next',st).kind,'strong');
 f.env.rt.rbDb.next={sp:1000,hitP90:100};f.env.potModel=()=>({rate:2000,pool:0});
 assert.equal(f.R.rbPreCheck('next',{...st,patk:5000}).kind,'pots');
});
for(const [name,pool,rate,allowed] of [['нулевой запас',0,2000,false],['медленное лечение',568000,100,false],['достаточный запас и скорость',568000,2000,true]])test('проба сильного спецудара проверяет банки: '+name,()=>{
 for(const measured of [false,true]){const f=make();if(measured)f.measure();f.env.cfg.rbProbe=true;
  f.env.potModel=()=>({pool,rate});const st={...f.env.rt.rbStats.next,hp:100000,patk:5000,matk:9000};f.env.rt.rbStats.next=st;
  const v=f.R.rbPreCheck('next',st);assert.ok(v.spPct>60&&v.spPct<80);assert.equal(v.ok,allowed);assert.equal(!!v.probe,allowed);
 }
});
test('первая проба неизвестного Hekaton требует запас на замер, а не на ложные 92 минуты',()=>{
 const f=make();f.env.cfg.rbProbe=true;
 for(const [pool,allowed] of [[0,false],[1000,false],[25000,true]]){f.env.potModel=()=>({pool,rate:2000});const v=f.R.rbPreCheck(HEKATON,hekaton);assert.equal(v.ok,allowed);assert.equal(!!v.probe,allowed);}
});
test('короткий резерв пробы не отменяет медленные банки или точно измеренный долгий бой',async()=>{
 const f=make();f.env.cfg.rbProbe=true;f.env.potModel=()=>({pool:25000,rate:100});assert.equal(f.R.rbPreCheck(HEKATON,hekaton).ok,false);
 f.env.potModel=()=>({pool:25000,rate:2000});await f.R.rbDpsLearn(HEKATON,1000);assert.equal(f.R.rbPreCheck(HEKATON,hekaton).kind,'slow');
});
test('замер сохраняется отдельно при смене класса и восстанавливается со своим классом',()=>{
 const f=make().measure(),old=JSON.stringify(f.env.rt.rbDpsSample),box={console,Date,sessionStorage:{getItem(){},setItem(){}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/story.js'),'utf8'),box);const S=box.L2V7Factories.story(f.env);
 S.classNote('dwarf_warsmith',1,77);assert.equal(f.env.rt.rbDpsSample,null);assert.equal(JSON.stringify(f.env.rt.classStash.human_arcana_lord.rbDpsSample),old);
 S.classNote('human_arcana_lord',0,77);assert.equal(JSON.stringify(f.env.rt.rbDpsSample),old);
});

// Сравнение CPU и неблокирующей записи с базой f104195; все сети заблокированы.
'use strict';
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),{chromium}=require(process.env.PLAYWRIGHT_NODE||'playwright'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.argv[2]||path.join(root,'work/warlord-metrics-perf.json'));
fs.mkdirSync(path.dirname(out),{recursive:true});
const baseline=p=>cp.execFileSync('git',['show','f104195:'+p],{cwd:root,encoding:'utf8'}),patched=p=>fs.readFileSync(root+'/'+p,'utf8');
const versions={baseline:{content:baseline('content.js'),lab:baseline('modules/fightlab.js')},patched:{content:patched('content.js'),lab:patched('modules/fightlab.js')}};
for(const v of Object.values(versions)){
 const c=v.content;v.hash={content:crypto.createHash('sha256').update(c).digest('hex'),fightlab:crypto.createHash('sha256').update(v.lab).digest('hex')};
 v.names=c.slice(c.indexOf('const ACT_NAMES ='),c.indexOf('const gameBusy ='))+'\n'+c.slice(c.indexOf('const actName = a =>'),c.indexOf('L2V7Modules.fightlab =',c.indexOf('const actName = a =>')))+'\nreturn {actNameSnap,actName};';
 v.helpers=c.slice(c.indexOf('const cleanTitle ='),c.indexOf('function slotKind('))+'\n'+c.slice(c.indexOf('const slotAction ='),c.indexOf('\n',c.indexOf('const slotAction =')))+'\n'+c.slice(c.indexOf('function observeOwner()'),c.indexOf('\n',c.indexOf('function observeOwner()')));
 delete v.content;
}
const hook=patched('hook.js');const hookFns=hook.slice(hook.indexOf('  const btOf ='),hook.indexOf('  const pvOf ='))+';return {btOf,battleOf};';
const actual=JSON.parse(patched('tests/fixtures/warlord-metrics-20261022.json'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||chromium.executablePath(),headless:true,args:['--no-sandbox','--disable-background-networking']});
 try{
  const page=await browser.newPage();let requests=0;await page.route('**/*',r=>{requests++;return r.abort()});
  await page.setContent('<!doctype html><body><div id="panel"></div></body>');
  const result=await page.evaluate(({versions,actual,hookFns})=>{
   const panel=document.querySelector('#panel');const names=['Заряд душі воїна','Зілля зцілення','Зілля мани','Вразливість комах','Вразливість звірів','Бойовий клич','Звіриний рев','Грозова буря','Атака','Бойовий рик','Провокація масова','Вихор','Жорстка стійка','Зосереджений удар','Азарт бою','Дикий розмах'];
   const ids=['shot','battle_potion_hp','battle_potion_mp','detect_insect_weakness','detect_animal_weakness','war_cry','howl','thunder_storm','attack','battle_roar','provoke','whirlwind','vicious_stance','focus_attack','thrill_fight','wild_sweep'];
   for(let i=0;i<30;i++){const b=document.createElement('button');b.className='l2-battle-hotbar-slot';b.title=names[i%names.length]+' (MP 49) — опис';const id=ids[i%ids.length];if(i%3===0){const img=document.createElement('img');img.setAttribute('data-slot-cd',id);b.append(img);}else b.setAttribute('data-slot-cd',id);panel.append(b);}
   const rt={char:'AuditHero',classCur:{prof:'human_warlord',slot:3},classSwT:0},leaseEpoch=1;
   const apis={};for(const [k,v]of Object.entries(versions))apis[k]=new Function('rt','leaseEpoch',v.helpers+'\n'+v.names)(rt,leaseEpoch);
   const hook=new Function('SECRET',hookFns)(/password|token|session|secret/i);
   let logicalNow=100000;const factories={};for(const [k,v]of Object.entries(versions))factories[k]=new Function('Date',v.lab+'\nreturn globalThis.L2V7Factories.fightlab;')({now:()=>logicalNow});
   const stats=a=>{const s=a.toSorted((a,b)=>a-b);return{median:s[Math.floor(s.length/2)],p90:s[Math.min(s.length-1,Math.floor(s.length*.9))],min:s[0],max:s.at(-1),samples:a};};
   const nameSamples={baseline:[],patched:[]};
   for(let w=0;w<3000;w++)for(const api of Object.values(apis))api.actNameSnap();
   for(let round=0;round<15;round++)for(const k of (round%2?['patched','baseline']:['baseline','patched'])){const api=apis[k],n=4000,t=performance.now();for(let i=0;i<n;i++)api.actNameSnap();nameSamples[k].push((performance.now()-t)/n);}
   function payloads(race){let rid=0,revision=439225;const data=[];for(let i=0;i<120;i++){
    const spawn='metrics_'+i,extras=['Lilim Magus','Lilim Magus','Nephilim Priest'].map((name,j)=>({spawnId:spawn+'_side_'+j,name,mobHp:2628,mobMaxHp:2628})),character=mp=>({name:'AuditHero',l2Profession:'human_warlord',classSlots:{activeSlot:3},hp:10159,maxHp:10159,mp,maxMp:1016});
    const push=(path,raw,action='',victory=false)=>{const req={action,battleSpawnId:spawn,expectedRevision:revision};if(path!=='/game/battle')raw.revision=++revision;else raw.revision=revision;const d={status:200,ms:275,rid:++rid,req,res:raw,bt:hook.btOf({pathname:path},raw),be:hook.battleOf({pathname:path},raw,req)};data.push({path,d,action,victory});};
    push('/game/battle/start',{character:character(418),battle:{spawnId:spawn,mobName:'Lilim Magus',kind:'normal',mobHp:2628,mobMaxHp:2628,log:actual.log.slice(0,1)}});
    push('/game/battle/action',{character:character(364),battle:{spawnId:spawn,mobName:'Lilim Magus',kind:'normal',mobHp:2628,mobMaxHp:2628,whirlwindExtras:extras,log:actual.log.slice(0,5)}},i%2?'howl':'provoke');
    if(race&&i%4===0){revision++;push('/game/battle',{character:character(325),victory:{spawnId:spawn,mobName:'Lilim Magus',fullLog:actual.log}});revision--;}
    push('/game/battle/action',{character:character(325),victory:{spawnId:spawn,mobName:'Lilim Magus',fullLog:actual.log}},'whirlwind',true);
   }return data;}
   const datasets={normal:payloads(false),sameRevisionGet:payloads(true)};
   function run(k,scenario,serialize=false,stall=false){logicalNow=100000;let writes=0,soon=0,bytes=0,lastPackBytes=0,accepted=0;const keys={};const env={rt:{char:'AuditHero',prof:'human_warlord',lvl:51,classCur:{prof:'human_warlord',slot:3},zone:'Branded',sessT0:1000,manualKickAt:1},cfg:{stopHp:25},routeLocation:{search:'?spawnId=metrics_0'},recoveryContext:()=> 'fixture-gear-buffs',actName:apis[k].actName,rec:()=>{},pvpPending:()=>false,mobTitle:()=> 'Lilim Magus'};
    env.setRt=p=>{writes++;for(const key of Object.keys(p))keys[key]=(keys[key]||0)+1;Object.assign(env.rt,p);if(serialize){const n=JSON.stringify(p).length;bytes+=n;if(p.packLab)lastPackBytes=n;}return stall?new Promise(()=>{}):Promise.resolve({ok:true});};env.setRtSoon=p=>{soon++;Object.assign(env.rt,p);return Promise.resolve({ok:true});};
    const lab=factories[k](env);let thenables=0;const t=performance.now();for(const {path,d,action,victory}of datasets[scenario]){if(path!=='/game/battle')logicalNow+=1000;if(action)apis[k].actNameSnap();if(victory)panel.remove();const r=lab.onNet(path,d);if(r&&typeof r.then==='function')thenables++;if(r?.action)accepted++;if(victory)document.body.append(panel);}const ms=performance.now()-t;
    return {ms,setRtCalls:writes,setRtSoonCalls:soon,serializedAllCallBytes:bytes,lastPackPayloadBytes:lastPackBytes,keys,thenables,accepted,logicalElapsedMs:logicalNow-100000,rows:env.rt.packLab?.samples.length,totals:env.rt.packLab?.totals.n};}
   const metrics={};for(const scenario of Object.keys(datasets)){metrics[scenario]={};for(let w=0;w<3;w++){run('baseline',scenario);run('patched',scenario);}const samples={baseline:[],patched:[]};for(let round=0;round<13;round++)for(const k of(round%2?['patched','baseline']:['baseline','patched']))samples[k].push(run(k,scenario).ms);for(const k of Object.keys(samples))metrics[scenario][k]={timing:stats(samples[k]),instrumentation:run(k,scenario,true),stalledStorage:run(k,scenario,false,true)};}
   return {browser:navigator.userAgent,slots:30,actionsPerRound:240,battlesPerRound:120,nameSnapshotMs:Object.fromEntries(Object.entries(nameSamples).map(([k,v])=>[k,stats(v)])),metrics};
  },{versions,actual,hookFns});
  result.externalRequests=requests;result.sources=Object.fromEntries(Object.entries(versions).map(([k,v])=>[k,v.hash]));result.baselineCommit='f104195a718b9b4ecdc2232f38f9ab36576c5190';result.limitations=['Exact functions and real DOM in Chrome151, not full MV3 scheduler.','Local setRt/setRtSoon stubs update memory and count calls; they do not measure actual extension background storage latency.','All browser network blocked; payloads use real hook projection of a saved33-line victory.','Microbenchmark measures synchronous CPU with240 accepted actions/120battles per sample; no live-game throughput claim.'];
  fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

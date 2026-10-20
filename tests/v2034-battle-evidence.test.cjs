'use strict';
// 20.10: реальные hook fetch/XHR → безопасные доказательства → запись и TXT, без сервера игры.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),plain=x=>JSON.parse(JSON.stringify(x));
function fixture(payload){
 const out=[],response=new Response(JSON.stringify(payload),{headers:{'content-type':'application/json'}});
 const window={postMessage:x=>out.push(x),fetch:async()=>response,alert(){}};
 class X{open(){} send(){this.status=200;this.responseType='json';this.response=payload;this.end()}addEventListener(_,cb){this.end=cb}getResponseHeader(){return 'application/json'}}
 vm.runInNewContext(read('hook.js'),{window,location:{href:'https://l2wap.com/battle.html',origin:'https://l2wap.com',host:'l2wap.com'},URL,URLSearchParams,FormData,XMLHttpRequest:X,performance:{now:()=>1}});
 return {out,window,X,response,async fetch(url='/game/battle/action',init={method:'POST',body:JSON.stringify({action:'l2_181',battleSpawnId:'dense_fixture',expectedRevision:42})}){
  const r=await window.fetch(url,init);for(let i=0;i<20&&!out.some(x=>x.__l2bot==='net');i++)await new Promise(resolve=>setImmediate(resolve));return {r,event:out.find(x=>x.__l2bot==='net')};
 }};
}
function payload(){return {revision:43,character:{name:'PrivateHero',login:'private-value',hp:6000,maxHp:6195,mp:18,maxMp:874,l2Profession:'human_warlord',classSlots:{activeSlot:1}},
 delta:{mobHp:0,mobMaxHp:2484,characterMp:18,logSeq:65,serverNowMs:10000,
 logTail:Array.from({length:65},(_,i)=>`Строка ${i}: `+'урон соседу −123. '.repeat(25)),
 whirlwindExtras:Array.from({length:31},(_,i)=>({spawnId:'mob_'+i,name:'Цель '+i,mobHp:0,mobMaxHp:2484,token:'private-value'})),
 skillCooldowns:[{skillId:181,readyAt:20000,remainingSec:10,token:'private-value'}]},
 victory:{spawnId:'dense_fixture',mobName:'Garden Guard',adena:123292,sp:19820,exp:0,fullLog:['Полный итог боя','Получено 123292 адены']},token:'private-value'};}
function recorder(){
 const source=read('content.js'),a=source.indexOf('const netSeen ='),b=source.indexOf('const cooldownDiagSeen =',a),events=[];
 const box={cfg:{rec:true},pageLeaving:false,NET_NOISE:/\/sync$/,privateNet:p=>/chat/.test(p),hashStr:x=>x,rec:(...args)=>events.push(args),Date};
 assert.ok(a>=0&&b>a);vm.runInNewContext(source.slice(a,b)+';globalThis.record=recordNetworkLog;',box);
 return {events,box,record(d,path='/game/battle/action'){box.record(d,path,`${d.method} ${path}`,JSON.stringify(d.res||{}),false)}};
}
function formatter(){
 const source=read('popup.js'),a=source.indexOf('const pad ='),b=source.indexOf('function download(',a),box={Date};
 assert.ok(a>=0&&b>a);vm.runInNewContext(source.slice(a,b)+';globalThis.api={fmtEv,exportEventLine,fitTail};',box);return box.api;
}
test('fetch preserves the original response and every target/long line beyond redact and bt limits',async()=>{
 const p=payload(),f=fixture(p),{r,event}=await f.fetch(),be=event.be;
 assert.equal(r,f.response);assert.deepEqual(await r.json(),p);assert.equal(be.schema,1);assert.equal(be.extras.length,31);assert.equal(be.extras[30].id,'mob_30');
 assert.equal(be.log.total,65);assert.equal(be.log.lines.length,65);assert.ok(be.log.lines[0].length>200);assert.equal(be.log.omitted,0);
 assert.equal(be.log.seq,65);assert.equal(be.seq,65);assert.equal(be.request.expectedRevision,42);assert.equal(be.request.action,'l2_181');assert.equal(be.request.spawn,'dense_fixture');
 assert.equal(be.hp,6000);assert.equal(be.mp,18);assert.equal(be.win,true);assert.equal(be.end,true);assert.equal(be.reward.adena,123292);assert.equal(be.reward.sp,19820);
 assert.equal(be.finalLog.source,'victory.fullLog');assert.equal(be.cooldowns[0].readyAt,20000);
 assert.equal(event.rid,f.out.find(x=>x.__l2bot==='netStart').rid);
 assert.doesNotMatch(JSON.stringify(be),/private-value|PrivateHero|login|token/);
});
test('XHR JSON passes the same evidence schema and request correlation',async()=>{
 const p=payload(),a=await fixture(p).fetch(),f=fixture(p),x=new f.X();x.open('POST','/game/battle/action');x.send(JSON.stringify({action:'l2_181',battleSpawnId:'dense_fixture',expectedRevision:42}));
 const e=f.out.find(x=>x.__l2bot==='net');assert.deepEqual(plain(e.be),plain(a.event.be));assert.equal(e.rid,f.out.find(x=>x.__l2bot==='netStart').rid);
});
test('full battle and final-only responses identify their actual log source',async()=>{
 for(const [p,source] of [[{battle:{spawnId:'a',log:['Начало'],logSeq:1}},'battle.log'],[{defeat:{spawnId:'b',fullLog:['Поражение']}},'defeat.fullLog']]){
  const {event}=await fixture(p).fetch('/game/battle',{method:'GET'});assert.equal(event.be.log.source,source);assert.equal(event.be.finalLog,null);
 }
});
test('non-battle routes and foreign hosts do not expose a battle block',async()=>{
 const {event}=await fixture(payload()).fetch('/character',{method:'GET'});assert.equal(event.be,undefined);
 const f=fixture(payload());await f.window.fetch('https://other.invalid/game/battle/action');await new Promise(r=>setImmediate(r));assert.equal(f.out.length,0);
});
test('rejected actions, spoil and DEFEAT retain the server reason and actual outcome',async()=>{
 const {event}=await fixture({ok:false,error:'skill_cooldown',messageUk:'Зачекайте відкат',blockedBy:'skill',cooldownUntilMs:12345,outcome:'DEFEAT',delta:{spoilAttemptResult:{success:false,message:'Спойл не прошёл'}}}).fetch();
 assert.equal(event.be.ok,false);assert.equal(event.be.error,'skill_cooldown');assert.equal(event.be.message,'Зачекайте відкат');assert.equal(event.be.timing.cooldownUntilMs,12345);assert.equal(event.be.spoil.ok,false);assert.equal(event.be.lose,true);assert.equal(event.be.end,true);
});
test('large packets have explicit row, character, extra-target and cooldown omissions',async()=>{
 const p=payload();p.delta.logTail=Array.from({length:500},(_,i)=>'Строка '+i+' '+ 'я'.repeat(3000));p.delta.whirlwindExtras=Array.from({length:300},(_,i)=>({id:i,mobHp:1}));p.delta.skillCooldowns=Array.from({length:150},(_,i)=>({skillId:i,readyAt:20000}));
 const {event}=await fixture(p).fetch(),b=event.be;assert.equal(b.log.total,500);assert.equal(b.log.omitted+b.log.lines.length,500);assert.ok(b.log.omitted>300);assert.ok(b.log.shortened>0);
 assert.ok(b.log.lines.every(x=>x.length<=2048));assert.ok(b.log.lines.join('').length<=32768);assert.match(b.log.lines.at(-1),/Строка 499/);assert.equal(b.log.shortened,b.log.lines.length);
 assert.equal(b.extras.length,256);assert.equal(b.cut.extras,44);assert.equal(b.cooldowns.length,128);assert.equal(b.cut.cooldowns,22);assert.ok(JSON.stringify(b).length<100000);
});
test('whitelisted log objects do not retain arbitrary fields; inline credential labels are hidden',async()=>{
 const p={delta:{logTail:[{text:'Урон 123; token=private-value',password:'private-value'},{message:'Bearer private-value'},{line:'password=private-value'}],skillCooldowns:{password:123,l2_181:{readyAtMs:123,session:'private-value'}}}};
 const {event}=await fixture(p).fetch();assert.doesNotMatch(JSON.stringify(event.be),/private-value|password|session/);assert.equal(event.be.cooldowns.length,1);
});
test('identical POSTs and HTTP failures each retain a separate request ID',async()=>{
 const be=(await fixture(payload()).fetch()).event.be,f=recorder();
 for(const rid of [1,2,3])f.record({url:'/game/battle/action',method:'POST',status:200,rid,be});
 for(const rid of [4,5])f.record({url:'/game/battle/action',method:'POST',status:409,rid,be});
 assert.equal(f.events.length,5);assert.deepEqual(f.events.map(x=>x[3].data.rid),[1,2,3,4,5]);assert.equal(f.events[0][3].data.r,undefined);
});
test('battle sync suppresses unchanged polls but retains each new turn even inside three seconds',async()=>{
 const be=plain((await fixture(payload()).fetch()).event.be),f=recorder(),d={url:'/game/battle/sync',method:'GET',status:200,be};
 f.record(d,'/game/battle/sync');be.timing.serverNowMs+=1000;be.cooldowns[0].remainingSec--;f.record(d,'/game/battle/sync');assert.equal(f.events.length,1);
 be.seq++;be.mobHp=10;f.record(d,'/game/battle/sync');assert.equal(f.events.length,2);
 f.record({...d,status:503},'/game/battle/sync');f.record({...d,status:503},'/game/battle/sync');assert.equal(f.events.length,4);
});
test('recorder respects disabled logging, page leave and private routes',async()=>{
 const be=(await fixture(payload()).fetch()).event.be,f=recorder(),d={url:'/game/battle/action',method:'POST',status:200,be};
 f.box.cfg.rec=false;f.record(d);f.box.cfg.rec=true;f.box.cfg.netLog=false;f.record(d);f.box.cfg.netLog=true;f.box.pageLeaving=true;f.record({...d,error:'no response'});assert.equal(f.events.length,0);
 f.box.pageLeaving=false;f.record(d,'/game/chat/send');assert.deepEqual(plain(f.events[0][3].data),{q:'(приватно)'});
});
test('ordinary GET polling remains bounded while ordinary POSTs are not deduplicated',()=>{
 const f=recorder(),d={url:'/game/map/sync',method:'GET',status:200,res:{a:1}};
 f.record(d,'/game/map/sync');f.record({...d,res:{a:2}},'/game/map/sync');assert.equal(f.events.length,1);
 f.record({...d,method:'POST'},'/game/map/sync');f.record({...d,method:'POST'},'/game/map/sync');assert.equal(f.events.length,3);
});
test('TXT carries the entire bounded block past 4000 characters and fitTail drops whole events',async()=>{
 const be=plain((await fixture(payload()).fetch()).event.be),f=formatter(),e={t:1,src:'N',kind:'сеть',what:'POST /game/battle/action → 200',data:{rid:9,battle:be}},line=f.exportEventLine(e);
 assert.ok(line.length>4000);const saved=JSON.parse(line.slice(line.indexOf('| бой: ')+7));assert.deepEqual(saved,{rid:9,...be});assert.equal(saved.extras.at(-1).id,'mob_30');assert.equal(saved.reward.adena,123292);
 assert.match(f.exportEventLine({...e,data:{r:'x'.repeat(5000)}}),/событие сокращено/);
 assert.equal(f.fitTail([line,line],Buffer.byteLength(line,'utf8')+1).cut,1);assert.equal(f.fitTail([line,line],Buffer.byteLength(line,'utf8')+1).keep[0],line);
});

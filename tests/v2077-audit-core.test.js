'use strict';
// 20.76+ (ревизия кода 28.10, группа core): удержание серии ЛС при выбранном Rebirth, сверка неизвестной попытки ЛС
// в Rebirth и дедлайн чтения тела ответа у своего POST (gamePost).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const src=fs.readFileSync(path.join(__dirname,'..','content.js'),'utf8');
const cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i,'найден фрагмент '+a);return src.slice(i,j);};

// ---------- fire() и gamePost: hold серии ЛС не держит Rebirth, pending держит всегда ----------
function fireBox(autoLs,rebirth){
 const box={actionNote(){},console,L2V7Modules:{pvp:{pending:()=>false}},on:true,running:true,tabOwner:true,invBusy:false,rt:{autoLs},abHold:()=>false,
  rebirthModeSelected:()=>rebirth,PointerEvent:class{constructor(t){this.type=t;}},MouseEvent:class{constructor(t){this.type=t;}}};
 box.window=box;vm.createContext(box);vm.runInContext(cut('function fire(el)','// Single-writer settings update.')+'\nthis.fire=fire;',box);return box;
}
function button(){const b={clicks:0,scrollIntoView(){},getBoundingClientRect:()=>({left:0,top:0,width:10,height:10}),dispatchEvent:e=>{if(e.type==='click')b.clicks++;}};return b;}
function postBox(autoLs,rebirth){
 let fetched=0;const box={rt:{autoLs},on:true,tabOwner:true,rebirthModeSelected:()=>rebirth,actionNote(){},gameAuth:()=>({}),AbortController,setTimeout,clearTimeout,
  L2V7Modules:{lifestone:{consumePermit:()=>false,consumeSupplyPermit:()=>false}},fetch:async()=>{fetched++;return{ok:true,status:200,json:async()=>({})};}};
 vm.createContext(box);vm.runInContext(cut('async function gamePost(','async function gameGet(')+'\nthis.post=gamePost;',box);return{box,fetched:()=>fetched};
}
const HOLDS={running:{hold:true,status:'running'},userPause:{hold:true,status:'paused',userHold:true,reason:'Пауза игрока'},prepared:{hold:true,status:'paused',reason:'Серия подготовлена; нажмите «Продолжить»'}};

for(const [kind,ls] of Object.entries(HOLDS))test('Rebirth: удержание серии ЛС ('+kind+') не глушит клики и POST подземелий',async()=>{
 const f=fireBox(ls,true),b=button();assert.equal(f.fire(b),true);assert.equal(b.clicks,1,'клик отправлен');
 const p=postBox(ls,true);const r=await p.box.post('/game/rebirth-raids/enter-boss',{bossSlot:3});assert.equal(r.ok,true);assert.equal(p.fetched(),1);
});
for(const [kind,ls] of Object.entries(HOLDS))test('обычный режим: удержание серии ЛС ('+kind+') по-прежнему блокирует клики и POST',async()=>{
 const f=fireBox(ls,false),b=button();assert.equal(f.fire(b),false);assert.equal(b.clicks,0);
 const p=postBox(ls,false);await assert.rejects(()=>p.box.post('/game/drops-shop/buy',{}),/lifestone_session_active/);assert.equal(p.fetched(),0);
});
for(const rebirth of [true,false])test('неизвестная попытка/покупка ЛС (pending) блокирует клики и POST в любом режиме, Rebirth='+rebirth,async()=>{
 const ls={hold:true,status:'paused',pending:{id:'p',t:1,revision:5}},f=fireBox(ls,rebirth),b=button();assert.equal(f.fire(b),false);assert.equal(b.clicks,0);
 const p=postBox(ls,rebirth);await assert.rejects(()=>p.box.post('/game/rebirth-raids/enter-boss',{bossSlot:3}),/lifestone_session_active/);assert.equal(p.fetched(),0);
});
test('fire() и gamePost проверяют удержание ЛС одним и тем же условием',()=>{
 const guard='(rt.autoLs?.pending || rt.autoLs?.hold && !rebirthModeSelected())';
 assert.ok(cut('function fire(el)','// Single-writer settings update.').includes('if (!login && '+guard+') return false;'));
 assert.ok(cut('async function gamePost(','async function gameGet(').includes('if ('+guard+' && !(path === '));
});

// ---------- loopGate: в Rebirth неизвестная попытка ЛС сверяется, а не ждётся без конца ----------
function gate({autoLs,rebirth=true,busy=false,battle=false}){
 const S={steps:0,status:[],sleeps:0};
 const box={on:true,tabOwner:true,cfg:{},rt:{autoLs},lifestoneCommandBusy:busy,console,
  L2V7Modules:{actions:{enterFrame(){}},buffs:{},pvp:{recoveryStep:async()=>false},craft:{},lifestone:{step:async()=>{S.steps++;},yieldToUrgent:async()=>false}},
  serverDown:()=>false,loginPage:()=>false,antibotState:()=>null,dailyServerSync:async()=>false,actionWait:async()=>true,rebirthModeSelected:()=>rebirth,
  isBattle:()=>battle,victory:()=>false,setStatus:s=>S.status.push(s),sleep:async()=>{S.sleeps++;},lsTvtPoll(){},tvtSoon:()=>false,lsTvtRegOpen:()=>false,
  limitSyncDue:()=>false};
 vm.createContext(box);vm.runInContext(cut('async function loopGate()','  // 20.43 (разбор 21.10): ожидание подготовки кота перед РБ')+'\n return "next";\n}\nthis.loopGate=loopGate;',box);
 return{box,S};
}
test('Rebirth + pending ЛС: каждый круг зовёт шаг ЛС (сверка GET раз в 15 с), подземелья ждут',async()=>{
 const g=gate({autoLs:{hold:true,status:'paused',pending:{id:'p',t:1,revision:5}}});
 assert.equal(await g.box.loopGate(),true);assert.equal(g.S.steps,1,'сверка ЛС запущена');assert.ok(g.S.status.some(s=>/ЛС/.test(s)));
});
test('Rebirth + только hold: шаг ЛС не зовётся, круг идёт дальше к подземельям',async()=>{
 const g=gate({autoLs:{hold:true,status:'paused',userHold:true}});assert.equal(await g.box.loopGate(),'next');assert.equal(g.S.steps,0);
});
test('Rebirth + команда ЛС игрока в работе: ожидание без шага (шаг мог бы начать попытку серии)',async()=>{
 const g=gate({autoLs:{hold:true,status:'running'},busy:true});assert.equal(await g.box.loopGate(),true);assert.equal(g.S.steps,0);
});
test('Rebirth + pending в незавершённом бою: шлюз не держит бой (как прежде)',async()=>{
 const g=gate({autoLs:{hold:true,pending:{id:'p',t:1}},battle:true});assert.equal(await g.box.loopGate(),'next');assert.equal(g.S.steps,0);
});
test('обычный режим: hold/pending по-прежнему уходят в шаг ЛС',async()=>{
 for(const ls of [{hold:true,status:'running'},{hold:false,pending:{id:'p',t:1}}]){const g=gate({autoLs:ls,rebirth:false});assert.equal(await g.box.loopGate(),true);assert.equal(g.S.steps,1);}
});

// ---------- gamePost: дедлайн охватывает и чтение тела ответа ----------
function realPost(){
 const delays=[];
 // Время стенда сжато: дедлайн заголовков (8 с) — 2 с настоящих, дедлайн тела (≥15 с) — 0,3 с настоящих.
 const box={rt:{},on:true,tabOwner:true,rebirthModeSelected:()=>false,actionNote(){},gameAuth:()=>({}),AbortController,clearTimeout,fetch,L2V7Modules:{},
  setTimeout:(fn,ms)=>{delays.push(ms);return setTimeout(fn,ms>=15000?300:2000);}};
 vm.createContext(box);vm.runInContext(cut('async function gamePost(','async function gameGet(')+'\nthis.post=gamePost;',box);return{post:box.post,delays};
}
async function server(handler){
 const sockets=new Set(),s=http.createServer(handler);s.on('connection',c=>{sockets.add(c);c.on('close',()=>sockets.delete(c));});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));
 return{url:'http://127.0.0.1:'+s.address().port+'/x',close:()=>{for(const c of sockets)c.destroy();return new Promise(r=>s.close(r));}};
}
const within=(p,ms)=>Promise.race([p.then(v=>({v}),e=>({e})),new Promise(r=>setTimeout(()=>r({hang:true}),ms))]);

test('зависшее тело ответа POST прерывается дедлайном, а не держит цикл бесконечно',async()=>{
 const s=await server((req,res)=>{req.resume();res.writeHead(200,{'Content-Type':'application/json'});res.write('{"run":');});   // тело не досылается
 try{
  const {post,delays}=realPost();const r=await post(s.url,{bossSlot:3},8000);assert.equal(r.status,200);
  const out=await within(r.json(),3000);
  assert.ok(!out.hang,'json() не должен висеть');assert.ok(out.e,'чтение тела прервано');assert.equal(out.e.name,'AbortError');
  assert.ok(delays.length>=2&&delays.at(-1)>=15000,'после заголовков взведён отдельный дедлайн тела не короче 15 с: '+delays);
 }finally{await s.close();}
});
test('обычный ответ, прочитанный после короткой паузы, разбирается полностью',async()=>{
 const s=await server((req,res)=>{req.resume();res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true,"n":7}');});
 try{
  const {post}=realPost();const r=await post(s.url,{},8000);
  await new Promise(x=>setTimeout(x,60));   // короткая пауза до чтения (как запись памяти у вызывающих) не обрывает ответ
  assert.deepEqual(JSON.parse(JSON.stringify(await r.json())),{ok:true,n:7});
 }finally{await s.close();}
});
test('отказ до отправки (Stop/замок) бросается без fetch и без таймеров',async()=>{
 const {post,delays}=realPost();let calls=0;
 const box={rt:{},on:false,tabOwner:true,rebirthModeSelected:()=>false,actionNote(){},gameAuth:()=>({}),AbortController,clearTimeout,setTimeout:(...a)=>{delays.push(a[1]);return setTimeout(...a);},
  L2V7Modules:{},fetch:async()=>{calls++;return{ok:true};}};
 vm.createContext(box);vm.runInContext(cut('async function gamePost(','async function gameGet(')+'\nthis.post=gamePost;',box);
 await assert.rejects(()=>box.post('/x',{}),/bot_inactive/);assert.equal(calls,0);assert.equal(delays.length,0);assert.equal(typeof post,'function');
});

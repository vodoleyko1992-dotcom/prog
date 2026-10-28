'use strict';
// Лог28.10 04:59: отдельный Rebirth отменял tbuff восстановления после смерти.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const E=require(process.env.L2_ENGINE_SOURCE||path.join(__dirname,'..','engine-core.js'));
const clone=x=>structuredClone(x);
function own(kind='death'){
 const cfg={autoTasks:['rebirth','tvt','petbuff'],rebirthMode:true,petFullAuto:true},rt={char:'Hero',classCur:{prof:'human_wizard',slot:0},manualKickAt:42};
 const marker={kind,char:'Hero',prof:'human_wizard',slot:0,kick:42,actor:'own-actor',revision:100};
 rt.tbuff={step:'restore',set:null,fa:[],back:'/rebirth-raids.html',rebirthRecovery:marker};
 return{cfg,rt,marker,job:rt.tbuff};
}

test('свой death/prepare маршрут разрешён отдельно и через настоящий taskJobAllowed',()=>{
 for(const kind of ['death','prepare']){const f=own(kind),saved=JSON.stringify(f);const view=E.taskConfig(f.cfg,()=>f.rt);
  assert.equal(E.rebirthBuffJob(f.cfg,f.rt),true);assert.equal(E.rebirthBuffJob(view,f.rt),true);
  assert.equal(E.taskJobAllowed(view,'tbuff',f.rt),true);assert.equal(JSON.stringify(f),saved,'чистая политика не меняет память или настройки');
 }
});

test('явный другой список задач и выключенный legacy не разрешают собственный Rebirth маршрут',()=>{
 for(const cfg of [{autoTasks:[],rebirthMode:true},{autoTasks:['farm'],rebirthMode:true},{rebirthMode:false},{}]){
  const f=own();assert.equal(E.rebirthBuffJob(cfg,f.rt),false);assert.equal(E.rebirthBuffJob(E.taskConfig(cfg),f.rt),false);
 }
 const f=own();assert.equal(E.rebirthBuffJob({rebirthMode:true},f.rt),true,'явный legacy Rebirth сохраняется');
});

for(const [label,edit] of [
 ['нет маркера',f=>delete f.job.rebirthRecovery],['неизвестная роль',f=>f.marker.kind='raid'],['пустая роль',f=>f.marker.kind=''],
 ['другой герой',f=>f.marker.char='Other'],['другой класс',f=>f.marker.prof='human_warlock'],['другой слот',f=>f.marker.slot=1],
 ['новая команда',f=>f.marker.kick=43],['чужой текущий герой',f=>f.rt.char='Other'],['чужой текущий класс',f=>f.rt.classCur.prof='human_warlock'],
 ['чужой текущий слот',f=>f.rt.classCur.slot=1],['другая текущая команда',f=>f.rt.manualKickAt=43],
 ['чужая карта возврата',f=>f.job.back='/map.html'],['чужая рыбалка',f=>f.job.back='/fishing.html'],['неполный каталог',f=>f.job.back='/rebirth-raids.html?new=1'],
 ['пустой actor',f=>f.marker.actor=''],['пробельный actor',f=>f.marker.actor='  '],['нет actor',f=>delete f.marker.actor],['числовой actor',f=>f.marker.actor=42],
 ['пустой герой',f=>{f.marker.char='';f.rt.char='';}],['пробельный герой',f=>{f.marker.char='  ';f.rt.char='  ';}],
 ['пустой класс',f=>{f.marker.prof='';f.rt.classCur.prof='';}],['пробельный класс',f=>{f.marker.prof=' ';f.rt.classCur.prof=' ';}],
 ['отрицательный слот',f=>{f.marker.slot=-1;f.rt.classCur.slot=-1;}],['дробный слот',f=>{f.marker.slot=.5;f.rt.classCur.slot=.5;}],
 ['строковый слот',f=>{f.marker.slot='0';f.rt.classCur.slot='0';}],['нет classCur',f=>delete f.rt.classCur],
 ['отрицательная команда',f=>{f.marker.kick=-1;f.rt.manualKickAt=-1;}],['бесконечная команда',f=>{f.marker.kick=Infinity;f.rt.manualKickAt=Infinity;}],
 ['NaN команда',f=>{f.marker.kick=NaN;f.rt.manualKickAt=NaN;}],['строковая команда',f=>{f.marker.kick='42';f.rt.manualKickAt='42';}],
 ['нет команды в маркере',f=>delete f.marker.kick],['отрицательная ревизия',f=>f.marker.revision=-1],['дробная ревизия',f=>f.marker.revision=1.1],
 ['строковая ревизия',f=>f.marker.revision='100'],['null ревизия',f=>f.marker.revision=null],['бесконечная ревизия',f=>f.marker.revision=Infinity],
 ['небезопасная ревизия',f=>f.marker.revision=Number.MAX_SAFE_INTEGER+1],['массив вместо маркера',f=>f.job.rebirthRecovery=Object.assign([],f.marker)],
 ['null маршрут',f=>f.rt.tbuff=null],['массив вместо маршрута',f=>f.rt.tbuff=Object.assign([],f.job)]
])test('чужой/повреждённый маршрут запрещён: '+label,()=>{
 const f=own();edit(f);assert.equal(E.rebirthBuffJob(f.cfg,f.rt),false);assert.equal(E.taskJobAllowed(E.taskConfig(f.cfg),'tbuff',f.rt),false);
});

test('команда0 и отсутствие ручной команды совместимы, ревизия необязательна',()=>{
 const f=own();delete f.rt.manualKickAt;f.marker.kick=0;delete f.marker.revision;
 assert.equal(E.rebirthBuffJob(f.cfg,f.rt),true);assert.equal(E.taskJobAllowed(f.cfg,'tbuff',f.rt),true);
});

test('возраст и этап buff/restore не отменяют собственную связь и не создают новый таймер зависания',()=>{
 const f=own();for(const t of [0,1,Date.now()-86400000,Date.now()+86400000])for(const step of ['restore','town']){
  f.job.t=t;f.job.step=step;assert.equal(E.rebirthBuffJob(f.cfg,f.rt),true);
 }
});

test('явный аргумент job проверяется самостоятельно без записи в rt',()=>{
 const f=own(),other={...clone(f.job),rebirthRecovery:{...f.marker,char:'Other'}},saved=JSON.stringify(f.rt);
 assert.equal(E.rebirthBuffJob(f.cfg,f.rt,f.job),true);assert.equal(E.rebirthBuffJob(f.cfg,f.rt,other),false);
 assert.equal(E.rebirthBuffJob(f.cfg,f.rt,null),false);assert.equal(JSON.stringify(f.rt),saved);
});

test('маркер не разрешает старые обычные баффы или чужие службы и не меняет квитанции',()=>{
 const f=own();f.rt.actionPayments={pending:{kind:'shop',id:'receipt'}};f.rt.rebirth={pending:{id:'entry'}};
 const saved=JSON.stringify(f.rt);
 for(const key of ['shop','invScan','bagCheck','faScan','recipeScan','farmScan','zoneScan','sealEx','detectOutside','petBufferTrip','magister','mmJob','storyJob','tsJob','rbGo','rbHunt','zoneGo','rbScan','fishSvc','fishService','dailyFish','dailyRb','enchantJob','subTrip'])
  assert.equal(E.taskJobAllowed(E.taskConfig(f.cfg),key,f.rt),false,key);
 assert.equal(E.taskJobAllowed(f.cfg,'revive',f.rt),true);assert.equal(E.taskJobAllowed(f.cfg,'rebirthJob',f.rt),true);
 const unmarked={...f.rt,tbuff:{step:'restore',back:'/rebirth-raids.html',manual:true,urgent:true}};
 assert.equal(E.taskJobAllowed(f.cfg,'tbuff',unmarked),false);assert.equal(JSON.stringify(f.rt),saved);
});

for(const mode of ['farm','fish','craft'])test('старая собственная подготовка не становится обычным городским маршрутом: '+mode,()=>{
 const f=own();f.cfg.autoTasks=[mode];f.cfg.rebirthMode=false;assert.equal(E.taskJobAllowed(f.cfg,'tbuff',f.rt),false);
});

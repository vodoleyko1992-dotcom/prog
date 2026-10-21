'use strict';
// 20.41 (выгрузка 20.10): событие «КД сервера» клало строку spawnId в data.battle — formatter TXT
// разворачивал её посимвольно ({"0":"l","1":"2",…}), а сами поля КД не печатал. Теперь поля — в data.cd.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function cooldownLogger(){
 const s=read('content.js'),a=s.indexOf('const cooldownDiagSeen ='),b=s.indexOf('const netOutage =',a),events=[];
 assert.ok(a>=0&&b>a);
 const box={cfg:{rec:true},rec:(...x)=>events.push(x),battleSpawn:()=>'l2dop_fallback',Date,Map,Object};
 vm.runInNewContext(s.slice(a,b)+';globalThis.log=logCooldownApi;',box);return {events,log:box.log};
}
function formatter(){
 const s=read('popup.js'),a=s.indexOf('const pad ='),b=s.indexOf('function download(',a),box={Date};
 assert.ok(a>=0&&b>a);vm.runInNewContext(s.slice(a,b)+';globalThis.api={fmtEv,exportEventLine};',box);return box.api;
}
test('КД сервера: поля в data.cd, spawn строкой, без data.battle',()=>{
 const {events,log}=cooldownLogger();
 log({req:{action:'l2_1220',battleSpawnId:'l2_spawn_77'},status:200,res:{delta:{globalCooldownUntilMs:12345,skillCooldowns:{l2_1220:15000},serverNowMs:10000}}},'/game/battle/action');
 assert.equal(events.length,1);const data=JSON.parse(JSON.stringify(events[0][3].data));
 assert.equal(data.battle,undefined);assert.equal(data.cd.spawn,'l2_spawn_77');assert.equal(data.cd.globalCooldownUntilMs,12345);
 assert.deepEqual(data.cd.skillCooldowns,[['l2_1220',15000]]);assert.equal(data.cd.action,'l2_1220');
 const line=formatter().exportEventLine({t:1,src:'N',kind:'КД сервера',what:'x',data});
 assert.match(line,/\| кд: \{.*"spawn":"l2_spawn_77".*"globalCooldownUntilMs":12345/);
 assert.match(line,/"skillCooldowns":\[\["l2_1220",15000\]\]/);
 assert.doesNotMatch(line,/"0":"l"|\| бой:/);
});
test('старое событие с data.battle-строкой печатается без разложения по символам',()=>{
 const f=formatter(),line=f.exportEventLine({t:1,src:'N',kind:'КД сервера',what:'x',data:{action:'attack',battle:'l2dop_rb_5',globalCooldownUntilMs:999,status:200}});
 assert.doesNotMatch(line,/"0":"l"|\| бой:/);
 assert.match(line,/\| кд: \{.*"spawn":"l2dop_rb_5"/);assert.match(line,/"globalCooldownUntilMs":999/);
 // длинное старое событие со строкой режется по общим 4000, а не обходит лимит как объект боя
 const big=f.exportEventLine({t:1,src:'N',kind:'сеть',what:'x',data:{battle:'s',r:'y'.repeat(5000)}});
 assert.match(big,/событие сокращено/);
});
test('объект боя v2034 печатается по-прежнему',()=>{
 const line=formatter().exportEventLine({t:1,src:'N',kind:'сеть',what:'POST',data:{rid:9,battle:{schema:1,hp:5}}});
 assert.match(line,/\| бой: \{"rid":9,"schema":1,"hp":5\}/);assert.doesNotMatch(line,/\| кд:/);
});

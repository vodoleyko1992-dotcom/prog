'use strict';
// 20.13 (ревизия 17.10, шаг 5, quality/L2): fightlab.flush снимал dirty до записи и глотал отказ (ownership_lost,
// character_changed) — память боя терялась до следующего боя молча. Теперь отказ возвращает dirty, следующий flush
// повторяет запись, а в журнал пишется одна строка «ошибки». Плюс таймер замка в content.js больше не глотает ошибку.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../hook.js','utf8');
const btOf=vm.runInNewContext(source.slice(source.indexOf('  const btOf = '),source.indexOf('  const pvOf ='))+';btOf');
const sequence=require('./fixtures/olkuth-battle-sequence.json');
const boss='Last Lesser Giant Olkuth',spawn=sequence[0].data.battle.spawnId;
function fixture(answers){
 let now=100000,rid=0;const rt={char:'Hero',classCur:{prof:'warlock',slot:0}},box={Date:{now:()=>now},URLSearchParams},writes=[],recs=[];
 const env={rt,cfg:{},routeLocation:{search:'?spawnId='+spawn},mobTitle:()=>boss,actName:x=>x,
  setRt:p=>{if(!('fightMem' in p))return Promise.resolve({ok:true});writes.push(p);const a=answers.shift()||'ok';
   if(a==='throw')return Promise.reject(new Error('Extension context invalidated'));
   if(a==='fail')return Promise.resolve({ok:false,reason:'ownership_lost'});Object.assign(rt,p);return Promise.resolve({ok:true});},
  rec:(...a)=>recs.push(a)};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../modules/fightlab.js','utf8'),box);const L=box.L2V7Factories.fightlab(env);
 const send=(path,data,at=now+1000,id=++rid)=>{now=at;return L.onNet(path,{status:200,rid:id,req:{action:'test-action'},res:data,bt:btOf({pathname:path},data)})};
 return{rt,L,send,writes,recs};
}
const settle=()=>new Promise(r=>setImmediate(r));
async function fight(f){for(const e of sequence)f.send(e.path,e.data,100000+e.at);await settle();}
for(const kind of ['fail','throw'])test(`отказ записи (${kind}) не теряет память боя: следующий flush повторяет`,async()=>{
 const f=fixture([kind,'ok']);await fight(f);
 assert.ok(f.writes.length>=1,'победа над РБ пишет память боя');const n=f.writes.length;
 assert.equal(f.rt.fightMem,undefined,'первая запись отклонена');
 f.L.flush();await settle();
 assert.equal(f.writes.length,n+1,'dirty вернулся — запись повторена');
 assert.ok(f.rt.fightMem&&Object.keys(f.rt.fightMem).length,'память боя сохранена со второй попытки');
 assert.equal(f.recs.filter(r=>r[1]==='ошибки').length,1,'сбой записан в журнал одной строкой');
 f.L.flush();await settle();assert.equal(f.writes.length,n+1,'после успеха лишних записей нет');
});
test('успешная запись не повторяется и не пишет «ошибки»',async()=>{
 const f=fixture([]);await fight(f);const n=f.writes.length;assert.ok(n>=1);f.L.flush();await settle();
 assert.equal(f.writes.length,n);assert.equal(f.recs.filter(r=>r[1]==='ошибки').length,0);
});
test('content.js: таймер замка сообщает ошибку через quietErr (раз в 10 мин на тег)',()=>{
 const c=fs.readFileSync(__dirname+'/../content.js','utf8');
 assert.match(c,/\} catch \(e\) \{ quietErr\('замок', e\); \}\n\}, 5000\);/);
 const i=c.indexOf('const quietErrs'),j=c.indexOf('\n}',c.indexOf('function quietErr'))+2;
 let now=0;const recs=[];const box={Date:{now:()=>now},rec:(...a)=>recs.push(a),String,Object};
 vm.runInNewContext(c.slice(i,j)+';this.q=quietErr;',box);
 box.q('замок',new Error('a'));box.q('замок',new Error('b'));now=300000;box.q('замок',new Error('c'));
 assert.equal(recs.length,1);assert.match(recs[0][2],/замок: a/);
 now=700000;box.q('замок',new Error('d'));assert.equal(recs.length,2);assert.match(recs[1][2],/замок: d \(×3 за 10 мин\)/);
});

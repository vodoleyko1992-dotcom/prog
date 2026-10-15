'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const file=path.join(__dirname,'v1021-raid-farm-lifecycle.test.js'),source=fs.readFileSync(file,'utf8'),box={require:require('node:module').createRequire(file),__dirname,console,process};vm.runInNewContext(source.slice(0,source.indexOf('\ntest('))+'\nthis.make=fixture;',box);
test('one living but unsafe preparation candidate cannot starve fresh Gordon page13 during idle',async()=>{
 const f=box.make({cfg:{rbHuntMode:false}}),g='l2dop_rb_29095',now=Date.now();
 f.env.cfg.rbMaxBelow=9;f.env.cfg.rbMaxAbove=15;
 f.env.rt.rbList={unsafe:{name:'Unsafe',lvl:80,page:13,alive:true,price:100000,unit:'аден',t:now-180000},[g]:{name:'Gordon',lvl:80,page:13,alive:false,price:100000,unit:'аден',t:now-180000}};
 f.env.rt.rbStats.unsafe={hp:6000000,patk:1000000,matk:1000000,pdef:9000,mdef:10000};
 f.env.rt.rbStats[g]={...f.env.rt.rbStats.one};
 f.env.rt.rbHunt={step:'pick',phase:'wait'};f.env.rt.rbHuntIdle=now+300000;f.env.rt.rbListT=now-180000;
 f.env.rt.rbIdleMark={lvl:80,pots:500,t:now,sampleT:f.env.rt.rbDpsSample.t,kills:0,adena:1000000};
 assert.equal(f.R.rbTourPlan().ready.length,0);assert.equal(f.R.rbTourPlan().blocked.find(x=>x.id==='unsafe').kind,'no');assert.equal(f.R.rbPreparationCandidates()[0].id,'unsafe');
 const timerBox={Date,console,sessionStorage:{getItem:()=>null,setItem(){}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/rbtimer.js'),'utf8'),timerBox);
 const gets=[];f.env.rbTimer=timerBox.L2V7Factories.rbtimer({...f.env,heroLevel:()=>80,gameGet:async url=>{gets.push(url);return{ok:true,json:async()=>({page:13,totalPages:14,bosses:Object.entries(f.env.rt.rbList).map(([id,x])=>({spawnId:id,name:x.name,level:x.lvl,bossType:'raid',isAlive:true,adenaCost:100000,canAttack:true}))})}}});
 await f.R.rbHuntStep();
 assert.deepEqual(gets,['/game/raid-bosses?page=13']);assert.equal(f.env.rt.rbList[g].alive,true);assert.equal(f.env.rt.rbHuntIdle,0);assert.equal(f.R.rbTourPlan().ready[0].id,g);
 await f.R.rbHuntStep();assert.equal(f.env.rt.rbHunt.id,g);assert.equal(f.env.rt.rbHunt.step,'go');
});
test('empty tour reports unsafe boss names and exact reasons only when changed, at most once per30s',()=>{
 const raid=fs.readFileSync(path.join(__dirname,'../modules/raid.js'),'utf8');let now=1800000000000;const logs=[],env={rt:{},setRt:async p=>Object.assign(env.rt,p),rec:(...a)=>logs.push(a.join(' '))};
 const b={env,Date:class extends Date{static now(){return now}}};vm.runInNewContext(raid.slice(raid.indexOf("let rbTourViewSig ="),raid.indexOf('function rbListWhy(')),b);
 const plan={ready:[],blocked:[{id:'l2dop_rb_29095',name:'Gordon',lvl:80,kind:'no',why:'не по силам (оценка)',detail:'опасная комбинация спецудара и двух обычных ударов'}]};
 b.rbTourPublish(plan);assert.equal(logs.length,1);assert.match(logs[0],/Gordon \(80\): опасная комбинация/);
 now+=1000;plan.blocked[0].detail='свежая оценка: спецудар выше резерва';b.rbTourPublish(plan);assert.equal(logs.length,1);
 now+=30000;b.rbTourPublish(plan);assert.equal(logs.length,2);assert.match(logs[1],/выше резерва/);
 now+=30000;b.rbTourPublish(plan);assert.equal(logs.length,2);
});

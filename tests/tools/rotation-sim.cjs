'use strict';
// Сравнительная офлайн-модель: эмпирический урон + явно обозначенные сценарные допущения.
// Это не сервер игры и не копия всего боевого движка расширения.
const fs=require('node:fs'),path=require('node:path');
const IDS={attack:1,wild_sweep:2,whirlwind:3,thunder_storm:4,provoke:5,howl:6,spoil:7,festival:8};
function mix(x){x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);return(x^(x>>>16))>>>0;}
function random(seed,...keys){let x=mix(seed);for(const k of keys)x=mix(x^(k>>>0));return(x+.5)/4294967296;}
const mean=a=>a.reduce((s,x)=>s+x,0)/Math.max(1,a.length),median=a=>a.slice().sort((a,b)=>a-b)[a.length>>1];
function policies(cls){
 const a=cls==='warlord'?['none','provoke','howl','provoke_first','howl_first']:['none','solo1','solo4','solo12','festival_if_available'];
 const b=cls==='warlord'?['whirlwind_first','storm_first','max_damage','attack_finish']:['attack_only','sweep_first','cheap_finish','group_value'];
 return a.flatMap(support=>b.map(damage=>({id:support+'__'+damage,support,damage})));
}
function scenarios(cls){
 if(cls==='warlord')return[
  {id:'dense31',available:31,initial:1,settle:true,regen:4,potionDelay:.6},
  {id:'dense21',available:21,initial:1,settle:true,regen:4,potionDelay:.6},
  {id:'medium8',available:8,initial:1,settle:true,regen:4,potionDelay:.6},
  {id:'natural4',available:4,initial:4,settle:false,regen:4,potionDelay:.6},
  {id:'solo',available:1,initial:1,settle:false,regen:4,potionDelay:.6},
  {id:'strict31',available:31,initial:1,settle:false,regen:4,potionDelay:.6},
  {id:'strict21',available:21,initial:1,settle:false,regen:8,potionDelay:0},
  {id:'dense31_no_potions',available:31,initial:1,settle:true,regen:4,potionDelay:1.6,noPotions:true}
 ];
 return[
  {id:'known_solo',available:1,initial:1,festival:false,chance:.55,attackScale:1,sweepRatio:1.8,regen:4,potionDelay:.6},
  {id:'known_group4',available:4,initial:4,festival:false,chance:.55,attackScale:1,sweepRatio:1.8,regen:4,potionDelay:.6},
  {id:'known_weak_sweep',available:4,initial:4,festival:false,chance:.55,attackScale:.8,sweepRatio:1,regen:4,potionDelay:.6},
  {id:'known_strong_sweep',available:4,initial:4,festival:false,chance:.55,attackScale:1.3,sweepRatio:3,regen:4,potionDelay:.6},
  {id:'upgrade_festival_solo',available:1,initial:1,festival:true,chance:.55,attackScale:1,sweepRatio:1.8,regen:4,potionDelay:.6},
  {id:'upgrade_festival_group4',available:4,initial:4,festival:true,chance:.55,attackScale:1,sweepRatio:1.8,regen:4,potionDelay:.6},
  {id:'known_chance45',available:4,initial:4,festival:false,chance:.45,attackScale:.8,sweepRatio:1.8,regen:0,potionDelay:1.6},
  {id:'upgrade_chance75_no_potions',available:4,initial:4,festival:true,chance:.75,attackScale:1,sweepRatio:1.8,regen:4,potionDelay:1.6,noPotions:true}
 ];
}
function definitions(model,cls,phase,sc){
 const W=model.warlord.damage,sample=k=>W[k][phase==='train'?'train':'validation'];
 const defs={attack:{mp:0,cd:1.6,samples:sample('attack'),targets:4},wild_sweep:{mp:37,cd:12.3,samples:sample('wild_sweep'),targets:1},whirlwind:{mp:49,cd:4.9,samples:sample('whirlwind'),targets:4},thunder_storm:{mp:67,cd:14.5,samples:sample('thunder_storm'),targets:4},provoke:{mp:57,cd:7.9,pull:31},howl:{mp:31,cd:3.3,pull:21},spoil:{mp:19,cd:.3},festival:{mp:73,cd:10}};
 if(cls==='spoiler'){
  defs.attack={...defs.attack,cd:1.5,samples:sample('attack').map(x=>x*sc.attackScale)};
  defs.wild_sweep={...defs.wild_sweep,mp:22,cd:17,samples:sample('wild_sweep').map(x=>x/mean(sample('wild_sweep'))*mean(defs.attack.samples)*sc.sweepRatio)};
  for(const k of ['whirlwind','thunder_storm','howl','provoke'])delete defs[k];
  if(!sc.festival)delete defs.festival;
 }
 for(const d of Object.values(defs))if(d.samples)d.mean=mean(d.samples);
 return defs;
}
function freshTotals(){return{battles:0,seconds:0,kills:0,spoilUnits:0,dropUnits:0,markedMain:0,potions:0,mpSpent:0,actions:{},capped:0};}
function add(a,b){for(const k of Object.keys(a))if(k==='actions'){for(const [id,n]of Object.entries(b.actions))a.actions[id]=(a.actions[id]||0)+n;}else a[k]+=b[k];return a;}
function rate(t,cls){return 3600*(cls==='spoiler'?t.spoilUnits:t.kills)/Math.max(.001,t.seconds);}
// Одна серия: MP/личные откаты не обнуляются на каждом мобе.
function episode(model,cls,policy,{seed,index,phase,battles=100,scenarioOverride,warmup=0}={}){
 const allSc=scenarios(cls),sc=scenarioOverride||allSc[index%allSc.length],defs=definitions(model,cls,phase,sc),profile=model[cls],targets=profile.targets;
 const S={time:0,mp:profile.maxMp,cd:{},potAt:0};let R=freshTotals(),scoreStart=0,executedCapped=0;
 const advance=dt=>{S.time+=dt;S.mp=Math.min(profile.maxMp,S.mp+dt*sc.regen);};
 const ready=k=>!!defs[k]&&(S.cd[k]||0)<=S.time+1e-8;
 const afford=k=>S.mp>=defs[k].mp||!sc.noPotions;
 function potion(){if(sc.noPotions||S.time<S.potAt||S.mp>=profile.maxMp*.9)return false;advance(sc.potionDelay);S.mp=Math.min(profile.maxMp,S.mp+500);S.potAt=S.time+1;R.potions++;return true;}
 for(let b=0;b<battles;b++){
  if(b===warmup){R=freshTotals();scoreStart=S.time;}
  const base=mix(seed^Math.imul(index+1,0x9e3779b1)^Math.imul(b+1,0x85ebca6b));
  const pool=Array.from({length:sc.available},(_,j)=>{const row=targets[Math.floor(random(base,10,j)*targets.length)];return{...row,cur:row.hp,marked:false};});
  let group=pool.slice(0,sc.initial),pulled=false,follow=false,spoilTries=0,massTried=false,lastHit='';const uses={};let turns=0;
  const usable=k=>ready(k)&&afford(k);
  const hp=()=>group[0].cur;
  function bestHit(){
   const list=Object.keys(defs).filter(k=>defs[k].samples&&usable(k));if(!list.length)return null;
   if(cls==='spoiler'){
    if(policy.damage==='attack_only')return list.includes('attack')?'attack':null;
    if(policy.damage==='sweep_first'&&list.includes('wild_sweep'))return'wild_sweep';
    if(policy.damage==='cheap_finish'&&list.includes('attack')&&defs.attack.mean*.85>=hp())return'attack';
    if(policy.damage==='group_value')return list.sort((a,b)=>useful(b)-useful(a))[0];
    return list.includes('wild_sweep')?'wild_sweep':list[0];
   }
   if(policy.damage==='attack_finish'&&list.includes('attack')&&defs.attack.mean*.85>=hp())return'attack';
   const forced=follow?list.filter(k=>['whirlwind','thunder_storm'].includes(k)):list;
   if(!forced.length)return null;
   const priority=policy.damage==='storm_first'?['thunder_storm','whirlwind','wild_sweep','attack']:policy.damage==='whirlwind_first'?['whirlwind','thunder_storm','wild_sweep','attack']:null;
   if(priority)return priority.find(k=>forced.includes(k));
   return forced.sort((a,b)=>useful(b)-useful(a)||defs[b].mean-defs[a].mean||defs[a].mp-defs[b].mp)[0];
  }
  function useful(k){return group.filter(x=>x.cur>0).slice(0,defs[k].targets).reduce((s,x)=>s+Math.min(x.cur,defs[k].mean),0);}
  while(hp()>0&&turns++<500){
   let action=null;
   if(cls==='spoiler'&&policy.support!=='none'&&!group[0].marked){
    const cap=policy.support==='solo1'?1:policy.support==='solo12'?12:4;
    if(policy.support==='festival_if_available'&&!massTried&&usable('festival'))action='festival';
    else if(spoilTries<cap&&usable('spoil'))action='spoil';
   }
   if(cls==='warlord'&&!pulled&&group.filter(x=>x.cur>0).length<4&&policy.support!=='none'&&sc.available>group.length){
    const aoe=['whirlwind','thunder_storm'].filter(usable).sort((a,b)=>defs[a].mp-defs[b].mp)[0];
    const order=policy.support==='howl'?['howl']:policy.support==='provoke'?['provoke']:policy.support==='howl_first'?['howl','provoke']:['provoke','howl'];
    if(aoe)action=order.find(k=>ready(k)&&S.mp>=defs[k].mp+defs[aoe].mp+10)||action;
   }
   action=action||bestHit();
   if(!action){
    const waits=Object.keys(defs).filter(k=>defs[k].samples).map(k=>(S.cd[k]||0)-S.time).filter(x=>x>1e-8);
    advance(waits.length?Math.max(.001,Math.min(...waits)):.1);continue;
   }
   const d=defs[action];
   if(S.mp<d.mp){if(potion())continue;action=ready('attack')?'attack':null;if(!action){advance(.1);continue;}}
   const D=defs[action];
   S.mp-=D.mp;R.mpSpent+=D.mp;S.cd[action]=S.time+D.cd;R.actions[action]=(R.actions[action]||0)+1;uses[action]=(uses[action]||0)+1;
   if(D.pull){group=pool.slice(0,Math.max(group.length,Math.min(sc.available,D.pull)));pulled=true;follow=true;}
   else if(action==='spoil'){spoilTries++;if(random(base,30,spoilTries)<sc.chance)group[0].marked=true;}
   else if(action==='festival'){massTried=true;group.forEach(x=>{if(x.cur>0)x.marked=true;});}
   else{
    const draw=random(base,40,IDS[action],uses[action]);const damage=D.samples[Math.floor(draw*D.samples.length)];
    for(const x of group.filter(x=>x.cur>0).slice(0,D.targets))x.cur=Math.max(0,x.cur-damage);
    lastHit=action;follow=false;
   }
   advance(profile.actionSeconds);
  }
  if(hp()>0){R.capped++;executedCapped++;}
  const dead=hp()<=0&&sc.settle&&['whirlwind','thunder_storm'].includes(lastHit)?group:group.filter(x=>x.cur<=0);
  R.kills+=dead.length;R.dropUnits+=dead.reduce((s,x)=>s+x.dropUnits,0);R.spoilUnits+=dead.filter(x=>x.marked).reduce((s,x)=>s+x.spoilUnits,0);
  if(group[0].marked)R.markedMain++;
  R.battles++;advance(.8); // Межбойный переход; постоянная часть одинакова для политик.
 }
 R.seconds=S.time-scoreStart;return{scenario:sc.id,endMp:S.mp,executedBattles:battles,executedCapped,warmup,...R};
}
function aggregate(eps){const x=freshTotals();for(const e of eps)add(x,e);return x;}
function compareCI(a,b,cls,seed=1229,repetitions=2000,alpha=.05){
 const vals=[];for(let r=0;r<repetitions;r++){const aa=[],bb=[];for(let i=0;i<a.length;i++){const j=Math.floor(random(seed,r,i)*a.length);aa.push(a[j]);bb.push(b[j]);}vals.push(100*(rate(aggregate(aa),cls)/rate(aggregate(bb),cls)-1));}
 vals.sort((a,b)=>a-b);return{low:vals[Math.floor(alpha/2*vals.length)],high:vals[Math.floor((1-alpha/2)*vals.length)]};
}
function race(model,cls,{trainBattles=8000,validationBattles=10000,episodeBattles=100,finalists=4,seed=0x51e17}={}){
 if(trainBattles%episodeBattles||validationBattles%episodeBattles)throw Error('Число боёв должно делиться на длину серии');
 const all=policies(cls),run=(p,n,phase)=>Array.from({length:n/episodeBattles},(_,index)=>episode(model,cls,p,{seed:seed^(phase==='train'?0x112233:0x774455),index,phase,battles:episodeBattles,warmup:Math.floor(episodeBattles*.4)}));
 const train=all.map(p=>{const eps=run(p,trainBattles,'train');return{policy:p,episodes:eps,totals:aggregate(eps)};}).sort((a,b)=>rate(b.totals,cls)-rate(a.totals,cls));
 const baseline=cls==='warlord'?'provoke_first__max_damage':'festival_if_available__group_value';
 // Финалисты фиксируются до просмотра проверочной выборки. Базовая политика всегда остаётся.
 const contextScenarios=cls==='spoiler'?scenarios(cls).filter(s=>s.id.startsWith('known_')).map(s=>s.id):['dense21','medium8'];
 const contextBest=train.slice().sort((a,b)=>rate(aggregate(b.episodes.filter(e=>contextScenarios.includes(e.scenario))),cls)-rate(aggregate(a.episodes.filter(e=>contextScenarios.includes(e.scenario))),cls))[0];
 const selected=[train[0],train.find(x=>x.policy.id===baseline),contextBest];
 for(const x of train)if(!selected.some(y=>y?.policy.id===x.policy.id))selected.push(x);
 const selectedUnique=[...new Map(selected.filter(Boolean).map(x=>[x.policy.id,x])).values()].slice(0,finalists);
 const validation=selectedUnique.map(x=>{const eps=run(x.policy,validationBattles,'validation');return{policy:x.policy,episodes:eps,totals:aggregate(eps)};}).sort((a,b)=>rate(b.totals,cls)-rate(a.totals,cls));
 if([...train,...validation].some(x=>x.totals.capped||x.episodes.some(e=>e.executedCapped)))throw Error('Незавершённые бои нельзя включать в результат');
 const best=validation[0],base=validation.find(x=>x.policy.id===baseline),ci=compareCI(best.episodes,base.episodes,cls),runner=validation[1];
 const familyCI=compareCI(best.episodes,base.episodes,cls,1229,3000,.05/Math.max(1,finalists-1));
 const runnerCI=compareCI(best.episodes,runner.episodes,cls,1231,3000,.05/Math.max(1,finalists*(finalists-1)/2));
 const scenarioResults=scenarios(cls).map(sc=>({scenario:sc,...validation.map(x=>({id:x.policy.id,totals:aggregate(x.episodes.filter(e=>e.scenario===sc.id))})).sort((a,b)=>rate(b.totals,cls)-rate(a.totals,cls))[0]}));
 return{class:cls,seed,objective:cls==='spoiler'?'additional_spoil_resource_units_per_hour':'all_killed_mobs_per_hour',baseline,trainingBattles:all.length*trainBattles,validationBattles:validation.length*validationBattles,totalBattles:all.length*trainBattles+validation.length*validationBattles,episodeBattles,warmupPerEpisode:Math.floor(episodeBattles*.4),scoredBattles:train.reduce((s,x)=>s+x.totals.battles,0)+validation.reduce((s,x)=>s+x.totals.battles,0),
  training:train.map(x=>({policy:x.policy,totals:x.totals,scenarios:scenarios(cls).map(sc=>({id:sc.id,totals:aggregate(x.episodes.filter(e=>e.scenario===sc.id))}))})),validation,best:best.policy.id,improvementVsBaselinePct:100*(rate(best.totals,cls)/rate(base.totals,cls)-1),pairedBootstrap95Pct:ci,simultaneousVsBaseline95Pct:familyCI,runnerUp:runner.policy.id,improvementVsRunnerUpPct:100*(rate(best.totals,cls)/rate(runner.totals,cls)-1),simultaneousVsRunnerUp95Pct:runnerCI,scenarioResults,
  limitations:['Лучший вариант только в указанной модели и смеси сценариев, не доказанный абсолютный оптимум игры.','Проверочные серии имеют новые seeds и хронологически более позднюю эмпирическую выборку урона.','Первые40%боёв каждой серии служат прогревомMP/КД и входят в200000исполненных боёв, но исключены из оценок дохода/скорости.',
  'Базовая политика — упрощённое соответствие текущим приоритетам, не весь runtime расширения.',
  'Разброс неизвестных механик не является статистическим доверительным интервалом; bootstrap отражает лишь шум внутри модели.']};
}
function main(){const args=process.argv.slice(2),out=args[args.indexOf('--output')+1];if(!args.includes('--output')||!out)throw Error('--output DIR');const model=JSON.parse(fs.readFileSync(path.join(__dirname,'../../kb/data/rotation-model-20261017.json')));fs.mkdirSync(out,{recursive:true});const results=['spoiler','warlord'].map(c=>race(model,c));for(const r of results){if(r.totalBattles!==200000)throw Error('Неверный объём');console.log(r.class,r.totalBattles,r.best,r.improvementVsBaselinePct.toFixed(2)+'%',r.pairedBootstrap95Pct);}
 const crypto=require('node:crypto');const simulatorSha256=crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');const result={schema:1,simulatorSha256,mode:'offline-simulation',date:'2026-10-17',totalBattles:results.reduce((s,x)=>s+x.totalBattles,0),model,results};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');
 const csv=['class,phase,scenario,policy,scored_battles,seconds,kills,spoil_units,main_mark_pct,potions,mp_spent,objective_per_hour'];
 for(const r of results)for(const phase of ['training','validation'])for(const x of r[phase]){
  const rows=[{id:'all',totals:x.totals},...(phase==='training'?x.scenarios:scenarios(r.class).map(sc=>({id:sc.id,totals:aggregate(x.episodes.filter(e=>e.scenario===sc.id))})))];
  for(const row of rows){const t=row.totals;csv.push([r.class,phase,row.id,x.policy.id,t.battles,t.seconds,t.kills,t.spoilUnits,100*t.markedMain/Math.max(1,t.battles),t.potions,t.mpSpent,rate(t,r.class)].join(','));}
 }
 fs.writeFileSync(path.join(out,'rotations.csv'),csv.join('\n')+'\n');}

module.exports={random,policies,scenarios,definitions,episode,aggregate,rate,compareCI,race};if(require.main===module)main();

'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),box={console,URLSearchParams,setTimeout,__dirname,require:n=>n==='node:test'?()=>{}:require(n),module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(__dirname+'/v1015-vampiric-decision.test.js','utf8'),box);
const {setup}=box.module.exports;
function fixture(o={}) {
 const f=setup({hero:8700,heal:1200,pot:true,limit:1,...o}),{env,combat,vt,blaze}=f;
 Object.assign(env.cfg,{rbUsePots:true,rbTurnPrice:true});
 env.potBag=()=>200;env.qty=b=>b===f.pot?200:b?null:0;
 const dmg={blaze:4000,'vampiric touch':3000,...o.dmg};
 env.rt.skills=Object.fromEntries(Object.entries(dmg).map(([k,n])=>[k,{dmg:n*8,dmgN:8}]));
 env.expDmg=k=>dmg[k]||0;env.fightDmgOn=n=>({n:8,mean:dmg[n.toLowerCase()],p20:dmg[n.toLowerCase()]});
 const ctx={rb:{id:'l2dop_rb_test'},block:{}};
 if(o.rb!==false){env.isBoss=()=>true;f.location.search='?spawnId=l2dop_rb_test';env.rt.via='manual';env.rbAssess=()=>({retreat:false});env.rt.rbDb={l2dop_rb_test:{sp:1000,hitP90:100}};}
 else delete ctx.rb;
 return {...f,ctx,plan:()=>combat.magePlan(ctx,env.meMp())};
}
test('РБ: готовый VT восполняет HP уже при87%, сохраняя атакующий ход вместо будущей банки',async()=>{
 const f=fixture();assert.equal(f.plan().b,f.vt);assert.match(f.plan().why,/ранний вампиризм/);
 await f.combat.battle();assert.deepEqual(Array.from(f.calls,x=>x.name),['Vampiric Touch']);
});
test('Hekaton:1899 свободных HP достаточно под VT4500×40%, порог85% ждать не нужно',()=>{
 const f=fixture({hero:13018,heal:146,dmg:{blaze:5534,'vampiric touch':4500}});
 f.env.meHp=()=>({cur:13018,max:14917,pct:13018/14917*100});assert.equal(f.plan().b,f.vt);
});
test('модель VT из подтверждённого каталога запускается без двух ручных лечащих ходов',()=>{
 const f=fixture({heal:null});assert.equal(f.plan().b,f.vt);
});
test('полное HP и малый дефицит не тратят более сильный удар на перелечение',()=>{
 for(const hero of [10000,9900,9500,8900]){const f=fixture({hero});assert.equal(f.plan().b,f.blaze,String(hero));}
});
test('малое фактическое лечение у полной полоски не отменяет место под полный VT',()=>{
 const f=fixture({hero:9800,heal:200});assert.equal(f.plan().b,f.blaze);
});
test('слабое фактическое лечение важнее теоретических40% и не окупает замену сильного удара',()=>{
 const f=fixture({heal:40});assert.equal(f.plan().b,f.blaze);
});
test('полный известный эффект банки не подменяется одним импульсом при оценке выгоды',()=>{
 const f=fixture({heal:300});f.env.rt.pots['зілля зцілення'].heal=2400;assert.equal(f.plan().b,f.blaze);
});
test('неизвестное умение не получает вампиризм только по общей прошлой статистике HP',()=>{
 const f=fixture({heal:null});f.env.slotAction=b=>b===f.vt?'l2_unknown':'l2_1220';
 f.env.rt.skills['vampiric touch'].heal=9000;assert.equal(f.plan().b,f.blaze);
});
test('для другого drain действует явный процент из описания, а не40% любого скилла',()=>{
 const f=fixture({heal:null});f.env.slotAction=b=>b===f.vt?'l2_other':'l2_1220';
 f.env.rt.skillDb={'vampiric touch':{desc:'Магічна шкода. Вампіризм 10% від шкоди.'}};
 assert.equal(f.plan().b,f.vt);f.env.rt.skillDb['vampiric touch'].desc='Вампіризм 1% від шкоди.';assert.equal(f.plan().b,f.blaze);
});
test('РБ при готовом добивании сильной магией не оставляет ещё один ход ради HP',()=>{
 const f=fixture({mob:3600});assert.equal(f.plan().b,f.blaze);
});
test('последние три атакующих хода РБ остаются за максимальным уроном',()=>{
 const f=fixture({mob:10000});assert.equal(f.plan().b,f.blaze);
});
test('измеренный прогноз победы без банок не даёт выдуманной экономии даже при длинном остатке',async()=>{
 const f=fixture({mob:15600});f.ctx.rb.usePots=false;assert.equal(f.plan().b,f.blaze);
 f.env.rbAssess=ctx=>{ctx.rb.usePots=false;return {retreat:false}};
 await f.combat.battle();assert.equal(f.calls[0].name,'Blaze');
});
test('обычные мобы и выключенная цена хода/банки/вампиризм сохраняют прежний DPS',()=>{
 const normal=fixture({rb:false});assert.equal(normal.plan().b,normal.blaze);
 for(const [k,v] of [['rbTurnPrice',false],['rbUsePots',false],['drainHp',0],['nDrain','']]){const f=fixture();f.env.cfg[k]=v;assert.equal(f.plan().b,f.blaze,k);}
});
test('пустой запас и неприкосновенный резерв не создают воображаемую будущую банку',()=>{
 for(const n of [0,10]){const f=fixture();f.env.potBag=()=>n;f.env.qty=b=>b===f.pot?n:null;assert.equal(f.plan().b,f.blaze);}
});
test('неизмеренный урон VT не оправдывает замену сильного заклинания',()=>{
 const f=fixture();f.env.rt.skills['vampiric touch'].dmgN=1;assert.equal(f.plan().b,f.blaze);
});
test('MP, откат и защита потерянного клика имеют приоритет над ранним вампиризмом',()=>{
 for(const kind of ['mp','disabled','block','lost','netCd']){
  const f=fixture();
  if(kind==='mp')f.env.skillMp=n=>/vampiric/i.test(n)?7000:20;
  if(kind==='disabled')f.vt.disabled=true;
  if(kind==='block')f.ctx.block['drain:'+f.vt.title]=f.now()+1000;
  if(kind==='lost')f.combat.lostUntil.set('vampiric touch',f.now()+1000);
  if(kind==='netCd')f.env.combatCooldown.observeSync({serverNowMs:f.now(),skillCooldowns:{l2_1147:f.now()+1000}},'first-mob');
  assert.equal(f.plan().b,f.blaze,kind);
 }
});
test('после реального ожидания слабый VT уступает аварийной банке',async()=>{
 const f=fixture({damageDuringWait:true,heal:1200});
 f.env.fightHealOn=()=>({n:3,p20:f.hero()>2000?1200:40});
 await f.combat.battle();assert.equal(f.calls[0].name,'Зілля зцілення');
});
test('HP восстановилось за ожидание игры: ранний VT пересчитан в более сильный удар',async()=>{
 const f=fixture();let recovered=false;const sleep=f.env.sleep;
 f.env.sleep=async ms=>{await sleep(ms);recovered=true};f.env.gameBusy=()=>({busy:!recovered,end:0});
 f.env.meHp=()=>({cur:recovered?10000:8700,max:10000,pct:recovered?100:87});
 await f.combat.battle();assert.equal(f.calls[0].name,'Blaze');
});
for(const k of ['stopWait','leaseWait'])test(k+' прерывает ранний VT до клика',async()=>{
 const f=fixture({[k]:true});await f.combat.battle();assert.equal(f.calls.length,0);
});

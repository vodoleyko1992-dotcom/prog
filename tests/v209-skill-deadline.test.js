'use strict';
// 17.10.2026: застывший рисунок КД навыка (RAF) — серверный дедлайн этого нажатия возвращает навыки воина в бой,
// как 10.0.26 вернул атаку. Защиты: запрос в полёте, потерянный клик, старое наблюдение, другой спавн, два отказа игры.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createBattleCooldown}=require('../battle-cooldown.js');
function fixture(){let now=1000000;const model=createBattleCooldown(()=>now),net={start:1,done:1,doneT:now},recs=[];
 const cdState={busy:true,timer:'2.3'};
 const b={title:'Power Strike',disabled:false,getAttribute:()=>null},cd={hidden:false,classList:{contains:()=>cdState.busy},querySelector:()=>({textContent:cdState.timer})};
 const env={rt:{},slotCd:()=>cd,slotAction:()=> 'l2_3',skKey:()=> 'power strike',slotKind:()=> 'скилл',cdSpawn:()=> 'chain',memLeft:()=>0,combatCooldown:model,actNet:()=>net,
  cleanTitle:t=>t,rec:(...a)=>recs.push(a.join(' '))};
 const source=fs.readFileSync(require.resolve('../modules/combat.js'),'utf8');
 const api=vm.runInNewContext(source.slice(source.indexOf('let overlayBusySeen'),source.indexOf('function cdLeft'))+';({ready,cdBusy,pressAt,lostUntil,frozenLostMark:(slot,n)=>frozenLost.set(slot,n),FROZEN_GRACE})',{env,Date:{now:()=>now},Map,WeakMap,WeakSet,Math,parseFloat,String,RegExp});
 const press=()=>{api.pressAt.set('power strike',now);now+=50;};
 const reply=(until=5001100)=>model.observe({action:'l2_3',battleSpawnId:'chain'},{serverNowMs:5000000,delta:{skillCooldowns:{l2_3:until}}},200,'chain');
 return {model,net,b,env,api,recs,cdState,tick:n=>now+=n,now:()=>now,press,reply};
}
test('frozen skill overlay yields to the server deadline of this press after the grace period',()=>{
 const f=fixture();f.press();f.reply();
 assert.equal(f.api.ready(f.b),false,'cooldown still running on the server');
 f.tick(1141);assert.equal(f.api.ready(f.b),false,'server ready, but the overlay has only just lagged');
 f.tick(f.api.FROZEN_GRACE);assert.equal(f.api.ready(f.b),true,'overlay frozen longer than the grace: trust the server');
 assert.equal(f.recs.filter(r=>/застыл/.test(r)).length,1,'one journal line per fight');
 f.tick(500);f.api.ready(f.b);assert.equal(f.recs.filter(r=>/застыл/.test(r)).length,1);
});
test('overlay that recovers normally resets the frozen timer',()=>{
 const f=fixture();f.press();f.reply();f.tick(1141);f.api.ready(f.b);f.tick(600);
 f.cdState.busy=false;assert.equal(f.api.ready(f.b),true);
 f.cdState.busy=true;f.api.ready(f.b);f.tick(600);
 assert.equal(f.api.ready(f.b),false,'busy again: a fresh grace period starts, not the old one');
});
for(const reason of ['no observation','observation before press','pending request','lost click','wrong spawn','expired observation','two refusals'])test('does not bypass the overlay: '+reason,()=>{
 const f=fixture();
 if(reason==='observation before press'){f.reply(5000000);f.tick(10);f.press();}
 else{f.press();if(reason!=='no observation')f.reply(5000000);}
 f.tick(100);
 if(reason==='pending request')f.net.start++;
 if(reason==='lost click')f.api.lostUntil.set('power strike',f.now()+700);
 if(reason==='wrong spawn')f.env.cdSpawn=()=> 'other';
 if(reason==='expired observation')f.tick(30000);
 f.api.ready(f.b);
 if(reason==='two refusals')f.api.frozenLostMark(f.b,2);f.tick(f.api.FROZEN_GRACE+100);
 assert.equal(f.api.ready(f.b),false);
});
test('fighter idle diagnostics are written to the journal like the mage ones',()=>{
 const src=fs.readFileSync(require.resolve('../modules/combat.js'),'utf8');
 assert.match(src,/const fighterIdle = !mageCombat\(\) && Date\.now\(\) - lastAct > 6000;/);
 assert.match(src,/воин \$\{Math\.round\(\(Date\.now\(\) - lastAct\) \/ 1000\)\} с без действий/);
 assert.match(src,/не хватает MP \(\$\{actionMp\(b\)\}\)/);
 assert.match(src,/недоступно до конца боя/);
});

'use strict';
// 16.10: улучшение Empower Lv2→Lv3 может сократить срок24ч→3ч; это не потерянная оплата.
// Контракт activeBuffs: skillId/level/expiresAtMs подтверждён kb/data/game-skills-warlock.json.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const now=Date.now(),box={console,Date,document:{querySelectorAll:()=>[]}};
 for(const file of ['payments','buffs'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules',file+'.js'),'utf8'),box);
 let readHook=()=>{},posts=0;const writes=[];
 const before=now+24*3600000,after=now+3*3600000;
 const P={id:'upgrade-1059',kind:'fa-buff',key:'fa:1059',char:'Hero',at:now,kick:1,phase:'prepared',quote:{currency:'FA',amount:1},evidence:{jobT:123,ids:[1059],before:{1059:before},beforeLevels:{1059:2},expectedLevels:{1059:3},balance:20}};
 const response={character:{name:'Hero',activeBuffs:[{skillId:1059,level:3,expiresAtMs:after}]}};
 const env={on:true,tabOwner:true,leaseEpoch:1,rt:{char:'Hero',manualKickAt:1,tbuff:{t:123,step:'fa',fa:[1059]},actionPayments:{pending:P,history:[]}},cfg:{},
  setRt:async patch=>{writes.push(patch);Object.assign(env.rt,patch);return {ok:true}},rtCommit:async()=>true,autonomyMode:()=> 'raid',setStatus(){},rec(){},$q:()=>null,
  gameGet:async()=>{await readHook();return {ok:true,json:async()=>response}},gamePost:async()=>{posts++;throw Error('Сверка не должна отправлять POST');}};
 env.payments=box.L2V7Factories.payments(env);const B=box.L2V7Factories.buffs(env);
 return {env,B,P,response,writes,now,after,get posts(){return posts},set hook(fn){readHook=fn}};
}
test('доказанный upgrade Lv2→Lv3 с24ч до3ч подтверждает платёж и убирает последний FA',async()=>{const f=fixture();assert.equal(await f.B.paymentReconcile(),true);assert.equal(f.env.payments.pending(),null);assert.equal(JSON.stringify(f.env.rt.tbuff.fa),'[]');assert.equal(f.env.rt.actionPayments.history.length,1);assert.equal(f.posts,0)});
for(const [label,change] of [
 ['тот же уровень',f=>f.response.character.activeBuffs[0].level=2],
 ['уровень ниже цели',f=>f.P.evidence.expectedLevels[1059]=4],
 ['до покупки уже был целевой уровень',f=>f.P.evidence.beforeLevels[1059]=3],
 ['старый уровень неизвестен',f=>delete f.P.evidence.beforeLevels],
 ['целевой уровень неизвестен',f=>delete f.P.evidence.expectedLevels],
 ['серверный уровень неизвестен',f=>delete f.response.character.activeBuffs[0].level],
 ['эффект истекает через30с',f=>f.response.character.activeBuffs[0].expiresAtMs=f.now+30000],
 ['сервер вернул другого героя',f=>f.response.character.name='Other'],
])test(label+' не выдаёт короткий срок за подтверждённое улучшение',async()=>{const f=fixture();change(f);assert.equal(await f.B.paymentReconcile(),false);assert.equal(f.env.payments.pending()?.id,f.P.id);assert.deepEqual(f.env.rt.tbuff.fa,[1059]);assert.equal(f.env.rt.actionPayments.history.length,0);assert.equal(f.posts,0)});
for(const kind of ['character','lease','owner','payment'])test('смена '+kind+' во время GET не подтверждает старую оплату',async()=>{const f=fixture();f.hook=()=>{if(kind==='character')f.env.rt.char='Other';if(kind==='lease')f.env.leaseEpoch=2;if(kind==='owner')f.env.tabOwner=false;if(kind==='payment')f.env.rt.actionPayments.pending={...f.P,id:'new'};};assert.equal(await f.B.paymentReconcile(),false);assert.equal(f.writes.length,0);assert.equal(f.posts,0)});
test('Stop допускает пассивную сверку своей отправленной оплаты, без повторной покупки',async()=>{const f=fixture();f.env.on=false;assert.equal(await f.B.paymentReconcile(),true);assert.equal(f.posts,0)});
test('поздняя квитанция не удаляет FA из новой задачи после ручного выбора',async()=>{const f=fixture();f.env.rt.manualKickAt=2;f.env.rt.tbuff={t:999,step:'fa',fa:[1059]};assert.equal(await f.B.paymentReconcile(),true);assert.deepEqual(f.env.rt.tbuff,{t:999,step:'fa',fa:[1059]});assert.equal(f.posts,0)});

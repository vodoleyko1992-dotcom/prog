'use strict';
// 20.36: реальные массивы skillCooldowns и разрешённый hook.be — те же серверные часы/защиты, что у словаря.
const test=require('node:test'),assert=require('node:assert/strict');
const {createBattleCooldown}=require('../battle-cooldown.js');
function fixture(){let now=100000;const cd=createBattleCooldown(()=>now);return{cd,tick:ms=>now+=ms,now:()=>now};}
for(const layer of ['top','delta','battle'])test('action '+layer+' array maps actual skillId/readyAt to its native l2_ID',()=>{
 const f=fixture(),fields={serverNowMs:1792150652190,skillCooldowns:[{skillId:1127,readyAt:1792150677190,remainingSec:25}]},res=layer==='top'?fields:{[layer]:fields};
 f.cd.observe({action:'l2_1127',battleSpawnId:'a'},res,200,'a');
 assert.equal(f.cd.skillWait('l2_1127','a'),25040);assert.equal(f.cd.skillWait('1127','a'),25040);assert.equal(f.cd.skillKnown('l2_1127','a',f.now()),true);
 f.tick(25039);assert.equal(f.cd.skillWait('l2_1127','a'),1);f.tick(1);assert.equal(f.cd.skillWait('l2_1127','a'),0);
});
for(const layer of ['top','delta','battle'])test('sync '+layer+' supports arrays without requiring the last action',()=>{
 const f=fixture(),fields={serverNowMs:5000000,skillCooldowns:[{skillId:'l2_1127',readyAt:5000800}]};
 f.cd.observeSync(layer==='top'?fields:{[layer]:fields},'a');assert.equal(f.cd.skillWait('l2_1127','a'),840);
});
test('be full cooldown list retains the ninth skill beyond generic response redaction',()=>{
 const f=fixture(),be={schema:1,timing:{serverNowMs:5000000,globalCooldownUntilMs:5000200},cooldowns:Array.from({length:12},(_,i)=>({key:String(i),skillId:1100+i,readyAt:5000000+1000+i}))};
 f.cd.observe({action:'l2_1111',battleSpawnId:'a'},be,200,'a');assert.equal(f.cd.skillWait('l2_1108','a'),1048);assert.equal(f.cd.skillWait('l2_1111','a'),1051);assert.equal(f.cd.globalWait('a'),240);
});
test('be sync understands named map keys and does not use numeric list row indexes as skill IDs',()=>{
 const f=fixture();f.cd.observeSync({schema:1,timing:{serverNowMs:5000000},cooldowns:[{key:'whirlwind',until:5001000},{key:'l2_1127',until:5001500},{key:'1',until:5002000},{key:'2',readyAt:5002000}]},'a');
 assert.equal(f.cd.skillWait('whirlwind','a'),1040);assert.equal(f.cd.skillWait('l2_1127','a'),1540);assert.equal(f.cd.skillKnown('l2_1','a'),false);assert.equal(f.cd.skillKnown('l2_2','a'),false);
});
test('remainingMs/remainingSec are relative to server time; absolute readyAt takes precedence',()=>{
 const f=fixture();f.cd.observeSync({serverNowMs:5000000,skillCooldowns:[{skillId:1,remainingSec:1.5},{skillId:2,remainingMs:900},{skillId:3,readyAt:5000300,remainingSec:90}]},'a');
 assert.equal(f.cd.skillWait('l2_1','a'),1540);assert.equal(f.cd.skillWait('l2_2','a'),940);assert.equal(f.cd.skillWait('l2_3','a'),340);
});
test('missing array timer leaves the prior deadline and its observation age unchanged',()=>{
 const f=fixture();f.cd.observeSync({serverNowMs:5000000,skillCooldowns:[{skillId:1127,readyAt:5005000}]},'a');f.tick(100);
 f.cd.observeSync({serverNowMs:5000100,skillCooldowns:[{skillId:1127}]},'a');assert.equal(f.cd.skillWait('l2_1127','a'),4940);assert.equal(f.cd.skillKnown('l2_1127','a',f.now()),false);
 f.cd.observeSync({serverNowMs:5000200,skillCooldowns:[]},'a');assert.equal(f.cd.skillWait('l2_1127','a'),4940);
});
for(const value of [{readyAt:0},{remainingMs:0},{remainingSec:'0'}])test('explicit zero is a ready observation: '+JSON.stringify(value),()=>{
 const f=fixture();f.cd.observeSync({serverNowMs:5000000,skillCooldowns:[{skillId:1127,readyAt:5005000}]},'a');f.tick(100);
 f.cd.observeSync({serverNowMs:5000100,skillCooldowns:[{skillId:1127,...value}]},'a');assert.equal(f.cd.skillWait('l2_1127','a'),0);assert.equal(f.cd.skillKnown('l2_1127','a',f.now()),true);
});
test('late be/array packets cannot shorten a newer known deadline',()=>{
 const f=fixture();f.cd.observeSync({serverNowMs:5001000,skillCooldowns:[{skillId:1127,readyAt:5005000}]},'a');f.tick(100);
 f.cd.observeSync({schema:1,timing:{serverNowMs:5000000},cooldowns:[{key:'0',skillId:1127,readyAt:0}]},'a');assert.equal(f.cd.skillWait('l2_1127','a'),3940);
});
test('wrong-spawn action array cannot reset the active battle or its deadlines',()=>{
 const f=fixture();f.cd.observeSync({serverNowMs:5000000,skillCooldowns:[{skillId:1127,readyAt:5005000}]},'b');const before=f.cd.snapshot();
 f.cd.observe({action:'l2_1127',battleSpawnId:'a'},{schema:1,timing:{serverNowMs:6000000},cooldowns:[{key:'0',skillId:1127,readyAt:0}]},200,'b');assert.deepEqual(f.cd.snapshot(),before);
});
test('array IDs bind a named action only when server skillId or row action explicitly establishes the alias',()=>{
 // 22.10: Whirlwind доказанно36; динамическое связывание проверяем на ещё неизвестном native, не на противоречивом Whirlwind181.
 const f=fixture(),req={action:'custom_native',battleSpawnId:'a'};
 f.cd.observe(req,{serverNowMs:5000000,skillCooldowns:[{skillId:181,readyAt:5001000}]},200,'a');assert.equal(f.cd.skillKnown('custom_native','a'),false);
 f.cd.observe(req,{serverNowMs:5000100,skillId:181,skillCooldowns:[{skillId:181,readyAt:5002000}]},200,'a');assert.equal(f.cd.skillWait('custom_native','a'),1940);
 f.cd.observeSync({serverNowMs:5000200,skillCooldowns:[{skillId:181,action:'custom_native',readyAt:5000300}]},'a');assert.equal(f.cd.skillWait('custom_native','a'),140);
});
test('malformed array rows never synthesize ready, names, or numeric index observations',()=>{
 const f=fixture();f.cd.observeSync({serverNowMs:5000000,skillCooldowns:[{skillId:1127,readyAt:5005000}]},'a');f.tick(100);
 // 22.10: живой Battle Roar подтвердил178с; skill-дедлайн разрешён до15мин, GCD по-прежнему до2мин.
 const bad=[null,false,12,[],{}, {key:'0',readyAt:0},{skillId:0,readyAt:0},{skillId:Infinity,readyAt:0},{skillId:1127},{skillId:1127,readyAt:null},{skillId:1127,readyAt:false},{skillId:1127,readyAt:'bad',remainingSec:0},{skillId:1127,readyAt:-1},{skillId:1127,remainingSec:-1},{skillId:1127,remainingMs:Infinity},{skillId:1127,remainingSec:901}];
 f.cd.observeSync({serverNowMs:5000100,skillCooldowns:bad},'a');assert.equal(f.cd.skillWait('l2_1127','a'),4940);assert.equal(f.cd.skillKnown('l2_1127','a',f.now()),false);
 assert.deepEqual(Object.keys(f.cd.snapshot().skillUntil).sort(),['1127','l2_1127']);
});
test('object map scalar and row values retain compatibility without treating malformed values as zero',()=>{
 const f=fixture();f.cd.observeSync({serverNowMs:5000000,skillCooldowns:{whirlwind:5001000,1127:{readyAtMs:5002000},l2_1:{remainingMs:300}}},'a');
 assert.equal(f.cd.skillWait('whirlwind','a'),1040);assert.equal(f.cd.skillWait('l2_1127','a'),2040);assert.equal(f.cd.skillWait('l2_1','a'),340);
 f.cd.observeSync({serverNowMs:5000100,skillCooldowns:{whirlwind:false,l2_1127:[],l2_1:{}}},'a');assert.equal(f.cd.skillWait('whirlwind','a'),1040);assert.equal(f.cd.skillWait('l2_1127','a'),2040);assert.equal(f.cd.skillWait('l2_1','a'),340);
});
test('be enrichment preserves physical attack deadline obtained from the raw response',()=>{
 const f=fixture(),req={action:'attack',battleSpawnId:'a'};f.cd.observe(req,{serverNowMs:5000000,nextPhysicalAttackAt:5001100},200,'a');
 f.cd.observe(req,{schema:1,timing:{serverNowMs:5000000},cooldowns:[{key:'whirlwind',until:5002000}]},200,'a');assert.equal(f.cd.skillWait('attack','a'),1140);assert.equal(f.cd.skillWait('whirlwind','a'),2040);
});
test('be global rejection remains global rather than the requested skill cooldown',()=>{
 const f=fixture();f.cd.observe({action:'whirlwind',battleSpawnId:'a'},{schema:1,blockedBy:'global',timing:{serverNowMs:5000000,cooldownUntilMs:5005000,globalRemainingMs:500},cooldowns:[]},400,'a');
 assert.equal(f.cd.globalWait('a'),540);assert.equal(f.cd.skillKnown('whirlwind','a'),false);assert.equal(f.cd.recentlyGlobalRejected(f.now()),true);
});
test('timers need valid server time; an unknown evidence schema does not use timing fields',()=>{
 const f=fixture();f.cd.observeSync({skillCooldowns:[{skillId:1127,readyAt:5005000}]},'a');assert.equal(f.cd.skillKnown('l2_1127','a'),false);
 f.cd.observeSync({schema:2,timing:{serverNowMs:5000000},cooldowns:[{key:'l2_1127',until:5005000}]},'a');assert.equal(f.cd.skillKnown('l2_1127','a'),false);
});

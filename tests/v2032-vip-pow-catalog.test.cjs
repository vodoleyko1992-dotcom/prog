'use strict';
// 20.10: PoW на этом сервере —1357 в greater, а не в обычном mage.
// Цены в offline-каталоге исторические; бесплатный VIPquote моделируется явно.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=process.env.L2_TEST_ROOT||path.resolve(__dirname,'..');
const raw=JSON.parse(fs.readFileSync(path.join(root,'kb/raw/buffer-catalog.json'),'utf8'));
const server=raw.data||raw,serverGreater=server.sets.find(x=>x.id==='greater'),serverMage=server.sets.find(x=>x.id==='mage');
const helper=fs.readFileSync(path.join(root,'tests/v2031-vip-greater-buff.test.js'),'utf8'),cut=helper.indexOf("test('перед возвращением");
assert.ok(cut>0,'стенд существующей VIP-регрессии доступен');
function fixture(){
 const box={console,process,require,structuredClone,__dirname:path.join(root,'tests')};
 vm.runInNewContext(helper.slice(0,cut)+'\nthis.make=greaterFixture;',box);
 const f=box.make();
 // Только здесь, в локальном ответе сервера, подтверждаем VIPцену0/0.
 f.catalog.sets[1]={...structuredClone(serverMage),feeAdena:'0',feeCoinOfLuck:0};
 f.catalog.sets[2]={...structuredClone(serverGreater),feeAdena:'0',feeCoinOfLuck:0};
 Object.assign(f.ch,{classBranch:'mystic',l2Profession:'human_arcana_lord'});f.ch.classSlots.activeSlot=0;
 f.env.rt.classCur={slot:0,prof:'human_arcana_lord'};
 // HUD моделирует реальные уровни из свежего /character, без подмены фабрики buffs.
 f.env.$q=s=>s==='#l2-hud-active-buffs'?{querySelectorAll:()=>Object.entries(f.H).map(([id,expiresAt])=>({dataset:{skillId:id,expiresAt},getAttribute:k=>k==='title'?'Buff · Lv.'+(f.ch.activeBuffs.find(b=>b.skillId===+id)?.level||0):''}))}:null;
 return f;
}
const postSets=f=>JSON.parse(JSON.stringify(f.posts.map(x=>x.q.set)));
const ticks=async(f,n)=>{for(let i=0;i<n;i++)await f.B.townBuffStep();};
function openVisit(f){f.env.rt.tbuff={t:Date.now()+1,step:'town',set:'mage',vipFree:true,fa:[]};}
function removePoW(f){f.ch.activeBuffs=f.ch.activeBuffs.filter(b=>b.skillId!==1357);delete f.H[1357];}

test('серверный каталог: Water1357 входит в greater, обычный mage его не даёт',()=>{
 assert.match(serverGreater.skills.find(x=>x.skillId===1357)?.nameUk||'',/Prophecy of Water/i);
 assert.ok(!serverMage.skills.some(x=>x.skillId===1357));
 assert.deepEqual(serverGreater.skills.map(x=>x.skillId),[1356,1357,1355,1363,1413,1414,1323]);
});
test('подтверждённый бесплатный quote: mage → PoW1357 → Noblesse1323',async()=>{
 const f=fixture();await ticks(f,1);assert.deepEqual(postSets(f),['mage']);assert.ok(f.env.rt.tbuff);assert.equal(f.B.vipSession().ready,false);
 await ticks(f,1);assert.deepEqual(postSets(f),['mage','greater']);assert.equal(f.posts[1].q.skillId,1357);assert.ok(f.env.rt.tbuff);assert.equal(f.B.vipSession().ready,false);
 await ticks(f,1);assert.deepEqual(postSets(f),['mage','greater','greater']);assert.equal(f.posts[2].q.skillId,1323);assert.equal(f.env.rt.tbuff,null);assert.equal(f.B.vipSession().ready,true);
 assert.ok(f.env.rt.vipApplied.ids.includes(1357));assert.equal(f.env.rt.vipApplied.skills.find(x=>x.skillId===1357).level,1);
 for(const p of f.posts){assert.equal(p.q.expectedFeeAdena,'0');assert.equal(p.q.expectedFeeCoinOfLuck,0);}
});
test('исчезновение только PoW снимает готовность и требует именно greater, не нового mage',async()=>{
 const f=fixture();await ticks(f,3);removePoW(f);assert.equal(f.B.vipSession().ready,false);assert.equal(f.B.townBuffNeed().vipFree,true);
 openVisit(f);await ticks(f,1);assert.deepEqual(postSets(f),['mage','greater','greater','greater']);assert.equal(f.posts.at(-1).q.skillId,1357);assert.equal(f.B.vipSession().ready,true);
 assert.ok(f.env.rt.vipApplied.ids.includes(1357));
});
test('истёкший PoW не считается действующим при сохранении остальных эффектов',async()=>{
 const f=fixture();await ticks(f,3);const pow=f.ch.activeBuffs.find(x=>x.skillId===1357);pow.expiresAtMs=Date.now()-1;f.H[1357]=pow.expiresAtMs;
 assert.equal(f.B.vipSession().ready,false);openVisit(f);await ticks(f,1);assert.equal(postSets(f).at(-1),'greater');assert.equal(f.B.vipSession().ready,true);
});
test('платный greater не отправляет CoL и не записывает ложное подтверждение PoW',async()=>{
 const f=fixture();f.catalog.sets[2].feeCoinOfLuck=5;await ticks(f,1);
 assert.deepEqual(postSets(f),['mage']);assert.ok(!f.env.rt.vipApplied.ids.includes(1357));assert.ok(!f.env.rt.vipApplied.skills.some(x=>x.skillId===1357));
 assert.ok(f.posts.every(p=>p.q.expectedFeeCoinOfLuck===0));
 // Платный Greater не создаёт ни PoW-квитанции, ни ложной готовности всей VIP-подготовки.
 assert.equal(f.env.rt.vipApplied.set,'mage');assert.equal(f.env.rt.tbuff,null);assert.equal(f.B.vipSession().ready,false);
});
test('сильный quote подорожал после mage: нет greaterPOST и ложного PoW',async()=>{
 const f=fixture();await ticks(f,1);f.catalog.sets[2].feeCoinOfLuck=5;await ticks(f,1);
 assert.deepEqual(postSets(f),['mage']);assert.ok(!f.env.rt.vipApplied.ids.includes(1357));assert.equal(f.env.rt.tbuff,null);
});
test('сервер не вернул PoW после greater: результат неизвестен, ready=false и повтора нет',async()=>{
 const f=fixture(),post=f.env.gamePost;f.env.gamePost=async(p,q)=>{const r=await post(p,q);if(q.set==='greater'&&q.skillId===1357)removePoW(f);return r;};
 await ticks(f,5);assert.deepEqual(postSets(f),['mage','greater']);assert.equal(f.env.rt.tbuff.vipRequest.set,'greater');assert.equal(f.env.rt.tbuff.vipRequest.skillId,1357);assert.equal(f.B.vipSession().ready,false);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
// Реальный campaign()/pressAction, DOM по native starter-story-quest.js; игровые API только моки.
const file=path.join(__dirname,'v1013-fullgame-systems-quests.test.js'),src=fs.readFileSync(file,'utf8');
const box={console,Date,URL,require:require('node:module').createRequire(file),__dirname};
vm.runInNewContext(src.slice(0,src.indexOf('const cases ='))+'\nthis.setup=setup;this.el=el;',box);
function fixture(){const f=box.setup('meet_scout');f.env.rt.manualKickAt=1;f.env.tabOwner=true;return f}
const npc=f=>{const b=box.el({textContent:'К NPC',dataset:{questTeleportId:'town'}});f.state.teleports.push(b);return b};
test('NPC shares current cityId: still teleports to exact NPC once, then progresses normally',async()=>{
 const f=fixture(),b=npc(f);b.onFire=()=>{f.state.actions=[box.el({textContent:'Поговорить',dataset:{action:'meet-scout'},onFire:()=>{f.env.rt.storySaga.stage='hunt_2'}})]};await f.q.campaign();assert.equal(f.fired.length,1);assert.equal(f.env.rt.campaignTp,null);assert.equal(f.env.rt.campaignAnchor.npc,true);await f.q.campaign();assert.equal(f.fired.length,2);assert.equal(f.env.rt.storySaga.stage,'hunt_2');
});
test('NPC lost response, same city and reload do not authorize another payment',async()=>{
 const f=fixture();npc(f);f.env.fire=b=>{f.fired.push(b.dataset.questTeleportId);return true};await f.q.campaign();assert.equal(f.fired.length,1);assert.ok(f.env.rt.campaignTp.npc);f.q=f.reload();for(let i=0;i<8;i++)await f.q.campaign();assert.equal(f.fired.length,1);assert.ok(f.env.rt.campaignTp);assert.equal(f.env.outs,undefined);
});
test('NPC successful ACK before Stop reconciles after resume without another payment',async()=>{
 const f=fixture();npc(f);const fire=f.env.fire;f.env.fire=b=>{const r=fire(b);f.env.on=false;return r};await f.q.campaign();assert.ok(f.env.rt.campaignTp.ack);f.q=f.reload();f.env.on=true;f.env.rt.manualKickAt++;await f.q.campaign();assert.equal(f.fired.length,1);assert.equal(f.env.rt.campaignTp,null);
});
test('NPC unknown old payment after manual chapter change remains blocked, does not pay a new route',async()=>{
 const f=fixture();npc(f);f.env.fire=b=>{f.fired.push(b.dataset.questTeleportId);return true};await f.q.campaign();f.env.rt.manualKickAt++;f.env.rt.storySaga.stage='return_home';f.state.teleports[0].dataset.questTeleportId='other';await f.q.campaign();assert.equal(f.fired.length,1);assert.equal(f.env.rt.campaignTp.id,'town');
});
for(const change of ['character','chapter','manual','owner','off'])test(`NPC initial page wait → ${change} cancels old action and teleport`,async()=>{
 const f=fixture();npc(f);const wait=f.env.waitFor;let changed=false;f.env.waitFor=async(...a)=>{const r=await wait(...a);if(!changed){changed=true;if(change==='character')f.env.rt={char:'New'};if(change==='chapter')f.env.rt.storySaga.stage='return_home';if(change==='manual')f.env.rt.manualKickAt++;if(change==='owner')f.env.tabOwner=false;if(change==='off')f.env.cfg.campaign=false;}return r};await f.q.campaign();assert.equal(f.fired.length,0);assert.equal(f.env.rt.campaignTp,undefined);
});
test('NPC confirmed server refusal releases intent and keeps backoff instead of permanent pending',async()=>{
 const f=fixture(),b=npc(f);b.onFire=()=>{f.state.err.hidden=false;f.state.err.textContent='Недостаточно адены'};await f.q.campaign();assert.equal(f.fired.length,1);assert.equal(f.env.rt.campaignTp,null);assert.ok(f.env.rt.campaignTpRetry.until>Date.now());await f.q.campaign();assert.equal(f.fired.length,1);
});
test('pressAction error recovery uses same durable NPC teleport and does not repeat unknown payment',async()=>{
 const f=fixture();npc(f);const action=box.el({textContent:'Поговорить',dataset:{action:'meet-scout'}});f.state.actions=[action];f.env.fire=b=>{f.fired.push(b.dataset.questTeleportId||b.dataset.action);if(b===action){f.state.err.hidden=false;f.state.err.textContent='Не у NPC'}return true};await f.q.pressAction(action);await f.q.pressAction(action);assert.equal(f.fired.filter(x=>x==='town').length,1);assert.ok(f.env.rt.campaignTp.npc);
});
test('complete-chapter error recovery cannot pay NPC twice after unknown outcome',async()=>{
 const f=fixture();npc(f);const done=box.el({textContent:'Завершить',dataset:{action:'complete-chapter'}});f.state.actions=[done];f.env.$q=s=>s==='[data-action="complete-chapter"]'?done:s.includes('-err')?f.state.err:s.includes('data-quest-teleport-id')?f.state.teleports[0]:null;
 f.env.fire=b=>{f.fired.push(b.dataset.questTeleportId||b.dataset.action);return true};await f.q.campaign();await f.q.campaign();assert.equal(f.fired.filter(x=>x==='town').length,1);assert.ok(f.env.rt.campaignTp.npc);
});
test('completed mob objectives without finish button route to NPC through durable intent',async()=>{
 const f=fixture();npc(f);f.env.rt.storySaga.stage='hunt_1';const target=box.el({textContent:'★ Mob Lv.15 1 / 1',querySelector:s=>s==='strong'?{textContent:'Mob'}:s.includes('progress')?{textContent:'1 / 1'}:null});f.state.targets=[target];f.env.fire=b=>{f.fired.push(b.dataset.questTeleportId||b.dataset.action);return true};await f.q.campaign();f.env.rt.npcTried=0;await f.q.campaign();assert.equal(f.fired.filter(x=>x==='town').length,1);assert.ok(f.env.rt.campaignTp.npc);
});
test('manual quest list change during fetch does not copy old list or navigate to its NPC',async()=>{
 const f=fixture();f.env.waitFor=async()=>{f.env.rt={char:'New',manualKickAt:2};return [{getAttribute:()=>'/old-campaign.html',closest:()=>null,textContent:'Old'}]};await f.q.questsStep();assert.equal(f.env.rt.questList,undefined);assert.equal(f.fired.length,0);
});

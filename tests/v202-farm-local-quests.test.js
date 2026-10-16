'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const box={};vm.runInNewContext(read('engine-core.js'),box);const E=box.L2EngineCore;
const closed={completed:true,stage:'completed'};
const complete=()=>({storySaga:{...closed},dionCampaign:{...closed},questList:[],questListT:Date.now()-1000,campSkipUntil:Date.now()+600000});
for(const main of ['farm','auto','cat'])test(main+' preserves explicit local quest priority without enabling campaign navigation',()=>{
 const raw={autoTasks:['tvt',main],searchQuest:true,campaign:true,campAuto:true,storyTurnIn:true},cfg=E.taskConfig(raw);
 assert.equal(cfg.searchQuest,true);assert.equal(cfg.campaign,false);assert.equal(cfg.campAuto,false);assert.equal(cfg.storyTurnIn,false);assert.equal(E.selectedTask(cfg),main);assert.equal(cfg.tvtOn,true);
 assert.equal(E.rawTaskConfig(cfg),raw);
});
test('the player can still turn local quest search off',()=>assert.equal(E.taskConfig({autoTasks:['farm'],searchQuest:false}).searchQuest,false));
async function readEmpty(rt,list=['quests','farm'],opt={}){
 const location={pathname:'/character-quests.html',href:'https://l2wap.com/character-quests.html'},b={location,document:{querySelectorAll:()=>[]}};
 vm.runInNewContext(read('modules/quests.js'),b);const empty={textContent:'Нет активных квестов.'};
 const env={on:true,tabOwner:true,rt,cfg:E.taskConfig({autoTasks:list},()=>rt),shown:e=>!!e,$q:()=>opt.noPlaceholder?null:empty,waitFor:async fn=>{const r=fn();await opt.after?.(env);return r},setStatus(){},sleep:async()=>{},setRt:async p=>Object.assign(rt,p),rec(){},goOutskirts:async()=>location.href='/map.html'};
 await b.L2V7Factories.quests(env).questsStep();return {env,location};
}
for(const list of [['quests','farm'],['quests','auto'],['quests','fish'],['quests']])test('both completed stories plus explicit empty list yield only to a selected task '+list,async()=>{
 const rt=complete();await readEmpty(rt,list);assert.equal(E.selectedTask({autoTasks:list},rt),list[1]||'tasks');
 assert.equal(rt.campaignViaMail,false);assert.ok(rt.campNoTasksUntil>Date.now());assert.equal(E.taskConfig({autoTasks:list},()=>rt).campaign,false);
});
for(const [name,change] of Object.entries({
 unknownStarter:r=>delete r.storySaga,unknownDion:r=>delete r.dionCampaign,
 activeDion:r=>r.dionCampaign={stage:'active',completed:false},activeStarter:r=>r.storySaga={stage:'hunt_1',completed:false},
 errorOnly:r=>{delete r.storySaga;delete r.dionCampaign;r.campSkipUntil=Date.now()+600000;}
}))test(name+' does not treat an empty page as campaign completion',async()=>{
 const rt=complete();change(rt);await readEmpty(rt);assert.equal(E.selectedTask({autoTasks:['quests','farm','fish']},rt),'quests');assert.equal(rt.campNoTasksUntil,undefined);
});
test('missing empty-list placeholder or failed read cannot release a completed campaign task',async()=>{
 const rt=complete();await readEmpty(rt,undefined,{noPlaceholder:true});assert.equal(rt.campNoTasksUntil,undefined);assert.equal(E.selectedTask({autoTasks:['quests','farm']},rt),'quests');
});
for(const kind of ['stop','owner','character','manual'])test('empty-list read canceled by '+kind+' cannot publish absence',async()=>{
 const rt={...complete(),char:'Hero'},f=await readEmpty(rt,undefined,{after:e=>{if(kind==='stop')e.on=false;if(kind==='owner')e.tabOwner=false;if(kind==='character')e.rt.char='Other';if(kind==='manual')e.rt.manualKickAt=1;}});
 assert.equal(rt.campNoTasksUntil,undefined);assert.equal(f.location.href,'https://l2wap.com/character-quests.html');
});
test('stage=completed is valid evidence; quest progress and map targets survive the task handoff',async()=>{
 const rt={...complete(),storySaga:{stage:'completed'},dionCampaign:{stage:'completed'},quests:{'Taik Orc Warrior':{left:47}},questSeen:{'taik orc warrior':1}};await readEmpty(rt);
 assert.equal(E.selectedTask({autoTasks:['quests','farm']},rt),'farm');assert.equal(rt.quests['Taik Orc Warrior'].left,47);assert.equal(rt.questSeen['taik orc warrior'],1);
});
test('completed campaign yields without starting navigation from the old task owner',async()=>{
 const {location}=await readEmpty(complete());assert.equal(location.href,'https://l2wap.com/character-quests.html');
});
test('absence expires and active/new quests always keep ownership',()=>{
 const rt={...complete(),campNoTasksUntil:Date.now()-1};assert.equal(E.selectedTask({autoTasks:['quests','farm']},rt),'quests');
 rt.campNoTasksUntil=Date.now()+600000;rt.questList=[{href:'/giran-campaign.html'}];assert.equal(E.selectedTask({autoTasks:['quests','farm']},rt),'quests');
});
test('completed stories do not authorize unselected farming or override raid/enchant priority',async()=>{
 const rt=complete();await readEmpty(rt);for(const list of [[],['tvt']])assert.equal(E.selectedTask({autoTasks:list},rt),'tasks');
 for(const k of ['raid','epic','enchant'])assert.equal(E.selectedTask({autoTasks:[k,'quests','farm']},rt),k);
});
// Мобы и порядок из снимка Forest of Mirrors 15:49:49: чемпион расположен раньше двух ★ целей.
function targets(searchQuest=true){
 const rows=[{id:'quest_human_fighter_second_prof_champion_mirror',name:'Mirror Trial Champion',lvl:53,champ:true,tier:'blue',hp:38136,exp:39750},
 {id:'dense_10653',name:'Taik Orc Warrior',lvl:42,quest:true,hp:2196,exp:3144},
 {id:'champ_r_forest_of_mirrors_2',name:'Taik Orc Warrior',lvl:42,quest:true,champ:true,tier:'red',hp:92232,exp:94320}];
 const links=rows.map(r=>({textContent:(r.quest?'★ ':'')+r.name+' · ур. '+r.lvl+(r.champ?' · чемпион':''),classList:{contains:k=>r.quest&&k==='l2-map-mob-link--quest-target'},getAttribute:()=>'/battle.html?spawnId='+r.id,closest:()=>({className:r.champ?'l2-map-mob-item--champion-'+r.tier:'',textContent:'HP '+r.hp+' · EXP '+r.exp})}));
 const b={document:{querySelectorAll:()=>links}};for(const m of ['quests','mobfarm'])vm.runInNewContext(read('modules/'+m+'.js'),b);
 const raw={autoTasks:['tvt','farm'],priority:'[квест]\n[чемп]\n[все]',searchQuest,searchChamp:true,champBlue:true,champRed:false,champFa:true,lvlAbove:99,lvlBelow:3,lvlMin:1,lvlMax:99};
 const env={cfg:E.taskConfig(raw),rt:{lvl:45,questSeen:{'taik orc warrior':Date.now()},spawns:Object.fromEntries(rows.map(r=>[r.id,[r.name,r.lvl]]))},LV_RE:/^([^\p{L}\d]*)(.+?)\s*[·•]\s*ур\.?\s*(\d+)/iu,QUEST:/★/,heroLvl:()=>45,campActive:()=>false,campMobOpen:()=>[],campChampOpen:()=>false,campChampMin:()=>0,farmRules:()=>[],recipeRules:()=>[],isRaidId:()=>false,isBoss:()=>false,isChamp:t=>/чемпион/.test(t),rec(){},champs:{tierOff:r=>r.tier==='red'?'red off':'',held:()=>'',judge:()=>({ok:true})},$q:()=>null};
 env.isQuestName=b.L2V7Factories.quests(env).isQuestName;const m=b.L2V7Factories.mobfarm(env);
 return {rules:m.parseRules(),picks:m.candidates(m.parseRules(),{ids:rows.map(r=>r.id),quest:[]},{},rows.length)};
}
test('point farm chooses the visible ordinary profession quest mob before an earlier champion',()=>{
 const {rules,picks}=targets();assert.equal(rules[0].quest,true);assert.equal(picks[0].id,'dense_10653');assert.equal(picks[0].quest,true);assert.equal(picks[0].rank,0);assert.ok(!picks.some(r=>r.id==='champ_r_forest_of_mirrors_2'));
});
test('explicitly disabled quest priority still permits the configured champion priority',()=>assert.equal(targets(false).picks[0].id,'quest_human_fighter_second_prof_champion_mirror'));

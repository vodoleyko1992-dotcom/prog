'use strict';
// Лог 15.10 20:25: принята глава Диона, сохранён адрес уже завершённого новичка.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function make(){
 const location={pathname:'/map.html',href:'/map.html',search:''};const document={querySelectorAll:()=>[],querySelector:()=>null};
 const box={location,document,Date,URL,console};vm.runInNewContext(fs.readFileSync('modules/quests.js','utf8'),box);
 const env={cfg:{campaign:true},rt:{campaignUrl:'/starter-story-quest.html',campaign:{title:'Новичок',targets:[{name:'Skeleton',ok:false}]},qAlias:{old:'Skeleton'},questSeen:{skeleton:Date.now()},quests:{Skeleton:{left:1}},campSkipUntil:Date.now()+600000},on:true,heroLvl:()=>24,setRt:p=>Object.assign(env.rt,p),setStatus:()=>{},sleep:async()=>{},isCampaign:()=>false,isMail:()=>false,rec:()=>{},shown:()=>false,$q:()=>null,waitFor:async f=>f(),goOutskirts:async()=>{env.out=true}};
 return {q:box.L2V7Factories.quests(env),env,location};
}
(async()=>{
 const {q,env,location}=make();q.sagaNote({stage:'completed',completed:true});
 assert.equal(env.rt.campaign,null);assert.equal(env.rt.campaignUrl,'');assert.equal(q.isQuestName('Skeleton'),false);
 q.dionNote({stage:'active',chapter:1});q.dionNote({stage:'active',chapter:2,chapterTitleRu:'Следы нападавших'});
 assert.equal(env.rt.campaignUrl,'/dion-campaign.html');assert.equal(env.rt.campaignDue,true);assert.equal(env.rt.campSkipUntil,0);
 await q.goCampaign();assert.equal(location.href,'/dion-campaign.html');
 env.rt.campaign={title:'Следы',targets:[{name:'Enku Orc Shaman',ok:false}]};env.rt.campaignDue=false;
 q.dionNote({stage:'active',chapter:2});assert.equal(env.rt.campaignDue,false,'повтор опроса не вызывает поездку');
 q.sagaNote({stage:'completed',completed:true});assert.equal(env.rt.campaign.targets[0].name,'Enku Orc Shaman');
 q.dionNote({stage:'active',chapter:1});assert.equal(env.rt.dionCampaign.chapter,2,'поздняя глава не откатывает');
 q.dionNote({stage:'not_started',chapter:2});assert.equal(env.rt.dionCampaign.stage,'active');
 location.pathname='/starter-story-quest.html';await q.campaign();assert.equal(location.href,'/dion-campaign.html','устаревшая страница не затирает новую главу');
 env.on=false;location.href='unchanged';await q.campaign();assert.equal(location.href,'unchanged','Stop');
 env.cfg={campAuto:true,campaign:false};assert.equal(q.campAuto(),true,'принятый Дион продолжается в авто');env.cfg.campAuto=false;assert.equal(q.campEnabled(),false);
 q.dionNote({stage:'completed',completed:true,chapter:10});assert.equal(env.rt.campaign,null);q.dionNote({stage:'active',chapter:10});assert.equal(env.rt.dionCampaign.completed,true);
 const b=make();b.env.cfg={campAuto:true};b.q.dionNote({stage:'not_started',chapter:1});assert.equal(b.q.campEnabled(),false,'не начинаем Дион без принятия');
 const c=make();c.q.sagaNote({stage:'hunt_1'});c.env.rt.campaign={targets:[{name:'Skeleton'}]};c.q.sagaNote({stage:'hunt_2'});assert.equal(c.env.rt.campaign,null,'новая стадия с тем же заголовком сбрасывает старые цели');
 const race=make();race.location.pathname='/dion-campaign.html';race.q.dionNote({stage:'active',chapter:2});
 const done={};race.env.$q=s=>s.includes('-campaign-title')?{textContent:'Глава '+race.env.rt.dionCampaign.chapter}:done;race.env.shown=x=>x===done;race.env.pause=async()=>{};race.env.rnd=()=>0;
 race.env.fire=()=>race.q.dionNote({stage:'active',chapter:3});
 await race.q.campaign();assert.equal(race.env.rt.dionCampaign.chapter,3);assert.equal(race.env.rt.campaign,null,'завершение главы не возвращает старый DOM');assert.equal(race.env.rt.campaignDue,true);
 const core=fs.readFileSync('content.js','utf8');assert.ok(core.includes('dion-campaign(?:\\/[\\w-]+)?$'));assert.ok(core.includes('starter-saga(?:\\/[\\w-]+)?$'));
 console.log('PASS campaign transition: completion, chapter change, stale response/page, Stop, auto/off');
})().catch(e=>{console.error(e);process.exitCode=1});

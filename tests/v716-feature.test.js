'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const root=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(root,'modules/fishing.js'),'utf8');
function fishing(mock) {
 const ctx={console,Date,Math,Number,location:{pathname:'/fishing.html'},setTimeout};
 vm.runInNewContext(code,ctx,{filename:'modules/fishing.js'});
 return ctx.L2V7Factories.fishing(mock);
}
(async()=>{
 let remain='00:04:45',aden='5 000 000',clicks=0,active=false,paused=false;
 const btn={disabled:false,querySelector:()=>({textContent:'3 000 000 Adena'})}; // 10.0.14: цена пакета приходит из UI игры.
 const fake={
  cfg:{fishTimeAuto:true,fishTimeMin:5,fishTimePack:'1h',shopReserve:200000},
  rt:{},on:true,
  $q:s=> s==='#fishing-time-remaining'? {textContent:remain} :
    s==='#fishing-time-adena'?{textContent:aden} :
    s==='[data-fishing-time-package="1h"]'?btn:null,
  setRt:async p=>Object.assign(fake.rt,p),
  rec(){},setStatus(){},
  fire:()=>{clicks++;remain='01:04:45'},
  waitFor:async fn=>Boolean(fn()),
  autonomyMode:()=> 'fish',
 };
 // fishState normally reads a DOM substructure; fake inactive with no hooked fish.
 const f=fishing(fake);
 assert.equal(f.fishingTimeRemainingMs('00:42:19'),2539000);
 assert.equal(f.fishingTimeRemainingMs('01:02:03'),3723000);
 assert.equal(f.fishingTimeRemainingMs('n/a'),null);
 assert.equal(await f.fishTimeTopUp(),true,'Should buy once when paid time is low');
 assert.equal(clicks,1);
 assert.equal(await f.fishTimeTopUp(),false,'Stored timestamp blocks duplicate purchases');
 assert.equal(clicks,1);
 fake.rt.fishTimeBuyAt=0; aden='3 000 000';remain='00:04:00';
 assert.equal(await f.fishTimeTopUp(),false,'Must honor cash reserve');
 assert.equal(clicks,1);
 fake.cfg.fishTimeAuto=false;aden='7 000 000';remain='00:03:00';fake.rt.fishTimeBuyAt=0;
 assert.equal(await f.fishTimeTopUp(),false,'Opt-out blocks payments');
 assert.equal(clicks,1);
 console.log('PASS: time parsing, single purchase, anti-double-charge, reserve, opt-out');
 const html=fs.readFileSync(path.join(root,'popup.html'),'utf8');
 const ui=fs.readFileSync(path.join(root,'ui-v7.js'),'utf8');
 const css=fs.readFileSync(path.join(root,'ui-game.css'),'utf8');
 const content=fs.readFileSync(path.join(root,'content.js'),'utf8');
 assert(html.includes('id="fishRodGoal10"') && html.includes('id="fishTimeAuto"'));
 // 20.12 (ревизия 17.10): кнопки «≡ Разделы» больше нет — шесть разделов всегда на виду; список задач скрывается атрибутом hidden (общее правило [hidden]).
 assert(html.includes('id="modeToggle"') && !html.includes('id="navToggle"'));
 assert(ui.includes("aria-expanded")&&ui.includes('taskListToggle'));
 assert(css.includes('font-size:14px')&&css.includes('[hidden]{display:none!important}')&&html.includes('<div id="quickModeGrid" hidden>'));
 assert(content.includes('rodGoalActive: false') && content.includes('rodScrollsBuy'));
 console.log('PASS: one-click rod +10, purchasable time, accessible toggles, game-style UI wired');
})().catch(e=>{console.error(e);process.exitCode=1;});

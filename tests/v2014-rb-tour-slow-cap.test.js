'use strict';
// 18.10 (лог 15:21:55, Olkuth 75: «долгий бой ≈39:46, предел 20», тур купил FA и телепорт и через 40 с вышел):
// обычный тур соблюдает предел долгого боя (cfg.rbMaxKillMin) до оплаты; 0 — без предела; прочий прогноз справочный.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const prefix=fs.readFileSync(__dirname+'/v1027-raid-incoming-probe.test.js','utf8').split("test('unknown incoming")[0];
const fixture=vm.runInNewContext(prefix+';fixture',{require,__dirname,console});
function live(min,dps){const f=fixture();Object.assign(f.env.cfg,{rbHuntMode:true,rbMaxBelow:12,rbMaxAbove:12,rbProbe:false,rbMaxKillMin:min,rbValueTour:true});Object.assign(f.rt.rbList.boss,{alive:true,price:100,unit:'аден',t:f.now()});f.env.RB_WIN=15;f.env.isMap=()=>false;
 const ctx=f.env.warlock.raidContext();f.rt.rbDb.boss={dps,dpsContext:ctx.key,dpsLvl:78};return f;}
test('ordinary tour skips a measured fight longer than the cap before paying',()=>{
 const f=live(30,2123774/(40*60));const c=f.R.rbEntryDecision('boss',f.rt.rbList.boss);
 assert.equal(c.ok,false,c.why);assert.equal(c.kind,'slow');assert.match(c.why,/долгий бой/);assert.match(c.why,/предел 30 мин/);
});
test('fight within 30 minutes and cap 0 still go in the ordinary tour',()=>{
 for(const f of [live(30,2123774/(25*60)),live(0,2123774/(40*60))]){const c=f.R.rbEntryDecision('boss',f.rt.rbList.boss);assert.equal(c.ok,true,c.why);assert.equal(c.kind,'live')}
});

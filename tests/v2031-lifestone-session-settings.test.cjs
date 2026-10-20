'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=require('node:path').resolve(__dirname,'..'),read=f=>fs.readFileSync(root+'/'+f,'utf8'),src=read('content.js'),clone=x=>JSON.parse(JSON.stringify(x));
const helpers=src.slice(src.indexOf('const OWN_CFG = []'),src.indexOf('async function setCfg(',src.indexOf('const OWN_CFG = []')));
const start=src.lastIndexOf('chrome.storage.onChanged.addListener(ch => {'),listener=src.slice(start,src.indexOf('\n});',start)+4);
function fixture(){
 const box={console,Date:{now:()=>100000},Math,sessionStorage:{removeItem(){}},window:{},FARM:null,RECIPES:null,LEARN:null,learnDirty:false,TAB_ID:'test',DEF_RT:{},running:false,
 rtWriter:{peek:()=>({}),clear(){}},rec(){},enchantModePause:async()=>{},abBlink(){},heroNick:()=> 'Hero',main(){},dock(){},draw(){},invScanDrive(){},learnLoad:async()=>{},
 modeSig:c=>JSON.stringify(c.autoTasks||[]),mergeCfg:c=>({...c}),L2V7Modules:{mammon:{bagAuto:async()=>{}},enchant:{command:async()=>{}}},chrome:{storage:{onChanged:{addListener:fn=>box.event=fn}}}};
 box.window=box;vm.createContext(box);vm.runInContext("let cfg={autoLs:{targets:['prominence'],maxAttempts:3}},rt={char:'Hero',manualKickAt:1},on=true,tabOwner=true,tabIdle=false,leaseEpoch='lease',automationGeneration=4;\n"+helpers+"\nthis.runtime={cfg:()=>cfg,rt:()=>rt,on:()=>on,gen:()=>automationGeneration,own:()=>OWN_CFG,view:viewOnlyCfgChange,match:ownCfgChange};",box);
 for(const f of ['augment.js','modules/lifestone.js'])vm.runInContext(read(f),box);
 const snap={name:'Hero',revision:10,inventory:{eq:{l1:{itemId:123,enchant:7}},stacks:[{itemId:10411,qty:5},{itemId:2133,qty:5}]}};
 const posts=[],env={get cfg(){return box.runtime.cfg();},get rt(){return box.runtime.rt();},get on(){return box.runtime.on();},tabOwner:true,canPrepare:()=>true,canRun:()=>true,
 context:()=>JSON.stringify(['Hero','lease',box.runtime.gen(),box.runtime.rt().manualKickAt,'/augmentation.html']),
 setRt:async p=>{Object.assign(box.runtime.rt(),clone(p));return{ok:true};},rec(){},setStatus(){},gameGet:async p=>({ok:true,json:async()=>clone(p==='/character'?{character:snap}:{itemGradeHints:{123:'A'}})}),
 gamePost:async(path,body,ms,id)=>{assert.equal(m.consumePermit(id,body),true);posts.push({path,body});snap.revision++;snap.inventory.stacks.forEach(r=>r.qty--);snap.inventory.eq.l1.augmentation={uid:'new-'+posts.length,grade:'A',outcomeId:'tempest'};return{ok:true,status:200,json:async()=>({outcomeId:'tempest',gemstonesSpent:1})};}};
 const m=box.L2V7Factories.lifestone(env);box.L2V7Modules.lifestone=m;vm.runInContext(listener,box);
 const cfgChange=change=>{const oldValue=clone(box.runtime.cfg()),newValue={...oldValue,...change};box.event({cfg:{oldValue,newValue}});};
 return{box,m,posts,env,cfgChange,start:async()=>{await m.command('prepare');await m.command('resume');},snap};
}
for(const [name,oldValue,newValue] of [
 ['missing→empty ranges',{}, {limitRanges:{}}],['empty→missing ranges',{limitRanges:{}},{}],['identical values',{dockMin:false},{dockMin:false}],['dock only',{dockMin:false},{dockMin:true}]
])test('семантически безопасное cfg-событие: '+name,()=>{const f=fixture();assert.equal(f.box.runtime.view({oldValue,newValue}),true);});
for(const [name,change] of [['new range',{limitRanges:{dailyFishLimit:{min:1,max:2}}}],['LS targets',{autoLs:{targets:['hurricane'],maxAttempts:3}}],['LS limit',{autoLs:{targets:['prominence'],maxAttempts:5}}],['other setting',{nBuffs:'new'}]])test('реальное изменение остаётся управляющим: '+name,()=>{const f=fixture();assert.equal(f.box.runtime.view({oldValue:f.box.runtime.cfg(),newValue:{...clone(f.box.runtime.cfg()),...change}}),false);});
test('no-op не потребляет квитанцию собственного setCfg',()=>{const f=fixture();f.box.runtime.own().push({t:100000,patch:{nBuffs:'new'}});assert.equal(f.box.runtime.match({oldValue:{nBuffs:'old'},newValue:{nBuffs:'old'}}),false);assert.equal(f.box.runtime.own().length,1);assert.equal(f.box.runtime.match({oldValue:{nBuffs:'old'},newValue:{nBuffs:'new'}}),true);assert.equal(f.box.runtime.own().length,0);});
for(const [name,change,own] of [['normalization',{limitRanges:{}},false],['dock',{dockMin:true},false],['own write',{nBuffs:'new'},true],['no-op',{},false]])test('настоящая LS-серия переживает безвредное событие '+name,async()=>{
 const f=fixture();await f.start();if(own)f.box.runtime.own().push({t:100000,patch:change});f.cfgChange(change);await f.m.step();assert.equal(f.posts.length,1,'серия выполняет подтверждённую попытку');assert.equal(f.box.runtime.gen(),4,'контекст серии не устарел');assert.equal(f.env.rt.autoLs.attempts,1);assert.equal(f.env.rt.autoLs.status,'running');
});
for(const [name,change] of [['targets',{autoLs:{targets:['hurricane'],maxAttempts:3}}],['limit',{autoLs:{targets:['prominence'],maxAttempts:5}}],['nonempty range',{limitRanges:{dailyFishLimit:{min:1,max:2}}}],['external setting',{nBuffs:'new'}]])test('настоящая серия останавливается при реальном изменении '+name,async()=>{
 const f=fixture();await f.start();f.cfgChange(change);await f.m.step();assert.equal(f.posts.length,0);assert.equal(f.box.runtime.gen(),5);assert.equal(f.env.rt.autoLs.status,'paused');
});
test('Stop по-прежнему прекращает расход',async()=>{const f=fixture();await f.start();f.box.event({on:{oldValue:true,newValue:false}});await f.m.step();assert.equal(f.posts.length,0);assert.equal(f.env.on,false);assert.equal(f.env.rt.autoLs.status,'paused');});
test('смена персонажа по-прежнему запрещает старой серии расход',async()=>{const f=fixture();await f.start();f.box.event({rt:{oldValue:clone(f.env.rt),newValue:{char:'Other'}}});await f.m.step();assert.equal(f.posts.length,0);assert.equal(f.env.rt.char,'Other');assert.equal(f.box.runtime.gen(),5);});

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const mf = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const featurePaths = mf.content_scripts.find(x => x.js.includes('content.js')).js;
const modules = featurePaths.filter(x=>x.startsWith('modules/'));
const required = ['fishing','epics','raid','combat','dungeons','tvt','mobfarm','quests','navigation','buffs','equipment','economy','resources','loot','survival'];
assert.deepEqual(modules.map(s=>path.basename(s,'.js')),required);
assert.equal(new Set(featurePaths).size,featurePaths.length,'Duplicate script in manifest');
assert.match(mf.version, /^7\.(?:0\.[01]|1\.[0-9]+|2(?:\.[0-9]+)?)$/);
for (const s of featurePaths) assert(fs.existsSync(path.join(root,s)), `Missing module ${s}`);
const ctx = vm.createContext({
  addEventListener(){}, removeEventListener(){},
  console, setTimeout:()=>123,clearTimeout(){}, setInterval:()=>123,clearInterval(){},
  URL, URLSearchParams, Date, Math, crypto: { randomUUID: ()=>'lease-mock' },
  sessionStorage: {getItem:()=>null,setItem(){}},
  navigator: {userAgent:'Chrome'}, location: {pathname:'/map.html',search:'',href:'https://l2wap.com/map.html',origin:'https://l2wap.com'},
  window: {addEventListener(){},innerWidth:1080},
  document: {
    visibilityState:'visible', prerendering:false,
    createElement(){return { id:'', textContent:'', style:{}, append(){}, querySelector(){return null}, querySelectorAll(){return []} };},
    addEventListener(){}, querySelector(){return null}, querySelectorAll(){return []},
    getElementsByTagName(){return []}, hasFocus(){return true},
    documentElement:{className:'',clientWidth:1024,append(){}}, body:{className:'',querySelector(){return null}},
  },
  chrome: {
    runtime:{sendMessage:async()=>null, onMessage:{addListener(){}}, getManifest:()=>mf,
      getURL:(s='')=>'chrome-extension://abc/'+s},
    storage:{onChanged:{addListener(){}},local:{get:()=>new Promise(()=>{}),set:async()=>{}}},
  },
});
ctx.window.window=ctx.window;
for (const s of featurePaths) {
 try {vm.runInContext(fs.readFileSync(path.join(root,s),'utf8'),ctx,{filename:s,timeout:2500});}
 catch (e) {throw Error(`Failed to initialize ${s}: ${e.stack}`);}
}
assert.deepEqual([...vm.runInContext('Object.keys(L2V7Modules)',ctx)].sort(), [...required].sort());
const map = JSON.parse(fs.readFileSync(path.join(root,'MODULE_MAP.json'), 'utf8'));
for(const [name, module] of Object.entries(map)){
  for(const f of module.exports){
    assert.equal(vm.runInContext(`typeof L2V7Modules.${name}.${f}`,ctx),'function', `Missing export ${name}.${f}`);
  }
}
const fish = vm.runInContext('L2V7Modules.fishing.isFishing()',ctx);
assert.equal(fish,false);
assert.equal(vm.runInContext('L2V7Modules.epics.isEpicPage()',ctx),false);
assert.equal(vm.runInContext('L2V7Modules.navigation.isMap()',ctx),true);
assert.equal(vm.runInContext('L2V7Modules.resources.meHp()',ctx),null);
assert.equal(vm.runInContext('L2V7Modules.combat.mobHp()',ctx),null);

// Regression from real 2026-10-09 log: potion identification must not call
// `.test` on an unbound HP_POT_RE, and mode selection must be injected.
assert.equal(vm.runInContext(`L2V7Modules.combat.ready({
  title:'Зілля зцілення', className:'l2-battle-hotbar-slot', disabled:false,
  getAttribute:()=>null,
  querySelector:(sel)=>sel==='.l2-battle-hotbar-slot-uqty'?{textContent:'12'}:null
})`,ctx),true,'Potion readiness must not throw or use local skill cooldown');
assert.equal(vm.runInContext('typeof autonomyMode',ctx),'function');
// 7.1.31 (игрок: «поставил 99999, а он всё равно проверяет карту»): 0 = карту по плану не проверять никогда (было «каждый бой»)
const due = (c, r) => vm.runInContext(`cfg = mergeCfg(${JSON.stringify(c)}); rt = { ...DEF_RT, ...${JSON.stringify(r)} }; mapDue(parseRules())`, ctx);
assert.equal(due({ deepEvery: 0, searchChamp: true }, { sinceDeep: 500, deepHot: true }), false, '0 = never: no planned/champion/hot map');
assert.equal(due({ deepEvery: 99999, searchChamp: true }, { sinceDeep: 25 }), true, 'champions on: map at least every 20 fights');
assert.equal(due({ deepEvery: 99999, searchChamp: false }, { sinceDeep: 25 }), false, 'champions off: 99999 respected');
assert.equal(due({ deepEvery: 10, searchChamp: false }, { sinceDeep: 10 }), true, 'every 10 fights');
// Every env.foo access in source modules needs a corresponding lazy binding.
for (const modName of required) {
  const source=fs.readFileSync(path.join(root,'modules',modName+'.js'),'utf8');
  const exported=new Set([...source.matchAll(/\benv\.([A-Za-z_$][\w$]*)/g)].map(m=>m[1]));
  const bridge=fs.readFileSync(path.join(root,'content.js'),'utf8');
  const start=bridge.indexOf(`L2V7Modules.${modName} = L2V7Factories.${modName}({`);
  assert(start>=0,modName+' bridge missing');
  const end=bridge.indexOf('});',start);
  const actual=new Set([...bridge.slice(start,end).matchAll(/\bget\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]));
  const missing=[...exported].filter(name=>!actual.has(name));
  assert.deepEqual(missing,[],`${modName} missing dependencies ${missing.join(', ')}`);
}
console.log('PASS: potion runtime and complete lazy dependency bridges for 15 modules');

// Lazy dependencies must refer to the current character object, not its init-time snapshot.
vm.runInContext("rt = {char:'West', fish:{casts:3}}",ctx);
assert.equal(vm.runInContext('L2V7Modules.fishing.fishStat instanceof Function',ctx),true);
assert.equal(vm.runInContext('L2V7Modules.fishing.fishState()',ctx),null);
vm.runInContext("rt = {char:'WestSPOIL', fish:{casts:7}}",ctx);
assert.equal(vm.runInContext('L2V7Modules.fishing.fishState()',ctx),null);
// Cross-module state access must be evaluated at call time. Verify actual write path.
(async () => {
  vm.runInContext("setRt = async (p) => { rt = {...rt, ...p}; return {ok:true}; }",ctx);
  vm.runInContext("rt = {char:'West', fish:{casts:2, caught:0}}",ctx);
  await vm.runInContext("L2V7Modules.fishing.fishStat({casts:1},'Silver Fish')",ctx);
  assert.equal(vm.runInContext('rt.fish.casts',ctx),3);
  assert.equal(vm.runInContext('rt.fish.byFish["Silver Fish"]',ctx),1);
  vm.runInContext("rt = {char:'WestSPOIL',fish:{casts:8, caught:0}}",ctx);
  await vm.runInContext("L2V7Modules.fishing.fishStat({casts:2})",ctx);
  assert.equal(vm.runInContext('rt.fish.casts',ctx),10);
  assert.equal(vm.runInContext('rt.fish.byFish["Silver Fish"]',ctx),undefined);
  console.log('PASS: module state is rebound on character change, no stale character writes');
})().catch(e=>{console.error(e);process.exitCode=1;});
console.log('PASS: Manifest V3, unique ordered modules, live isolated-context initialization');
console.log('PASS: 15 module factories, '+Object.values(map).reduce((n,m)=>n+m.exports.length,0)+' functional exports');
console.log('PASS: module API smoke, character rebinding');

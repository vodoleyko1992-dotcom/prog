'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
const files={};
for(const n of ['content.js','popup.js','popup.html','background.js','ui-v7.js','ui-game.css'])
  files[n]=fs.readFileSync(path.join(base,n),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json')));
assert.equal(manifest.version,'20.42.1');
// 20.13 (ревизия 17.10, шаг 7, defaults/D12): умолчания движка и меню — одна таблица defaults.js
files['defaults.js']=fs.readFileSync(path.join(base,'defaults.js'),'utf8');
for(const n of ['defaults.js']){
  assert.match(files[n],/fishMode: false, rodEnchantTo: 10,/);
  assert.match(files[n],/fishGoal: ''/);
  assert.doesNotMatch(files[n],/fishGoal: 'tattoo_d, cloak_d, belt_d'/);
}
assert.match(files['popup.html'],/ui-game\.css/);
assert.doesNotMatch(files['popup.html'],/href="ui-ios\.css"|href="ui-readable\.css"/);
assert.match(files['popup.html'],/id="rodEnchantTo"[^>]+value="10"/);
assert.match(files['popup.html'],/id="goalProof" class="on" aria-pressed="true"/);
assert.match(files['popup.js'],/goalProof'\)\.setAttribute\('aria-pressed'/);
assert.match(files['background.js'],/v715FishingDefaultsApplied/);
assert.match(files['background.js'],/if \(value\.fishGoal === oldGoal\) patch\.fishGoal = ''/);
assert.match(files['background.js'],/if \(value\.rodEnchantTo === 0 \|\| value\.rodEnchantTo == null\) patch\.rodEnchantTo = 10/);
assert.match(files['ui-game.css'],/#goalProof\.on,#goalItems\.on/);
assert.match(files['ui-v7.js'],/rodEnchantTo:'Целевой уровень/);
assert.equal((files['popup.html'].match(/id="fishGoal"/g)||[]).length,1);
console.log('PASS: original in-game dark/gold stylesheet wired and semantic pressed state');
console.log('PASS: +10 rod, proof accumulation, selective migration with one-time marker');

// Execute the exact update-migration block from background.js with mocked storage.
const background=files['background.js'];
const migrationStart=background.indexOf("if (details?.reason === 'update') try {");
const migrationEnd=background.indexOf("  try {\n    const tabs =",migrationStart);
assert(migrationStart>0&&migrationEnd>migrationStart,'Migration code must be present');
const migration=background.slice(migrationStart,migrationEnd);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const apply=new AsyncFunction('chrome','details','console',migration);
async function migrate(state){
  const calls=[];
  const chrome={storage:{local:{get:async keys=> {
    if(typeof keys==='string')return {[keys]:state[keys]};
    return Object.fromEntries(keys.map(k=>[k,state[k]]));
  },set:async patch=> {calls.push(patch);Object.assign(state,patch);}}}};
  await apply(chrome,{reason:'update'},console);
  return calls.length;
}
(async()=>{
  const preset={cfg:{fishGoal:'tattoo_d, cloak_d, belt_d',rodEnchantTo:0,shopAuto:true},
    rt:{char:'West'},'cfg@West':{fishGoal:'tattoo_d, cloak_d, belt_d',rodEnchantTo:0}};
  assert.equal(await migrate(preset),1);
  assert.deepEqual([preset.cfg.fishGoal,preset.cfg.rodEnchantTo,preset.cfg.shopAuto],['',10,true]);
  assert.deepEqual([preset['cfg@West'].fishGoal,preset['cfg@West'].rodEnchantTo],['',10]);
  assert.equal(await migrate(preset),0,'Migration must run only once');
  const custom={cfg:{fishGoal:'cloak_a',rodEnchantTo:8},rt:{char:'West'},'cfg@West':{fishGoal:'belt_s',rodEnchantTo:9}};
  assert.equal(await migrate(custom),1);
  assert.deepEqual([custom.cfg.fishGoal,custom.cfg.rodEnchantTo],['cloak_a',8]);
  assert.deepEqual([custom['cfg@West'].fishGoal,custom['cfg@West'].rodEnchantTo],['belt_s',9]);
  console.log('PASS: update migration preserves customized settings and is idempotent');
})().catch(e=>{console.error(e);process.exitCode=1;});

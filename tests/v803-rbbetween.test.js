'use strict';
// The retired add-on must stay off even in an upgraded profile that still stores rbBetween=true.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const content=read('content.js'),popup=read('popup.js'),html=read('popup.html'),mobfarm=read('modules/mobfarm.js');
const src=content.match(/const rbEff = (c => [^;]+);/)?.[1];assert.ok(src);
const box=vm.createContext({DEF_CFG:{rbHuntMode:false,enchantMode:false}});
vm.runInContext(read('engine-core.js'),box); // 10.0.27: общий policy нужен mergeCfg.
vm.runInContext(`const rbEff=${src};${content.match(/const withRb = [^;]+;/)[0]}${content.match(/const mergeCfg = [^;]+;/)[0]}this.mergeCfg=mergeCfg;`,box);
assert.equal(box.mergeCfg({rbBetween:true,rbMode:true}).rbMode,false,'legacy add-on cannot revive ordinary RB hunting');
assert.equal(box.mergeCfg({rbHuntMode:true,rbBetween:false,rbMode:false}).rbMode,true,'raid tour still permits its battles');
assert.equal(box.mergeCfg({rbHuntMode:true,enchantMode:true}).rbMode,false,'enchant mode still suspends raids');
assert.doesNotMatch(html,/id="rbToggle"|РБ между мобами/,'retired switch is absent from the UI');
assert.doesNotMatch(popup,/\$\('rbToggle'\)|const v = !cfg\.rbBetween/,'popup cannot re-enable the add-on');
assert.match(mobfarm,/env\.farmRbOn\(\)/,'explicit resource-boss route stays available');
assert.match(mobfarm,/env\.campRbOpen\(\)\.length/,'story boss route stays available');
console.log('PASS: retired RB-between mode stays off; raid tour and explicit goals remain');

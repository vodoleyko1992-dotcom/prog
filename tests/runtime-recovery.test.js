const assert=require('node:assert/strict');
const {createRecoveryController}=require('../engine-core');
let now=100000;
const rc=createRecoveryController(()=>now);
const e=new TypeError("Cannot read properties of undefined (reading 'test')");
assert.equal(rc.failure('/battle',e).action,'retry');
// 7.1.14-fix: «Cannot read properties of null/undefined» — гонка с загрузкой страницы: 2-я — перезагрузка, 4-я — стоп
const second=rc.failure('/battle',e);
assert.equal(second.action,'reload');assert.equal(second.programming,true);assert.ok(second.delayMs<5000);
assert.equal(rc.failure('/battle',e).action,'reload');
const fatal=rc.failure('/battle',e);assert.equal(fatal.action,'halt');
const e2=new TypeError('env.autonomyMode is not a function');
assert.equal(rc.failure('/map',e2).action,'retry');assert.equal(rc.failure('/map',e2).action,'halt');
rc.progress('/battle');assert.equal(rc.failure('/battle',e).action,'retry');
const net=createRecoveryController(()=>now);
for(let i=0;i<6;i++){var state=net.failure('/battle',new Error('Failed to fetch'));}
assert.equal(state.action,'cooldown');assert.ok(state.delayMs<=30000);
const web=net.failure('/fishing',new TypeError('Failed to fetch'));
assert.equal(web.programming,false);
console.log('PASS: repeated code errors halt quickly, network waits bounded to 30s, success resets streak');

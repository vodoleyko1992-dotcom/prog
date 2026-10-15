'use strict';
// Mirrors 15.10 live receipt: bag helmet 20003 +0→+1, C ordinary scroll, string Adena.
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'/opt/node-tools/node_modules/playwright'),assert=require('node:assert/strict');
const {boot,downloadPublic}=require('./v1016-enchant-public-browser.cjs');
(async()=>{await downloadPublic();const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/opt/pw-browsers/chromium',args:['--no-sandbox']});try{
 const f=await boot(browser,{nativeHelmet:true,target:'bag:20003:0',category:'armor',policy:'ordinary',level:0,outcomes:[true]});await f.tick();const x=await f.page.evaluate(()=>({posts:F.posts,snap:F.snap,state:E.rt.enchant}));
 assert.equal(x.posts.length,1);assert.equal(x.posts[0].expectedRevision,294813);assert.equal(x.posts[0].scrollItemId,910512);assert.equal(x.posts[0].count,1);assert.equal(x.snap.revision,294814);assert.equal(x.snap.adena,'357864408');assert.equal(x.snap.inventory.stacks.find(i=>i.itemId===910512).qty,13);assert.equal(x.state.pending,null);assert.equal(x.state.status,'done');assert.equal(x.state.items[0].targetInstanceId,'bag:20003:1');assert.equal(x.state.totals.successes,1);assert.equal(x.state.totals.adena,0);assert.deepEqual(f.errors,[]);
 console.log('PASS native enchant string Adena: helmet +0→+1, C scroll14→13, no false unknown; real game actions: 0');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});

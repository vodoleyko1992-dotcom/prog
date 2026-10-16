'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../content.js','utf8');
const ctx={};vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf('function dockWideRoom('),src.indexOf('\nfunction dock()',src.indexOf('function dockWideRoom('))),ctx);
for(const [vw,left,right] of [[1897,650,1250],[1920,680,1240],[1366,400,960],[1024,330,700],[760,320,480],[640,0,0],[375,0,0],[2560,900,1660]]){
 const normal=right&&vw-right-8>=300?vw-right-8:Math.min(380,vw-16);
 const result=ctx.dockWideRoom(vw,normal,true,false,left);
 assert.ok(result.width<=normal*2&&result.width<=vw-16);
 const free=Math.min(Math.max(0,left-16),Math.floor(vw/2)-16,Math.max(0,result.menuLeft-16),440);
 if(free>=300)assert.ok(8+free<=result.menuLeft-8,'visible indicator has an 8px gap');
 else assert.ok(src.includes("ui.classList.toggle('dock-covered', menuLeft !== null && free < 300)"),'small indicator is hidden');
 assert.equal(ctx.dockWideRoom(vw,normal,false,false,left).width,normal);
 assert.equal(ctx.dockWideRoom(vw,normal,true,true,left).menuLeft,null);
 assert.equal(ctx.dockWideRoom(vw,normal,false,false,left).menuLeft,null);
}
console.log('PASS x2 shared bounds at 8 viewport sizes, normal width, folded restoration');

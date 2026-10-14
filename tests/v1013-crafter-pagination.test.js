"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let page=1,total=27,stuck=false;
const buttons=()=>{let first=Math.floor((page-1)/5)*5+1;return [...(first>1?['<<']:[]),...Array.from({length:Math.min(5,total-first+1)},(_,i)=>String(first+i)),...(first+4<total?['>>']:[])].map(text=>({textContent:text,disabled:+text===page}));};
const document={querySelector:s=>s.includes('aria-current')?{textContent:String(page)}:null,querySelectorAll:()=>buttons()};
const box={document,console};vm.createContext(box);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../modules/mammon.js'),'utf8'),box);
const mod=box.L2V7Factories.mammon({fire:b=>{if(stuck)return;page=b.textContent==='>>'?Math.floor((page-1)/5)*5+6:b.textContent==='<<'?Math.floor((page-1)/5)*5-4:+b.textContent;},waitX:async fn=>fn()});
(async()=>{for(const target of [2,26,11,1,27]){assert.equal(await mod.pageGo(target),true);assert.equal(page,target);}stuck=true;assert.equal(await mod.pageGo(1),false);console.log('PASS: crafter numbered pages, both group directions and unchanged response');})().catch(e=>{console.error(e);process.exit(1);});

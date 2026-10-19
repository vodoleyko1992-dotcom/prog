'use strict';
// Синтетический Chromium DOM; все URL обслуживаются локальным route, аккаунт игры не используется.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'playwright');
const src=fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),start=src.indexOf('function domSnapshot() {'),end=src.indexOf('// проверка панели:',start);
assert.ok(start>=0&&end>start);const code=src.slice(start,end);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
  await page.goto('https://snapshot.invalid/map.html?spawnId=boss&token=FAKE_QUERY_TOKEN&password=FAKE_QUERY_PASSWORD&passed=1');
  const privateHtml='<section id="panel"><div><input type="password" value="FAKE_PASSWORD"><input type="hidden" name="csrf" value="FAKE_CSRF"><textarea value="FAKE_TEXTAREA_ATTRIBUTE">FAKE_TEXTAREA_TEXT</textarea><script type="application/json">{"token":"FAKE_SCRIPT_TOKEN"}</script><iframe srcdoc="FAKE_FRAME"></iframe><style>/*FAKE_STYLE*/</style><noscript>FAKE_NOSCRIPT</noscript><span id="status">Рыбалка готова</span></div></section>';
  for(const scenario of ['small','large-block','large-recursive','large-bounded']){
   const filler=scenario==='small'?'':Array.from({length:scenario==='large-bounded'?8000:3500},()=>'<i>'+((scenario==='large-recursive'||scenario==='large-bounded')?'x'.repeat(120):'')+'</i>').join('');
   await page.setContent('<main>'+privateHtml+filler+'</main>');
   const result=await page.evaluate(code=>{
    const before=document.body.outerHTML;let bodyClones=0;const clone=Element.prototype.cloneNode;
    Element.prototype.cloneNode=function(...args){if(this===document.body)bodyClones++;return clone.apply(this,args);};
    let html;const t=performance.now();try{html=Function(code+';return domSnapshot();')();}finally{Element.prototype.cloneNode=clone;}
    return {html,unchanged:document.body.outerHTML===before,bodyClones,ms:performance.now()-t};
   },code);
   assert.doesNotMatch(result.html,/FAKE_|<(?:script|style|noscript|iframe)\b/i,scenario);assert.match(result.html,/Рыбалка готова/);assert.match(result.html,/spawnId=boss&token=\*\*\*&password=\*\*\*&passed=1/);
   assert.equal(result.unchanged,true,scenario+' source DOM');assert.equal(result.bodyClones,scenario==='small'?1:0,scenario+' bounded cloning');assert.ok(result.html.length<400350,scenario+' output limit');
   console.log('PASS '+scenario+' '+JSON.stringify({length:result.html.length,bodyClones:result.bodyClones,ms:Math.round(result.ms)}));
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

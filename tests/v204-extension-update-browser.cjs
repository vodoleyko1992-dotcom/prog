'use strict';
// Настоящий MV3: меняем файл manifest после загрузки, без доступа к аккаунту и серверу игры.
const {chromium}=require(process.env.PLAYWRIGHT_NODE||'playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),scratch=path.join(root,'..','work');fs.mkdirSync(scratch,{recursive:true});
const tmp=fs.mkdtempSync(path.join(scratch,'extension-update-')),ext=path.join(tmp,'ext');fs.mkdirSync(ext);
fs.mkdirSync(path.join(tmp,'profile','Default'),{recursive:true});
fs.writeFileSync(path.join(tmp,'profile','Default','Preferences'),JSON.stringify({extensions:{ui:{developer_mode:true}}}));
for(const entry of fs.readdirSync(root,{withFileTypes:true}))if(entry.isFile()&&/\.(?:js|json|css|html)$/.test(entry.name)||entry.isDirectory()&&['modules','icons'].includes(entry.name))fs.cpSync(path.join(root,entry.name),path.join(ext,entry.name),{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=15000){const end=Date.now()+ms;while(Date.now()<end){try{const r=await fn();if(r)return r}catch{}await pause(100)}throw Error('timeout')}
(async()=>{
 const ctx=await chromium.launchPersistentContext(path.join(tmp,'profile'),{headless:true,executablePath:process.env.CHROMIUM,ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox','--enable-unsafe-extension-debugging']});
 try{
  const errors=[],network=[];await ctx.route('https://**/*',r=>{network.push(r.request().url());return r.abort()});
  // Загружаем как unpacked в режиме разработчика, как в chrome://extensions.
  const cdp=await ctx.browser().newBrowserCDPSession();await cdp.send('Extensions.loadUnpacked',{path:ext});
  let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=new URL(sw.url()).host;
  await until(()=>sw.evaluate(async()=>!!(await chrome.storage.local.get('cfg')).cfg));await pause(200);
  const saved={on:false,cfg:{autoTasks:['fish'],fishTimeAuto:false,rodEnchantTo:10},rt:{char:'UpdateTest',skills:{},enchant:{runId:'saved-run',char:'UpdateTest',status:'paused',items:[],history:[],totals:{attempts:0,successes:0,failures:0,scrolls:0,adena:0,byScroll:{}},pending:{id:'unknown-receipt',state:'unknown'}},auditSaved:'keep'}};
  await sw.evaluate(s=>chrome.storage.local.set(s),saved);
  let popup=await ctx.newPage();popup.on('pageerror',e=>errors.push(e.message));await popup.goto(`chrome-extension://${id}/popup.html`);
  await until(()=>popup.evaluate(()=>typeof checkExtensionUpdate==='function'));await popup.evaluate(()=>checkExtensionUpdate());
  assert.equal(await popup.locator('#updateWarn').isHidden(),true);console.log('PASS matching loaded/package version: no update notice');
  const manifest=JSON.parse(fs.readFileSync(ext+'/manifest.json','utf8')),oldVersion=manifest.version;manifest.version='99.1';manifest.version_name='99.1';fs.writeFileSync(ext+'/manifest.json',JSON.stringify(manifest));
  // Обновление даже самой страницы меню не обновляет зарегистрированный manifest Chrome.
  await popup.reload();await until(()=>popup.locator('#updateWarn').isVisible());
  assert.equal(await popup.evaluate(()=>chrome.runtime.getManifest().version),oldVersion);assert.match(await popup.locator('#updateWarnText').textContent(),/v99\.1/);
  await popup.evaluate(()=>load());assert.equal(await popup.locator('#updateWarn').isVisible(),true);console.log('PASS replaced files + page reload: old runtime stays loaded; notice survives normal redraw');
  await popup.locator('#reloadBot').click().catch(e=>{if(!popup.isClosed()&&!/closed|destroyed|context/i.test(e.message))throw e});
  await pause(300);
  // Страница меню в обычной вкладке может остаться открытой после уничтожения её extension context.
  popup=await ctx.newPage();popup.on('pageerror',e=>errors.push(e.message));await popup.goto(`chrome-extension://${id}/popup.html`);
  await until(()=>popup.evaluate(()=>chrome.runtime.getManifest().version==='99.1'));
  const after=await popup.evaluate(()=>chrome.storage.local.get(['on','cfg','rt']));assert.deepEqual(after,saved);console.log('PASS explicit extension reload activates new manifest and retains settings + unknown receipt');
  await until(()=>popup.evaluate(()=>typeof checkExtensionUpdate==='function'));await popup.evaluate(()=>checkExtensionUpdate());assert.equal(await popup.locator('#updateWarn').isHidden(),true);
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);console.log('PASS new menu has no stale notice; 0 JS errors; 0 game/network requests');
 }finally{await ctx.close();fs.rmSync(tmp,{recursive:true,force:true})}
})().catch(e=>{console.error(e.stack);process.exitCode=1});

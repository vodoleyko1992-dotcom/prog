'use strict';
// 20.46: настоящий Chromium/MV3 + chrome.storage.local + HTTP только на 127.0.0.1.
// Сервер применяет крафт и не отвечает: reload уничтожает документ до catch/credit. Проверяется реальный модуль, не его копия.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/workspace/.local/l2tools/node/node_modules/playwright');
const root = path.join(__dirname, '..'), stage = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-craft2046-'));
const executablePath = process.env.CHROMIUM || '/workspace/work/fixes-2046/browsers/chromium-1248/chrome-linux64/chrome';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(f) { const end = Date.now() + 15000; while (Date.now() < end) { if (await f()) return; await wait(30); } throw Error('fixture timeout'); }
let hero, posts, hang;
const fresh = () => { hero = { name: 'CraftHero', revision: 77, mp: 1000, inventory: { stacks: [{ itemId: 1880, qty: 0 }, { itemId: 1865, qty: 100 }] } }; posts = []; hang = true; };
const book = () => ({ canCraftProfession: true, createItemLevel: 4, currentMp: hero.mp, maxMp: 1000,
  recipes: [{ code: 'steel', output: { itemId: 1880, nameEn: 'Steel', quantity: 1 }, ingredients: [{ itemId: 1865, quantity: 1, have: 100 }], createItemLevel: 1, mpCost: 10, maxCraftable: 100 }] });
const server = http.createServer(async (req, res) => {
  const answer = j => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(j)); };
  if (req.url === '/character') return answer({ character: hero });
  if (req.url === '/book') return answer(book());
  if (req.url !== '/craft' || req.method !== 'POST') { res.statusCode = 404; return answer({ error: 'unexpected_local_path' }); }
  let raw = ''; for await (const part of req) raw += part;
  const b = JSON.parse(raw); posts.push(b);
  if (b.expectedRevision !== hero.revision) { res.statusCode = 409; return answer({ error: 'revision_conflict' }); }
  hero.revision++; hero.inventory.stacks[0].qty += b.craftCount; hero.inventory.stacks[1].qty -= b.craftCount; hero.mp -= b.craftCount * 10;
  if (!hang) return answer({ character: hero });  // иначе сервер применил POST, но оставил response открытым
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Craft reload local regression', version: '1.0',
    permissions: ['storage'], host_permissions: ['http://127.0.0.1/*'], background: { service_worker: 'background.js' } }));
  fs.copyFileSync(process.env.CRAFT_SOURCE || path.join(root, 'modules/craft.js'), path.join(stage, 'craft.js'));
  fs.writeFileSync(path.join(stage, 'background.js'), `chrome.runtime.onMessage.addListener((m,s,reply)=>{
    if(m.cmd!=='save')return; (async()=>{const {rt={},mode=''}=await chrome.storage.local.get(['rt','mode']);
      if(mode==='failedPrepare'&&m.patch.craftPending)return {ok:false};
      await chrome.storage.local.set({rt:{...rt,...m.patch}});return {ok:true};})().then(reply,e=>reply({ok:false}));return true;});`);
  fs.writeFileSync(path.join(stage, 'runner.html'), '<!doctype html><meta charset="utf-8"><title>Craft reload</title><script src="craft.js"></script><script src="runner.js"></script>');
  fs.writeFileSync(path.join(stage, 'runner.js'), `(async()=>{const s=await chrome.storage.local.get(['rt','mode','offset']);
    const realNow=Date.now.bind(Date);Date.now=()=>realNow()+(s.offset||0);
    const env={cfg:{craftAuto:true},rt:s.rt,on:true,tabOwner:true,leaseEpoch:'lease-1',actionGeneration:()=>1,
      role:()=> 'crafter',isBattle:()=>false,busy:()=>false,free:()=>true,canAct:()=>true,rec:()=>{},invRefresh:async()=>({}),
      setRt:async patch=>{Object.assign(env.rt,patch);const r=await chrome.runtime.sendMessage({cmd:'save',patch});
        if(s.mode==='stopPrepare'&&patch.craftPending)env.on=false;return r;},
      gameGet:p=>fetch(${JSON.stringify(endpoint)}+(p==='/character'?'/character':'/book')),
      gamePost:(p,b)=>fetch(${JSON.stringify(endpoint)}+'/craft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})};
    const C=L2V7Factories.craft(env);globalThis.fixture={env,step:()=>C.step(),loaded:true};})();`);
  const ctx = await chromium.launchPersistentContext(path.join(stage, 'profile'), { headless: true, executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--disable-extensions-except=${stage}`, `--load-extension=${stage}`] });
  const proof = [];
  try {
    // Никаких обращений к игре или Интернету: в fixture допустим только собственный loopback HTTP.
    await ctx.route('http://**/*', r => r.request().url().startsWith(endpoint + '/') ? r.continue() : r.abort());
    await ctx.route('https://**/*', r => r.abort());
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 }), id = new URL(sw.url()).host;
    const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)));
    const disk = () => sw.evaluate(async () => (await chrome.storage.local.get('rt')).rt);
    async function seed(mode = '') {
      fresh(); await sw.evaluate(async mode => chrome.storage.local.set({ mode, offset: 0, rt: { char: 'CraftHero', craftQueue: [{ id: 'a', code: 'steel', n: 5 }] } }), mode);
      await page.evaluate(() => sessionStorage.clear()).catch(() => {});
      await page.goto(`chrome-extension://${id}/runner.html`); await page.waitForFunction(() => globalThis.fixture?.loaded);
    }
    await seed();
    await page.evaluate(() => { void fixture.step(); }); await until(() => posts.length === 1);
    const before = await disk(); assert.equal(before.craftMade, undefined);
    hang = false;  // старый response остаётся открытым; ошибочный новый POST на базе получил бы обычный успешный ответ
    await sw.evaluate(() => chrome.storage.local.set({ offset: 20000 }));
    await page.reload(); await page.waitForFunction(() => globalThis.fixture?.loaded); await page.evaluate(() => fixture.step());
    const saved = await disk(); assert.equal(posts.length, 1, 'перезагрузка не создала второй заказ');
    assert.ok(before.craftPending, 'до завершения fetch уже есть durable-намерение');
    assert.equal(hero.inventory.stacks[0].qty, 5); assert.equal(saved.craftMade.a, 5); assert.equal(saved.craftPending, null);
    proof.push({ scenario: 'accepted POST, actual document reload before response', posts: posts.length, serverMade: hero.inventory.stacks[0].qty, savedMade: saved.craftMade.a });
    for (const mode of ['stopPrepare', 'failedPrepare']) {
      await seed(mode); await page.evaluate(() => fixture.step()); assert.equal(posts.length, 0);
      const r = await disk(); assert.equal(!!r.craftPending, mode === 'stopPrepare');
      proof.push({ scenario: mode, posts: posts.length, durablePending: !!r.craftPending });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ pass: true, browser: ctx.browser().version(), boundary: 'actual MV3/Chrome storage/reload; game responses from loopback model only', proof, errors }, null, 2));
  } finally { await ctx.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(stage, { recursive: true, force: true });
});

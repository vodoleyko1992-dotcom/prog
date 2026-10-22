'use strict';
// 22.10: настоящий Chromium/MV3/storage/reload; ответы игры только с loopback-модели.
// Дополнительно настоящее меню основного расширения: очередь, разрешение банок и быстрый запуск.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/workspace/.local/l2tools/node/node_modules/playwright');
const root = path.resolve(process.env.CRAFT_SOURCE_DIR || path.join(__dirname, '..'));
const runtimeRoot = path.resolve(process.env.CRAFT_RUNTIME_SOURCE_DIR || root);
const executablePath = process.env.CHROMIUM || '/usr/bin/chromium';
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-craft-mode-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await delay(30); } throw Error('craft browser timeout'); }
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const proof = [], errors = [], external = [];
let stagedHashes;
let hero, posts, hangUse, useApplied, ctx, server;
function fresh({ mp = 0, pots = 2, raw = 100, hang = false } = {}) {
  hero = { name: 'CraftHero', revision: 77, mp, maxMp: 1000, inventory: { stacks: [{ itemId: 1880, qty: 0 }, { itemId: 1865, qty: raw }, { itemId: 728, qty: pots }] } };
  posts = []; hangUse = hang; useApplied = false;
}
const qty = id => hero.inventory.stacks.find(x => x.itemId === id).qty;
const book = () => ({ canCraftProfession: true, createItemLevel: 4, currentMp: hero.mp, maxMp: hero.maxMp,
  recipes: [{ code: 'steel', output: { itemId: 1880, nameEn: 'Steel', quantity: 1 }, ingredients: [{ itemId: 1865, nameEn: 'Coal', quantity: 1, have: qty(1865) }],
    createItemLevel: 1, mpCost: 10, maxCraftable: Math.min(qty(1865), Math.floor(hero.mp / 10)), lockedReason: null }] });
async function runtime() {
  server = http.createServer(async (req, res) => {
    const answer = (data, status = 200) => { res.statusCode = status; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    if (req.url === '/character' && req.method === 'GET') return answer({ character: hero });
    if (req.url === '/game/craft/materials' && req.method === 'GET') return answer(book());
    if (req.method !== 'POST' || !['/game/craft/materials', '/character/consumable/use'].includes(req.url)) return answer({ error: 'unexpected_local_path' }, 404);
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); posts.push({ path: req.url, body });
    if (body.expectedRevision !== hero.revision) return answer({ error: 'revision_conflict' }, 409);
    if (req.url === '/character/consumable/use') {
      assert.deepEqual(body, { itemId: 728, quantity: 1, expectedRevision: hero.revision });
      if (qty(728) < 1) return answer({ error: 'not_enough_items' }, 400);
      hero.revision++; hero.inventory.stacks.find(x => x.itemId === 728).qty--; hero.mp = Math.min(hero.maxMp, hero.mp + 500); useApplied = true;
      if (!hangUse) answer({ character: hero });
      return; // неизвестный ответ остаётся открытым до настоящего reload
    }
    assert.equal(body.recipeCode, 'steel'); assert.ok(body.craftCount > 0 && body.craftCount <= Math.min(qty(1865), Math.floor(hero.mp / 10)));
    hero.revision++; hero.inventory.stacks[0].qty += body.craftCount; hero.inventory.stacks[1].qty -= body.craftCount; hero.mp -= body.craftCount * 10;
    return answer({ character: hero });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Craft mode browser fixture', version: '1.0',
    permissions: ['storage'], host_permissions: ['http://127.0.0.1/*'], background: { service_worker: 'background.js' } }));
  for (const [source, target] of [['modules/craft.js', 'craft.js'], ['engine-core.js', 'engine-core.js'], ['defaults.js', 'defaults.js']]) fs.copyFileSync(path.join(source === 'modules/craft.js' ? runtimeRoot : root, source), path.join(stage, target));
  stagedHashes = Object.fromEntries([['modules/craft.js', 'craft.js'], ['engine-core.js', 'engine-core.js'], ['defaults.js', 'defaults.js']].map(([source, target]) => [source, hash(path.join(stage, target))]));
  fs.writeFileSync(path.join(stage, 'background.js'), `chrome.runtime.onMessage.addListener((m,s,reply)=>{
    if(m.cmd!=='save')return; (async()=>{const {rt={},scenario=''}=await chrome.storage.local.get(['rt','scenario']);
      if(scenario==='failed-prepare'&&m.patch.craftMpPending)return {ok:false};
      await chrome.storage.local.set({rt:{...rt,...m.patch}});return {ok:true};})().then(reply,()=>reply({ok:false}));return true;});`);
  fs.writeFileSync(path.join(stage, 'runner.html'), '<!doctype html><meta charset="utf-8"><title>Craft mode fixture</title><script src="defaults.js"></script><script src="engine-core.js"></script><script src="craft.js"></script><script src="runner.js"></script>');
  fs.writeFileSync(path.join(stage, 'runner.js'), `(async()=>{const s=await chrome.storage.local.get(['rt','scenario','offset','cfg']);
    const originalNow=Date.now.bind(Date);let offset=s.offset||0;Date.now=()=>originalNow()+offset;
    const config={...L2Defaults.CFG,...s.cfg};let selected='craft';
    const env={cfg:L2EngineCore.taskConfig(config,()=>env.rt),rt:s.rt,on:true,tabOwner:true,leaseEpoch:'fixture-owner',actionGeneration:()=>1,
      mode:()=>selected,role:()=> 'crafter',isBattle:()=>false,busy:()=>false,free:()=>true,canAct:()=>true,rec:()=>{},invRefresh:async()=>({}),
      setRt:async patch=>{Object.assign(env.rt,patch);const r=await chrome.runtime.sendMessage({cmd:'save',patch});
        if(patch.craftMpPending&&s.scenario==='stop-prepare')env.on=false;
        if(patch.craftMpPending&&s.scenario==='mode-prepare'){selected='farm';config.autoTasks=['farm'];config.craftMode=false;}return r;},
      gameGet:p=>fetch(${JSON.stringify(endpoint)}+p),gamePost:(p,b)=>fetch(${JSON.stringify(endpoint)}+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})};
    const C=L2V7Factories.craft(env);globalThis.fixture={env,step:()=>C.step(),text:()=>C.text(),
      advance:async ms=>{offset+=ms;await chrome.storage.local.set({offset});},loaded:true};})();`);
  ctx = await chromium.launchPersistentContext(path.join(stage, 'profile'), { headless: true, executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--disable-extensions-except=${stage}`, `--load-extension=${stage}`] });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(endpoint + '/') || u.startsWith('chrome-extension://')) return route.continue();
    external.push(u); return route.abort();
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 }), id = new URL(sw.url()).host;
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  const disk = () => sw.evaluate(async () => (await chrome.storage.local.get('rt')).rt);
  const reset = async (scenario = '', initial = {}) => {
    fresh(initial); await sw.evaluate(async ({ scenario }) => chrome.storage.local.set({ scenario, offset: 0,
      cfg: { autoTasks: ['craft'], craftAuto: false, craftMode: true, craftMammon: false, craftMpPots: true },
      rt: { char: 'CraftHero', classCur: { prof: 'dwarf_warsmith', slot: 2 }, craftQueue: [{ id: 'a', code: 'steel', nm: 'Steel', n: 5 }] } }), { scenario });
    await page.evaluate(() => sessionStorage.clear()).catch(() => {});
    await page.goto(`chrome-extension://${id}/runner.html`); await page.waitForFunction(() => globalThis.fixture?.loaded);
  };
  const step = () => page.evaluate(() => fixture.step());
  const advance = ms => page.evaluate(ms => fixture.advance(ms), ms);
  await reset(); await step(); assert.equal(posts.length, 1); assert.equal(posts[0].path, '/character/consumable/use'); assert.equal(qty(728), 1);
  await advance(2000); await step(); assert.equal(qty(1880), 5); assert.equal((await disk()).craftMade.a, 5);
  await advance(2000); await step(); assert.equal(posts.length, 2, 'готовая очередь не продолжает тратить MP/сырьё');
  proof.push({ scenario: 'MP0 → one normal potion → exact queue', potionPosts: 1, craftPosts: 1, made: qty(1880), remainingPots: qty(728), text: await page.evaluate(() => fixture.text()) });
  for (const [name, state] of [['no-potions', { pots: 0 }], ['no-ingredients', { raw: 0 }]]) {
    await reset(name, state); await step(); await advance(65000); await step(); assert.equal(posts.length, 0);
    proof.push({ scenario: name, posts: posts.length, text: await page.evaluate(() => fixture.text()) });
  }
  await reset('lost-response', { hang: true });
  await page.evaluate(() => { void fixture.step(); }); await until(() => useApplied && posts.length === 1);
  assert.ok((await disk()).craftMpPending, 'до fetch сохранено durable намерение банки');
  await advance(20000); hangUse = false; await page.reload(); await page.waitForFunction(() => globalThis.fixture?.loaded); await step();
  assert.equal((await disk()).craftMpPending, null); assert.equal(posts.length, 1); assert.equal(qty(728), 1);
  await advance(2000); await step(); assert.equal(qty(1880), 5); assert.equal(posts.filter(x => x.path === '/character/consumable/use').length, 1);
  proof.push({ scenario: 'actual reload after accepted potion before response', potionPosts: 1, made: qty(1880), durableUsed: (await disk()).craftMpUsed });
  for (const scenario of ['stop-prepare', 'mode-prepare', 'failed-prepare']) {
    await reset(scenario); await step(); assert.equal(posts.length, 0); assert.equal(qty(728), 2);
    proof.push({ scenario, posts: posts.length, durablePending: !!(await disk()).craftMpPending });
  }
  const browser = ctx.browser().version(); await ctx.close(); ctx = null;
  return browser;
}
async function popup() {
  if (process.env.CRAFT_SKIP_POPUP === '1') return { skipped: true, reason: 'runtime-only development pass' };
  process.env.CHROMIUM = executablePath;
  process.env.PLAYWRIGHT_NODE ||= '/workspace/.local/l2tools/node/node_modules/playwright';
  const { harness, until: waitFor } = require(path.join(root, 'tests/v1014-core-lifecycle-browser.cjs'));
  const h = await harness();
  try {
    await h.sw.evaluate(async () => { const { cfg, rt } = await chrome.storage.local.get(['cfg', 'rt']);
      await chrome.storage.local.set({ on: false, cfg: { ...cfg, autoTasks: [], craftAuto: false, craftMode: false, craftMpPots: true },
        rt: { ...rt, classCur: { prof: 'dwarf_warsmith', slot: 2 }, prof: 'dwarf_warsmith', craftQueue: [], craftMade: {},
          craftBook: { t: Date.now(), lvl: 4, mp: 500, maxMp: 1000, can: true, list: [['steel', 'Steel', 1880, 1, 1, 10]] } } }); });
    await h.popup.reload(); await waitFor(() => h.popup.evaluate(() => !!document.querySelector('#start')?.onclick));
    await h.reveal('#craftMpPots'); assert.equal(await h.popup.locator('#craftMpPots').isChecked(), true);
    await h.popup.locator('#craftMpPots').uncheck(); await waitFor(async () => (await h.get(['cfg'])).cfg.craftMpPots === false);
    await h.popup.locator('#craftMpPots').check(); await waitFor(async () => (await h.get(['cfg'])).cfg.craftMpPots === true);
    await h.popup.locator('#craftPick').selectOption('steel'); await h.popup.locator('#craftN').fill('7'); await h.popup.locator('#craftAdd').click();
    await waitFor(async () => (await h.get(['rt'])).rt.craftQueue?.length === 1);
    await waitFor(async () => /Steel.*0\/7/.test(await h.popup.locator('#craftList').textContent()));
    await h.popup.locator('#craftStart').click();
    await waitFor(async () => (await h.get(['cfg', 'on'])).on && (await h.get(['cfg'])).cfg.autoTasks?.includes('craft'));
    await waitFor(() => h.g.core('autonomyMode()==="craft"'));
    const config = (await h.get(['cfg'])).cfg; assert.equal(config.craftAuto, false, 'явный режим не требует фонового разрешения');
    await h.popup.locator('#stop').click(); await waitFor(async () => (await h.get(['on'])).on === false);
    assert.deepEqual(h.errors, []); assert.equal(h.requests.filter(x => x.method === 'POST').length, 0, 'меню не делает игровые POST');
    proof.push({ scenario: 'actual full extension popup queue/potions/start/stop', queue: 7, mode: 'craft', backgroundCraftAuto: config.craftAuto, gamePosts: 0 });
    // Полный content dispatcher и его env-геттеры, а не только отдельная фабрика.
    const fullPosts = [], actor = { name: 'AuditHero', id: 'local-craft-browser', revision: 300, level: 75, l2Profession: 'dwarf_warsmith',
      classSlots: { activeSlot: 2 }, hp: 5000, maxHp: 5000, mp: 0, maxMp: 1000, inBattle: false,
      activeSummon: null, activeBuffs: [], inventory: { eq: {}, stacks: [{ itemId: 1880, qty: 0 }, { itemId: 1865, qty: 100 }, { itemId: 728, qty: 2 }] } };
    const actorQty = id => actor.inventory.stacks.find(x => x.itemId === id).qty;
    const craftPage = `<!doctype html><meta charset="utf-8"><title>Local craft</title><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-nav-bottom"></div>
      <div id="character-profession">Warsmith</div><span id="l2-hud-legacy-lvl">75</span><span id="l2-hud-hp-cur">5000</span><span id="l2-hud-hp-max">5000</span>
      <span id="l2-hud-mp-cur">0</span><span id="l2-hud-mp-max">1000</span><script>fetch('/character')</script>`;
    await h.ctx.route('https://l2wap.com/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      const answer = (json, status = 200) => route.fulfill({ json, status });
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); fullPosts.push({ path: pathname, body });
        if (!['/character/consumable/use', '/game/craft/materials'].includes(pathname)) return answer({ error: 'unexpected_local_post' }, 400);
        if (body.expectedRevision !== actor.revision) return answer({ error: 'revision_conflict' }, 409);
        if (pathname === '/character/consumable/use') {
          assert.deepEqual(body, { itemId: 728, quantity: 1, expectedRevision: actor.revision });
          actor.inventory.stacks[2].qty--; actor.mp = Math.min(actor.maxMp, actor.mp + 500); actor.revision++;
        } else {
          assert.equal(body.recipeCode, 'steel'); assert.ok(body.craftCount > 0 && body.craftCount <= 5);
          actor.inventory.stacks[0].qty += body.craftCount; actor.inventory.stacks[1].qty -= body.craftCount; actor.mp -= body.craftCount * 10; actor.revision++;
        }
        return answer({ character: actor });
      }
      if (pathname === '/character') return answer({ character: actor });
      if (pathname === '/game/craft/materials') return answer({ canCraftProfession: true, createItemLevel: 4, currentMp: actor.mp, maxMp: actor.maxMp,
        recipes: [{ code: 'steel', output: { itemId: 1880, nameEn: 'Steel', quantity: 1 }, ingredients: [{ itemId: 1865, nameEn: 'Coal', quantity: 1, have: actorQty(1865) }],
          createItemLevel: 1, mpCost: 10, maxCraftable: Math.min(actorQty(1865), Math.floor(actor.mp / 10)), lockedReason: null }] });
      if (/\.html$/.test(pathname)) return route.fulfill({ contentType: 'text/html', body: craftPage });
      return route.fallback();
    });
    await h.sw.evaluate(async () => { const { cfg, rt } = await chrome.storage.local.get(['cfg', 'rt']);
      await chrome.storage.local.set({ on: false, cfg: { ...cfg, autoTasks: ['craft'], craftAuto: false, craftMpPots: true, craftMammon: false, tvtOn: false, rec: false, autoSnap: false },
        rt: { ...rt, char: 'AuditHero', classCur: { prof: 'dwarf_warsmith', slot: 2 }, prof: 'dwarf_warsmith', craftPending: null, craftMpPending: null,
          craftQueue: [{ id: 'full', code: 'steel', nm: 'Steel', n: 5 }], craftMade: {}, craftBook: null, craftSay: null, craftMpUsed: 0,
          shop: null, tbuff: null, storyJob: null, rbGo: null, rbHunt: null, zoneGo: null, invScan: null, magister: null, fishSvc: null, petBufferTrip: null,
          actionOwner: null, subGo: null, subTrip: null, revive: null, travelCheck: null, petPrep: null, petRaidPrep: null } }); });
    await h.g.p.goto('https://l2wap.com/craft.html'); await waitFor(() => h.g.core('typeof on !== "undefined" && !running'));
    await h.popup.locator('#start').click();
    await waitFor(async () => (await h.get(['rt'])).rt.craftMade?.full === 5, 20000);
    await h.popup.locator('#stop').click(); await waitFor(async () => (await h.get(['on'])).on === false);
    assert.deepEqual(fullPosts.map(x => x.path), ['/character/consumable/use', '/game/craft/materials']);
    assert.equal(actorQty(1880), 5); assert.equal(actorQty(728), 1); assert.equal((await h.get(['rt'])).rt.craftMpUsed, 1);
    assert.deepEqual(h.errors, []);
    proof.push({ scenario: 'actual full MV3 content dispatcher MP0 → potion → craft', posts: fullPosts, made: actorQty(1880), remainingPots: actorQty(728), savedMade: (await h.get(['rt'])).rt.craftMade.full });
    const runtimeHashes = await h.sw.evaluate(async () => Object.fromEntries(await Promise.all(['content.js', 'modules/craft.js', 'defaults.js', 'engine-core.js'].map(async p => {
      const r = await fetch(chrome.runtime.getURL(p)), digest = await crypto.subtle.digest('SHA-256', await r.arrayBuffer());
      return [p, [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('')];
    }))));
    for (const [p, digest] of Object.entries(runtimeHashes)) assert.equal(digest, hash(path.join(root, p)), 'actual full extension source matches checkout: ' + p);
    return { extensionVersion: await h.sw.evaluate(() => chrome.runtime.getManifest().version), runtimeHashes, errors: h.errors };
  } finally { await h.ctx.close(); }
}
(async () => {
  const browser = await runtime(), menu = await popup();
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const currentHashes = Object.fromEntries(['modules/craft.js', 'engine-core.js', 'defaults.js'].map(p => [p, hash(path.join(p === 'modules/craft.js' ? runtimeRoot : root, p))]));
  assert.deepEqual(stagedHashes, currentHashes, 'исходники изменились во время проверки — нужен повтор по финальным байтам');
  const result = { pass: true, browser, boundary: 'actual Chromium/MV3/storage/reload; popup reported separately; game is local model, no live game',
    sources: stagedHashes, menu, proof, errors, externalRequests: external.length };
  console.log(JSON.stringify(result, null, 2));
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; }).finally(async () => {
  if (ctx) await ctx.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(stage, { recursive: true, force: true });
});

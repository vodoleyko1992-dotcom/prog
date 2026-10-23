'use strict';
// 22.10: Chrome/MV3 и реальные storage/reload; все ответы игры — локальные fixtures.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/workspace/.local/l2tools/node/node_modules/playwright');
const root = path.resolve(process.env.CRAFT_SOURCE_DIR || path.join(__dirname, '..'));
const runtimeRoot = path.resolve(process.env.CRAFT_RUNTIME_SOURCE_DIR || root), planRoot = path.resolve(process.env.CRAFT_PLAN_SOURCE_DIR || root);
const executablePath = process.env.CHROMIUM || '/usr/bin/chromium';
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'l2-craft-goals-')), errors = [], external = [], proof = [];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, ms = 20000) { const end = Date.now() + ms; let last; while (Date.now() < end) { try { if (await fn()) return; } catch (e) { last = e; } await delay(50); } throw last || Error('craft goals browser timeout'); }
const IDS = { charcoal: 1871, coal: 1870, ore: 1875, silver: 1873, cokes: 1879, synthetic: 1888, oriharukon: 1893, pot: 728 };
const definitions = [
  { code: 'cokes', output: { itemId: IDS.cokes, nameEn: 'Cokes', nameRu: 'Кокс', nameUk: 'Кокс', quantity: 1 }, ingredients: [[IDS.charcoal, 'Charcoal', 2], [IDS.coal, 'Coal', 2]], createItemLevel: 1, mpCost: 10 },
  { code: 'synthetic_cokes', output: { itemId: IDS.synthetic, nameEn: 'Synthetic Cokes', nameRu: 'Синтетический кокс', nameUk: 'Синтетичний кокс', quantity: 1 }, ingredients: [[IDS.cokes, 'Cokes', 2], [IDS.ore, 'Oriharukon Ore', 1]], createItemLevel: 2, mpCost: 20 },
  { code: 'oriharukon', output: { itemId: IDS.oriharukon, nameEn: 'Oriharukon', nameRu: 'Орихалкон', nameUk: 'Оріхалкон', quantity: 1 }, ingredients: [[IDS.synthetic, 'Synthetic Cokes', 1], [IDS.ore, 'Oriharukon Ore', 4], [IDS.silver, 'Silver Nugget', 12]], createItemLevel: 4, mpCost: 40 },
];
let actor, posts, policy, ctx, server, sourceHashes;
function fresh(options = {}) {
  const stock = { [IDS.charcoal]: 100, [IDS.coal]: 100, [IDS.ore]: 100, [IDS.silver]: 100, [IDS.cokes]: 0, [IDS.synthetic]: 0, [IDS.oriharukon]: 0, [IDS.pot]: 2, ...options.stock };
  actor = { name: 'CraftHero', revision: 77, mp: options.mp ?? 0, maxMp: 1000, inventory: { stacks: Object.entries(stock).map(([itemId, qty]) => ({ itemId: +itemId, qty })) } };
  posts = []; policy = options.policy || {};
}
const qty = id => actor.inventory.stacks.find(x => x.itemId === id)?.qty || 0;
const changeQty = (id, n) => { const row = actor.inventory.stacks.find(x => x.itemId === id); if (row) row.qty += n; else actor.inventory.stacks.push({ itemId: id, qty: n }); };
const book = () => ({ canCraftProfession: true, createItemLevel: 4, currentMp: actor.mp, maxMp: actor.maxMp,
  recipes: definitions.map(r => ({ ...r, successChance: 100, lockedReason: null,
    ingredients: r.ingredients.map(([itemId, nameEn, quantity]) => ({ itemId, nameEn, quantity, have: qty(itemId) })),
    maxCraftable: Math.min(Math.floor(actor.mp / r.mpCost), ...r.ingredients.map(([id, , q]) => Math.floor(qty(id) / q))) })) });
function apply(body, url) {
  if (body.expectedRevision !== actor.revision) return { status: 409, data: { error: 'revision_conflict' } };
  if (url === '/character/consumable/use') {
    assert.deepEqual(body, { itemId: IDS.pot, quantity: 1, expectedRevision: actor.revision });
    assert.ok(qty(IDS.pot) >= 1); changeQty(IDS.pot, -1); actor.mp = Math.min(actor.maxMp, actor.mp + 500);
  } else {
    const r = definitions.find(x => x.code === body.recipeCode); assert.ok(r); assert.ok(Number.isSafeInteger(body.craftCount) && body.craftCount > 0);
    assert.ok(actor.mp >= body.craftCount * r.mpCost);
    for (const [id, , n] of r.ingredients) { assert.ok(qty(id) >= n * body.craftCount); changeQty(id, -n * body.craftCount); }
    changeQty(r.output.itemId, body.craftCount * r.output.quantity); actor.mp -= body.craftCount * r.mpCost;
  }
  actor.revision++; return { status: 200, data: { character: actor } };
}
async function runtime() {
  server = http.createServer(async (req, res) => {
    const answer = (data, status = 200) => { res.statusCode = status; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    if (req.url === '/character' && req.method === 'GET') return answer({ character: actor });
    if (req.url === '/game/craft/materials' && req.method === 'GET') return answer(book());
    if (req.method !== 'POST' || !['/game/craft/materials', '/character/consumable/use'].includes(req.url)) return answer({ error: 'unexpected_fixture_path' }, 404);
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); posts.push({ path: req.url, body });
    const matching = policy.code ? body.recipeCode === policy.code : req.url === '/character/consumable/use';
    if (matching && policy.failOnce && !policy.failed) { policy.failed = true; return answer({ error: 'transient_fixture_error' }, 500); }
    const result = apply(body, req.url);
    if (matching && policy.hang && result.status === 200 && !policy.hung) { policy.hung = true; return; }
    return answer(result.data, result.status);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + server.address().port;
  fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Craft goals fixture', version: '1.0', permissions: ['storage'], host_permissions: ['http://127.0.0.1/*'], background: { service_worker: 'background.js' } }));
  const files = { 'modules/craft.js': path.join(runtimeRoot, 'modules/craft.js'), 'craft-plan.js': path.join(planRoot, 'craft-plan.js'), 'engine-core.js': path.join(root, 'engine-core.js'), 'defaults.js': path.join(root, 'defaults.js') };
  for (const [name, src] of Object.entries(files)) fs.copyFileSync(src, path.join(stage, path.basename(name)));
  sourceHashes = Object.fromEntries(Object.entries(files).map(([p, file]) => [p, hash(file)]));
  fs.writeFileSync(path.join(stage, 'background.js'), `chrome.runtime.onMessage.addListener((m,s,reply)=>{
    (async()=>{const data=await chrome.storage.local.get(['rt','events','scenario']);
      if(m.cmd==='save'){if(data.scenario==='failed-prepare'&&(m.patch.craftPending||m.patch.craftMpPending))return {ok:false};await chrome.storage.local.set({rt:{...(data.rt||{}),...m.patch}});return {ok:true};}
      if(m.cmd==='notice'){await chrome.storage.local.set({events:[...(data.events||[]),m.event]});return {ok:true};}return {ok:false};})().then(reply,()=>reply({ok:false}));return true;});`);
  fs.writeFileSync(path.join(stage, 'runner.html'), '<!doctype html><meta charset="utf-8"><script src="defaults.js"></script><script src="engine-core.js"></script><script src="craft-plan.js"></script><script src="craft.js"></script><script src="runner.js"></script>');
  fs.writeFileSync(path.join(stage, 'runner.js'), `(async()=>{const s=await chrome.storage.local.get(['rt','cfg','offset','scenario']);let offset=s.offset||0;const realNow=Date.now.bind(Date);Date.now=()=>realNow()+offset;
    const raw={...L2Defaults.CFG,...s.cfg};let selected='craft';
    const env={cfg:L2EngineCore.taskConfig(raw,()=>env.rt),rt:s.rt,on:true,tabOwner:true,leaseEpoch:'fixture-owner',actionGeneration:()=>1,
      mode:()=>selected,role:()=> 'crafter',isBattle:()=>false,busy:()=>false,free:()=>true,canAct:()=>true,rec:()=>{},invRefresh:async()=>({}),plan:L2CraftPlan.plan,
      notify:(id,title,text,sticky)=>chrome.runtime.sendMessage({cmd:'notice',event:{action:'create',id,title,text,sticky}}),
      clearAlert:id=>chrome.runtime.sendMessage({cmd:'notice',event:{action:'clear',id}}),
      setRt:async patch=>{Object.assign(env.rt,patch);const r=await chrome.runtime.sendMessage({cmd:'save',patch});
        if((patch.craftPending||patch.craftMpPending)&&s.scenario==='stop-prepare')env.on=false;
        if((patch.craftPending||patch.craftMpPending)&&s.scenario==='mode-prepare'){selected='farm';raw.autoTasks=['farm'];}return r;},
      gameGet:p=>fetch(${JSON.stringify(endpoint)}+p),gamePost:(p,b)=>fetch(${JSON.stringify(endpoint)}+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})};
    const C=L2V7Factories.craft(env);globalThis.fixture={env,step:()=>C.step(),text:()=>C.text(),advance:async ms=>{offset+=ms;await chrome.storage.local.set({offset});},loaded:true};})();`);
  ctx = await chromium.launchPersistentContext(path.join(stage, 'profile'), { headless: true, executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--disable-extensions-except=${stage}`, `--load-extension=${stage}`] });
  await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(endpoint + '/') || u.startsWith('chrome-extension://')) return r.continue(); external.push(u); return r.abort(); });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 15000 }), id = new URL(sw.url()).host;
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
  const state = () => sw.evaluate(() => chrome.storage.local.get(['rt','events']));
  async function reset(scenario = '', options = {}) {
    fresh(options); await sw.evaluate(async ({ scenario, options }) => chrome.storage.local.set({ scenario, offset: 0, events: [], cfg: { autoTasks: ['craft'], craftMode: true, craftAuto: false, craftChain: true, craftNotify: true, craftMpPots: true, ...options.cfg },
      rt: { char: 'CraftHero', classCur: { prof: 'dwarf_maestro', slot: 2 }, craftQueue: [{ id: 'goal', code: 'oriharukon', nm: 'Oriharukon', item: 1893, n: options.n || 2 }], craftMade: {} } }), { scenario, options });
    await page.evaluate(() => sessionStorage.clear()).catch(() => {}); await page.goto(`chrome-extension://${id}/runner.html`); await page.waitForFunction(() => globalThis.fixture?.loaded);
  }
  const step = async (ms = 2000) => { await page.evaluate(ms => fixture.advance(ms), ms); return page.evaluate(() => fixture.step()); };
  await reset();
  await step(); assert.equal(posts[0]?.path, '/character/consumable/use');
  await step(); assert.equal(posts[1]?.body.recipeCode, 'cokes'); assert.equal((await state()).rt.craftMade.goal || 0, 0, 'полуфабрикаты не засчитываются как финальная цель');
  for (let i = 0; i < 6; i++) await step();
  assert.equal(qty(IDS.oriharukon), 2); assert.equal((await state()).rt.craftMade.goal, 2); assert.equal(qty(IDS.pot), 1);
  assert.deepEqual(posts.filter(x => x.path === '/game/craft/materials').map(x => [x.body.recipeCode,x.body.craftCount]), [['cokes',4],['synthetic_cokes',2],['oriharukon',2]]);
  proof.push({ scenario: 'MP0 → одна банка → Cokes4 → Synthetic2 → Oriharukon2', posts: structuredClone(posts), savedGoal: 2 });
  await reset('shortage', { stock: { [IDS.ore]: 7 } }); await step();
  const first = await state(); assert.equal(posts.length, 0); assert.equal(first.events.filter(x => x.action === 'create').length, 1);
  assert.match(first.events.find(x => x.action === 'create').text, /Oriharukon Ore|Орих|Оріх/i);
  await step(6 * 60000); await page.reload(); await page.waitForFunction(() => globalThis.fixture?.loaded); await step(6 * 60000);
  assert.equal((await state()).events.filter(x => x.action === 'create').length, 1, 'неизменная нехватка не спамит после времени и reload'); assert.equal(posts.length, 0);
  changeQty(IDS.ore, 3); actor.revision++; for (let i = 0; i < 8; i++) await step(i ? 2000 : 6 * 60000);
  assert.equal(qty(IDS.oriharukon), 2); assert.ok((await state()).events.some(x => x.action === 'clear'));
  proof.push({ scenario: 'точная нехватка сырья → уведомление один раз через reload → пополнение → цель и снятие уведомления', missing: 3, made: 2, events: (await state()).events });
  await reset('existing-intermediates', { mp: 500, stock: { [IDS.cokes]: 2, [IDS.synthetic]: 1 } }); for (let i = 0; i < 7; i++) await step();
  assert.deepEqual(posts.map(x => [x.body.recipeCode,x.body.craftCount]), [['synthetic_cokes',1],['oriharukon',2]]); assert.equal((await state()).rt.craftMade.goal, 2);
  proof.push({ scenario: 'имеющиеся полуфабрикаты уменьшают цепочку', posts: structuredClone(posts) });
  await reset('unknown-intermediate', { mp: 500, n: 1, policy: { code: 'cokes', hang: true } });
  await page.evaluate(() => { void fixture.step(); }); await until(() => policy.hung && posts.length === 1); assert.ok((await state()).rt.craftPending);
  await page.evaluate(() => fixture.advance(20000)); await page.reload(); await page.waitForFunction(() => globalThis.fixture?.loaded); await step();
  assert.equal((await state()).rt.craftMade.goal || 0, 0); assert.equal(posts.length, 1);
  // 20.54 (прогон смоуков 23.10, Chromium 141): reload обрывает висящий fetch, и уходящая страница успевает записать
  // «результат неизвестен» (craft.js unknown: err 2, свежий t «от момента обрыва») — сверка законно ждёт PEND_WAIT 15 с.
  // В Chrome 156 (доказательство 20.51) запись не успевала и сверка шла сразу. Повтора партии нет в обоих случаях.
  const aborted = (await state()).rt.craftPending;
  if (aborted) {
    assert.equal(aborted.code, 'cokes'); assert.equal(aborted.err, 2); assert.equal(aborted.tries, 0);
    assert.match((await state()).rt.craftSay?.why || '', /обрыв|ответ не пришёл/); assert.equal(posts.length, 1);
    await step(16000); assert.equal(posts.length, 1); assert.equal((await state()).rt.craftPending, null);
  }
  for (let i = 0; i < 6; i++) await step();
  assert.equal(qty(IDS.oriharukon), 1); assert.equal((await state()).rt.craftMade.goal, 1); assert.equal(posts.filter(x => x.body.recipeCode === 'cokes').length, 1);
  proof.push({ scenario: 'настоящий reload после принятого полуфабриката без ответа: одна партия, финальная цель засчитана один раз', posts: structuredClone(posts) });
  await reset('retry-500', { mp: 500, n: 1, policy: { code: 'cokes', failOnce: true } }); await step(); await step(20000);
  assert.equal(posts.length, 2); assert.deepEqual(posts[0],posts[1], 'повторяет только прежнюю revision и исходную партию');
  for (let i = 0; i < 6; i++) await step(); assert.equal((await state()).rt.craftMade.goal, 1);
  proof.push({ scenario: '500 без применения → повтор прежнего запроса → цепочка без дубля', retries: 1, made: 1 });
  for (const scenario of ['stop-prepare','mode-prepare','failed-prepare']) { await reset(scenario, { mp: 500, n: 1 }); await step(); assert.equal(posts.length, 0); proof.push({ scenario, posts: 0 }); }
  await reset('notifications-off', { cfg: { craftNotify: false }, stock: { [IDS.ore]: 0 } }); await step(); await step(6 * 60000); assert.equal(posts.length, 0); assert.equal((await state()).events.filter(x => x.action === 'create').length, 0);
  proof.push({ scenario: 'оповещения отключены: ожидание без расхода и без уведомлений', posts: 0 });
  await reset('disable-active-notice', { stock: { [IDS.ore]: 0 } }); await step(); assert.ok((await state()).rt.craftShortageNote);
  await page.evaluate(() => { fixture.env.cfg.craftNotify = false; }); await step();
  assert.equal((await state()).rt.craftShortageNote,null); assert.ok((await state()).events.some(x=>x.action==='clear')); assert.equal(posts.length,0);
  proof.push({ scenario: 'выключение оповещений снимает уже активное уведомление', posts: 0, events: (await state()).events });
  const version = ctx.browser().version(); await ctx.close(); ctx = null; return version;
}

async function fullExtension() {
  if (process.env.CRAFT_SKIP_POPUP === '1') return { skipped: true, reason: 'isolated runtime development pass' };
  process.env.CHROMIUM = executablePath; process.env.PLAYWRIGHT_NODE ||= '/workspace/.local/l2tools/node/node_modules/playwright';
  const { harness, until: waitFor } = require(path.join(root, 'tests/v1014-core-lifecycle-browser.cjs'));
  const h = await harness();
  try {
    let holdBook = false, heldBookRoute = null;
    fresh({ mp: 0, stock: { [IDS.ore]: 7 } }); actor.name = 'AuditHero'; Object.assign(actor, { id: 'local-goal-actor', level: 75, l2Profession: 'dwarf_maestro', classSlots: { activeSlot: 2 }, hp: 5000, maxHp: 5000, inBattle: false, activeBuffs: [], activeSummon: null }); actor.inventory.eq = {};
    const html = '<!doctype html><meta charset="utf-8"><title>Local craft goals</title><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-nav-bottom"></div><div id="character-profession">Maestro</div><span id="l2-hud-legacy-lvl">75</span><span id="l2-hud-hp-cur">5000</span><span id="l2-hud-hp-max">5000</span><span id="l2-hud-mp-cur">0</span><span id="l2-hud-mp-max">1000</span><script>fetch("/character")</script>';
    await h.ctx.route('https://l2wap.com/**', async r => {
      const request = r.request(), p = new URL(request.url()).pathname;
      if (request.method() === 'POST') { const body = request.postDataJSON(); posts.push({ path: p, body }); assert.ok(['/game/craft/materials','/character/consumable/use'].includes(p), 'неожиданный игровой POST'); const result = apply(body,p); return r.fulfill({ status: result.status, json: result.data }); }
      if (p === '/character') return r.fulfill({ json: { character: actor } });
      if (p === '/game/craft/materials') { if (holdBook) { holdBook=false;heldBookRoute=r;return; } return r.fulfill({ json: book() }); }
      if (/\.html$/.test(p)) return r.fulfill({ contentType: 'text/html', body: html });
      return r.fallback();
    });
    await h.sw.evaluate(async () => { const { cfg, rt } = await chrome.storage.local.get(['cfg','rt']); await chrome.storage.local.set({ on: false,
      cfg: { ...cfg, autoTasks: ['craft'], craftAuto: false, craftMode: true, craftChain: true, craftNotify: true, craftMpPots: true, craftMammon: false, rec: false, autoSnap: false },
      rt: { ...rt, char: 'AuditHero', prof: 'dwarf_maestro', classCur: { prof: 'dwarf_maestro', slot: 2 }, craftBook: null, craftBag: null, craftPlan: null,
        craftQueue: [], craftMade: {}, craftPending: null, craftMpPending: null, craftSay: null, craftShortageNote: null, craftMpUsed: 0,
        actionOwner: null, shop: null, tbuff: null, invScan: null, magister: null, mmJob: null, storyJob: null, rbGo: null, rbHunt: null, zoneGo: null, fishSvc: null, petBufferTrip: null, subGo: null, subTrip: null, revive: null, travelCheck: null, petPrep: null, petRaidPrep: null } }); });
    await h.sw.evaluate(() => { globalThis.__craftAlertMessages=[];chrome.runtime.onMessage.addListener(m=>{if((m?.cmd==='alert'||m?.cmd==='alertClear')&&m.id==='craft-missing')globalThis.__craftAlertMessages.push({cmd:m.cmd,id:m.id,title:m.title,text:m.text});}); });
    await h.g.p.goto('https://l2wap.com/craft.html'); await waitFor(() => h.g.core('typeof on !== "undefined" && !running'));
    await h.popup.reload(); await waitFor(() => h.popup.evaluate(() => !!document.querySelector('#start')?.onclick)); await h.openTab('craft');
    await h.popup.locator('#craftRefresh').click(); await waitFor(async () => (await h.get(['rt'])).rt.craftBook?.recipes?.length === 3);
    assert.equal(posts.length, 0, 'чтение выключенного бота не делает расход'); assert.equal((await h.get(['on'])).on, false);
    const beforeRead = (await h.get(['rt'])).rt.craftBook.t; holdBook = true;
    await h.popup.evaluate(() => { globalThis.__craftCancelledRead=gameSend({cmd:'craftRead',char:'AuditHero'},{char:'AuditHero'}).catch(e=>({ok:false,reason:e.message})); });
    await waitFor(()=>!!heldBookRoute); await h.popup.locator('#stop').click(); await delay(200); await heldBookRoute.fulfill({json:book()});
    const cancelledRead=await h.popup.evaluate(()=>globalThis.__craftCancelledRead);assert.equal(cancelledRead.ok,false,'Stop при уже выключенном боте отменяет поздний снимок чтения');
    assert.equal((await h.get(['rt'])).rt.craftBook.t,beforeRead);assert.equal(posts.length,0);
    proof.push({scenario:'actual popup Stop во время ручного OFF-чтения отклоняет поздний снимок',reply:cancelledRead,posts:0});
    await h.popup.locator('#craftSearch').fill('орих'); await waitFor(async () => await h.popup.locator('#craftCatalog [data-craftpick="oriharukon"]').isVisible());
    await h.popup.locator('#craftSearch').press('Enter'); assert.equal(await h.popup.locator('#craftPick').inputValue(),'oriharukon'); assert.equal(await h.popup.evaluate(()=>document.activeElement.id),'craftN'); await h.popup.locator('#craftN').fill('2');
    await waitFor(async () => /Cokes|Кокс/.test(await h.popup.locator('#craftPreview').textContent()));
    await h.popup.locator('#craftSearch').fill('Oriharukon'); await waitFor(async () => await h.popup.locator('#craftCatalog [data-craftpick="oriharukon"]').isVisible());
    await h.popup.locator('#craftN').fill('23'); await h.popup.locator('#craftSearch').fill('orih');
    await h.sw.evaluate(async () => { const { rt } = await chrome.storage.local.get('rt'); await chrome.storage.local.set({ rt: { ...rt, craftSay: { t: Date.now(), why: 'Fixture refresh' } } }); });
    await delay(500); assert.equal(await h.popup.locator('#craftSearch').inputValue(),'orih'); assert.equal(await h.popup.locator('#craftN').inputValue(),'23');
    await h.popup.locator('#craftN').fill('2');
    const widths = [];
    for (const width of [320,420]) { await h.popup.setViewportSize({ width, height: 600 }); await h.openTab('craft'); await h.popup.locator('#craftSearch').focus(); await h.popup.keyboard.press('Tab');
      const bounds = await h.popup.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, active: document.activeElement?.id || document.activeElement?.tagName,sectionHeight:document.querySelector('#tab-craft').getBoundingClientRect().height,activityShown:getComputedStyle(document.querySelector('#activityPanel')).display!=='none' })); assert.ok(bounds.scroll <= width + 1, 'крафт не создаёт горизонтальную прокрутку: ' + JSON.stringify(bounds)); assert.ok(bounds.sectionHeight>=200,'в мастерской остаётся место для выбора и количества'); assert.equal(bounds.activityShown,false,'обзорная карточка не дублирует мастерскую'); widths.push(bounds); }
    await h.popup.setViewportSize({ width: 980, height: 1050 }); await h.popup.locator('#craftAdd').click(); await waitFor(async () => (await h.get(['rt'])).rt.craftQueue?.length === 1);
    await h.popup.locator('#craftStart').click(); await waitFor(async () => (await h.get(['rt'])).rt.craftPlan?.missing?.some(x => x.item === IDS.ore));
    assert.equal(posts.length, 0, 'необеспеченная цепочка не тратит промежуточные материалы и банки');
    assert.match(await h.popup.locator('#craftShortage').textContent(), /3|Oriharukon Ore/);
    await waitFor(async()=>await h.sw.evaluate(()=>globalThis.__craftAlertMessages.some(x=>x.cmd==='alert')));
    changeQty(IDS.ore,3); actor.revision++; await h.popup.locator('#craftRefresh').click();
    await waitFor(async () => Object.values((await h.get(['rt'])).rt.craftMade || {}).some(x => x === 2),30000);
    await h.popup.locator('#stop').click(); await waitFor(async () => (await h.get(['on'])).on === false);
    assert.equal(qty(IDS.oriharukon),2); assert.deepEqual(posts.filter(x=>x.path==='/game/craft/materials').map(x=>[x.body.recipeCode,x.body.craftCount]), [['cokes',4],['synthetic_cokes',2],['oriharukon',2]]);
    assert.deepEqual(h.errors, []);
    const alertMessages=await h.sw.evaluate(()=>globalThis.__craftAlertMessages);assert.equal(alertMessages.filter(x=>x.cmd==='alert').length,1);assert.ok(alertMessages.some(x=>x.cmd==='alertClear'));
    proof.push({ scenario: 'actual full MV3 OFF-read → поиск RU/EN → preview/shortage → очередь → chain до цели', made: 2, posts: structuredClone(posts), widths,alertMessages });
    const runtimeHashes = await h.sw.evaluate(async () => Object.fromEntries(await Promise.all(['content.js','modules/craft.js','craft-plan.js','defaults.js','popup.js','popup.html','ui-game.css'].map(async p=>{const r=await fetch(chrome.runtime.getURL(p));const d=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());return[p,[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')];}))));
    for (const [p,hsh] of Object.entries(runtimeHashes)) assert.equal(hsh,hash(path.join(root,p)), 'загруженные байты ' + p);
    if (process.env.CRAFT_SCREENSHOT) await h.popup.screenshot({ path: process.env.CRAFT_SCREENSHOT, fullPage: true });
    return { extensionVersion: await h.sw.evaluate(()=>chrome.runtime.getManifest().version), runtimeHashes, errors: h.errors };
  } finally { await h.ctx.close(); }
}
(async()=>{
  const browser=await runtime(), full=await fullExtension();assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const currentHashes=Object.fromEntries(Object.keys(sourceHashes).map(p=>[p,hash(path.join(p==='modules/craft.js'?runtimeRoot:p==='craft-plan.js'?planRoot:root,p))]));assert.deepEqual(currentHashes,sourceHashes,'исходники изменились во время теста — повторите финальные байты');
  console.log(JSON.stringify({pass:true,browser,boundary:'Actual Chrome MV3/storage/reload/popup/main; local response model only, no live game',sources:sourceHashes,full,proof,errors,externalRequests:external.length},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1}).finally(async()=>{if(ctx)await ctx.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}fs.rmSync(stage,{recursive:true,force:true});});

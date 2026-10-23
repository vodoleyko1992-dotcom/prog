'use strict';
// Настоящий Chromium, native fetch/Response.json и location.reload; точные функции content.js.
// Actor/lease/IPC/задача управляются стендом. Для длинных отказов подменены только часы
// и планирование AbortSignal.timeout через настоящий AbortController. Это не полный MV3.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/workspace/.local/l2tools/node/node_modules/playwright');
const sourcePath = process.env.L2_INV_SOURCE || path.join(__dirname, '../../content.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const gs = source.indexOf('async function gameGet('), ge = source.indexOf('// 7.2.5', gs);
const is = source.indexOf('let INV_NET ='), ie = source.indexOf('const actNet =', is);
assert.ok(gs >= 0 && ge > gs && is >= 0 && ie > is, 'найдены границы исходных функций');
const getter = source.slice(gs, ge), inventory = source.slice(is, ie);
const proof = [], requests = [], pageErrors = [], unexpectedNetwork = [], sockets = new Set();
let mode = 'hang', reads = [], docRequests = 0;
const hero = { name: 'BrowserHero', revision: 100, level: 57, l2Profession: 'human_warlord', classBranch: 'fighter',
  classSlots: { activeSlot: 3, slots: [{ slot: 3, active: true, owned: true, profession: 'human_warlord', level: 57 }] },
  inventory: { stacks: [{ itemId: 1465, qty: 1000 }], eq: {} } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await delay(20); }
  throw new Error('Условие не выполнено: ' + label);
}
function runner(virtual) {
  return `'use strict';
if (${virtual}) AbortSignal.timeout=ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('fixture timeout','TimeoutError')),ms);return c.signal;};
const documentNo=+(sessionStorage.getItem('fixture-document')||0)+1;sessionStorage.setItem('fixture-document',documentNo);
let on=true,tabOwner=true,leaseEpoch='lease-one',automationGeneration=1;
const originalRt={char:'BrowserHero',classCur:{prof:'human_warlord',slot:3},manualKickAt:0,raidReceipt:{spawn:'fixture-raid',won:true},route:{task:'raid',step:3}};
const rt=JSON.parse(sessionStorage.getItem('fixture-rt')||JSON.stringify(originalRt)),cfg={task:'raid'};
let captcha=null,payment=null,paymentBlocked=false,travel=false,canAct=true,flushMutation='';
const logs=[],statuses=[],publications=[],writes=[],traces=[],deadlines=[];
const heroNick=()=>rt.char,gameAuth=()=>({}),modeSig=c=>JSON.stringify([c.task,c.taskOnly||false]);
const setRt=async p=>{writes.push(p);Object.assign(rt,p);return {ok:true};},rtCommit=async()=>true,setStatus=s=>statuses.push(s),rec=(...x)=>logs.push(x),antibotState=()=>captcha;
const automationSnapshot=()=>JSON.stringify([automationGeneration,rt.char,leaseEpoch,rt.manualKickAt,modeSig(cfg),location.pathname,location.search]);
const automationCurrent=s=>on&&tabOwner&&canAct&&s===automationSnapshot();
const change=kind=>{if(kind==='stop')on=false;else if(kind==='captcha')captcha={active:true};else if(kind==='payment')payment={id:'fixture-pending'};
else if(kind==='payment-blocked')paymentBlocked=true;else if(kind==='travel')travel=true;else if(kind==='cast')rt.fishCastPending={id:'fixture-cast'};
else if(kind==='mode')cfg.task='fish';else if(kind==='owner')tabOwner=false;else if(kind==='action')canAct=false;};
const automationFlush=async stamp=>{if(flushMutation)change(flushMutation);sessionStorage.setItem('fixture-rt',JSON.stringify(rt));return automationCurrent(stamp);};
const L2V7Modules={payments:{pending:()=>payment,blocked:()=>paymentBlocked},navigation:{travelPending:()=>travel},tvt:{tvtHold:()=>false},
mammon:{eqNote:async()=>publications.push('eq')},warlock:{noteSnapshot:()=>publications.push('snapshot')},buffs:{vipNote:()=>publications.push('vip')}};
const nativeFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(...args)=>{const t={url:String(args[0]),headers:false,signal:args[1]?.signal};traces.push(t);const r=await nativeFetch(...args);t.headers=true;return r;};
${getter}
${inventory}
const nativeInvRefresh=invRefresh;invRefresh=(...args)=>{deadlines.push(args[1]??6000);return nativeInvRefresh(...args);};
let completed=null,failure=null;
const state=()=>({documentNo,on,owner:tabOwner,now:Date.now(),rt,cfg,reading:!!INV_READ,ready:INV_READY,retry:{...INV_RETRY},qty:invQty(1465),
logs,statuses,publications,writes,deadlines,completed,failure,reloadStamp:sessionStorage.getItem('l2bot-inv-reload'),
calls:traces.map(t=>({url:t.url,headers:t.headers,aborted:!!t.signal?.aborted}))});
globalThis.InventoryFixture={state,change,flushChange:kind=>flushMutation=kind,
start:()=>{completed=null;failure=null;inventoryReady().then(ok=>{completed=ok;},e=>{failure=e.name;});},
read:async()=>{const ok=await inventoryReady();return {ok,state:state()};}};
`;
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1'), pathname = u.pathname;
  requests.push({ method: req.method, path: pathname });
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  if (pathname === '/map.html') {
    docRequests++;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><meta charset="utf-8"><title>Локальная проверка сумки</title><script src="/runner.js' + u.search + '"></script>'); return;
  }
  if (pathname === '/runner.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); res.end(runner(u.searchParams.has('virtual'))); return; }
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (pathname !== '/character') { res.writeHead(404); res.end(); return; }
  const record = { mode, at: Date.now(), ended: false, aborted: false };
  reads.push(record);
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.flushHeaders(); res.write('{"character":');
  let timer;
  if (mode === 'fast' || mode === 'slow14') timer = setTimeout(() => {
    record.ended = true; record.bodyMs = Date.now() - record.at; res.end(JSON.stringify(hero) + '}');
  }, mode === 'fast' ? 1 : 14000);
  res.on('close', () => { clearTimeout(timer); if (!record.ended) record.aborted = true; });
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    async function fresh(nextMode, virtual = true) {
      mode = nextMode; reads = []; docRequests = 0;
      const context = await browser.newContext();
      await context.route(/^https?:\/\//, route => {
        if (route.request().url().startsWith(origin + '/')) return route.continue();
        unexpectedNetwork.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', e => pageErrors.push(e.message));
      if (virtual) { await page.clock.install({ time: 1800000000000 }); await page.clock.pauseAt(1800000000000); }
      await page.goto(origin + '/map.html' + (virtual ? '?virtual' : ''));
      await until(() => page.evaluate(() => !!globalThis.InventoryFixture), 'инициализация');
      return { page, context };
    }
    const state = p => p.evaluate(() => InventoryFixture.state());
    async function begin(p) {
      const previous = reads.length;
      await p.evaluate(() => InventoryFixture.start());
      await until(async () => reads.length > previous && (await state(p)).calls.at(-1)?.headers, 'native fetch получил200headers');
    }
    async function failed(p, ms) {
      await begin(p); await p.clock.runFor(ms);
      await until(async () => (await state(p)).completed === false, 'таймаут завершён');
      const s = await state(p); assert.equal(s.failure, null); assert.equal(s.reading, false); return s;
    }
    async function retry(p) { const s = await state(p); await p.clock.runFor(Math.max(0, s.retry.at - s.now)); }
    async function firstTwo(p) { await failed(p, 6000); await retry(p); await failed(p, 25000); await retry(p); }

    // Сценарий с настоящими 6/25секундными AbortSignal и реальным14секундным телом.
    {
      const { page, context } = await fresh('slow14', false);
      try {
        const started = Date.now();
        const first = await page.evaluate(() => InventoryFixture.read());
        assert.equal(first.ok, false); assert.equal(docRequests, 1); assert.equal(first.state.retry.n, 1);
        assert.match(first.state.statuses.at(-1), /чтение JSON: таймаут/);
        await delay(Math.max(0, first.state.retry.at - Date.now()));
        const second = await page.evaluate(() => InventoryFixture.read());
        assert.equal(second.ok, true); assert.equal(second.state.qty, 1000); assert.equal(second.state.retry.n, 0);
        assert.deepEqual(second.state.deadlines, [6000, 25000]); assert.equal(docRequests, 1);
        assert.equal(reads.length, 2); assert.ok(reads[1].bodyMs >= 13000);
        proof.push({ scenario: 'real14s body succeeds on25s retry without reload', elapsedMs: Date.now() - started, retryBodyMs: reads[1].bodyMs, configuredDeadlines: second.state.deadlines });
      } finally { await context.close(); }
    }
    // Три native bodyabort, настоящий reload документа и новый свежий preflight.
    {
      const { page, context } = await fresh('hang');
      try {
        const initial = await state(page); await firstTwo(page);
        assert.equal(docRequests, 1); await begin(page); mode = 'fast';
        const navigated = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
        await page.clock.runFor(25000); await navigated;
        await until(async () => await page.evaluate(() => globalThis.InventoryFixture?.state().documentNo === 2), 'новый документ послеreload');
        const after = await state(page), persisted = await page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-rt')));
        assert.equal(docRequests, 2); assert.ok(after.reloadStamp); assert.deepEqual(persisted, initial.rt);
        const ok = await page.evaluate(() => InventoryFixture.read());
        assert.equal(ok.ok, true); assert.equal(ok.state.qty, 1000); assert.equal(ok.state.cfg.task, 'raid');
        assert.deepEqual(ok.state.rt.raidReceipt, initial.rt.raidReceipt); assert.deepEqual(ok.state.rt.route, initial.rt.route);
        assert.deepEqual(ok.state.deadlines, [6000]); assert.equal(reads.length, 4);
        proof.push({ scenario: 'three timeouts cause one actual reload; recreated document confirms inventory and preserves route/receipt', virtualElapsedMs: after.now - initial.now, reloads: docRequests - 1, freshQty: ok.state.qty, configuredDeadlinesBeforeReload: [6000, 25000, 25000] });
      } finally { await context.close(); }
    }
    // Cooldown хранится в sessionStorage и переживает создание нового документа.
    {
      const { page, context } = await fresh('hang');
      try {
        await firstTwo(page); await begin(page);
        const navigated = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
        await page.clock.runFor(25000); await navigated;
        await until(() => page.evaluate(() => globalThis.InventoryFixture?.state().documentNo === 2), 'cooldown document');
        await firstTwo(page); const suppressed = await failed(page, 25000);
        assert.equal(docRequests, 2); assert.equal(suppressed.retry.n, 3);
        await page.clock.runFor(300001); await begin(page);
        const repeated = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
        await page.clock.runFor(25000); await repeated;
        await until(() => page.evaluate(() => globalThis.InventoryFixture?.state().documentNo === 3), 'reload aftercooldown');
        assert.equal(docRequests, 3);
        proof.push({ scenario: 'new document retains five-minute cooldown; one reload allowed afterexpiry', suppressedDuringCooldown: true, reloadsAfterExpiry: docRequests - 1 });
      } finally { await context.close(); }
    }
    for (const guard of ['stop', 'owner', 'mode', 'captcha', 'payment', 'payment-blocked', 'travel', 'cast', 'action']) {
      const { page, context } = await fresh('hang');
      try {
        await firstTwo(page); await begin(page);
        await page.evaluate(kind => InventoryFixture.change(kind), guard);
        await page.clock.runFor(25000);
        await until(async () => (await state(page)).completed === false, guard + 'settled');
        const s = await state(page); assert.equal(docRequests, 1); assert.equal(s.reading, false); assert.deepEqual(s.publications, []);
        proof.push({ scenario: guard + ' appears during third native body read', reloads: 0, publications: 0 });
      } finally { await context.close(); }
    }
    for (const guard of ['stop', 'captcha', 'payment']) {
      const { page, context } = await fresh('hang');
      try {
        await firstTwo(page); await page.evaluate(kind => InventoryFixture.flushChange(kind), guard);
        const s = await failed(page, 25000);
        assert.equal(docRequests, 1); assert.equal(s.reloadStamp, null); assert.deepEqual(s.publications, []);
        proof.push({ scenario: guard + ' appears during durable flush before reload', reloads: 0, publications: 0 });
      } finally { await context.close(); }
    }
    assert.deepEqual(pageErrors, []); assert.deepEqual(unexpectedNetwork, []);
    assert.equal(requests.filter(x => x.method !== 'GET').length, 0);
    const sha = x => createHash('sha256').update(x).digest('hex');
    const result = { result: 'PASS', scenarios: proof.length, browser: browser.version(), sourceSha256: sha(source), gameGetSha256: sha(getter), inventorySha256: sha(inventory),
      boundary: 'exact gameGet+inventory functions in real Chromium; native fetch/JSON/reload; controlled actor/IPC/route, loopback only; virtual clocks and AbortSignal timeout scheduling for long failures, native time and timeout for14s success; not full MV3',
      proof, posts: 0, pageErrors, externalRequests: unexpectedNetwork.length, liveGame: false };
    const proofPath = process.env.L2_INV_BROWSER_PROOF || '/workspace/work/inventory-stall-browser.json';
    fs.mkdirSync(path.dirname(proofPath), { recursive: true }); fs.writeFileSync(proofPath, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL', e.stack || e); process.exitCode = 1; }).finally(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
});

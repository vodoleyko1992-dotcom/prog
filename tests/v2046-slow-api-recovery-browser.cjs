'use strict';
// 20.46 (22.10, зависание чтения сумки): настоящий Chrome/fetch/Response.json/AbortSignal.timeout и loopback HTTP.
// В браузер загружаются неизменённые gameGet и весь inventory-блок из content.js. Остальные зависимости/владелец — стенд.
// Это регресс сетевого чтения и публикации снимка, не полный MV3/main и не живая игра. Часы и AbortSignal не подменяются.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createHash } = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/workspace/.local/l2tools/node/node_modules/playwright');
const executablePath = process.env.CHROMIUM || '/workspace/work/fixes-2046/browsers/chromium-1248/chrome-linux64/chrome';
const source = fs.readFileSync(process.env.SLOW_API_CONTENT_SOURCE || path.join(__dirname, '..', 'content.js'), 'utf8');
const getStart = source.indexOf('async function gameGet('), getEnd = source.indexOf('// 7.2.5', getStart);
const invStart = source.indexOf('let INV_NET ='), invEnd = source.indexOf('const actNet =', invStart);
assert.ok(getStart >= 0 && getEnd > getStart && invStart >= 0 && invEnd > invStart, 'границы настоящих функций content.js найдены');
const getSource = source.slice(getStart, getEnd), invSource = source.slice(invStart, invEnd);
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 3000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await delay(20); } throw Error('fixture condition timed out'); }
async function bounded(promise, ms, name) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(name + ' did not finish in ' + ms + 'ms')), ms); })]); } finally { clearTimeout(timer); } }

const hero = { name: 'AuditHero', revision: 10, level: 48, l2Profession: 'human_warlord', classBranch: 'fighter',
  classSlots: { activeSlot: 0, slots: [{ slot: 0, active: true, owned: true, profession: 'human_warlord', level: 48 }] },
  inventory: { stacks: [{ itemId: 1465, qty: 1000 }], eq: {} } };
const requests = [], routeErrors = [], proof = [];
let mode = '', reads = [];
const runner = () => `
'use strict';
sessionStorage.clear();sessionStorage.setItem('l2bot-inv',JSON.stringify({char:'AuditHero',m:{1465:7},t:Date.now()}));
let on=true,tabOwner=true,leaseEpoch='lease-one',automationGeneration=1;
const cfg={},rt={char:'AuditHero',classCur:{prof:'human_warlord',slot:0},manualKickAt:0};
const heroNick=()=>rt.char,gameAuth=()=>({}),writes=[],publications=[],statuses=[],traces=[];
const setRt=async p=>{writes.push(p);Object.assign(rt,p);return {ok:true}},rtCommit=async()=>true,setStatus=s=>statuses.push(s);
const L2V7Modules={payments:{pending:()=>null},mammon:{eqNote:async()=>publications.push('eq')},
 warlock:{noteSnapshot:()=>publications.push('snapshot')},buffs:{vipNote:()=>publications.push('vip')}};
// Обёртка только наблюдает настоящий fetch; Response, поток тела и AbortSignal возвращаются без замены.
const nativeFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(...args)=>{const t={url:String(args[0]),at:performance.now(),signal:args[1]?.signal,headersMs:null};traces.push(t);
 const r=await nativeFetch(...args);t.headersMs=performance.now()-t.at;return r;};
${getSource}
${invSource}
// Наблюдаем переданный deadline, не меняя реализацию invRefresh/fetch/AbortSignal.
const nativeInvRefresh=invRefresh,readDeadlines=[];
invRefresh=(...args)=>{readDeadlines.push(args[1]??6000);return nativeInvRefresh(...args);};
const state=()=>({on,owner:tabOwner,lease:leaseEpoch,generation:automationGeneration,reading:!!INV_READ,ready:INV_READY,
 retry:{...INV_RETRY},qty:invQty(1465),inventory:INV_NET,stored:sessionStorage.getItem('l2bot-inv'),writes:writes.length,
 publications:[...publications],statuses:[...statuses],deadlines:[...readDeadlines],calls:traces.map(t=>({url:t.url,headersMs:t.headersMs,aborted:!!t.signal?.aborted,reason:t.signal?.reason?.name||''}))});
globalThis.SlowFixture={state,read:async()=>{const at=performance.now(),ok=await inventoryReady();return {ok,ms:performance.now()-at,state:state()};},
 recover:async()=>{let polls=0;while(on&&tabOwner){polls++;if(await inventoryReady())return {polls,state:state()};await new Promise(r=>setTimeout(r,100));}throw Error('fixture stopped');},
 expire:()=>{INV_NET.t=Date.now()-300001;},
 change:kind=>{automationGeneration++;if(kind==='stop')on=false;else{tabOwner=false;leaseEpoch='lease-two';}}};
`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  requests.push({ method: req.method, path: pathname });
  if (req.method !== 'GET') { routeErrors.push('unexpected ' + req.method + ' ' + pathname); res.writeHead(405); return res.end(); }
  if (pathname === '/runner.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><meta charset="utf-8"><title>Local slow API regression</title><script src="/runner.js"></script>'); }
  if (pathname === '/runner.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(runner()); }
  if (pathname !== '/character') { res.writeHead(404); return res.end(); }
  const record = { mode, at: Date.now(), headers: true, ended: false, aborted: false };
  reads.push(record);
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.flushHeaders();res.write('{"character":');
  const bodyMs = mode === 'slow' ? 14000 : mode === 'cancel' ? 900 : null;
  let timer = null;
  if (bodyMs != null) timer = setTimeout(() => { record.ended = true; record.elapsedMs = Date.now() - record.at; res.end(JSON.stringify(hero) + '}'); }, bodyMs);
  res.on('close', () => { clearTimeout(timer); if (!record.ended) { record.aborted = true; record.elapsedMs = Date.now() - record.at; } });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext(), errors = [];
  try {
    await context.route(/^https?:\/\//, route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    async function pageFor(nextMode) { mode = nextMode; reads = []; const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(origin + '/runner.html'); await p.waitForFunction(() => !!globalThis.SlowFixture); return p; }
    const cases = (process.env.SLOW_API_CASES || 'hang,recovery,stop,owner').split(',');
    if (cases.includes('hang')) {
      const p = await pageFor('hang');
      try {
        const pending = p.evaluate(() => SlowFixture.read());
        await until(() => reads.length === 1);
        await p.waitForFunction(() => SlowFixture.state().calls[0]?.headersMs != null);
        const during = await p.evaluate(() => SlowFixture.state());
        assert.equal(during.reading, true); assert.equal(during.calls[0].aborted, false); assert.ok(during.calls[0].headersMs < 3000, 'настоящий fetch уже получил200headers');
        const r = await bounded(pending, 9000, 'headers200/body hang');
        assert.equal(r.ok, false); assert.ok(r.ms >= 5000 && r.ms < 9000, '6с дедлайн распространяется на Response.json: ' + r.ms);
        assert.equal(r.state.reading, false); assert.equal(r.state.ready, ''); assert.equal(r.state.qty, 7);
        assert.equal(r.state.retry.n, 1); assert.equal(r.state.calls[0].aborted, true);
        assert.deepEqual(r.state.deadlines, [6000]);
        assert.deepEqual(r.state.publications, []); assert.equal(r.state.writes, 0);
        proof.push({ scenario: '200 headers then hung body', elapsedMs: Math.round(r.ms), nativeAbort: r.state.calls[0].reason, invReadReleased: !r.state.reading, published: r.state.publications.length });
      } finally { await p.close(); }
    }
    if (cases.includes('recovery')) {
      const p = await pageFor('slow');
      try {
        const before = await p.evaluate(() => SlowFixture.state()), at = Date.now();
        const running = p.evaluate(() => SlowFixture.recover());
        await until(() => reads.length === 2, 12000);
        const first = reads[0]; assert.equal(first.aborted, true); assert.ok(first.elapsedMs >= 5000 && first.elapsedMs < 9000);
        const inSecond = await p.evaluate(() => SlowFixture.state());
        assert.equal(inSecond.reading, true); assert.equal(inSecond.retry.n, 1); assert.equal(inSecond.ready, ''); assert.equal(inSecond.qty, 7);
        assert.deepEqual(inSecond.publications, [], 'первое неоконченное тело не публикует снимок');
        const recovered = await bounded(running, 22000, '14s retry within25s');
        assert.equal(recovered.state.qty, 1000); assert.equal(recovered.state.reading, false); assert.equal(recovered.state.retry.n, 0);
        assert.equal(recovered.state.on, before.on); assert.equal(recovered.state.owner, before.owner); assert.equal(recovered.state.lease, before.lease); assert.equal(recovered.state.generation, before.generation);
        assert.deepEqual(recovered.state.deadlines, [6000, 25000]);
        assert.equal(reads.length, 2); assert.equal(reads[1].ended, true); assert.ok(reads[1].elapsedMs >= 13000, 'ответ действительно занял14с');
        const recoveryMs = Date.now() - at, published = recovered.state.publications.length;
        // Имитируем только старение кэша на5мин в том же actor/lease; native timer/clock/fetch остаются настоящими.
        await p.evaluate(() => SlowFixture.expire()); mode = 'hang';
        const quick = await bounded(p.evaluate(() => SlowFixture.read()), 9000, 'fast deadline after success');
        assert.equal(quick.ok, false); assert.ok(quick.ms >= 5000 && quick.ms < 9000, 'успех сбросил25с к обычным6с');
        assert.equal(quick.state.reading, false); assert.equal(quick.state.calls.length, 3); assert.equal(quick.state.publications.length, published);
        assert.deepEqual(quick.state.deadlines, [6000, 25000, 6000]);
        proof.push({ scenario: 'slow14s,6s fail→25s retry→6s after success', configuredDeadlines: quick.state.deadlines, recoveryMs, firstDeadlineMs: first.elapsedMs, retryBodyMs: reads[1].elapsedMs, resetDeadlineMs: Math.round(quick.ms), withoutNewStart: true, freshQty: recovered.state.qty });
      } finally { await p.close(); }
    }
    for (const kind of ['stop', 'owner'].filter(k => cases.includes(k))) {
      const p = await pageFor('cancel');
      try {
        const before = await p.evaluate(() => SlowFixture.state());
        const pending = p.evaluate(() => SlowFixture.read());
        await until(() => reads.length === 1);
        await p.waitForFunction(() => SlowFixture.state().calls[0]?.headersMs != null);
        await p.evaluate(kind => SlowFixture.change(kind), kind);
        const r = await bounded(pending, 4000, kind + ' during body');
        assert.equal(reads[0].ended, true, 'настоящий body дошёл после отмены владельца');
        assert.equal(r.ok, false); assert.equal(r.state.reading, false); assert.equal(r.state.ready, ''); assert.equal(r.state.qty, 7);
        assert.equal(r.state.stored, before.stored); assert.equal(r.state.writes, 0); assert.deepEqual(r.state.publications, []);
        proof.push({ scenario: kind + ' during native body read', responseCompleted: true, published: 0, invReadReleased: true });
      } finally { await p.close(); }
    }
    assert.deepEqual(errors, []); assert.deepEqual(routeErrors, []); assert.equal(requests.filter(q => q.method === 'POST').length, 0);
    const sha = value => createHash('sha256').update(value).digest('hex');
    const result = { result: 'PASS', browser: browser.version(), sourceSha256: sha(source), gameGetSha256: sha(getSource), inventorySha256: sha(invSource),
      boundary: 'real browser/native fetch+Response body and exact content.js functions; controlled actor/env; loopback HTTP only', proof, posts: 0, pageErrors: errors, liveGame: false };
    if (process.env.SLOW_API_PROOF) fs.writeFileSync(process.env.SLOW_API_PROOF, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await context.close(); await browser.close(); }
})().catch(e => { console.error('FAIL', e.stack || e); process.exitCode = 1; }).finally(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
});

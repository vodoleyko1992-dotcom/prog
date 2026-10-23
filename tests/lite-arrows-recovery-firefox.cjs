'use strict';
// Lite1.5.2: настоящий Firefox из переданного ZIP, Selenium, TLS только на127.0.0.1:443.
// FIREFOX=... GECKODRIVER=... NODE_PATH=...(selenium-webdriver) node tests/lite-arrows-recovery-firefox.cjs <firefox.zip>
// Старая модель/HTML переиспользуются без запуска Chromium или исторических A–G. Настоящая игра не открывается.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), https = require('node:https'), crypto = require('node:crypto');
const Module = require('node:module'), assert = require('node:assert/strict'), { execFileSync } = require('node:child_process');
const { Builder } = require('selenium-webdriver'), firefox = require('selenium-webdriver/firefox');
const zip = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.statSync(zip).isFile()) throw Error('Передайте Firefox ZIP');
const filename = path.join(__dirname, 'lite-browser.cjs'), src = fs.readFileSync(filename, 'utf8');
const model = src.slice(src.indexOf('// ---------- модель сервера игры'), src.indexOf('\nasync function launch()'));
const archer = src.slice(src.indexOf('\nconst SLOTS = act'), src.indexOf('\nasync function scenarioF()'));
assert.ok(model.includes('function makeServer()') && archer.includes('const archerOf'), 'границы общего fixture');
const fixture = new Module(filename, module); fixture.filename = filename; fixture.paths = module.paths;
fixture._compile(model + '\n' + archer + '\nmodule.exports={makeServer,archerOf,mapPage,battlePage,teleportPage,cityPage,bufferPage,arenaPage};', filename);
const { makeServer, archerOf, mapPage, battlePage, teleportPage, cityPage, bufferPage, arenaPage } = fixture.exports;
const sv = makeServer(), S = sv.S, pageErrors = [], requestErrors = [], proof = [];
Object.assign(S.hero, archerOf()); S.champAt = 99999; S.arrows = 1000; S.weaponId = 286; S.arrowRows = [{ itemId: 1341, qty: 1000 }];
const originalApi = sv.api;
sv.api = async (p, method, body) => {
  const shot = p === '/game/battle/action' && /^(attack|double_shot|power_shot|stun_shot)$/.test(body.action || '');
  const goodId = S.weaponId === 286 ? 1342 : 1341, row = S.arrowRows.find(x => x.itemId === goodId), good = !!row && row.qty > 0, before = S.arrows;
  if (shot) S.arrows = good ? row.qty : 0;
  const response = await originalApi(p, method, body);
  if (shot) { if (good) row.qty = S.arrows; else S.arrows = before; }
  if (response[1]?.character) response[1].character.inventory = { stacks: S.arrowRows.filter(x => x.qty > 0).map(x => ({ ...x })), eq: { l1: { itemId: S.weaponId } } };
  return response;
};
const tmp = fs.mkdtempSync(path.join(process.env.LITE_FIREFOX_WORK || os.tmpdir(), 'lite152-arrows-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=l2wap.com', '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem')], { stdio: 'ignore' });
const pages = { '/map.html': () => mapPage(sv), '/battle.html': () => battlePage(sv), '/teleport.html': () => teleportPage(sv),
  '/city.html': cityPage, '/town-buffer.html': bufferPage, '/tvt-arena.html': () => arenaPage(sv) };
const server = https.createServer({ key: fs.readFileSync(path.join(tmp, 'key.pem')), cert: fs.readFileSync(path.join(tmp, 'cert.pem')) }, async (q, r) => {
  try {
    const p = new URL(q.url, 'https://l2wap.com').pathname;
    if (p === '/__fixture/error') { let raw = ''; for await (const c of q) raw += c; pageErrors.push(raw.slice(0, 300)); r.end('{}'); return; }
    if (/\.(gif|png|jpg|ico)$/.test(p)) { r.writeHead(404); r.end(); return; }
    if (pages[p]) {
      const trap = '<script>addEventListener("error",e=>fetch("/__fixture/error",{method:"POST",body:String(e.message)}));</script>';
      r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(pages[p]().replace('<head>', '<head>' + trap)); return;
    }
    let raw = ''; for await (const c of q) raw += c;
    const [status, data] = await sv.api(p, q.method, raw ? JSON.parse(raw) : {});
    r.writeHead(status, { 'content-type': 'application/json' }); r.end(JSON.stringify(data));
  } catch (e) { requestErrors.push(String(e.message)); r.writeHead(500, { 'content-type': 'application/json' }); r.end('{"error":"local_fixture"}'); }
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, ms, what) { const end = Date.now() + ms; let last; do { try { last = await fn(); if (last) return last; } catch (e) {} await sleep(150); } while (Date.now() < end); throw Error('не дождался: ' + what); }
const UUID = '7d0c2b4e-8f8a-4c1e-9b7a-5a1f2d3c4b5f';
let driver, gamePage = false;
async function storage(action, arg) {
  await driver.switchTo().defaultContent();
  try {
    if (gamePage) {
      const frame = await driver.executeScript('return document.getElementById("l2lite-dock")?.shadowRoot?.querySelector("iframe")');
      assert.ok(frame, 'встроенное меню Lite доступно'); await driver.switchTo().frame(frame);
    }
    const result = await driver.executeAsyncScript(`const action=arguments[0],arg=arguments[1],done=arguments[arguments.length-1];
      (async()=>{if(action==='set'){await chrome.storage.local.set(arg);done({ok:true});}
       else if(action==='manifest')done({ok:true,data:chrome.runtime.getManifest()});
       else done({ok:true,data:await chrome.storage.local.get(arg)});})().catch(e=>done({error:String(e)}));`, action, arg);
    if (!result?.ok) throw Error(result?.error || 'storage fixture'); return result.data;
  } finally { await driver.switchTo().defaultContent(); }
}
const rt = async () => (await storage('get', ['lite.rt']))['lite.rt'] || {};
const nativeSnapshot = () => driver.executeAsyncScript('const done=arguments[arguments.length-1];ch().then(()=>done(true),e=>done({error:String(e)}));');
(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(443, '127.0.0.1', resolve); });
  const opt = new firefox.Options().addArguments('-headless', '--window-size=1280,800').setBinary(process.env.FIREFOX);
  for (const [k, v] of Object.entries({ 'network.dns.localDomains': 'l2wap.com', 'network.proxy.type': 0, 'network.dns.disableIPv6': true,
    'extensions.webextensions.uuids': JSON.stringify({ 'l2wap-lite@local': UUID }), 'xpinstall.signatures.required': false,
    'network.connectivity-service.enabled': false, 'extensions.update.enabled': false, 'toolkit.telemetry.enabled': false })) opt.setPreference(k, v);
  opt.setAcceptInsecureCerts(true);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opt).setFirefoxService(new firefox.ServiceBuilder(process.env.GECKODRIVER)).build();
  await driver.manage().setTimeouts({ script: 10000, pageLoad: 20000 });
  const addon = await driver.installAddon(zip, true); assert.equal(addon, 'l2wap-lite@local');
  // geckodriver запрещает прямую навигацию к moz-extension. Настоящий dock создаёт разрешённый iframe меню.
  // Новая временная установка по умолчанию OFF; проверим отсутствие действий до явного Start ниже.
  await driver.get('https://l2wap.com/map.html'); gamePage = true;
  const manifest = await until(() => storage('manifest', null), 20000, 'настоящее меню в iframe'); assert.equal(manifest.version, JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' })).version);   // 1.6: версия — из самого ZIP
  const off = { on: false, p: { archer: { zone: 'giran_harbor', zoneName: 'Гавань Гірана', killLimit: 0, tvt: false,
    skills: Object.fromEntries(S.hero.battleHotbarSlots.filter(x => x.a !== 'attack').map(x => [x.a, { on: false }])) } } };
  await storage('set', { 'lite.cfg': off });
  await until(async () => (await rt()).kind === 'archer', 20000, 'профиль лука и встроенное меню');
  assert.equal(await driver.executeScript('return !!window.__l2liteHook'), true, 'настоящий hook в MAIN world');
  assert.equal(S.acts.length, 0, 'до Start новая установка не действует');
  await storage('set', { 'lite.cfg': { ...off, on: true }, 'lite.cmd': { type: 'start', id: 'firefox-arrows-recovery' } });
  await until(async () => !!(await rt()).arrowOut, 25000, 'отказ неподходящих стрел');
  const tries = S.acts.length; await sleep(5500); assert.equal(S.acts.length, tries, 'неизменное состояние повторяет отказ');
  proof.push({ scenario: 'unchanged rejected arrows', attempts: tries, unchangedRetries: S.acts.length - tries });
  S.arrowRows = [{ itemId: 1342, qty: 100 }]; S.arrows = 100; const beforeStock = S.hero.mobsKilled;
  await nativeSnapshot(); await until(() => S.hero.mobsKilled > beforeStock, 22000, '1000 неподходящих→100 подходящих продолжили охоту');
  assert.equal((await rt()).arrowOut, null); proof.push({ scenario: '1000 wrong→100 correct', kills: S.hero.mobsKilled - beforeStock });
  S.weaponId = 287;
  await until(async () => (await rt()).arrowOut?.weaponId === 287, 25000, 'отказ после смены лука');
  const beforeBow = S.hero.mobsKilled; S.weaponId = 286;
  await nativeSnapshot(); await until(() => S.hero.mobsKilled > beforeBow, 25000, 'смена только лука продолжила охоту');
  proof.push({ scenario: 'weapon-only replacement', kills: S.hero.mobsKilled - beforeBow });
  S.arrowRows = [{ itemId: 1343, qty: 50 }];
  await until(async () => !!(await rt()).arrowOut, 25000, 'новый состав отвергнут');
  const tries2 = S.acts.length; await sleep(5500); assert.equal(S.acts.length, tries2, 'новое неизменное состояние повторяет отказ');
  await storage('set', { 'lite.cfg': { ...off, on: false } });
  await until(async () => /■ Стоп/.test(((await rt()).log || []).map(x => x.x).join('\n')), 5000, 'Stop');
  S.arrowRows = [{ itemId: 1342, qty: 30 }]; await nativeSnapshot(); await sleep(1800);
  assert.equal(S.acts.length, tries2, 'Stop пропустил выстрел'); assert.ok((await rt()).arrowOut, 'Stop снял квитанцию фоновым снимком');
  proof.push({ scenario: 'Stop before correct snapshot', shotsAfterStop: S.acts.length - tries2, retainedHold: true });
  assert.deepEqual(pageErrors, []); assert.deepEqual(requestErrors, []);
  const caps = await driver.getCapabilities(), result = { pass: true, browser: caps.get('browserName'), version: caps.get('browserVersion'),
    extension: manifest.version, zipSha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'),
    boundary: 'actual Firefox temporary addon ZIP, real MAIN hook/storage; game API modeled entirely by loopback TLS', proof, pageErrors, requestErrors };
  if (process.env.LITE_FIREFOX_PROOF) fs.writeFileSync(process.env.LITE_FIREFOX_PROOF, JSON.stringify(result, null, 2) + '\n');
  console.log('PASS Lite Firefox arrows recovery: ' + JSON.stringify(result));
})().catch(async e => {
  let status; try { const r = await rt(); status = { status: r.status, arrowOut: r.arrowOut, log: (r.log || []).slice(-12) }; } catch (_) {}
  console.error('FAIL Lite Firefox arrows recovery:', e.stack || e, JSON.stringify({ acts: S.acts.slice(-20), rows: S.arrowRows, weapon: S.weaponId, status, pageErrors, requestErrors })); process.exitCode = 1;
}).finally(async () => {
  if (driver) await driver.quit().catch(() => {});
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(tmp, { recursive: true, force: true });
});

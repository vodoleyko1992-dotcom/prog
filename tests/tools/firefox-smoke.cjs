'use strict';
// 8.0.6: смоук пакета Firefox в настоящем Firefox (headless): дополнение ставится, фоновый скрипт отвечает, базовый профиль
// применился, на подставной странице https://l2wap.com/ работают hook.js (MAIN) и content.js, меню открывается без ошибок.
// --android: те же проверки, но без API, которых нет в Firefox для Android (горячие клавиши, значок, уведомления, снимок экрана).
// FIREFOX=…/firefox GECKODRIVER=…/geckodriver NODE_PATH=…(selenium-webdriver) node tests/tools/firefox-smoke.cjs <пакет-firefox.zip> [--android]
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https'), { execFileSync } = require('child_process');
const { Builder, By, until } = require('selenium-webdriver'), firefox = require('selenium-webdriver/firefox');
const zipIn = path.resolve(process.argv[2]), android = process.argv.includes('--android');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l2ffs-'));
let zip = zipIn;
if (android) {                                       // копия пакета, где фоновый скрипт видит «андроидный» chrome.*
  const d = path.join(tmp, 'pkg'); fs.mkdirSync(d); execFileSync('unzip', ['-q', zipIn, '-d', d]);
  const sim = `try { for (const k of ['commands', 'notifications']) Object.defineProperty(chrome, k, { value: undefined, configurable: true });
  Object.defineProperty(chrome, 'action', { value: {}, configurable: true }); chrome.tabs.captureVisibleTab = undefined; } catch (e) {}
  chrome.storage.local.set({ ffSim: [typeof chrome.commands, typeof chrome.notifications, typeof chrome.action.setBadgeText].join(',') });\n`;
  const bg = path.join(d, 'background.js'); fs.writeFileSync(bg, sim + fs.readFileSync(bg, 'utf8'));
  zip = path.join(tmp, 'android.zip'); execFileSync('zip', ['-qr', zip, '.'], { cwd: d });
}
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=l2wap.com', '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem')], { stdio: 'ignore' });
const page = `<!doctype html><html><head><meta charset="utf-8"><title>L2WAP — Карта</title></head><body><div id="l2-hud-hp-cur">1000</div>
<div id="map-mob-list"><a class="l2-map-mob-link" href="#">Giant Fungus · ур. 40</a></div></body></html>`;
const srv = https.createServer({ key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) },
  (q, r) => { if (/\.(png|jpg|ico)$/.test(q.url)) { r.writeHead(404); return r.end(); }
    if (q.url.startsWith('/game/') || q.url.startsWith('/character')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{}'); }
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(page); });
const UUID = '7d0c2b4e-8f8a-4c1e-9b7a-5a1f2d3c4b5e';
(async () => {
  await new Promise(ok => srv.listen(443, '127.0.0.1', ok));
  const opt = new firefox.Options().addArguments('-headless').setBinary(process.env.FIREFOX);
  for (const [k, v] of Object.entries({ 'network.dns.localDomains': 'l2wap.com', 'network.proxy.type': 0, 'network.dns.disableIPv6': true,
    'extensions.webextensions.uuids': JSON.stringify({ 'l2wap-bot@local': UUID }), 'xpinstall.signatures.required': false })) opt.setPreference(k, v);
  opt.setAcceptInsecureCerts(true);
  const drv = await new Builder().forBrowser('firefox').setFirefoxOptions(opt).setFirefoxService(new firefox.ServiceBuilder(process.env.GECKODRIVER)).build();
  const res = {};
  try {
    await drv.installAddon(zip, true);
    await drv.sleep(2500);
    await drv.get('https://l2wap.com/map.html');
    await drv.sleep(7000);
    res.hook = await drv.executeScript('return !!window.__l2botHook');                       // hook.js в MAIN world
    res.content = await drv.executeScript("return [...document.querySelectorAll('[id^=l2bot]')].map(e => e.id).join(',')");
    // 20.41: Firefox 153 (marionette) не даёт driver.get на moz-extension — переход из страницы (как в v2036-mammon-dock-firefox)
    await drv.executeScript('window.location.href=arguments[0]', `moz-extension://${UUID}/popup.html`);
    await drv.wait(async () => (await drv.getCurrentUrl()).startsWith('moz-extension://'), 15000);
    await drv.sleep(2500);
    Object.assign(res, await drv.executeAsyncScript(`const done = arguments[arguments.length - 1];
      (async () => { const s = await chrome.storage.local.get(['cfg', 'ffSim', 'learn', 'lock']);
        const lock = await chrome.runtime.sendMessage({ cmd: 'lockCheck' }).catch(e => ({ err: String(e) }));
        done({ ver: chrome.runtime.getManifest().version, cfgKeys: Object.keys(s.cfg || {}).length, epicCoin: s.cfg?.epicCoinDailyMax,
          sim: s.ffSim || '', bgReply: lock, popupText: document.body.innerText.length }); })().catch(e => done({ err: String(e) }));`));
    // 20.43 (разбор 21.10): встроенное меню (iframe на странице игры) — в Firefox без chrome.tabs. «Проверить панель» и kick идут
    // через фон только в родительскую вкладку (dockGameCommand); чужая команда не пересылается. Бот выключен: kick = stopped, без запуска.
    await drv.executeAsyncScript(`const done = arguments[arguments.length - 1];
      chrome.storage.local.get('cfg').then(s => chrome.storage.local.set({ on: false, cfg: { ...(s.cfg || {}), dock: true, dockMin: false } })).then(() => done(true), e => done(String(e)));`);
    await drv.get('https://l2wap.com/map.html');
    const dockFrame = await drv.wait(until.elementLocated(By.css('#l2bot-dock iframe')), 20000);
    await drv.switchTo().frame(dockFrame);
    await drv.wait(() => drv.executeScript("return typeof document.getElementById('check')?.onclick === 'function'"), 15000);
    res.dock = await drv.executeAsyncScript(`const done = arguments[arguments.length - 1];
      (async () => { const { rt = {} } = await chrome.storage.local.get('rt'), char = rt.char || '', ask = message => chrome.runtime.sendMessage({ cmd: 'dockGameCommand', char, message });
        const slots = await ask({ cmd: 'slots' }), kick = await ask({ cmd: 'kick' }), foreign = await ask({ cmd: 'lifestoneCommand', action: 'scan', char });
        document.getElementById('check').click(); await new Promise(r => setTimeout(r, 1500));
        done({ tabs: typeof chrome.tabs, slots: slots?.relayed === true && Array.isArray(slots.answer?.panel), kick: kick?.relayed === true ? kick.answer : kick,
          foreign: foreign?.relayed === false, checkText: document.getElementById('slots')?.textContent || '', on: (await chrome.storage.local.get('on')).on }); })().catch(e => done({ err: String(e) }));`);
    await drv.switchTo().defaultContent();
  } finally { await drv.quit(); srv.close(); }
  const ok = res.hook && res.content && res.bgReply && typeof res.bgReply.ok === 'boolean' && res.cfgKeys > 100 && res.epicCoin === 0 && res.popupText > 200
    && (!android || res.sim === 'undefined,undefined,undefined')
    && res.dock?.slots === true && res.dock.kick?.v === res.ver && res.dock.kick.reason === 'stopped' && res.dock.foreign === true && res.dock.on === false
    && !!res.dock.checkText && !/Откройте вкладку/.test(res.dock.checkText);
  console.log((ok ? 'PASS' : 'FAIL') + ` firefox${android ? ' (без API Android)' : ''}: ` + JSON.stringify(res));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL', e); srv.close(); process.exit(1); });

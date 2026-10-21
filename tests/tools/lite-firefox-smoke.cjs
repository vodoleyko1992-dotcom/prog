'use strict';
// Lite 1.2.1 (21.10, John: «нет даже меню вызова, загрузка в фаерфокс ни к чему не приводит»): смоук пакета Lite в настоящем Firefox.
// Дополнение ставится временным, кнопка закреплена на панели (не в меню «Расширения»), hook.js (MAIN) и bot.js работают на
// подставной https://l2wap.com/, фон отвечает (вкладка-хозяин), язычок «Lite» на странице открывает меню во вкладке.
// Lite 1.3 (John: «это сборка под БХ, а нужна под дестра»): герой — Титан (слот 2), панель в памяти помечена классом Титана.
// FIREFOX=…/firefox GECKODRIVER=…/geckodriver NODE_PATH=…(selenium-webdriver) node tests/tools/lite-firefox-smoke.cjs <l2wap-lite-…-firefox.zip>
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https'), { execFileSync } = require('child_process');
const { Builder } = require('selenium-webdriver'), firefox = require('selenium-webdriver/firefox');
const zip = path.resolve(process.argv[2]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liteff-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=l2wap.com', '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem')], { stdio: 'ignore' });
const page = `<!doctype html><html><head><meta charset="utf-8"><title>L2WAP — Карта</title></head><body><div id="l2-hud-legacy-name">Dstr</div>
<div id="map-mob-list"><a class="l2-map-mob-link" href="#">Giant Fungus · ур. 40</a></div>
<script>setTimeout(() => fetch('/character').then(r => r.json()).then(j => { document.title = 'ok ' + j.character.name; }), 3000)</script></body></html>`;
const hero = { name: 'Dstr', level: 76, l2Profession: 'orc_titan', classSlots: { activeSlot: 2, slots: [{ slot: 0, owned: true, profession: 'human_arcana_lord', level: 78 },
  { slot: 1, owned: true, profession: 'dwarf_bounty_hunter', level: 70 }, { slot: 2, owned: true, profession: 'orc_titan', level: 76 }] }, currentZoneId: 'giran_harbor', currentZoneNameUk: 'Гавань Гірана', locationType: 'field',
  battleHotbarSlots: [{ k: 'a', a: 'attack' }, { k: 'a', a: 'l2_190' }], learnedBattleSkillsDetail: [{ battleId: 'l2_190', nameUk: 'Fatal Strike' }] };
const srv = https.createServer({ key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) }, (q, r) => {
  if (/\.(png|jpg|ico)$/.test(q.url)) { r.writeHead(404); return r.end(); }
  if (q.url.startsWith('/character')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify({ character: hero })); }
  if (q.url.startsWith('/game/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{}'); }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(page);
});
const UUID = '7d0c2b4e-8f8a-4c1e-9b7a-5a1f2d3c4b5f';
(async () => {
  await new Promise(ok => srv.listen(443, '127.0.0.1', ok));
  // -remote-allow-system-access: проверка места кнопки на панели браузера (CustomizableUI) из контекста chrome
  const opt = new firefox.Options().addArguments('-headless', '-remote-allow-system-access').setBinary(process.env.FIREFOX);
  for (const [k, v] of Object.entries({ 'network.dns.localDomains': 'l2wap.com', 'network.proxy.type': 0, 'network.dns.disableIPv6': true,
    'extensions.webextensions.uuids': JSON.stringify({ 'l2wap-lite@local': UUID }), 'xpinstall.signatures.required': false })) opt.setPreference(k, v);
  opt.setAcceptInsecureCerts(true);
  const drv = await new Builder().forBrowser('firefox').setFirefoxOptions(opt).setFirefoxService(new firefox.ServiceBuilder(process.env.GECKODRIVER)).build();
  const res = {};
  try {
    res.id = await drv.installAddon(zip, true);
    await drv.sleep(2000);
    await drv.setContext(firefox.Context.CHROME);
    res.toolbar = await drv.executeScript(`const pl = CustomizableUI.getPlacementOfWidget('l2wap-lite_local-browser-action');
      const ext = WebExtensionPolicy.getByID('l2wap-lite@local'); return { area: pl && pl.area, active: !!ext && ext.active };`);
    await drv.setContext(firefox.Context.CONTENT);
    await drv.get('https://l2wap.com/map.html');
    await drv.sleep(6000);
    res.title = await drv.getTitle();
    res.hook = await drv.executeScript('return !!window.__l2liteHook');                       // hook.js в MAIN world
    res.pill = await drv.executeScript("const h = document.getElementById('l2lite-pill'); return h && h.shadowRoot ? h.shadowRoot.querySelector('div').textContent : null");
    const game = await drv.getWindowHandle();
    await drv.executeScript("document.getElementById('l2lite-pill').shadowRoot.querySelector('div').click()");
    await drv.sleep(2500);
    for (const h of await drv.getAllWindowHandles()) { if (h === game) continue; await drv.switchTo().window(h); res.menuUrl = await drv.getCurrentUrl(); break; }
    if (res.menuUrl) Object.assign(res, await drv.executeAsyncScript(`const done = arguments[arguments.length - 1];
      (async () => { const s = await chrome.storage.local.get('lite.rt'), rt = s['lite.rt'] || {};
        done({ ver: chrome.runtime.getManifest().version, status: rt.status, char: rt.char, bar: (rt.bar || []).map(x => x.a), barCls: rt.barCls,
          warn: document.getElementById('cls').hidden ? '' : document.getElementById('cls').textContent, skills: document.querySelectorAll('#skills .sk').length,
          tabClass: document.documentElement.className, run: !!document.getElementById('run') }); })().catch(e => done({ err: String(e) }));`));
  } catch (e) { res.error = String(e && e.message || e).slice(0, 300); }
  finally { await drv.quit(); srv.close(); }
  const ok = res.toolbar && res.toolbar.active && res.toolbar.area === 'nav-bar' && res.hook && res.title === 'ok Dstr' && res.pill === 'Lite'
    && /^moz-extension:\/\/.+\/popup\.html#tab$/.test(res.menuUrl || '') && res.tabClass === 'tab' && res.run
    && res.status === 'Выключен' && res.char && res.char.name === 'Dstr' && res.char.prof === 'orc_titan' && res.char.slot === 2 && res.bar.includes('l2_190')
    && res.barCls === 'orc_titan' && res.warn === '' && res.skills === 1;
  console.log((ok ? 'PASS' : 'FAIL') + ' lite firefox: ' + JSON.stringify(res));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL', e); srv.close(); process.exit(1); });

'use strict';
// Lite 1.2.1 (21.10, John: «нет даже меню вызова, загрузка в фаерфокс ни к чему не приводит»): смоук пакета Lite в настоящем Firefox.
// Дополнение ставится временным, кнопка закреплена на панели (не в меню «Расширения»), hook.js (MAIN) и bot.js работают на
// подставной https://l2wap.com/, фон отвечает (вкладка-хозяин), язычок «Lite» на странице открывает меню во вкладке.
// Lite 1.3 (John: «это сборка под БХ, а нужна под дестра»): герой — Титан (слот 2), панель в памяти помечена классом Титана.
// Lite 1.4: вместо язычка — окно меню на странице (iframe moz-extension://…/popup.html#dock), «—» → плавающая кнопка «Lite»,
// нажатие — окно снова; «⧉» в шапке открывает меню во вкладке.
// Lite 1.5 (John: «есть сабкласс Лука», «отдельный профиль на дестра, отдельный профиль на лука»): герой — Phantom Ranger (слот 3,
// Титан — слот 2), выстрелы под именем игры, стрелы в сумке; в меню открыт профиль «Лук · в игре», стрелы, скиллы лука.
// FIREFOX=…/firefox GECKODRIVER=…/geckodriver NODE_PATH=…(selenium-webdriver) node tests/tools/lite-firefox-smoke.cjs <l2wap-lite-…-firefox.zip>
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https'), { execFileSync } = require('child_process');
const { Builder } = require('selenium-webdriver'), firefox = require('selenium-webdriver/firefox');
const zip = path.resolve(process.argv[2]), android = process.argv.includes('--android');
const expectedVersion = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' })).version;
const requests = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liteff-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=l2wap.com', '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem')], { stdio: 'ignore' });
const page = `<!doctype html><html><head><meta charset="utf-8"><title>L2WAP — Карта</title></head><body><div id="l2-hud-legacy-name">Dstr</div>
<div id="map-mob-list"><a class="l2-map-mob-link" href="#">Giant Fungus · ур. 40</a></div>
<script>setTimeout(() => fetch('/character').then(r => r.json()).then(j => { document.title = 'ok ' + j.character.name; }), 3000)</script></body></html>`;
const hero = { name: 'Dstr', level: 70, l2Profession: 'dark_elf_phantom_ranger', classSlots: { activeSlot: 3, slots: [{ slot: 0, owned: true, profession: 'dark_elf_storm_screamer', level: 78 },
  { slot: 1, owned: true, profession: 'dark_elf_spectral_master', level: 76 }, { slot: 2, owned: true, profession: 'orc_titan', level: 77 }, { slot: 3, owned: true, profession: 'dark_elf_phantom_ranger', level: 70 }] },
  currentZoneId: 'giran_harbor', currentZoneNameUk: 'Гавань Гірана', locationType: 'field', inventory: { stacks: [{ itemId: 1342, qty: 221 }, { itemId: 728, qty: 9 }] },
  battleHotbarSlots: [{ k: 'a', a: 'attack' }, { k: 'a', a: 'double_shot' }, { k: 'a', a: 'power_shot' }], learnedBattleSkillsDetail: [{ battleId: 'double_shot', nameUk: 'Double Shot' }, { battleId: 'power_shot', nameUk: 'Power Shot' }] };
const srv = https.createServer({ key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) }, (q, r) => {
  requests.push({ method: q.method, path: q.url });
  if (/\.(png|jpg|ico)$/.test(q.url)) { r.writeHead(404); return r.end(); }
  if (q.url.startsWith('/character')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify({ character: hero })); }
  if (q.url.startsWith('/game/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{}'); }
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(page);
});
const UUID = '7d0c2b4e-8f8a-4c1e-9b7a-5a1f2d3c4b5f';
(async () => {
  await new Promise(ok => srv.listen(443, '127.0.0.1', ok));
  // geckodriver --allow-system-access: проверка места кнопки на панели браузера из контекста chrome.
  const opt = new firefox.Options().addArguments('-headless', '--window-size=1280,800').setBinary(process.env.FIREFOX);
  for (const [k, v] of Object.entries({ 'network.dns.localDomains': 'l2wap.com', 'network.proxy.type': 0, 'network.dns.disableIPv6': true,
    'extensions.webextensions.uuids': JSON.stringify({ 'l2wap-lite@local': UUID }), 'xpinstall.signatures.required': false })) opt.setPreference(k, v);
  // Это настольный Firefox с Android UA/узким окном: пакет тот же, настоящий Android этим не проверяется.
  if (android) opt.setPreference('general.useragent.override', 'Mozilla/5.0 (Android 14; Mobile; rv:153.0) Gecko/153.0 Firefox/153.0');
  opt.setAcceptInsecureCerts(true);
  const service = new firefox.ServiceBuilder(process.env.GECKODRIVER).addArguments('--allow-system-access');
  const drv = await new Builder().forBrowser('firefox').setFirefoxOptions(opt).setFirefoxService(service).build();
  const res = { mode: android ? 'desktop Firefox with Android UA/narrow viewport (not a device)' : 'desktop Firefox' };
  try {
    await drv.manage().window().setRect({ width: android ? 390 : 1280, height: android ? 844 : 800, x: 0, y: 0 });
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
    // 1.4: окно меню на странице игры — открыто (широкий экран), меню в iframe загрузилось и ответило «готово»
    const sh = "const r = document.getElementById('l2lite-dock')?.shadowRoot; ";
    res.viewport = await drv.executeScript('return { width: innerWidth, height: innerHeight, ua: navigator.userAgent }');
    res.initialDock = await drv.executeScript(sh + "return r ? { win: !r.querySelector('.win').hidden, fab: !r.querySelector('.fab').hidden } : null");
    if (android) {
      await drv.executeScript(sh + "r.querySelector('.fab').dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }))");
      await drv.wait(() => drv.executeScript(sh + "return !!r.querySelector('iframe') && !r.querySelector('.win').hidden"), 10000);
      await drv.sleep(1500);
    }
    res.dock = await drv.executeScript(sh + "return r ? { win: !r.querySelector('.win').hidden, fab: !r.querySelector('.fab').hidden, fail: !r.querySelector('.fail').hidden, frame: r.querySelector('iframe')?.src || null } : null");
    const frame = await drv.executeScript(sh + "return r.querySelector('iframe')");
    await drv.switchTo().frame(frame);
    res.dockMenu = await drv.executeAsyncScript(`const done = arguments[arguments.length - 1];
      (async () => { const s = await chrome.storage.local.get('lite.rt'); done({ cls: document.documentElement.className, run: !!document.getElementById('run').onclick, hero: document.getElementById('hero').textContent, haveRt: !!s['lite.rt'] }); })().catch(e => done({ err: String(e) }));`);
    await drv.switchTo().defaultContent();
    await drv.sleep(4000);                                                                     // > 8 с с создания окна
    res.failLater = await drv.executeScript(sh + "return !r.querySelector('.fail').hidden");
    // «—» → плавающая кнопка «Lite» (меню выгружено), нажатие — окно снова
    await drv.executeScript(sh + "r.querySelector('.min').click()"); await drv.sleep(500);
    res.fab = await drv.executeScript(sh + "return { win: !r.querySelector('.win').hidden, fab: !r.querySelector('.fab').hidden, text: r.querySelector('.fab').textContent, frame: !!r.querySelector('iframe'), mem: localStorage.getItem('l2lite-dock') }");
    await drv.executeScript(sh + "const f = r.querySelector('.fab'), b = f.getBoundingClientRect(), o = { bubbles: true, composed: true, button: 0, pointerId: 1, isPrimary: true, clientX: b.left + 5, clientY: b.top + 5 }; f.dispatchEvent(new PointerEvent('pointerdown', o)); f.dispatchEvent(new PointerEvent('pointerup', o))");
    await drv.sleep(1500);
    res.reopen = await drv.executeScript(sh + "return { win: !r.querySelector('.win').hidden, frame: !!r.querySelector('iframe') }");
    const game = await drv.getWindowHandle();
    await drv.executeScript(sh + "r.querySelector('.tab').click()");                           // «⧉» — меню отдельной вкладкой
    await drv.sleep(2500);
    for (const h of await drv.getAllWindowHandles()) { if (h === game) continue; await drv.switchTo().window(h); res.menuUrl = await drv.getCurrentUrl(); break; }
    if (res.menuUrl) Object.assign(res, await drv.executeAsyncScript(`const done = arguments[arguments.length - 1];
      (async () => { const s = await chrome.storage.local.get('lite.rt'), rt = s['lite.rt'] || {};
        done({ ver: chrome.runtime.getManifest().version, status: rt.status, char: rt.char, bar: (rt.bar || []).map(x => x.a), barCls: rt.barCls, kind: rt.kind,
          warn: document.getElementById('cls').hidden ? '' : document.getElementById('cls').textContent, skills: [...document.querySelectorAll('#skills .sk')].map(e => [e.dataset.key, e.querySelector('input').checked]),
          profs: [...document.querySelectorAll('#profs button')].map(b => b.dataset.kind + (b.classList.contains('sel') ? '*' : '') + b.querySelector('i').textContent),
          arw: document.getElementById('arw').hidden ? '' : document.getElementById('arw').textContent,
          tabClass: document.documentElement.className, run: !!document.getElementById('run') }); })().catch(e => done({ err: String(e) }));`));
    // Профили записываются раздельно через настоящее меню. MAIN-контекст игры получит локальную CAPTCHA перед Стартом:
    // проверяем путь menu→storage→background owner→bot без боёв и без POST, затем настоящий Stop.
    if (res.menuUrl) {
      const menu = await drv.getWindowHandle();
      res.profileEdit = await drv.executeAsyncScript(`const done=arguments[arguments.length-1];
        (async()=>{const pause=()=>new Promise(r=>setTimeout(r,350));
          document.querySelector('#profs [data-kind="destr"]').click();document.getElementById('limit').value='4';document.getElementById('limit').dispatchEvent(new Event('change'));await pause();
          document.querySelector('#profs [data-kind="archer"]').click();document.getElementById('limit').value='3';document.getElementById('limit').dispatchEvent(new Event('change'));await pause();
          const c=(await chrome.storage.local.get('lite.cfg'))['lite.cfg'];done({destr:c.p.destr.killLimit,archer:c.p.archer.killLimit});})().catch(e=>done({err:String(e)}));`);
      await drv.switchTo().window(game);
      await drv.executeScript(`const x=document.createElement('div');x.id='l2-antibot-layer';x.innerHTML='<div class="l2-antibot-card__options">Перевірка: символи</div>';document.body.appendChild(x);`);
      await drv.switchTo().window(menu);
      await drv.executeScript("document.getElementById('run').click()");
      await drv.wait(() => drv.executeAsyncScript(`const done=arguments[arguments.length-1];chrome.storage.local.get(['lite.cfg','lite.rt']).then(s=>done(!!s['lite.cfg']?.on&&/КАПЧА/.test(s['lite.rt']?.status||'')));`), 12000);
      res.started = await drv.executeAsyncScript(`const done=arguments[arguments.length-1];(async()=>{const s=await chrome.storage.local.get(['lite.cfg','lite.rt']);const o=await chrome.storage.session.get('lite.owner');done({on:s['lite.cfg'].on,status:s['lite.rt'].status,owner:!!o['lite.owner'],log:(s['lite.rt'].log||[]).some(x=>x.x.includes('▶ Старт'))});})().catch(e=>done({err:String(e)}));`);
      await drv.executeScript("document.getElementById('run').click()");
      await drv.wait(() => drv.executeAsyncScript(`const done=arguments[arguments.length-1];chrome.storage.local.get(['lite.cfg','lite.rt']).then(s=>done(s['lite.cfg']?.on===false&&s['lite.rt']?.status==='Выключен'));`), 10000);
      res.stopped = await drv.executeAsyncScript(`const done=arguments[arguments.length-1];chrome.storage.local.get(['lite.cfg','lite.rt']).then(s=>done({on:s['lite.cfg'].on,status:s['lite.rt'].status,log:(s['lite.rt'].log||[]).some(x=>x.x==='■ Стоп')}));`);
    }
  } catch (e) { res.error = String(e && e.message || e).slice(0, 300); }
  finally { await drv.quit(); srv.close(); }
  res.posts = requests.filter(q => q.method !== 'GET' && q.method !== 'HEAD');
  const ok = res.toolbar && res.toolbar.active && res.toolbar.area === 'nav-bar' && res.hook && res.title === 'ok Dstr' && res.ver === expectedVersion
    && res.dock && res.dock.win && !res.dock.fab && !res.dock.fail && /^moz-extension:\/\/.+\/popup\.html#dock$/.test(res.dock.frame || '')
    && res.dockMenu && res.dockMenu.cls === 'dock' && res.dockMenu.run && res.dockMenu.haveRt && res.failLater === false
    && res.fab && !res.fab.win && res.fab.fab && res.fab.text === 'Lite' && !res.fab.frame && JSON.parse(res.fab.mem || '{}').open === false
    && res.reopen && res.reopen.win && res.reopen.frame
    && /^moz-extension:\/\/.+\/popup\.html#tab$/.test(res.menuUrl || '') && res.tabClass === 'tab' && res.run
    && res.status === 'Выключен' && res.char && res.char.name === 'Dstr' && res.char.prof === 'dark_elf_phantom_ranger' && res.char.slot === 3 && res.bar.includes('double_shot')
    && res.barCls === 'dark_elf_phantom_ranger' && res.kind === 'archer' && res.warn === ''
    && JSON.stringify(res.skills) === JSON.stringify([['double_shot', true], ['power_shot', true]])
    && JSON.stringify(res.profs) === JSON.stringify(['destr', 'archer* · в игре', 'spoil'])   /* 1.6: третья вкладка — спойлер */ && res.arw === 'Стрелы: Fine Steel (C) 221'
    && res.profileEdit?.destr === 4 && res.profileEdit?.archer === 3
    && res.started?.on === true && res.started.owner && res.started.log && /КАПЧА/.test(res.started.status)
    && res.stopped?.on === false && res.stopped.status === 'Выключен' && res.stopped.log && res.posts.length === 0
    && (!android || res.viewport.width < 900 && /Android/.test(res.viewport.ua) && !res.initialDock.win && res.initialDock.fab);
  console.log((ok ? 'PASS' : 'FAIL') + ` lite firefox${android ? ' Android UA/narrow emulation' : ' desktop'}: ` + JSON.stringify(res));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL', e); srv.close(); process.exit(1); });

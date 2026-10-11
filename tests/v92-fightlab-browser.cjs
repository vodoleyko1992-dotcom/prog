'use strict';
// 9.2 анализатор боя: браузерный смоук (node tests/v92-fightlab-browser.cjs; CHROMIUM=…). Настоящие hook.js и скрипты расширения на
// подставной https://l2wap.com/battle.html: страница сама шлёт POST /game/battle/start и два хода (ответы — в формате игры: kind 'delta',
// `kind:'full'` с полным battle.log, victory) → hook отдаёт поле bt, анализатор пишет ходы (имя скилла по слоту панели), память на цель rt.fightMem
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const mf = JSON.parse(read('manifest.json')), scripts = mf.content_scripts.find(e => e.js.includes('content.js')).js;
const coreMock = `(() => { const data = { on: false, cfg: { rec: false, autoLearn: false }, rt: { char: 'Warlock', classCur: { prof: 'human_warlock' } } };
  window.chrome = { runtime: { id: 'mock', lastError: null, getManifest: () => ({ version: '${mf.version}' }), getURL: p => 'https://l2wap.com/__ext/' + (p || ''), onMessage: { addListener() {} },
    sendMessage(msg, cb) { let reply = null; if (msg.cmd === 'tabId') reply = 3; if (msg.cmd === 'statePatch') { Object.assign(data.rt, msg.patch || {}); Object.assign(data.cfg, msg.cfgPatch || {}); reply = { ok: true }; }
      if (typeof cb === 'function') { queueMicrotask(() => cb(reply)); return; } return Promise.resolve(reply); } },
    storage: { onChanged: { addListener() {} }, local: { get: async keys => Object.fromEntries([].concat(keys).map(k => [k, data[k]])), set: async v => Object.assign(data, v) } } };
  window.__data = data; })();`;
const PAGE = `<html><body><div id="l2-hud-legacy-name"><span class="l2-player-identity__nick">Warlock</span></div>
  <div id="battle-mob-title">Banshee · ур. 63</div>
  <div class="l2-battle-hotbar"><button class="l2-battle-hotbar-slot" data-slot-cd="l2_1274" title="Energy Bolt"></button><button class="l2-battle-hotbar-slot" data-slot-cd="l2_1220" title="Blaze"></button></div></body></html>`;
const filler = Array.from({ length: 10 }, (_, i) => `Charcoal ×${i + 1}`);
const RESP = {
  '/game/battle/start': { kind: 'full', battle: { spawnId: 'dense_26917', mobName: 'Banshee', mobLevel: 63, mobHp: 3060, mobMaxHp: 3060, kind: 'normal', logSeq: 1, log: ['Бой начат: Banshee (ур. 63)'] }, character: { hp: 5417, maxHp: 5417, mp: 4298, maxMp: 4298 } },
  // ответы хода — как у игры 12.10 (225 из 242 — `kind:'full'` с ПОЛНЫМ battle.log): анализатор считает строки один раз
  a1: { kind: 'full', revision: 2, battle: { spawnId: 'dense_26917', mobName: 'Banshee', mobLevel: 63, mobHp: 120, mobMaxHp: 3060, kind: 'normal',
    log: ['Бой начат: Banshee (ур. 63)', ...filler, '[Banshee] ударив тебе −12 HP.', 'Енергетична блискавка 2940'] }, character: { hp: 5405, maxHp: 5417, mp: 4283, maxMp: 4298 } },
  a2: { kind: 'full', revision: 3, battle: { spawnId: 'dense_26917', mobName: 'Banshee', mobLevel: 63, mobHp: 0, mobMaxHp: 3060, kind: 'normal',
    log: [...filler, '[Banshee] ударив тебе −12 HP.', 'Енергетична блискавка 2940', 'Полум’я 3585', 'Победа!'] }, character: { hp: 5417, maxHp: 5417, mp: 4253, maxMp: 4298 }, victory: { fullLog: [] } },
};
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage(); const errors = []; p.on('pageerror', e => errors.push(String(e)));
  let n = 0;
  await p.route('https://l2wap.com/**', async r => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith('/__ext/')) return r.fulfill({ status: 200, contentType: 'application/json', body: read(u.pathname.slice(7)) });
    if (u.pathname === '/game/battle/start') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESP[u.pathname]) });
    if (u.pathname === '/game/battle/action') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(++n === 1 ? RESP.a1 : RESP.a2) });
    if (u.pathname.startsWith('/game/') || u.pathname === '/character') return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return r.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
  });
  await p.goto('https://l2wap.com/battle.html?spawnId=dense_26917');
  await p.evaluate(coreMock);
  await p.addScriptTag({ content: read('hook.js') });
  for (const s of scripts) await p.addScriptTag({ content: read(s) });
  const res = await p.evaluate(async () => {
    tabOwner = true; leaseEpoch = 'e';
    const post = (u, body) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    const wait = ms => new Promise(r => setTimeout(r, ms));
    await post('/game/battle/start', { spawnId: 'dense_26917' }); await wait(150);
    await post('/game/battle/action', { action: 'l2_1274', expectedRevision: 1, battleSpawnId: 'dense_26917' }); await wait(150);
    const t1 = L2V7Modules.fightlab.turnFor('Energy Bolt', Date.now() - 2000);
    await post('/game/battle/action', { action: 'l2_1220', expectedRevision: 2, battleSpawnId: 'dense_26917' }); await wait(300);
    return { t1, sum: L2V7Modules.fightlab.lastSum(), mem: rt.fightMem, stored: window.__data.rt.fightMem };
  });
  const m = res.mem?.['m:banshee'];
  const ok = res.t1?.own === 2940 && res.t1?.name === 'energy bolt' && res.t1?.hitIn === 12 && res.t1?.mpd === 15
    && res.sum?.outcome === 'win' && res.sum?.turns === 2 && res.sum?.dealt === 2940 + 3585
    && m?.n === 1 && m?.w === 1 && m?.hp === 3060 && m?.a?.blaze?.s?.[0] === 3585 && m?.h?.[0] === 12
    && res.stored?.['m:banshee']?.n === 1 && !errors.length;
  if (!ok) { console.error('FAIL', JSON.stringify({ res, errors })); process.exit(1); }
  console.log('PASS browser: real hook.js → bt (full battle.log kept whole, counted once), turn by turn: Energy Bolt 2940 exact (slot name), hit −12, MP −15; victory → rt.fightMem «Banshee» saved via statePatch');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });

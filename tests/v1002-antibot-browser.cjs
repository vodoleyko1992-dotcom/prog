'use strict';
// 10.0.2 (скрин админки игры 12.10 13:22: «CAPTCHA активна · підозрілих спроб після неї: 0/10»): браузерный смоук с НАСТОЯЩИМ battle-antibot.js
// игры (берётся с l2wap.com; нет сети — пропуск). Игра считает «подозрительной попыткой» любой клик по странице, пока висит проверка
// (POST /game/antibot/activity), 10 — блок фарма. Проверяем: 1) ответ боя «anti_bot_challenge» → rt.abChal, бот не кликает (fire → false)
// и ни одного своего запроса к игре (gameGet → 423 без сети); 0 запросов /game/antibot/activity; 2) окно пропало (перезагрузка) — бот
// всё равно ждёт; 3) «passed: true» на /game/antibot/challenge → бот снова кликает
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const mf = JSON.parse(read('manifest.json')), scripts = mf.content_scripts.find(e => e.js.includes('content.js')).js;
async function gameJs(f) { try { const r = await fetch('https://l2wap.com/' + f); return r.ok ? await r.text() : null; } catch (e) { return null; } }
const coreMock = `(() => { const data = { on: false, cfg: { rec: false, autoLearn: false }, rt: { char: 'Warlock' } };
  window.chrome = { runtime: { id: 'mock', lastError: null, getManifest: () => ({ version: '${mf.version}' }), getURL: p => 'https://l2wap.com/__ext/' + (p || ''), onMessage: { addListener() {} },
    sendMessage(msg, cb) { let reply = null; if (msg.cmd === 'tabId') reply = 3; if (msg.cmd === 'statePatch') { Object.assign(data.rt, msg.patch || {}); reply = { ok: true }; }
      if (typeof cb === 'function') { queueMicrotask(() => cb(reply)); return; } return Promise.resolve(reply); } },
    storage: { onChanged: { addListener() {} }, local: { get: async keys => Object.fromEntries([].concat(keys).map(k => [k, data[k]])), set: async v => Object.assign(data, v) } } };
  localStorage.setItem('token', 'tok-123'); window.__native = window.fetch.bind(window); window.L2 = { authFetch: (u, o) => window.__native(u, o) }; })();`;
const CHAL = { error: 'anti_bot_challenge', code: 'anti_bot_challenge', challenge: { id: 'ch-1', characterId: 'me', promptSymbols: ['★', '●'], options: ['★', '●', '▲', '■', '◆', '✚'] } };
const PAGE = `<html><body><div id="l2-hud-legacy-name"><span class="l2-player-identity__nick">Warlock</span></div>
  <button class="l2-battle-hotbar-slot" data-slot-cd="l2_1220" onclick="window.__hits=(window.__hits||0)+1">Blaze</button></body></html>`;
(async () => {
  const aj = await gameJs('battle-antibot.js');
  if (!aj) { console.log('SKIP: game JS (battle-antibot.js) unavailable — no network'); return; }
  const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage(); const errors = [], hits = []; p.on('pageerror', e => errors.push(String(e)));
  await p.route('https://l2wap.com/**', async r => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith('/__ext/')) return r.fulfill({ status: 200, contentType: 'application/json', body: read(u.pathname.slice(7)) });
    hits.push(u.pathname);
    if (u.pathname === '/game/battle/action') return r.fulfill({ status: 423, contentType: 'application/json', body: JSON.stringify(CHAL) });
    if (u.pathname === '/game/antibot/activity') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    if (u.pathname === '/game/antibot/challenge') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ passed: true }) });
    if (u.pathname === '/game/time') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"t":1}' });
    return r.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
  });
  await p.goto('https://l2wap.com/battle.html');
  await p.evaluate(coreMock);
  await p.addScriptTag({ content: read('hook.js') });
  await p.evaluate(() => { window.__hook = window.fetch; });       // fetch страницы (через hook.js) — так ходит игра
  await p.addScriptTag({ content: aj });
  for (const s of scripts) await p.addScriptTag({ content: read(s) });
  const res = await p.evaluate(async () => {
    on = true; tabOwner = true; leaseEpoch = 'e';
    const wait = async f => { for (let i = 0; i < 60 && !f(); i++) await new Promise(r => setTimeout(r, 50)); return f(); };
    const slot = document.querySelector('.l2-battle-hotbar-slot');
    const before = fire(slot), hits0 = window.__hits || 0;
    const r = await window.__hook('/game/battle/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"l2_1220"}' });
    window.L2BattleAntiBot.handleErrorBody(await r.clone().json());   // как battle-action-dispatch игры
    await wait(() => rt.abChal);
    const layer = !!document.querySelector('#l2-antibot-layer .l2-antibot-card__options');
    const st1 = antibotState(), f1 = fire(slot), f2 = fire(document.body);
    const g = await gameGet('/game/time');
    await new Promise(r => setTimeout(r, 400));
    document.querySelector('#l2-antibot-layer').textContent = '';     // как после перезагрузки страницы: окна нет, проверка на сервере висит
    const st2 = antibotState(), f3 = fire(slot);
    await window.__hook('/game/antibot/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"selectedSymbols":["★","●"]}' });
    await wait(() => !rt.abChal); window.L2BattleAntiBot.clear();      // игра у себя тоже снимает проверку
    const st3 = antibotState(), f4 = fire(slot);
    return { before, hits0, layer, abChal: !!rt.abChal, st1, f1, f2, g: g.status, st2, f3, st3, f4, hits: window.__hits || 0 };
  });
  const act = hits.filter(x => x === '/game/antibot/activity').length, time = hits.filter(x => x === '/game/time').length;
  const ok = res.before === true && res.hits0 === 1 && res.layer && res.st1 === 'check' && res.f1 === false && res.f2 === false && res.g === 423
    && res.st2 === 'check' && res.f3 === false && res.st3 === null && res.f4 === true && res.hits === 2 && act === 0 && time === 0 && !errors.length;
  if (!ok) { console.error('FAIL', JSON.stringify({ res, hits, errors })); process.exit(1); }
  console.log('PASS browser: real battle-antibot.js — anti_bot_challenge → bot frozen (no clicks, own GET refused, 0 POST /game/antibot/activity), waits after the window is gone, resumes on passed:true');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });

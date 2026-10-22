'use strict';
// Lite 1.5.2 (22.10): настоящее MV3 расширение, локальная модель. Все HTTPS игры перехвачены; живого аккаунта нет.
// Используем прежние HTML/сервер/launch без запуска исторических A–G и без правки общего fixture.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict');
const filename = path.join(__dirname, 'lite-browser.cjs'), src = fs.readFileSync(filename, 'utf8');
const fixture = new Module(filename, module); fixture.filename = filename; fixture.paths = module.paths;
fixture._compile(src.slice(0, src.indexOf('// LITE_ONLY=AC')) + '\nmodule.exports={launch,until,delay,archerOf};', filename);
const { launch, until, delay, archerOf } = fixture.exports;
(async () => {
  const h = await launch(), { S } = h;
  try {
    await h.ctx.route(/^https?:\/\//, route => new URL(route.request().url()).hostname === 'l2wap.com' ? route.fallback() : route.abort());
    Object.assign(S.hero, archerOf());
    S.champAt = 99999; S.arrows = 1000; S.weaponId = 286; S.arrowRows = [{ itemId: 1341, qty: 1000 }];
    const api = h.sv.api;
    h.sv.api = async (p, m, body) => {
      const isShot = p === '/game/battle/action' && /^(attack|double_shot|power_shot|stun_shot)$/.test(body.action || '');
      const goodId = S.weaponId === 286 ? 1342 : 1341;
      const row = S.arrowRows.find(x => x.itemId === goodId), good = !!row && row.qty > 0;
      const prev = S.arrows;
      if (isShot) S.arrows = good ? row.qty : 0;
      const r = await api(p, m, body);
      if (isShot) { if (good) row.qty = S.arrows; else S.arrows = prev; }
      if (r[1]?.character) r[1].character.inventory = { stacks: S.arrowRows.filter(x => x.qty > 0).map(x => ({ ...x })), eq: { l1: { itemId: S.weaponId, ignoredSecret: 'not-forwarded' } } };
      return r;
    };
    const off = { on: false, p: { archer: { zone: 'giran_harbor', zoneName: 'Гавань Гірана', killLimit: 0, tvt: false,
      skills: Object.fromEntries(S.hero.battleHotbarSlots.filter(s => s.a !== 'attack').map(s => [s.a, { on: false }])) } } };
    await h.sw.evaluate(c => chrome.storage.local.set({ 'lite.cfg': c }), off);
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).kind === 'archer', 15000, 'профиль лука');
    await h.sw.evaluate(c => chrome.storage.local.set({ 'lite.cfg': { ...c, on: true }, 'lite.cmd': { type: 'start', id: 'arrows-recovery-start' } }), off);
    await until(async () => !!(await h.rt()).arrowOut, 25000, 'серверный отказ неподходящих стрел');
    const tries = S.acts.length;
    await delay(5500);
    assert.equal(S.acts.length, tries, 'неизменное состояние повторило отказ');
    S.arrowRows = [{ itemId: 1342, qty: 100 }]; S.arrows = 100;
    await h.game.evaluate(() => ch());
    const k0 = S.hero.mobsKilled;
    await until(() => S.hero.mobsKilled > k0, 22000, 'замена1000 неподходящих на100 подходящих продолжила охоту');
    assert.equal((await h.rt()).arrowOut, null);
    // Те же стрелы, но неподходящий лук: новый отказ. Исправляем только weaponId, сумму/состав не увеличиваем.
    S.weaponId = 287;
    await until(async () => (await h.rt()).arrowOut?.weaponId === 287, 25000, 'подтверждённый отказ после смены лука');
    const beforeWeapon = S.hero.mobsKilled, hold = (await h.rt()).arrowOut;
    assert.equal(hold.weaponId, 287);
    S.weaponId = 286;
    await h.game.evaluate(() => ch());
    await until(() => S.hero.mobsKilled > beforeWeapon, 25000, 'замена только лука продолжила охоту');
    // Повторный отказ нового состояния снова устойчив. Stop и последующий снимок не запускают выстрел.
    S.arrowRows = [{ itemId: 1343, qty: 50 }];
    await until(async () => !!(await h.rt()).arrowOut, 25000, 'отказ нового состава');
    const tries2 = S.acts.length;
    await delay(5500);
    assert.equal(S.acts.length, tries2, 'новое неподходящее состояние повторяет отказ');
    await h.sw.evaluate(c => chrome.storage.local.set({ 'lite.cfg': { ...c, on: false } }), off);
    await until(async () => /■ Стоп/.test(((await h.rt()).log || []).map(x => x.x).join('\n')), 5000, 'Stop');
    S.arrowRows = [{ itemId: 1342, qty: 30 }];
    await h.game.evaluate(() => ch());
    await delay(1800);
    assert.equal(S.acts.length, tries2, 'Stop пропустил выстрел');
    assert.ok((await h.rt()).arrowOut, 'Stop снял квитанцию по фоновому снимку');
    assert.deepEqual(h.errors, []);
    console.log('PASS Lite MV3: unchanged→no retry;1000wrong→100correct→hunt;weapon-only→hunt;repeated rejection→hold;Stop→0POST;0JS');
  } catch (e) { console.error('DIAG', { url: h.game.url(), acts: S.acts.slice(-20), rows: S.arrowRows, weapon: S.weaponId, rt: await h.rt(), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

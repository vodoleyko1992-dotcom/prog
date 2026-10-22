'use strict';
// 20.46: настоящее MV3/main/hook. GET /character с inventory.eq.l1 опровергает старую пику до боя и после reload.
// Все HTTPS-ответы локальные; HTTP-запросы к аккаунту/игре не уходят.
const assert = require('node:assert/strict');
const { harness, until, delay } = require('./v1014-core-lifecycle-browser.cjs');

async function scenario(mode) {
  const h = await harness(), actions = [], routeErrors = [];
  let mp = 500, ended = false, stopped = false;
  const hand = mode === 'stale' || mode === 'reload-stale' ? 164 : 299;
  const character = () => ({ name: 'AuditHero', level: 48, l2Profession: 'human_warlord', classBranch: 'fighter', classSlots: { activeSlot: 0 },
    revision: 100 + actions.length, hp: 6195, maxHp: 6195, mp, maxMp: 874, inBattle: !ended, inventory: { eq: { l1: { itemId: hand, enchant: 0 } } } });
  const battle = () => ({ spawnId: 'fixture', mobName: 'Garden Guard', mobHp: ended ? 0 : 458, mobMaxHp: 2484, mobLevel: 48, kind: 'normal',
    log: ended ? ['Победа!'] : actions.includes('provoke') ? ['Провокація (Provoke): агро Garden Guard; −10% опору до списів, 10 с.'] : [] });
  const page = `<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">48</div>
    <div id="character-profession">Warlord</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">6195</span><span id="l2-hud-hp-max">6195</span>
    <span id="l2-hud-mp-cur">500</span><span id="l2-hud-mp-max">874</span><div id="battle-mob-title">Garden Guard · ур.48</div><div id="battle-mob-hp-val">458 / 2484</div>
    <button class="l2-battle-hotbar-slot" title="Провокація масова" id="pull" disabled><span data-slot-cd="provoke" hidden></span></button>
    <button class="l2-battle-hotbar-slot" title="Звіриний рев" id="howl" disabled><span data-slot-cd="howl" hidden></span></button>
    <button class="l2-battle-hotbar-slot" title="Вихор" id="aoe" disabled><span data-slot-cd="whirlwind" hidden></span></button>
    <button class="l2-battle-hotbar-slot" title="Атака" id="attack" disabled><span data-slot-cd="attack" hidden></span></button>
    <div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>
    fetch('/character'); fetch('/game/battle');
    for (const [id, action] of [['pull','provoke'],['howl','howl'],['aoe','whirlwind'],['attack','attack']]) document.getElementById(id).onclick = async () => {
      const res = await fetch('/game/battle/action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,battleSpawnId:'fixture'}) });
      const data = await res.json(); document.getElementById('l2-hud-mp-cur').textContent = data.character.mp;
      document.getElementById('battle-log').textContent = data.battle.log.join(' ');
      if (data.victory) { document.getElementById('battle-mob-hp-val').textContent = '0 / 2484'; document.getElementById('battle-victory-inline').hidden = false; }
    };</script>`;
  try {
    await h.sw.evaluate(async () => {
      const { cfg, rt } = await chrome.storage.local.get(['cfg', 'rt']);
      await chrome.storage.local.set({ on: false, cfg: { ...cfg, autoTasks: ['farm'], taskOnly: false, warlordAggro: true, autoMagister: false,
        zoneAuto: false, catMode: false, chain: false, searchChamp: false, searchQuest: false, champFa: false, autoRoles: false, combatProfile: 'fighter',
        nAttack: 'Атака', nPower: 'Вихор', nUltra: '', nStun: '', nBuffs: '', nKeyBuffs: '', nDebuff: '', nDrain: '', nHeal: '', nCharge: '', nToggles: '',
        petAuto: false, petBuffAuto: false, petFullAuto: false, debuffAuto: false, autoShots: false, potSlotAuto: false, townBuffSet: 'off', vipBuffAuto: false,
        faBuffs: '', tvtOn: false, enemyHunt: false, reactMin: 0, reactMax: 0, rbMode: false, rbTour: false, rbHuntMode: false, epicMode: false,
        fishMode: false, shopAuto: false, campAuto: false, campaign: false, weaponScanAuto: false, weaponClassEquip: false, dailyKillLimit: 0, dailyAuto: false },
        rt: { ...rt, char: 'AuditHero', lvl: 48, prof: 'human_warlord', classCur: { prof: 'human_warlord', slot: 0 }, magister: null, magPending: {},
          magEnabled: false, shop: null, tbuff: null, storyJob: null, rbGo: null, rbHunt: null, zoneGo: null, invScan: null, target: null,
          petBufferTrip: null, manualKickAt: 0, kills: 0, skills: {}, skillDb: {}, cdUntil: {}, cdUse: {}, weaponMetaPending: null, weaponEq: null,
          weaponNow: '', weapons: [{ id: 299, name: 'Orcish Poleaxe', wt: 'древковое', g: 'C', where: 'надето' }], weaponsT: Date.now() - 10,
          weaponAug: null, shopT: Date.now() } });
    });
    await h.ctx.route('https://l2wap.com/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const json = data => route.fulfill({ json: data }).catch(() => {});
      try {
        if (path === '/character') return json({ character: character() });
        if (path === '/game/battle') return json({ character: character(), battle: battle() });
        if (path === '/game/battle/action') {
          const q = req.postDataJSON(); actions.push(q.action); mp -= q.action === 'provoke' ? 57 : q.action === 'howl' ? 31 : 49;
          if (mode === 'stop' && q.action === 'provoke') { await h.click('stop'); stopped = true; }
          if (!['provoke', 'howl'].includes(q.action)) ended = true;
          return json({ kind: 'full', character: character(), battle: battle(), ...(ended ? { victory: { spawnId: 'fixture', mobName: 'Garden Guard' } } : {}) });
        }
        assert.equal(req.method(), 'GET', 'неожиданный POST ' + path);
        if (path === '/battle.html') return route.fulfill({ contentType: 'text/html', body: page });
        return route.fallback();
      } catch (e) { routeErrors.push(e.message); return route.fulfill({ status: 500, json: { error: 'fixture_assertion' } }).catch(() => {}); }
    });
    await h.g.p.goto('https://l2wap.com/battle.html?spawnId=fixture');
    await until(() => h.g.core('rt.char === "AuditHero"'));
    // d.aug принимает только хозяин аренды. Сначала настоящий Старт с заблокированной панелью: ни одного хода до чтения руки.
    await h.g.p.bringToFront(); await h.click('start');
    await until(() => h.g.core('on && tabOwner && running'));
    // Запрос исполняется в MAIN при активной аренде и попадает в настоящий hook, а не напрямую меняет память модуля.
    await h.g.p.evaluate(() => Promise.all([fetch('/character'), fetch('/game/battle')]));
    await until(() => h.g.core(`BATTLE_NET?.name === "Garden Guard" && rt.weaponAug?.w === ${hand} && rt.weaponAug.t >= rt.weaponsT`));
    if (mode === 'reload-stale') {
      await until(() => h.sw.evaluate(async () => (await chrome.storage.local.get('rt')).rt.weaponAug?.w === 164));
      await h.g.p.reload();
      await until(() => h.g.core('on && tabOwner && running'));
      await h.g.p.evaluate(() => Promise.all([fetch('/character'), fetch('/game/battle')]));
      await until(() => h.g.core('BATTLE_NET?.name === "Garden Guard" && rt.weaponAug?.w === 164 && rt.weaponAug.t >= rt.weaponsT'));
    }
    const proof = await h.g.core('({ recorded: L2V7Modules.combat.combatWeapon()?.id, live: L2V7Modules.combat.combatWeaponLive()?.id ?? null, pending: rt.weaponMetaPending })');
    assert.equal(proof.recorded, 299); assert.equal(proof.live, hand === 299 ? 299 : null); assert.equal(proof.pending, null);
    assert.deepEqual(actions, [], 'панель удерживала все клики до подтверждения руки');
    await h.g.p.evaluate(() => { for (const b of document.querySelectorAll('.l2-battle-hotbar-slot')) b.disabled = false; });
    if (mode === 'stop') {
      await until(() => stopped, 12000); await delay(1300);
      assert.deepEqual(actions, ['provoke'], 'Stop после первого ответа запрещает follow');
    } else {
      await until(() => ended, 12000);
      if (hand === 299) assert.deepEqual(actions, ['provoke', 'whirlwind']);
      else {
        assert.equal(actions.some(x => x === 'provoke' || x === 'howl'), false, 'сбор со старой пикой: ' + actions.join('→'));
        assert.ok(actions.length > 0, 'обычный удар остаётся разрешён');
      }
    }
    await h.click('stop'); assert.deepEqual(routeErrors, []); assert.deepEqual(h.errors, []);
    console.log('PASS MV3/main/hook live weapon', mode, JSON.stringify({ proof, actions }));
  } catch (e) {
    console.error('DIAG', mode, actions, await h.g.core('JSON.stringify({on,tabOwner,status:rt.status,weapon:rt.weapons,live:rt.weaponAug,net:BATTLE_NET})').catch(() => ''));
    throw e;
  } finally { await h.ctx.close(); }
}

(async () => { for (const mode of ['fresh', 'stale', 'reload-stale', 'stop']) await scenario(mode); })().catch(e => { console.error(e.stack); process.exitCode = 1; });

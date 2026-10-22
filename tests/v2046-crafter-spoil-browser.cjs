'use strict';
// 20.46: настоящее MV3/main/hook, Warsmith с подтверждённой пикой. Все HTTPS-ответы локальные, аккаунт игры не используется.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { harness, until, delay } = require('./v1014-core-lifecycle-browser.cjs');
async function scenario(mode) {
  const h = await harness(), actions = [], routeErrors = [];
  let mp = 1800, marked = false, ended = false, stopped = false, hits = 0;
  const lines = ['Бій розпочато: [Seer of Hallate] (ур. 66).'];
  const character = () => ({ name: 'AuditHero', level: 66, l2Profession: 'dwarf_warsmith', classBranch: 'fighter',
    classSlots: { activeSlot: 2, slots: [{ slot: 2, active: true, owned: true, profession: 'dwarf_warsmith', level: 66 }] },
    revision: 100 + actions.length, hp: 21099, maxHp: 21099, mp, maxMp: 1877, inBattle: !ended,
    inventory: { eq: { l1: { itemId: 299, enchant: 0 } }, stacks: [] }, activeSummon: null });
  const battle = () => ({ spawnId: 'fixture-spoil', mobName: 'Seer of Hallate', mobHp: ended ? 0 : hits ? 1500 : 3060,
    mobMaxHp: 3060, mobLevel: 66, kind: 'normal', log: lines.slice(), logSeq: lines.length });
  const html = `<!doctype html><meta charset="utf-8"><div id="l2-hud-legacy-name">AuditHero</div><div id="l2-hud-legacy-lvl">66</div>
    <div id="character-profession">Warsmith</div><div id="l2-nav-bottom"></div><span id="l2-hud-hp-cur">21099</span><span id="l2-hud-hp-max">21099</span>
    <span id="l2-hud-mp-cur">1800</span><span id="l2-hud-mp-max">1877</span><div id="battle-mob-title">Seer of Hallate · ур.66</div>
    <div id="battle-mob-hp-val">3060 / 3060</div><div id="battle-mob-effects-row"></div>
    <button class="l2-battle-hotbar-slot" title="Spoil" id="spoil" disabled><span data-slot-cd="l2_254" hidden></span></button>
    <button class="l2-battle-hotbar-slot" title="Spoil Crush" id="crush" disabled><span data-slot-cd="l2_348" hidden></span></button>
    <button class="l2-battle-hotbar-slot" title="Whirlwind" id="aoe" disabled><span data-slot-cd="whirlwind" hidden></span></button>
    <button class="l2-battle-hotbar-slot" title="Атака" id="attack" disabled><span data-slot-cd="attack" hidden></span></button>
    <div id="battle-log"></div><div id="battle-victory-inline" hidden>Победа!</div><script>
    window.fixtureTurns=[];
    for(const[id,action]of[['spoil','l2_254'],['crush','l2_348'],['aoe','whirlwind'],['attack','attack']])document.getElementById(id).onclick=async()=>{
      fixtureTurns.push(action);const r=await fetch('/game/battle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,battleSpawnId:'fixture-spoil'})});
      const d=await r.json();document.getElementById('l2-hud-mp-cur').textContent=d.character.mp;
      document.getElementById('battle-log').innerHTML=d.battle.log.map(x=>'<div class="l2-battle-log-line">'+x+'</div>').join('');
      document.getElementById('battle-mob-hp-val').textContent=d.battle.mobHp+' / 3060';
      if(d.spoil)document.getElementById('battle-mob-effects-row').dataset.effectsSig='spoil:254';
      if(d.victory)document.getElementById('battle-victory-inline').hidden=false;
      await fetch('/character?afterTurn=1');
    };</script>`;
  try {
    await h.sw.evaluate(async () => {
      const { cfg, rt } = await chrome.storage.local.get(['cfg', 'rt']);
      await chrome.storage.local.set({ on: false, cfg: { ...cfg, autoTasks: ['farm'], taskOnly: false, autoMagister: false,
        crafterKit: false, craftAuto: false, zoneAuto: false, catMode: false, chain: false, searchChamp: false, searchQuest: false,
        champFa: false, autoRoles: false, combatProfile: 'fighter', nAttack: 'Атака', nPower: 'Whirlwind', nSpoil: 'Spoil, Spoil Crush', nSpoilMass: '',
        nUltra: '', nStun: '', nBuffs: '', nKeyBuffs: '', nDebuff: '', nDrain: '', nHeal: '', nCharge: '', nToggles: '',
        petAuto: false, petBuffAuto: false, petFullAuto: false, debuffAuto: false, autoShots: false, potSlotAuto: false,
        townBuffSet: 'off', vipBuffAuto: false, faBuffs: '', tvtOn: false, enemyHunt: false, reactMin: 0, reactMax: 0,
        rbMode: false, rbTour: false, rbHuntMode: false, epicMode: false, fishMode: false, shopAuto: false, campAuto: false,
        campaign: false, weaponScanAuto: false, weaponClassEquip: false, dailyKillLimit: 0, dailyAuto: false, spoilRb: false },
        rt: { ...rt, char: 'AuditHero', lvl: 66, prof: 'dwarf_warsmith', classCur: { prof: 'dwarf_warsmith', slot: 2 },
          magister: null, magPending: {}, magEnabled: false, shop: null, tbuff: null, storyJob: null, rbGo: null, rbHunt: null,
          zoneGo: null, invScan: null, target: null, petBufferTrip: null, manualKickAt: 0, kills: 0, spoilStat: {}, spoilMsgKnown: 1,
          skills: { whirlwind: { dmg: 15000, dmgN: 3 } }, skillDb: { spoil: { name: 'Spoil', mp: 59, mpKnown: true }, whirlwind: { mp: 64, mpKnown: true } },
          cdUntil: {}, cdUse: {}, weaponMetaPending: null, weaponEq: null, weaponNow: '', weaponAug: null,
          weapons: [{ id: 299, name: 'Orcish Poleaxe', wt: 'древковое', g: 'B', where: 'надето' }], weaponsT: Date.now() - 10, shopT: Date.now() } });
    });
    await h.ctx.route('https://l2wap.com/**', async route => {
      const req = route.request(), pathname = new URL(req.url()).pathname, json = data => route.fulfill({ json: data }).catch(() => {});
      try {
        if (pathname === '/character') return json({ character: character() });
        if (pathname === '/game/battle') return json({ character: character(), battle: battle() });
        if (pathname === '/game/battle/action') {
          const action = req.postDataJSON().action; actions.push(action);
          if (action === 'l2_254') { mp -= 59; marked = true; lines.push('Спойл успішний'); }
          else { hits++; mp -= action === 'whirlwind' ? 64 : 0; lines.push(action === 'whirlwind' ? 'Вихор: power 2033; до 3 цілей — 15000 урона' : '[AuditHero] −1500 HP.');
            if (hits >= 2) { ended = true; lines.push('Перемога!', 'EXP + 1000', 'SP + 100', '+100 аден', 'Спойл Varnish ×2'); } }
          if (mode === 'stop' && action === 'l2_254') { await h.click('stop'); stopped = true; }
          const now = Date.now();
          return json({ kind: 'full', ok: true, character: character(), battle: battle(), spoil: marked, serverNowMs: now,
            globalCooldownUntilMs: now + 100, skillCooldowns: action === 'whirlwind' ? [{ battleId: 'l2_36', cooldownUntilMs: now + 1800 }] : [],
            ...(ended ? { victory: { spawnId: 'fixture-spoil', mobName: 'Seer of Hallate', fullLog: lines.slice() } } : {}) });
        }
        assert.equal(req.method(), 'GET', 'неожиданный POST ' + pathname);
        if (pathname === '/battle.html') return route.fulfill({ contentType: 'text/html', body: html });
        return route.fallback();
      } catch (e) { routeErrors.push(e.message); return route.fulfill({ status: 500, json: { error: 'fixture_assertion' } }).catch(() => {}); }
    });
    await h.g.p.goto('https://l2wap.com/battle.html?spawnId=fixture-spoil');
    await until(() => h.g.core('rt.char === "AuditHero"'));
    await h.g.p.bringToFront(); await h.click('start'); await until(() => h.g.core('on && tabOwner && running'));
    // aug из hook принимается хозяином аренды. Никакой установки weaponAug напрямую из теста.
    await h.g.p.evaluate(() => Promise.all([fetch('/character'), fetch('/game/battle')]));
    await until(() => h.g.core('BATTLE_NET?.name === "Seer of Hallate" && rt.weaponAug?.w === 299 && rt.weaponAug.t >= rt.weaponsT'));
    if (process.env.SPOIL_MODULE_SOURCE) {
      const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
      const registration = content.match(/L2V7Modules\.loot = L2V7Factories\.loot\(\{[\s\S]*?\}\);/)[0];
      await h.g.core(fs.readFileSync(process.env.SPOIL_MODULE_SOURCE, 'utf8') + '\n' + registration + '\ntrue');
    }
    const proof = await h.g.core('({live:L2V7Modules.combat.combatWeaponLive()?.id,role:L2V7Modules.subclass.role(),canSpoil:canSpoil()})');
    assert.equal(proof.live, 299); assert.equal(proof.role, 'crafter'); assert.equal(proof.canSpoil, true);
    assert.deepEqual(actions, [], 'до получения аренды и native GET панель удерживала все действия');
    await h.g.p.evaluate(() => { for (const b of document.querySelectorAll('.l2-battle-hotbar-slot')) b.disabled = false; });
    if (mode === 'stop') { await until(() => stopped, 15000); await delay(1500); assert.deepEqual(actions, ['l2_254']); }
    else {
      await until(() => ended, 15000);
      assert.equal(actions[0], 'l2_254', 'свой Spoil с пикой идёт перед уроном'); assert.equal(actions[1], 'whirlwind');
      assert.equal(actions.filter(x => x === 'l2_254').length, 1, 'успешно помеченная цель не спойлится повторно');
      assert.equal(actions.includes('l2_348'), false, 'Spoil Crush с пикой не отправляется');
      assert.equal(await h.g.core('rt.spoilStat?.ok'), 1);
    }
    await h.click('stop'); assert.deepEqual(routeErrors, []); assert.deepEqual(h.errors, []);
    console.log('PASS actual MV3/main/hook crafter Spoil', JSON.stringify({ mode, browser: h.ctx.browser().version(), proof, actions, errors: h.errors }));
  } catch (e) {
    console.error('DIAG', mode, actions, await h.g.core('JSON.stringify({on,tabOwner,status:rt.status,live:rt.weaponAug,spoils:rt.spoilStat,net:BATTLE_NET})').catch(() => ''));
    throw e;
  } finally { await h.ctx.close(); }
}
(async () => { for (const mode of ['sequence', 'stop']) await scenario(mode); })().catch(e => { console.error(e.stack); process.exitCode = 1; });

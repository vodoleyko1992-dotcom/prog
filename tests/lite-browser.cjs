'use strict';
// Lite 1.0 (20.10, тред «Упрошенка под Дестра»): настоящий MV3 облегчённого бота (lite/) в headless Chromium на локальной модели игры.
// Сценарий A: меню → место охоты и 5 мобов → охота цепочкой (чемпион из цепочки — выход) → Battle Trance → Frenzy/Zealot →
//   лимит → TvT: запись, бой на арене, итог → игра выкинула в город → телепорт за адену обратно → после лимита не охотится.
// Сценарий B: «где стоит герой» → смерть → город → статуя (бафф + восстановление) → телепорт назад → проверка активности
//   (бот замирает, ни одного клика) → игрок прошёл её → охота дальше; Стоп.
// Сценарий C (Lite 1.1): задержки сервера (ход 150 мс, GET /character 300 мс, откат атаки 200 мс): удар→удар без лишних пауз
//   (медиана < 600 мс, Lite 1.0 — 530–585 мс), клики не теряются, второй ход не уходит, пока первый ждёт ответа 7 с.
// В C же (1.2.1): язычок «Lite» на странице игры открывает меню во вкладке, повторный клик новую не плодит, при Старте — «Lite ▶».
// Сценарий D (Lite 1.2): быстрый удар — галка ВКЛ по умолчанию; ВЫКЛ → ВКЛ на модели основного 20.42 (ход 0,4 с, GET /character 0,35 с).
// Сценарий E (Lite 1.3, John: «это сборка под БХ, а нужна под дестра»): у героя активен сабкласс Bounty Hunter, Титан — слот 2:
//   меню предупреждает и не показывает скиллы БХ, после Старта бот ничего не жмёт; в игре переключили на Титана — охота пошла,
//   в меню скиллы Титана; снова БХ — панель Титана в меню остаётся, бот ждёт.
// node tests/lite-browser.cjs   (CHROMIUM=…, PLAYWRIGHT_NODE=… при нестандартных путях)
const path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_NODE || '/opt/node-tools/node_modules/playwright');
const EXT = path.resolve(process.env.LITE_EXT || path.join(__dirname, '..', 'lite'));   // LITE_EXT — распакованный ZIP для проверки сборки
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000, what = 'условие') {
  const t0 = Date.now();
  for (;;) { let v; try { v = await fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() - t0 > ms) throw new Error('не дождался: ' + what); await delay(150); }
}

// ---------- модель сервера игры ----------
function makeServer() {
  const S = {
    hero: { id: 'h1', name: 'Dstr', level: 76, l2Profession: 'orc_titan', currentZoneId: 'giran_harbor', currentZoneNameUk: 'Гавань Гірана', locationType: 'field',
      inBattle: false, battleSpawnId: null, hp: 20000, maxHp: 20000, mp: 3000, maxMp: 3000, mobsKilled: 1000, revision: 1, adena: '5000000', pveDefeat: null,
      activeBuffs: [], toggleStances: [],
      battleHotbarSlots: [{ k: 'a', a: 'attack' }, { k: 'a', a: 'l2_190' }, { k: 'a', a: 'battle_trance' }, { k: 'a', a: 'l2_176' }, { k: 'a', a: 'l2_420' }, { k: 'a', a: 'l2_286' }, { k: 'u', id: 1539 }],
      learnedBattleSkillsDetail: [{ battleId: 'l2_190', nameUk: 'Fatal Strike' }, { battleId: 'battle_trance', nameUk: 'Battle Trance' }, { battleId: 'l2_176', nameUk: 'Frenzy' }, { battleId: 'l2_420', nameUk: 'Zealot' }, { battleId: 'l2_286', nameUk: 'Provoke' }] },
    battle: null, spawnN: 0, chainN: 0, champAt: 2, cd: {}, gcd: 0, pots: 50, acts: [], tvtActs: [], tp: [], leaves: 0, antibot: 0, abActs: 0, killHero: false,
    mobHp: 4000, lat: { action: 0, character: 0 }, slowNext: 0, actT: [], pending: 0, overlap: 0, charN: 0,
    tvt: { phase: 'IDLE', eventId: 'tvt-0800', isRegistered: false, registeredCount: 4, maxPlayers: 20, schedule: { enabled: true, next: { slotKey: 'tvt-0800', registrationOpensAt: Date.now() + 100000 } } },   // запись скоро — бот опрашивает часто
    enemies: [{ characterId: 'e1', name: 'Enemy1', level: 70, hp: 3000, maxHp: 3000, cp: 0, alive: true }, { characterId: 'e2', name: 'Enemy2', level: 72, hp: 2000, maxHp: 2000, cp: 0, alive: true }],
    target: null, buffer: [], locations: [
      { teleportId: 'giran_harbor', labelUk: 'Гавань Гірана', adenaCost: 2500, mobLevelMin: 25, mobLevelMax: 51 },
      { teleportId: 'forge_gods', labelUk: 'Кузня богів', adenaCost: 20000, mobLevelMin: 70, mobLevelMax: 80 } ],
  };
  const CD = { attack: 600, l2_190: 2500, battle_trance: 120000, l2_176: 120000, l2_420: 120000, l2_286: 5000 };
  const ch = () => { S.hero.revision++; return { ...S.hero, activeBuffs: S.hero.activeBuffs.filter(b => b.expiresAt > Date.now()) }; };
  const mob = (spawnId, name, kind = 'aggressive', tier = '') => ({ spawnId, mobName: name, mobLevel: 75, kind, championTier: tier, mobHp: S.mobHp, mobMaxHp: S.mobHp, log: [] });
  function action(body) {
    const now = Date.now(), a = String(body.action || '');
    S.acts.push(a); S.actT.push(now);
    if (S.antibot) { S.abActs++; return [423, { error: 'anti_bot_challenge', code: 'anti_bot_challenge' }]; }
    const b = S.battle;
    if (!b || !S.hero.inBattle) return [400, { error: 'no_battle' }];
    if (now < S.gcd) return [400, { error: 'global_cooldown', blockedBy: 'global', serverNowMs: now, globalCooldownUntilMs: S.gcd }];
    if (a !== 'battle_potion_use' && now < (S.cd[a] || 0)) return [400, { error: 'skill_cooldown', blockedBy: 'skill', serverNowMs: now, cooldownUntilMs: S.cd[a] }];
    S.gcd = now + (S.gcdMs || 250);
    const h = S.hero;
    if (a === 'attack') b.mobHp -= 700;
    else if (a === 'l2_190') { b.mobHp -= 1800; h.mp -= 83; }
    else if (a === 'battle_trance') h.hp = Math.round(h.maxHp * 0.25);
    else if (a === 'l2_176') h.activeBuffs.push({ skillId: 176, expiresAt: now + 90000 });
    else if (a === 'l2_420') { h.activeBuffs.push({ skillId: 420, expiresAt: now + 60000 }); h.hp -= 204; h.mp -= 136; }
    else if (a === 'battle_potion_use') { S.pots--; h.hp = Math.min(h.maxHp, h.hp + 3000); }
    else if (a === 'l2_286') {}
    if (a !== 'battle_potion_use') S.cd[a] = now + ((S.cdSet || CD)[a] || 1000);
    h.hp -= S.killHero ? 9000 : 150;
    if (h.hp <= 0) { h.hp = 0; h.inBattle = false; h.pveDefeat = { at: now }; return [200, { defeat: { spawnId: b.spawnId }, delta: { characterHp: 0, serverNowMs: now } }]; }
    if (b.mobHp <= 0) { b.mobHp = 0; h.inBattle = false; h.mobsKilled++; return [200, { victory: { spawnId: b.spawnId, mobName: b.mobName }, delta: { mobHp: 0, serverNowMs: now } }]; }
    // Как настоящая игра (battle-action-result.js): почти каждый ответ на ход несёт hotbarStale — страница перечитывает персонажа.
    return [200, { kind: 'delta', delta: { mobHp: b.mobHp, mobMaxHp: b.mobMaxHp, characterHp: h.hp, characterMaxHp: h.maxHp, characterMp: h.mp, characterMaxMp: h.maxMp,
      hotbarStale: true, serverNowMs: now, globalCooldownUntilMs: S.gcd, skillCooldowns: { [a]: S.cd[a] } } }];
  }
  function tvtState() {
    const t = S.tvt, now = Date.now();
    return { ...t, serverNow: now, combatRoster: S.enemies.map(e => ({ ...e })), selfCombat: { alive: true } };
  }
  async function api(p, method, body) {
    const now = Date.now();
    if (p === '/character') { S.charN++; return [200, { character: ch() }]; }
    if (p === '/game/teleport/locations') return [200, { locations: S.locations }];
    if (p === '/game/battle' && method === 'GET') return [200, { battle: S.battle && { ...S.battle }, character: ch(), serverNowMs: now }];
    if (p === '/game/battle/start') {
      if (S.hero.inBattle) return [400, { error: 'already_in_battle' }];
      const sp = body.spawnId; S.spawnN++;
      S.battle = mob(sp, sp.startsWith('champ_') ? 'Yeti' : 'Grave Robber', sp.startsWith('champ_') ? 'champion' : 'aggressive', sp.startsWith('champ_') ? 'orange' : '');
      S.hero.inBattle = true; S.hero.battleSpawnId = sp; return [200, { battle: S.battle }];
    }
    if (p === '/game/battle/action') return action(body);
    if (p === '/game/battle/hunt-continue') {
      if (S.hero.inBattle) return [400, { error: 'in_battle' }];
      S.chainN++; S.spawnN++;
      S.battle = S.chainN === S.champAt ? mob('m' + S.spawnN, 'Hot Springs Yeti', 'champion', 'orange') : mob('m' + S.spawnN, 'Grave Robber');
      S.hero.inBattle = true; return [200, { battle: S.battle, serverNowMs: now }];
    }
    if (p === '/game/battle/leave') { S.leaves++; S.hero.inBattle = false; S.battle = null; return [200, { ok: true }]; }
    if (p === '/game/battle/defeat/to-city') { Object.assign(S.hero, { hp: 1, pveDefeat: null, inBattle: false, currentZoneId: 'giran', currentZoneNameUk: 'Місто Гіран', locationType: 'city' }); S.battle = null; return [200, { ok: true }]; }
    if (p === '/game/teleport') {
      const loc = S.locations.find(l => l.teleportId === body.teleportId); if (!loc) return [400, { error: 'unknown' }];
      S.tp.push(body.teleportId); S.hero.adena = String(+S.hero.adena - loc.adenaCost);
      Object.assign(S.hero, { currentZoneId: loc.teleportId, currentZoneNameUk: loc.labelUk, locationType: 'field' }); return [200, { ok: true }];
    }
    if (p === '/game/world/outskirts') { Object.assign(S.hero, { locationType: 'field', currentZoneId: S.hero.currentZoneId === 'giran' ? 'giran_out' : S.hero.currentZoneId }); return [200, { ok: true }]; }
    if (p === '/game/town-buffer/apply-set') { S.buffer.push('basic'); return [200, { ok: true }]; }
    if (p === '/game/town-buffer/restore') { S.buffer.push('restore'); S.hero.hp = S.hero.maxHp; S.hero.mp = S.hero.maxMp; return [200, { ok: true }]; }
    if (p === '/game/antibot/challenge') { S.antibot = 0; return [200, { passed: true }]; }
    if (p === '/game/tvt') return [200, tvtState()];
    if (p === '/game/tvt/skills') return [200, { skills: [{ skillId: 0, action: 'attack', nameUk: 'Атака', mpCost: 0, targetType: 'enemy', usable: true }, { skillId: 190, action: 'l2_190', nameUk: 'Fatal Strike', mpCost: 83, targetType: 'enemy', usable: true }] }];
    if (p === '/game/tvt/register') { S.tvt.isRegistered = true; S.tvt.registeredCount++; return [200, tvtState()]; }
    if (p === '/game/tvt/target') { const e = S.enemies.find(x => x.characterId === body.targetCharacterId); S.target = e || null; return [200, { selectedTarget: e ? { ...e } : null, combatRoster: S.enemies, selfMp: S.hero.mp, selfMaxMp: S.hero.maxMp }]; }
    if (p === '/game/tvt/action') {
      S.tvtActs.push(body.action); const e = S.target;
      if (!e || !e.alive) return [400, { error: 'tvt_target_dead' }];
      e.hp = Math.max(0, e.hp - (body.action === 'l2_190' ? 1500 : 600)); if (!e.hp) e.alive = false;
      if (S.enemies.every(x => !x.alive)) S.tvt.phase = 'RESULT';
      return [200, { targetHp: e.hp, targetCp: 0, targetDead: !e.alive, targetCharacterId: e.characterId, selfMp: S.hero.mp, nextBasicAttackAt: now + 500 }];
    }
    return [200, {}];
  }
  return { S, api };
}

// ---------- страницы игры (упрощённая разметка с теми же селекторами, что у настоящей) ----------
const HUD = `<div id="l2-hud-legacy-name">Dstr</div><div id="l2-hud-legacy-lvl">76</div>
<div>HP <span id="l2-hud-hp-cur">0</span>/<span id="l2-hud-hp-max">0</span> MP <span id="l2-hud-mp-cur">0</span>/<span id="l2-hud-mp-max">0</span></div>
<div id="l2-hud-active-buffs"></div>`;
const COMMON = `<script>
const $=s=>document.querySelector(s);
const post=(u,b)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}).then(r=>r.json().then(j=>({status:r.status,j})));
async function ch(){const r=await fetch('/character');const c=(await r.json()).character;$('#l2-hud-hp-cur').textContent=c.hp;$('#l2-hud-hp-max').textContent=c.maxHp;$('#l2-hud-mp-cur').textContent=c.mp;$('#l2-hud-mp-max').textContent=c.maxMp;
 $('#l2-hud-active-buffs').innerHTML=(c.activeBuffs||[]).map(b=>'<span data-skill-id="'+b.skillId+'" data-expires-at="'+b.expiresAt+'"></span>').join('');return c;}
ch();setInterval(ch,2500);
</script>`;
const NAV = `<nav id="l2-nav-bottom"><a data-nav-role="outskirts" href="#" onclick="event.preventDefault();post('/game/world/outskirts').then(()=>location.href='/map.html')">Окрестности</a></nav>`;
function page(title, body) { return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${HUD}${COMMON}${body}${NAV}</body></html>`; }
const TITLES = { attack: 'Атака', l2_190: 'Fatal Strike — сильный удар', battle_trance: 'Battle Trance — HP до 25 %', l2_176: 'Frenzy — при HP ≤ 30 %', l2_420: 'Zealot', l2_286: 'Provoke — агро' };
function hotbar(H, pots) {
  const slots = H.battleHotbarSlots.map(s => s.k === 'a'
    ? `<button class="l2-battle-hotbar-slot" title="${TITLES[s.a]}" data-slot-cd="${s.a}">${s.a === 'attack' ? '' : `<img src="/skills/${s.a}.gif">`}<span class="l2-battle-hotbar-slot-cd" hidden><span class="l2-battle-hotbar-slot-cd__timer"></span></span></button>`
    : `<button class="l2-battle-hotbar-slot" title="Зілля зцілення ×${pots}" data-slot-cd="battle_potion_use" data-item="${s.id}"><span class="l2-battle-hotbar-slot-uqty">${pots}</span><span class="l2-battle-hotbar-slot-cd" hidden></span></button>`).join('');
  return `<div class="l2-battle-hotbar" data-visible-rows="3"><div class="l2-battle-hotbar__row">${slots}</div></div>`;
}
// Бой: клик во время своего запроса игра теряет (как настоящая); после ответа — GET /character; откат рисуется на слоте.
const BATTLE_JS = `<script>
let busy=false;window.__lost=0;const sid=new URLSearchParams(location.search).get('spawnId');
function render(b){if(!b)return;$('#battle-mob-title').textContent=b.mobName+' · ур. '+b.mobLevel+(b.kind==='champion'?' · чемпион':'');$('#battle-mob-hp-val').textContent=b.mobHp+' / '+b.mobMaxHp;}
fetch('/game/battle?spawnId='+sid).then(r=>r.json()).then(j=>render(j.battle));
document.querySelectorAll('.l2-battle-hotbar-slot').forEach(el=>el.onclick=async()=>{
 if(busy){window.__lost++;return;}busy=true;const a=el.dataset.slotCd;
 const {status,j}=await post('/game/battle/action',a==='battle_potion_use'?{action:a,itemId:+el.dataset.item}:{action:a});
 if(j.victory){$('#battle-mob-hp-val').textContent='0 / 4000';$('#battle-victory-inline').hidden=false;$('#battle-victory-hunt').hidden=false;}
 else if(j.defeat){$('#battle-defeat-root').hidden=false;}
 else if(j.delta){$('#battle-mob-hp-val').textContent=j.delta.mobHp+' / '+(j.delta.mobMaxHp||4000);const cd=el.querySelector('.l2-battle-hotbar-slot-cd');const until=(j.delta.skillCooldowns||{})[a];
  if(cd&&until){cd.hidden=false;cd.classList.add('l2-battle-hotbar-slot-cd--on');const tick=()=>{const left=until-Date.now();const tm=cd.querySelector('.l2-battle-hotbar-slot-cd__timer');if(left<=0){cd.hidden=true;cd.classList.remove('l2-battle-hotbar-slot-cd--on');return;}if(tm)tm.textContent=(left/1000).toFixed(1);setTimeout(tick,100);};tick();}}
 if(j.victory||j.defeat||status!==200||(j.delta&&j.delta.hotbarStale))await ch();busy=false;});
$('#battle-victory-hunt').onclick=async()=>{const {j}=await post('/game/battle/hunt-continue');if(j.battle){$('#battle-victory-inline').hidden=true;$('#battle-victory-hunt').hidden=true;render(j.battle);}};
$('#battle-back-map').onclick=async()=>{if($('#battle-victory-inline').hidden)await post('/game/battle/leave',{battleSpawnId:sid});location.href='/map.html';};
$('#battle-defeat-tocity').onclick=async()=>{await post('/game/battle/defeat/to-city');location.href='/city.html';};
</script>`;
function battlePage(sv) {
  return page('Бой', `<div id="battle-mob-title"></div><div id="battle-mob-hp-val"></div>${hotbar(sv.S.hero, sv.S.pots)}
<div id="battle-victory-inline" hidden>Победа</div><button id="battle-victory-hunt" hidden>Охотиться дальше</button><button id="battle-back-map">Назад на карту</button>
<div id="battle-defeat-root" hidden><button id="battle-defeat-tocity">Вернуться в город</button></div>${BATTLE_JS}`);
}
function mapPage(sv) {
  const H = sv.S.hero, n = sv.S.spawnN + 1;
  if (H.currentZoneId !== 'giran_harbor' && H.currentZoneId !== 'giran_out') return page('Карта', `<div id="map-list-mode-mobs" class="is-active">Мобы</div><ul id="map-mob-list"></ul>`);
  const rows = [['l2dop_rb_25234', 'Ancient Weird Drake · ур. 60 · рейд-босс', '--raid'], ['champ_o_' + n, 'Yeti · ур. 76', '--champion'], ['n' + n, 'Grave Robber · ур. 75', ''], ['n' + (n + 1), 'Grave Robber · ур. 75', '']];
  const sig = '4|' + rows.map(r => r[0] + ':' + (r[2] === '--raid' ? 'raid' : r[2] === '--champion' ? 'champion' : 'aggressive')).join(',');
  return page('Карта', `<div id="map-list-mode-mobs" class="is-active">Мобы</div><div id="map-mob-markers" data-l2-marker-sig="${sig}"></div>
<ul id="map-mob-list">${rows.map(r => `<li><a class="l2-map-mob-link ${r[2] ? 'l2-map-mob-link' + r[2] : ''}" href="/battle.html?spawnId=${r[0]}">${r[1]}</a></li>`).join('')}</ul>
<div id="map-defeat-root" hidden></div>
<script>document.querySelectorAll('a.l2-map-mob-link').forEach(a=>a.onclick=async e=>{e.preventDefault();const id=new URL(a.href).searchParams.get('spawnId');const {status}=await post('/game/battle/start',{spawnId:id});if(status===200)location.href=a.getAttribute('href');});</script>`);
}
function teleportPage(sv) {
  const rows = sv.S.locations.map(l => `<div class="l2-teleport-miru-surroundings-row">${l.labelUk} <span class="l2-teleport-miru-price-num">${l.adenaCost.toLocaleString('ru')}</span> <span class="l2-teleport-miru-price-currency">аден</span>
<button class="l2-teleport-miru-tp-btn" data-teleport-id="${l.teleportId}">Телепорт</button></div>`).join('');
  return page('Телепорт', `<button class="l2-teleport-miru-city-btn" data-surroundings-key="giran">Гіран</button><div id="tp-rows" hidden>${rows}</div>
<script>document.querySelector('.l2-teleport-miru-city-btn').onclick=()=>{$('#tp-rows').hidden=false;};
document.querySelectorAll('.l2-teleport-miru-tp-btn').forEach(b=>b.onclick=async()=>{await post('/game/teleport',{teleportId:b.dataset.teleportId});location.href='/map.html';});</script>`);
}
const cityPage = () => page('Город', `<a class="l2-town-miru-item--buffer-statue" href="/town-buffer.html">Магическая статуя</a>`);
const bufferPage = () => page('Баффер', `<div id="town-buffer-sets"><button class="l2-town-buffer-set-apply" data-set-id="basic">Базовый</button></div>
<div id="town-buffer-result-title"></div><div id="town-buffer-result-text"></div><button id="town-buffer-restore-btn">Восстановить</button><div id="town-buffer-msg"></div>
<script>$('.l2-town-buffer-set-apply').onclick=async()=>{await post('/game/town-buffer/apply-set',{setId:'basic'});$('#town-buffer-result-title').textContent='Набор накладено';};
$('#town-buffer-restore-btn').onclick=async()=>{await post('/game/town-buffer/restore');await ch();$('#town-buffer-msg').textContent='HP и MP восстановлены';};</script>`);
function arenaPage(sv) {
  const t = sv.S.tvt;
  const en = sv.S.enemies.map(e => `<span class="l2-tvt-nick${e.alive ? '' : ' l2-tvt-nick--dead'}" data-target-kind="enemy" data-character-id="${e.characterId}" title="${e.level} ур.">${e.name}</span>`).join(' ');
  return page('TvT', `<div id="tvt-phase-label">${t.phase}</div><div id="tvt-message"></div>
${!t.isRegistered && t.phase === 'REGISTRATION' ? '<button id="tvt-register-btn">Зарегистрироваться</button>' : ''}
<div id="tvt-roster">${en}</div><div id="tvt-battle-target-block" hidden><span id="tvt-target-name">—</span> <span id="tvt-target-hp"></span><button id="tvt-back-roster-btn">← Вернуться на TvT</button></div>
${hotbar({ battleHotbarSlots: sv.S.hero.battleHotbarSlots.filter(s => s.a === 'attack' || s.a === 'l2_190') }, 0)}
<div id="tvt-result-section" hidden><div class="l2-tvt-result__headline">Победа синих</div><div class="l2-tvt-result__score">2 : 0</div><div class="l2-tvt-result__reward-text">TvT-жетон ×3</div></div>
<script>
let tgt=null;
async function poll(){const j=await (await fetch('/game/tvt')).json();$('#tvt-phase-label').textContent=j.phase;if(j.phase==='RESULT')$('#tvt-result-section').hidden=false;}
setInterval(poll,1000);poll();
if($('#tvt-register-btn'))$('#tvt-register-btn').onclick=async()=>{await post('/game/tvt/register');$('#tvt-register-btn').remove();$('#tvt-message').textContent='Вы записаны';};
document.querySelectorAll('.l2-tvt-nick').forEach(n=>n.onclick=async()=>{const {j}=await post('/game/tvt/target',{targetCharacterId:n.dataset.characterId});tgt=j.selectedTarget;
 if(tgt){$('#tvt-battle-target-block').hidden=false;$('#tvt-target-name').textContent=tgt.name;$('#tvt-target-hp').textContent=tgt.hp+' / '+tgt.maxHp;}});
$('#tvt-back-roster-btn').onclick=async()=>{await post('/game/tvt/target/clear');tgt=null;$('#tvt-battle-target-block').hidden=true;};
document.querySelectorAll('.l2-battle-hotbar-slot').forEach(el=>el.onclick=async()=>{if(!tgt)return;const {j}=await post('/game/tvt/action',{action:el.dataset.slotCd,targetCharacterId:tgt.characterId});
 if(j.targetHp!=null){$('#tvt-target-hp').textContent=j.targetHp+' / '+tgt.maxHp;if(j.targetDead){document.querySelector('[data-character-id="'+tgt.characterId+'"]').classList.add('l2-tvt-nick--dead');}}});
</script>`);
}

async function launch() {
  const sv = makeServer();
  const ctx = await chromium.launchPersistentContext('', { headless: true, executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  const errors = [], logs = [];
  await ctx.route('https://l2wap.com/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    // S.noPoll (сценарий D): страница не перечитывает героя по таймеру — только после хода, как настоящая игра в бою
    const html = b => route.fulfill({ contentType: 'text/html; charset=utf-8', body: sv.S.noPoll ? b.replace('setInterval(ch,2500);', '') : b }).catch(() => {});
    if (p === '/map.html') return html(mapPage(sv));
    if (p === '/battle.html') return html(battlePage(sv));
    if (p === '/teleport.html') return html(teleportPage(sv));
    if (p === '/city.html') return html(cityPage(sv));
    if (p === '/town-buffer.html') return html(bufferPage(sv));
    if (p === '/tvt-arena.html') return html(arenaPage(sv));
    if (/\.(gif|png|jpg|ico)$/.test(p)) return route.fulfill({ status: 404, body: '' }).catch(() => {});
    let body = {}; try { body = req.postDataJSON() || {}; } catch (e) {}
    const S = sv.S, isAct = p === '/game/battle/action';
    if (isAct) { if (++S.pending > 1) S.overlap++; }
    let status, json;
    try {
      const lat = isAct ? S.lat.action + (S.slowNext ? S.slowNext : 0) : p === '/character' ? S.lat.character : 0;
      if (isAct && S.slowNext) S.slowNext = 0;
      // S.latSplit (сценарий D): половина задержки до сервера, половина — обратно (откаты сервер считает от момента обработки)
      const pre = S.latSplit ? Math.round(lat / 2) : lat;
      if (pre) await delay(pre);
      [status, json] = await sv.api(p, req.method(), body);
      if (lat > pre) await delay(lat - pre);
    } finally { if (isAct) S.pending--; }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) }).catch(() => {});
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const game = await ctx.newPage();
  game.on('pageerror', e => errors.push('game: ' + e.message));
  game.on('console', m => { if (/L2wap Lite/.test(m.text())) logs.push(m.text()); if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const store = keys => sw.evaluate(k => chrome.storage.local.get(k), keys);
  const rt = async () => (await store(['lite.rt']))['lite.rt'] || {};
  const cfg = async () => (await store(['lite.cfg']))['lite.cfg'] || {};
  async function popup() {
    const pp = await ctx.newPage(); pp.on('pageerror', e => errors.push('popup: ' + e.message));
    await pp.goto(`chrome-extension://${id}/popup.html`); await until(() => pp.evaluate(() => !!document.getElementById('run').onclick), 5000, 'меню');
    return pp;
  }
  return { sv, S: sv.S, ctx, sw, game, store, rt, cfg, popup, errors, logs, id };
}
const logText = r => (r.log || []).map(x => x.x).join('\n');

async function scenarioA() {
  const h = await launch(), { S } = h;
  try {
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).locs?.length === 2 && (await h.rt()).bar?.length >= 5, 20000, 'локации и панель в памяти');
    const pp = await h.popup();
    // меню: локация из списка игры, 5 мобов, скиллы из панели (Provoke по умолчанию выключен), Fatal Strike выключим и включим обратно
    await until(() => pp.evaluate(() => [...document.querySelectorAll('#zone option')].some(o => o.value === 'giran_harbor')), 5000, 'список локаций в меню');
    await pp.selectOption('#zone', 'giran_harbor');
    await pp.fill('#limit', '5'); await pp.dispatchEvent('#limit', 'change');
    const skillRows = await pp.$$eval('#skills .sk', els => els.map(e => [e.dataset.key, e.querySelector('input').checked, e.querySelector('select').value]));
    assert.deepEqual(skillRows.map(r => r[0]), ['l2_190', 'battle_trance', 'l2_176', 'l2_420', 'l2_286']);
    assert.deepEqual(skillRows.find(r => r[0] === 'l2_286').slice(1), [false, 'other']);
    assert.deepEqual(skillRows.find(r => r[0] === 'battle_trance').slice(1), [true, 'trance']);
    await until(async () => (await h.cfg()).killLimit === 5 && (await h.cfg()).zone === 'giran_harbor', 5000, 'настройки записаны');
    assert.equal((await h.cfg()).zoneName, 'Гавань Гірана');
    await pp.click('#run');
    await until(async () => (await h.cfg()).on === true, 5000, 'Старт');
    await h.game.bringToFront();
    // охота: карта → обычный моб (не РБ, не чемпион) → бой → цепочка; второй бой цепочки — чемпион → выход на карту
    await until(async () => S.acts.length > 0, 20000, 'первый ход');
    assert.ok(!S.acts.includes('l2_286'), 'Provoke выключен');
    await until(async () => S.leaves >= 1, 60000, 'выход из боя с чемпионом');
    await until(async () => (await h.rt()).k?.kills >= 5, 120000, '5 мобов');
    const r1 = await h.rt();
    assert.equal(r1.k.kills, 5);
    assert.match(logText(r1), /чемпион — не моя цель/);
    assert.match(logText(r1), /цель выполнена: убито 5 из 5/);
    assert.ok(S.acts.includes('battle_trance') && S.acts.includes('l2_176') && S.acts.includes('l2_420'), 'транс → Frenzy → Zealot: ' + S.acts.join(','));
    const ti = S.acts.indexOf('battle_trance'), fi = S.acts.indexOf('l2_176'), zi = S.acts.indexOf('l2_420');
    assert.ok(ti < fi && fi < zi, 'порядок транс → Frenzy → Zealot');
    assert.ok(!S.acts.some(a => a.startsWith('champ')), 'чемпиона с карты не выбирал');
    const killsAt = S.hero.mobsKilled, actsAt = S.acts.length;
    await delay(6000);
    assert.equal(S.hero.mobsKilled, killsAt, 'после лимита не охотится');
    assert.ok(S.acts.length - actsAt <= 1, 'после лимита ходов нет');
    // TvT: открылась запись → бот идёт на арену и записывается, потом обратно на карту
    Object.assign(S.tvt, { phase: 'REGISTRATION', registrationEndsAt: Date.now() + 8 * 60000, schedule: { enabled: true, next: { slotKey: 'tvt-0800', battleStartsAt: Date.now() + 8.5 * 60000 } } });
    await until(() => S.tvt.isRegistered, 40000, 'запись на TvT');
    await until(() => /\/map\.html$/.test(new URL(h.game.url()).pathname), 20000, 'после записи — на карту');
    // старт боя TvT → арена → бой по врагам → итог → игра перенесла в город → телепорт назад
    Object.assign(S.tvt, { phase: 'ACTIVE', startsAt: Date.now(), endsAt: Date.now() + 10 * 60000 });
    await until(() => S.enemies.every(e => !e.alive), 60000, 'враги TvT повержены');
    assert.ok(S.tvtActs.length >= 3);
    Object.assign(S.hero, { currentZoneId: 'giran', currentZoneNameUk: 'Місто Гіран', locationType: 'field' });
    await until(async () => /TvT: итог/.test(logText(await h.rt())), 30000, 'итог TvT в журнале');
    await until(() => S.tp.includes('giran_harbor'), 40000, 'телепорт назад на место охоты');
    await until(() => S.hero.currentZoneId === 'giran_harbor' && /\/map\.html$/.test(new URL(h.game.url()).pathname), 20000, 'на месте охоты');
    const r2 = await h.rt();
    assert.match(logText(r2), /лечу обратно/);
    assert.match(logText(r2), /телепорт → «Гавань Гірана» за 2500 аден/);
    assert.equal(r2.tvtDone, 'tvt-0800');
    await delay(4000);
    assert.equal(S.hero.mobsKilled, killsAt, 'после TvT лимит держится');
    // Стоп из меню
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    assert.deepEqual(h.errors, []);
    if (process.env.LITE_LOG) console.log(logText(await h.rt()), '\nходы:', S.acts.join(','), '\nTvT:', S.tvtActs.join(','));
    console.log('PASS A: меню → охота цепочкой, выход от чемпиона, транс → Frenzy → Zealot, лимит 5, TvT запись/бой/итог, телепорт назад, Стоп');
  } catch (e) { console.error('DIAG A', { acts: h.S.acts.join(','), tvtActs: h.S.tvtActs, tp: h.S.tp, url: h.game.url(), log: logText(await h.rt().catch(() => ({}))), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

async function scenarioB() {
  const h = await launch(), { S } = h;
  try {
    S.champAt = 99; S.locations[0].adenaCost = 0;    // VIP: телепорт к месту охоты за 0 аден
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).locs?.length === 2, 20000, 'локации');
    const pp = await h.popup();
    await pp.click('#run');                                   // место — «где стоит герой», без лимита
    await until(async () => (await h.rt()).zone?.id === 'giran_harbor', 15000, 'место охоты запомнено');
    await h.game.bringToFront();
    await until(() => S.hero.mobsKilled >= 1002, 60000, 'охота');
    // смерть: следующий удар моба убивает → «Вернуться в город» → статуя → бесплатный набор и «Восстановить»
    S.killHero = true;
    await until(() => S.buffer.includes('restore'), 60000, 'статуя: восстановление');
    S.killHero = false;
    assert.ok(S.buffer.includes('basic'), 'бесплатный бафф наложен');
    assert.match(logText(await h.rt()), /герой погиб \(1 за 30 мин\)/);
    // назад на место охоты: «0 аден» — валюта подтверждена, телепорт бесплатный
    await until(() => S.tp.includes('giran_harbor'), 40000, 'телепорт назад');
    await until(() => S.hero.currentZoneId === 'giran_harbor', 20000, 'вернулся');
    const k0 = S.hero.mobsKilled;
    await until(() => S.hero.mobsKilled > k0, 60000, 'охота после возврата');
    // проверка активности: сервер отвечает 423 — бот замирает, никаких кликов, пока игрок не пройдёт её
    S.antibot = 1;
    await until(() => S.abActs >= 1, 30000, 'капча выдана');
    const n0 = S.acts.length;
    await delay(5000);
    assert.equal(S.acts.length, n0, 'во время проверки активности ни одного хода');
    assert.match((await h.rt()).status, /КАПЧА/);
    await h.game.evaluate(() => fetch('/game/antibot/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
    const k1 = S.hero.mobsKilled;
    await until(() => S.hero.mobsKilled > k1, 60000, 'охота после проверки');
    assert.match(logText(await h.rt()), /проверка активности пройдена/);
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    const n1 = S.acts.length; await delay(3000); assert.ok(S.acts.length - n1 <= 1, 'после Стопа ходов нет');
    assert.deepEqual(h.errors, []);
    if (process.env.LITE_LOG) console.log(logText(await h.rt()), '\nходы:', S.acts.join(','));
    console.log('PASS B: «где стоит герой» → смерть → город → статуя (бафф + восстановление) → телепорт назад → капча: бот замер → пройдена → охота; Стоп');
  } catch (e) { console.error('DIAG B', { acts: h.S.acts.slice(-30).join(','), buffer: h.S.buffer, tp: h.S.tp, url: h.game.url(), log: logText(await h.rt().catch(() => ({}))), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

async function scenarioC() {
  const h = await launch(), { S } = h;
  try {
    S.champAt = 99; S.mobHp = 60000; S.lat = { action: 150, character: 300 }; S.cdSet = { attack: 200, l2_190: 2500 };
    S.hero.battleHotbarSlots = S.hero.battleHotbarSlots.filter(x => x.a === 'attack' || x.a === 'l2_190');
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).locs?.length === 2, 20000, 'локации');
    // 1.2.1 (John: «нет даже меню вызова»): язычок «Lite» на странице игры открывает меню во вкладке; второй клик — та же вкладка
    const pill = h.game.locator('#l2lite-pill div');
    await pill.waitFor({ timeout: 5000 });
    assert.equal(await pill.textContent(), 'Lite');
    const [menu] = await Promise.all([h.ctx.waitForEvent('page', { timeout: 5000 }), pill.click()]);
    await menu.waitForLoadState();
    assert.ok(menu.url().endsWith('/popup.html#tab'), menu.url());
    await until(() => menu.evaluate(() => document.documentElement.classList.contains('tab') && !!document.getElementById('run').onclick), 5000, 'меню во вкладке');
    const nPages = h.ctx.pages().length;
    await h.game.bringToFront(); await pill.click(); await delay(1000);
    assert.equal(h.ctx.pages().length, nPages, 'второй клик открыл ещё одну вкладку');
    await menu.close();
    const pp = await h.popup();
    await pp.click('#run');
    await h.game.bringToFront();
    await until(async () => (await pill.textContent()) === 'Lite ▶', 5000, 'язычок «включён»');
    await until(() => S.acts.length >= 25, 60000, '25 ходов');
    // ход по ответу сервера: удар→удар внутри одного боя (без победы между ходами)
    const gaps = S.actT.slice(1).map((t, i) => t - S.actT[i]).filter(x => x < 3000).sort((a, b) => a - b), med = gaps[gaps.length >> 1];
    // второй ход не уходит, пока первый 7 с ждёт ответа сервера
    const n0 = S.acts.length; S.slowNext = 7000;
    await until(() => S.acts.length > n0, 10000, 'медленный ход');
    await until(() => S.acts.length > n0 + 3, 20000, 'ходы после медленного');
    assert.equal(S.overlap, 0, 'второй ход ушёл до ответа на первый');
    const lost = await h.game.evaluate(() => window.__lost || 0);
    assert.ok(lost <= 1, 'потерянных кликов ' + lost);
    assert.ok(med < 600, 'удар→удар, медиана ' + med + ' мс (Lite 1.0 на этой модели — 530–585 мс и 2 потерянных клика)');
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    assert.deepEqual(h.errors, []);
    console.log(`PASS C: язычок «Lite» открывает меню во вкладке (повторно — ту же); ход 150 мс + GET /character 300 мс → удар→удар медиана ${med} мс, потерянных кликов ${lost}; второй ход не ушёл, пока первый 7 с ждал ответа`);
  } catch (e) { console.error('DIAG C', { acts: h.S.acts.slice(-30).join(','), overlap: h.S.overlap, url: h.game.url(), log: logText(await h.rt().catch(() => ({}))), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

// D (Lite 1.2, быстрый удар из основного 20.42): модель основного бота — ход 0,4 с, свой GET /character игры 0,35 с после каждого
// ответа с hotbarStale. Сначала галка «⚡ Быстрый удар» выключена, потом включена; меряем удар→удар и число GET /character.
async function scenarioD() {
  const h = await launch(), { S } = h;
  const run = async (n, what) => {
    const a0 = S.actT.length, c0 = S.charN, l0 = await h.game.evaluate(() => window.__lost || 0);
    await until(() => S.actT.length >= a0 + n, 90000, what);
    const t = S.actT.slice(a0, a0 + n), gaps = t.slice(1).map((x, i) => x - t[i]).filter(x => x < 3000).sort((a, b) => a - b);
    return { med: gaps[gaps.length >> 1], chars: S.charN - c0, lost: (await h.game.evaluate(() => window.__lost || 0)) - l0, sec: (t[t.length - 1] - t[0]) / 1000 };
  };
  try {
    S.noPoll = true; S.latSplit = true; S.champAt = 99; S.mobHp = 200000; S.lat = { action: 400, character: 350 }; S.gcdMs = 60; S.cdSet = { attack: 60, l2_190: 2500 };
    S.hero.battleHotbarSlots = S.hero.battleHotbarSlots.filter(x => x.a === 'attack' || x.a === 'l2_190' || x.k === 'u');
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).locs?.length === 2, 20000, 'локации');
    const pp = await h.popup();
    assert.equal(await pp.evaluate(() => document.getElementById('fastTurn').checked), true, 'по умолчанию ВКЛ');
    await pp.click('details > summary'); await pp.click('#fastTurn');
    await until(async () => (await h.cfg()).fastTurn === false, 5000, 'галка ВЫКЛ');
    await pp.click('#run');
    await h.game.bringToFront();
    await until(() => S.acts.length >= 3, 30000, 'бой начат');
    const off = await run(20, '20 ударов ВЫКЛ');
    assert.equal(await h.game.evaluate(() => document.documentElement.dataset.l2liteFastN), undefined, 'при ВЫКЛ ответы не трогаются');
    await pp.click('#fastTurn');
    await until(async () => (await h.cfg()).fastTurn === true, 5000, 'галка ВКЛ');
    await run(3, 'переход');
    const on = await run(20, '20 ударов ВКЛ');
    const fastN = +(await h.game.evaluate(() => document.documentElement.dataset.l2liteFastN || 0));
    console.log('D замер', { off, on, fastN });
    assert.ok(fastN >= 10, 'быстрых ответов ' + fastN);
    assert.ok(on.med < off.med - 150, `удар→удар ВКЛ ${on.med} мс против ВЫКЛ ${off.med} мс`);
    assert.ok(on.chars <= Math.ceil(on.sec / 5) + 2 && off.chars >= 15, `GET /character: ВЫКЛ ${off.chars}, ВКЛ ${on.chars} за ${on.sec} с`);
    assert.ok(off.lost <= 1 && on.lost <= 1, `потерянные клики ВЫКЛ ${off.lost}, ВКЛ ${on.lost}`);
    // HP героя падает сразу после собственного GET /character игры: панель отстанет на ~5 с, банку бот пьёт по ответу на ход
    const c1 = S.charN; await until(() => S.charN > c1, 10000, 'GET /character игры');
    const p0 = S.acts.filter(a => a === 'battle_potion_use').length, tDrop = Date.now(); S.hero.hp = 6000;
    await until(() => S.acts.filter(a => a === 'battle_potion_use').length > p0, 6000, 'банка HP по ответу на ход');
    const potMs = Date.now() - tDrop, hud = await h.game.evaluate(() => document.getElementById('l2-hud-hp-cur').textContent);
    assert.ok(potMs < 2500, `банка через ${potMs} мс (панель героя показывала ${hud})`);
    assert.equal(S.overlap, 0, 'второй ход ушёл до ответа на первый');
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    assert.deepEqual(h.errors, []);
    console.log(`PASS D: ход 0,4 с + GET /character 0,35 с → удар→удар ВЫКЛ ${off.med} мс (GET ${off.chars} на 20 ударов) → ВКЛ ${on.med} мс (GET ${on.chars}), потерянных кликов ${off.lost}/${on.lost}; банка HP через ${potMs} мс после падения HP (панель ещё ${hud})`);
  } catch (e) { console.error('DIAG D', { acts: h.S.acts.slice(-30).join(','), overlap: h.S.overlap, url: h.game.url(), log: logText(await h.rt().catch(() => ({}))), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

async function scenarioE() {
  const h = await launch(), { S } = h;
  const SLOTS = act => ({ activeSlot: act, slots: [
    { slot: 0, owned: true, active: act === 0, profession: 'human_arcana_lord', race: 'Human', level: 78 },
    { slot: 1, owned: true, active: act === 1, profession: 'dwarf_bounty_hunter', race: 'Dwarf', level: 70 },
    { slot: 2, owned: true, active: act === 2, profession: 'orc_titan', race: 'Orc', level: 76 },
    { slot: 3, owned: false, active: false, profession: null, race: null, level: null }] });
  const titan = { l2Profession: 'orc_titan', level: 76, classSlots: SLOTS(2), battleHotbarSlots: S.hero.battleHotbarSlots, learnedBattleSkillsDetail: S.hero.learnedBattleSkillsDetail };
  const bh = { l2Profession: 'dwarf_bounty_hunter', level: 70, classSlots: SLOTS(1),
    battleHotbarSlots: [{ k: 'a', a: 'attack' }, { k: 'a', a: 'l2_254' }, { k: 'a', a: 'l2_100' }, { k: 'a', a: 'l2_255' }],
    learnedBattleSkillsDetail: [{ battleId: 'l2_254', nameUk: 'Spoil' }, { battleId: 'l2_100', nameUk: 'Stun Attack' }, { battleId: 'l2_255', nameUk: 'Power Smash' }] };
  const BH_ACT = /^(?:l2_254|l2_100|l2_255)$/;
  try {
    S.champAt = 99;
    Object.assign(S.hero, bh);
    await h.game.goto('https://l2wap.com/map.html');
    await until(async () => (await h.rt()).char?.prof === 'dwarf_bounty_hunter' && (await h.rt()).locs?.length === 2, 20000, 'герой БХ в памяти');
    const pp = await h.popup();
    await until(() => pp.evaluate(() => !document.getElementById('cls').hidden), 5000, 'предупреждение в меню');
    const warn = await pp.textContent('#cls');
    assert.match(warn, /Сейчас в игре Dstr — Dwarf Bounty Hunter/); assert.match(warn, /переключите в игре сабкласс 2 на Orc Titan \(76 ур\.\)/);
    assert.match(await pp.textContent('#hero'), /Dstr, 70 ур\. · Dwarf Bounty Hunter/);
    assert.equal(await pp.$$eval('#skills .sk', e => e.length), 0, 'скиллы БХ в меню');
    assert.match(await pp.textContent('#skills'), /когда в игре будет активен Дестр\/Титан/);
    assert.deepEqual((await h.rt()).bar || [], [], 'панель БХ в памяти');
    await pp.click('#run');
    await until(async () => /Lite ведёт только Дестра\/Титана/.test((await h.rt()).status || ''), 10000, 'статус «жду Дестра»');
    await delay(6000);
    assert.equal(S.spawnN, 0, 'начат бой'); assert.deepEqual(S.acts, []); assert.deepEqual(S.tp, []); assert.equal(S.tvt.isRegistered, false);
    assert.equal(h.game.url(), 'https://l2wap.com/map.html');
    const r1 = await h.rt();
    assert.match(r1.status, /Сейчас в игре Dstr — Dwarf Bounty Hunter\. Lite ведёт только Дестра\/Титана: переключите в игре сабкласс 2 на Orc Titan/);
    assert.equal(logText(r1).match(/Lite только для Дестра/g)?.length, 1, 'запись в журнале одна');
    // игрок переключил в игре сабкласс на Титана (слот 2): игра перечитала героя → Lite охотится, меню без предупреждения, скиллы Титана
    Object.assign(S.hero, titan);
    await until(() => S.acts.length >= 5, 30000, 'охота на Титане');
    await until(() => pp.evaluate(() => document.getElementById('cls').hidden && document.querySelectorAll('#skills .sk').length === 5), 5000, 'меню Титана');
    const r2 = await h.rt();
    assert.match(logText(r2), /активен Orc Titan \(Dstr\) — продолжаю/);
    assert.equal(r2.barCls, 'orc_titan');
    assert.ok(!S.acts.some(a => BH_ACT.test(a)), 'жал скилл БХ: ' + S.acts.join(','));
    // Стоп, в игре снова БХ: в меню — предупреждение и панель Титана (панель БХ её не затирает); после Старта — снова ждёт
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    Object.assign(S.hero, bh, { inBattle: false }); S.battle = null;
    await until(async () => (await h.rt()).char?.prof === 'dwarf_bounty_hunter', 10000, 'снова БХ');
    await until(() => pp.evaluate(() => !document.getElementById('cls').hidden), 5000, 'предупреждение снова');
    assert.deepEqual(await pp.$$eval('#skills .sk', els => els.map(e => e.dataset.key)), ['l2_190', 'battle_trance', 'l2_176', 'l2_420', 'l2_286']);
    assert.equal((await h.rt()).barCls, 'orc_titan');
    const n = S.acts.length;
    await pp.click('#run');
    await until(async () => /Lite ведёт только Дестра\/Титана/.test((await h.rt()).status || ''), 10000, 'статус «жду Дестра» после Старта');
    await delay(4000);
    assert.equal(S.acts.length, n, 'ходы на БХ');
    await pp.click('#run'); await until(async () => (await h.cfg()).on === false, 5000, 'Стоп');
    assert.deepEqual(h.errors, []);
    console.log(`PASS E: сабкласс БХ — предупреждение «переключите сабкласс 2 на Orc Titan», скиллов БХ нет, 0 боёв/ходов/телепортов за 6 с; Титан — охота (${n} ходов), скиллы Титана; снова БХ — панель Титана в меню, бот ждёт`);
  } catch (e) { console.error('DIAG E', { acts: h.S.acts.slice(-30).join(','), url: h.game.url(), rt: await h.rt().then(r => ({ status: r.status, char: r.char, barCls: r.barCls, bar: r.bar, log: logText(r) })).catch(() => ({})), errors: h.errors }); throw e; }
  finally { await h.ctx.close(); }
}

// LITE_ONLY=AC — только эти сценарии
const ONLY = process.env.LITE_ONLY || 'ABCDE';
(async () => { if (ONLY.includes('A')) await scenarioA(); if (ONLY.includes('B')) await scenarioB(); if (ONLY.includes('C')) await scenarioC(); if (ONLY.includes('D')) await scenarioD(); if (ONLY.includes('E')) await scenarioE(); })().catch(e => { console.error(e.stack || e); process.exitCode = 1; });

/* L2wap v7: isolated mobfarm feature module. Dependencies are injected lazily.
   All game actions remain under the central lease and dispatcher in content.js. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 root.L2V7Factories.mobfarm = function create_mobfarm(env) {
// 8.0.3 (проверка правки «РБ между мобами»): держит на месте тур по РБ или РБ, который ждёт здесь (rbPending). Само дополнение
// «РБ между мобами» (бьёт РБ в текущей локации) больше не запрещает автофарму менять локацию и не мешает идти за ресурсом/рецептом
// 10.0 (лог 12.10 11:16–11:52: тур 36 мин без единого РБ — «все не по силам», а автофарм стоял в зоне 8,8 M EXP/ч при замере 32 M в Silent Valley):
// тур в простое (подходящих РБ нет, rbHuntIdle) больше не держит автофарм и фарм ресурса на месте
const rbHold = () => !!((env.cfg.rbHuntMode && !((env.rt.rbHuntIdle || 0) > Date.now())) || (env.cfg.rbMode && env.rt.rbPending));
// 7.1.30: «Риба · ур. 48 · миньоны зоны эпика» (spawnId l2dop_eg_…) — охрана эпика, не обычный моб
const EPIC_GUARD = /миньон|мін[ьй]он|epic guard|зоны эпика|зони епіка/i;
function pageItems() {
  return [...document.querySelectorAll('#map-mob-list a.l2-map-mob-link')].map(a => {
    const id = (a.getAttribute('href') || '').match(/spawnId=([^&#]+)/)?.[1] || '';
    const text = a.textContent.trim(), m = text.match(env.LV_RE);
    return { a, id, text, name: m ? m[2].trim() : text, lvl: m ? +m[3] : 0,
             quest: a.classList.contains('l2-map-mob-link--quest-target') || env.QUEST.test(text),
             champ: env.isChamp(text), boss: env.isBoss(text) || env.isRaidId(id) || a.classList.contains('l2-map-mob-link--raid') || EPIC_GUARD.test(text) || /--epic_guard/.test(a.className) };
  }).filter(x => x.id);
}

function pagerInfo() {                         // «5 / 27 (398)»
  const m = (env.$q('#map-mob-page-ind')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)\s*\(\s*(\d+)\s*\)/);
  return m ? { cur: +m[1], total: +m[2], count: +m[3] } : null;
}

const pageKey = () => (env.$q('#map-mob-page-ind')?.textContent || '') + '|' + pageItems().map(i => i.id).join(',');

function aroundSig() {
  const parts = (env.$q('#map-mob-list')?.dataset.l2AroundSig || '').split('|');
  const ids = (parts[1] || '').split(',').map(x => x.split(':')[0]).filter(Boolean);
  // «q…» — отдельное поле после «pN|lvN». Список мобов (поле 1) тоже может начинаться с «q» (spawnId «quest_…») — его не берём
  const q = (parts.slice(2).find(p => /^q/.test(p) && !/[:]\d/.test(p)) || 'q').slice(1).split(',').map(x => x.trim()).filter(Boolean);
  return { ids, quest: q };
}

function markerTypes() {
  const t = {};
  // v5.6: тип моба (passive/aggressive/champion…) — из ответа сервера /game/map/spawns: метки карты теперь только у РБ
  if (env.NET_SPAWNS && Date.now() - env.NET_SPAWNS.t < 10 * 60000) Object.assign(t, env.NET_SPAWNS.kind);
  (env.$q('#map-mob-markers')?.dataset.l2MarkerSig || '').split('|')[1]?.split(',').forEach(x => {
    const [id, ty] = x.split(':'); if (id) t[id] = ty;
  });
  return t;
}

// 10.0.5 (обновление игры 13.10, анонс «Обновление чемпионов»): с чемпиона падает 1 Fast Aden — синий 10 %, оранжевый 20 %, красный 60 %
// (респ 10/10/15 мин), с обычного моба 1 %; только если моб не ниже героя больше чем на 5 ур. Цвет — championTier в /game/map/spawns
// (живой ответ 13.10, Wild Beast Pastures: 12 синих dense_*, 4 оранжевых champ_o_*, 2 красных champ_r_*; HP ×1 / ×2 / ×3 синего,
// EXP ×1 / ≈1,6 / ≈2), в разметке — li.l2-map-mob-item--champion-<цвет>
const FA_P = { blue: 0.1, orange: 0.2, red: 0.6 }, FA_MOB = 0.01, FA_BELOW = 5;
const TIER_RU = { blue: 'синий', orange: 'оранжевый', red: 'красный' };
function champTier(id, a) {                        // цвет чемпиона: ответ сервера → spawnId champ_r_/champ_o_ → класс строки карты → синий
  const t = env.NET_SPAWNS?.tier?.[id];
  if (t) return t;
  if (/^champ_r_/i.test(id || '')) return 'red';
  if (/^champ_o_/i.test(id || '')) return 'orange';
  const li = a?.closest?.('li'), m = (li?.className || '').match(/l2-map-mob-item--champion-(\w+)/);
  return m ? m[1] : 'blue';
}
// шанс 1 FA с этого моба (0 — моб ниже героя больше чем на 5 ур.)
const faChance = (champ, tier, lvl, hl = env.heroLvl() || env.rt.lvl || 0) => hl && lvl && lvl < hl - FA_BELOW ? 0 : champ ? FA_P[tier] || FA_P.blue : FA_MOB;

async function netSpawns(list) {
  const kind = {}, tier = {}, sp = { ...(env.rt.spawns || {}) };
  let added = 0;
  for (const [id, k, name, lvl, , tr] of list) {
    if (!id) continue;
    if (k) kind[id] = k;
    if (k === 'champion') tier[id] = tr || champTier(id);
    if (name && !env.isRaidId(id) && (!sp[id] || sp[id][0] !== name || sp[id][1] !== lvl)) { sp[id] = [name, lvl]; added++; }
  }
  env.NET_SPAWNS = { t: Date.now(), kind, tier };
  const ch = list.filter(x => x[1] === 'champion'), key = ch.map(x => x[0]).join(',');
  if (key !== (env.rt.netChampKey || '')) {
    env.rt.netChampKey = key;
    if (!env.tabIdle) env.setRt({ netChampKey: key }).catch(() => {});
    // 10.0.5: красные и оранжевые первыми, с цветом — их бот бьёт ради FA
    const tw = x => ({ red: 0, orange: 1 })[tier[x[0]]] ?? 2;
    if (ch.length) env.rec('B', 'чемпионы', `в списке локации (сервер): ${[...ch].sort((a, b) => tw(a) - tw(b)).slice(0, 5).map(x => `${x[2]} (${x[3]}${tier[x[0]] && tier[x[0]] !== 'blue' ? ', ' + TIER_RU[tier[x[0]]] : ''})`).join(', ')}${ch.length > 5 ? ` …ещё ${ch.length - 5}` : ''}`);
  }
  if (added && !env.tabIdle) await env.setRt({ spawns: Object.keys(sp).length > 4000 ? Object.fromEntries(list.filter(x => x[2] && !env.isRaidId(x[0])).map(x => [x[0], [x[2], x[3]]])) : sp });
}

function parseRules() {
  // кампания с открытыми мобами-целями: ★ цели главы всегда первые — даже если «Искать квестовых» выключено
  // (так было: галочка снята → правило [квест] выпало → бот бил ближайших Shooter/Marksman вместо ★ Guerilla рядом)
  const campQuest = env.campMobOpen().length > 0;
  const rules = env.cfg.priority.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const neg = line.startsWith('-');
    const t = neg ? line.slice(1).trim() : line;
    return {
      neg, line,
      quest: /\[квест\]/i.test(t), champ: /\[чемп\]/i.test(t), all: /\[все\]/i.test(t),
      name: t.replace(/\[(квест|чемп|все)\]/gi, '').trim().toLowerCase()
    };
  }).filter(x => x.neg || ((!x.quest || env.cfg.searchQuest || campQuest) && (!x.champ || champRuleOn())));
  if (campQuest && !rules.some(x => x.quest && !x.neg))
    rules.unshift({ neg: false, line: '[квест] (кампания)', quest: true, champ: false, all: false, name: '' });
  const fr = [...env.farmRules(), ...env.recipeRules()];  // фарм ресурса и охота на рецепт: мобы-источники — сразу после квестовых
  if (fr.length) rules.splice(rules.findIndex(x => !x.neg && x.quest) + 1, 0, ...fr);
  // глава ждёт «★ Чемпионы N/M»: чемпионы редкие, а мобы-цели есть всегда — увиденный чемпион идёт первым
  // (так было: [квест] выше [чемп] → бот бил Marsh Stakato, а чемпионов главы не трогал вовсе)
  if (env.campActive() && env.campChampOpen()) {
    const i = rules.findIndex(x => !x.neg && x.champ && !x.quest && !x.name);
    const r = i >= 0 ? rules.splice(i, 1)[0] : { neg: false, line: '[чемп] (глава)', quest: false, champ: true, all: false, name: '' };
    rules.unshift(r);
  }
  return rules;
}

function champRuleOn() {
  if (env.campActive() && env.campChampOpen()) return true;
  if (env.campActive() && env.campMobOpen().length) return false;
  // v4.30: галочка «Искать чемпионов» решает сама. Раньше бот молча выключал чемпионов, если цепочка давала на 10 % больше
  // EXP/мин, — игрок видел «Чемп» в приоритете, а чемпионов бот не искал
  return !!env.cfg.searchChamp;
}

function chainBetter() {
  const E = env.rt.eff || {}, c = E.chain, m = E.map;
  return !!c && !!m && c.n >= 5 && m.n >= 5 && c.rate > m.rate * 1.1;
}

function chainCarries() {
  const q = env.rt.chainQ || [];
  if (q.length < 6 || (!(+env.cfg.deepEvery > 0) && !env.farmMapOn?.())) return false;   // 7.2: на точке фарма ресурса карта есть и при 0   // 7.1.31: 0 = карту не проверять — откладывать нечего   // v4.28: deepHot больше не отключает цепочку — решает доля целей
  if (env.campActive() && env.campChampOpen() && !env.rt.champSeen?.startsWith('0:')) return false;   // чемпионы главы видны на карте — не откладываем
  return q.reduce((a, b) => a + b, 0) / q.length >= 0.5 && (env.rt.sinceDeep || 0) < env.deepN() * 3;
}

function ruleMatch(x, r) {
  if (!x.quest && !x.champ && !x.all && !x.name) return false;
  if (x.quest && !r.quest) return false;
  if (x.champ && !r.champ) return false;
  if (x.name && !r.name.toLowerCase().includes(x.name)) return false;
  if (x.all && (r.lvl < env.cfg.lvlMin || r.lvl > env.cfg.lvlMax)) return false;
  return true;
}

// открытая ★ цель квеста есть на ЭТОЙ локации (квест профессии — только свежий ≤ 1 ч; ★ из подписи карты/списка — только мобы этой зоны,
// мобы зоны ещё не известны — любая). Та же проверка решает «за ★ целью на карту» в nextFight и «есть зачем проверять карту» (searchActive)
function questHere() {
  const zM = (env.rt.zoneMobs?.[env.rt.zone] || []).map(n => n.toLowerCase());
  const pqFresh = Date.now() - (env.rt.profQuest?.t || 0) < 3600000;   // 7.1.30: квест профессии — только свежий (≤ 1 ч)
  const qNames = [...(pqFresh ? env.rt.profQuest?.open || [] : []), ...(env.rt.questTargets || []).map(n => n.toLowerCase())].filter(n => env.isQuestName(n));
  return qNames.some(n => !zM.length || zM.includes(n));
}
// моб из правила с именем есть на этой локации (как ruleMatch: имя правила — часть имени моба); мобы зоны не известны — да
function nameHere(name) {
  const zM = (env.rt.zoneMobs?.[env.rt.zone] || []).map(n => n.toLowerCase());
  return !zM.length || zM.some(n => n.includes(String(name || '').toLowerCase()));
}

function rank(r, rules) {
  if (r.boss) return -1;
  if (rules.some(x => x.neg && ruleMatch(x, r))) return -1;
  return rules.filter(x => !x.neg).findIndex(x => ruleMatch(x, r));
}

async function nextFight(ctx) {
  if (env.tvtSoon() && !ctx?.rb) { env.rec('B', 'TvT', 'бой TvT скоро — после этого моба на арену'); location.href = '/tvt-arena.html'; await env.sleep(4000); return; }
  await env.sleep(env.rnd(40, 120));                      // после победы — сразу дальше (v5.4: было 150–350 мс)
  if (!env.on) return;
  // v5.2.2: в «Туре РБ» проверка расходников раньше не доходила (выход на карту стоял выше) — банки не докупались
  if (env.huntOn() && env.cfg.shopAuto && !env.rt.shop && Date.now() - (env.rt.shopT || 0) > 600000) { const low0 = env.shopNeedByPanel(); if (low0) { await env.shopStart(`${low0} — докупаю всё, пока не в бою`, true); location.href = '/char.html'; await env.sleep(4000); return; } }
  // 10.0 (аудит фарма): тур «лечится на мобах» (HP < порога перед РБ) — цепочкой (≈5 с на моба), а не через карту после каждого боя (≈11 с)
  const healing = env.rt.rbHunt?.last === 'лечусь на мобах' && (env.meHp?.()?.pct ?? 100) < (env.cfg.rbRestHp ?? 95);
  if (env.huntOn() && !((env.rt.rbHuntIdle || 0) > Date.now()) && !healing) return env.toMap();
  if (env.epicOn() && env.rt.epic?.step && env.rt.epic.step !== 'pick') return env.toMap();
  if (env.autonomyMode() === 'tasks' && !tasksGoalHere()) return env.toMap();   // 10.0: без режима — бой (начатый игроком или по задаче) довели, дальше не охотимся   // 🐉 эпики: после миньона/моба — снова к эпику   // тур по РБ: дальше решает rbHuntStep (следующий РБ); пока РБ нет — цепочкой
  // расходники на исходе (по панели) или пора проверить руду (раз в час) — сначала в магазин
  // (не чаще раза в 10 мин — если адены не хватило, не бегаем в магазин после каждого боя)
  if (env.rt.shop) { location.href = '/char.html'; await env.sleep(4000); return; }   // «Закупить сейчас» нажали во время боя
  if (env.rt.bagCheck) { location.href = '/char.html'; await env.sleep(4000); return; }   // «Пересчитать в сумке» из меню
  if (env.rt.zoneGo) { location.href = '/teleport.html'; await env.sleep(4000); return; }   // «Лететь» в меню локаций
  if (!ctx?.rb && await env.townBuffStart('баффы кончились')) return;            // городской бафф слетел (смерть/24 ч)
  const since = Date.now() - (env.rt.shopT || 0);
  const low = since > 600000 ? env.shopNeedByPanel() : '';
  const plan = env.cfg.shopAuto ? env.shopPlan() : [];
  let oreDue = env.cfg.shopAuto && plan.some(x => ['spirit', 'soul', 'bait'].includes(x.key)) && since > 3600000;
  // 8.0 (аудит фарма B4): сумка из ответов сервера свежая (< 5 мин, env.invQty) и всё из плана закупки не ниже минимума —
  // плановый поход в инвентарь (≈10–15 с раз в час) ничего не купит, пропускаем. Не пропускаем, если идут «Квесты на ресурсы»
  // (прогресс берётся из пересчёта сумки) или полный пересчёт сумки старше 5 ч (по нему оценивается запас банок перед РБ)
  if (oreDue && !env.resQuests().length && Date.now() - (env.rt.bagAll?.t || 0) < 5 * 3600000
      && plan.every(x => x.ids?.length && x.ids.every(id => env.invQty?.(id) != null) && x.ids.reduce((a, id) => a + env.invQty(id), 0) >= x.mm[0])) oreDue = false;
  if (low || (oreDue && !ctx?.rb)) { await env.shopStart(low || 'плановая проверка запасов'); location.href = '/char.html'; await env.sleep(4000); return; }
  if (env.autonomyMode() === 'fish') return env.goFishing();
  if (env.cfg.catMode && !env.campOn() && !env.huntOn()) {    // 🏛 фарм катакомб: после боя — «Охотиться дальше» внутри подземелья
    // v5.3.1: раньше после каждого моба бот уходил на страницу подземелья и выбирал заново (≈3 с на моба, лог 08.10 14:49).
    // «Охотиться дальше» в подземелье даёт следующего моба оттуда же — цепочкой, как на карте
    if (env.cfg.chain !== false && (env.rt.catIn || /spawnId=sdms_/i.test(location.search))) {
      const hunt = await env.waitFor(() => { const h = env.$q('#battle-victory-hunt'); return env.shown(h) ? h : null; }, 2500, 50);
      if (hunt) {
        env.setStatus('Катакомбы: охотиться дальше'); env.setRt({ via: 'chain', catInT: Date.now() });   // 10.0: запись не ждём
        const href = location.href; env.fire(hunt);
        if (await env.waitFor(() => location.href !== href || (!env.victory() && (env.mobHp()?.cur || 0) > 0), 8000) || !env.on) return;
      }
    }
    return env.catGo();
  }
  if (env.campOn() && env.rt.campaignDue) return env.goCampaign();
  // фарм ресурса (меню или «Нужно сдать» главы): не в той зоне — летим с форума «Фарм ресурсов»
  if ((env.cfg.farmRes || env.cfg.campaign || env.resQuests().length) && !rbHold() && !ctx?.rb && !env.campMobOpen().length && await env.farmStep()) return;
  if (env.cfg.recipeRes && !rbHold() && !ctx?.rb && !env.campMobOpen().length && await env.recipeStep()) return;   // охота на рецепт
  // сам подбирает локацию для кача (не в кампании/РБ/рыбалке): проба новых подходящих зон, затем лучшая по EXP/ч
  if (env.cfg.zoneAuto && !env.cfg.campaign && !rbHold() && !ctx?.rb && !env.lootGoal?.() && Date.now() - (env.rt.zoneGoT || 0) > 600000) {   // 7.2: цель ресурса/рецепта держит на месте
    if ((!env.rt.zoneCatT || env.zoneCatThin() || Date.now() - env.rt.zoneCatT > 24 * 3600000) && ((env.rt.zoneCatFail || 0) < 3 || Date.now() - (env.rt.zoneCatFailT || 0) > 3600000)) { await env.setRt({ zoneScan: true }); location.href = '/teleport.html'; await env.sleep(4000); return; }
    const pick = env.zonePick();
    // 10.0 (лог 12.10 12:00:05–12:00:16): метка «▶ при старте» из меню оставалась — карта выбирала зону второй раз сразу после полёта
    if (pick) { await env.setRt({ zoneGo: { ...pick, t: Date.now() }, zoneGoT: 0, zoneAutoKick: null }); location.href = '/teleport.html'; await env.sleep(4000); return; }
  }
  // глава: «Охотиться дальше» даёт случайного соседа. Чужой моб в цепочке — не повод уходить на карту:
  // уходим, только если цепочка приносит цели реже, чем окупается дорога через карту
  // (время на цель цепочкой = с/моб ÷ доля целей; через карту ≈ с/моб карты — там бот сам выбирает цель).
  const rules = parseRules();
  // 7.2: моб-источник ресурса/рецепта — тоже «цель» (по доле таких в цепочке решаем, нужна ли карта)
  const tgt = !!ctx && (env.isQuestName(ctx.name) || ctx.killed.some(n => env.isQuestName(n)) || (!!ctx.champ && rules.some(x => x.champ && !x.neg))
    || rules.some(x => x.farm && x.name === String(ctx.name || '').toLowerCase()));
  const camp = !!ctx && env.campMobOpen().length > 0;
  if (ctx && (camp || env.searchActive(rules)) && env.rt.via === 'chain') env.setRt({ chainQ: [...(env.rt.chainQ || []), tgt ? 1 : 0].slice(-12) });
  let offQuest = false;
  if (camp && !tgt) {
    const q = env.rt.chainQ || [], share = (q.reduce((a, b) => a + b, 0) + 1) / (q.length + 2);
    const cs = env.rt.eff?.chain?.sec || 9, ms = env.rt.eff?.map?.sec || 20, perTgt = cs / share;
    offQuest = q.length >= 6 && perTgt > ms * 1.1;           // решаем по 6+ боям цепочки, не по одному чужому мобу
    const why = `цепочка: целей ${Math.round(share * 100)} % · ≈${perTgt.toFixed(0)} с на цель против ≈${ms.toFixed(0)} с через карту`;
    if (env.rt.chainWhy !== (offQuest ? 'map' : 'chain')) env.rec('B', 'цепочка', `${ctx.name} — не цель главы; ${why} → ${offQuest ? 'на карту за целью' : 'продолжаю цепочку'}`);
    await env.setRt({ chainWhy: offQuest ? 'map' : 'chain' });
  }
  // 7.1.30 (10.10 14:01): ★ квестовые мобы на локации (квест профессии: Giant Fungus/Dire Wyrm), а «Охотиться дальше» дал чужого —
  // цепочка 10 боёв била кого попало до плановой проверки карты. Есть открытые ★ цели и этот моб не цель — сразу на карту за целью
  // только если такая цель есть на ЭТОЙ локации (подпись карты «q…» перечисляет цели квеста на любой локации)
  // и только если правило [квест] вообще может выбрать цель (иначе карта после каждого боя ни к чему)
  const qRule = rules.some(x => x.quest && !x.neg);
  // 7.1.31: «Проверять карту каждые 0 боёв» = никогда — за ★ целью на карту тоже не ходим (бьём то, что даёт цепочка)
  const qOpen = qRule && env.cfg.searchQuest !== false && !camp && +env.cfg.deepEvery > 0 && questHere();
  if (ctx && qOpen && !tgt && !ctx.rb) {
    offQuest = true;
    if (env.rt.chainWhy !== 'qmap') { env.rec('B', 'цепочка', `${ctx.name} — не ★ цель квеста; иду на карту за целью`); await env.setRt({ chainWhy: 'qmap' }); }
  } else if (ctx && qOpen && tgt && env.rt.chainWhy === 'qmap') await env.setRt({ chainWhy: 'chain' });
  let due = env.mapDue(rules);
  // v4.28: цель далеко по списку карты (deepHot), но цепочка только что дала цель (★/чемпион) — соседи такие же, продолжаем
  // цепочку. Так было: Leto Lizardman Archer на 8-й странице → после КАЖДОГО боя карта (+5–8 с на бой)
  if (due && tgt && env.rt.deepHot && !env.rbDue() && !env.campRbOpen().length && (+env.cfg.deepEvery > 0 || env.farmMapOn?.())) {
    if (env.rt.chainWhy !== 'hot') env.rec('B', 'цепочка', `${ctx.name} — цель; цепочка приносит цели, карту не проверяю`);
    await env.setRt({ chainWhy: 'hot', sinceDeep: Math.min(env.rt.sinceDeep || 0, env.deepN() - 1) });
    due = false;
  }
  if (due && !env.rbDue() && !env.campRbOpen().length && chainCarries()) {
    if (env.rt.chainWhy !== 'carry') env.rec('B', 'цепочка', `цели идут цепочкой (${Math.round((env.rt.chainQ.reduce((a, b) => a + b, 0) / env.rt.chainQ.length) * 100)} % боёв) — плановую проверку карты откладываю`);
    await env.setRt({ chainWhy: 'carry' });
    due = false;
  }
  // 10.0 (лог 12.10 12:01): заказ Маммона / почта / готовая часть квеста ждали, пока идёт цепочка — после этой победы разово на карту, дальше mmStep/storyStep
  if (!ctx?.rb && (env.mmChainWant?.() || env.storyChainWant?.() || env.tsChainWant?.())) {
    env.rec('B', 'цепочка', `после боя — дело вне боя (${env.mmChainWant?.()?.why || env.storyChainWant?.()?.why || env.tsChainWant?.()?.why || ''}), иду на карту`);
    return env.toMap();
  }
  if (env.cfg.chain && !offQuest && !due) {
    // кнопка «Охотиться дальше» появляется на экране победы не сразу (иногда через 0,3–1 с) —
    // ждём её, а не уходим на карту (v4.6–4.13: бот уходил через 0,2 с, «цепочка не работает»)
    const hunt = await env.waitFor(() => { const h = env.$q('#battle-victory-hunt'); return env.shown(h) ? h : null; }, 2500, 50);
    if (hunt) {
      env.setStatus('Охотиться дальше');
      // 10.0 (лог 12.10: от записи «Охотиться дальше» до запроса 273 мс против ≈45 мс у игрока): запись не ждём — rt в памяти уже новый,
      // хвост очереди досылается при уходе со страницы (pagehide); опрос 50 мс вместо 250
      env.setRt({ via: 'chain' });
      const href = location.href, t0 = Date.now();
      env.fire(hunt);
      const started = () => (location.href !== href && !env.victory()) || (!env.victory() && (env.mobHp()?.cur || 0) > 0);   // 7.1.30: пока экран победы виден, бой не «начат» — иначе «Охотиться дальше» жмётся дважды
      let ok = await env.waitFor(started, 8000, 50);
      // 10.0 (лог 12.10, 7 раз за 47 мин: сервер отвечает на hunt-continue через ≈8,4 с, бот уходил на карту за 0,3 с до ответа):
      // запрос ушёл и ещё в полёте — ждём до 15 с
      const net = env.actNet?.();
      if (!ok && env.on && net && net.huntT >= t0 && !((net.huntDoneT || 0) >= net.huntT)) ok = await env.waitFor(started, 7000, 50);
      if (ok || !env.on) return;
      console.info(env.TAG, '«Охотиться дальше» не сработало — иду на карту');
    }
  }
  await env.toMap();
}

async function mapReady(timeout = 30000, label = '') {   // список мобов отрисован и не меняется (игра грузит его до ~10–20 с)
  let prev = '', same = 0;
  const t0 = Date.now(); let sec0 = -1;
  return env.waitFor(() => {
    const sec = (Date.now() - t0) / 1000 | 0;
    if (label && sec >= 2 && sec !== sec0) { sec0 = sec; env.rt = { ...env.rt, status: `${label} · ${sec} с` }; env.draw(); }   // только индикатор, без записи в журнал
    if (env.serverDown()) return 'down';           // страница ошибки сервера — ждать список бессмысленно
    if (!env.$q('#map-mob-list')?.dataset.l2AroundSig || !pagerInfo() || !pageItems().length) { same = 0; return false; }
    const k = (env.$q('#map-mob-page-ind')?.textContent || '') + '|' + pageItems().length;   // порядок строк не учитываем
    same = k === prev ? same + 1 : 0;
    prev = k;
    return same >= 2;
  }, timeout, 250);
}

// 8.0.3 (лог 11.10 11:43:44 → 11:45:53): «мягкое окно» уровней (20 мин бить мобов ниже/выше окна) открылось в Sea of Spores при выключенном
// автофарме, а после смерти и ▶ с «Автофармом» действовало в Bee Hive — бот бил Ant Soldier 35 и Ant Larva 29 героем 56. Окно — только на той
// локации, где его открыли, и открытое без автофарма при автофарме не действует (тот сам летит в зону своего уровня)
const relaxOk = r => !!r && Date.now() - (r.t || 0) < 20 * 60000 && (r.zone || null) === (env.rt.zone || null) && (!env.cfg.zoneAuto || !!r.auto);
let farRecT = 0;
function candidates(rules, sig, types, limitIdx) {
  const out = [];
  // 8.0.3 (игрок 11.10: «поиск чемпионов по умолчанию откл.»): пока «Искать чемпионов» выключено (и глава не просит чемпионов),
  // чемпион — обычный моб: без окна до −8 ур. и без особой ценности (бот не тянется к ним сам)
  const champOn = champRuleOn();
  const hl0 = env.heroLvl() || env.rt.lvl || 0;
  // 10.0.5: «FA с чемпионов» (cfg.champFa, по умолчанию ВКЛ) — оранжевый/красный чемпион не ниже героя −5 (шанс FA 20/60 %) идёт сразу
  // после ★ квеста и источников ресурса, даже при выключенном «Искать чемпионов». Только из списка этой локации: бот никуда не летит
  const pos = rules.filter(x => !x.neg), faRank = pos.findIndex(x => !(x.quest || x.farm));
  sig.ids.forEach((id, idx) => {
    if (idx >= limitIdx || env.isRaidId(id) || types[id] === 'raid' || types[id] === 'epic_guard') return;
    const c = env.rt.spawns?.[id];
    const minL = env.campChampMin();
    const champ = types[id] === 'champion' && !(minL && c && c[1] && c[1] < minL);
    if (!c && !champ) return;                  // имя неизвестно и не чемпион — оценить нельзя
    const name = c ? c[0] : '', lvl = c ? c[1] : 0;
    const r = { id, idx, name, lvl, champ, boss: !!name && env.isBoss(name),
                quest: !!name && env.isQuestName(name, sig.quest) };
    if (champ) { r.tier = champTier(id); r.fa = faChance(true, r.tier, lvl, hl0); }
    // моб на 7+ ур. выше: атака почти не попадает (лог 20:20: Bloody Banshee 74 при герое 41 — атака 1–2 урона,
    // бой 26 с вместо 3). Такие — не цели, даже если чемпионы. Цели квеста — до +10
    const hl = env.heroLvl() || env.rt.lvl || 0;   // 8.0.3: уровень в шапке ещё не прочитан — последний известный (без него окно уровня не работало)
    // v5.6: чемпион открытой главы — цель квеста: окно «не ниже героя на N» и «не по зубам» к нему не применяем
    // (глава «Champions · Lv.24» при герое 31 — все чемпионы 24–27 отсекались окном lvlBelow 3)
    // 7.2: моб-источник ресурса/рецепта (правило farm) — как цель квеста: зона выбрана под него (до −10 ур.), окно уровней не отсекает
    const farmT = !!name && rules.some(x => x.farm && x.name === name.toLowerCase());
    const qLike = r.quest || farmT || (champ && env.campActive() && env.campChampOpen());
    // v4.58: «мягкое окно» — улететь в зону своего уровня не вышло, а тут все выше: 20 мин бьём самых слабых из тех, что есть
    const relax = relaxOk(env.rt.lvlRelax) ? env.rt.lvlRelax.up : 0;
    if (hl && lvl && lvl > hl + Math.max(qLike ? 10 : 0, env.cfg.lvlAbove ?? 15, relax)) return;
    // v4.44: и не ниже героя больше чем на lvlBelow (по умолчанию 5): после смерти бот бил пауков 15 ур. героем 49
    const relaxDown = relaxOk(env.rt.lvlRelaxDown);   // 7.1.30: и при автофарме, если улететь не вышло (8.0.3: только на той же локации)
    // 8.0 (аудит фарма A4, лог 10.10 20:08:57: чемпион «Probe Golem Prodigy IV (46)» в Pavel Ruins при герое 51 окно −3 отсекало):
    // чемпион даёт в 5–10 раз больше опыта обычного моба (≈29 тыс. против ≈3,5–6 тыс., лог 20:20–20:30) — для чемпионов нижняя
    // граница не −lvlBelow, а −8 (если игрок не поставил шире)
    const below = champ && champOn ? Math.max(env.cfg.lvlBelow ?? 3, CHAMP_BELOW) : (env.cfg.lvlBelow ?? 3);
    if (hl && lvl && !qLike && !relaxDown && env.cfg.lvlBelow !== 0 && lvl < hl - below) return;
    // «не по зубам» по опыту: бой с этим видом шёл дольше 45 с (или урон ≈0) — пропускаем 2 часа (v4.23)
    // 9.2.2 (лог 12.10 07:22–07:34, спойлер): источник ресурса (farmT, цель Маммона «Mithril Ore») обходил «не по зубам», а бой
    // (combat: «не по зубам» прощает только ★ квест) сразу возвращал на карту — 12 мин по кругу карта → Guardian Basilisk → карта.
    // Теперь исключение — только ★ квест и чемпион главы (как в бою); источник ресурса «не по зубам» 2 ч не выбираем
    const hard = env.rt.hardMobs?.[(name || '').toLowerCase()];
    if (hard && Date.now() - hard.t < 7200000 && !(r.quest || (champ && env.campActive() && env.campChampOpen()))) return;
    let k = rank(r, rules);
    const faHot = k >= 0 && env.cfg.champFa !== false && (r.fa || 0) >= FA_P.orange && faRank >= 0;
    if (faHot) k = Math.min(k, faRank);
    if (k >= 0) out.push({ ...r, rank: k, ql: qLike, faHot });
  });
  return mobValRank(out, champOn);
}

// 8.0 (аудит фарма B1): среди целей одного приоритета — самая выгодная, а не ближайшая. Раньше в строке «[все]» бот брал первого
// в списке карты, а виды одной зоны различаются в 2–2,5 раза (лог 10.10 20:09–20:20, Pavel Ruins, время между победами):
// Deadly Ginzu Golem ≈4,5 тыс. EXP за ≈3,6 с (≈1260 EXP/с) против Horrifying Jackhammer Golem ≈2,2 тыс. за ≈4,6 с (≈490 EXP/с).
// Ценность вида — EXP за секунду (rt.mobVal: замеры после каждой победы, время приведено к цепочке), листание страницы ≈0,6 с;
// без замера — медиана зоны (чемпион — ×3: Blazing Swamp 20:20–20:30 — ≈29 тыс. EXP за ≈11 с против ≈870 EXP/с у зоны), при равенстве — выше уровнем
// (до героя +5; кто ещё выше — тем позже: без замеров к ним не тянемся), ближе — только последним. Вид с замером (≥3 боя) ниже 0,7 медианы зоны — не цель,
// если есть другие (★ цели квеста и источники ресурса не отсекаются)
const CHAMP_BELOW = 8, PAGE_S = 0.6, MOBVAL_MAX = 150, MOBVAL_N = 30;
const mobKey = (name, champ) => (champ ? 'ч:' : '') + String(name || '').toLowerCase();
const medOf = xs => { const a = xs.filter(v => v > 0).sort((p, q) => p - q), m = a.length >> 1; return !a.length ? 0 : a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
function mobEps(name, champ) {                   // EXP/с вида моба по замерам (обычный — от 3 боёв, чемпион — от 1) или null
  const v = name ? env.rt.mobVal?.[mobKey(name, champ)] : null;
  return v && v.n >= (champ ? 1 : 3) && v.sec > 0 && v.exp > 0 ? v.exp / v.sec : null;
}
function mobValRank(out, champOn = champRuleOn()) {
  const hl = env.heroLvl() || 0, V = env.rt.mobVal || {};
  const zMed = medOf((env.rt.zoneMobs?.[env.rt.zone] || []).map(n => mobEps(n, false) || 0));
  const zn = (env.rt.zoneMobs?.[env.rt.zone] || []).filter(n => mobEps(n, false)).length;
  const med = zn >= 3 ? zMed : medOf(out.filter(c => !c.champ).map(c => mobEps(c.name, false) || 0));
  const chMed = medOf(Object.entries(V).filter(([k, v]) => k.startsWith('ч:') && v.sec > 0).map(([, v]) => v.exp / v.sec));
  const sk = medOf(Object.values(V).filter(v => v.n >= 3 && v.sec > 0).map(v => v.sec / v.n)) || 4;   // типичное время на моба, с
  for (const c of out) {
    const ch = c.champ && champOn;                 // 8.0.3: особая ценность чемпиона — только при включённом поиске чемпионов
    const raw = mobEps(c.name, ch), pg = Math.floor(c.idx / env.PAGE_SIZE);
    const v = raw ?? (ch ? chMed || med * 3 : med);
    c.eps = raw;
    c.val = v > 0 ? v * sk / (sk + PAGE_S * pg) : 0;   // с учётом листания до его страницы
    c.low = zn >= 3 && raw != null && !ch && !c.ql && raw < 0.7 * zMed;
  }
  const keep = out.filter(c => !c.low);
  const list = keep.length ? keep : out;
  const cap = hl ? hl + 5 : 999, lv = c => (c.lvl || 0) <= cap ? c.lvl || 0 : 2 * cap - c.lvl;   // выше героя +5 — чем выше, тем позже
  // 10.0.5: в одном приоритете FA-чемпион (оранжевый/красный в окне −5) первым, красный раньше оранжевого
  return list.sort((a, b) => a.rank - b.rank || (b.faHot ? b.fa : 0) - (a.faHot ? a.fa : 0) || b.val - a.val || lv(b) - lv(a) || a.idx - b.idx);   // приоритет, FA, выгода, уровень, ближе
}
// после победы (из trackEfficiency, без ожидания): EXP и время на этот вид — скользящее по ≈30 последним боям
function mobValNote(name, champ, exp, sec) {
  if (!name || !(exp > 0) || !(sec > 0)) return;
  const V = { ...(env.rt.mobVal || {}) }, k = mobKey(name, champ), o = V[k] || { n: 0, exp: 0, sec: 0 };
  // 9.0 (сабклассы, 11.10: у каждого класса свой уровень и скиллы): замер помечен классом героя (rt.prof); другой класс — замер с нуля
  const c = env.rt.prof || undefined, same = !o.c || !c || o.c === c, b = same ? o : { n: 0, exp: 0, sec: 0 }, f = b.n >= MOBVAL_N ? (MOBVAL_N - 1) / MOBVAL_N : 1;
  V[k] = { n: Math.min(MOBVAL_N, b.n + 1), exp: Math.round(b.exp * f + exp), sec: +(b.sec * f + sec).toFixed(1), t: Date.now(), ...(c ? { c } : {}) };
  const ks = Object.keys(V);
  if (ks.length > MOBVAL_MAX) ks.sort((a, b) => (V[a].t || 0) - (V[b].t || 0)).slice(0, ks.length - MOBVAL_MAX).forEach(x => delete V[x]);
  return env.setRt({ mobVal: V });
}

async function attackSpawn(c, label) {
  const page = Math.floor(c.idx / env.PAGE_SIZE) + 1;
  const sel = `#map-mob-list a[href*="spawnId=${CSS.escape(c.id)}"]`;
  if (!(await env.gotoPage(page)) || !env.on) return false;
  let a = env.$q(sel);
  for (const d of [1, -1]) { if (a || !env.on) break; if (await env.gotoPage(page + d)) a = env.$q(sel); }
  if (!a || !env.on) return false;
  const it = pageItems().find(x => x.id === c.id);
  if (it) Object.assign(c, { name: c.name || it.name, lvl: c.lvl || it.lvl, quest: c.quest || it.quest, champ: c.champ || it.champ });
  env.setStatus(label(c));
  console.log(env.TAG, 'цель:', c.id, c.name, '| поз.', c.idx);
  await env.pause();
  if (!env.on) return true;
  await env.setRt({ target: { name: c.name, champ: c.champ, quest: c.quest, rb: !!c.rb, ...(c.champ ? { tier: c.tier || champTier(c.id, a) } : {}) }, mobClickAt: Date.now(), via: 'map' });
  if (c.faHot) env.rec('B', 'чемпионы', `${c.name} (${c.lvl}, ${TIER_RU[c.tier] || c.tier}) — бью ради FA: шанс ${Math.round(c.fa * 100)} %`);
  env.fire(a);
  if (!(await env.waitFor(env.isBattle, 10000)) && env.on) {   // бой не открылся — обновляем карту; стоп только после 3 раз подряд
    const n = (env.rt.clickFail || 0) + 1;
    if (n >= 3) { await env.setRt({ clickFail: 0 }); await env.halt('Клик по мобу 3 раза подряд не открыл бой — проверьте игру'); return true; }
    await env.setRt({ clickFail: n });
    env.rec('B', 'карта', `клик по «${c.name}» не открыл бой — обновляю карту (${n}/3)`);
    location.reload(); await env.sleep(8000);
  } else if (env.rt.clickFail) await env.setRt({ clickFail: 0 });
  return true;
}

// 10.0.5: «Только задачи» — бить мобов можно только на точке активной цели фарма ресурса/рецепта (зона известна и совпадает)
function tasksGoalHere() { const g = env.lootGoal?.(); return !!g && !!env.rt.zone && env.rt.zone === g.zone; }

async function map() {
  // защита от петли «клик по мобу → снова карта»
  if (env.rt.mobClickAt && Date.now() - env.rt.mobClickAt < 8000) {
    const n = (env.rt.bounce || 0) + 1;
    await env.setRt({ bounce: n, mobClickAt: 0 });
    if (n >= 3) return env.halt('Клик по мобу 3 раза вернул на карту — пришлите лог');
    env.setStatus(`Бой не открылся (${n}/3), пауза 5 с`);
    await env.sleep(5000);
    if (!env.on) return;
  }
  if (env.shown(env.$q('#map-defeat-root'))) return env.onDeath();
  if (await env.townBuffStart('баффов нет')) return;

  env.setStatus('Карта: жду список мобов');
  await env.sleep(env.rnd(150, 300));
  if (!env.on) return;
  const tab = env.$q('#map-list-mode-mobs');        // открыта вкладка NPC — переключаем на «Мобы»
  if (tab && !tab.classList.contains('is-active')) { env.fire(tab); await env.sleep(500); }
  const mr = await mapReady(30000, 'Карта: жду список мобов');
  if (mr === 'down' || env.serverDown()) return;     // ошибка сервера — разберётся главный цикл (ожидание без остановки)
  if (!mr && env.on && !pageItems().length) {
    const n = (env.rt.mapReload || 0) + 1;
    if (n > 3) {                                 // сервер/интернет лежит: ждём и пробуем снова; стоп — если так 15 мин
      const down = env.rt.mapDownT || Date.now();
      if (Date.now() - down > 15 * 60000) { await env.setRt({ mapReload: 0, mapDownT: 0 }); return env.halt('Список мобов не грузится 15 минут — проверьте игру/интернет'); }
      await env.setRt({ mapReload: 0, mapDownT: down });
      env.rec('B', 'карта', 'список мобов не грузится — жду 2 мин и пробую снова');
      await env.idle(120000, 'Игра не отвечает — жду и пробую снова');
      location.reload(); await env.sleep(8000); return;
    }
    await env.setRt({ mapReload: n });
    env.rec('B', 'карта', `список мобов не загрузился за 30 с — перезагрузка ${n}/3`);
    env.setStatus(`Список мобов не загрузился — обновляю карту (${n}/3)`);
    location.reload(); await env.sleep(8000); return;
  }
  if (!env.on) return;
  if (!pageItems().length) {                     // пустой список — как «не загрузился»: обновить (до 3 раз)
    const n = (env.rt.mapReload || 0) + 1;
    if (n > 3) { await env.setRt({ mapReload: 0 }); return env.halt('Не вижу список мобов — проверьте игру'); }
    await env.setRt({ mapReload: n }); location.reload(); await env.sleep(8000); return;
  }
  if (env.rt.mapReload || env.rt.mapDownT) await env.setRt({ mapReload: 0, mapDownT: 0 });

  if (env.cfg.rbMode || env.farmRbOn()) {
    // все РБ локации — в базу (видно игроку, даже вне уровня)
    // 8.0.3: зона РБ — только определённая на месте (сразу после перелёта «Телепортом» rt.zone ещё прежняя; телепорт к РБ и смерть её сбрасывают)
    const seen = { ...(env.rt.rbSeen || {}) }, zNow = !(env.rt.zonePend && Date.now() - (env.rt.zonePend.t || 0) < 120000) && env.rt.zone || null;
    env.raidList().forEach(r => { seen[r.id] = { name: r.name, lvl: r.lvl, inRange: r.lvl >= env.rbLo(env.heroLvl()) && r.lvl <= env.rbHi(env.heroLvl()), zone: zNow || seen[r.id]?.zone || null, seenT: Date.now() }; });
    const rbs = env.rbCandidates(), me = env.meHp();
    await env.setRt({ rbSeen: seen, rbPending: rbs.length > 0, sinceRb: 0 });
    const bw = rbs.length && me && me.pct >= env.cfg.rbRestHp ? env.buffWaitBeforeRb() : null;
    if (bw) { env.setRt({ status: `РБ ${rbs[0].name}: жду откат «${bw.who}» ${bw.s} с` }); env.draw(); await env.sleep(Math.min(bw.s, 10) * 1000); return; }
    if (rbs.length && me && me.pct >= env.cfg.rbRestHp) {
      const r = rbs[0];
      await env.setRt({ rbCur: r.id });
      const d = env.rt.rbDb?.[r.id];
      const lbl = c => `РБ: ${c.name} (${c.lvl})${d?.verdict === 'ok' ? ' ✅' : d?.verdict === 'chip' ? ' ⚠' : ' ❔'}`
          + (env.rt.rb?.[c.id]?.hpAfter ? ` · у него ${env.rt.rb[c.id].hpAfter}/${env.rt.rb[c.id].max}` : '');
      if (await env.townBuffStart(`перед РБ ${r.name}`, true)) return;   // v5.3: бафф слетел — сначала баффер, потом РБ
      const res = await env.rbEngage(r, lbl(r));              // v4.46: оценка до боя по окну РБ
      if (res === true) return;
      if (res === 'skip') { await env.setRt({ rbCur: null }); return; }
    } else if (rbs.length) {
      env.setStatus(`РБ ждёт: HP ${me ? me.pct | 0 : '?'}% < ${env.cfg.rbRestHp}% — лечусь на мобах`);
      await env.sleep(600);
    } else {
      env.setStatus(`РБ по силам нет (ур. ${env.rbLo(env.heroLvl())}–${env.rbHi(env.heroLvl())}) — фармлю обычных`);
      await env.setRt({ rbCur: null, rbZoneVisit: { ...(env.rt.rbZoneVisit || {}), [env.rt.zone || '?']: Date.now() } });
      // тур по РБ (v4.23): здесь РБ нет — не фармим, а сразу летим дальше. Сначала — список зон из «Телепорта»
      // (бесплатно), потом по очереди: знакомые РБ → РБ с форума → разведка зон по уровню. Мобов фармим,
      // только когда все подходящие зоны уже обойдены за последние 40 мин
      if (env.cfg.rbMode && env.cfg.rbTour !== false && !env.campActive() && Date.now() - (env.rt.zoneGoT || 0) > 8000) {   // v5.6: тур — только в «Фарм РБ», не при походе за ресурсом
        // v4.27: главный источник — список РБ игры (Меню → Рейдовые боссы): живые, разрешённые, с телепортом прямо к ним
        if (!env.rt.rbListT || Date.now() - env.rt.rbListT > 15 * 60000) { await env.setRt({ rbScan: true }); location.href = '/rb-bosses.html'; await env.sleep(4000); return; }
        const rp = env.rbListPick();
        if (rp) { await env.setRt({ rbGo: { id: rp.id, name: rp.name, lvl: rp.lvl, page: rp.page, price: rp.price, t: Date.now() }, rbTourWhy: '', rbTourNext: 0 }); return; }
        if (!env.rt.zoneCatT) { env.rec('B', 'РБ-тур', 'списка зон ещё нет — читаю «Телепорт»'); await env.setRt({ zoneScan: true }); location.href = '/teleport.html'; await env.sleep(4000); return; }
        const pick = env.rbTourPick();
        if (pick) {
          env.rec('B', 'РБ-тур', `здесь (${env.zoneName(env.rt.zone)}) РБ по силам нет → ${env.zoneName(pick.id)}: ${pick.why}`);
          await env.setRt({ zoneGo: { id: pick.id, url: pick.url || null, t: Date.now(), why: 'РБ-тур: ' + pick.why }, zoneGoT: 0, rbTourWhy: '' });
          return;
        }
        if (env.rt.rbTourWhy !== 'none') env.rec('B', 'РБ-тур', `все подходящие зоны (${Object.keys(env.rt.rbZoneVisit || {}).length}) обойдены за 40 мин — фармлю обычных здесь, проверяю снова через 3 мин`);
        await env.setRt({ rbTourWhy: 'none', rbTourNext: Date.now() + 180000 });
      }
      await env.sleep(600);
    }
  }

  // глава требует убить РБ («★ Рейдовый босс: Емісар Нурки»): ищем его метку на карте и идём, когда HP полное.
  // Бой — та же логика, что в «Фарм РБ»: оценка «убьём ли», банки, отход и заходы, если не по силам за раз
  if (env.campRbOpen().length) {
    const want = env.campRbOpen()[0], me = env.meHp();
    const r = env.raidList().find(x => x.idx >= 0 && env.nameLike(x.name, want.name));
    const key = r ? 'see:' + r.id : 'none';
    if (env.rt.campRbSeen !== key) { env.rec('B', 'РБ главы', r ? `«${want.name}» на карте (ур. ${r.lvl}) — иду, когда HP ≥ ${env.cfg.rbRestHp}%` : `«${want.name}» на карте не виден (убит/не появился) — фармлю, проверяю карту каждые 3 боя`); await env.setRt({ campRbSeen: key }); }
    if (r && env.rbVerdictBlocks(r.id)) env.setStatus(`РБ главы ${want.name}: не по силам на ур. ${env.heroLvl()} — фармлю и расту`);
    else if (r && me && me.pct >= env.cfg.rbRestHp) {
      await env.setRt({ rbCur: r.id });
      const d = env.rt.rbDb?.[r.id];
      const done = await attackSpawn({ ...r, rb: true, champ: true, rank: 0 },
        c => `РБ главы: ${c.name} (${c.lvl})${d?.verdict === 'ok' ? ' ✅' : d?.verdict === 'chip' ? ' ⚠ заходами' : ''}`
          + (env.rt.rb?.[c.id]?.hpAfter ? ` · у него ${env.rt.rb[c.id].hpAfter}/${env.rt.rb[c.id].max}` : ''));
      if (done) return;
      // в списке не нашёлся — через метку на карте: «Емісар Нурки · ур. 33 · рейд-босс» → окно → «В бой»
      const pin = env.$q(`.l2-map-mob-pin--raid[data-spawn-id="${CSS.escape(r.id)}"]`);
      if (pin && env.on) {
        env.fire(pin);
        const go = await env.waitFor(() => { const a = env.$q('#map-mob-modal-battle'); return env.shown(a) ? a : null; }, 3000, 100);
        await env.setRt({ target: { name: r.name, champ: true, quest: true, rb: true }, mobClickAt: Date.now(), via: 'map' });
        if (go) env.fire(go); else location.href = '/battle.html?spawnId=' + encodeURIComponent(r.id);
        await env.waitFor(env.isBattle, 10000);
        return;
      }
    } else if (r) env.setStatus(`РБ главы ${want.name}: жду HP ${me ? me.pct | 0 : '?'}% → ${env.cfg.rbRestHp}% — фармлю`);
  }

  const rules = parseRules();
  if (!rules.some(x => !x.neg)) return env.halt('Список приоритетов пуст');
  // 7.1.30: «Автофарм» включили / нажали «Старт» с ним — сразу проверяем локации, не дожидаясь 10 мин после боя:
  // каталог зон «Телепорта» (устарел — перечитать), мобов своего уровня тут нет — в зону своего уровня, иначе — лучшая/пробная зона
  // 7.2: есть цель «ресурс»/«рецепт» — при старте сразу к её источнику (раньше — сначала в зону для опыта, потом обратно)
  const lg = !env.campActive() && !rbHold() && !env.cfg.fishMode ? env.lootGoal?.() : null;
  if (lg && env.rt.zone !== lg.zone) {
    if (env.rt.zoneAutoKick) await env.setRt({ zoneAutoKick: null });
    if (lg.kind === 'farm' ? await env.farmStep() : await env.recipeStep()) return;
  }
  if (env.cfg.zoneAuto && env.rt.zoneAutoKick && !lg && !env.campActive() && !rbHold() && !env.cfg.fishMode) {
    if ((!env.rt.zoneCatT || env.zoneCatThin() || Date.now() - env.rt.zoneCatT > 24 * 3600000) && ((env.rt.zoneCatFail || 0) < 3 || Date.now() - (env.rt.zoneCatFailT || 0) > 3600000)) {
      env.rec('B', 'локации', 'автофарм: при старте читаю список зон «Телепорта»');
      await env.setRt({ zoneScan: true }); location.href = '/teleport.html'; await env.sleep(4000); return;   // kick остаётся — после чтения выбор зоны
    }
    await mapReady(15000);
    // 8.0.3 (лог 11.10 11:45:34): после смерти «проверил локации — остаюсь здесь (sea_of_spores)» решалось по зоне до смерти (зону по карте
    // бот определял только после этого блока), и герой 56 остался бить мобов 15–35 ур. в Bee Hive. Сначала — зона по этой карте и уровень
    // героя; не прочитались — решаем на следующем проходе карты (kick остаётся), а сейчас фармим как обычно
    await env.absorb();
    if (env.rt.zone && (env.heroLvl() || await env.waitFor(() => env.heroLvl(), 3000, 200))) {
      await env.setRt({ zoneAutoKick: null, zoneLvlT: 0 });
      if (await env.zoneForLevel()) return;
      const pick = env.zonePick();
      if (pick) { env.rec('B', 'локации', `автофарм: при старте → ${pick.name || pick.id}`); await env.setRt({ zoneGo: { ...pick, t: Date.now() }, zoneGoT: 0 }); location.href = '/teleport.html'; await env.sleep(4000); return; }
      env.rec('B', 'локации', `автофарм: проверил локации — остаюсь здесь (${env.zoneName(env.rt.zone)})`);
      await env.setRt({ zoneGoT: Date.now() });
    }
  }

  let sig = aroundSig();
  await env.absorb();
  // 10.0.5 (лог 12.10 01:29:58–01:30:25, «почему в режиме „только задачи“ автофармит мобов»): без режима мобов бьём только на точке
  // цели фарма ресурса/рецепта. Раньше карта в Окрестностях сразу выбрала Vampire Soldier (71), и лишь после боя бот полетел за
  // Oriharukon Ore: farmStep не летит 3 мин после прошлого перелёта (zoneGoT), и в это время map() бил всех подряд
  if (env.autonomyMode() === 'tasks' && !tasksGoalHere()) {
    const g = env.lootGoal?.();
    env.setStatus(g ? `⏹ Только задачи: цель фарма «${g.name}» — жду перелёта к её точке, здесь мобов не бью` : '⏹ Только задачи: мобов не бью');
    await env.sleep(2000); return;
  }
  // ★ цели: из подписи карты + ★ в строках списка (несюжетные квесты); в «оригинальном» написании имён
  // только свежие (до 6 ч, как в isQuestName) и только мобы текущей зоны: раньше ★ из прошлой локации
  // (Leto Lizardman Warrior в Hot Springs) висела в «На локации» и считалась квестовой целью бесконечно
  const zMobs = (env.rt.zoneMobs?.[env.rt.zone] || []).map(n => n.toLowerCase());
  const seenQ = Object.entries(env.rt.questSeen || {}).filter(([k, t]) => Date.now() - t < 6 * 3600000 && (!zMobs.length || zMobs.includes(k)))
    .map(([k]) => Object.values(env.rt.spawns || {}).find(v => v[0].toLowerCase() === k)?.[0] || k);
  await env.setRt({ questTargets: [...new Set([...sig.quest, ...seenQ])] });

  // цели главы (мобы и чемпионы) ищем по всему списку локации, а не только на первых страницах
  // 7.1.30: и открытые цели квеста профессии (Giant Fungus лежал на 25-й стр. списка из 26)
  const zMq = (env.rt.zoneMobs?.[env.rt.zone] || []).map(n => n.toLowerCase());
  const profOpen = ((env.rt.profQuest?.open || []).length > 0 && Date.now() - (env.rt.profQuest.t || 0) < 3600000)
    || (sig.quest || []).some(n => zMq.includes(String(n).toLowerCase()) && env.isQuestName(n));   // 7.1.30: ★ цель есть на этой локации — ищем по всему списку
  const deep = env.mapDue(rules) || env.campMobOpen().length > 0 || (env.campActive() && env.campChampOpen()) || profOpen;
  const limitIdx = deep ? sig.ids.length : env.cfg.maxPages * env.PAGE_SIZE;

  // изучить страницы с ещё неизвестными мобами (только если цели высшего приоритета пока нет)
  const unknownPages = [...new Set(sig.ids.map((id, i) => [id, i])
    .filter(([id, i]) => i < limitIdx && !env.isRaidId(id) && !env.rt.spawns?.[id])
    .map(([, i]) => Math.floor(i / env.PAGE_SIZE) + 1))].sort((a, b) => a - b);
  // изучать имена незачем, если уже есть цель лучшего «именного» правила (чемпионов видно по меткам и без имён)
  const pos = rules.filter(x => !x.neg), named = Math.max(0, pos.findIndex(x => !(x.champ && !x.quest && !x.name)));
  const best0 = candidates(rules, sig, markerTypes(), limitIdx)[0];
  if (unknownPages.length && !(best0 && best0.rank <= named)) {
    const cap = env.campMobOpen().length ? 30 : 6;     // ищем цели главы — изучаем локацию целиком за один заход
    for (const [k, p] of unknownPages.slice(0, cap).entries()) {
      env.setStatus(`Изучаю список локации: стр. ${p} (${k + 1}/${Math.min(cap, unknownPages.length)} из ${unknownPages.length})`);
      if (!(await env.gotoPage(p)) || !env.on) break;
      await env.absorb();
    }
    if (!env.on) return;
    sig = aroundSig();
  }
  // глава: открытые мобы-цели должны быть в списке ЭТОЙ локации. Подпись карты «q…» тут не помогает —
  // она перечисляет цели квеста на любой локации. Смотрим имена мобов (кэш спавнов), когда список изучен ≥85 %.
  // Так было: телепорт «без сообщения» → 15 мин фарма Plains of Dion вместо Fortress of Resistance.
  const open = env.campMobOpen();
  if (open.length) {
    const ids = sig.ids.filter(id => !env.isRaidId(id) && !/^dung_/.test(id));
    const known = ids.filter(id => env.rt.spawns?.[id]).length / Math.max(1, ids.length);
    const here = ids.some(id => open.includes((env.rt.spawns?.[id]?.[0] || '').toLowerCase()));
    if (!here && known >= 0.85 && (env.rt.wrongLoc || 0) < 3) {
      await env.setRt({ wrongLoc: (env.rt.wrongLoc || 0) + 1, lastTeleport: '', campaignDue: true });
      env.rec('B', 'локация', `целей главы (${open.join(', ')}) в списке локации нет (изучено ${Math.round(known * 100)} %) — телепорт заново ${env.rt.wrongLoc}/3`);
      env.setStatus(`Цели главы не на этой локации — телепорт заново (${env.rt.wrongLoc}/3)`);
      return env.goCampaign();
    }
    if (here && env.rt.wrongLoc) await env.setRt({ wrongLoc: 0 });
  }

  let cands = candidates(rules, sig, markerTypes(), limitIdx);
  // 7.2.1 (лог 10.10 21:17:34): после города «В Окрестности» ближе всего — мобы 69–78 ур., и бот улетел в Pavel Ruins (≈2,6 M EXP/ч),
  // хотя в этой же локации дальше по списку — мобы 54–63 ур. (замер тут ≈4,45 M EXP/ч на 52 ур.). Ближние страницы без своих —
  // сперва свои по всей локации (имена из кэша спавнов), телепорт — только если их нет нигде
  if (!cands.length && !deep && limitIdx < sig.ids.length) {
    const far = candidates(rules, sig, markerTypes(), sig.ids.length);
    if (far.length) {
      if (Date.now() - farRecT > 600000) { farRecT = Date.now(); env.rec('B', 'локации', `рядом мобов своего уровня нет — иду к ${far[0].name || '?'} (${far[0].lvl || '?'}) на стр. ${Math.floor(far[0].idx / env.PAGE_SIZE) + 1} этой же локации, без телепорта`); }
      cands = far;
    }
  }
  if (env.campActive() && env.campChampOpen()) {          // сколько чемпионов главы сейчас на локации — в журнал при изменении
    const ch = cands.filter(c => c.champ), key = ch.length + ':' + (ch[0]?.id || '');
    if (env.rt.champSeen !== key) {
      const ct = env.campOpen().find(t => t.champ);
      env.rec('B', 'чемпионы', ch.length ? `на локации ${ch.length}: ${ch.slice(0, 3).map(c => `${c.name || '?'} (${c.lvl || '?'})`).join(', ')} — иду к ближайшему (глава: ${ct.done}/${ct.total})`
        : `чемпионов на локации сейчас нет (глава: ${ct.done}/${ct.total}) — бью цели главы, проверяю карту чаще`);
      await env.setRt({ champSeen: key });
    }
  }
  if (deep) {
    const near = cands.find(c => c.idx < env.cfg.maxPages * env.PAGE_SIZE);
    // «горячая» карта (идти на неё после каждого боя) — только для ★ квестовых целей и чемпионов главы.
    // Обычные чемпионы ([чемп] по галочке) — плановая проверка раз в N боёв, между ними цепочка (v4.28:
    // лог 23:08–23:10 — 6 чемпионов подряд через карту, по 15–17 с на каждый, цепочка простаивала)
    const hot = !!cands[0] && (cands[0].quest || (env.campActive() && env.campChampOpen() && cands[0].champ)) && (!near || cands[0].rank < near.rank);
    await env.setRt({ sinceDeep: 0, deepHot: hot });
  }
  // 7.1.30: «Сам подбирать локацию» выключен — с локации НЕ улетаем никогда (лог 14:12: бот улетел из Sea of Spores в Enchanted Valley).
  // Мобы тут ниже окна уровня — бьём их (окно снизу снимается на 20 мин, продлевается)
  if (!cands.length && !env.campActive() && env.cfg.zoneAuto && !(env.lootGoal?.()?.zone === env.rt.zone) && await env.zoneForLevel()) return;
  if (!cands.length && !env.campActive()) {   // 7.1.30: автофарм включён, а улететь некуда — тоже бьём, что есть, а не «Целей нет» до остановки
    const hl = env.heroLvl(), lv = pageItems().filter(i => !i.champ && !i.boss && i.lvl).map(i => i.lvl);
    const downOn = relaxOk(env.rt.lvlRelaxDown);
    const lo = hl - (env.cfg.lvlBelow ?? 3);   // 7.1.30: РБ/охрана эпика не считаются; хватит того, что есть мобы ниже окна
    if (hl && lv.length && lv.some(l => l < lo) && !downOn) {
      env.rec('B', 'локации', `мобы тут ${Math.min(...lv)}–${Math.max(...lv)} ур. (герой ${hl}) — подбор локации выключен, остаюсь и бью их`);
      await env.setRt({ lvlRelaxDown: { t: Date.now(), zone: env.rt.zone || null, auto: !!env.cfg.zoneAuto } });
      return;
    }
  }   // v4.44: мобов своего уровня нет — в зону своего уровня
  // v4.58: улететь не вышло (нет подходящей зоны / нет кнопки / недавно пробовали), а все мобы тут выше окна —
  // не стоим на «Целей нет»: 20 мин бьём самых слабых из этих (бои > 45 с всё равно отсекаются как «не по зубам»)
  if (!cands.length && !env.campActive()) {
    const hl = env.heroLvl(), lv = pageItems().filter(i => !i.champ && i.lvl).map(i => i.lvl);
    const relaxOn = relaxOk(env.rt.lvlRelax);
    if (hl && lv.length && Math.min(...lv) > hl + (env.cfg.lvlAbove ?? 10) && !relaxOn) {
      const up = Math.min(...lv) - hl;
      env.rec('B', 'локации', `мобов своего уровня нет, в зону своего уровня улететь не вышло — 20 мин бью самых слабых здесь (${Math.min(...lv)} ур., +${up} к герою)`);
      await env.setRt({ lvlRelax: { t: Date.now(), up, zone: env.rt.zone || null, auto: !!env.cfg.zoneAuto } });
      return;                                      // следующий проход выберет цель с «мягким окном»
    }
  }
  if (!cands.length) {
    env.setStatus('Целей нет, обновлю карту через 15 с');
    for (let i = 0; i < 15 && env.on && !env.rt.shop?.urgent; i++) await env.sleep(1000);
    if (env.on) { location.href = '/map.html'; await env.sleep(5000); }
    return;
  }

  // цель могла погибнуть/сдвинуться — пробуем до 5 лучших
  for (const c of cands.slice(0, 5)) {
    if (await attackSpawn(c, c => `Цель: ${c.name || 'чемпион'} (${c.lvl || '?'})${env.tags(c)} · приоритет ${c.rank + 1} · стр. ${pagerInfo()?.cur}`)) return;
    if (!env.on) return;
  }
  env.setStatus('Цели исчезли из списка, ищу заново');
  await env.sleep(1500);
}
 return { FA_P, FA_MOB, FA_BELOW, champTier, faChance, pageItems, pagerInfo, pageKey, aroundSig, markerTypes, netSpawns, parseRules, champRuleOn, chainBetter, chainCarries, ruleMatch, questHere, nameHere, rank, nextFight, mapReady, candidates, mobEps, mobValRank, mobValNote, attackSpawn, map };
 };
})(globalThis);

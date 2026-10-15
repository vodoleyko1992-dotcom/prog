// ===== L2wap Bot — сетевой «жучок» (мир страницы, document_start) =====
// Видит запросы игры к своему серверу (fetch / XMLHttpRequest) и передаёт боту краткую сводку:
// метод, путь, статус, время ответа, тело запроса и ответа (JSON, урезанно). Пароли, токены, сессии — вымарываются.
// Только свой сайт и только JSON; картинки, скрипты и стили не трогаем. Работу игры не меняет: ответ отдаётся как был.
(() => {
  if (window.__l2botHook) return;
  window.__l2botHook = 1;
  const SECRET = /pass(?!ed\b)|token|auth|session|sid\b|cookie|secret|csrf|sign|captcha|email|phone|login|user(?!.?id)|nick|account|jwt|bearer|ticket|api.?key|refresh/i;   // v5.6: + логин/ник/аккаунт; 8.0: + jwt/bearer/ticket/apikey/refresh; 10.0.2: «passed» (проверка активности пройдена) — не пароль
  const SKIP = /\.(png|jpe?g|gif|webp|svg|css|js|mjs|map|woff2?|ttf|ico|mp3|ogg|wav)(\?|$)/i;
  // v5.6: секреты и в адресе (?sid=…&sign=…) — значения таких параметров вымарываем
  const cleanUrl = u => { try { const q = new URLSearchParams(u.search); for (const k of [...q.keys()]) if (SECRET.test(k)) q.set(k, '***'); const t = q.toString(); return u.pathname + (t ? '?' + t : ''); } catch (e) { return u.pathname; } };
  const same = u => { try { const x = new URL(u, location.href); return x.host === location.host && !SKIP.test(x.pathname) ? x : null; } catch (e) { return null; } };
  const redact = (v, d = 0) => {
    if (v == null || typeof v !== 'object') return typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v;
    if (d > 5) return '…';
    if (Array.isArray(v)) return v.length > 8 ? [...v.slice(0, 8).map(x => redact(x, d + 1)), `…ещё ${v.length - 8}`] : v.map(x => redact(x, d + 1));
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET.test(k) ? '***' : redact(x, d + 1);
    return o;
  };
  // 7.2.3: сумка из ответа (character.inventory.stacks) целиком — redact режет массивы до 8 элементов, а боту нужны все
  // количества (заряды, банки). Только [itemId, qty] — ничего личного
  const invOf = o => { try { const st = o?.character?.inventory?.stacks || o?.inventory?.stacks; return Array.isArray(st) ? st.filter(x => x && x.itemId).map(x => [+x.itemId, +x.qty || 0]) : undefined; } catch (e) { return undefined; } };
  // 10.0.2 (Life Stone): надетое оружие и его аугментация (inventory.eq.l1) — redact глубже 5 уровней не пускает. Только id/заточка/исход, без uid
  // 10.0.7 (ценность баффов): цифры героя из ответа /character — M.Atk, P.Atk, шанс/сила крита, баффы, кот (P.Atk, крит, точность)
  const heroOf = o => { try { const c = o?.character; if (!c || typeof c !== 'object' || !(c.mAtk > 0 || c.pAtk > 0) || !Array.isArray(c.activeBuffs)) return undefined;
    const s = c.activeSummon && typeof c.activeSummon === 'object' ? c.activeSummon : null, n = x => (x == null ? null : +x);
    return { lv: n(c.level), matk: n(c.mAtk), patk: n(c.pAtk), mcrit: n(c.mCritPct), mck: n(c.magicCritDamageMultiplier), crit: n(c.critRate), ck: n(c.critDmgMul),
      buffs: c.activeBuffs.slice(0, 60).map(b => +b?.skillId || 0).filter(Boolean), lvls: Object.fromEntries(c.activeBuffs.slice(0, 60).filter(b => b?.skillId).map(b => [+b.skillId, +b.level || 1])),
      cat: s ? { key: String(s.key || '').slice(0, 40), patk: n(s.pAtk), crit: n(s.critRate), ck: n(s.critDmgMul), acc: n(s.accuracy), buffs: (s.activeBuffs || []).slice(0, 10).map(b => +b?.skillId || 0).filter(Boolean) } : null }; } catch (e) { return undefined; } };
  // Warlock: полный безопасный контекст кота из собственного /character; общий redact режет массивы до8.
  const petOf = (u, o) => { try {
    if (u.pathname !== '/character') return undefined;
    const c = o?.character; if (!c || typeof c.name !== 'string' || !Number.isSafeInteger(c.revision)) return undefined;
    const p = c.activeSummon, n = v => Number.isFinite(v) ? v : null;
    return { name: c.name.slice(0,120), level: n(c.level), l2Profession: String(c.l2Profession || '').slice(0,60), revision: c.revision, classSlots: { activeSlot: n(c.classSlots?.activeSlot) },
      ...Object.fromEntries(['mAtk','pAtk','pDef','mDef','maxHp','mCritPct','magicCritDamageMultiplier','critRate','critDmgMul','castSpd','pAtkSpd','castSpeed','attackSpeed'].map(k => [k,n(c[k])])),
      ...Object.fromEntries(['evasion','magicEvasion','shieldDef','shieldRate','fireResist','waterResist','windResist','earthResist','holyResist','darkResist'].map(k=>[k,n(c[k])])),
      toggleStances: Array.isArray(c.toggleStances) ? c.toggleStances.slice(0,80).map(x=>({battleId:String(x.battleId||'').slice(0,80),skillId:n(x.skillId),level:n(x.level),active:x.active===true})) : null,
      // 15.10: /character отдаёт герою expiresAt, слуге expiresAtMs. Сохраняем оба формата в одном поле.
      activeBuffs: Array.isArray(c.activeBuffs) ? c.activeBuffs.slice(0,60).filter(b => b && Number.isFinite(b.skillId)).map(b => ({ skillId:b.skillId, level:n(b.level), expiresAtMs:n(b.expiresAtMs) ?? n(b.expiresAt) })) : null,
      // Публичный состав модели урона: UID/имена владельцев и динамические HP/MP сюда не попадают.
      snapshotGeneratedAt: n(c.snapshotGeneratedAt), inBattle:typeof c.inBattle==='boolean'?c.inBattle:null,
      battleHotbarSlots:Array.isArray(c.battleHotbarSlots)?c.battleHotbarSlots.slice(0,80).map(x=>x?{k:String(x.k||'').slice(0,8),id:n(x.id)}:null):null,
      inventory: c.inventory?.eq && typeof c.inventory.eq === 'object' ? { eq: Object.fromEntries(Object.entries(c.inventory.eq).slice(0,40).map(([slot,v]) => {
        const x = v && typeof v === 'object' ? v : {itemId:v}, attrs = a => Array.isArray(a) ? a.slice(0,20).map(y=>({attributeId:String(y.attributeId||'').slice(0,80),level:n(y.level)})) : [];
        return [slot,{...Object.fromEntries(['itemId','enchant','specialGearLevel','enchantPAtkBonus','enchantMAtkBonus'].map(k=>[k,n(x[k])])),
          augmentation:{outcomeId:String(x.augmentation?.outcomeId||'').slice(0,80)},clanWeaponAttrs:attrs(x.clanWeaponAttrs),clanArmorAttrs:attrs(x.clanArmorAttrs)}];
      })), stacks:Array.isArray(c.inventory.stacks)?c.inventory.stacks.slice(0,2000).map(x=>({itemId:n(x.itemId),qty:n(x.qty)})):null } : null,
      learnedBattleSkillsDetail: Array.isArray(c.learnedBattleSkillsDetail) ? c.learnedBattleSkillsDetail.slice(0,300).map(x=>({battleId:String(x.battleId||'').slice(0,80),level:n(x.level)})) : null,
      activeSummon: p && typeof p === 'object' ? { kind: String(p.kind || '').slice(0,30), key: String(p.key || '').slice(0,60),
        ...Object.fromEntries(['summonSkillId','summonSkillLevel','hp','maxHp','pAtk','mAtk','accuracy','critRate','critDmgMul'].map(k => [k,n(p[k])])),
        activeBuffs: Array.isArray(p.activeBuffs) ? p.activeBuffs.slice(0,60).filter(b => b && Number.isFinite(b.skillId)).map(b => ({ skillId: b.skillId, level: n(b.level), expiresAtMs: n(b.expiresAtMs) })) : null } : p===null?null:undefined };
  } catch (_) { return undefined; } };
  const augOf = o => { try { const eq = o?.character?.inventory?.eq || o?.inventory?.eq; if (!eq || typeof eq !== 'object' || !Object.keys(eq).length) return undefined; const l = eq.l1, a = l && typeof l === 'object' ? l.augmentation : null;
    return { w: l == null ? 0 : typeof l === 'number' ? l : +l.itemId || 0, e: l && typeof l === 'object' ? +l.enchant || 0 : 0, o: a && typeof a.outcomeId === 'string' ? a.outcomeId.slice(0, 40) : null, g: a && a.grade ? String(a.grade).slice(0, 2) : null }; } catch (e) { return undefined; } };
  // 8.0.3 (лог 11.10 11:41–11:44): /game/epic-bosses — ровно 8 эпиков, а redact режет массивы до 8: девятый эпик молча выключил бы разбор
  // (бот берёт список, только если в нём ровно total боссов). Список эпиков — целиком отдельным полем (как inv и sp), каждый — через redact
  // 10.0.2 (таймеры боссов): и /game/raid-bosses — 15 РБ на странице, тоже длиннее 8
  const epicsOf = (u, o) => { try { return /^\/game\/(?:epic|raid)-bosses$/.test(u.pathname) && Array.isArray(o?.bosses) ? o.bosses.slice(0, 200).map(x => redact(x, 1)) : undefined; } catch (e) { return undefined; } };
  const reqBody = b => {
    try {
      if (b == null) return null;
      if (typeof b === 'string') { try { return redact(JSON.parse(b)); } catch (e) { const p = new URLSearchParams(b); const o = {}; for (const [k, v] of p) o[String(k).slice(0, 40)] = SECRET.test(k) ? '***' : v.slice(0, 120); const ks = Object.keys(o); return ks.length && !(ks.length === 1 && o[ks[0]] === '') ? o : '[текст]'; } }   // v5.6: строка-токен целиком не пишем
      if (b instanceof FormData) { const o = {}; for (const [k, v] of b) o[k] = SECRET.test(k) ? '***' : typeof v === 'string' ? v.slice(0, 120) : '[файл]'; return o; }
      if (b instanceof URLSearchParams) { const o = {}; for (const [k, v] of b) o[k] = SECRET.test(k) ? '***' : v.slice(0, 120); return o; }
    } catch (e) {}
    return '[данные]';
  };
  const post = d => { try { window.postMessage({ __l2bot: 'net', ...d }, location.origin); } catch (e) {} };
  const raw = (txt, ct) => { if (!/json/i.test(ct || '') && !/^\s*[[{]/.test(txt || '')) return null; try { return JSON.parse(txt); } catch (e) { return null; } };
  const parse = (txt, ct) => { const o = raw(txt, ct); return o == null ? null : redact(o); };
  // v5.6: список мобов локации (/game/map/spawns → nearbySpawns) — целиком, но кратко: [id, тип, имя, ур.]. Метки карты больше
  // не несут тип моба (остались только РБ), а redact режет массивы до 8 — бот не видел чемпионов вовсе
  const spawns = o => { try { const a = o && Array.isArray(o.nearbySpawns) ? o.nearbySpawns : null;
    return a ? a.slice(0, 3000).map(x => [String(x.id || ''), String(x.kind || ''), String(x.name || '').slice(0, 60), +x.level || 0, +x.distance || 0,
      // 10.0.5 (обновление игры 13.10: FA с чемпионов): цвет чемпиона championTier — blue/orange/red (шанс 1 FA 10/20/60 %)
      x.kind === 'champion' ? String(x.championTier || '').slice(0, 10) : '',
      // 10.0.5: HP и EXP чемпиона (игра отдаёт у всех мобов) — оценка «успею ли убить и окупится ли» до боя (modules/champs.js)
      x.kind === 'champion' ? +x.maxHp || 0 : 0, x.kind === 'champion' ? +x.rewardExp || 0 : 0]) : undefined; } catch (e) { return undefined; } };

  // 9.0 (катакомбы, живой ответ 11.10: в Catacomb of the Witch 190 мобов, игра показывает их по 15 на странице, по возрастанию уровня):
  // список мобов подземелья (/game/dungeon/view|enter → dungeon.mobs) — целиком, кратко: [id, тип, имя, ур., агрессивный]. Тип
  // (champion/raid…) в разметке списка не виден вовсе, а redact режет массивы до 8
  const dungMobs = (u, o) => { try { if (!/^\/game\/dungeon\/(?:view|enter)$/.test(u.pathname)) return undefined; const g = o?.dungeon; const a = g && (Array.isArray(g.mobs) && g.mobs.length ? g.mobs : g.nearbyMobs);
    return Array.isArray(a) ? { id: String(g.id || ''), mobs: a.slice(0, 2000).map(x => [String(x.id || ''), String(x.kind || ''), String(x.name || '').slice(0, 60), +x.level || 0, x.aggressive ? 1 : 0,
      ...(x.championTier ? [String(x.championTier).slice(0, 10)] : [])]) } : undefined; } catch (e) { return undefined; } };
  // 9.2 (анализатор боя): ход — из ответа сервера, а не со страницы через 0,9 с (окна соседних ходов перекрывались, урон банки и ходы кота
  // приписывались заклинанию). Кратко и целиком: HP моба/героя, MP, весь лог этого хода (redact режет массивы до 8), конец боя, спойл.
  // Ответ хода: { kind:'delta', delta:{mobHp, logTail, characterHp…}, victory?, defeat? }; начало боя и GET /game/battle — { battle:{…} }
  const btOf = (u, o) => { try {
    if (!/^\/game\/battle(?:\/(?:action|start|hunt-continue|sync))?$/.test(u.pathname) || !o || typeof o !== 'object') return undefined;
    const d = o.delta && typeof o.delta === 'object' ? o.delta : o, b = o.battle && typeof o.battle === 'object' ? o.battle : null, ch = o.character && typeof o.character === 'object' ? o.character : null;
    const n = v => v == null || v === '' || !Number.isFinite(+v) ? null : +v;
    const line = x => String(typeof x === 'string' ? x : x?.text ?? x?.message ?? x?.line ?? '').slice(0, 200);
    // 10.0.13: после последнего удара battle уже может отсутствовать; игра показывает полный журнал из результата боя.
    const lastLog = Array.isArray(o.victory?.fullLog) ? o.victory.fullLog : Array.isArray(o.defeat?.fullLog) ? o.defeat.fullLog : null;
    const tail = Array.isArray(d.logTail) && d.logTail.length ? d.logTail : null;
    const battleLog = b && Array.isArray(b.log) && b.log.length ? b.log : null;
    const finalLog = !tail && !battleLog && !!lastLog;
    const lt = tail || battleLog || lastLog || [];
    const sp = d.spoilAttemptResult, extras = d.whirlwindExtras ?? b?.whirlwindExtras;
    return { actor: String(ch?.name || '').slice(0, 80), actorId: String(ch?.id || o.characterId || '').slice(0, 80), rev: n(o.revision ?? ch?.revision),
      extras: Array.isArray(extras) ? extras.slice(0, 30).map(x => ({ id: String(x.spawnId || x.id || ''), name: String(x.name || '').slice(0, 80), hp: n(x.mobHp), max: n(x.mobMaxHp) })) : null,
      mob: n(d.mobHp ?? b?.mobHp ?? (o.victory ? 0 : null)), mobMax: n(d.mobMaxHp ?? b?.mobMaxHp), hp: n(d.characterHp ?? ch?.hp), hpMax: n(d.characterMaxHp ?? ch?.maxHp), mp: n(d.characterMp ?? ch?.mp), mpMax: n(d.characterMaxMp ?? ch?.maxMp),
      log: lt.slice(-40).map(line), seq: n(d.logSeq ?? b?.logSeq), full: (!o.delta && !!b) || finalLog,
      end: !!(d.battleEnded || o.victory || o.defeat || d.outcome === 'DEFEAT' || o.lethalMeta?.battleEnded), win: !!o.victory, lose: !!(o.defeat || d.outcome === 'DEFEAT'),
      spawn: String(b?.spawnId || o.victory?.spawnId || o.defeat?.spawnId || '').slice(0, 80), name: String(b?.mobName || o.victory?.mobName || o.defeat?.mobName || '').slice(0, 80), lvl: n(b?.mobLevel), kind: String(b?.kind || '').slice(0, 30),
      tier: String(b?.championTier || '').slice(0, 10),
      spoil: sp && typeof sp === 'object' ? { ok: !!(sp.ok ?? sp.success), text: String(sp.messageUk || sp.message || '').slice(0, 120) } : sp == null ? undefined : String(sp).slice(0, 60),
      now: n(d.serverNowMs ?? o.serverNowMs) };
  } catch (e) { return undefined; } };
  // 9.2 (лист врагов; живой ответ 11.10 17:39 — Warlock убит игроком Dremia): смерть от игрока (pvpDefeat — в /character, /game/map/sync,
  // ответе боя), игроки на локации (/game/map/sync → around.nearbyHeroes, /game/map/around → nearbyHeroes; redact режет массив до 8 и
  // вымарывает поля с «nick») и кто напал сейчас (pvpIncoming). Кратко: id, ник, уровень, цвет ника, можно ли напасть, удары убийцы из лога
  const pvOf = o => { try {
    if (!o || typeof o !== 'object') return undefined;
    const s = (v, n = 60) => v == null ? '' : String(v).slice(0, n);
    const ar = Array.isArray(o.nearbyHeroes) ? o.nearbyHeroes : Array.isArray(o.around?.nearbyHeroes) ? o.around.nearbyHeroes : null;
    const df = [o.pvpDefeat, o.character?.pvpDefeat, o.defeat].find(x => x && typeof x === 'object' && x.killerName);
    const owner = o.character && typeof o.character === 'object' ? o.character : o.id && o.name && 'revision' in o ? o : null;
    const ic = Array.isArray(o.pvpIncoming) ? o.pvpIncoming : o.pvpIncoming && typeof o.pvpIncoming === 'object' ? [o.pvpIncoming] : null;
    if (!ar && !df && !ic && !owner) return undefined;
    return {
      owner: owner ? { id: s(owner.id), name: s(owner.name), revision: Number.isFinite(owner.revision) ? owner.revision : null } : undefined,
      heroes: ar ? ar.slice(0, 200).filter(h => h && typeof h === 'object').map(h => ({ id: s(h.characterId), name: s(h.name), lvl: +h.level || 0, col: s(h.pvpNickColor, 20),
        atk: 'battleOnNameClick' in h || 'showPkButton' in h ? h.battleOnNameClick === true || h.showPkButton === true : null,
        ok: typeof h.pvpAllowed === 'boolean' ? h.pvpAllowed : null, why: s(h.pvpBlockedReasonUk, 120), party: !!h.isPartyMember, clanId: h.clanId == null ? '' : s(h.clanId), clanKnown: Object.hasOwn(h,'clanId') })) : undefined,
      zone: s(o.around?.nearestLabelUk || o.nearestLabelUk || o.mapState?.currentZoneNameUk || o.character?.currentZoneNameUk, 80) || undefined,
      defeat: df ? { id: s(df.killerCharacterId), name: s(df.killerName), ev: s(df.deathEventId), scope: s(df.scope, 30), arena: df.arena === true,
        log: Array.isArray(df.fullLog) ? df.fullLog.slice(-40).map(x => s(typeof x === 'string' ? x : x?.text ?? x?.message, 200)) : [] } : undefined,
      incoming: ic ? ic.filter(x => x && x.attackerCharacterId).slice(0, 10).map(x => ({ id: s(x.attackerCharacterId), name: s(x.attackerName), mode: s(x.playerCombatMode, 20) })) : undefined };
  } catch (e) { return undefined; } };
  // 9.0: на страницах катакомб/подземелья/торговцев игра сообщает об ошибке через alert() — окно останавливает страницу (и бота) до нажатия
  // «ОК». Там вместо окна — сообщение боту (журнал) и в консоль; на других страницах alert не трогаем
  if (/^\/(?:catacombs|dungeon|ancient-trader|mammon-[\w-]+)\.html$/.test(location.pathname)) {
    const oalert = window.alert;
    window.alert = function (msg) { try { console.warn('[l2bot] окно игры:', msg); window.postMessage({ __l2bot: 'alert', text: String(msg ?? '').slice(0, 300), path: location.pathname }, location.origin); } catch (e) { return oalert.apply(this, arguments); } };
  }
  // 9.2.5: если кузнец Маммона спросит «точно улучшить?» окном confirm() — «да» только сразу после нажатия бота (метка data-l2bot-confirm
  // на <html> ставит mammon.upgrade, живёт 5 с); любой другой confirm — обычное окно игроку
  if (location.pathname === '/mammon-blacksmith.html') {
    const oconfirm = window.confirm;
    window.confirm = function (msg) {
      const h = document.documentElement, t = +(h?.dataset?.l2botConfirm || 0);
      if (t && Date.now() - t < 5000) { delete h.dataset.l2botConfirm; try { window.postMessage({ __l2bot: 'alert', text: 'подтверждено: ' + String(msg ?? '').slice(0, 280), path: location.pathname }, location.origin); } catch (e) {} return true; }
      return oconfirm.apply(this, arguments);
    };
  }

  // 8.0.3 (логи 11.10: 1302 потерянных нажатия за 10 боёв с РБ): пока игра ждёт свой GET /character (уходит ≈8 мс после ответа на ход,
  // идёт 0,25–0,56 с) и ≈30 мс после — клик по панели игра молча теряет. Боту нужны начало и конец этих запросов (rid, путь без query)
  // 15.10: все игровые ответы привязаны к контексту начала запроса; busy-фильтр остаётся в content.
  const TRACK = /^\/(?:character|game)(?:\/|$)/;
  let ridN = 0;
  const start = (u, method) => { if (!TRACK.test(u.pathname)) return undefined; const rid = ++ridN; try { window.postMessage({ __l2bot: 'netStart', path: u.pathname, method, rid }, location.origin); } catch (e) {} return rid; };
  const ofetch = window.fetch;
  if (ofetch) window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const u = same(url);
    const p = ofetch.apply(this, arguments);
    if (!u) return p;
    const method = String(init?.method || input?.method || 'GET').toUpperCase(), t0 = performance.now(), req = reqBody(init?.body);
    const rid = start(u, method);   // 7.1.17: ход ушёл на сервер; 8.0.3: и GET /character, начало/конец боя
    p.then(res => {
      const ms = Math.round(performance.now() - t0), ct = res.headers.get('content-type') || '';
      if (!/json|text/i.test(ct)) return post({ url: cleanUrl(u), method, status: res.status, ms, req, ct, rid });
      res.clone().text().then(t => { const o = raw(t, ct); post({ url: cleanUrl(u), method, status: res.status, ms, req, res: o == null ? null : redact(o), sp: spawns(o), inv: invOf(o), len: t.length, eb: epicsOf(u, o), aug: augOf(o), hero: heroOf(o), pet: petOf(u, o), dm: dungMobs(u, o), pv: pvOf(o), bt: btOf(u, o), rid }); })
        .catch(() => post({ url: cleanUrl(u), method, status: res.status, ms, req, rid }));   // 8.0.3: конец запроса не теряем
    }, err => post({ url: cleanUrl(u), method, ms: Math.round(performance.now() - t0), req, error: String(err?.message || err).slice(0, 120), rid }));
    return p;
  };

  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) { this.__l2 = { method: String(m || 'GET').toUpperCase(), url }; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__l2, u = info && same(info.url);
    if (u) {
      const t0 = performance.now(), req = reqBody(body);
      const rid = start(u, info.method);
      this.addEventListener('loadend', function onEnd() {
        let res = null, len = 0, o = null;
        try { if (!this.responseType || this.responseType === 'text') { len = (this.responseText || '').length; o = raw(this.responseText, this.getResponseHeader('content-type')); } else if (this.responseType === 'json') o = this.response; res = o == null ? null : redact(o); } catch (e) {}
        post({ url: cleanUrl(u), method: info.method, status: this.status, ms: Math.round(performance.now() - t0), req, res, sp: spawns(o), inv: invOf(o), len, eb: epicsOf(u, o), aug: augOf(o), hero: heroOf(o), pet: petOf(u, o), dm: dungMobs(u, o), pv: pvOf(o), bt: btOf(u, o), error: this.status ? undefined : 'нет ответа', rid });
      }, { once: true });                                // v5.6: повторно используемый XHR не копит слушателей
    }
    return XS.apply(this, arguments);
  };
})();

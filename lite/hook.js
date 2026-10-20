// ===== L2wap Lite — сетевой «жучок» (мир страницы, document_start) =====
// 20.10.2026 (тред «Упрошенка под Дестра»): видит запросы игры к своему серверу (fetch / XMLHttpRequest) и передаёт боту
// только нужные поля по белому списку: герой (уровень, локация, HP/MP, счётчик убийств), откаты боя, TvT, антибот.
// Заголовки, токены, пароли и тела запросов целиком наружу не уходят. Работу игры не меняет: ответ отдаётся как был.
(() => {
  if (window.__l2liteHook) return;
  window.__l2liteHook = 1;
  const TRACK = /^\/(?:character|game)(?:\/|$)/;
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v) ? +v : undefined);
  const str = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const pick = (o, keys) => { if (!o || typeof o !== 'object') return undefined; const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };
  const post = d => { try { window.postMessage({ __l2lite: 'end', ...d }, location.origin); } catch (e) {} };
  const same = u => { try { const x = new URL(u, location.href); return x.host === location.host && TRACK.test(x.pathname) ? x : null; } catch (e) { return null; } };
  const parse = t => { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
  const reqOf = body => {           // из тела запроса — только действие боя/арены (что нажато), без прочих полей
    try { const o = typeof body === 'string' ? JSON.parse(body) : null; if (!o || typeof o !== 'object') return undefined;
      return pick({ action: str(o.action, 60), skillId: num(o.skillId), itemId: num(o.itemId), targetCharacterId: o.targetCharacterId != null ? String(o.targetCharacterId).slice(0, 40) : undefined }, ['action', 'skillId', 'itemId', 'targetCharacterId']);
    } catch (e) { return undefined; }
  };

  // Герой из любого ответа с character: имя нужно, чтобы не путать героев одного аккаунта (счётчик убийств).
  function heroOf(o) {
    const c = o && typeof o === 'object' ? o.character : null;
    if (!c || typeof c !== 'object' || typeof c.name !== 'string') return undefined;
    const ids = a => (Array.isArray(a) ? a : []).slice(0, 80);
    return {
      name: c.name.slice(0, 60), level: num(c.level), prof: str(c.l2Profession, 60), zone: str(c.currentZoneId, 80), zoneName: str(c.currentZoneNameUk, 80),
      locType: str(c.locationType, 30), inBattle: c.inBattle === true, spawn: str(c.battleSpawnId, 120), dung: str(c.activeDungeonId, 80),
      hp: num(c.hp), maxHp: num(c.maxHp), mp: num(c.mp), maxMp: num(c.maxMp), k: Number.isSafeInteger(c.mobsKilled) ? c.mobsKilled : undefined,
      rev: Number.isSafeInteger(c.revision) ? c.revision : undefined, adena: num(c.adena),
      buffs: ids(c.activeBuffs).filter(b => b && typeof b === 'object').map(b => ({ id: num(b.skillId), until: num(b.expiresAt) || (typeof b.expiresAt === 'string' ? Date.parse(b.expiresAt) || undefined : undefined) })),
      toggles: Array.isArray(c.toggleStances) ? ids(c.toggleStances).filter(b => b && typeof b === 'object').map(b => ({ a: str(b.battleId, 60), id: num(b.skillId), on: b.active === true })) : undefined,
      // Панель боя без DOM: какие скиллы стоят и как они называются (для меню выбора скиллов).
      bar: ids(c.battleHotbarSlots).filter(s => s && s.k === 'a' && typeof s.a === 'string').map(s => s.a.slice(0, 60)),
      names: Object.fromEntries([...ids(c.panelHotbarSkills).filter(s => s && typeof s.id === 'string').map(s => [s.id.slice(0, 60), str(s.labelUk, 60)]),
        ...ids(c.learnedBattleSkillsDetail).filter(s => s && typeof s.battleId === 'string').map(s => [s.battleId.slice(0, 60), str(s.nameUk, 60)])].filter(x => x[1])),
      pveDefeat: !!c.pveDefeat,
    };
  }
  // Откаты боя — ровно те поля, которые читает battle-cooldown.js.
  const CD_KEYS = ['serverNowMs', 'nowMs', 'globalCooldownUntilMs', 'blockedBy', 'globalRemainingMs', 'remainingMs', 'cooldownUntilMs', 'readyAtMs',
    'skillRemainingMs', 'normalizedSkillId', 'skillId', 'code', 'error', 'nextPhysicalAttackAt', 'nextAutoAttackAt', 'skillCooldowns'];
  function cdOf(o) {
    if (!o || typeof o !== 'object') return undefined;
    const r = pick(o, CD_KEYS) || {};
    if (o.delta && typeof o.delta === 'object') r.delta = pick(o.delta, CD_KEYS);
    if (o.battle && typeof o.battle === 'object') r.battle = pick(o.battle, CD_KEYS);
    if (typeof r.code === 'string') r.code = r.code.slice(0, 60);
    if (typeof r.error === 'string') r.error = r.error.slice(0, 60);
    return r;
  }
  // Кто перед нами (начало боя, «Охотиться дальше», sync): цепочка игры может подсунуть чемпиона — URL при этом не меняется.
  function battleOf(o) {
    const b = o && typeof o === 'object' && o.battle && typeof o.battle === 'object' ? o.battle : null;
    if (!b || (typeof b.spawnId !== 'string' && typeof b.mobName !== 'string')) return undefined;
    return { spawn: str(b.spawnId, 120) || '', name: str(b.mobName, 80) || '', kind: str(b.kind, 30) || '', tier: str(b.championTier, 12) || '', lvl: num(b.mobLevel) };
  }
  const ROSTER = ['characterId', 'name', 'level', 'hp', 'maxHp', 'cp', 'maxCp', 'alive', 'spawnProtectedUntil', 'stunnedUntil', 'team'];
  const roster = a => (Array.isArray(a) ? a.slice(0, 40).filter(x => x && typeof x === 'object').map(x => pick(x, ROSTER)) : undefined);
  function tvtOf(path, o) {
    if (!o || typeof o !== 'object') return undefined;
    if (path === '/game/tvt') return { kind: 'state', ...pick(o, ['phase', 'serverNow', 'eventId', 'registrationEndsAt', 'startsAt', 'endsAt', 'isRegistered', 'myTeam', 'registeredCount', 'maxPlayers', 'error']),
      selfCombat: o.selfCombat && typeof o.selfCombat === 'object' ? { alive: o.selfCombat.alive } : null, combatRoster: roster(o.combatRoster),
      schedule: o.schedule && typeof o.schedule === 'object' ? { enabled: o.schedule.enabled, next: pick(o.schedule.next, ['slotKey', 'registrationOpensAt', 'preparationStartsAt', 'battleStartsAt']) } : undefined };
    if (/^\/game\/tvt\/(?:combat\/sync|target|target\/clear)$/.test(path)) return { kind: 'combat', ...pick(o, ['selfMp', 'selfMaxMp', 'nextBasicAttackAt', 'error']),
      selectedTarget: o.selectedTarget && typeof o.selectedTarget === 'object' ? pick(o.selectedTarget, ROSTER) : o.selectedTarget === null ? null : undefined, combatRoster: roster(o.combatRoster) };
    if (path === '/game/tvt/action') return { kind: 'action', ...pick(o, ['error', 'targetHp', 'targetCp', 'targetDead', 'targetCharacterId', 'selfMp', 'nextBasicAttackAt', 'skillReadyAt', 'skillId', 'restoredHp', 'restoredMp']) };
    if (path === '/game/tvt/skills' && Array.isArray(o.skills)) return { kind: 'skills', skills: o.skills.slice(0, 60).filter(x => x && typeof x === 'object').map(x => pick(x, ['skillId', 'action', 'nameUk', 'mpCost', 'targetType', 'readyAt', 'usable'])) };
    return undefined;
  }
  // Антибот: проверка выдана / пройдена / блок фарма. Код ответа — единственный надёжный признак (окно живёт только в памяти страницы).
  function abOf(path, o, status) {
    const code = String((o && (o.code || o.error)) || '');
    if (code === 'anti_bot_challenge' || code === 'antibot_challenge_not_found' || code === 'pve_farm_blocked' || (path === '/game/antibot/challenge' && o && o.passed === true))
      return { code: code || 'passed', passed: !!(o && o.passed === true), until: num(o && o.blockedUntil) || (typeof (o && o.blockedUntil) === 'string' ? Date.parse(o.blockedUntil) || undefined : undefined), left: num(o && o.remainingSeconds) };
    if (status === 423) return { code: code.slice(0, 60) || '423' };
    return undefined;
  }
  function locsOf(path, o) {
    if (path !== '/game/teleport/locations' || !o || !Array.isArray(o.locations)) return undefined;
    return o.locations.slice(0, 200).filter(x => x && typeof x.teleportId === 'string').map(x => ({ id: x.teleportId.slice(0, 80), name: str(x.labelUk, 80) || str(x.labelEn, 80) || x.teleportId.slice(0, 80), lo: num(x.mobLevelMin), hi: num(x.mobLevelMax), cost: num(x.adenaCost) }));
  }
  function summary(u, method, status, t, req) {
    const o = parse(t), path = u.pathname, d = { path, method, status };
    if (req) d.req = req;
    const ch = heroOf(o); if (ch) d.ch = ch;
    if (/^\/game\/battle(?:\/|$)/.test(path)) { const cd = cdOf(o); if (cd) d.bt = cd; const bi = battleOf(o); if (bi) d.bi = bi; }
    const tv = /^\/game\/tvt(?:\/|$)/.test(path) ? tvtOf(path, o) : undefined; if (tv) d.tvt = tv;
    const ab = abOf(path, o, status); if (ab) d.ab = ab;
    const lc = locsOf(path, o); if (lc) d.locs = lc;
    if (o && typeof o === 'object' && typeof o.error === 'string') d.err = o.error.slice(0, 80);
    return d;
  }

  // Начало и конец каждого запроса игры — бот не кликает, пока игра ждёт свой GET /character (иначе клик теряется, основной бот 8.0.3).
  let ridN = 0;
  const start = (u, method) => { const rid = ++ridN; try { window.postMessage({ __l2lite: 'start', rid, path: u.pathname, method }, location.origin); } catch (e) {} return rid; };
  const ofetch = window.fetch;
  if (ofetch) window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const p = ofetch.apply(this, arguments), u = same(url);
    if (!u) return p;
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase(), req = method === 'POST' ? reqOf(init && init.body) : undefined;
    const rid = start(u, method);
    p.then(res => {
      res.clone().text().then(t => post({ rid, ...summary(u, method, res.status, t, req) }), () => post({ rid, path: u.pathname, method, status: res.status }));
    }, err => post({ rid, path: u.pathname, method, status: 0, net: String((err && err.message) || err).slice(0, 80) }));
    return p;
  };
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) { this.__l2lite = { method: String(m || 'GET').toUpperCase(), url }; return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__l2lite, u = info && same(info.url);
    if (u) {
      const req = info.method === 'POST' ? reqOf(body) : undefined, rid = start(u, info.method);
      this.addEventListener('loadend', function () {
        let t = '';
        try { t = !this.responseType || this.responseType === 'text' ? this.responseText : this.responseType === 'json' ? JSON.stringify(this.response) : ''; } catch (e) {}
        post({ rid, ...summary(u, info.method, this.status, t, req), ...(this.status ? {} : { net: 'нет ответа' }) });
      }, { once: true });
    }
    return XS.apply(this, arguments);
  };
})();

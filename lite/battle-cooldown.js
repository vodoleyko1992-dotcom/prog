// Server-authoritative cooldown observations. No Interlude reuse minimums.
// Orders updates by server time; missing fields are not a cooldown=0 report.
(function (root) {
  function createBattleCooldown(clock = () => Date.now()) {
    let spawn = '', globalUntil = 0, globalRejectAt = 0, globalServerMs = -1, newestServerMs = -1;
    let skills = Object.create(null);
    const num = x => x === null || x === undefined || x === '' ? null : Number.isFinite(+x) ? +x : null;
    const has = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);
    function chooseSpawn(id) {
      if (!id) return;
      id = String(id);
      if (id !== spawn) {
        spawn = id; globalUntil = 0; globalRejectAt = 0;
        globalServerMs = -1; newestServerMs = -1; skills = Object.create(null);
      }
    }
    const left = t => Math.max(0, t - clock());
    function deadline(until, server, received) {
      const t = num(until), s = num(server);
      if (t === null || s === null || s <= 0) return null;
      const gap = t - s;
      if (gap > 120000) return null;
      return received + Math.max(0, gap) + (gap > 0 ? 40 : 0);
    }
    function updateGlobal(until, server, received) {
      const t = deadline(until, server, received);
      if (t === null || server < globalServerMs) return;
      globalUntil = t; globalServerMs = server;
    }
    function updateSkill(id, until, server, received) {
      if (!id) return;
      const t = deadline(until, server, received);
      if (t === null) return;
      const key = String(id), prev = skills[key];
      if (prev && server < prev.server) return;
      skills[key] = { until: t, server, observed: received };
    }
    // 20.36: игра отдаёт и словарь, и [{skillId,readyAt,remainingSec}]. Числовой ID
    // соответствует l2_ID; индекс строки массива никогда не является ID навыка.
    const rowNum = x => typeof x === 'number' || typeof x === 'string' && x.trim() !== '' ? num(x) : null;
    function ids(value) {
      if (typeof value !== 'string' && typeof value !== 'number') return [];
      if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return [];
      const id = String(value).trim();
      if (!/^(?:[a-z][a-z0-9_]*|[1-9]\d*)$/i.test(id)) return [];
      const n = id.match(/^(?:l2_)?([1-9]\d*)$/);
      return n ? Number.isSafeInteger(+n[1]) ? [n[1], 'l2_' + n[1]] : [] : [id];
    }
    function rowDeadline(row, server) {
      for (const field of ['readyAt', 'readyAtMs', 'untilMs', 'until']) if (has(row, field)) {
        const t = rowNum(row[field]); return t !== null && t >= 0 ? t : null;
      }
      for (const [field, scale] of [['remainingMs', 1], ['remainingSec', 1000]]) if (has(row, field)) {
        const remaining = rowNum(row[field]); return remaining !== null && remaining >= 0 ? server + remaining * scale : null;
      }
      return null; // отсутствие срока не означает «готов»
    }
    function cooldowns(sc, server, received, req = {}, res = {}) {
      if (!sc || typeof sc !== 'object') return;
      const list = Array.isArray(sc);
      for (const [key, value] of Object.entries(sc)) {
        const row = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
        if (list && !row) continue;
        const explicit = row ? [row.skillId, row.battleId, row.action, row.normalizedSkillId] : [];
        // В be key — исходный ключ словаря либо индекс массива, поэтому числовой
        // key без явного skillId неоднозначен. Сам сырой числовой словарь читается ниже.
        if (row?.key != null && !/^\d+$/.test(String(row.key))) explicit.push(row.key);
        if (!list) explicit.push(key);
        const aliases = new Set(explicit.flatMap(ids));
        if (!aliases.size) continue;
        const until = row ? rowDeadline(row, server) : rowNum(value);
        if (until === null) continue;
        // Нативное имя связывается с числовым ID только по явному ответу сервера.
        if ([res.skillId, res.normalizedSkillId].flatMap(ids).some(id => aliases.has(id))) for (const id of ids(req.action)) aliases.add(id);
        for (const id of aliases) updateSkill(id, until, server, received);
      }
    }
    // Безопасный be из hook сохраняет полный список, который общий redact режет до8.
    // Только явные временные поля: отсутствие значения не сбрасывает прежний КД.
    function evidence(res) {
      if (!res || res.schema !== 1 || !res.timing || typeof res.timing !== 'object' || Array.isArray(res.timing)) return res;
      const fields = ['serverNowMs','globalCooldownUntilMs','cooldownUntilMs','readyAtMs','skillRemainingMs','globalRemainingMs'];
      return { ...res, ...Object.fromEntries(fields.filter(k => has(res.timing,k)).map(k => [k,res.timing[k]])), skillCooldowns: res.cooldowns };
    }
    // 15.10, альт с пикой: attack имеет отдельный дедлайн, в том числе в delta.
    // Отсутствующее поле не означает готовность; время всегда переводим от часов сервера.
    function physical(res, server, received) {
      const layers = [res, res.delta, res.battle].filter(x => x && typeof x === 'object');
      for (const row of layers) {
        const until = num(row.nextPhysicalAttackAt ?? row.nextAutoAttackAt);
        if (until !== null && until >= 0) { updateSkill('attack', until, server, received); return; }
      }
    }
    function observe(req = {}, res = {}, status = 0, activeSpawn = '') {
      res = evidence(res);
      if (!res || typeof res !== 'object' || !req.action) return;
      // Delayed response from a previous opponent must not reset the new fight.
      if (activeSpawn && req.battleSpawnId && String(activeSpawn) !== String(req.battleSpawnId)) return;
      chooseSpawn(activeSpawn || req.battleSpawnId);
      // 8.0.3 (лог 11.10 09:11:56): ответ на ход переехал в delta (delta.serverNowMs, delta.skillCooldowns) — без этого откаты сервера не читались
      const now = clock(), src = res.battle && typeof res.battle === 'object' ? res.battle : res.delta && typeof res.delta === 'object' ? res.delta : {};
      const server = num(res.serverNowMs ?? res.nowMs ?? src.serverNowMs), failure = +status < 200 || +status >= 300;
      const blockedBy = String(res.blockedBy || '');
      if (server !== null && server < newestServerMs) return; // late response from this battle
      if (server !== null) newestServerMs = server;
      if (server !== null && (has(res, 'globalCooldownUntilMs') || has(src, 'globalCooldownUntilMs'))) updateGlobal(res.globalCooldownUntilMs ?? src.globalCooldownUntilMs, server, now);
      if (failure && blockedBy === 'global') {
        globalRejectAt = now;
        if (!has(res, 'globalCooldownUntilMs') && server !== null && num(res.globalRemainingMs ?? res.remainingMs) !== null)
          updateGlobal(server + Math.min(10000, Math.max(0, num(res.globalRemainingMs ?? res.remainingMs))), server, now);
      }
      // A generic cooldownUntilMs for a global rejection is NOT a skill timer.
      if (server !== null && blockedBy !== 'global' &&
        (blockedBy === 'skill' || num(res.skillRemainingMs) > 0 || !failure) &&
        (has(res, 'cooldownUntilMs') || has(res, 'readyAtMs'))) {
        const until = res.cooldownUntilMs ?? res.readyAtMs;
        for (const id of new Set([req.action, res.normalizedSkillId, res.skillId].filter(Boolean))) updateSkill(id, until, server, now);
      }
      const attackRejected = failure && req.action === 'attack' && /^attack_cooldown$/i.test(String(res.code || res.error || ''));
      if (server !== null && (!failure || blockedBy === 'skill' || attackRejected) && blockedBy !== 'global') {
        if (attackRejected && num(res.remainingMs) !== null)
          updateSkill('attack', server + Math.max(0, num(res.remainingMs)), server, now);
        physical(res, server, now);
      }
      const sc = res.skillCooldowns || src.skillCooldowns;
      if (server !== null) cooldowns(sc, server, now, req, res);
    }
    function observeSync(res = {}, id = '') {
      res = evidence(res);
      if (!res || typeof res !== 'object') return;
      if (id) chooseSpawn(id);
      const src = res.battle && typeof res.battle === 'object' ? res.battle : res.delta && typeof res.delta === 'object' ? res.delta : res;
      const server = num(src.serverNowMs ?? res.serverNowMs ?? src.nowMs);
      if (server === null || server < newestServerMs) return;
      newestServerMs = server;
      const now = clock();
      if (has(src, 'globalCooldownUntilMs') || has(res, 'globalCooldownUntilMs'))
        updateGlobal(src.globalCooldownUntilMs ?? res.globalCooldownUntilMs, server, now);
      if (server !== null) physical(res, server, now);
      const sc = src.skillCooldowns || res.skillCooldowns;
      cooldowns(sc, server, now);
    }
    return {
      observe, observeSync,
      globalWait(id) { return id && spawn && String(id) !== spawn ? 0 : left(globalUntil); },
      skillWait(id, idSpawn) { return idSpawn && spawn && String(idSpawn) !== spawn ? 0 : left(skills[String(id)]?.until || 0); },
      // 8.0.3: since — время нашего последнего нажатия: откат, полученный ДО него (sync до клика), об этом нажатии ничего не знает
      skillKnown(id, idSpawn, since = 0) {
        if (idSpawn && spawn && String(idSpawn) !== spawn) return false;
        const info = skills[String(id)];
        return !!info && clock() - info.observed < 30000 && info.observed >= since;
      },
      recentlyGlobalRejected(since = 0) { return globalRejectAt >= since && globalRejectAt > 0 && clock() - globalRejectAt < 2000; },
      snapshot() { return { spawn, globalWait: left(globalUntil), skillUntil: Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, v.until])) }; }
    };
  }
  root.L2BattleCooldown = { createBattleCooldown };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createBattleCooldown };
})(typeof globalThis !== 'undefined' ? globalThis : this);

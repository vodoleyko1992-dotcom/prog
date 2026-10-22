// 22.10: единый расчёт цепочек для меню и исполнения. Только книга игры и переданная свежая сумка; без запросов и изменений входных данных.
(function (root) {
 'use strict';
 const MAX_DEPTH = 32, MAX_VISITS = 4000, MAX_GOALS = 50;
 const integer = n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
 const positive = n => integer(n) && n > 0;
 const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
 const add = (a, b) => integer(a) && integer(b) && Number.isSafeInteger(a + b) ? a + b : null;
 const mul = (a, b) => integer(a) && integer(b) && Number.isSafeInteger(a * b) ? a * b : null;
 const name = r => r?.output?.nameEn || r?.output?.nameUk || r?.output?.nameRu || r?.code || '?';
 const itemName = r => r?.nameEn || r?.nameUk || r?.nameRu || '#' + r?.itemId;
 function transientLock(s, recipe) {
  const reason = String(s || '').trim();
  if (/запрещ|заборон|заблок|недоступ|forbidden|blocked|disabled/iu.test(reason)) return false;
  // 22.10 (живой Maestro): игра пишет «Недостатньо: Mold Hardener.», без общего слова «сырьё».
  // Разрешаем только целое известное имя ингредиента после подтверждённого префикса, не произвольный текст с похожим слогом.
  const named = reason.match(/^(?:недостатньо|недостаточно)\s*:\s*(.+?)(?:\.)?$/iu);
  if (named) {
   const wanted = named[1].trim().toLowerCase();
   if (/^(?:mp|mana|мана|маны|мани|мп)$/iu.test(wanted)) return true;
   return (Array.isArray(recipe?.ingredients) ? recipe.ingredients : []).some(i => ['nameEn','nameUk','nameRu']
    .some(k => typeof i?.[k] === 'string' && i[k].trim().toLowerCase() === wanted));
  }
  return /недостат|не[\s_-]+(?:хват|вистач)|(?:not[\s_-]+enough|insufficient|missing)/iu.test(reason)
   && /\bmp\b|\bmana\b|(?:^|[^\p{L}])(?:ман[аиыуе]?|маны|мани|мп)(?:$|[^\p{L}])|матер|ингред|ресурс|сировин|сырь|material|ingredient|resource/iu.test(reason);
 }
 function plan(book, queue, made = {}, inventoryStacks = [], options = {}) {
  const result = { goals: [], steps: [], missing: [], blocked: [], mpTotal: 0, done: false };
  const chain = options?.chain !== false, source = Array.isArray(book?.recipes) ? book.recipes.slice(0, 2048) : [], recipes = new Map(), producers = new Map(), names = new Map();
  for (const r of source) {
   if (typeof r?.code === 'string') { const a = recipes.get(r.code) || []; a.push(r); recipes.set(r.code, a); }
   if (positive(r?.output?.itemId)) { const a = producers.get(r.output.itemId) || []; a.push(r); producers.set(r.output.itemId, a); names.set(r.output.itemId, name(r)); }
   for (const i of Array.isArray(r?.ingredients) ? r.ingredients.slice(0, 64) : []) if (positive(i?.itemId) && !names.has(i.itemId)) names.set(i.itemId, itemName(i));
  }
  let inputError = !Array.isArray(queue) ? 'Очередь крафта не прочитана' : queue.length > MAX_GOALS ? 'В очереди больше 50 целей' : '';
  const bag = new Map();
  if (!Array.isArray(inventoryStacks)) inputError ||= 'Свежая сумка не прочитана';
  else for (const s of inventoryStacks) {
   if (!positive(s?.itemId) || !integer(s?.qty)) { inputError ||= 'В сумке есть неизвестное количество предмета'; continue; }
   const n = add(bag.get(s.itemId) || 0, s.qty);
   if (n === null) inputError ||= 'Количество предметов в сумке слишком велико'; else bag.set(s.itemId, n);
  }
  const rows = Array.isArray(queue) ? queue.slice(0, MAX_GOALS) : [], ids = new Map();
  for (const q of rows) if (typeof q?.id === 'string') ids.set(q.id, (ids.get(q.id) || 0) + 1);
  const bookError = !Array.isArray(book?.recipes) ? 'Книга рецептов не прочитана'
   : book.recipes.length > 2048 ? 'Книга содержит слишком много рецептов'
   : book.canCraftProfession !== true ? 'Активный класс не крафтер'
   : !integer(book.createItemLevel) ? 'Уровень Create Item неизвестен'
   : !positive(book.maxMp) ? 'Максимум MP персонажа не прочитан' : '';
  const error = (g, reason, item = g.item, code = g.code) => ({ qid: g.qid, item: item || 0, code: code || '', reason });
  function recipeError(r) {
   if (typeof r?.code !== 'string' || !/^[a-z0-9_.:-]{1,80}$/i.test(r.code) || !positive(r.output?.itemId) || !positive(r.output?.quantity)) return 'Рецепт содержит неизвестный выход';
   if ((recipes.get(r.code) || []).length !== 1) return 'В книге повторяется код рецепта ' + r.code;
   if (!integer(r.createItemLevel) || r.createItemLevel > book.createItemLevel) return 'Нужен Create Item ур. ' + (r.createItemLevel ?? '?');
   if (!integer(r.mpCost)) return 'Цена рецепта в MP неизвестна';
   if (r.mpCost > book.maxMp) return 'Для ' + name(r) + ' нужно ' + r.mpCost + ' MP, максимум героя ' + book.maxMp;
   if (r.successChance !== undefined && r.successChance !== 100 && r.successChance !== 1) return 'Шанс рецепта не подтверждён как 100 %';
   if (r.lockedReason && !transientLock(r.lockedReason, r)) return String(r.lockedReason);
   if (!Array.isArray(r.ingredients) || !r.ingredients.length || r.ingredients.length > 64 || r.ingredients.some(i => !positive(i?.itemId) || !positive(i?.quantity))) return 'Состав рецепта не прочитан';
   return '';
  }
  function simulate(start, g) {
   const tx = { pool: new Map(start), steps: [], missing: new Map(), blocked: [], mpTotal: 0, visits: 0 };
   const block = (reason, item, code) => { if (!tx.blocked.some(x => x.reason === reason && x.item === item && x.code === code)) tx.blocked.push(error(g, reason, item, code)); return false; };
   function produce(r, units, path, final = false) {
    if (++tx.visits > MAX_VISITS || path.length >= MAX_DEPTH) return block('Цепочка рецептов слишком длинная', r.output?.itemId, r.code);
    const bad = recipeError(r); if (bad) return block(bad, r.output?.itemId, r.code);
    const id = r.output.itemId;
    if (path.includes(id)) return block('Цикл в цепочке рецептов: ' + name(r), id, r.code);
    const runs = Math.floor((units - 1) / r.output.quantity) + 1, out = mul(runs, r.output.quantity), mp = mul(runs, r.mpCost);
    if (!positive(runs) || out === null || mp === null) return block('Количество в цепочке слишком велико', id, r.code);
    const next = [...path, id];
    let ok = true;
    for (const i of r.ingredients) {
     const need = mul(runs, i.quantity);
     if (need === null) { block('Количество сырья слишком велико', i.itemId, r.code); ok = false; continue; }
     if (!ensure(i.itemId, need, next)) ok = false;
    }
    if (!ok) return false;
    const total = add(tx.pool.get(id) || 0, out), totalMp = add(tx.mpTotal, mp);
    if (total === null || totalMp === null) return block('Итог цепочки слишком велик', id, r.code);
    tx.pool.set(id, total); tx.mpTotal = totalMp;
    tx.steps.push({ qid: g.qid, rootCode: g.code, rootWant: g.left, rootN: g.n, code: r.code, item: id, name: name(r),
     runs, n: out, intermediate: !final, mp });
    return true;
   }
   function ensure(id, amount, path) {
    if (path.includes(id)) return block('Цикл в цепочке рецептов: ' + (names.get(id) || '#' + id), id, '');
    const have = tx.pool.get(id) || 0, used = Math.min(have, amount), missing = amount - used;
    tx.pool.set(id, have - used); if (!missing) return true;
    const choices = producers.get(id) || [];
    if (chain && choices.length) {
     if (choices.length !== 1) return block('Неоднозначный рецепт для ' + (names.get(id) || '#' + id), id, '');
     if (!produce(choices[0], missing, path)) return false;
     const available = tx.pool.get(id) || 0;
     if (available < missing) return block('Выход промежуточного рецепта не покрывает потребность', id, choices[0].code);
     tx.pool.set(id, available - missing); return true;
    }
    const total = add(tx.missing.get(id) || 0, missing);
    if (total === null) return block('Потребность в сырье слишком велика', id, '');
    tx.missing.set(id, total); return true; // Воображаемое пополнение нужно только для полного расчёта; такой tx исполнению не передаётся.
   }
   const list = recipes.get(g.code) || [];
   if (list.length !== 1) block(list.length ? 'В книге повторяется код рецепта ' + g.code : 'Рецепта нет в книге: ' + g.code, g.item, g.code);
   else if (positive(g.item) && g.item !== list[0].output?.itemId) block('Выход рецепта изменился — выберите цель заново', g.item, g.code);
   else produce(list[0], g.left, [], true);
   return tx;
  }
  function missingList(tx, start) {
   return [...tx.missing].sort((a, b) => a[0] - b[0]).map(([item, missing]) => ({ item, name: names.get(item) || '#' + item,
    required: add(start.get(item) || 0, missing), have: start.get(item) || 0, missing, qids: [] }));
  }
  let pool = new Map(bag);
  for (let index = 0; index < rows.length; index++) {
   const q = rows[index], n = q?.n, qid = typeof q?.id === 'string' ? q.id : 'invalid-' + index;
   const progress = own(made, qid) ? made[qid] : 0, recipe = recipes.get(q?.code)?.[0];
   const g = { qid, code: typeof q?.code === 'string' ? q.code : '', item: positive(q?.item) ? q.item : recipe?.output?.itemId || 0,
    name: recipe ? name(recipe) : q?.nm || q?.code || '?', n, made: progress, left: positive(n) && integer(progress) ? Math.max(0, n - progress) : 0,
    status: 'blocked', steps: [], missing: [], blocked: [], mpTotal: 0 };
   result.goals.push(g);
   const bad = !q || typeof q.id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(q.id) || ['__proto__','constructor','prototype'].includes(q.id)
    || ids.get(q.id) !== 1 || typeof q.code !== 'string' || !/^[a-z0-9_.:-]{1,80}$/i.test(q.code) || !positive(n) || n > 1e6
    || !integer(progress) || q.item != null && !integer(q.item);
   if (bad || inputError) g.blocked.push(error(g, inputError || 'Цель крафта содержит неверное количество или повторяющийся ID'));
   else if (!g.left) { g.status = 'done'; continue; }
   else if (bookError) g.blocked.push(error(g, bookError));
   else {
    const tx = simulate(pool, g); g.steps = tx.steps; g.missing = missingList(tx, pool).map(x => ({ ...x, qids: [g.qid] })); g.blocked = tx.blocked; g.mpTotal = tx.mpTotal;
    if (g.missing.some(x => x.required === null)) { g.missing = []; g.blocked.push(error(g, 'Общая потребность в сырье слишком велика')); }
    g.status = tx.blocked.length ? 'blocked' : tx.missing.size ? 'missing' : 'ready';
    if (g.status === 'ready') {
     const total = add(result.mpTotal, tx.mpTotal);
     if (total === null) { g.status = 'blocked'; g.blocked.push(error(g, 'Итог MP всей очереди слишком велик')); }
     else { pool = tx.pool; result.steps.push(...tx.steps); result.mpTotal = total; }
    }
   }
   result.blocked.push(...g.blocked);
  }
  // Второй расчёт распределяет общий запас один раз: сколько добавить СЕЙЧАС для всей очереди, не складывая have каждой цели.
  // Это не обещание остатка после следующей партии: фактический шаг и новая сумка могут изменить распределение между целями.
  let totalPool = new Map(bag), badTotal = false; const shortages = new Map();
  for (const g of result.goals) if (g.status === 'ready' || g.status === 'missing') {
   const tx = simulate(totalPool, g); if (tx.blocked.length) continue;
   for (const [item, n] of tx.missing) {
    const row = shortages.get(item) || { item, name: names.get(item) || '#' + item, required: bag.get(item) || 0, have: bag.get(item) || 0, missing: 0, qids: [] };
    const missing = add(row.missing, n), required = add(row.have, missing);
    if (missing === null || required === null) { badTotal = true; result.blocked.push(error(g, 'Общая потребность в сырье слишком велика', item)); continue; }
    row.missing = missing; row.required = required; if (!row.qids.includes(g.qid)) row.qids.push(g.qid); shortages.set(item, row);
   }
   totalPool = tx.pool;
  }
  result.missing = badTotal ? [] : [...shortages.values()].sort((a, b) => a.item - b.item); // Частичную сумму при переполнении за полный дефицит не выдаём.
  result.done = result.goals.length > 0 && result.goals.every(g => g.status === 'done');
  if (!rows.length && inputError) result.blocked.push({ qid: '', item: 0, code: '', reason: inputError });
  return result;
 }
 const api = { plan, MAX_DEPTH, MAX_VISITS, MAX_GOALS };
 root.L2CraftPlan = api;
 if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

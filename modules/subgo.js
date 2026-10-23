/* L2wap 20.43 (John 21.10 13:37: «раздел сабкласс, выбрал сабкласс нажал старт, он его сменил и одел топ шмот и топ бижутерию, и оружие
   с щитом (если щит предусмотрен в сборке)»; 13:45: «научись одевать шмот после смены класса… чтобы работало все шустро»).
   Живая проверка 21.10 13:47–14:00 (Warsmith 49 → Fortune Seeker 76 → Arcana Lord 78 → Warsmith):
   - смена класса — POST /character/subclasses/switch {slot, expectedRevision} (≈1,4 с), только рядом с Maestro Reorin (Oren) или
     Magister Ladd (Ivory Tower): /character/subclasses → classes.nearClassMaster. Обычный телепорт POST /game/teleport {teleportId:'oren',
     expectedAdenaCost, expectedRevision} ставит героя прямо к Reorin (82956, 53162) — nearClassMaster сразу true (с VIP бесплатно);
   - смена снимает баффы и отзывает слугу/голема; надетое остаётся, пока сервер его пускает (грейд выше уровня класса уходит в сумку);
   - вещи общие: каталог GET /character/catalog-hints (gearCatalog: slot, grade, weaponType, weaponMode, blocksShield, armorType, stats;
     itemStatsHints: pDef, shieldDef, jewelMdefFlat…; equipmentGradeMinCharLevel; itemRequiredLevelHints); надеть — POST /character/equip
     {action:'equip', itemId, enchant, targetInstanceId, enchantPAtkBonus?, enchantMAtkBonus?, expectedRevision}, снять —
     {action:'unequip', slot, expectedRevision}. targetInstanceId — как у игры (L2.mkBagEnchantTargetId в l2-enchant-client.js).
   Слоты inventory.eq: l1 оружие, l2 щит, l3 грудь (или цельная броня), l4 ноги, lh шлем, lg перчатки, lf ботинки, le1/le2 серьги,
   lr1/lr2 кольца, neck; пояс/плащ/тату (belt/cloak/tattoo) общие на все классы — их не трогаем.
   Что выбираем: грейд важнее цифр (как equipment.rankWeapons), из того, что лежит в сумке или надето; склад — только подсказка в меню.
   Оружие — вид «в класс» (маг — магическое, спойлер — дубина, Warsmith — булава+щит на РБ / пика на фарм, через crafterKit, если есть),
   щит — если оружие одноручное и сборка его допускает. Броня — тип класса (маг — роба), тяжёлая/лёгкая — что даёт больше с бонусом сета. */
(function (root) {
 'use strict';
 root.L2V7Factories = root.L2V7Factories || Object.create(null);
 const GR = { NG: 0, D: 1, C: 2, B: 3, A: 4, S: 5 };
 const ARMOR = ['lh', 'lg', 'lf'], PAIRS = { earring: ['le1', 'le2'], ring: ['lr1', 'lr2'] };
 const SLOT_OF = { lh: 'head', lg: 'gloves', lf: 'feet', neck: 'neck' };
 const SLOT_RU = { l1: 'оружие', l2: 'щит', l3: 'броня', l4: 'штаны', lh: 'шлем', lg: 'перчатки', lf: 'ботинки', le1: 'серьга', le2: 'серьга', lr1: 'кольцо', lr2: 'кольцо', neck: 'ожерелье' };
 const WT_RU = { blunt: 'дубина/булава', bigblunt: 'двуруч. дубина', pole: 'древковое (пика)', sword: 'меч', bigsword: 'двуруч. меч', dagger: 'кинжал', dual: 'парные мечи', bow: 'лук', fist: 'кастеты', magic: 'магическое' };
 // вид оружия по классу (профессия из /character без расы): первый найденный вид в списке — лучший
 const CLASS_WT = [
  [/warsmith|maestro|artisan/, ['blunt', 'bigblunt']],
  [/scavenger|bounty hunter|fortune seeker|dwarven fighter/, ['blunt', 'bigblunt', 'pole']],
  [/warlord|dreadnought/, ['pole']],
  [/destroyer|titan|orc raider/, ['bigsword', 'bigblunt']],
  [/tyrant|grand khavatari|monk/, ['fist']],
  [/gladiator|duelist|bladedancer|spectral dancer/, ['dual', 'sword']],
  [/swordsinger|sword muse/, ['sword', 'dual']],
  [/rogue|treasure hunter|adventurer|scout|plainswalker|wind rider|assassin|abyss walker|ghost hunter/, ['dagger']],
  [/hawkeye|sagittarius|silver ranger|moonlight sentinel|phantom ranger|ghost sentinel/, ['bow']],
  [/knight|paladin|avenger|templar/, ['sword', 'blunt']],
 ];
 const profKey = p => String(p || '').replace(/^(?:human|elf|dark_elf|orc|dwarf)_/, '').replace(/_/g, ' ').toLowerCase();
 const isMageProf = (p, branch) => branch === 'mystic' || /mage|mystic|wizard|warlock|summoner|arcana lord|sorcer|necromancer|bishop|prophet|cleric|spellhowler|spellsinger|oracle|elder|shaman|overlord|warcryer|archmage|soultaker|cardinal|hierophant|muse|elemental master|saint|storm screamer|spectral master|dominator|doomcryer/.test(profKey(p));
 const classWt = p => (CLASS_WT.find(([re]) => re.test(profKey(p))) || [null, null])[1];
 const isCrafter = p => /warsmith|maestro|artisan/.test(profKey(p));
 const num = v => { const n = +v; return Number.isFinite(n) ? n : 0; };
 // броня клановых вещей в каталоге без armorType — по имени: «магічн» роба, «важк» тяжёлая, остальное лёгкая
 const armorTypeOf = g => g?.armorType || (/магіч|magic|robe|mystic/i.test(g?.nameUk || '') ? 'magic' : /важк|heavy/i.test(g?.nameUk || '') ? 'heavy' : g?.slot && /chest|legs|fullarmor|head|gloves|feet/.test(g.slot) ? 'light' : null);
 // токен экземпляра в сумке — как у игры (l2-enchant-client.js mkBagEnchantTargetId + weapon-augmentation-display.js bagInstanceId)
 function bagToken(row, slot) {
  const id = +row.itemId, en = Math.max(0, Math.floor(num(row.enchant)));
  if (num(row.rebirthWeaponAttack) > 0 || num(row.rebirthShieldPoints) > 0 || row.rebirthAffixes) return null;   // перерождённые — не умеем, пусть надевает игрок
  const uid = String(row.augmentation?.uid || '');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid)) return `bag:${id}:${en}:aug-${uid}`;
  // клановые вещи (clan-armor-inventory-client.js): экземпляр по своему UID; живая проверка 21.10: без него «Предмета немає в сумці»
  const clan = String(row.clanArmorUid || row.clanWeaponUid || row.clanShieldUid || row.clanJewelryUid || '').trim();
  if (clan) return `bag:${id}:${en}:${clan}`;
  if (row.specialGearLevel != null) return `bag:${id}:${en}:u${Math.floor(num(row.specialGearLevel))}`;
  if (slot === 'rhand' && en > 0) {
   if (row.enchantPAtkBonus == null || row.enchantMAtkBonus == null) return null;
   const t = `bag:${id}:${en}:${Math.floor(num(row.enchantPAtkBonus))}:${Math.floor(num(row.enchantMAtkBonus))}`;
   const H = Array.isArray(row.weaponEnchantHistory) ? row.weaponEnchantHistory : [], L = Math.floor(num(row.weaponEnchantLegacyLevels));
   if (H.some(x => !['physical', 'magic', 'balanced'].includes(x))) return null;
   const track = (L > 0 ? 'L' + L : '') + (H.length ? 'H' + H.map(x => ({ physical: 'p', magic: 'm', balanced: 'b' })[x]).join('') : '');
   return track ? t + ':' + track : t;
  }
  return `bag:${id}:${en}`;
 }
 const eqRow = v => v == null ? null : typeof v === 'number' ? { itemId: v, enchant: 0 } : v.itemId ? v : null;
 // все вещи героя (надетые и в сумке) с данными каталога; n — сколько экземпляров (стопка одинаковых колец)
 function pool(ch, cat) {
  const G = {}; for (const g of cat?.gearCatalog || []) G[+g.itemId] = g;
  const S = cat?.itemStatsHints || {}, out = [];
  const add = (row, where) => { const g = G[+row.itemId]; if (!g || !g.slot || g.slot === 'consumable') return;
   const st = { ...(g.stats || {}), ...(S[row.itemId] || {}) };
   out.push({ id: +row.itemId, row, g, st, slot: g.slot, grade: String(g.grade || st.grade || 'NG').toUpperCase(), en: Math.max(0, Math.floor(num(row.enchant))), where, n: where === 'bag' ? Math.max(1, Math.floor(num(row.qty) || 1)) : 1,
    req: Math.max(num(g.requiredLevel), num(st.requiredLevel), num(cat?.itemRequiredLevelHints?.[row.itemId])), name: g.nameUk || cat?.itemNamesUk?.[row.itemId] || '#' + row.itemId,
    token: bagToken(row, g.slot) }); };
  const eq = ch?.inventory?.eq || {};
  for (const k of ['l1', 'l2', 'l3', 'l4', 'lh', 'lg', 'lf', 'le1', 'le2', 'lr1', 'lr2', 'neck']) { const r = eqRow(eq[k]); if (r && !(k === 'l2' && r.itemId === eqRow(eq.l1)?.itemId)) add(r, k); }
  for (const r of ch?.inventory?.stacks || []) if (+r.qty > 0) add(r, 'bag');
  return out;
 }
 const canWear = (it, lvl, cat) => (!!it.token || it.where !== 'bag') && lvl >= num(cat?.equipmentGradeMinCharLevel?.[it.grade] ?? { NG: 1, D: 20, C: 40, B: 52, A: 61, S: 76 }[it.grade]) && lvl >= it.req;
 const gr = it => GR[it.grade] ?? 0;
 // сила оружия: магу M.Atk, воину P.Atk, с бонусом заточки
 const wpow = (it, mage) => mage ? num(it.st.mAtk) + num(it.row.enchantMAtkBonus) : num(it.st.pAtk) + num(it.row.enchantPAtkBonus);
 const apow = it => num(it.st.pDef) + num(it.st.mDef) + it.en * 3;
 const jpow = (it, mage) => num(it.st.jewelMdefFlat) + num(it.st.jewelMaxHp) / 10 + num(it.st.pDef) + (mage ? num(it.st.jewelryMAtk) : 0) + (Array.isArray(it.st.epicExtraLinesUk) ? 100 : 0) + it.en * 3;
 const best = (list, pow) => [...list].sort((a, b) => gr(b) - gr(a) || pow(b) - pow(a) || (a.where === 'bag') - (b.where === 'bag'))[0] || null;
 /* план комплекта: { slots: { l1: item|null, … }, why: [...] }. opt: { lvl, prof, branch, wt: ['pole'] — вид оружия (порядок — приоритет),
    shield: true|false|null (null — по классу: маг и одноручное — да), armor: 'heavy'|'light'|'magic'|null } */
 function planGear(ch, cat, opt = {}) {
  const lvl = num(opt.lvl ?? ch?.level), prof = opt.prof ?? ch?.l2Profession, mage = isMageProf(prof, opt.branch ?? ch?.classBranch);
  const all = pool(ch, cat).filter(it => canWear(it, lvl, cat)), why = [], slots = {};
  // оружие
  const W = all.filter(it => it.slot === 'rhand' && (mage ? it.g.weaponMode === 'magic' : it.g.weaponMode !== 'magic'));
  const order = opt.wt?.length ? opt.wt : mage ? null : classWt(prof);
  let weapon = null;
  if (order) for (const t of order) { weapon = best(W.filter(it => it.g.weaponType === t), it => wpow(it, mage)); if (weapon) break; }
  if (!weapon) weapon = best(W, it => wpow(it, mage));
  if (!weapon && order?.length) why.push(`нет оружия вида ${order.map(t => WT_RU[t] || t).join('/')}`);
  slots.l1 = weapon;
  // щит
  const twoH = !!weapon?.g?.blocksShield || /^(?:bigsword|bigblunt|pole|bow|dual|fist)$/.test(weapon?.g?.weaponType || '');
  const wantShield = opt.shield ?? true;
  slots.l2 = wantShield && !twoH ? best(all.filter(it => it.slot === 'lhand'), it => num(it.st.shieldDef) + it.en * 3) : null;
  if (twoH) why.push('двуручное — без щита');
  // броня: по каждому типу считаем комплект (шлем/перчатки/ботинки + грудь и ноги или цельная), выбираем лучший с бонусом сета
  const sets = cat?.armorSetCatalog || [];
  const types = opt.armor ? [opt.armor] : mage ? ['magic'] : ['heavy', 'light'];
  let A = null;
  for (const T of types) {
   const of = s => { const own = all.filter(it => it.slot === s && armorTypeOf(it.g) === T); return best(own, apow) || (opt.armor || !mage ? null : null); };
   const pick = {}; for (const k of ARMOR) pick[k] = of(SLOT_OF[k]);
   const chest = of('chest'), legs = of('legs'), full = of('fullarmor');
   const sc = it => it ? gr(it) * 1000 + apow(it) : 0;
   if (full && sc(full) >= sc(chest) + sc(legs)) { pick.l3 = full; pick.l4 = null; } else { pick.l3 = chest; pick.l4 = legs; }
   const ids = new Set(Object.values(pick).filter(Boolean).map(it => it.id));
   const bonus = sets.filter(s => (s.pieceIds || []).length && s.armorType && s.armorType === T && s.pieceIds.filter(id => ids.has(+id)).length >= Math.min(...(s.stages || [{ requiredCorePieces: 99 }]).map(x => num(x.requiredCorePieces) || 99))).length;
   const total = Object.values(pick).reduce((a, it) => a + sc(it), 0) + bonus * 1500;
   if (!A || total > A.total) A = { T, pick, total };
  }
  // пустые слоты брони — лучшее любого типа (перчатки Plated Leather к тяжёлому Ironclad), но не роба воину и не латы магу
  const okType = it => { const t = armorTypeOf(it.g); return mage ? t !== 'heavy' : t !== 'magic'; };
  for (const [k, s] of [...ARMOR.map(k => [k, SLOT_OF[k]]), ['l3', 'chest'], ['l4', 'legs']]) {
   if (A.pick[k] || (k === 'l4' && A.pick.l3?.slot === 'fullarmor')) continue;
   A.pick[k] = best(all.filter(it => it.slot === s && okType(it)), apow);
   if (k === 'l3' && !A.pick.l3) { const f = best(all.filter(it => it.slot === 'fullarmor' && okType(it)), apow); if (f) { A.pick.l3 = f; A.pick.l4 = null; } }
  }
  Object.assign(slots, A.pick);
  // бижутерия: по две серьги/кольца (разные экземпляры: стопка из двух одинаковых — обе)
  for (const [kind, keys] of Object.entries(PAIRS)) {
   const L = all.filter(it => it.slot === kind).flatMap(it => Array.from({ length: Math.min(2, it.n) }, () => it));
   const s = [...L].sort((a, b) => gr(b) - gr(a) || jpow(b, mage) - jpow(a, mage));
   slots[keys[0]] = s[0] || null; slots[keys[1]] = s[1] || null;
  }
  slots.neck = best(all.filter(it => it.slot === 'neck'), it => jpow(it, mage));
  return { slots, armor: A.T, mage, why };
 }
 // что поменять: надетое ≠ плану. Пары серёг/колец сравниваем как набор (порядок слотов не важен)
 function diff(ch, plan) {
  const eq = ch?.inventory?.eq || {}, cur = k => eqRow(eq[k]), same = (r, it) => !!r && !!it && +r.itemId === it.id && Math.floor(num(r.enchant)) === it.en;
  const ops = [];
  // щит при новом оружии без щита (двуручное или «не надевать») снимаем первым: не надеемся, что игра снимет его сама
  if (!plan.slots.l2 && cur('l2') && cur('l2').itemId !== cur('l1')?.itemId) ops.push({ op: 'unequip', slot: 'l2', was: cur('l2') });
  for (const k of ['l1', 'l2', 'l3', 'l4', 'lh', 'lg', 'lf', 'neck']) {
   const it = plan.slots[k];
   if (k === 'l2' && !it) continue;
   if (k === 'l4' && !it) continue;              // цельная броня занимает и ноги — игра снимет штаны сама
   if (!it || same(cur(k), it) || it.where === k) continue;
   ops.push({ op: 'equip', slot: k, it });
  }
  for (const keys of Object.values(PAIRS)) {
   const want = keys.map(k => plan.slots[k]).filter(Boolean), have = keys.map(k => ({ k, r: cur(k) }));
   const keep = [], need = [...want];
   for (const h of have) { const i = need.findIndex(it => same(h.r, it)); if (i >= 0) { keep.push(h.k); need.splice(i, 1); } }
   if (!need.length) continue;
   // при двух занятых слотах игра меняет первый — сначала освобождаем лишние, потом надеваем
   for (const h of have) if (h.r && !keep.includes(h.k)) ops.push({ op: 'unequip', slot: h.k, was: h.r });
   for (const it of need) ops.push({ op: 'equip', slot: keys[0], it, pair: true });
  }
  return ops;
 }
 const body = (op, rev) => op.op === 'unequip' ? { action: 'unequip', slot: op.slot, expectedRevision: rev }
  : { action: 'equip', itemId: op.it.id, enchant: op.it.en, targetInstanceId: op.it.token, ...(op.it.slot === 'rhand' && op.it.row.enchantPAtkBonus != null ? { enchantPAtkBonus: Math.floor(num(op.it.row.enchantPAtkBonus)), enchantMAtkBonus: Math.floor(num(op.it.row.enchantMAtkBonus)) } : {}), expectedRevision: rev };
 const L2SubGear = { planGear, diff, body, pool, bagToken, armorTypeOf, isMageProf, classWt, isCrafter, WT_RU, SLOT_RU };
 root.L2SubGear = L2SubGear;
 // 20.43 (John 21.10): вкладка «Сабкласс» → «▶ Старт»: rt.subGo {slot, kit, wt, shield, t}. Шаг ядра (loopMenuJobs, вне боя):
 // к Reorin (бесплатный с VIP телепорт — сразу POST, платный — обычный перелёт zoneGo с защитой оплаты) → switch → комплект → страница карты.
 // Баффы после смены: смена класса меняет rt.classCur (story.charNote) — подготовка старта котовода и сторож баффов ведут обычный порядок.
 root.L2V7Factories.subgo = function create_subgo(env) {
  const JOB_MAX = 5 * 60000, HOLD_AFTER = 90000;
  let busy = false, cat = null, catVer = '', doneT = 0;
  const job = () => env.rt.subGo;
  const sameJob = J => !!J && env.rt.subGo?.t === J.t && env.on !== false && env.tabOwner !== false;
  async function getJ(path) { const r = await env.gameGet(path); return { ok: r.ok, status: r.status, j: await r.json().catch(() => null) }; }
  async function postJ(path, b) { const r = await env.gamePost(path, b); return { ok: r.ok, status: r.status, j: await r.json().catch(() => null) }; }
  async function hero() { const R = await getJ('/character'), ch = R.j?.character; return ch && (!env.rt.char || ch.name === env.rt.char) && Number.isSafeInteger(ch.revision) ? ch : null; }
  // POST с expectedRevision: 409 — revision ушла (игрок или страница тоже действуют), берём serverRevision и повторяем
  async function post409(path, mk, rev) {
   const J = job(), who = env.rt.char, valid = () => sameJob(J) && env.rt.char === who && !env.isBattle?.() && env.canAct?.() !== false;
   let R = null;
   for (let i = 0; i < 4; i++) {
    // 23.10 (бегунок скорости): комплект и 409-повторы тоже идут с общей паузой; отменённый шаг не отправляем.
    if (env.actionWait && !await env.actionWait(valid) || !valid()) throw Error('action_cancelled');
    R = await postJ(path, mk(rev));
    if (R.status !== 409) return R;
    rev = Number.isSafeInteger(R.j?.serverRevision) ? R.j.serverRevision : (await hero())?.revision;
    if (!Number.isSafeInteger(rev)) return R;
   }
   return R;
  }
  async function catalog(ch) {
   const v = String(ch?.catalogVersion || '');
   if (cat && (!v || v === catVer)) return cat;
   const R = await getJ('/character/catalog-hints');
   if (R.ok && Array.isArray(R.j?.gearCatalog)) { cat = R.j; catVer = v; }
   return cat;
  }
  const errOf = R => String(R?.j?.messageRu || R?.j?.message || R?.j?.error || ('HTTP ' + R?.status)).slice(0, 120);
  const profRu = p => String(p || '?').replace(/^(?:human|elf|dark_elf|orc|dwarf)_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  async function finish(J, ok, why, extra = {}) {
   if (!sameJob(J)) return;
   doneT = Date.now();
   env.rec('B', 'саб', `${ok ? '✓' : '✗'} ${why}`);
   await env.setRt({ subGo: null, subGoSay: { t: Date.now(), ok: !!ok, why: String(why).slice(0, 400), ...extra } });
   env.setStatus(`Сабкласс: ${why}`.slice(0, 160));
   // страница игры показывает прежний класс и вещи — перечитываем её (заодно свой GET /character игры обновит панель боя)
   if (ok && extra.changed) { await env.rtCommit?.(); if (env.on !== false && env.tabOwner !== false) { location.href = '/map.html'; await env.sleep(3000); } }
  }
  // какой вид оружия и щит: явный выбор в меню важнее; крафтер — сборка под задание (булава+щит на РБ, пика на фарм)
  function kitOpt(J, ch) {
   const o = {};
   if (J.wt && J.wt !== 'auto') o.wt = J.wt === 'magic' ? null : [J.wt];
   if (J.shield === 'on') o.shield = true; else if (J.shield === 'off') o.shield = false;
   if (isCrafter(ch.l2Profession) && (!J.wt || J.wt === 'auto')) {
    let kind = J.kit && J.kit !== 'auto' ? J.kit : null;
    if (!kind) { try { kind = env.crafterKit?.want?.() || null; } catch (_) { kind = null; } }
    if (!kind) kind = /raid|rb|epic/.test(String(env.taskNow?.() || '')) ? 'rb' : 'farm';
    if (kind === 'rb') { o.wt = ['blunt', 'bigblunt']; if (o.shield == null) o.shield = true; }
    else { o.wt = ['pole', 'blunt']; if (o.shield == null) o.shield = false; }
    o.kind = kind;
   }
   return o;
  }
  async function gear(J, ch) {
   const C = await catalog(ch); if (!sameJob(J)) return true;
   if (!C) { await finish(J, false, 'каталог вещей игры не прочитан'); return true; }
   const opt = kitOpt(J, ch), done = [], fail = [];
   let rev = ch.revision, cur = ch;
   for (let round = 0; round < 2; round++) {
    const P = planGear(cur, C, opt), ops = diff(cur, P);
    if (!ops.length) break;
    for (const op of ops) {
     if (!sameJob(J) || env.isBattle?.()) return true;
     env.setStatus(`Сабкласс: ${op.op === 'equip' ? 'надеваю ' + op.it.name : 'снимаю ' + (SLOT_RU[op.slot] || op.slot)}`);
     let R; try { R = await post409('/character/equip', r => body(op, r), rev); } catch (e) { if (e?.message === 'action_cancelled') return true; R = { status: 0, j: { error: String(e?.message || e) } }; }
     const c = R?.j?.character;
     if (c && Number.isSafeInteger(c.revision)) { rev = c.revision; cur = c; }
     if (R?.ok) { if (op.op === 'equip') done.push(op.it.name); }
     else fail.push(`${op.op === 'equip' ? op.it.name : 'снять ' + (SLOT_RU[op.slot] || op.slot)}: ${errOf(R)}`);
    }
    const f = await hero(); if (!sameJob(J)) return true;
    if (!f) break; cur = f; rev = f.revision;
   }
   const P = planGear(cur, C, opt), left = diff(cur, P).filter(o => o.op === 'equip');
   const worn = Object.entries(P.slots).filter(([, v]) => v).map(([k, v]) => `${SLOT_RU[k]}: ${v.name}${v.en ? ' +' + v.en : ''}`);
   const head = `${profRu(cur.l2Profession)} ${cur.level}${opt.kind ? ` (сборка ${opt.kind === 'rb' ? 'на РБ' : 'на фарм'})` : ''}`;
   const why = `${head}: надето ${done.length ? done.length + ' вещ.' : 'всё уже было на месте'}${P.why.length ? ' · ' + P.why.join(', ') : ''}${fail.length ? ' · не удалось: ' + fail.slice(0, 4).join('; ') : ''}${left.length ? ' · осталось ' + left.length : ''}`;
   await finish(J, !fail.length && !left.length, why, { worn, changed: done.length > 0, slot: cur.classSlots?.activeSlot });
   return true;
  }
  async function step() {
   const J = job(); if (!J || busy) return false;
   if (env.on === false || env.tabOwner === false || env.isBattle?.()) return false;
   if (env.rt.zoneGo) return false;              // перелёт к Reorin идёт обычным шагом навигации
   if (Date.now() - (+J.t || 0) > JOB_MAX) { await finish(J, false, 'не уложился в 5 мин — проверьте героя'); return true; }
   busy = true;
   try {
    let ch = await hero(); if (!sameJob(J)) return true;
    if (!ch) { env.setStatus('Сабкласс: жду ответа игры'); await env.sleep(2000); return true; }
    if (ch.inBattle) { env.setStatus('Сабкласс: герой в бою — жду конца боя'); return false; }
    const slot = J.slot != null && J.slot !== "" && Number.isInteger(+J.slot) ? +J.slot : ch.classSlots?.activeSlot;
    if (ch.classSlots?.activeSlot === slot) return await gear(J, ch);
    const row = (ch.classSlots?.slots || []).find(x => +x.slot === slot);
    if (!row?.owned) { await finish(J, false, `слот ${slot}: класса нет`); return true; }
    const S = await getJ('/character/subclasses'); if (!sameJob(J)) return true;
    if (!S.ok) { await finish(J, false, `список классов не прочитан (${errOf(S)})`); return true; }
    if (!S.j?.classes?.nearClassMaster) {
     if (J.tpT) { await finish(J, false, 'после телепорта Maestro Reorin не рядом — смените класс вручную'); return true; }
     const tp = env.cfg.subMasterTp || 'oren';
     const L = await getJ('/game/teleport/locations'), x = (L.j?.locations || []).find(l => l?.teleportId === tp);
     const price = x ? +(x.vipFreeApplied ? 0 : x.adenaCost ?? x.baseAdenaCost) : NaN;
     if (!sameJob(J)) return true;
     if (!Number.isFinite(price)) { await finish(J, false, `цена телепорта в ${tp} неизвестна`); return true; }
     if (price > (env.cfg.subTpMax ?? 100000)) { await finish(J, false, `телепорт в ${tp} ${price} адены дороже лимита`); return true; }
     await env.setRt({ subGo: { ...J, tpT: Date.now() } });
     if (price > 0) { env.rec('B', 'саб', `лечу к Maestro Reorin (${tp}, ${price} адены) — смена на ${profRu(row.profession)}`); await env.setRt({ zoneGo: { id: tp, t: Date.now(), why: 'смена класса' } }); return true; }
     env.setStatus('Сабкласс: телепорт к Maestro Reorin (бесплатно)');
     const R = await post409('/game/teleport', r => ({ teleportId: tp, expectedAdenaCost: 0, expectedRevision: r }), ch.revision);
     if (!sameJob(J)) return true;
     if (!R.ok) { await finish(J, false, `телепорт к Reorin: ${errOf(R)}`); return true; }
     ch = R.j?.character || await hero(); if (!ch) return true;
    }
    env.setStatus(`Сабкласс: меняю класс на ${profRu(row.profession)}`);
    const R = await post409('/character/subclasses/switch', r => ({ slot, expectedRevision: r }), ch.revision);
    if (!sameJob(J)) return true;
    if (!R.ok) {
     const busyErr = /busy/.test(String(R.j?.error || R.j?.code || ''));
     if (busyErr && (+J.busyN || 0) < 3) { await env.setRt({ subGo: { ...env.rt.subGo, busyN: (+J.busyN || 0) + 1 } }); env.setStatus('Сабкласс: игра занята (бой/движение) — повторю'); await env.sleep(5000); return true; }
     await finish(J, false, `смена класса: ${errOf(R)}`); return true;
    }
    const nc = await hero(); if (!sameJob(J)) return true;
    if (!nc || nc.classSlots?.activeSlot !== slot) { await finish(J, false, 'игра не подтвердила смену класса'); return true; }
    env.classNote?.(nc);                          // память класса (classStash), слоты, роль — как по сети игры
    env.rec('B', 'саб', `класс: ${profRu(nc.l2Profession)} ${nc.level} (слот ${slot}) — баффы и слуга сняты игрой, одеваю лучшее`);
    return await gear(J, nc);
   } catch (e) {
    if (e?.message === 'action_cancelled') return true;
    if (sameJob(J)) env.setStatus(`Сабкласс: ${String(e?.message || e).slice(0, 80)} — повторю`);
    await env.sleep(2000); return true;
   } finally { busy = false; }
  }
  // пока идёт смена/переодевание (и минуту после) автонадевание оружия и набор крафтера не вмешиваются
  const gearBusy = () => busy || !!job() || Date.now() - doneT < HOLD_AFTER;
  return { ...L2SubGear, step, gearBusy, kitOpt };
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);

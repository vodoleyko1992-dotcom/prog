'use strict';
// 8.0.3 (разбор логов 11.10 09:01–09:17): частичный список РБ, зона после телепорта, банки при «банки не нужны», платные FA-баффы
// не «городские», чтение оружия в туре, смена режима в журнале
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
(async () => {
  // 1. пауза на 9-й странице из 14: старые записи на месте, список «несвежий» (перечитка через 3 мин)
  const raidSrc = read('modules/raid.js');
  assert.match(raidSrc, /if \(!nx \|\| nx\.disabled\) \{ complete = true; break; \}/);
  assert.match(raidSrc, /if \(!complete\) \{\n    await env\.setRt\(\{ rbList: \{ \.\.\.\(env\.rt\.rbList \|\| \{\}\), \.\.\.all \}, rbListT: Date\.now\(\) - 12 \* 60000, rbScan: null \}\);/);
  // 2. после платного телепорта тура зона сбрасывается (EXP/ч не уходит в прежнюю зону)
  // 10.0.14: резерв передан атомарному helper; очистка зоны по-прежнему идёт до платного клика.
  assert.match(raidSrc, /rbTeleportFire\(b, \{ rbHunt: \{ \.\.\.H, step: 'arrive', at: Date\.now\(\), t: Date\.now\(\) \}, rbWant: H\.id, zoneGoT: Date\.now\(\), zone: null, zonePend: null, rbGoCnt:/);
  // 3. прогноз «банки не нужны» (usePots=false) — в полосе не пьём, только ниже аварийного порога
  const combat = read('modules/combat.js');
  assert.match(combat, /if \(potAt > 0 && ctx\.rb\.usePots === false && me\.cur > emergencyFloor\) potAt = -1;/);
  assert.ok(combat.indexOf('if (potAt > 0 && ctx.rb.usePots === false') < combat.indexOf('if (frenzyDive(ctx, me))'), 'before the Frenzy rule');
  // 4. FA-баффы на 3 ч не записываются в «городские» (иначе по окончании — лишний поход к бесплатному бафферу)
  const buffs = read('modules/buffs.js');
  assert.match(buffs, /\(L\[id\] \? e - now > 25 \* 60000 : e - now > 3\.2 \* 3600000\) && !faIds\.includes\(id\) && !sessIds\.includes\(id\)/);
  // 5. в туре оружие читается на шаге выбора (не чаще раза в 30 мин)
  const content = read('content.js');
  const a = content.indexOf("Date.now() - (rt.invTourT || 0) > 30 * 60000) { await setRt({ invTourT: Date.now() }); await invScanStart(); continue; }");
  assert.ok(a > 0 && a < content.indexOf("if (autonomyMode() === 'raid' && !isBattle()) { await rbHuntStep();"), 'weapon scan before the tour step');
  // 6. смена режима — в журнал
  const ms = vm.runInNewContext(`${content.match(/const rbEff = [^;]+;/)[0]}\n${content.match(/const modeSig = [^;]+;/s)[0]}\nmodeSig`);
  assert.equal(ms({ rbHuntMode: true, tvtOn: true }), 'тур РБ + TvT');
  assert.equal(ms({ fishMode: true, rbBetween: true }), 'рыбалка', 'suspended add-on is not shown');
  assert.equal(ms({}), 'фарм на месте');
  assert.match(content, /if \(m0 !== m1 && tabOwner\) try \{ rec\('U', 'меню', `режим: \$\{m0\} → \$\{m1\}`\); \} catch \(e\) \{\}/);
  console.log('PASS: 8.0.3 log fixes — partial RB list merged and rescanned in 3 min, zone reset after a tour teleport, no band potions when the forecast says none needed, FA buffs not tracked as town buffs, weapons read in the tour, mode changes logged');
})().catch(e => { console.error(e); process.exit(1); });
// 8.0.3 (лог 11.10 09:24:09): автообучение не считает страницу Cloudflare 502 заходом и снимает тревогу, когда селектор снова находится
{
  const content = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'content.js'), 'utf8');
  const f = content.slice(content.indexOf('function learnSelectors() {'), content.indexOf('// структура страницы: id и классы l2-*'));
  require('node:assert/strict').match(f, /^function learnSelectors\(\) \{\n[^\n]*\n  if \(serverDown\(\)\) return;/);
  require('node:assert/strict').match(f, /if \(!c\) \{ x\.v\+\+; if \(hit\) \{ x\.h\+\+; x\.ms = 0; if \(x\.alert\) \{ x\.alert = 0;/);
  console.log('PASS: 8.0.3 autolearn ignores 502 pages and clears the alert on the first hit of a new visit');
}

'use strict';
// 8.0.3 (ревью fx-farm): полоса уровней зоны в реальной установке (rt.spawns с уровнями 75–80 у Spiked Stakato) — одно чужое имя
// не растягивает полосу Pavel Ruins до [46,80]; дальняя страница списка не возвращает в Pavel Ruins имена Фальстона
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
let finished = false;
process.on('exit', () => { if (!finished) { console.error('FAIL: v803-zoneband не дошёл до конца'); process.exitCode = 1; } });
const sb = { console, Date, Math, JSON, location: { pathname: '/map.html', search: '', href: '' }, CSS: { escape: s => s } };
sb.globalThis = sb; vm.runInNewContext(read('modules/navigation.js'), sb);
const R = JSON.parse(read('base-profile.json')).chars.Warlock.rt;

(async () => {
  let page = [], pager = '1 / 13 (185)';
  const nenv = { cfg: {}, rt: {}, heroLvl: () => 56, isRaidId: id => /^l2dop_(?:rb|eg)_/.test(id), pageItems: () => page,
    $q: sel => sel === '#map-mob-page-ind' ? { textContent: pager } : null, rec: () => {}, setRt: p => { nenv.rt = { ...nenv.rt, ...p }; } };
  const N = sb.L2V7Factories.navigation(nenv);
  const it = (id, name, lvl) => ({ id, name, lvl, champ: false });
  // кэш спавнов как в живой установке: мобы Pavel Ruins 46–54, Stakato/Tomb (Фальстон, у Годдарда) 75–80
  const hi = { 'Spiked Stakato Shaman': 80, 'Spiked Stakato Soldier': 78, 'Spiked Stakato Captain': 78, 'Cannibalistic Stakato Follower': 77,
    'Cannibalistic Stakato Leader': 79, 'Tomb Preacher': 77, 'Tomb Guard': 75, 'Forgotten Victim': 78, 'Spiked Stakato Nurse': 79,
    'Forgotten Ancient People': 77, 'Monastery Guardian': 78 };
  const spawns = {}; let k = 0;
  for (const n of R.zoneMobs.pavel_ruins) for (let j = 0; j < 3; j++) spawns['s' + k++] = [n, hi[n] || 46 + (k % 9)];
  for (const n of Object.keys(hi)) for (let j = 0; j < 6; j++) spawns['s' + k++] = [n, hi[n]];
  const falston = [it('dense_29251', 'Spiked Stakato Captain', 78), it('dense_29266', 'Tomb Preacher', 77), it('dense_29283', 'Tomb Guard', 75),
    it('dense_29250', 'Forgotten Ancient People', 77), it('dense_29265', 'Monastery Guardian', 78), it('dense_29282', 'Spiked Stakato Shaman', 80),
    it('dense_29320', 'Forgotten Victim', 78), it('dense_29300', 'Spiked Stakato Nurse', 79), it('dense_29249', 'Spiked Stakato Soldier', 78),
    it('dense_29248', 'Cannibalistic Stakato Leader', 79), it('dense_29247', 'Cannibalistic Stakato Follower', 77)];
  // испорченный список (до чистки pavelZone803): все 31 имя, среди них 5 Stakato 77–80, + ещё Tomb/Forgotten с дальних страниц
  const dirty = [...R.zoneMobs.pavel_ruins, 'Tomb Preacher', 'Tomb Guard', 'Forgotten Victim', 'Forgotten Ancient People', 'Monastery Guardian', 'Spiked Stakato Nurse'];
  const base = mobs => ({ zoneMobs: { ...JSON.parse(JSON.stringify(R.zoneMobs)), pavel_ruins: mobs }, zoneCat: R.zoneCat, zoneStat: {}, spawns });

  // (а) полоса по сплошному куску вокруг медианы: чужие 75–80 не растягивают её, Фальстон (медиана 78) — не Pavel Ruins
  page = falston; nenv.rt = { ...base(dirty), zone: 'pavel_ruins' };
  await N.zoneHere();
  assert.match(nenv.rt.zone, /^out:/, `Falston page with 11 shared names is not Pavel Ruins (${nenv.rt.zone})`);
  // (б) и без текущей зоны: перебор зон не находит Pavel Ruins
  nenv.rt = { ...base(dirty), zone: null };
  await N.zoneHere();
  assert.match(nenv.rt.zone, /^out:/, 'no zone: Pavel Ruins is not picked for the Falston page');
  // (в) настоящий Pavel Ruins узнаётся и при испорченном списке
  page = [it('a1', 'Epic Cannon Golem', 53), it('a2', 'Ginzu Golem Prodigy X', 52), it('a3', 'Horrifying Cannon Golem I', 48), it('a4', 'Spelunking Spider', 47),
    it('a5', 'Cruel Vice Golem', 49), it('a6', 'Probe Golem Prodigy IV', 46)];
  nenv.rt = { ...base(dirty), zone: null };
  await N.zoneHere();
  assert.equal(nenv.rt.zone, 'pavel_ruins', 'real Pavel Ruins recognised');
  // (г) дальняя страница в Pavel Ruins: имена Фальстона (75–80) в список не возвращаются, свои (в полосе) — добавляются
  const clean = R.zoneMobs.pavel_ruins.filter(n => !hi[n]);
  pager = '5 / 13 (185)'; page = [...falston, it('f1', 'Bone Grinder', 51)];
  nenv.rt = { ...base(clean), zone: 'pavel_ruins' };
  await N.zoneHere();
  assert.equal(nenv.rt.zone, 'pavel_ruins', 'far page keeps the current zone');
  const pr = nenv.rt.zoneMobs.pavel_ruins;
  assert.ok(!Object.keys(hi).some(n => pr.includes(n)), `far page: no Stakato/Tomb names re-added (${pr.filter(n => hi[n])})`);
  assert.ok(pr.includes('Bone Grinder'), 'far page: own-band name is added');
  // (д) после этого ближняя страница Фальстона по-прежнему не Pavel Ruins
  pager = '1 / 13 (185)'; page = falston; nenv.rt = { ...nenv.rt, zone: null };
  await N.zoneHere();
  assert.match(nenv.rt.zone, /^out:/, 'Falston after a far-page scan is still not Pavel Ruins');
  // (е) зона без уровней в кэше и без каталога — дальняя страница добавляет имена, как раньше
  pager = '3 / 5 (60)'; page = [it('q1', 'Q1', 30), it('q2', 'Q2', 70)];
  nenv.rt = { zone: 'zz', zoneMobs: { zz: ['X'] }, zoneCat: {}, spawns: {} };
  await N.zoneHere();
  assert.equal(JSON.stringify(nenv.rt.zoneMobs.zz), JSON.stringify(['X', 'Q1', 'Q2']), 'unknown band: far-page names added as before');
  finished = true;
  console.log('PASS v803-zoneband');
})().catch(e => { console.error('FAIL v803-zoneband:', e.message); process.exitCode = 1; });

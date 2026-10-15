'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..');
const moduleOf = (name, extra = {}) => { const box = { console, URLSearchParams, CSS: { escape: x => x }, ...extra }; vm.runInNewContext(fs.readFileSync(path.join(root, 'modules', name + '.js'), 'utf8'), box); return box.L2V7Factories[name]; };
const noop = () => {}, done = async () => {};
for (const cancel of [false, true]) test(`форумный телепорт: ${cancel ? 'смена режима отменяет' : 'CoL без числа запрещена'}`, async () => {
  const loc = { pathname: '/forum/farm-resources.html', search: '', href: '' }; let clicks = 0;
  const btn = { textContent: 'Телепорт · Coin of Luck', dataset: { baseAdenaCost: '50000', adenaCost: '50000' } };
  const env = { cfg: { catMode: false }, rt: { zoneGo: { id: 'danger', url: loc.pathname, forum: true }, zoneCat: { danger: { name: 'Danger' } } }, on: true, tabOwner: true,
    setStatus: noop, rec: noop, heroLvl: () => 76, isFarmPage: () => false, sleep: done, setRt: async p => Object.assign(env.rt, p),
    $q: () => btn, fire: () => { clicks++; loc.pathname = '/map.html'; },
    waitX: async fn => { if (cancel) { env.cfg.catMode = true; env.rt.zoneGo = null; env.rt.manualKickAt = 99; } return fn(); } };
  await moduleOf('navigation', { location: loc, document: { querySelectorAll: () => [] } })(env).zoneGoStep();
  assert.equal(clicks, 0);
});
test('телепорт с форума читает цену кнопки Adena и проверяет баланс', async () => {
  for (const balance of [249999, 1000000]) {
    const loc = { pathname: '/forum-farm-resources.html', search: '', href: '' }; let clicks = 0;
    const btn = { textContent: 'Телепорт · 50 000 Adena', dataset: { baseAdenaCost: '50000', adenaCost: '50000' } };
    const env = { cfg: { shopReserve: 200000 }, rt: { char: 'Warlock', zoneGo: { id: 'ore', url: loc.pathname, forum: true }, zoneCat: { ore: { name: 'Ore' } } }, on: true, tabOwner: true,
      setStatus: noop, rec: noop, heroLvl: () => 76, isFarmPage: () => false, sleep: done, setRt: async p => Object.assign(env.rt, p), $q: () => btn,
      fire: () => { clicks++; loc.pathname = '/map.html'; return true; }, waitX: async fn => fn(),
      gameGet: async () => ({ ok: true, json: async () => ({ character: { id: 'fixture-hero', revision: 10, name: 'Warlock', adena: balance } }) }) };
    await moduleOf('navigation', { location: loc, document: { querySelectorAll: () => [], body: { innerText: '' } } })(env).zoneGoStep();
    assert.equal(clicks, balance >= 250000 ? 1 : 0);
  }
});
test('обычный телепорт с CoL без числа запрещён, подтверждённый бесплатный за адену доступен', async () => {
  for (const free of [false, true]) {
    const loc = { pathname: '/teleport.html', search: '', href: '' }; let clicks = 0;
    const currency = { textContent: free ? 'аден' : 'Coin of Luck', querySelectorAll: () => [] };
    const row = { textContent: free ? '0 аден' : 'Coin of Luck', querySelector: s => s.includes('currency') ? currency : s.includes('price-num') && free ? { textContent: '0' } : null };
    const btn = { closest: () => row }, env = { cfg: {}, rt: { zoneGo: { id: 'danger' }, zoneCat: { danger: { name: 'Danger' } } }, on: true, tabOwner: true,
      setStatus: noop, rec: noop, heroLvl: () => 76, sleep: done, setRt: async p => Object.assign(env.rt, p), $q: () => btn, shown: () => true,
      fire: () => { clicks++; loc.pathname = '/map.html'; }, waitX: async fn => fn() };
    await moduleOf('navigation', { location: loc, document: { querySelectorAll: () => [{}], body: { innerText: '' } } })(env).zoneGoStep();
    assert.equal(clicks, free ? 1 : 0);
  }
});
test('платный телепорт за адену проверяет свежий кошелёк и резерв перед кликом', async () => {
  for (const balance of [100000, 1000000]) {
    const loc = { pathname: '/teleport.html', search: '', href: '' }; let clicks = 0, reads = 0;
    const currency = { textContent: 'аден', querySelectorAll: () => [] }, row = { textContent: '100000 аден', querySelector: s => s.includes('currency') ? currency : s.includes('price-num') ? { textContent: '100000' } : null };
    const env = { cfg: { shopReserve: 200000, shopMaxSpend: 2000000 }, rt: { char: 'Warlock', zoneGo: { id: 'danger' }, zoneCat: { danger: { name: 'Danger' } } }, on: true, tabOwner: true,
      setStatus: noop, rec: noop, heroLvl: () => 76, sleep: done, setRt: async p => Object.assign(env.rt, p), $q: () => ({ closest: () => row }), shown: () => true,
      fire: () => { clicks++; loc.pathname = '/map.html'; }, waitX: async fn => fn(), gameGet: async () => { reads++; return { ok: true, json: async () => ({ character: { name: 'Warlock', adena: String(balance) } }) }; } };
    await moduleOf('navigation', { location: loc, document: { querySelectorAll: () => [{}], body: { innerText: '' } } })(env).zoneGoStep();
    assert.equal(reads, 1); assert.equal(clicks, balance >= 300000 ? 1 : 0);
  }
});
test('Stop у входа в катакомбы не запускает запасной прямой переход', async () => {
  const loc = { pathname: '/map.html', search: '', href: '' }, enter = { getAttribute: () => '/dungeon.html?dungeonId=witch' }; let clicks = 0;
  const env = { cfg: { catMode: true }, rt: {}, CAT_LIST: { witch: ['Witch', 60, 72] }, CAT_URL: '/catacombs.html', on: true, tabOwner: true,
    heroAt: () => null, isMap: () => true, $q: () => enter, shown: () => true, setStatus: noop, setRt: async p => Object.assign(env.rt, p), sleep: done,
    pause: async () => { env.on = false; }, fire: () => { clicks++; return false; }, waitFor: async () => false };
  await moduleOf('dungeons', { location: loc })(env).catGo('witch');
  assert.equal(clicks, 0); assert.equal(loc.href, '');
});

'use strict';
// 14.10: сохранение состояния не даёт разрешения продолжать переход после Stop/потери вкладки.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const part = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i); return src.slice(i, j); };
for (const manual of [false, true]) for (const service of ['cut', 'exchange', 'rod']) for (const interrupt of ['stop', 'lease', 'none']) test(`${manual ? 'ручная' : 'авто'} ${service}: commit → ${interrupt}`, async () => {
  const loc = { href: '' }, b = { on: true, tabOwner: true, rt: { fishService: service, fishSvc: manual ? { t: Date.now() } : null }, Date, location: loc, L2V7Modules:{},
    isBattle: () => false, isFishing: () => false, fishState: () => null, isChar: () => false, isFishShop: () => false, fishNow: () => true,
    setStatus() {}, setRt: async p => Object.assign(b.rt, p), sleep: async () => {}, rtCommit: async () => { if (interrupt === 'stop') b.on = false; if (interrupt === 'lease') b.tabOwner = false; } };
  const code = manual ? part('      if (rt.fishSvc && !isBattle()', '      // 9.0: камни печати') : part("      if (fishNow() && rt.fishService === 'cut')", '      // 8.0 (аудит рыбалки, лог 10.10:');
  await vm.runInNewContext('(async()=>{for(let i=0;i<1;i++){' + code + '}})()', b);
  assert.equal(loc.href, interrupt === 'none' ? service === 'exchange' ? '/fishing-shop.html' : '/char.html' : '');
});
for (const at of ['close', 'commit']) for (const interrupt of ['stop', 'lease', 'none']) test(`заточка: нет свитка → обмен, ${interrupt} во время ${at}`, async () => {
  const row = { textContent: 'Fishing Rod +5', querySelector: s => s === '.l2-char-bag-name' ? { textContent: 'Fishing Rod +5' } : {} }, loc = { href: '' };
  const b = { on: true, tabOwner: true, cfg: { rodEnchantTo: 10 }, rt: { fishRodName: 'Fishing Rod +5', fishProof: 100, fishService: 'rod' }, location: loc,
    ROD_RE2: /Fishing Rod/i, rodLvlOf: t => +(String(t).match(/\+(\d+)/)?.[1] || 0), setStatus() {}, rec() {}, fire() {}, shown: x => !!x,
    document: { querySelectorAll: () => [row] }, itemJson: () => ({ enchant: 5 }), rnd: a => a,
    $q: s => s === 'button[data-fishing-inventory-tab]' ? { getAttribute: () => 'true' } : s === '#char-bag-modal-title' ? { textContent: 'Fishing Rod +5' } : s === '#char-rod-enchant-scroll-qty' ? { textContent: '0' } : {},
    waitFor: async fn => fn(), setRt: async p => Object.assign(b.rt, p), fishNow: () => true, fishSvcDone: async () => false,
    L2V7Modules: { fishing: { fishBagPage: async () => false } } };
  const change = () => { if (interrupt === 'stop') b.on = false; if (interrupt === 'lease') b.tabOwner = false; };
  b.sleep = async n => { if (at === 'close' && n === 200) change(); }; b.rtCommit = async () => { if (at === 'commit') change(); };
  vm.runInNewContext(part('async function rodEnchant()', '// «🔪 Разделать'), b); await b.rodEnchant();
  assert.equal(loc.href, interrupt === 'none' ? '/fishing-shop.html' : '');
});

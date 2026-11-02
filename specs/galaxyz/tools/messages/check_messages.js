// Runs messages-recipes.js on fixtures/messages-*.html (REAL copies + UPSTREAM-derived) in Chromium (Playwright),
// on the live document and through DOMParser (what a background fetch() sees), and checks hard expectations.
// Usage (cwd = specs/galaxyz): NODE_PATH=/opt/node22/lib/node_modules node tools/messages/check_messages.js [--write]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const HERE = path.resolve(__dirname, '../..');
const FIX = path.join(HERE, 'fixtures');
const TEXTS = JSON.parse(fs.readFileSync(path.join(FIX, 'messages-texts.json'), 'utf8'));
const files = fs.readdirSync(FIX).filter((f) => /^messages-.*\.html$/.test(f)).sort();
const kind = (f) => /raport/.test(f) ? 'raport' : /battleHall/.test(f) ? 'hall' : 'list';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', () => {});
  await p.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  const out = {};
  let fail = 0;
  for (const f of files) {
    await p.goto('file://' + path.join(FIX, f), { waitUntil: 'domcontentloaded' });
    await p.addScriptTag({ path: path.join(HERE, 'messages-recipes.js') });
    const html = fs.readFileSync(path.join(FIX, f), 'utf8');
    out[f] = await p.evaluate(([h, k, texts]) => {
      GZMessages.setTexts(texts);
      const run = (doc) => {
        if (k === 'raport') return GZMessages.parseCombatReport(doc);
        if (k === 'hall') return GZMessages.parseBattleHall(doc);
        const list = GZMessages.parseList(doc);
        return { categories: GZMessages.parseCategories(doc), list: list && { cat: list.cat, page: list.page, pages: list.pages,
          items: list.items.map((it) => GZMessages.parseItem(it, list.cat)) } };
      };
      const live = run(document);
      const parsed = run(new DOMParser().parseFromString(h, 'text/html'));
      return { live, sameAsDomParser: JSON.stringify(live) === JSON.stringify(parsed) };
    }, [html, kind(f), TEXTS]);
    if (!out[f].sameAsDomParser) { fail++; console.error('DOMParser mismatch', f); }
  }
  // extra checks on the REAL pages: forms, topnav badge, action body built like the real form
  const extra = {};
  for (const f of ['messages-real-spy.html', 'messages-real-all.html']) {
    await p.goto('file://' + path.join(FIX, f), { waitUntil: 'domcontentloaded' });
    await p.addScriptTag({ path: path.join(HERE, 'messages-recipes.js') });
    extra[f] = await p.evaluate(() => ({
      forms: [...document.querySelectorAll('form[action*="page=messages"]')].map((x) => x.querySelector('[name=messcat]').value + (x.querySelector('#messagestable') ? '+table' : '')),
      realFormFields: (() => { const fm = document.querySelector('#messagestable').closest('form');
        return [...fm.querySelectorAll('input[type=hidden]')].map((i) => i.name + '=' + i.value).concat([...fm.querySelectorAll('select')].map((x) => x.name),
          [...fm.querySelectorAll('input[type=submit]')].map((i) => i.name + '=' + i.value)); })(),
      actions: [...document.querySelectorAll('#messagestable select[name=actionTop] option')].map((o) => o.value).join(),
      headerUnread: GZMessages.parseHeaderUnread(document),
      actionBody: GZMessages.urls.actionBody('deletemarked', [520244, 520242], 0).toString(),
      view: GZMessages.urls.view(0, 1),
      loadingTouchedByJs: document.getElementById('loading').getAttribute('style'),
    }));
  }
  console.log(JSON.stringify(extra));
  const L = (f) => out[f].live;
  const items = (f) => L(f).list.items;
  const byId = (f, id) => items(f).find((x) => x.id === id);
  const kinds = (f) => items(f).map((x) => x.kind).join();
  const exp = [
    // REAL
    ['real spy: 11 categories', L('messages-real-spy.html').categories.length === 11 && L('messages-real-spy.html').categories[0].total === 2],
    ['real spy: list cat 0, 2 items unread', L('messages-real-spy.html').list.cat === 0 && items('messages-real-spy.html').length === 2 && items('messages-real-spy.html').every((x) => x.unread)],
    ['real all: cat 100, read', L('messages-real-all.html').list.cat === 100 && items('messages-real-all.html').every((x) => !x.unread && x.kind === 'spy_report')],
    ['real spy 520244 fleet exact via simulate', (() => { const d = byId('messages-real-spy.html', 520244).data;
      return d.exact && d.resources[901] === 2684939750000 && d.resources[902] === 1700557697522 && d.resources[911] === 356568 && Object.keys(d.fleet).length === 19 &&
        d.fleet[220] === 0 && d.defense === null && d.revealed.fleet && !d.revealed.defense && d.coordsStr === '2:81:10' && d.targetName === '2 bolygó' && d.planetType === 1 && d.discoveryChance === 0; })()],
    ['real spy 520242 resources only', (() => { const d = byId('messages-real-spy.html', 520242).data;
      return d.fleet === null && !d.revealed.fleet && d.resources[903] === 6263925000 && d.reportDateText === '30. Oct 2026, 09:53:28'; })()],
    ['real all: 2 forms, list from the #messagestable one', extra['messages-real-all.html'].forms.join() === '100+table,0' && extra['messages-real-spy.html'].forms.join() === '0+table'],
    ['real: topnav badge 2', extra['messages-real-spy.html'].headerUnread === 2 && extra['messages-real-all.html'].headerUnread === 2],
    ['real: 7 actions', extra['messages-real-spy.html'].actions === 'readmarked,readtypeall,readall,deletemarked,deleteunmarked,deletetypeall,deleteall'],
    ['actionBody matches the real form fields', extra['messages-real-spy.html'].actionBody ===
      'mode=action&ajax=1&messcat=0&side=1&actionTop=deletemarked&submitTop=Confirm&messageID%5B520244%5D=1&messageID%5B520242%5D=1' &&
      extra['messages-real-spy.html'].realFormFields.join() === 'mode=action,ajax=1,messcat=0,side=1,actionTop,actionBottom,submitTop=Confirm,submitBottom=Confirm'],
    ['real spy 520244 deuterium = rounded Simulate float (shown cell)', byId('messages-real-spy.html', 520244).data.resources[903] === 675144412230],
    // UPSTREAM spy
    ['cat0 kinds', kinds('messages-upstream-view-cat0.html') === 'spy_report,spy_report,spy_detected'],
    ['cat0 full report', (() => { const d = byId('messages-upstream-view-cat0.html', 520298).data;
      return d.revealed.research && d.research[106] === 10 && d.buildings[71] === 1 && d.defense[502] === 20 && d.resources[911] === -1250 && d.resources[901] === 48211338; })()],
    ['cat0 filtered + destroyed', (() => { const d = byId('messages-upstream-view-cat0.html', 520301).data;
      return d.destroyed && d.discoveryChance === null && d.planetType === 3 && d.fleet[214] === 1 && Object.keys(d.defense).length === 0 && d.revealed.defense && !d.revealed.buildings; })()],
    ['cat0 detected', (() => { const d = byId('messages-upstream-view-cat0.html', 520290).data; return d.from.system === 70 && d.target.planet === 5; })()],
    // combat
    ['cat3 kinds', kinds('messages-upstream-view-cat3.html') === 'combat,combat,combat_expedition,missile'],
    ['cat3 attack won', (() => { const d = byId('messages-upstream-view-cat3.html', 520410).data;
      return d.reportId === '3f9a2c7e5b1d4e8f9a0b1c2d3e4f5a6b' && d.winner === 'attacker' && d.myRole === 'attacker' && d.loot[901] === 12053668 && d.debris[902] === 225000 && d.lost.defender === 1985000; })()],
    ['cat3 defended lost', (() => { const d = byId('messages-upstream-view-cat3.html', 520402).data; return d.myRole === 'defender' && d.myResult === 'loss' && d.coordsStr === '2:68:5'; })()],
    ['cat3 expedition battle', (() => { const d = byId('messages-upstream-view-cat3.html', 520399).data; return d.isExpedition && d.winner === 'defender' && d.loot[901] === 0; })()],
    ['cat3 missile', (() => { const d = byId('messages-upstream-view-cat3.html', 520390).data; return d.missiles === 25 && d.to.system === 70; })()],
    // expedition
    ['cat15 paging', L('messages-upstream-view-cat15.html').list.pages === 2 && items('messages-upstream-view-cat15.html').length === 10],
    ['cat15 outcomes', items('messages-upstream-view-cat15.html').map((x) => x.data.outcome).join() === 'resources,darkmatter,ships,ships,nothing,delay,speedup,fleet_lost,battle_pirates,resources'],
    ['cat15 ships', (() => { const d = items('messages-upstream-view-cat15.html')[2].data; return d.ships[202] === 37 && d.ships[204] === 1250; })()],
    // transport / returns
    ['cat5 kinds', kinds('messages-upstream-view-cat5.html') === 'transport_arrival,transport_received,recycle,deploy_arrival'],
    ['cat5 numbers', (() => { const i = items('messages-upstream-view-cat5.html');
      return i[0].data.resources[901] === 500000 && i[1].data.from.system === 70 && i[2].data.resources[902] === 2072500 && i[3].data.resources[903] === 89; })()],
    ['cat4 kinds', kinds('messages-upstream-view-cat4.html') === 'return,return_empty,return,return_expedition,return,colonisation'],
    ['cat4 expedition return', (() => { const d = items('messages-upstream-view-cat4.html')[3].data; return d.resources[901] === 1254000 && d.resources[921] === 450; })()],
    ['cat1 player', items('messages-upstream-view-cat1.html')[0].kind === 'player'],
    ['live-synthetic cat3 == upstream cat3', JSON.stringify(items('messages-live-synthetic-cat3.html')) === JSON.stringify(items('messages-upstream-view-cat3.html'))],
    // raport
    ['raport attacker won', (() => { const r = L('messages-upstream-raport.html');
      return r.result === 'a' && r.loot[903] === 1825031 && r.lost.defender === 1985000 && r.debris[901] === 495000 && r.moonChance === 7 && r.moonCreated &&
        r.roundsFought === 2 && r.start.attackers[0].units[207].count === 150 && r.start.defenders[0].units[401].count === 1500 && r.end.defenders[0].destroyed &&
        r.start.attackers[0].coords.system === 68 && r.start.attackers[0].tech.armour === 150 && r.rounds[0].fire.attackerPower === 1404000; })()],
    ['raport hof', (() => { const r = L('messages-upstream-raport-battlehall.html'); return r.hallOfFame && r.result === 'a' && r.start.attackers[0].coords === null; })()],
    ['raport defender won', (() => { const r = L('messages-upstream-raport-defender-won.html'); return r.result === 'r' && r.loot === null && r.lost.attacker === 2300000 && !r.moonCreated && r.end.attackers[0].destroyed; })()],
    ['battle hall', (() => { const h = L('messages-upstream-battleHall.html'); return h.length === 3 && h[0].result === 'a' && h[1].result === 'r' && h[2].result === 'w' && h[0].units === 98500000000; })()],
  ];
  for (const [n, ok] of exp) if (!ok) { fail++; console.error('FAIL', n); }
  await b.close();
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(FIX, 'messages-expected-parse.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(fail ? 'FAILED ' + fail : 'OK ' + files.length + ' pages, ' + exp.length + ' expectations');
  process.exit(fail ? 1 : 0);
})();

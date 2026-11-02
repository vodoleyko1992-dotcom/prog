// Runs tools/messages_recipes.js in Chromium against fixtures/messages-*.html and compares the
// result with fixtures/messages-expected-parse.json.  `node tools/check_messages.js --write` regenerates it.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FX = path.join(ROOT, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'messages_recipes.js'), 'utf8') });

  const input = {
    texts: JSON.parse(read('messages-expedition-texts.json')),
    espionage: read('messages-ajax-fleets-espionage.html'),
    combat: read('messages-ajax-fleets-combat_reports.html'),
    exp1: read('messages-ajax-fleets-expeditions.html'),
    exp2: read('messages-ajax-fleets-expeditions-page2.html'),
    transport: read('messages-ajax-fleets-transport.html'),
    other: read('messages-ajax-fleets-other.html'),
    economy: read('messages-ajax-economy-economy.html'),
    universe: read('messages-ajax-universe-universe.html'),
    espFull: read('messages-ajax-message-2051-espionage-full.html'),
    espMoon: read('messages-ajax-message-2044-espionage-moon-partial.html'),
    espDebris: read('messages-ajax-message-2038-espionage-debris.html'),
    batWin: read('messages-ajax-message-2053-battle-attacker-win.html'),
    batLoss: read('messages-ajax-message-2050-battle-defender-loss.html'),
    batExp: read('messages-ajax-message-2034-battle-expedition-pirates.html'),
    snapshot: read('messages-page-loaded-espionage.html'),
  };

  const out = await page.evaluate((I) => {
    const R = window.OGXMsgRecipes;
    const P = (h) => new DOMParser().parseFromString(h, 'text/html');
    const idx = R.buildExpeditionIndex(I.texts);
    const listWithKeys = (html, subtab) => {
      const doc = P(html);
      const l = R.parseMessageList(doc);
      l.messages.forEach((m) => { m.key = R.classify(doc.querySelector(`li.msg[data-msg-id="${m.id}"]`), subtab, idx); });
      return { doc, l };
    };
    const r = {};
    { const { doc, l } = listWithKeys(I.espionage, 'espionage'); r.espionageList = l;
      r.espionageShort = l.messages.filter((m) => m.key === 'espionage_report').map((m) => R.parseEspionageShort(doc.querySelector(`li.msg[data-msg-id="${m.id}"]`)));
      r.espionageDetected = l.messages.filter((m) => m.key === 'espionage_detected').map((m) => R.parseEspionageDetected(doc.querySelector(`li.msg[data-msg-id="${m.id}"]`))); }
    { const { doc, l } = listWithKeys(I.combat, 'combat_reports'); r.combatList = l;
      r.battleShort = l.messages.filter((m) => m.key === 'battle_report').map((m) => R.parseBattleShort(doc.querySelector(`li.msg[data-msg-id="${m.id}"]`))); }
    { const a = listWithKeys(I.exp1, 'expeditions'); const b = listWithKeys(I.exp2, 'expeditions');
      r.expeditionPages = [a.l.page + '/' + a.l.totalPages, b.l.page + '/' + b.l.totalPages];
      r.expeditions = [...a.l.messages.map((m) => R.parseExpedition(a.doc.querySelector(`li.msg[data-msg-id="${m.id}"]`), idx)),
        ...b.l.messages.map((m) => R.parseExpedition(b.doc.querySelector(`li.msg[data-msg-id="${m.id}"]`), idx))]; }
    for (const [name, html, sub] of [['transport', I.transport, 'transport'], ['other', I.other, 'other'], ['economy', I.economy, 'economy'], ['universe', I.universe, 'universe']]) {
      const { doc, l } = listWithKeys(html, sub);
      r[name] = l.messages.map((m) => (/^(return_of_fleet|fleet_deployment|transport_|debris_field_harvest|acs_defend)/.test(m.key)
        ? R.parseFleetMessage(doc.querySelector(`li.msg[data-msg-id="${m.id}"]`), m.key) : { id: m.id, key: m.key, title: m.title }));
    }
    r.espionageFull = [I.espFull, I.espMoon, I.espDebris].map((h) => R.parseEspionageFull(P(h)));
    r.battleFull = [I.batWin, I.batLoss, I.batExp].map((h) => R.parseBattleFull(P(h), h));
    // live page snapshot: messages inside the active subtab panel
    const snap = P(I.snapshot);
    r.snapshot = { bodyId: snap.body.id, activeTab: snap.querySelector('.js_tabs .ui-tabs-active').dataset.tabid,
      activeSubtab: snap.querySelector('.js_subtabs_fleets .ui-tabs-active').dataset.tabid,
      ids: [...snap.querySelectorAll('#ui-id-14 li.msg[data-msg-id]')].map((li) => +li.dataset.msgId),
      menuUnread: snap.querySelector('a.comm_menu.messages .new_msg_count') ? +snap.querySelector('a.comm_menu.messages .new_msg_count').dataset.newMessages : 0 };
    return r;
  }, input);

  await browser.close();
  const file = path.join(FX, 'messages-expected-parse.json');
  const json = JSON.stringify(out, null, 2) + '\n';
  if (process.argv.includes('--write') || !fs.existsSync(file)) {
    fs.writeFileSync(file, json);
    console.log('wrote', file);
  } else if (fs.readFileSync(file, 'utf8') !== json) {
    console.error('MISMATCH with', file);
    fs.writeFileSync(file + '.actual', json);
    process.exit(1);
  } else {
    console.log('OK: recipes match messages-expected-parse.json');
  }
})().catch((e) => { console.error(e); process.exit(1); });

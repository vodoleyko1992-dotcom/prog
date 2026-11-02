// Runs the copy-paste snippets of messages.md (Chromium, JS disabled, raw saved DOM) and prints their output.
// Usage (cwd = specs/galaxyz): NODE_PATH=$(npm root -g) node tools/run_messages_snippets.js [file ...] [--only=a,b] [--compact]
//   file = eu/pages/<name>.html (REAL) or fixtures/<name>.html; default: both REAL message pages.
// Snippets marked R use only DOM APIs (paste them anywhere); snippets marked G need messages-recipes-b.js (GZMessagesB).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HERE = path.resolve(__dirname, '..');
const REAL = path.resolve(HERE, '../../../eu/pages');
const RECIPES = fs.readFileSync(path.join(HERE, 'messages-recipes-b.js'), 'utf8');

const S = {
// ---- raw DOM snippets (R) ----
R_categories: `[...document.querySelectorAll('span[id^="total_"]')].map(t => {
  const id = +t.id.slice(6), td = t.closest('td'), a = td.querySelector('a[onclick*="getMessages"]');
  return id + ' ' + a.textContent.trim() + ' unread=' + document.getElementById('unread_' + id).textContent + ' total=' + t.textContent + ' ' + td.style.color;
})`,
R_headerUnread: `+document.querySelector('.messages-section .new-msg-count')?.textContent.trim() || 0`,
R_forms: `[...document.querySelectorAll('form[action*="page=messages"]')].map(f => ({
  messcat: f.querySelector('[name=messcat]').value, side: f.querySelector('[name=side]').value,
  hasTable: !!f.querySelector('#messagestable'), rows: f.querySelectorAll('tr.message_head').length }))`,
R_rows: `[...document.querySelectorAll('#messagestable tr.message_head')].map(tr => {
  const td = tr.children, body = tr.nextElementSibling;
  return { id: +tr.id.replace('message_', ''), unread: tr.classList.contains('mes_unread'),
    date: td[1].textContent.trim(), from: td[2].textContent.trim(), subject: td[3].textContent.trim(),
    bodyKind: body.querySelector('.spyRaport') ? 'spy' : body.querySelector('.raportMessage') ? 'combat' : 'text' };
})`,
R_pager: `[...document.querySelectorAll('#messagestable td.right a[onclick*="getMessages"]')].map(a =>
  a.getAttribute('onclick').match(/getMessages\\((\\d+),\\s*(\\d+)\\)/).slice(1).join(',') + (a.querySelector('b') ? ' current' : ''))`,
R_spyHead: `[...document.querySelectorAll('.spyRaport')].map(sr => {
  const t = sr.querySelector('.spyRaportHead a').textContent.trim();
  const m = t.match(/^(.*)\\[(\\d+):(\\d+):(\\d+)\\]\\s*\\S+\\s+(.*)$/);
  return { name: m[1].replace(/^Spy Report\\s+/, '').trim(), coords: [+m[2], +m[3], +m[4]], date: m[5],
    sections: [...sr.querySelectorAll('.spyRaportContainerHead')].map(h => +h.className.match(/HeadClass(\\d+)/)[1]) };
})`,
R_spyNesting: `[...document.querySelectorAll('.spyRaport')].map(sr => ({
  footerParent: sr.querySelector('.spyRaportFooter').parentElement.className,
  containers: [...sr.querySelectorAll('.spyRaportContainer')].map(c => c.querySelector('.spyRaportContainerHead').textContent +
    ': all=' + c.querySelectorAll('.spyRaportContainerCell').length +
    ' own=' + [...c.querySelectorAll('.spyRaportContainerCell')].filter(x => x.closest('.spyRaportContainer') === c).length) }))`,
R_simulate: `[...document.querySelectorAll('.spyRaportFooter a[href*="battleSimulator"]')].map(a =>
  [...new URL(a.getAttribute('href'), location.href).searchParams].filter(([k]) => /^im\\[\\d+\\]$/.test(k)).map(([k, v]) => k.slice(3, -1) + '=' + v).join(' '))`,
R_footer: `[...document.querySelectorAll('.spyRaportFooter')].map(f => {
  const a = f.querySelector('a[href*="target_mission=1"]'), q = new URL(a.getAttribute('href'), location.href).searchParams;
  return { attack: ['galaxy', 'system', 'planet', 'planettype'].map(k => +q.get(k)), text: f.textContent.replace(/\\s+/g, ' ').trim(),
    chance: +(f.textContent.match(/(\\d+)\\s*%/) || [])[1], destroyed: !!f.querySelector('font[color="red"]') };
})`,
R_actions: `[...document.querySelector('#messagestable select[name=actionTop]').options].map(o => o.value + '=' + o.textContent)`,
R_months: `[...document.scripts].map(s => s.textContent).join('').match(/var\\s+months\\s*=\\s*(\\[[^\\]]*\\])/)[1]`,
// ---- recipe snippets (G) ----
G_categories: `GZMessagesB.categories(document)`,
G_list: `(() => { const l = GZMessagesB.list(document); return { ...l, items: l.items.map(i => ({ ...i, body: undefined, key: GZMessagesB.classify(i) })) }; })()`,
G_spy: `[...document.querySelectorAll('.spyRaport')].map(sr => { const r = GZMessagesB.spyReport(sr); delete r.simulateHref; return r; })`,
G_combatShort: `[...document.querySelectorAll('.raportMessage')].map(GZMessagesB.combatShort)`,
G_combatFull: `GZMessagesB.combatFull(document)`,
G_fleetText: `GZMessagesB.list(document).items.filter(i => !i.body.querySelector('.spyRaport,.raportMessage')).map(i => { const r = GZMessagesB.fleetText(i); delete r.text; return i.id + ' ' + JSON.stringify(r); })`,
G_urls: `({ view: GZMessagesB.urls.view(0, 1), page: GZMessagesB.urls.page(3, 2), del: GZMessagesB.urls.actionBody('deletemarked', 0, [520244, 520242]) })`,
};

(async () => {
  const args = process.argv.slice(2);
  const files = args.filter(a => !a.startsWith('--'));
  const only = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
  const compact = args.includes('--compact');
  const b = await chromium.launch(); const ctx = await b.newContext({ javaScriptEnabled: false });
  for (const f of files.length ? files : [path.join(REAL, 'messages-spy.html'), path.join(REAL, 'messages-all.html')]) {
    const p = await ctx.newPage();
    await p.route('**/*', r => r.request().url().startsWith('file:') ? r.continue() : r.abort());
    await p.goto('file://' + path.resolve(f), { waitUntil: 'domcontentloaded' });
    await p.evaluate(RECIPES);
    console.log('=== ' + path.basename(f));
    for (const [k, code] of Object.entries(S)) {
      if (only.length && !only.includes(k)) continue;
      let v; try { v = await p.evaluate(code); } catch (e) { v = 'ERROR ' + e.message.split('\n')[0]; }
      console.log('--- ' + k + '\n' + JSON.stringify(v, null, compact ? 0 : 1));
    }
    await p.close();
  }
  await b.close();
})();

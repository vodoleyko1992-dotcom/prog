// R5: page=techtree (REAL, fork-specific jQuery-UI tabs). One <tr> per element; requirement spans are TEXT ONLY:
// "Shipyard (Level 2/2)" = min(own, need)/need, color lime|red. Their onclick points at the ELEMENT itself, not the requirement,
// so requirement ids must be resolved by name (names are unique across the whole tree).
(doc = document) => {
  const tabs = {}, byName = {}, rows = [];
  for (const a of doc.querySelectorAll('#tabs > ul a[href*="#tabs-"]')) tabs[a.getAttribute('href').split('#')[1]] = a.textContent.trim();
  for (const panel of doc.querySelectorAll('#tabs > div[id^="tabs-"]')) {
    for (const tr of panel.querySelectorAll('tr')) {
      const main = tr.querySelectorAll('a.main');
      if (main.length < 2) continue;
      const id = +main[1].getAttribute('onclick').match(/Dialog\.info\((\d+)\)/)[1];
      const name = main[1].textContent.trim();
      byName[name] = id;
      const reqs = [...tr.querySelectorAll('td:nth-child(3) span[style*="color"]')].map((s) => {
        const m = s.textContent.replace(/\s+/g, ' ').trim().match(/^(.*) \(\S+ (\d+)\/(\d+)\)$/);
        return { name: m[1], shown: +m[2], need: +m[3], met: /lime/.test(s.getAttribute('style')) };
      });
      rows.push({ tab: tabs[panel.id], id, name, reqs });
    }
  }
  for (const r of rows) for (const q of r.reqs) q.id = byName[q.name] ?? null;
  return rows;
}

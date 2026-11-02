// R4: page=resources production table + form (REAL). Numbers: "." thousands; storage row uses short form "3.417 M".
(doc = document) => {
  // server number formats: pretty_number "1.932.927.923" ('.' thousands, ',' decimals) and
  // shortly_number "3.417&nbsp;M" = 3417 * 1e6 (K=1e3, M=1e6, B=1e12, T=1e18: the unit steps by 1e6 after M!)
  const MULT = { K: 1e3, M: 1e6, B: 1e12, T: 1e18, Q: 1e24, 'Q+': 1e30, S: 1e36, 'S+': 1e42, O: 1e48, N: 1e54 };
  const num = (s) => {
    const m = String(s).replace(/\u00a0/g, ' ').trim().match(/^(-?[\d.]+(?:,\d+)?)\s*(Q\+|S\+|[KMBTQSON])?$/);
    if (!m) return null;
    return Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * (m[2] ? MULT[m[2]] : 1));
  };
  const form = doc.querySelector('form#resourceSettings');
  const rows = [];
  for (const tr of form.querySelectorAll('table.listOfResourceSettingsPerPlanet tr')) {
    const td = tr.querySelectorAll('td');
    if (td.length < 5) continue;
    const label = td[0].textContent.trim();
    const sel = tr.querySelector('select[name^="prod["]');
    const m = label.match(/^(.*) \((?:Level|Quantity) (\d+)\)$/);
    rows.push({
      label, id: sel ? +sel.name.match(/\d+/)[0] : null, name: m ? m[1] : null, level: m ? +m[2] : null,
      cells: [1, 2, 3, 4].map((i) => td[i].textContent.replace(/ /g, ' ').trim()),
      metal: num(td[1].textContent), crystal: num(td[2].textContent), deuterium: num(td[3].textContent), energy: num(td[4].textContent),
      percent: sel ? +sel.value * 10 : null,
    });
  }
  return { action: form.getAttribute('action'), mode: form.querySelector('input[name=mode]').value, rows };
}

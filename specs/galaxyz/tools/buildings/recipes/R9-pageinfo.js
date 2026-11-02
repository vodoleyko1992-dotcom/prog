// R9: which page am I on (REAL: <body id> + inline `var queryString`). Shipyard fleet/defense share body id "shipyard".
(doc = document) => {
  let qs = '';
  for (const s of doc.querySelectorAll('script:not([src])')) { const m = s.textContent.match(/var\s+queryString\s*=\s*"([^"]*)"/); if (m) { qs = m[1]; break; } }
  const q = new URLSearchParams(qs);
  return { bodyId: doc.body.id, queryString: qs, page: q.get('page'), mode: q.get('mode'),
           detailsAjax: (doc.documentElement.innerHTML.match(/page=(\w+DetailsAjax)/) || [])[1] || null,
           generator: doc.querySelector('meta[name=generator]')?.content };
}

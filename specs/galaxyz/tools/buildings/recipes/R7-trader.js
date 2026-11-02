// R7: page=trader (REAL). One form per resource; rate text "4/2/1"; merchant cost text.
(doc = document) => ({
  forms: [...doc.querySelectorAll('#traderContainer form')].map((f) => ({
    action: f.getAttribute('action'), fields: Object.fromEntries([...f.querySelectorAll('input[type=hidden]')].map((i) => [i.name, i.value])),
    label: f.querySelector('label').textContent.trim() })),
  cost: doc.querySelector('#traderContainer').parentElement.querySelector('p span[style*="red"]')?.textContent.trim(),
  rate: [...doc.querySelectorAll('#traderContainer ~ div p')].map((p) => p.textContent.trim()).find((t) => /exchange rate/.test(t)),
})

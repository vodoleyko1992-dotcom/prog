// R8: page=fleetDealer (REAL). `var CostInfo = {id:[amountOnPlanet, name, {901..921: "cost"}]}` is the only REAL per-unit price list.
(doc = document) => {
  let cost = null, charge = null;
  for (const s of doc.querySelectorAll('script:not([src])')) {
    const m = s.textContent.match(/CostInfo\s*=\s*(\{.*?\});/s);
    if (m) { cost = JSON.parse(m[1]); charge = +(s.textContent.match(/Charge\s*=\s*([\d.]+)/) || [])[1]; }
  }
  const units = [...doc.querySelectorAll('form#scrap .unit-item')].map((d) => ({   // all share the duplicated id="shipID"
    id: +d.querySelector('input.unit-input').name.match(/\d+/)[0], name: d.querySelector('.unit-title').textContent.trim(),
    have: +d.querySelector('input.unit-input').getAttribute('max-value'),
    price: { 901: +d.dataset.unitPriceMetal, 902: +d.dataset.unitPriceCrystal, 903: +d.dataset.unitPriceDeuterium } }));
  const forms = [...doc.querySelectorAll('form#myform, form#scrap')].map((f) => ({ id: f.id, action: f.getAttribute('action'),
    mode: f.querySelector('input[name=mode]').value, inputs: [...f.querySelectorAll('input.unit-input')].map((i) => i.name) }));
  return { charge, catalog: Object.entries(cost).map(([id, [have, name, c]]) => ({ id: +id, have: +have, name,
    cost: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, +v]).filter(([, v]) => v)) })), units, forms };
}

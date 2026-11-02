// R11: resources on hand for affordability checks (REAL header): exact values in td[data-real].
// Energy t="438 / 47.480" = free / produced. Energy PRICES (Terraformer, Graviton) are checked against PRODUCED energy
// (2Moons getRestPrice uses $PLANET['energy'], class.BuildFunctions.php:58) -> 911 = second number.
(doc = document) => {
  const real = (id) => { const e = doc.getElementById(id); return e ? Math.floor(+e.dataset.real) : null; };
  const en = doc.querySelector('#resTable td.res_current.Imperium[t], td.res_current.Imperium[t]')?.getAttribute('t') || '';
  const [free, max] = en.split('/').map((s) => +s.replace(/\D/g, ''));
  return { 901: real('current_metal'), 902: real('current_crystal'), 903: real('current_deuterium'), 911: max, energyFree: free, 921: real('current_darkmatter') };
}

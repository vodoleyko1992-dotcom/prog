// R-derive-config: page=resources (REAL markup) -> server economy constants, computed from the production table.
// Works because rows print exact upstream formula values x resource_multiplier (mines) / x energySpeed (energy).
(doc = document) => {
  const num = (t) => { const s = (t || '').replace(/[^\d-]/g, ''); return s === '' || s === '-' ? 0 : +s; };
  const rows = [...doc.querySelectorAll('table.listOfResourceSettingsPerPlanet tr')]
    .map((tr) => [...tr.querySelectorAll(':scope > td')]).filter((c) => c.length >= 5);
  const byId = {}; let basic = null, bonus = null;
  for (const c of rows) {
    const sel = c[5] && c[5].querySelector('select[name^="prod["]');
    if (sel) {
      const id = +/prod\[(\d+)\]/.exec(sel.name)[1];
      const level = +(/(\d+)\)\s*$/.exec(c[0].textContent.trim()) || [])[1];           // "Metal Mine (Level 38)" / "Solar Satellite (Quantity 797)"
      const pct = +((sel.querySelector('option[selected]') || sel.options[0] || {}).value);
      byId[id] = { level, pct, v: [1, 2, 3, 4].map((i) => num(c[i].textContent)) };
    } else if (!basic) basic = [1, 2, 3, 4].map((i) => num(c[i].textContent));          // first row = "Basic Production"
    else if (!bonus) bonus = [1, 2, 3, 4].map((i) => num(c[i].textContent));            // first select-less row after the buildings = "Bonus"
  }
  const m = byId[1], s = byId[4], sat = byId[212];
  const out = {};
  if (m && m.level && m.pct) out.resource_multiplier = Math.round(m.v[0] / (30 * m.level * 1.1 ** m.level * 0.1 * m.pct));
  if (s && s.level && s.pct) out.energySpeed = Math.round(s.v[3] / (20 * s.level * 1.1 ** s.level * 0.1 * s.pct) * 100) / 100;
  if (basic && out.resource_multiplier) { out.metal_basic_income = basic[0] / out.resource_multiplier; out.crystal_basic_income = basic[1] / out.resource_multiplier; }
  if (bonus && m && out.resource_multiplier) out.metalBonusFactor = Math.round(bonus[0] / m.v[0] * 1000) / 1000;   // = factor.Resource + 0.02 x Mineral Research(131)
  if (sat && sat.level && sat.pct && out.energySpeed) out.tempMax = Math.round(sat.v[3] / out.energySpeed / sat.level / (0.1 * sat.pct) * 6 - 160); // from (Tmax+160)/6 per satellite
  // storage multiplier x (1 + ResourceStorage): needs storage LEVELS (page=buildings) and the ticker limit (inline resourceTicker)
  const lim = /resourceTicker\(\{\s*available:[^,]+,\s*limit:\s*\[0,\s*"(\d+)"\]\s*,\s*production:\s*([\d.]+),\s*valueElem:\s*"current_metal"/.exec(doc.documentElement.innerHTML);
  if (lim) { out.metalLimit = +lim[1]; out.metalPerHour = +lim[2]; }
  return { rows: byId, basic, bonus, derived: out };
}

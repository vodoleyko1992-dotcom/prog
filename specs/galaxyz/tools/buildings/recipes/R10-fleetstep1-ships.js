// R10: real per-ship speed/consumption (techs applied) from page=fleetStep1 inline `data = {...}`.
(doc = document) => {
  for (const s of doc.querySelectorAll('script:not([src])')) {
    const m = s.textContent.match(/^\s*data\s*=\s*(\{.*\});\s*$/m);
    if (m && /"ships"/.test(m[1])) { const d = JSON.parse(m[1]); return { gamespeed: d.gamespeed, fleetspeedfactor: d.fleetspeedfactor, ships: d.ships }; }
  }
  return null;
}

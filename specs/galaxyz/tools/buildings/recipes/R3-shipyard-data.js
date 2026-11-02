// R3: shipyard queue = inline `data = {...}` (+ bd_operating) in page=shipyard. On a live page with JS on, window.data is the same object.
(doc = document) => {
  for (const s of doc.querySelectorAll('script:not([src])')) {
    const m = s.textContent.match(/^\s*data\s*=\s*(\{.*\});\s*$/m);
    if (m && /"Queue"/.test(m[1])) {
      const d = JSON.parse(m[1]);
      return { raw: d, items: d.Queue.map(([name, count, secsPerUnit, id]) => ({ id: +id, name, count: +count, secsPerUnit: +secsPerUnit })),
               firstUnitElapsed: +d.b_hangar_id_plus, totalLeft: d.pretty_time_b_hangar };
    }
  }
  return null;
}

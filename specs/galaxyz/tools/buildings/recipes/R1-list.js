// R1: items of page=buildings | research | shipyard&mode=fleet|defense (REAL markup; JS-free, works on a DOMParser doc)
(doc = document) => {
  const out = [], seen = new Set();
  // the list is the SECOND #technologies (the first one is the "... under construction" box) -> select by ul.icons, never by id
  for (const li of doc.querySelectorAll('ul.icons > li.technology[data-technology]')) {
    const id = +li.dataset.technology;
    if (seen.has(id)) continue; seen.add(id);
    const icon = li.querySelector('div.icon');
    const lv = li.querySelector('span.level');
    const form = li.querySelector('form.build_form');
    const title = icon?.getAttribute('title') || li.getAttribute('title') || '';   // research: title on <li> (trailing space) + a.detail_button
    out.push({
      id,
      name: title.split(/<br\s*\/?>/i)[0].trim(),             // "University<br>Requirements are not met!" -> "University"
      cssKey: icon ? [...icon.classList].at(-1) : null,       // upstream vars.name ("metal_mine", "conveyor1"); shipyard: the numeric id
      value: lv?.hasAttribute('data-value') ? +lv.dataset.value : +(lv?.textContent || '').replace(/\D/g, ''), // research has no data-value
      off: icon?.dataset.status === 'off',                     // requirements not met
      form: form ? Object.fromEntries([...form.querySelectorAll('input[name]')].map((i) => [i.name, i.value])) : null,
      button: !!li.querySelector('button.upgrade'),            // buildings/research only
    });
  }
  return out;
}

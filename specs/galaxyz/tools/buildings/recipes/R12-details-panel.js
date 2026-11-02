// R12: details panel = json.content[json.target] of page=TechnologyDetailsAjax|ResearchDetailsAjax|ShipDetailsAjax.
// Selectors are the ones the fork's REAL base.js (lines 301-580) reads; the panel HTML itself was never captured.
(doc = document) => [...doc.querySelectorAll('#technologydetails')].map((card) => {
  const costs = card.querySelector('.costs');
  const form = [...card.querySelectorAll('form.build_form')].find((f) => f.querySelector('.build-it_wrap .upgrade'))
    || [...card.querySelectorAll('form.build_form')].pop();
  const flag = (n) => form ? form.getAttribute('data-' + n) === '1' : null;
  const input = card.querySelector('input.upgrade-input, [id^="b_input_"]');
  return {
    id: costs ? +costs.dataset.techId : null, level: costs ? +costs.dataset.level : null,
    max: costs ? +(costs.dataset.max || 255) : null, factor: costs ? +(costs.dataset.factor || 1) : null,
    cost: Object.fromEntries([...card.querySelectorAll('li.cost-item')].map((li) => [li.dataset.res, {
      base: +li.dataset.base, have: li.dataset.have != null ? +li.dataset.have : null,
      shown: (li.querySelector('.res-amount, .amount')?.textContent || '').trim() }])),
    flags: { techOk: flag('tech-ok'), roomOk: flag('room-ok'), maxReached: flag('max-reached'), buyable: flag('buyable'), busy: flag('busy') },
    form: form ? { action: form.getAttribute('action'), fields: Object.fromEntries([...form.querySelectorAll('input[name]')].map((i) => [i.name, i.value])) } : null,
    targetInput: input ? { id: input.id, name: input.name, value: input.value } : null,
    buttonDisabled: !!card.querySelector('.build-it_wrap .upgrade[disabled], .build-it_wrap .upgrade.is-disabled'),
  };
})

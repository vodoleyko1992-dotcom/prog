// node verify-buyable.js -> checks "button.upgrade present <=> next level affordable" on the REAL buildings/research pages,
// using elements.json costs and price(L) = cost * factor^(L-1).
const path = require('path');
const { run } = require('./run-recipe.js');
const P = path.resolve(__dirname, '../../../../../eu/pages');
const EL = require('../../elements.json').elements;
(async () => {
  for (const page of ['buildings', 'research']) {
    const [list, stock] = await run([[`${P}/${page}.html`, `${__dirname}/recipes/R1-list.js`], [`${P}/${page}.html`, `${__dirname}/recipes/R11-stock.js`]]);
    console.log(page, 'stock', JSON.stringify(stock));
    for (const it of list) {
      const e = EL[it.id];
      if (!e.cost) { console.log(` ${it.id} ${it.name}: cost UNKNOWN, button=${it.button}`); continue; }
      const L = it.value + 1;
      const price = Object.fromEntries(Object.entries(e.cost).map(([r, c]) => [r, Math.floor(c * e.factor ** (L - 1))]));
      const short = Object.entries(price).filter(([r, v]) => v > (stock[r] ?? 0)).map(([r]) => r);
      const ok = !it.off && short.length === 0;
      console.log(` ${it.id} L${it.value}->${L} ${ok === it.button ? 'MATCH' : 'MISMATCH'} button=${it.button} off=${it.off} form=${!!it.form} short=[${short}]`);
    }
  }
})();

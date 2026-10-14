"""Перерисовка панели после клика: реальный DOM Chromium, без сети и игровых действий."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                               headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page()
    page.set_content('<div id="panel"></div>')
    page.add_script_tag(path=str(root / 'modules/combat.js'))
    result = page.evaluate("""async () => {
      let clicks = 0, timedOut = 0;
      function render(n) {
        document.querySelector('#panel').innerHTML = `<div class="l2-battle-hotbar" data-visible-rows="${n}">
          <button class="l2-battle-hotbar__row-nav--down" ${n >= 3 ? 'disabled' : ''}>▼</button>
          ${[1,2,3].map(i=>`<div class="l2-battle-hotbar__row" data-hotbar-row="${i}" ${i>n?'hidden':''}></div>`).join('')}
        </div>`;
        document.querySelector('button').onclick = () => { clicks++; render(n + 1); };
      }
      render(1);
      const rt = {}, records = [];
      const combat = L2V7Factories.combat({rt, $q: s=>document.querySelector(s),
        fire: b=>{b.click();return true;}, rec: (...args)=>records.push(args), setRt: patch=>Object.assign(rt,patch),
        waitX: async (fn, limit, step) => {
          const start = performance.now();
          while(performance.now()-start < limit) { const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,step)); }
          timedOut++;return null;
        }});
      await combat.hotbarRows3();
      await combat.hotbarRows3();
      return {clicks,timedOut,rows:document.querySelectorAll('.l2-battle-hotbar__row:not([hidden])').length,
        confirmed:rt.rows3,records:records.length};
    }""")
    browser.close()
    assert result == {'clicks': 2, 'timedOut': 0, 'rows': 3, 'confirmed': 1, 'records': 1}, result
    print('PASS: Chromium DOM — replaced hotbar expands to 3 rows without timeouts or repeated clicks')

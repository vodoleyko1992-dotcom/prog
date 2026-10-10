"""Regression: fishing toggle starts bot and disables exclusive higher-priority modes."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
root = Path(__file__).resolve().parent.parent
older = (root / 'tests/v715-ui-browser.py').read_text()
mock = older.split('mock=r"""', 1)[1].split('"""', 1)[0]
mock = mock.replace('7.1.5', '7.1.10')
needle = 'Object.assign(state.cfg,m.cfgPatch||{});'
assert needle in mock
mock = mock.replace(needle, needle + "\n          if (typeof m.on==='boolean') state.on=m.on;")
mock = mock.replace('  window.__mockState=state;', '''  Object.assign(state.cfg, { fishMode: false, epicMode: true, rbMode: true,
    rbHuntMode: true, catMode: true, campaign: true });
  window.__mockState=state;''')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=__import__('os').environ.get('CHROMIUM','/usr/bin/chromium'),
                                args=['--no-sandbox', '--disable-dev-shm-usage'])
    for width in [375, 760]:
        page = browser.new_page(viewport={'width': width, 'height': 760})
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.evaluate(mock)
        page.evaluate('''() => {
          window.__wakeChecks = { kicks: 0, reloads: 0 };
          chrome.tabs.query = async () => [{id: 45, url: 'https://l2wap.com/map.html'}];
          chrome.tabs.sendMessage = async () => { __wakeChecks.kicks++; return {ok:true,v:'7.1.10',running:true}; };
          chrome.tabs.reload = async () => { __wakeChecks.reloads++; };
        }''')
        html = (root / 'popup.html').read_text()
        html = re.sub(r'<link rel="stylesheet" href="[^"]+">', '', html)
        html = re.sub(r'<script src="[^"]+"></script>', '', html)
        page.set_content(html, wait_until='domcontentloaded')
        page.add_style_tag(content=(root / 'ui-v7.css').read_text())
        page.add_style_tag(content=(root / 'ui-game.css').read_text())
        page.add_script_tag(content=(root / 'popup.js').read_text())
        page.add_script_tag(content=(root / 'ui-v7.js').read_text())
        page.wait_for_timeout(450)
        # Exposed mode must work from a real user click, not only rod +10.
        page.locator('#navToggle').click()
        page.locator('#moduleNav button[data-tab="fish"]').click()
        page.locator('#modeToggle').click()
        page.locator('#fishToggle').click()
        page.wait_for_function('window.__mockState.on === true && window.__mockState.cfg.fishMode === true')
        st = page.evaluate('''() => ({ on:__mockState.on,cfg:{...__mockState.cfg},rt:{...__mockState.rt} })''')
        assert st['on'] is True
        assert all(st['cfg'][key] is False for key in
                   ['epicMode', 'rbMode', 'rbHuntMode', 'catMode', 'campaign']), st
        assert st['cfg']['rodEnchantTo'] == 10, st
        assert not st['rt'].get('rodGoalActive', False), st
        assert 'ВКЛ' in page.locator('#fishToggle').inner_text()
        page.locator('#fishToggle').click()
        page.wait_for_function('window.__mockState.cfg.fishMode === false')
        assert page.evaluate('window.__mockState.on') is True, 'Turning off fishing stopped entire bot'
        assert 'ВЫКЛ' in page.locator('#fishToggle').inner_text()
        # A retained fishMode flag while globally stopped must offer Start.
        page.evaluate('''() => { __mockState.cfg.fishMode = true; __mockState.on = false; }''')
        page.evaluate('load()')
        page.wait_for_function('document.querySelector("#fishToggle").textContent.includes("ЗАПУСТИТЬ")')
        page.locator('#fishToggle').click()
        page.wait_for_function('window.__mockState.on === true && window.__mockState.cfg.fishMode === true')
        page.wait_for_function('__wakeChecks.kicks >= 2')
        assert page.evaluate('__wakeChecks.reloads') == 0
        # Every mode uses the same wake path, even if global on was already true.
        for button_id, flag in [('rbToggle', 'rbMode'), ('epicToggle', 'epicMode'),
                                ('huntToggle', 'rbHuntMode'), ('campToggle', 'campaign')]:
            page.evaluate('''(k) => { __mockState.cfg[k] = false; __mockState.on = false; }''', flag)
            before = page.evaluate('__wakeChecks.kicks')
            page.locator('#' + button_id).click()
            page.wait_for_function('''k => __mockState.on === true && __mockState.cfg[k] === true''', arg=flag)
            page.wait_for_function('''n => __wakeChecks.kicks > n''', arg=before)
        # A stale extension script must be reloaded, not silently declared active.
        page.evaluate('chrome.tabs.sendMessage = async () => null')
        page.locator('#start').click()
        page.wait_for_function('__wakeChecks.reloads >= 1')
        assert not errors, errors
        print(f'PASS {width}px: fishing ON starts bot & clears conflicting modes, OFF keeps bot ON, UI updates')
        page.close()
    browser.close()

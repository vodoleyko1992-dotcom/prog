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
          // 15.10: wakeGame повторно проверяет тот же загруженный документ перед reload.
          chrome.tabs.get = async () => ({id: 45, url: 'https://l2wap.com/map.html', status: 'complete'});
          chrome.tabs.sendMessage = async () => { __wakeChecks.kicks++; return {ok:true,v:'7.1.10',running:true}; };
          chrome.tabs.reload = async () => { __wakeChecks.reloads++; };
        }''')
        html = (root / 'popup.html').read_text()
        html = re.sub(r'<link rel="stylesheet" href="[^"]+">', '', html)
        html = re.sub(r'<script src="[^"]+"></script>', '', html)
        page.set_content(html, wait_until='domcontentloaded')
        page.add_style_tag(content=(root / 'ui-v7.css').read_text())
        page.add_style_tag(content=(root / 'ui-game.css').read_text())
        # 10.0.17: реальные зависимости и порядок из popup.html.
        for script in re.findall(r'<script src="([^"]+)"></script>', (root / "popup.html").read_text()):
          page.add_script_tag(content=(root / script).read_text())
        page.wait_for_timeout(450)
        # Exposed mode must work from a real user click, not only rod +10.
        # 20.12 (ревизия 17.10): навигация всегда на виду, кнопки «≡ Разделы» нет.
        page.locator('#moduleNav button[data-tab="fish"]').click()
        if page.locator('#quickModeGrid').is_hidden(): page.locator('#modeToggle').click()   # 20.12: строка «Задачи бота» открывает список задач в «Обзоре» (по умолчанию свёрнут)
        # Canonical task selection saves without starting; Start owns wake acknowledgement.
        page.locator('[data-auto-task="fish"]').check()
        page.wait_for_function('__mockState.cfg.autoTasks.includes("fish")')
        assert page.evaluate('window.__mockState.on') is False
        page.locator('#start').click()
        page.wait_for_function('__wakeChecks.kicks > 0')
        assert page.evaluate('window.__mockState.on') is True
        page.locator('[data-auto-task="fish"]').uncheck()
        page.locator('[data-auto-task="farm"]').check()
        page.wait_for_function('__mockState.cfg.autoTasks.includes("farm") && !__mockState.cfg.autoTasks.includes("fish")')
        assert page.evaluate('window.__mockState.on') is True
        for task in ['fish', 'epic', 'raid']:
            page.evaluate('__mockState.on = false')
            before = page.evaluate('__wakeChecks.kicks')
            page.locator('[data-auto-task="' + task + '"]').check()
            page.locator('#start').click()
            page.wait_for_function('''n => __wakeChecks.kicks > n''', arg=before)
            page.locator('[data-auto-task="' + task + '"]').uncheck()
        assert page.evaluate('__wakeChecks.reloads') == 0
        assert page.locator('[data-auto-task="quests"]').is_visible()
        # A stale extension script must be reloaded, not silently declared active.
        page.evaluate('chrome.tabs.sendMessage = async () => null')
        page.locator('#start').click()
        page.wait_for_function('__wakeChecks.reloads >= 1')
        assert not errors, errors
        print(f'PASS {width}px: fishing ON starts bot & clears conflicting modes, OFF keeps bot ON, UI updates')
        page.close()
    browser.close()

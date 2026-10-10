"""Chromium MV3 popup/background smoke (no l2wap network access or game actions)."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import tempfile
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='l2bot-chrome-') as profile:
    with sync_playwright() as p:
        browser=p.chromium.launch_persistent_context(profile,executable_path=__import__('os').environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,
            args=['--no-sandbox','--disable-dev-shm-usage',f'--disable-extensions-except={root}',f'--load-extension={root}'])
        workers=browser.service_workers
        if not workers:
            worker=browser.wait_for_event('serviceworker',timeout=15000)
        else:
            worker=workers[0]
        extension_id=worker.url.split('/')[2]
        page=browser.new_page()
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'chrome-extension://{extension_id}/popup.html',wait_until='domcontentloaded', timeout=20000)
        page.wait_for_timeout(1500)
        def eval_(js): return page.evaluate(js)
        result=eval_("""async()=>{
          const reply=await chrome.runtime.sendMessage({cmd:'menuPatch',rtPatch:{kills:9,status:'v6 browser smoke'},cfgPatch:{epicMode:false}});
          const state=await chrome.storage.local.get(['rt','cfg']);
          return {reply,rt:state.rt,cfg:state.cfg};
        }""")
        assert result['reply']['ok'],result
        assert result['rt']['kills']==9,result
        assert result['cfg']['epicMode'] is False,result
        # A malformed actor must not impersonate an owned game tab.
        rejected=eval_("async()=>await chrome.runtime.sendMessage({cmd:'statePatch',patch:{kills:77}})")
        assert rejected['ok'] is False,rejected
        assert not errors,errors
        print('PASS: Chromium MV3 service worker boot, popup JS, broker transaction, unauthorized actor rejected')
        browser.close()

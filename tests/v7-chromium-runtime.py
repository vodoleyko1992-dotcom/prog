"""Chromium runtime regression for v7: native timers, IPC and module patch writes.

Loads real content scripts into a mocked, inert DOM. No extension installation,
remote game access, or gameplay actions are involved.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text())
scripts = next(e['js'] for e in manifest['content_scripts'] if 'content.js' in e['js'])
mock = r"""
(() => {
  const data = {on:false, cfg:{fishMode:true,rec:false,autoLearn:false}, rt:{char:'Test',fish:{casts:0}}};
  window.__botIpc = [];
  window.chrome = {
    runtime: {
      id:'mock', lastError:null,
      getManifest: () => ({version:'7.1.0'}),
      getURL: p => 'chrome-extension://mock/' + (p || ''),
      onMessage:{addListener(){}},
      sendMessage(msg, cb) {
        window.__botIpc.push(msg.cmd);
        let reply = null;
        if (msg.cmd === 'tabId') reply = 3;
        if (msg.cmd === 'statePatch') {
          Object.assign(data.rt, msg.patch || {});
          Object.assign(data.cfg, msg.cfgPatch || {});
          reply = {ok:true};
        }
        if (typeof cb === 'function') { queueMicrotask(() => cb(reply)); return; }
        return Promise.resolve(reply);
      }
    },
    storage: {
      onChanged:{addListener(){}},
      local:{
        get:async keys => Object.fromEntries(keys.map(k=>[k, data[k]])),
        set:async v => Object.assign(data,v)
      }
    }
  };
})();
"""
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=__import__('os').environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,
        args=['--no-sandbox','--disable-dev-shm-usage'])
    page = browser.new_page()
    page.set_content('<html><body><div id="l2-hud-legacy-name"><span class="l2-player-identity__nick">Test</span></div></body></html>')
    page.evaluate(mock)
    for script in scripts:
        page.add_script_tag(path=str(root / script))
    result = page.evaluate("""async () => {
      const timer = await L2EngineCore.withTimeout(Promise.resolve(42),1000);
      let timeout = false;
      try { await L2EngineCore.withTimeout(new Promise(()=>{}),20); }
      catch (e) {timeout = e.message === 'background_timeout';}
      on=true; tabOwner=true; leaseEpoch='test-epoch';
      const saved = await setRt({probeChromium:123});
      const fishSaved = await L2V7Modules.fishing.fishStat({casts:2});
      return {timer,timeout, saved:saved?.ok, fishSaved:rt.fish?.casts,
        probe:rt.probeChromium, ipc:window.__botIpc.filter(x=>x==='statePatch').length};
    }""")
    browser.close()
    assert result['timer'] == 42, result
    assert result['timeout'] is True, result
    assert result['saved'] is True and result['probe'] == 123, result
    assert result['fishSaved'] == 2 and result['ipc'] >= 2, result
    print('PASS: Chromium native timers, timeout rejection, IPC state PATCH, fishing module write')

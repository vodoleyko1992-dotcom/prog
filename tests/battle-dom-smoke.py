from pathlib import Path
import json,re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
source=Path(__import__('os').environ.get('L2_PAGES','/mnt/data/l2wap-pages-2026-10-09-10-44.html')).read_text(errors='ignore')
m=re.search(r'<!-- ===== /battle\.html.*?-->(.*?)(?=<!-- ===== |\Z)',source,re.S)
assert m, 'battle snapshot missing'
body=re.search(r'<body\b.*?</body>',m.group(1),re.S)
assert body, 'battle body missing'
manifest=json.loads((root/'manifest.json').read_text())
scripts=next(x['js'] for x in manifest['content_scripts'] if 'content.js' in x['js'])
mock=(root/'tests/v7-chromium-runtime.py').read_text().split('mock = r"""',1)[1].split('"""',1)[0]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=__import__('os').environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<html><body>'+body.group(0)+'</body></html>')
    page.evaluate(mock)
    for s in scripts: page.add_script_tag(path=str(root/s))
    page.wait_for_timeout(350)
    result=page.evaluate('''() => {
      const ctx={block:{}, champ:false, rb:false, lastStun:Date.now(), lfHold:false};
      const mp={cur:1246,max:1246,pct:100};
      cfg=mergeCfg({...cfg, nAttack:'Атака', nPower:'Iron Punch, Soul Breaker, Burning Fist', nUltra:'', nStun:'Stunning Fist', fightMode:'dps'});
      const x=L2V7Modules.combat.chooseAction(ctx,mp);
      const y=L2V7Modules.combat.chooseAction({...ctx, rb:{id:'test'}},mp);
      return {normal:x?.name||'wait', raid:y?.name||'wait', hp:L2V7Modules.combat.mobHp(), slotN:document.querySelectorAll('.l2-battle-hotbar-slot').length};
    }''')
    print('Battle DOM smoke:',result,'errors',errors)
    assert result['hp'] and result['hp']['max']>0,result
    assert not errors,errors
    browser.close()
print('PASS: real saved battle DOM parses and combat selects action without JS exceptions')

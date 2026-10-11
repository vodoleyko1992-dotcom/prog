from pathlib import Path
import re,json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
src=Path(__import__('os').environ.get('L2_PAGES_MAGE','/mnt/data/l2wap-pages-2026-10-09-12-35.html')).read_text(errors='ignore')
snapshots=re.findall(r'<!-- ===== /battle\.html.*?-->(.*?)(?=<!-- ===== |\Z)',src,re.S)
assert snapshots,'no player HTML battle snapshots'
body=None
for sn in snapshots:
 b=re.search(r'<body\b.*?</body>',sn,re.S)
 if b and ('Wind Strike' in b.group(0) or 'Energy Bolt' in b.group(0)) and 'battle-mob-hp-val' in b.group(0):body=b.group(0);break   # 9.2: снимки 12.10 — Warlock 61 без Wind Strike на панели
assert body,'no mage hotbar battle fixture found'
manifest=json.loads((root/'manifest.json').read_text())
scripts=next(x['js'] for x in manifest['content_scripts'] if 'content.js' in x['js'])
mock=(root/'tests/v7-chromium-runtime.py').read_text().split('mock = r"""',1)[1].split('"""',1)[0]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=__import__('os').environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page()
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('<html>'+body+'</html>')
 page.evaluate(mock)
 for s in scripts:page.add_script_tag(path=str(root/s))
 page.wait_for_timeout(250)
 result=page.evaluate('''() => {
   cfg=mergeCfg({...cfg, combatProfile:'mage_summoner', nPower:'Iron Punch', nAttack:'Атака', nUltra:'', skillMpMin:35});
   rt={...rt,prof:'Human Mage'};
   const skills=[...document.querySelectorAll(SLOT)].filter(b=>slotKind(b)==='скилл').map(b=>({name:cleanTitle(b.title),kind:ilOf(b)?.c||'unknown'}));
   const out=L2V7Modules.combat.chooseAction({block:{},rb:false,champ:false,lastStun:Date.now()}, {cur:250,max:300});
   return {count:skills.length,skills,selected:out?.name||'wait',type:out?.b?ilOf(out.b)?.c:null,kind:out?.key||null};
 }''')
 print('Mage real DOM:',result,'errors',errors)
 assert any(x['name'] in ('Wind Strike','Energy Bolt') and x['kind']=='Маг. атака' for x in result['skills']),result
 assert result['kind']!='attack',result
 assert result['type'] in ('Маг. атака',None),result
 assert not errors,errors
 browser.close()
print('PASS: real Mage 12 level battle DOM parsed, offensive spells known, no physical action and no JS exceptions')

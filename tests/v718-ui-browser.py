"""L2wap v7.1.9: real Chromium layout and navigation smoke tests, mocked Chrome API."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
root=Path(__file__).resolve().parent.parent
old=(root/'tests/v715-ui-browser.py').read_text()
mock=old.split('mock=r"""',1)[1].split('"""',1)[0].replace('7.1.5','7.1.12')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=__import__('os').environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 for width,height,mode in [(760,680,'wide'),(375,740,'dock')]:
  page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.evaluate(mock)
  html=(root/'popup.html').read_text()
  html=re.sub(r'<link rel="stylesheet" href="[^"]+">','',html)
  html=re.sub(r'<script src="[^"]+"></script>','',html)
  page.set_content(html,wait_until='domcontentloaded')
  page.add_style_tag(content=(root/'ui-v7.css').read_text())
  page.add_style_tag(content=(root/'ui-game.css').read_text())
  # 10.0.17: реальные зависимости и порядок из popup.html.
  for script in re.findall(r'<script src="([^"]+)"></script>', (root / "popup.html").read_text()):
    page.add_script_tag(content=(root / script).read_text())
  page.wait_for_timeout(450)
  if mode=='dock':page.evaluate("document.documentElement.classList.add('docked')")
  page.locator('#navToggle').click()
  page.wait_for_timeout(80)
  menu=page.evaluate('''() => ({tabs:document.querySelectorAll('#moduleNav button[data-tab]').length,grid:getComputedStyle(document.querySelector('#moduleNav')).gridTemplateColumns.split(' ').length,visible:getComputedStyle(document.querySelector('#moduleNav')).display,navText:getComputedStyle(document.querySelector('#moduleNav button')).fontSize})''')
  assert menu['tabs']==11,menu   # 10.0.17: PvP, подклассы и отдельная автозаточка
  assert menu['grid']==(2 if mode=='dock' else 4),menu
  assert menu['visible']=='grid',menu
  page.screenshot(path=str(Path(__import__('os').environ.get('L2_SHOTS', '/tmp'))/('l2bot-v7111-game-'+mode+'-menu.png')))
  page.locator('#moduleNav button[data-tab="fish"]').click()
  page.wait_for_timeout(100)
  metrics=page.evaluate('''() => {const act=document.querySelector('section.act'); const fld=act.querySelector('label');const e=document.querySelector('input#rodEnchantTo');return {pageWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,tab:act.id,rod:e.value, labelFont:getComputedStyle(fld).fontSize,buttonHeight:document.querySelector('#navToggle').getBoundingClientRect().height,bodyBg:getComputedStyle(document.body).backgroundColor,searchBg:getComputedStyle(document.querySelector('#uiSearch')).backgroundColor,tabName:document.getElementById('navCurrentName').innerText};}''')
  print(mode,'menu:',menu,'fields:',metrics,'errors:',errors[:4])
  assert metrics['scrollWidth']<=metrics['pageWidth']+1,metrics
  assert metrics['rod']=='10'
  assert metrics['tab']=='tab-fish'
  assert float(metrics['labelFont'][:-2])>=12
  assert 33 <= metrics['buttonHeight'] <= 41, metrics # compact controls requested
  assert len(errors)==0,errors
  page.screenshot(path=str(Path(__import__('os').environ.get('L2_SHOTS', '/tmp'))/('l2bot-v7111-game-'+mode+'-fishing.png')))
  # 20.3: единый список разрешённых задач вместо удалённых дублирующих кнопок; сворачивание по-прежнему работает.
  assert page.locator('#quickModeGrid').is_visible()
  page.locator('#modeToggle').click()
  assert not page.locator('#quickModeGrid').is_visible()
  page.locator('#modeToggle').click()
  assert page.locator('#quickModeGrid').is_visible()
  assert page.locator('#quickModeGrid button[data-mode]').count()==0
  tasks=page.locator('#autoTaskSelection input[data-auto-task]')
  assert tasks.count()==15
  assert set(tasks.evaluate_all('(els)=>els.map(e=>e.dataset.autoTask)'))=={'tvt','enchant','epic','raid','quests','fish','cat','auto','farm','mammon','dailies','clan','pvp','petbuff','resources'}
  assert page.locator('#autoTaskSelection').is_visible()
  page.close()
 browser.close()
print('PASS: Classic in-game layout, 11 sections, 15 allowed tasks, 375px dock, +10 setting, zero console errors')

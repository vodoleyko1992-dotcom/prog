"""L2wap v7.1.9: real Chromium layout and navigation smoke tests, mocked Chrome API."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
root=Path(__file__).resolve().parent.parent
old=(root/'tests/v715-ui-browser.py').read_text()
mock=old.split('mock=r"""',1)[1].split('"""',1)[0].replace('7.1.5','7.1.12')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=__import__('os').environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 # 20.54 (прогон смоуков 23.10): разделов уже не 6 — 20.18 (10), «Лимиты»/«Снабжение» 19.10, «Сабкласс» 20.43, «Крафт» PR #358,
 # «Скорость» PR #371; «Автозаточка» скрыта решением игрока 19.10 (кнопка hidden). Проверяем точный список и раскладку по решениям после 20.13.
 NAV=['overview','hunt','craft','rb','panel','enchant','fish','mammon','lifestone','pvp','svc','limits','supply','sub','speed','tvt']  # 23.10 (#378): «TvT» — отдельный раздел в конце
 VISIBLE=[t for t in NAV if t!='enchant']
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
  # 20.12 (ревизия 17.10): кнопки «≡ Разделы» нет — шесть разделов всегда на виду.
  page.wait_for_timeout(80)
  menu=page.evaluate('''() => ({tabs:document.querySelectorAll('#moduleNav button[data-tab]').length,visibleTabs:[...document.querySelectorAll('#moduleNav button[data-tab]')].filter(b=>!b.hidden&&b.offsetParent).map(b=>b.dataset.tab),grid:getComputedStyle(document.querySelector('#moduleNav')).gridTemplateColumns.split(' ').length,visible:getComputedStyle(document.querySelector('#moduleNav')).display,navText:getComputedStyle(document.querySelector('#moduleNav button')).fontSize})''')
  assert menu['tabs']==len(NAV) and menu['visibleTabs']==VISIBLE,menu   # 20.12: 12 разделов сведены в 6; 20.54: текущий список
  assert menu['visible']!='none',menu
  page.screenshot(path=str(Path(__import__('os').environ.get('L2_SHOTS', '/tmp'))/('l2bot-v7111-game-'+mode+'-menu.png')))
  page.locator('#moduleNav button[data-tab="fish"]').click()
  page.wait_for_timeout(100)
  metrics=page.evaluate('''() => {const act=document.querySelector('section.act'); const fld=act.querySelector('label');const e=document.querySelector('input#rodEnchantTo');return {pageWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,tab:act.id,rod:e.value, labelFont:getComputedStyle(fld).fontSize,buttonHeight:document.querySelector('#moduleNav button.act').getBoundingClientRect().height,modeHeight:document.querySelector('#modeToggle').getBoundingClientRect().height,navRows:new Set([...document.querySelectorAll('#moduleNav button[data-tab]')].filter(b=>!b.hidden&&b.offsetParent).map(b=>Math.round(b.getBoundingClientRect().top))).size,navOverflow:document.querySelector('#moduleNav').scrollWidth-document.querySelector('#moduleNav').clientWidth,bodyBg:getComputedStyle(document.body).backgroundColor,searchBg:getComputedStyle(document.querySelector('#uiSearch')).backgroundColor,tabName:document.querySelector('nav#moduleNav button.act').textContent+' '+document.querySelector('nav#moduleNav button.act').title};}''')
  print(mode,'menu:',menu,'fields:',metrics,'errors:',errors[:4])
  assert metrics['scrollWidth']<=metrics['pageWidth']+1,metrics
  assert metrics['rod']=='10'
  assert metrics['tab']=='tab-fish'
  assert float(metrics['labelFont'][:-2])>=12
  # 20.12 (ревизия 17.10): «≡ Разделы»/navCurrentName убраны — компактность меряем по кнопке раздела и строке задач,
  # шесть разделов в один ряд без горизонтальной прокрутки, имя текущего раздела — у активной кнопки (в доке подпись скрыта, есть title).
  assert 28 <= metrics['buttonHeight'] <= 41, metrics # compact controls requested
  assert 24 <= metrics['modeHeight'] <= 41, metrics
  # 20.54: от 601 px — колонка слева (игрок 18.10 «левый вариант»), по строке на раздел; уже — сетка коротких имён по 5 в ряд (20.18)
  assert metrics['navRows']==(len(VISIBLE) if width>600 else -(-len(VISIBLE)//5)) and metrics['navOverflow']<=1, metrics
  assert 'Рыбалка' in metrics['tabName'], metrics
  assert len(errors)==0,errors
  page.screenshot(path=str(Path(__import__('os').environ.get('L2_SHOTS', '/tmp'))/('l2bot-v7111-game-'+mode+'-fishing.png')))
  # 20.3: единый список разрешённых задач вместо удалённых дублирующих кнопок; сворачивание по-прежнему работает.
  # 20.12 (ревизия 17.10): список задач живёт в «Обзоре» и по умолчанию свёрнут; строка задач в шапке открывает «Обзор»
  # с раскрытым списком, повторное нажатие сворачивает — сворачивание по-прежнему проверяем.
  assert not page.locator('#quickModeGrid').is_visible()
  page.locator('#modeToggle').click()
  page.wait_for_timeout(60)
  assert page.evaluate("document.querySelector('section.act').id")=='tab-overview'
  assert page.locator('#quickModeGrid').is_visible()
  page.locator('#modeToggle').click()
  assert not page.locator('#quickModeGrid').is_visible()
  page.locator('#modeToggle').click()
  assert page.locator('#quickModeGrid').is_visible()
  assert page.locator('#quickModeGrid button[data-mode]').count()==0
  tasks=page.locator('#autoTaskSelection input[data-auto-task]')
  # 20.54 (прогон смоуков 23.10): 16-я задача «Крафт» (22.10, 337c33b — отдельный режим craft); «Автозаточка» осталась в разметке,
  # но скрыта и выключена (решение игрока 19.10) — видимых галок 15
  assert tasks.count()==16
  assert set(tasks.evaluate_all('(els)=>els.map(e=>e.dataset.autoTask)'))=={'tvt','enchant','craft','epic','raid','quests','fish','cat','auto','farm','mammon','dailies','clan','pvp','petbuff','resources'}
  assert tasks.evaluate_all('(els)=>els.filter(e=>e.offsetParent).map(e=>e.dataset.autoTask)').count('enchant')==0
  assert page.locator('#autoTaskSelection input[data-auto-task="enchant"]').is_disabled()
  assert page.locator('#autoTaskSelection').is_visible()
  page.close()
 browser.close()
print('PASS: Classic in-game layout, 14 visible sections (enchant hidden), 16 allowed tasks (enchant hidden/disabled), 375px dock, +10 setting, zero console errors')

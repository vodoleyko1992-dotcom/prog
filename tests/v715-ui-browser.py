"""Chromium UI smoke test: actual popup HTML+CSS+JS with mocked extension APIs."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parent.parent
mock=r"""
(() => {
  const state={cfg:{fishGoal:'',rodEnchantTo:10,fishProcess:true},rt:{char:'West',lvl:56,fishProof:850,fish:{casts:10,caught:5}},on:false,reccount:0,snapcount:0,wdog:[]};
  const listeners=[];
  const event={addListener(fn){listeners.push(fn);},removeListener() {}};
  window.chrome={
    runtime:{id:'testing',lastError:null,onMessage:event,
      getManifest:()=>({version:'7.1.5'}),getURL:p=>p,
      sendMessage:async (m,cb)=>{
        if(m.cmd==='menuPatch'||m.cmd==='statePatch'){
          Object.assign(state.rt,m.rtPatch||m.patch||{});
          Object.assign(state.cfg,m.cfgPatch||{});
        }
        const result={ok:true,reason:'',id:1};
        if(typeof cb==='function'){queueMicrotask(()=>cb(result));return undefined;}
        return result;
      }
    },
    tabs:{query:async()=>[{id:1,url:'https://l2wap.com/'}],sendMessage:async()=>({ok:true}),get:async()=>({id:1}),reload:async()=>{}},
    storage:{onChanged:event,local:{
      get:async keys=>{
        if(keys==null)return {...state};
        if(typeof keys==='string')return {[keys]:state[keys]};
        if(Array.isArray(keys))return Object.fromEntries(keys.map(k=>[k,state[k]]));
        return {...keys,...Object.fromEntries(Object.keys(keys).filter(k=>k in state).map(k=>[k,state[k]]))};
      },
      set:async patch=>{Object.assign(state,patch);},remove:async keys=>{for(const k of [].concat(keys))delete state[k];}
    }},
    downloads:{download:async()=>1},permissions:{contains:async()=>true,request:async()=>true},
    scripting:{executeScript:async()=>[]},windows:{getCurrent:async()=>({id:1})},
  };
  window.__mockState=state;
})();
"""

def rgb(c):
  v=c.split('(')[1].split(')')[0].split(',')
  return [int(round(float(x.strip()))) for x in v[:3]]

def lum(v):
  linear=[c/255/12.92 if c/255 <= .04045 else ((c/255+.055)/1.055)**2.4 for c in v]
  return sum(a*b for a,b in zip(linear,[.2126,.7152,.0722]))

def contrast(a,b):
  a,b=lum(rgb(a)),lum(rgb(b))
  return (max(a,b)+.05)/(min(a,b)+.05)

with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path=__import__('os').environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
  # 20.12 (ревизия 17.10): широкий случай — настоящая ширина меню Chrome (body 760 px), а не 738: на 738 px body{width:760px}
  # честно даёт прокрутку, которой в настоящем popup нет.
  NAV=['overview','hunt','craft','rb','panel','enchant','fish','mammon','lifestone','pvp','svc','limits','supply','sub','speed','tvt','epic']  # 23.10 (#378): «TvT» — отдельный раздел в конце; 23.10: «Эпики» — отдельно от «РБ»
  VISIBLE=[t for t in NAV if t!='enchant']
  for width,height,label in [(760,720,'wide'),(375,720,'dock')]:
    page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
    page.evaluate(mock)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    raw=(root/'popup.html').read_text()
    raw=re.sub(r'<link rel="stylesheet" href="[^"]+">','',raw)
    raw=re.sub(r'<script src="[^"]+"></script>','',raw)
    page.set_content(raw,wait_until='domcontentloaded')
    page.add_style_tag(content=(root/'ui-v7.css').read_text())
    # 20.12 (ревизия 17.10): ui-ios.css удалён (popup.html его не подключал); стили — ui-v7.css + ui-game.css.
    page.add_style_tag(content=(root/'ui-game.css').read_text())
    # 10.0.17: реальные зависимости и порядок из popup.html.
    for script in re.findall(r'<script src="([^"]+)"></script>', (root / "popup.html").read_text()):
      page.add_script_tag(content=(root / script).read_text())
    page.wait_for_timeout(650)
    if label=='dock': page.evaluate("document.documentElement.classList.add('docked')")
    page.locator('nav button[data-tab="fish"]').click()
    page.wait_for_timeout(180)
    stats=page.evaluate("""() => {
      const nav=document.querySelector('nav button.act');
      const proof=document.getElementById('goalProof');
      const rod=document.getElementById('rodEnchantTo');
      const bg=el=>{for(let e=el;e;e=e.parentElement){const c=getComputedStyle(e).backgroundColor;if(c!=='rgba(0, 0, 0, 0)'&&c!=='transparent')return c;}return 'rgb(255, 255, 255)';};
      const c=el=>({fg:getComputedStyle(el).color,bg:bg(el)});
      return {sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,
        nav:c(nav),plain:c(document.querySelector('section.act label')),
        proof:c(proof),proofActive:proof.classList.contains('on'),
        rod:rod.value, navRows:new Set([...document.querySelectorAll('nav button[data-tab]')].filter(b=>!b.hidden&&b.offsetParent).map(b=>Math.round(b.getBoundingClientRect().top))).size,
        navOverflow:document.querySelector('nav').scrollWidth-document.querySelector('nav').clientWidth,
        tabs:document.querySelectorAll('nav button[data-tab]').length,visibleTabs:[...document.querySelectorAll('nav button[data-tab]')].filter(b=>!b.hidden&&b.offsetParent).map(b=>b.dataset.tab),
        btnText:getComputedStyle(nav).fontSize};
    }""")
    path=Path(__import__('os').environ.get('L2_SHOTS','/tmp'))/('l2bot-v7.1.5-ios-fishing-'+label+'.png')
    page.screenshot(path=str(path),full_page=True)
    if errors: print('ERRORS',label,errors[:12])
    assert not errors,(label,errors)
    assert stats['rod']=='10', stats
    assert stats['proofActive'],stats
    # 20.12 (ревизия 17.10): 12 разделов сведены в 6. 20.54 (прогон смоуков 23.10): с тех пор разделы снова выделены — 20.18 (10),
    # «Лимиты»/«Снабжение» 19.10, «Сабкласс» 20.43, «Крафт» PR #358, «Скорость» PR #371; «Автозаточка» скрыта решением игрока 19.10.
    assert stats['tabs']==len(NAV),stats
    assert stats['visibleTabs']==VISIBLE,stats
    assert stats['sw']<=stats['cw']+1,stats
    # 20.12: навигация без собственной горизонтальной прокрутки. 20.54: раскладка по решениям после 20.13 — от 601 px колонка слева
    # (игрок 18.10 «левый вариант»), по строке на раздел; уже 600 px — сетка коротких имён по 5 в ряд (20.18).
    assert stats['navRows']==(len(VISIBLE) if width>600 else -(-len(VISIBLE)//5)) and stats['navOverflow']<=1,stats
    for section in ('nav','plain','proof'):
      ct=contrast(stats[section]['fg'],stats[section]['bg'])
      print(label, section, 'contrast=',round(ct,2))
      assert ct>=4.5,(label,section,ct)
    print('PASS',label,'tabs',stats['tabs'],'rows',stats['navRows'],'no horizontal overflow',path.name)
    # The gear selection must write its exact setting, and Proof mode must clear it.
    # 10.0: нижняя панель разделов фиксирована и накрывает низ прокрутки — кнопку сначала выводим в середину экрана
    # (с ростом меню «ближний край» прокрутки Playwright попадал под панель «Сервис», клик ждал 30 с)
    # 10.0: сетка «◫ Быстрые режимы» в шапке занимает ≈430 px из 594 — настройки раздела видны только при свёрнутой сетке;
    # кнопка сворачивания теперь работает (hidden не перебивается display:grid), проверяем её и сворачиваем перед кликами
    # 20.12 (ревизия 17.10): список задач перенесён в «Обзор» и по умолчанию свёрнут — настройкам рыбалки он не мешает.
    # Строка задач открывает «Обзор» со списком, повторное нажатие сворачивает; затем возвращаемся в «Рыбалку».
    assert page.evaluate("getComputedStyle(document.getElementById('quickModeGrid')).display")=='none'
    page.locator('#modeToggle').click(); page.wait_for_timeout(120)
    assert page.evaluate("getComputedStyle(document.getElementById('quickModeGrid')).display")!='none'
    page.locator('#modeToggle').click(); page.wait_for_timeout(120)
    assert page.evaluate("getComputedStyle(document.getElementById('quickModeGrid')).display")=='none'
    page.locator('nav button[data-tab="fish"]').click(); page.wait_for_timeout(120)
    def click_mid(sel):
      page.locator(sel).evaluate("e=>e.scrollIntoView({block:'center'})"); page.wait_for_timeout(60); page.locator(sel).click()
    click_mid('#goalItems')
    click_mid('#goalGrid button[data-goal="cloak_d"]')
    page.wait_for_timeout(140)
    assert page.evaluate("__mockState.cfg.fishGoal") == 'cloak_d'
    click_mid('#goalProof')
    page.wait_for_timeout(140)
    assert page.evaluate("__mockState.cfg.fishGoal") == ''
    assert page.get_by_text('Proof накоплено:').count()>0
    page.evaluate("document.querySelector('section.act').scrollTop=100000")
    page.screenshot(path=str(Path(__import__('os').environ.get('L2_SHOTS','/tmp'))/('l2bot-v7.1.5-ios-proof-'+label+'.png')))
    print('PASS',label,'gear-selection roundtrip to Proof-only, screenshot')
    page.close()
  browser.close()

"""Новая пагинация мобов: реальный DOM, без сетевых запросов или боёв."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/usr/bin/chromium'),
                               headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page()
    page.set_content('<div id="map-mob-page-ind"></div><ul id="map-mob-list"></ul>')
    page.add_script_tag(path=str(root / 'modules/mobfarm.js'))
    result = page.evaluate("""async () => {
      const ids = Array.from({length:398},(_,i)=>'mob'+i), clicks=[];
      function render(n) {
        const list=document.querySelector('#map-mob-list'), pager=document.querySelector('#map-mob-page-ind');
        list.dataset.l2AroundSig=ids.length+'|'+ids.map(id=>id+':1').join(',')+'|p'+(n-1)+'|lv74|qnone';
        list.innerHTML=ids.slice((n-1)*15,n*15).map(id=>`<li><a class="l2-map-mob-link" href="/battle.html?spawnId=${id}">Mob · ур. 74</a></li>`).join('');
        pager.innerHTML='';const first=Math.floor((n-1)/5)*5+1,last=Math.min(first+4,27);
        const buttons=[];
        if(first>1)buttons.push(['<<',first-5]);
        for(let i=first;i<=last;i++)buttons.push([String(i),i]);
        if(last<27)buttons.push(['>>',first+5]);
        for(const [label,target] of buttons) {
          const b=document.createElement('button');b.textContent=label;b.className='l2-compact-pages__btn';
          b.disabled=target===n;if(b.disabled)b.setAttribute('aria-current','page');
          b.onclick=()=>{clicks.push(label);render(target);};pager.appendChild(b);
        }
      }
      render(1);
      const mod=L2V7Factories.mobfarm({PAGE_SIZE:15,on:true,$q:s=>document.querySelector(s),
        LV_RE:/^()(.*?) · ур\\. (\\d+)/,QUEST:/★/,isChamp:()=>false,isBoss:()=>false,isRaidId:()=>false,
        fire:b=>{b.click();return true;},rnd:()=>0,sleep:async()=>{},
        waitFor:async(fn,limit,step)=>{const start=performance.now();while(performance.now()-start<limit){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,step));}return null;}});
      const outward=await mod.gotoPage(24),back=await mod.gotoPage(3);
      return {outward,back,pager:mod.pagerInfo(),clicks,first:mod.pageItems()[0].id};
    }""")
    browser.close()
    assert result == {'outward': True, 'back': True, 'pager': {'cur': 3, 'total': 27, 'count': 398},
                      'clicks': ['>>', '>>', '>>', '>>', '24', '<<', '<<', '<<', '<<', '3'], 'first': 'mob30'}, result
    print('PASS: Chromium DOM — numbered map pagination, next/previous groups and correct spawn page')

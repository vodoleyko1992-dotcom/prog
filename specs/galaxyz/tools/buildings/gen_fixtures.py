# Renders UPSTREAM 2Moons templates (page.buildings/research/shipyard/resources.default.tpl) with sample data.
import json, math, sys, html
OUT=sys.argv[1]; E=json.load(open(sys.argv[2]))['elements']
NOW=1793353000  # 2026-10-30 08:56:40 UTC
TECH={int(k):v['nameEn'] for k,v in E.items()}
TECH.update({901:'Metal',902:'Crystal',903:'Deuterium',911:'Energy',921:'Dark Matter'})
SHORT={1:'Used in the extraction of metal ore, metal mines are of primary importance to all emerging and established empires.',
 2:'Crystals are the main resource used to build electronic circuits and form certain alloy compounds.'}
def short(i): return SHORT.get(i, f'Short description of {TECH[i]}.')
def num(n):  # pretty_number: number_format(n,0,',','.')
    n=math.floor(n) if n>=0 else -math.floor(-n); s=f'{abs(int(n)):,}'.replace(',','.'); return ('-' if n<0 else '')+s
def ptime(s):
    s=int(s); d=s//86400; h=s//3600%24; m=s//60%60; sec=s%60
    return (f'{d}d ' if d>0 else '')+f'{h:02d}h {m:02d}m {sec:02d}s'
MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
import datetime
def tdf(ts):
    t=datetime.datetime.fromtimestamp(ts, datetime.timezone.utc); return f'{t.day:02d}. {MON[t.month-1]} {t.year}, {t.hour:02d}:{t.minute:02d}:{t.second:02d}'
DPATH='./styles/theme/gow/'
GAME_SPEED=25000  # 10x (default 2500 = 1x)
PLANET={'metal':2064425065,'crystal':1126197944,'deuterium':743320817,'darkmatter':3981,'robot':10,'nano':2,'hangar':12,'lab':12,'uni':0}
def price(i,level,destroy=False,amount=None):
    e=E[str(i)]; out={}
    for r,v in e['costBaseAfterMigration2'].items():
        p=v
        if e['class'] in (200,400,500): p=v*(amount or 1)
        elif e['factor'] not in (0,1): p=v*e['factor']**level
        if destroy: p/=2
        out[int(r)]=p
    return out
def have(r): return {901:PLANET['metal'],902:PLANET['crystal'],903:PLANET['deuterium'],921:PLANET['darkmatter'],911:41670}[r]
def overflow(c): return {r:max(v-math.floor(have(r)),0) for r,v in c.items()}
def btime(i,c,destroy=False):
    cost=c.get(901,0)+c.get(902,0); k=E[str(i)]['class']
    if k==0: t=cost/(GAME_SPEED*(1+PLANET['robot']))*0.5**PLANET['nano']
    elif k in(200,400,500): t=cost/(GAME_SPEED*(1+PLANET['hangar']))*0.5**PLANET['nano']
    else: t=cost/(1000*(1+PLANET['lab']))/(GAME_SPEED/2500)*(0.92**PLANET['uni'])
    return max(math.floor(t*(1300 if destroy else 3600)),1)

def layout(page, title, content, script='', extra_q=''):
    return f'''<!DOCTYPE html>
<!-- UPSTREAM-DERIVED FIXTURE, NOT A REAL PAGE. Rendered by hand from 2Moons styles/templates/game/{title} with plausible data
     (sample: planet 254102 "Главная планета" [2:68:5], game_speed={GAME_SPEED} (10x), robot=10 nano=2 shipyard=12 lab=12, now={NOW}).
     The live fork (GALAXYZ 1.8.git, theme gow) is known to render these pages differently (see buildings.md section 2). -->
<html lang="en"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<title>{page.capitalize()} - Aeternum (New) - Aeterum (New)</title>
<meta name="generator" content="GALAXYZ 1.8.git">
<script type="text/javascript">
        var ServerTimezoneOffset = 0;
        var serverTime 	= new Date(2026, 9, 30, 8, 56, 40);
        var startTime = serverTime.getTime();
        var Gamename = document.title;
        var Ready		= "Ready";
        var Skin		= "./styles/theme/gow/";
        var Lang		= "en";
        var queryString	= "page={page}{extra_q}";
</script>
</head>
<body id="{page}" class="full">
<!-- resource bar excerpt, markup copied from the REAL overview (eu/pages/overview.html:257-265) -->
<table id="resourceBar"><tbody><tr>
<td class="res_current tooltip" id="current_metal" data-real="{PLANET['metal']}" data-tooltip-content="{num(PLANET['metal'])}">2.064&nbsp;M</td>
<td class="res_current tooltip" id="current_crystal" data-real="{PLANET['crystal']}" data-tooltip-content="{num(PLANET['crystal'])}">1.126&nbsp;M</td>
<td class="res_current tooltip" id="current_deuterium" data-real="{PLANET['deuterium']}" data-tooltip-content="{num(PLANET['deuterium'])}">743&nbsp;M</td>
<td class="res_current tooltip" id="current_darkmatter" data-real="{PLANET['darkmatter']}" data-tooltip-content="{num(PLANET['darkmatter'])}">4K</td>
</tr></tbody></table>
<div id="content">{content}</div>
{script}
</body></html>
'''

def cost_p(c,ov):
    return ''.join(f'\n\t\t\t\t\t{TECH[r]}: <b><span style="color:{"lime" if ov[r]==0 else "red"}">{num(v)}</span></b>\n\t\t\t\t\t' for r,v in c.items())
def remaining(ov):
    return ''.join(f'\t\t\t\t\t\t{TECH[r]}: <span style="font-weight:700">{num(v)}</span><br>\n' for r,v in ov.items())

# ---------------- page=buildings ----------------
def buildings():
    levels={1:30,2:27,3:25,4:28,6:0,12:14,14:10,15:2,21:12,22:12,23:11,24:10,31:12,33:3,34:0,44:4}
    # queue: Metal mine 31 (active), Crystal mine 28, Metal mine 32
    q=[]; end=NOW
    qspec=[(1,31,'build'),(2,28,'build'),(1,32,'build')]
    t0=btime(1,price(1,31)); start=NOW-1200
    for idx,(el,lv,mode) in enumerate(qspec):
        t=btime(el,price(el,lv))
        end = start+t if idx==0 else end+t
        q.append(dict(element=el,level=lv,time=t,resttime=end-NOW,destroy=mode=='destroy',endtime=end,display=tdf(end)))
    quick={}
    for x in q: quick[x['element']]=x['level']
    reqok=lambda i: all(levels.get(int(r),20)>=l for r,l in E[str(i)]['requirements'].items())
    fields_ok=True; can=True; busy={'shipyard':False,'research':True}
    info={}
    for i in E['_ids_build'] if False else [1,2,3,4,6,12,14,15,21,22,23,24,31,33,34,44]:
        if not reqok(i): continue
        lt=quick.get(i,levels[i])
        c=price(i,lt+1); d=price(i,levels[i],True)
        info[i]=dict(level=levels[i],maxLevel=255,costResources=c,costOverflow=overflow(c),elementTime=btime(i,c),
            destroyResources=d,destroyTime=btime(i,d,True),destroyOverflow=overflow(d),buyable=True,levelToBuild=lt,
            infoEnergy=('Need more <font color="#FF0000">1.234</font> of Energy' if i in(1,2,3) else ('Produced <font color="#00FF00">3.456</font> Energy more' if i in(4,12) else '')))
    h=['\n<div id="buildlist" class="buildlist">\n\t<table style="width:760px">']
    for n,L in enumerate(q,1):
        ID=L['element']; B=info[ID]
        h.append('\t\t<tr>\n\t\t\t<td style="width:70%;vertical-align:top;" class="left">\n\t\t\t\t'+f'{n}.: ')
        if not (busy['research'] and ID in(6,31)) and not(busy['shipyard'] and ID in(15,21)) and fields_ok and can and B['buyable']:
            h.append(f'''\t\t\t\t<form class="build_form" action="game.php?page=buildings" method="post">
\t\t\t\t\t<input type="hidden" name="cmd" value="insert">
\t\t\t\t\t<input type="hidden" name="building" value="{ID}">
\t\t\t\t\t<button type="submit" class="build_submit onlist">{TECH[ID]} {L['level']}{' Demolish' if L['destroy'] else ''}</button>
\t\t\t\t</form>''')
        else: h.append(f"{TECH[ID]} {L['level']} ")
        if n==1:
            h.append(f'''\t\t\t\t<br><br><div id="progressbar" data-time="{L['resttime']}"></div>
\t\t\t</td>
\t\t\t<td>
\t\t\t\t<div id="time" data-time="{L['time']}"><br></div>
\t\t\t\t<form action="game.php?page=buildings" method="post" class="build_form">
\t\t\t\t\t<input type="hidden" name="cmd" value="cancel">
\t\t\t\t\t<button type="submit" class="build_submit onlist">Cancel</button>
\t\t\t\t</form>''')
        else:
            h.append(f'''\t\t\t</td>
\t\t\t<td>
\t\t\t\t<form action="game.php?page=buildings" method="post" class="build_form">
\t\t\t\t\t<input type="hidden" name="cmd" value="remove">
\t\t\t\t\t<input type="hidden" name="listid" value="{n}">
\t\t\t\t\t<button type="submit" class="build_submit onlist">Cancel</button>
\t\t\t\t</form>''')
        h.append(f'''\t\t\t\t<br><span style="color:lime" data-time="{L['endtime']}" class="timer">{L['display']}</span>
\t\t\t</td>
\t\t</tr>''')
    h.append('\t</table>\n</div>')
    h.append('<table style="width:760px">')
    for ID,B in info.items():
        lvl=f" (Level {B['level']})" if B['level']>0 else ''
        if B['maxLevel']==B['levelToBuild']: act='<span style="color:red">Maximum level reached</span>'
        elif (busy['research'] and ID in(6,31)) or (busy['shipyard'] and ID in(15,21)): act='<span style="color:red">Busy</span>'
        else:
            lab='Build' if B['level']==0 else f"Build to the next level {B['levelToBuild']+1}"
            act=f'''<form action="game.php?page=buildings" method="post" class="build_form">
\t\t\t\t\t\t\t\t<input type="hidden" name="cmd" value="insert">
\t\t\t\t\t\t\t\t<input type="hidden" name="building" value="{ID}">
\t\t\t\t\t\t\t\t<button type="submit" class="build_submit">{lab}</button>
\t\t\t\t\t\t\t</form>'''
        dem=''
        if B['level']>0:
            if ID==43: dem+=f'<a href="#" onclick="return Dialog.info({ID})">Jump</a>'
            if ID!=44:
                rows=''.join(f"\n\t\t\t\t\t\t\t\t\t<tr>\n\t\t\t\t\t\t\t\t\t\t<td>{TECH[r]}</td>\n\t\t\t\t\t\t\t\t\t\t<td><span style='color:lime'>{num(v)}</span></td>\n\t\t\t\t\t\t\t\t\t</tr>" for r,v in B['destroyResources'].items())
                dem+=f'''<br><a class="tooltip_sticky" data-tooltip-content="
\t\t\t\t\t\t\t\t<table style='width:300px'>
\t\t\t\t\t\t\t\t\t<tr>
\t\t\t\t\t\t\t\t\t\t<th colspan='2'>Cost to destroy: {TECH[ID]} {B['level']}</th>
\t\t\t\t\t\t\t\t\t</tr>{rows}
\t\t\t\t\t\t\t\t\t<tr>
\t\t\t\t\t\t\t\t\t\t<td>Duration</td>
\t\t\t\t\t\t\t\t\t\t<td>{ptime(B['destroyTime'])}</td>
\t\t\t\t\t\t\t\t\t</tr>
\t\t\t\t\t\t\t\t\t<tr>
\t\t\t\t\t\t\t\t\t\t<td colspan='2'>
\t\t\t\t\t\t\t\t\t\t\t<form action='game.php?page=buildings' method='post' class='build_form'>
\t\t\t\t\t\t\t\t\t\t\t\t<input type='hidden' name='cmd' value='destroy'>
\t\t\t\t\t\t\t\t\t\t\t\t<input type='hidden' name='building' value='{ID}'>
\t\t\t\t\t\t\t\t\t\t\t\t<button type='submit' class='build_submit onlist'>Demolish</button>
\t\t\t\t\t\t\t\t\t\t\t</form>
\t\t\t\t\t\t\t\t\t\t</td>
\t\t\t\t\t\t\t\t\t</tr>
\t\t\t\t\t\t\t\t</table>
\t\t\t\t\t\t\t\t">Demolish</a>'''
        else: dem='&nbsp;'
        en=f"\n\t\t\t\t\t\t\tNext level:<br>\n\t\t\t\t\t\t\t{B['infoEnergy']}<br>" if B['infoEnergy'] else ''
        h.append(f'''\t<tr>
\t\t<td rowspan="2" style="width:120px;">
\t\t\t<a href="#" onclick="return Dialog.info({ID})">
\t\t\t\t<img src="{DPATH}gebaeude/{ID}.gif" alt="{TECH[ID]}" width="120" height="120">
\t\t\t</a>
\t\t</td>
\t\t<th>
\t\t\t<a href="#" onclick="return Dialog.info({ID})">{TECH[ID]}</a>{lvl}
\t\t</th>
\t</tr>
\t<tr>
\t\t<td>
\t\t\t<table style="width:100%">
\t\t\t\t<tr>
\t\t\t\t\t<td class="transparent left" style="width:90%;padding:10px;"><p>{short(ID)}</p>
\t\t\t\t\t<p>{cost_p(B['costResources'],B['costOverflow'])}</p></td>
\t\t\t\t\t<td class="transparent" style="vertical-align:middle;width:100px">
\t\t\t\t\t{act}
\t\t\t\t\t</td>
\t\t\t\t</tr>
\t\t\t</table>
\t\t</td>
\t</tr>
\t<tr>
\t\t<td colspan="2" style="margin-bottom:10px;">  
\t\t\t<table style="width:100%">
\t\t\t\t<tr>
\t\t\t\t\t<td class="transparent left">
\t\t\t\t\t\tRemaining:<br>
{remaining(B['costOverflow'])}\t\t\t\t\t\t<br>
\t\t\t\t\t</td>
\t\t\t\t</tr>
\t\t\t\t<tr>\t\t
\t\t\t\t\t<td class="transparent left" style="width:68%">{en}
\t\t\t\t\t\t{dem}
\t\t\t\t\t</td>
\t\t\t\t\t<td class="transparent right" style="white-space:nowrap;">
\t\t\t\t\t\tTime: :<br>{ptime(B['elementTime'])}
\t\t\t\t\t</td>
\t\t\t\t</tr>\t
\t\t\t</table>
\t\t</td>
\t</tr>''')
    h.append('</table>\n')
    return layout('buildings','page.buildings.default.tpl','\n'.join(h),'<script type="text/javascript" src="./scripts/game/buildlist.js"></script>')

# ---------------- page=research ----------------
def research():
    lv={106:12,108:14,109:18,110:17,111:19,113:14,114:10,115:16,117:12,118:9,120:14,121:8,122:7,123:3,124:9,131:2,132:1,133:0,199:0}
    lv.update({31:12,6:0,14:10,15:2,21:12,44:4,3:25,12:14}) # planet levels for requirements
    def ok(i): return all(lv.get(int(r),99)>=l for r,l in E[str(i)]['requirements'].items())
    start=NOW-3000; q=[]; end=0
    for idx,(el,lvl,planet) in enumerate([(122,8,''),(109,19,'Colony')]):
        c=price(el,lvl); t=btime(el,c)
        end=(start+t) if idx==0 else end+t
        q.append(dict(element=el,level=lvl,time=t,resttime=end-NOW,endtime=end,display=tdf(end),planet=planet))
    quick={x['element']:x['level'] for x in q}
    tl=[]
    for i in [106,108,109,110,111,113,114,115,117,118,120,121,122,123,124,131,132,133,199]:
        if not ok(i): continue
        lt=quick.get(i,lv[i]); c=price(i,lt+1)
        tl.append((i,dict(level=lv[i],maxLevel=255,costResources=c,costOverflow=overflow(c),elementTime=btime(i,c),buyable=True,levelToBuild=lt)))
    RL=dict(tl); full=True  # max_elements_tech default 2 == count(queue)
    h=['\n<div id="buildlist" class="buildlist">\n\t<table style="width:760px">']
    for n,L in enumerate(q,1):
        ID=L['element']; C=RL.get(ID)
        pl=f" @ {L['planet']}" if L['planet'] else ''
        h.append('\t\t<tr>\n\t\t\t<td style="width:70%;vertical-align:top;" class="left">\n\t\t\t\t\n\t\t\t\t'+f'{n}.: ')
        if C and C['maxLevel']!=C['level'] and not full and C['buyable']:
            h.append(f'''\t\t\t\t<form action="game.php?page=research" method="post" class="build_form">
\t\t\t\t\t<input type="hidden" name="cmd" value="insert">
\t\t\t\t\t<input type="hidden" name="tech" value="{ID}">
\t\t\t\t\t<button type="submit" class="build_submit onlist">{TECH[ID]} {L['level']}{pl}</button>
\t\t\t\t</form>''')
        else: h.append(f"\t\t\t\t{TECH[ID]} {L['level']}{pl}")
        if n==1:
            h.append(f'''\t\t\t\t<br><br><div id="progressbar" data-time="{L['resttime']}"></div>
\t\t\t</td>
\t\t\t<td>
\t\t\t\t<div id="time" data-time="{L['time']}"><br></div>
\t\t\t\t<form action="game.php?page=research" method="post" class="build_form">
\t\t\t\t\t<input type="hidden" name="cmd" value="cancel">
\t\t\t\t\t<button type="submit" class="build_submit onlist">Cancel</button>
\t\t\t\t</form>''')
        else:
            h.append(f'''\t\t\t</td>
\t\t\t<td>
\t\t\t\t<form action="game.php?page=research" method="post" class="build_form">
\t\t\t\t\t<input type="hidden" name="cmd" value="remove">
\t\t\t\t\t<input type="hidden" name="listid" value="{n}">
\t\t\t\t\t<button type="submit" class="build_submit onlist">Cancel</button>
\t\t\t\t</form>''')
        h.append(f'''\t\t\t\t<br><span style="color:lime" data-time="{L['endtime']}" class="timer">{L['display']}</span>
\t\t\t</td>
\t\t</tr>''')
    h.append('\t</table>\n</div>\n\n<table style="width:760px">')
    for ID,B in tl:
        lvl=f" (Level {B['level']})" if B['level']!=0 else ''
        lab='Research' if B['level']==0 else f"Research to the next level {B['levelToBuild']+1}"
        if B['maxLevel']==B['levelToBuild']: act='<span style="color:red">Maximum level reached</span>'
        elif full or not B['buyable']: act=f'<span style="color:red">{lab}</span>'
        else: act=f'''<form action="game.php?page=research" method="post" class="build_form">
\t\t\t\t\t\t\t<input type="hidden" name="cmd" value="insert">
\t\t\t\t\t\t\t<input type="hidden" name="tech" value="{ID}">
\t\t\t\t\t\t\t<button type="submit" class="build_submit">{lab}</button>
\t\t\t\t\t\t</form>'''
        h.append(f'''\t<tr>
\t\t<td rowspan="2" style="width:120px;">
\t\t\t<a href="#" onclick="return Dialog.info({ID})">
\t\t\t\t<img src="{DPATH}gebaeude/{ID}.gif" alt="" class="top" width="120" height="120">
\t\t\t</a>
\t\t</td>
\t\t<th>
\t\t\t<a href="#" onclick="return Dialog.info({ID})">{TECH[ID]}</a>{lvl}
\t\t</th>
\t</tr>
\t<tr>
\t\t<td>
\t\t\t<table style="width:100%">
\t\t\t\t<tr>
\t\t\t\t\t<td class="transparent left" style="width:90%;padding:10px;"><p>{short(ID)}</p>
\t\t\t\t\t<p>{cost_p(B['costResources'],B['costOverflow'])}</p></td>
\t\t\t\t\t<td class="transparent" style="vertical-align:middle;width:100px">
\t\t\t\t\t{act}
\t\t\t\t\t</td>
\t\t\t\t</tr>
\t\t\t</table>
\t\t</td>
\t</tr>
\t<tr>
\t\t<td colspan="2" style="margin-bottom:10px;">  
\t\t\t<table style="width:100%">
\t\t\t\t<tr>
\t\t\t\t\t<td class="transparent left">
\t\t\t\t\t\tRemaining:<br>
{remaining(B['costOverflow'])}\t\t\t\t\t\t<br>
\t\t\t\t\t</td>
\t\t\t\t\t<td class="transparent right">
\t\t\t\t\t\tTime: 
\t\t\t\t\t</td>
\t\t\t\t</tr>
\t\t\t\t<tr>\t\t
\t\t\t\t\t<td class="transparent left" style="width:68%">
\t\t\t\t\t\t&nbsp;
\t\t\t\t\t</td>
\t\t\t\t\t<td class="transparent right" style="white-space:nowrap;">
\t\t\t\t\t\t{ptime(B['elementTime'])}
\t\t\t\t\t</td>
\t\t\t\t</tr>\t
\t\t\t</table>
\t\t</td>
\t</tr>''')
    h.append('</table>\n')
    return layout('research','page.research.default.tpl','\n'.join(h),'<script src="scripts/game/research.js"></script>')

# ---------------- page=shipyard ----------------
def shipyard(mode):
    have_={202:150,203:1200,204:5000,205:0,206:300,207:450,208:2,209:800,210:300,212:250,213:40,214:3,215:120,
           401:2000,402:1500,403:300,404:60,405:100,406:20,407:1,408:0,502:20,503:5}
    ids=[202,203,204,205,206,207,208,209,210,211,212,213,214,215] if mode=='fleet' else [401,402,403,404,405,406,407,408,502,503]
    queue=[(203,500),(207,25),(401,1000)]
    inq={a for a,_ in queue}
    Q=[[TECH[a],n,btime(a,price(a,0,amount=1)),a] for a,n in queue]
    hangar_plus=37  # b_hangar: seconds already spent on current unit
    qt=sum(x[2]*x[1] for x in Q)
    BL={'Queue':Q,'b_hangar_id_plus':hangar_plus,'pretty_time_b_hangar':ptime(max(qt-hangar_plus,0))}
    silo=4*10; missiles=20+2*5  # free slots
    h=[]
    h.append('''
<table style="width:760px">
\t<tr>
\t\t<td class="transparent">
\t\t\t<div id="bx" class="z"></div>
\t\t\t<br>
\t\t\t<form action="game.php?page=shipyard&amp;mode='''+mode+'''" method="post">
\t\t\t<input type="hidden" name="action" value="delete">
\t\t\t<table>
\t\t\t<tr>
\t\t\t\t<th>&nbsp;</th>
\t\t\t</tr>
\t\t\t<tr>
\t\t\t\t<td><select name="auftr[]" id="auftr" size="10" multiple><option>&nbsp;</option></select><br><br>ATTENTION! <br> If you cancel only will receive 60% of your resources s invested.<br><input type="submit" value="Cancel construction"></td>
\t\t\t</tr>
\t\t\t<tr>
\t\t\t\t<th>&nbsp;</th>
\t\t\t</tr>
\t\t\t</table>
\t\t\t</form>
\t\t\t<br><span id="timeleft"></span><br><br>
\t\t</td>
\t</tr>
</table>
<br>
''')
    h.append(f'<form action="game.php?page=shipyard&amp;mode={mode}" method="post">\n<table style="width:760px">')
    for ID in ids:
        if ID==211: continue  # requirements not met in sample (hidden like upstream)
        c=price(ID,0,amount=1); ov=overflow(c)
        mx=min(math.floor(have(r)/v) for r,v in c.items())
        if E[str(ID)]['onePerPlanet']: mx=min(mx,1)
        if ID==502: mx=min(mx,max(0,silo-missiles))
        if ID==503: mx=min(mx,max(0,silo-missiles)//2)
        avail=have_.get(ID,0)
        already=E[str(ID)]['onePerPlanet'] and (ID in inq or avail!=0)
        av=f' (Available:  {num(avail)})' if avail!=0 else ''
        if already: act='<span style="color:red">You can only build the shield 1 time!</span>'
        else: act=f'''<input type="text" name="fmenge[{ID}]" id="input_{ID}" size="7" maxlength="7" value="0" tabindex=""></p><p>
\t\t\t\t\t<input type="button" value="max" onclick="$('#input_{ID}').val('{mx}')"></p>
\t\t\t\t\t'''
        h.append(f'''\t<tr>
\t\t<td rowspan="2" style="width:120px;">
\t\t\t<a href="#" onclick="return Dialog.info({ID})">
\t\t\t\t<img src="{DPATH}gebaeude/{ID}.gif" alt="{TECH[ID]}" width="120" height="120">
\t\t\t</a>
\t\t</td>
\t\t<th>
\t\t\t<a href="#" onclick="return Dialog.info({ID})">{TECH[ID]}</a><span id="val_{ID}">{av}</span>
\t\t</th>
\t</tr>
\t<tr>
\t\t<td>
\t\t\t<table style="width:100%">
\t\t\t\t<tr>
\t\t\t\t\t<td class="transparent left" style="width:90%;padding:10px;"><p>{short(ID)}</p><p>{cost_p(c,ov)}</p></td>
\t\t\t\t\t<td class="transparent" style="vertical-align:middle;width:100px">
\t\t\t\t\t<p>{act}
\t\t\t\t\t</td>
\t\t\t\t</tr>
\t\t\t</table>
\t\t</td>
\t</tr>
\t<tr>
\t\t<td colspan="2" style="margin-bottom:10px;">  
\t\t\t<table style="width:100%">
\t\t\t\t<tr>
\t\t\t\t\t<td class="transparent left">
\t\t\t\t\t\tRemaining:<br>
{remaining(ov)}\t\t\t\t\t\t<br>
\t\t\t\t\t</td>
\t\t\t\t\t<td class="transparent right">
\t\t\t\t\t\tTime: 
\t\t\t\t\t</td>
\t\t\t\t</tr>
\t\t\t\t<tr>\t\t
\t\t\t\t\t<td class="transparent left" style="width:68%">
\t\t\t\t\t\tMaximum possible units to build:<br><span style="font-weight:700">{num(mx)}</span>
\t\t\t\t\t</td>
\t\t\t\t\t<td class="transparent right" style="white-space:nowrap;">
\t\t\t\t\t\t{ptime(btime(ID,c))}
\t\t\t\t\t</td>
\t\t\t\t</tr>\t
\t\t\t</table>
\t\t</td>
\t</tr>''')
    h.append('\t<tr><th colspan="2" style="text-align:center"><input type="submit" value="Build"></th></tr>\n</table>\n</form>\n')
    js=json.dumps(BL,ensure_ascii=True,separators=(',',':')).replace('/','\\/')
    script=f'''<script type="text/javascript">
data\t\t\t= {js};
bd_operating\t= '(In construction)';
bd_available\t= 'Available: ';
</script>
<script src="scripts/base/bcmath.js"></script>
<script src="scripts/game/shipyard.js"></script>
<script type="text/javascript">
$(function() {{
    ShipyardInit();
}});
</script>'''
    return layout('shipyard','page.shipyard.default.tpl','\n'.join(h),script,f'&mode={mode}')

def resources():
    rows=[(1,30,10,(1608412,0,0,-584877)),(2,27,10,(0,577000,0,-288500)),(3,25,10,(0,0,300120,-812000)),
          (4,28,10,(0,0,0,925000)),(12,14,8,(0,0,-40100,410000)),(212,250,10,(0,0,0,9750))]
    h=['\n<form action="?page=resources" method="post">\n<input type="hidden" name="mode" value="send">\n<table style="width:760px;">\n<tbody>\n<tr>\n\t<th colspan="5">Resources produced on the planet "Главная планета"</th>\n</tr>\n<tr style="height:22px">\n\t<td style="width:40%">&nbsp;</td>\n\t<td style="width:10%">Metal</td>\n\t<td style="width:10%">Crystal</td>\n\t<td style="width:10%">Deuterium</td>\n\t<td style="width:10%">Energy</td>\n</tr>\n<tr style="height:22px">\n\t<td>Basic Production</td>\n\t<td>200</td>\n\t<td>100</td>\n\t<td>0</td>\n\t<td>0</td>\n</tr>']
    def cell(v): col='lime' if v>0 else ('red' if v<0 else 'white'); return f'\t<td><span style="color:{col}">{num(v)}</span></td>'
    for pid,lvl,pct,prod in rows:
        opts=''.join(f'<option value="{p}" label="{p*10}%"{" selected=\"selected\"" if p==pct else ""}>{p*10}%</option>\n' for p in range(10,-1,-1))
        h.append(f'<tr style="height:22px">\n\t<td>{TECH[pid]} ({"Quantity" if pid>200 else "Level"} {lvl})</td>\n'+'\n'.join(cell(v) for v in prod)+f'\n\t<td style="width:10%">\n\t\t<select name="prod[{pid}]">\n{opts}</select>\n\n\t</td>\n</tr>')
    tot=[sum(r[3][k] for r in rows)+[200,100,0,0][k] for k in range(4)]
    h.append('<tr style="height:22px">\n\t<td>Bonus (Officers/Bonus):</td>\n'+'\n'.join(cell(v) for v in (160841,57700,30012,0))+'\n\t<td><input value="Cost estimate" type="submit"></td>\n</tr>')
    h.append('<tr style="height:22px">\n\t<td>Storage capacity</td>\n\t<td><span style="color:lime;">3.417&nbsp;B</span></td>\n\t<td><span style="color:lime;">1.864&nbsp;B</span></td>\n\t<td><span style="color:lime;">1.017&nbsp;B</span></td>\n\t<td>-</td>\n</tr>')
    h.append('<tr style="height:22px">\n\t<td>Total:</td>\n'+'\n'.join(cell(v) for v in tot)+'\n</tr>')
    h.append('<tr style="height:22px">\n\t<td>Daily Production:</td>\n'+'\n'.join(cell(v*24 if k<3 else v) for k,v in enumerate(tot))+'\n</tr>')
    h.append('<tr style="height:22px">\n\t<td>Weekly Production:</td>\n'+'\n'.join(cell(v*168 if k<3 else v) for k,v in enumerate(tot))+'\n</tr>\n</tbody>\n</table>\n</form>\n')
    return layout('resources','page.resources.default.tpl','\n'.join(h))

for name,content in [('buildings-upstream-buildings.html',buildings()),('buildings-upstream-research.html',research()),
                     ('buildings-upstream-shipyard-fleet.html',shipyard('fleet')),('buildings-upstream-shipyard-defense.html',shipyard('defense')),
                     ('buildings-upstream-resources.html',resources())]:
    open(f'{OUT}/{name}','w',encoding='utf-8').write(content); print(name,len(content))

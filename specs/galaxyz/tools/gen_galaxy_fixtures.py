# Builds fixtures/galaxy-*.html for galaxy.md.
#   python3 -I tools/gen_galaxy_fixtures.py      (cwd = specs/galaxyz)
# UPSTREAM fixtures: hand-rendered from 2Moons 1.8 templates (page.galaxy.default.tpl, class.GalaxyRows.php,
#   page.statistics.default.tpl + shared.statistics.*.tpl, page.search.result.*.tpl, page.playerCard.default.tpl,
#   page.phalanx.default.tpl, error.default.tpl, language/en/INGAME.php). Data is invented but consistent.
# LIVE-SYNTHETIC fixture: the REAL eu/pages/galaxy.html with some EMPTY rows replaced by GUESSED foreign rows in the
#   live markup style (td.microplanet1 / td.planetname1 / title tooltips). Markup of foreign rows is a GUESS.
import os, re, html

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(HERE, 'fixtures')
REAL_GALAXY = os.path.normpath(os.path.join(HERE, '../../../eu/pages/galaxy.html'))
LAYOUT = os.path.join(FIX, 'layout-upstream-overview.html')
DP = './styles/theme/gow/'

def esc(s):
    return html.escape(s, quote=True)

def num(n):  # pretty_number: '.' thousands
    s = f'{abs(int(n)):,}'.replace(',', '.')
    return ('-' if n < 0 else '') + s

# ------------------------------------------------------------------ upstream galaxy
G, S, MAXP = 2, 70, 15
ME = {'id': 4377, 'name': 'vodoleyko1992', 'ally_id': 12}
LNG_M = {1: 'Attack', 3: 'Transport', 4: 'Deploy', 5: 'Hold', 6: 'Espionage', 8: 'Recycle', 9: 'Destroy', 10: 'Missile Attack'}
SHORT = {'vacation': 'VM', 'banned': 'B', 'inactive': 'i', 'longinactive': 'I', 'noob': 'N', 'strong': 'S', 'enemy': '', 'friend': '', 'member': ''}

ROWS = {
    2: dict(pid=301120, name='Arrakis', image='dschjungelplanet04', act='(*)', own=False,
            user=dict(id=3837, name='Flor', rank=12, cls=[]), buddy=False,
            ally=dict(id=7, name='Aeternum Guard', tag='AET', members=14, rank=2, web='https://example.org/aet', cls=['friend']),
            moon=dict(id=301121, name='Mond', diameter=8944, temp=-27), debris=dict(metal=120000, crystal=45000),
            missions={1: 1, 3: 1, 4: 0, 5: 1, 6: 1, 8: 1, 9: 0, 10: 1}, phalanx=True, action=dict(esp=1, message=1, buddy=1, missle=1)),
    3: 'destroyed',
    4: dict(pid=301140, name='Colony', image='normaltempplanet02', act='(37 min)', own=False,
            user=dict(id=3839, name='Txemin', rank=455, cls=['inactive']), buddy=False, ally=None, moon=None,
            debris=dict(metal=3400, crystal=1100),
            missions={1: 1, 3: 1, 4: 0, 5: 1, 6: 1, 8: 1, 9: 0, 10: 1}, phalanx=True, action=dict(esp=1, message=1, buddy=1, missle=1)),
    5: dict(pid=301150, name='Hauptplanet', image='wasserplanet03', act='', own=False,
            user=dict(id=3833, name='Geronimo', rank=1201, cls=['inactive', 'longinactive']), buddy=False, ally=None, moon=None, debris=None,
            missions={1: 1, 3: 1, 4: 0, 5: 1, 6: 1, 8: 1, 9: 0, 10: 1}, phalanx=False, action=dict(esp=1, message=1, buddy=1, missle=1)),
    6: dict(pid=301160, name='Winterfell', image='eisplanet01', act='', own=False,
            user=dict(id=3836, name='Severian', rank=88, cls=['vacation']), buddy=True,
            ally=dict(id=19, name='Night Watch', tag='NW', members=1, rank=40, web='', cls=['enemy']), moon=None, debris=None,
            missions={1: 1, 3: 1, 4: 0, 5: 1, 6: 1, 8: 1, 9: 0, 10: 1}, phalanx=False, action=dict(esp=1, message=1, buddy=0, missle=1)),
    7: dict(pid=301170, name='Exile', image='trockenplanet05', act='', own=False,
            user=dict(id=3844, name='marusic01', rank=301, cls=['vacation', 'banned']), buddy=False, ally=None, moon=None, debris=None,
            missions={1: 1, 3: 1, 4: 0, 5: 1, 6: 1, 8: 1, 9: 0, 10: 1}, phalanx=False, action=dict(esp=1, message=1, buddy=1, missle=1)),
    8: dict(pid=301180, name='Little One', image='normaltempplanet06', act='(23 min)', own=False,
            user=dict(id=4359, name='terror', rank=530, cls=['noob']), buddy=False, ally=None, moon=None, debris=None,
            missions={1: 1, 3: 1, 4: 0, 5: 1, 6: 1, 8: 1, 9: 0, 10: 1}, phalanx=False, action=dict(esp=1, message=1, buddy=1, missle=1)),
    9: dict(pid=301190, name='King&#039;s Landing', image='gasplanet02', act='(*)', own=False,
            user=dict(id=3843, name='Jon Snow', rank=1, cls=['strong']), buddy=False,
            ally=dict(id=12, name='Nova Collective', tag='NOVA', members=8, rank=1, web='', cls=['member']),
            moon=dict(id=301191, name='Moon', diameter=7450, temp=-61), debris=dict(metal=9800000, crystal=4100000),
            missions={1: 1, 3: 1, 4: 0, 5: 1, 6: 1, 8: 1, 9: 1, 10: 0}, phalanx=False, action=dict(esp=1, message=1, buddy=1, missle=0)),
    10: dict(pid=254106, name='Colony', image='normaltempplanet02', act='(52 min)', own=True,
             user=dict(id=4377, name='vodoleyko1992', rank=194, cls=[]), buddy=False,
             ally=dict(id=12, name='Nova Collective', tag='NOVA', members=8, rank=1, web='', cls=['member']),
             moon=dict(id=254110, name='Moon', diameter=5196, temp=-12), debris=None,
             missions={1: 0, 3: 1, 4: 1, 5: 0, 6: 0, 8: 1, 9: 0, 10: 0}, phalanx=False, action=False),
}

def planet_tip(r, p):
    m = r['missions']; out = []
    out.append(f"<table style='width:220px'><tr><th colspan='2'>Planet {r['name']} [{G}:{S}:{p}]</th></tr><tr><td style='width:80px'><img src='{DP}planeten/small/s_{r['image']}.jpg' height='75' width='75'></td><td>")
    if m[6]: out.append(f"<a href='javascript:doit(6,{r['pid']});'>{LNG_M[6]}</a><br><br>")
    if r['phalanx']: out.append(f"<a href='javascript:OpenPopup(&quot;?page=phalanx&amp;galaxy={G}&amp;system={S}&amp;planet={p}&amp;planettype=1&quot;, &quot;&quot;, 640, 510);'>Phalanx</a><br>")
    for mid in (1, 5, 4, 3):
        if m[mid]: out.append(f"<a href='?page=fleetTable&amp;galaxy={G}&amp;system={S}&amp;planet={p}&amp;planettype=1&amp;target_mission={mid}'>{LNG_M[mid]}</a><br>")
    if m[10]: out.append(f"<a href='?page=galaxy&amp;action=sendMissle&amp;galaxy={G}&amp;system={S}&amp;planet={p}'>{LNG_M[10]}</a><br>")
    out.append('</td></tr></table>')
    return ''.join(out)

def moon_tip(r, p):
    m = r['missions']; mo = r['moon']; a = []
    a.append(f"<table style='width:240px'><tr><th colspan='2'>Moon {mo['name']} [{G}:{S}:{p}]</th></tr><tr><td style='width:80px'><img src='{DP}planeten/mond.jpg' height='75' width='75'></td><td><table style='width:100%'><tr><th colspan='2'>Properties</th></tr><tr><td>Diameter</td><td>{num(mo['diameter'])}</td></tr><tr><td>Temperatura</td><td>{mo['temp']}</td></tr><tr><th colspan=2>Actions</th></tr><tr><td colspan='2'>")
    base = f"?page=fleetTable&amp;galaxy={G}&amp;system={S}&amp;planet={p}&amp;planettype=3&amp;target_mission="
    if m[1]: a.append(f"<a href='{base}1'>{LNG_M[1]}</a><br>")
    if m[3]: a.append(f"<a href='{base}3'>{LNG_M[3]}</a>")
    if m[3]: a.append(f"<br><a href='{base}4'>{LNG_M[4]}</a>")
    if m[5]: a.append(f"<br><a href='{base}5'>{LNG_M[5]}</a>")
    if m[6]: a.append(f"<br><a href='javascript:doit(6,{mo['id']});'>{LNG_M[6]}</a>")
    if m[9]: a.append(f"<br><br><a href='{base}9'>{LNG_M[9]}</a><br>")
    if m[10]: a.append(f"<a href='?page=galaxy&amp;action=sendMissle&amp;galaxy={G}&amp;system={S}&amp;planet={p}&amp;type=3'>{LNG_M[10]}</a><br>")
    a.append('</td></tr></table></td></tr></table>')
    return ''.join(a)

def debris_tip(r, p):
    d = r['debris']
    s = f"<table style='width:240px'><tr><th colspan='2'>Debris Field [{G}:{S}:{p}]</th></tr><tr><td style='width:80px'><img src='{DP}planeten/debris.jpg' height='75' style='width:75'></td><td><table style='width:100%'><tr><th colspan='2'>Resources:</th></tr><tr><td>Metal: </td><td>{num(d['metal'])}</td></tr><tr><td>Crystal: </td><td>{num(d['crystal'])}</td></tr>"
    if r['missions'][8]: s += f"<tr><th colspan='2'>Actions</th></tr><tr><td colspan='2'><a href='javascript:doit(8, {r['pid']});'>{LNG_M[8]}</a></td></tr>"
    return s + '</table></td></tr></table>'

def galaxy_content(action=None, missile_target=None):
    o = []
    o.append(f'''	<form action="?page=galaxy" method="post" id="galaxy_form">
	<input type="hidden" id="auto" value="dr">
	<table style="min-width:324px;width:324px;">
		<tr>
			<td class="transparent">
				<table>
					<tr>
						<th colspan="3">Galaxy</th>
					</tr>
					<tr>
						<td><input type="button" name="galaxyLeft" value="&lt;-" onclick="galaxy_submit('galaxyLeft')"></td>
						<td><input type="text" name="galaxy" value="{G}" size="5" maxlength="3" tabindex="1"></td>
						<td><input type="button" name="galaxyRight" value="-&gt;" onclick="galaxy_submit('galaxyRight')"></td>
					</tr>
				</table>
			</td>
			<td class="transparent">
				<table>
					<tr>
						<th colspan="3">System</th>
					</tr>
					<tr>
						<td><input type="button" name="systemLeft" value="&lt;-" onclick="galaxy_submit('systemLeft')"></td>
						<td><input type="text" name="system" value="{S}" size="5" maxlength="3" tabindex="2"></td>
						<td><input type="button" name="systemRight" value="-&gt;" onclick="galaxy_submit('systemRight')"></td>
					</tr>
				</table>
			</td>
		</tr>
		<tr>
			<td style="background-color:transparent;border:0px;" colspan="2">
				<input type="submit" value="View">
			</td>
		</tr>
	</table>
	</form>
''')
    if action == 'sendMissle':
        opts = '<option value="0">All defenses</option>\n' + '\n'.join(f'<option value="{i}">{n}</option>' for i, n in
              [(401, 'Rocket Launcher'), (402, 'Light Laser'), (403, 'Heavy Laser'), (404, 'Gauss Cannon'), (405, 'Ion Cannon'), (406, 'Plasma Turret'), (407, 'Small Shield Dome'), (408, 'Large Shield Dome'), (502, 'Anti-Ballistic Missiles')])
        g, s, p, t = missile_target
        o.append(f'''    <form action="?page=fleetMissile" method="post">
	<input type="hidden" name="galaxy" value="{g}">
	<input type="hidden" name="system" value="{s}">
	<input type="hidden" name="planet" value="{p}">
	<input type="hidden" name="type" value="{t}">
	<table class="table569">
		<tr>
			<th colspan="2">Launch Missiles [{g}:{s}:{p}]</th>
		</tr>
		<tr>
			<td>Number of Missiles (<b>25</b> disp.): <input type="text" name="SendMI" size="2" maxlength="7"></td>
			<td>Main Objective:
				<select name="Target">
{opts}
</select>
			</td>
		</tr>
		<tr>
			<th colspan="2" style="text-align:center;"><input type="submit" value="Send"></th>
		</tr>
	</table>
	</form>
''')
    o.append(f'''	<table class="table569">
    <tr>
		<th colspan="8">System {G}:{S}</th>
	</tr>
	<tr>
		<th style="white-space: nowrap">Pos.</th>
		<th style="white-space: nowrap">Planet</th>
		<th style="white-space: nowrap">Name (Activity)</th>
		<th style="white-space: nowrap">Moon</th>
		<th style="white-space: nowrap">Debris</th>
		<th style="white-space: nowrap">Player (State)</th>
		<th style="white-space: nowrap">Alliance</th>
		<th style="white-space: nowrap">Actions</th>
	</tr>
''')
    for p in range(1, MAXP + 1):
        r = ROWS.get(p)
        o.append('\t<tr>\n')
        if r is None:
            o.append(f'''		<td>
			<a href="?page=fleetTable&amp;galaxy={G}&amp;system={S}&amp;planet={p}&amp;planettype=1&amp;target_mission=7">{p}</a>
		</td>
''' + '        <td></td>\n' * 7)
        elif r == 'destroyed':
            o.append(f'''		<td>
			{p}
		</td>
        <td></td>
        <td style="white-space: nowrap;">Planet destroyed</td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
        <td></td>
''')
        else:
            u = r['user']; cls = u['cls']
            o.append(f'''		<td>
			{p}
		</td>
		<td>
			<a class="tooltip_sticky" data-tooltip-content="{planet_tip(r, p)}">
				<img src="{DP}planeten/small/s_{r['image']}.jpg" height="30" width="30" alt="">
			</a>
		</td>
		<td style="white-space: nowrap;">{r['name']} {r['act']}</td>
		<td style="white-space: nowrap;">
''')
            if r['moon']:
                o.append(f'''			<a class="tooltip_sticky" data-tooltip-content="{moon_tip(r, p)}">
				<img src="{DP}planeten/small/s_mond.jpg" height="22" width="22" alt="{r['moon']['name']}">
			</a>
''')
            o.append('		</td>\n		<td style="white-space: nowrap;">\n')
            if r['debris']:
                o.append(f'''			<a class="tooltip_sticky" data-tooltip-content="{debris_tip(r, p)}">
			<img src="{DP}planeten/debris.jpg" height="22" width="22" alt="">
			</a>
''')
            o.append('		</td>\n')
            tip = f"<table style='width:240px'><tr><th colspan='2'>Player {u['name']} in pos. {u['rank']}</th></tr><tr>"
            if not r['own']:
                if not r['buddy']: tip += f"<tr><td><a href='#' onclick='return Dialog.Buddy({u['id']})'>Friend request</a></td></tr>"
                tip += f"<tr><td><a href='#' onclick='return Dialog.Playercard({u['id']});'>Player profile</a></td></tr>"
            tip += f"<tr><td><a href='?page=statistics&amp;who=1&amp;start={u['rank']}'>Stats</a></td></tr></table>"
            ucls = ' '.join('galaxy-username-' + c for c in cls)
            o.append(f'''		<td>
			<a class="tooltip_sticky" data-tooltip-content="{tip}">
				<span class="{ucls} galaxy-username">{esc(u['name'])}</span>

''')
            if cls:
                inner = '&nbsp;'.join(f'<span class="galaxy-short-{c} galaxy-short">{SHORT[c]}</span>' for c in cls)
                o.append(f'				<span>(</span>{inner}<span>)</span>\n')
            o.append('			</a>\n		</td>\n		<td style="white-space: nowrap;">\n')
            a = r['ally']
            if a:
                mem = f"{a['members']} Member" if a['members'] == 1 else f"{a['members']} Members"
                web = f"<tr><td><a href='{a['web']}' target='allyweb'>Webpage of Alliance</td></tr>" if a['web'] else ''
                atip = f"<table style='width:240px'><tr><th>Alliance {a['name']} {mem}</th></tr><td><table><tr><td><a href='?page=alliance&amp;mode=info&amp;id={a['id']}'>Page of the Alliance</a></td></tr><tr><td><a href='?page=statistics&amp;start={a['rank']}&amp;who=2'>Stats</a></td></tr>{web}</table></td></table>"
                acls = ' '.join('galaxy-alliance-' + c for c in a['cls'])
                o.append(f'''			<a class="tooltip_sticky" data-tooltip-content="{atip}">
				<span class="{acls} galaxy-alliance">{a['tag']}</span>
			</a>
''')
            else:
                o.append('			-')
            o.append('		</td>\n		<td style="white-space: nowrap;">\n')
            act = r['action']
            if act:
                if act['esp']: o.append(f'''				<a href="javascript:doit(6,{r['pid']},{{&quot;210&quot;:&quot;1&quot;}})">
					<img src="{DP}img/e.gif" title="Spying" alt="">
				</a>''')
                if act['message']: o.append(f'''				<a href="#" onclick="return Dialog.PM({u['id']})">
					<img src="{DP}img/m.gif" title="Write message" alt="">
				</a>''')
                if act['buddy']: o.append(f'''                <a href="#" onclick="return Dialog.Buddy({u['id']})">
					<img src="{DP}img/b.gif" title="Friend request" alt="">
				</a>''')
                if act['missle']: o.append(f'''<a href="?page=galaxy&amp;action=sendMissle&amp;galaxy={G}&amp;system={S}&amp;planet={p}&amp;type=1">
					<img src="{DP}img/r.gif" title="Missile attack" alt="">
				</a>''')
                o.append('\n')
            else:
                o.append('			-\n')
            if r['phalanx']:
                o.append(f'''			<a class="textForBlind" href="#" onclick="OpenPopup('?page=phalanx&amp;galaxy={G}&amp;system={S}&amp;planet={p}&amp;planettype=1','',640,510);return false;"><span>Phalanx</span></a>\n''')
            o.append('		</td>\n')
        o.append('\t</tr>\n')
    legend = ("<table style='width:240px'><tr><th colspan='2'>Legend</td></tr><tr><td style='width:220px'>Strong player</td><td><span class='galaxy-short-strong'>S</span></td></tr><tr><td style='width:220px'>Weak player</td><td><span class='galaxy-short-noob'>N</span></td></tr><tr><td style='width:220px'>Vacation mode</td><td><span class='galaxy-short-vacation'>VM</span></td></tr><tr><td style='width:220px'>Banned / Suspended</td><td><span class='galaxy-short-banned'>B</span></td></tr><tr><td style='width:220px'>7 Inactive days</td><td><span class='galaxy-short-inactive'>i</span></td></tr><tr><td style='width:220px'>28 Inactive days</td><td><span class='galaxy-short-longinactive'>I</span></td></tr></table>")
    o.append(f'''	<tr>
		<td>{MAXP + 1}</td>
		<td colspan="7"><a href="?page=fleetTable&amp;galaxy={G}&amp;system={S}&amp;planet={MAXP + 1}&amp;planettype=1&amp;target_mission=15">Deep area of galaxy</a></td>
	</tr>
	<tr>
		<td colspan="6">(9 Existing planets)</td>
		<td colspan="2">
			<a class="tooltip" data-tooltip-content="{legend}">Legend</a>
		</td>
	</tr>
	<tr>
		<td colspan="3"><span id="missiles">25</span> Available Missiles</td>
		<td colspan="5"><span id="slots">1</span>/13 Fleet Slots</td>
	</tr>
	<tr>
		<td colspan="3">
			<span id="elementID210">102</span> Spy Probes
		</td>
		<td colspan="3">
			<span id="elementID209">0</span> Recycler
		</td>
		<td colspan="2">
			<span id="elementID219">0</span> Giga Recycler
		</td>
	</tr>
	<tr style="display: none;" id="fleetstatusrow">
		<th colspan="8">Fleets</th>
	</tr>
	</table>
	<script type="text/javascript">
		status_ok		= 'Done';
		status_fail		= 'Error';
		MaxFleetSetting = 3;
	</script>
''')
    return ''.join(o)

COMMENT = '''<!-- OGX FIXTURE: UPSTREAM-derived, NOT a real page. Hand-rendered by tools/gen_galaxy_fixtures.py from upstream 2Moons 1.8
     {tpl} + language/en. Invented but consistent data. The live GALAXYZ fork renders a DIFFERENT markup
     (see eu/pages/galaxy.html and galaxy-live-synthetic-system.html); use this file for semantics/edge cases only. -->'''

def full_page(page_qs, body_id, content, tpl, extra_script=''):
    src = open(LAYOUT, encoding='utf-8').read()
    head, rest = src.split('<div id="content">', 1)
    head = re.sub(r'<!-- OGX FIXTURE:.*?-->', COMMENT.format(tpl=tpl), head, flags=re.S)
    head = head.replace('<title>Overview - ', '<title>' + body_id.capitalize() + ' - ')
    head = head.replace('var queryString	= "page=overview";', f'var queryString	= "{page_qs}";')
    head = head.replace('<script src="scripts/game/overview.js"></script>', extra_script)
    head = head.replace('<body id="overview" class="full">', f'<body id="{body_id}" class="full">')
    tail = rest[rest.index('\n</div>\n<div class="clear"></div>'):]
    return head + '<div id="content">' + content + tail

def popup_page(title, content, tpl, script=''):
    return f'''<!DOCTYPE html>
<html lang="en" class="no-js">
<head>
	{COMMENT.format(tpl=tpl)}
	<title>{title} - Aeternum - GALAXYZ</title>
	<meta name="generator" content="2Moons 1.8.git">
	<meta http-equiv="content-type" content="text/html; charset=UTF-8">
	<script type="text/javascript">
	var ServerTimezoneOffset = 0;
	var serverTime 	= new Date(2026, 9, 30, 10, 5, 12);
	var startTime	= serverTime.getTime();
	var queryString	= "";
	var isPlayerCardActive	= "true";
	</script>
	<script type="text/javascript" src="./scripts/base/jquery.js?v=.git"></script>
	<script type="text/javascript" src="./scripts/game/base.js?v=.git"></script>
	{script}
</head>
<body id="" class="popup">
	<div id="tooltip" class="tip"></div>
<div id="content">{content}</div>
</body>
</html>
'''

def write(name, s):
    with open(os.path.join(FIX, name), 'w', encoding='utf-8') as f:
        f.write(s)
    print('wrote', name, len(s))

gx_script = '<script type="text/javascript" src="./scripts/game/galaxy.js?v=.git"></script>'
write('galaxy-upstream-system.html', full_page('page=galaxy', 'galaxy', galaxy_content(),
      'page.galaxy.default.tpl, class.GalaxyRows.php', gx_script))
write('galaxy-upstream-missile.html', full_page('page=galaxy', 'galaxy', galaxy_content('sendMissle', (2, 70, 4, 1)),
      'page.galaxy.default.tpl (action=sendMissle&galaxy=2&system=70&planet=4&type=1)', gx_script))
nodeut = '''<table class="table519">
	<tr>
		<th>Information</th>
	</tr>
	<tr>
		<td><p>You dont have enough deuterium to view the galaxy</p><p><a href="game.php?page=galaxy"><button>Back</button></a></p></td>
	</tr>
</table>
'''
write('galaxy-upstream-nodeuterium.html', full_page('page=galaxy', 'galaxy', nodeut,
      'error.default.tpl via ShowGalaxyPage.class.php:58-63 printMessage'))

# ------------------------------------------------------------------ statistics
PLAYERS = [(1, 3843, 'Jon Snow', 12, 'Nova Collective', 1834221, 0), (2, 3837, 'Flor', 7, 'Aeternum Guard', 1544020, 2),
           (3, 3836, 'Severian', 19, 'Night Watch', 990112, -1), (4, 4377, 'vodoleyko1992', 12, 'Nova Collective', 489, 5),
           (5, 3839, 'Txemin', 0, '', 412, -3)]
def stat_change(c, ally=False):
    if c == 0: return "<span style='color:#87CEEB'>*</span>"
    if c < 0: return f"<span style='color:red'>{c if ally else '-' + str(c)}</span>"
    return f"<span style='color:green'>+{c}</span>"

def stats_form(who, typ):
    def opts(d, sel):
        return '\n'.join(f'<option value="{k}"' + (' selected="selected"' if k == sel else '') + f'>{v}</option>' for k, v in d.items())
    return f'''<form name="stats" id="stats" method="post" action="">
	<table class="table519">
		<tr>
			<th>Statistics (Updated: 30. Oct 2026, 10:00:02)</th>
		</tr>
		<tr>
			<td>
				<label for="who">Show</label> <select name="who" id="who" onchange="$('#stats').submit();">{opts({1: 'Player', 2: 'Alliance'}, who)}</select>
				<label for="type">by</label> <select name="type" id="type" onchange="$('#stats').submit();">{opts({1: 'Points', 2: 'Fleets', 3: 'Research', 4: 'Buildings', 5: 'Defense'}, typ)}</select>
				<label for="range">in the positions</label> <select name="range" id="range" onchange="$('#stats').submit();">{opts({1: '1-100', 101: '101-200', 201: '201-300', 301: '301-400', 401: '401-500', 501: '501-600'}, 1)}</select>
			</td>
		</tr>
	</table>
</form>
'''
rows = ''.join(f'''<tr>
	<td><a class="tooltip" data-tooltip-content="{stat_change(c)}">{r}</a></td>
	<td><a href="#" onclick="return Dialog.Playercard({i}, '{n}');"{' style="color:lime"' if i == ME['id'] else ''}>{n}</a></td>
	<td>{'' if i == ME['id'] else f'<a href="#" onclick="return Dialog.PM({i});"><img src="{DP}img/m.gif" title="Write message" alt="Write message"></a>'}</td>
	<td>{(f'<a href="game.php?page=alliance&amp;mode=info&amp;id={a}">' + (f'<span style="color:#33CCFF">{an}</span>' if a == ME['ally_id'] else an) + '</a>') if a else '-'}</td>
	<td>{num(pts)}</td>
</tr>''' for r, i, n, a, an, pts, c in PLAYERS)
content = stats_form(1, 1) + '''<table class="table519">
<tr>
	<th style="width:60px;">Position</th>
	<th>Player</th>
	<th>&nbsp;</th>
	<th>Alliance</th>
	<th>Points</th>
</tr>
''' + rows + '\n</table>\n'
write('galaxy-upstream-statistics-players.html', full_page('page=statistics', 'statistics', content,
      'page.statistics.default.tpl + shared.statistics.playerTable.tpl'))
ALLYS = [(1, 12, 'Nova Collective', 8, 2401200, 1), (2, 7, 'Aeternum Guard', 14, 2210000, -1), (3, 19, 'Night Watch', 1, 990112, 0)]
rows = ''.join(f'''<tr>
	<td><a class="tooltip" data-tooltip-content="{stat_change(c, True)}">{r}</a></td>
	<td><a href="game.php?page=alliance&amp;mode=info&amp;id={i}" target="ally"{' style="color:lime"' if i == ME['ally_id'] else ''}>{n}</a></td>
	<td>{m}</td>
	<td>{num(p)}</td>
	<td>{num(p // m)}</td>
</tr>''' for r, i, n, m, p, c in ALLYS)
content = stats_form(2, 1) + '''<table class="table519">
<tr>
	<th style="width:60px;">Position</th>
	<th>Alliance</th>
	<th>Members</th>
	<th>Points</th>
	<th>per Member</th>
</tr>
''' + rows + '\n</table>\n'
write('galaxy-upstream-statistics-alliances.html', full_page('page=statistics', 'statistics', content,
      'page.statistics.default.tpl + shared.statistics.allianceTable.tpl'))

# ------------------------------------------------------------------ search (ajax fragments: layout.ajax.tpl = content only)
SR = [(3843, 'Jon Snow', 12, 'Nova Collective', 'Castle Black', (2, 70, 9), 1), (4359, 'terror', 0, '', 'Little One', (2, 70, 8), 530)]
rows = ''.join(f'''	<tr>
		<td><a href="#" onclick="return Dialog.Playercard({i});">{n}</a></td>
		<td><a href="#" onclick="return Dialog.PM({i});" title="Write message"><img src="{DP}img/m.gif"/></a>&nbsp;<a href="#" onclick="return Dialog.Buddy({i});" title="Buddy request"><img src="{DP}img/b.gif" border="0"></a></td>
		<td>{f'<a href="game.php?page=alliance&amp;mode=info&amp;id={a}">{an}</a>' if an else '-'}</td>
		<td>{pn}</td>
		<td><a href="game.php?page=galaxy&amp;galaxy={c[0]}&amp;system={c[1]}">[{c[0]}:{c[1]}:{c[2]}]</a></td>
		<td>{rk}</td>
	</tr>
''' for i, n, a, an, pn, c, rk in SR)
frag = '''<!-- OGX FIXTURE: UPSTREAM-derived ajax fragment of game.php?page=search&mode=result&type=playername&search=o&ajax=1
     (page.search.result.default.tpl, layout.ajax.tpl). NOT real. -->
<table style="width:760px" id="resulttable">
	<tr>
		<th>Name</th>
		<th>&nbsp;</th>
		<th>Alliance</th>
		<th>Planet</th>
		<th>Coordinates</th>
		<th>Position</th>
	</tr>
''' + rows + '</table>\n'
write('galaxy-upstream-search-players.html', frag)
frag = '''<!-- OGX FIXTURE: UPSTREAM-derived ajax fragment of game.php?page=search&mode=result&type=allytag&search=A&ajax=1
     (page.search.result.ally.tpl). NOT real. -->
<table style="width:760px" id="resulttable">
	<tr>
		<th>Tag</th>
		<th>Name</th>
		<th>Members</th>
		<th>Points</th>
	</tr>
	<tr>
		<td><a href="game.php?page=alliance&amp;mode=info&amp;tag=AET">AET</a></td>
		<td>Aeternum Guard</td>
		<td>14</td>
		<td>1.544.020</td>
	</tr>
	<tr>
		<td><a href="game.php?page=alliance&amp;mode=info&amp;tag=NOVA">NOVA</a></td>
		<td>Nova Collective</td>
		<td>8</td>
		<td>1.834.221</td>
	</tr>
</table>
'''
write('galaxy-upstream-search-alliances.html', frag)

# ------------------------------------------------------------------ playerCard (popup)
pc = f'''<table style="width:95%">
	<tr>
		<th colspan="3">Player Profile</th>
		</tr>
	<tr>
		<td style="width:40%">Name</td>
		<td colspan="2">Jon Snow</td>
	</tr>
	<tr>
		<td>Homeplanet</td>
		<td colspan="2">Castle Black <a href="#" onclick="parent.location = 'game.php?page=galaxy&amp;galaxy=2&amp;system=70';return false;">[2:70:9]</a></td>
	</tr>
	<tr>
		<td>Alliance</td>
		<td colspan="2"><a href="#" onclick="parent.location = 'game.php?page=alliance&amp;mode=info&amp;id=12';return false;">Nova Collective</a></td>
	</tr>
	<tr>
		<th>&nbsp;</th>
		<th>Points</th>
		<th>Ranking</th>
	</tr>
	<tr>
		<td>Buildings</td>
		<td>612.004</td>
		<td>3</td>
	</tr>
	<tr>
		<td>Research</td>
		<td>301.220</td>
		<td>1</td>
	</tr>
	<tr>
		<td>Fleet</td>
		<td>800.512</td>
		<td>1</td>
	</tr>
	<tr>
		<td>Defense</td>
		<td>120.485</td>
		<td>7</td>
	</tr>
	<tr>
		<td>Total</td>
		<td>1.834.221</td>
		<td>1</td>
	</tr>
	<tr>
		<th colspan="3">Fight statistics</th>
	</tr>
	<tr>
		<td>&nbsp;</td>
		<td>Fights</td>
		<td>Percentage</td>
	</tr>
	<tr>
		<td>Victories</td>
		<td>42</td>
		<td>84 %</td>
	</tr>
	<tr>
		<td>Draws</td>
		<td>3</td>
		<td>6 %</td>
	</tr>
	<tr>
		<td>Losses</td>
		<td>5</td>
		<td>10 %</td>
	</tr>
	<tr>
		<td>Total fights</td>
		<td>50</td>
		<td>100 %</td>
	</tr>
	<tr>
		<th colspan="3">Jon Snow was involved in fights:</th>
	</tr>
	<tr>
		<td>Units shot</td>
		<td colspan="2">1.250.300</td>
	</tr>
	<tr>
		<td>Units lost</td>
		<td colspan="2">80.120</td>
	</tr>
	<tr>
		<td>Metal debris</td>
		<td colspan="2">32.000.000</td>
	</tr>
	<tr>
		<td>Crystal debris</td>
		<td colspan="2">14.500.000</td>
	</tr>
	<tr>
		<th colspan="3">Various</th>
	</tr>
	<tr>
		<td><a href="#" onclick="return Dialog.Buddy(3843)">Buddy request</a></td><td colspan="2"><a href="#" onclick="return Dialog.PM(3843);" title="Write message">Write message</a></td>
	</tr>
</table>
'''
write('galaxy-upstream-playercard.html', popup_page('Player Profile', pc, 'page.playerCard.default.tpl (game.php?page=playerCard&id=3843, popup)'))

# ------------------------------------------------------------------ phalanx (popup)
ph = '''<table width="90%">
<tr>
    <th colspan="2">Investigate position [2:70:2] (Arrakis)</th>
</tr>
<tr>
    <th colspan="2">Fleet in movement</th>
</tr>
	<tr>
		<td id="fleettime_0" class="fleets" data-fleet-end-time="1793349900" data-fleet-time="2483">00:00:00</td>
		<td><span class="flight attack">A <a href="#" onclick="return false;" data-tooltip-content="&lt;table style='width:200px'&gt;&lt;tr&gt;&lt;td style='width:50%;color:white'&gt;Light Fighter:&lt;/td&gt;&lt;td style='width:50%;color:white'&gt;1.200&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;" class="tooltip attack">fleet</a><span class="textForBlind"> (1200 Light Fighter)</span> from player Flor from Planet Arrakis <a href="game.php?page=galaxy&amp;galaxy=2&amp;system=70" class="attack">[2:70:2]</a> is on its way to the Planet Ice <a href="game.php?page=galaxy&amp;galaxy=2&amp;system=74" class="attack">[2:74:11]</a>. Mission: Attack</span></td>
	</tr>
	<tr>
		<td id="fleettime_1" class="fleets" data-fleet-end-time="1793353500" data-fleet-time="6083">00:00:00</td>
		<td><span class="return attack">A <a href="#" onclick="return false;" data-tooltip-content="&lt;table style='width:200px'&gt;&lt;tr&gt;&lt;td style='width:50%;color:white'&gt;Light Fighter:&lt;/td&gt;&lt;td style='width:50%;color:white'&gt;1.200&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;" class="tooltip attack">fleet</a><span class="textForBlind"> (1200 Light Fighter)</span> from player Flor returns from Planet Ice <a href="game.php?page=galaxy&amp;galaxy=2&amp;system=74" class="attack">[2:74:11]</a> to Planet Arrakis <a href="game.php?page=galaxy&amp;galaxy=2&amp;system=70" class="attack">[2:70:2]</a>. Mission: Attack</span></td>
	</tr>
</table>
'''
write('galaxy-upstream-phalanx.html', popup_page('Phalanx', ph, 'page.phalanx.default.tpl + class.FlyingFleetsTable.php phalanx mode (game.php?page=phalanx&galaxy=2&system=70&planet=2&planettype=1&ajax=1); fleet texts approximated',
      '<script type="text/javascript" src="./scripts/game/phalanx.js?v=.git"></script>'))

# ------------------------------------------------------------------ live-synthetic galaxy (REAL skeleton + GUESSED foreign rows)
real = open(REAL_GALAXY, encoding='utf-8').read()
def live_row(p, r):
    """GUESS of a foreign occupied row in the live markup (same skeleton as the REAL own rows, gx:724-773)."""
    u = r['user']; cls = r['user']['cls']
    li = []
    li.append(f"&lt;li&gt;&lt;a href=&#39;javascript:doit(6,{r['pid']});&#39;&gt;Espionage&lt;/a&gt;&lt;/li&gt;" if r['missions'][6] else '&lt;li&gt;&lt;/li&gt;')
    li.append(f"&lt;li&gt;&lt;a href=&#39;javascript:OpenPopup(&amp;quot;?page=phalanx&amp;amp;galaxy={G}&amp;amp;system=68&amp;amp;planet={p}&amp;amp;planettype=1&amp;quot;, &amp;quot;&amp;quot;, 640, 510);&#39;&gt;Phalanx&lt;/a&gt;&lt;/li&gt;" if r['phalanx'] else '&lt;li&gt;&lt;/li&gt;')
    for mid, nm in ((1, 'Attack'), (2, 'ACS Attack'), (5, 'Hold')):
        ok = r['missions'].get(mid, 0) if mid != 2 else 0
        li.append(f"&lt;li&gt;&lt;a href=&#39;?page=fleetTable&amp;amp;galaxy={G}&amp;amp;system=68&amp;amp;planet={p}&amp;amp;planettype=1&amp;amp;target_mission={mid}&#39;&gt;{nm}&lt;/a&gt;&lt;/li&gt;" if ok else '&lt;li&gt;&lt;/li&gt;')
    li.append('&lt;li&gt;&lt;/li&gt;')  # deploy (own only)
    li.append(f"&lt;li&gt;&lt;a href=&#39;?page=fleetTable&amp;amp;galaxy={G}&amp;amp;system=68&amp;amp;planet={p}&amp;amp;planettype=1&amp;amp;target_mission=3&#39;&gt;Transport&lt;/a&gt;&lt;/li&gt;")
    li.append(f"&lt;li&gt;&lt;a href=&#39;?page=galaxy&amp;amp;action=sendMissle&amp;amp;galaxy={G}&amp;amp;system=68&amp;amp;planet={p}&#39;&gt;Missile Attack&lt;/a&gt;&lt;/li&gt;" if r['missions'][10] else '&lt;li&gt;&lt;/li&gt;')
    ptip = (f"&lt;div style=&#39;&#39; class=&#39;htmlTooltip galaxyTooltip&#39;&gt;&lt;h1&gt;Planet {r['name']}&lt;/h1&gt;&lt;div class=&#39;splitLine&#39;&gt;&lt;/div&gt;&lt;ul class=&#39;ListImage&#39;&gt;&lt;li&gt;&lt;span id=&#39;pos-planet&#39;&gt;[{G}:68:{p}]&lt;/span&gt;&lt;/li&gt;&lt;li&gt;&lt;img class=&#39;planetTooltip jungle_2&#39; src=&#39;./styles/theme/gow/planeten/small/s_{r['image']}.gif&#39;  alt=&#39;&#39; height=&#39;33&#39;&gt;&lt;/li&gt;&lt;/ul&gt;\n"
            "\t\t\t&lt;ul class=&#39;ListLinks&#39;&gt;\n" + ''.join('\t\t\t' + x + '\n' for x in li) + "\t\t\t\t&lt;/ul&gt;\n\t\t\t\t&lt;/div&gt;\n\t\t\t")
    moon = ''
    if r['moon']:
        mo = r['moon']
        mtip = (f"&lt;div class=&#39;htmlTooltip galaxyTooltip&#39;&gt;&lt;h1&gt;Moon {mo['name']}&lt;/h1&gt;&lt;div class=&#39;splitLine&#39;&gt;&lt;/div&gt;&lt;table&gt;&lt;tr&gt;&lt;td&gt;Diameter&lt;/td&gt;&lt;td&gt;{num(mo['diameter'])}&lt;/td&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;Temperatura&lt;/td&gt;&lt;td&gt;{mo['temp']}&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;"
                f"&lt;ul class=&#39;ListLinks&#39;&gt;&lt;li&gt;&lt;a href=&#39;javascript:doit(6,{mo['id']});&#39;&gt;Espionage&lt;/a&gt;&lt;/li&gt;&lt;/ul&gt;&lt;/div&gt;")
        moon = f'\n\t\t\t<a class="tooltipRight tooltipClose js_hideTipOnMobile" title="{mtip}"><img src="./styles/theme/gow/planeten/small/s_mond.gif" height="22" width="22" alt="{mo["name"]}"></a>\n\t\t'
    debris = ''
    if r['debris']:
        d = r['debris']
        dtip = (f"&lt;div class=&#39;htmlTooltip galaxyTooltip&#39;&gt;&lt;h1&gt;Debris Field [{G}:68:{p}]&lt;/h1&gt;&lt;div class=&#39;splitLine&#39;&gt;&lt;/div&gt;&lt;table&gt;&lt;tr&gt;&lt;td&gt;Metal:&lt;/td&gt;&lt;td&gt;{num(d['metal'])}&lt;/td&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;Crystal:&lt;/td&gt;&lt;td&gt;{num(d['crystal'])}&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;"
                f"&lt;ul class=&#39;ListLinks&#39;&gt;&lt;li&gt;&lt;a href=&#39;javascript:doit(8, {r['pid']});&#39;&gt;Recycle&lt;/a&gt;&lt;/li&gt;&lt;/ul&gt;&lt;/div&gt;")
        debris = f'\n\t\t\t<a class="tooltipRight tooltipClose js_hideTipOnMobile" title="{dtip}"><img src="./styles/theme/gow/planeten/debris.gif" height="22" width="22" alt=""></a>\n         \t\t'
    utip = (f"\n\t\t\t&lt;div id=&#39;player&#39; style=&#39;&#39; class=&#39;htmlTooltip galaxyTooltip&#39;&gt;\n\t\t\t&lt;h1&gt;Player: &lt;span&gt;{u['name']}&lt;/span&gt;&lt;/h1&gt;\n\t\t\t&lt;div class=&#39;splitLine&#39;&gt;&lt;/div&gt;\n\t\t\t&lt;ul class=&#39;ListLinks&#39;&gt;\n\t\t\t\t&lt;li class=&#39;rank&#39;&gt;Ranking: {u['rank']}&lt;/li&gt;\n"
            + (f"\t\t\t\t&lt;li&gt;&lt;a href=&#39;#&#39; onclick=&#39;return Dialog.Buddy({u['id']})&#39;&gt;Friend request&lt;/a&gt;&lt;/li&gt;\n" if not r['buddy'] else '')
            + f"\t\t\t\t&lt;li&gt;&lt;a href=&#39;#&#39; onclick=&#39;return Dialog.Playercard({u['id']});&#39;&gt;Player profile&lt;/a&gt;&lt;/li&gt;\n"
            f"\t\t\t\t\t\t&lt;li&gt;&lt;a href=&#39;?page=statistics&amp;amp;who=1&amp;amp;start={u['rank']}&#39;&gt;Stats&lt;/li&gt;&lt;/ul&gt;\n\t\t\t&lt;/div&gt;")
    ucls = ' '.join('galaxy-username-' + c for c in cls)
    short = ''
    if cls:
        short = '<span>(</span>' + '&nbsp;'.join(f'<span class="galaxy-short-{c} galaxy-short">{SHORT[c]}</span>' for c in cls) + '<span>)</span>'
    ally = ''
    if r['ally']:
        a = r['ally']
        atip = (f"&lt;div class=&#39;htmlTooltip galaxyTooltip&#39;&gt;&lt;h1&gt;Alliance {a['name']} {a['members']} Members&lt;/h1&gt;&lt;div class=&#39;splitLine&#39;&gt;&lt;/div&gt;&lt;ul class=&#39;ListLinks&#39;&gt;&lt;li&gt;&lt;a href=&#39;?page=alliance&amp;amp;mode=info&amp;amp;id={a['id']}&#39;&gt;Page of the Alliance&lt;/a&gt;&lt;/li&gt;&lt;li&gt;&lt;a href=&#39;?page=statistics&amp;amp;start={a['rank']}&amp;amp;who=2&#39;&gt;Stats&lt;/a&gt;&lt;/li&gt;&lt;/ul&gt;&lt;/div&gt;")
        acls = ' '.join('galaxy-alliance-' + c for c in a['cls'])
        ally = f'\n\t\t\t<a class="tooltipRight tooltipClose js_hideTipOnMobile" title="{atip}"><span class="{acls} galaxy-alliance">{a["tag"]}</span></a>'
    act = r['action']; acts = ''
    if act:
        if act['esp']: acts += f'<a href="javascript:doit(6,{r["pid"]},{{&quot;210&quot;:&quot;1&quot;}})"><img src="./styles/theme/gow/img/e.gif" title="Spying" alt=""></a>'
        if act['message']: acts += f'<a href="#" onclick="return Dialog.PM({u["id"]})"><img src="./styles/theme/gow/img/m.gif" title="Write message" alt=""></a>'
        if act['buddy']: acts += f'<a href="#" onclick="return Dialog.Buddy({u["id"]})"><img src="./styles/theme/gow/img/b.gif" title="Friend request" alt=""></a>'
        if act['missle']: acts += f'<a href="?page=galaxy&amp;action=sendMissle&amp;galaxy={G}&amp;system=68&amp;planet={p}&amp;type=1"><img src="./styles/theme/gow/img/r.gif" title="Missile attack" alt=""></a>'
    return f'''		<tr class="row">
    		<!-- OGX GUESS: foreign row, markup not seen live -->
    		<td class="position">
			<span style="color:#FC4242">{p}</span>
		</td>
        		<td class="microplanet1">
			<a class="tooltipRight tooltipClose js_hideTipOnMobile" title="{ptip}">
				<img src="./styles/theme/gow/planeten/small/s_{r['image']}.gif" height="30" width="30" alt="">
			</a>
		</td>
		<td align="center" class="planetname1" style="white-space: nowrap;">{r['name']} {r['act']}</td>
		<td class="moon" style="white-space: nowrap;">{moon}
					</td>
		<td class="spacer02" style="white-space: nowrap;">
		</td>

		<td class="debris" style="white-space: nowrap;">{debris}
         		</td>

		<td class="playername">
			<a class="tooltipRight tooltipClose js_hideTipOnMobile" title="{utip}">
				<span class="{ucls} galaxy-username">{esc(u['name'])}</span>
				{short}
							</a>
		</td>
		<td class="spacer03"></td>
		<td class="allytag" style="white-space: nowrap;">{ally}
			 		</td>
		<td class="spacer04"></td>
		<td class="action" colspan="2" style="white-space: nowrap;">
			 {acts}					</td>
		</tr>
'''

rows_re = re.compile(r'(?:\t\t|    \t)<tr class="row">.*?</tr>\n', re.S)
blocks = rows_re.findall(real)
assert len(blocks) == 15, len(blocks)
live_rows = {1: ROWS[2], 2: ROWS[4], 3: ROWS[6], 4: ROWS[7], 9: ROWS[8], 10: ROWS[9], 11: ROWS[5]}
new = real
for p, r in live_rows.items():
    new = new.replace(blocks[p - 1], live_row(p, r), 1)
new = new.replace('<!-- saved from url=(0047)https://ogamex.eu/Aeternum/game.php?page=galaxy -->',
                  '<!-- saved from url=(0047)https://ogamex.eu/Aeternum/game.php?page=galaxy -->\n<!-- OGX FIXTURE: LIVE-SYNTHETIC. Skeleton, header, own rows 5-8 and empty rows are the REAL eu/pages/galaxy.html (2026-10-30). '
                  'Rows 1,2,3,4,9,10,11 are GUESSED foreign rows (moon, debris, status, alliance, actions) written in the live style by tools/gen_galaxy_fixtures.py; '
                  'their markup has NOT been seen live. -->', 1)
write('galaxy-live-synthetic-system.html', new)

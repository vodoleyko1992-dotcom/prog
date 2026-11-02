# python3 -I gen_fixtures.py <out fixtures dir>
# Renders fixtures/mechanics-upstream-empire.html from 2Moons styles/templates/game/page.empire.default.tpl (inside layout.full.tpl's
# <div id="content">) with plausible data: 2 planets + 1 moon (upstream lists moons as extra columns; the REAL page had no moon).
import sys, os

out = sys.argv[1]
NAMES = {901: 'Metal', 902: 'Crystal', 903: 'Deuterium', 911: 'Energy', 1: 'Metal Mine', 2: 'Crystal Mine', 3: 'Deuterium Refinery',
         4: 'Solar Power plant', 6: 'University', 12: 'Deuterium Power Plant', 14: 'Robot Factory', 15: 'Nanite Factory', 21: 'Shipyard',
         22: 'Metal Storage', 23: 'Crystal Storage', 24: 'Deuterium Storage', 31: 'Research Lab', 33: 'Terraformer', 34: 'Alliance Depot',
         41: 'Moon base', 42: 'Phalax Sensor', 43: 'Jumpgate', 44: 'Missile Silo', 106: 'Spy Technology', 108: 'Computer Technology',
         109: 'Weapons Technology', 110: 'Shield Technology', 111: 'Armour Technology', 113: 'Energy Technology', 114: 'Hyperspace Technology',
         115: 'Combustion Engine', 117: 'Impulse Engine', 118: 'Hyperspace Engine', 120: 'Laser Technology', 121: 'Ion Technology',
         122: 'Plasma Technology', 123: 'Intergalactic Research Network', 124: 'Expedition Research', 131: 'Mineral Research',
         132: 'Semi-Crystals Research', 133: 'Fuel Research', 199: 'Graviton Research', 202: 'Light Cargo', 203: 'Heavy Cargo',
         204: 'Light Fighter', 205: 'Heavy Fighter', 206: 'Cruiser', 207: 'Battleship', 208: 'Colony Ship', 209: 'Recycler', 210: 'Spy Probe',
         211: 'Planet Bomber', 212: 'Solar Satellite', 213: 'Star Fighter', 214: 'Battle Fortress', 215: 'Battle Cruiser', 216: 'Black Moon',
         217: 'Battle Transporter', 218: 'Avatar', 219: 'Battle Recycler', 220: 'Dark Matter Collector', 401: 'Missile Launcher',
         402: 'Light Laser Turret', 403: 'Heavy Laser Turret', 404: 'Gauss Cannon', 405: 'Ion Cannon', 406: 'Plasma Cannon',
         407: 'Small Shield Dome', 408: 'Large Shield Dome', 409: 'Atmospheric Shield', 410: 'Gravitons Cannon', 411: 'Orbital Defence Platform'}
BUILD = [1, 2, 3, 4, 6, 12, 14, 15, 21, 22, 23, 24, 31, 33, 34, 41, 42, 43, 44]          # upstream $reslist['build'] (no fork 71-73)
TECH = [106, 108, 109, 110, 111, 113, 114, 115, 117, 118, 120, 121, 122, 123, 124, 131, 132, 133, 199]
FLEET = list(range(202, 221))
DEF = list(range(401, 412))
bodies = [  # current planet first (ShowImperiumPage.class.php:56)
    dict(id=254102, name='Главная планета', image='dschjungelplanet07', g=2, s=68, p=5, fc=259, fm=405,
         res={901: 1470603595, 902: 254752401, 903: 363277462, 911: 49544},
         lv={1: 38, 2: 35, 3: 33, 4: 30, 14: 20, 15: 10, 21: 18, 22: 18, 23: 17, 24: 16, 31: 21, 33: 1},
         sh={208: 2, 209: 8290, 210: 102, 212: 797}, de={401: 1200, 402: 800, 407: 1}),
    dict(id=254104, name='Colony', image='normaltempplanet02', g=2, s=68, p=7, fc=78, fm=433,
         res={901: 12862389, 902: 6267471, 903: 2694100, 911: 622},
         lv={1: 15, 2: 11, 3: 6, 4: 10, 14: 10, 15: 1, 21: 1, 22: 8, 23: 6, 24: 5, 31: 5}, sh={}, de={}),
    dict(id=254110, name='Moon', image='mond', g=2, s=68, p=5, fc=4, fm=7,   # moon: field_max 1 + 2 x Moon base 3
         res={901: 1500000, 902: 800000, 903: 0, 911: 0}, lv={14: 2, 21: 1, 41: 2}, sh={202: 50}, de={}),
]
research = {106: 12, 108: 12, 109: 2, 110: 7, 111: 6, 113: 12, 114: 8, 115: 12, 117: 7, 118: 4, 120: 10, 121: 5, 122: 7, 123: 5, 124: 6, 131: 8, 133: 8}
num = lambda n: f'{n:,}'.replace(',', '.')     # pretty_number: number_format($n, 0, ',', '.')
cs = len(bodies) + 2
L = []
a = L.append
a('<table>\n\t<tbody>')
a(f'\t\t<tr>\n\t\t\t<th colspan="{cs}">Empire</th>\n\t\t</tr>')
a('\t\t<tr>\n\t\t\t<td style="width:100px">Planet</td>\n\t\t\t<td style="width:100px;font-size: 50px;">&Sigma;</td>')
for b in bodies:
    a(f'\t\t\t<td style="width:100px"><a href="game.php?page=overview&amp;cp={b["id"]}"><img width="80" height="80" border="0" src="./styles/theme/gow/planeten/small/s_{b["image"]}.jpg"></a></td>')
a('\t\t</tr>')
a('\t\t<tr>\n\t\t\t<td>Name</td>\n\t\t\t<td>Total</td>' + ''.join(f'\n\t\t\t\t<td>{b["name"]}</td>' for b in bodies) + '\n\t\t</tr>')
a('\t\t<tr>\n\t\t\t<td>Coordinates</td>\n\t\t\t<td>-</td>' + ''.join(
    f'\n\t\t\t\t<td><a href="game.php?page=galaxy&amp;galaxy={b["g"]}&amp;system={b["s"]}">[{b["g"]}:{b["s"]}:{b["p"]}]</a></td>' for b in bodies) + '\n\t\t</tr>')
a('\t\t<tr>\n\t\t\t<td>Fields</td>\n\t\t\t<td>-</td>' + ''.join(f'\n\t\t\t\t<td>{b["fc"]} / {b["fm"]}</td>' for b in bodies) + '\n\t\t</tr>')

def section(title, ids, get, total=True):
    a(f'\t\t<tr>\n\t\t\t<th colspan="{cs}">{title}</th>\n\t\t</tr>')
    for i in ids:
        vals = [get(b, i) for b in bodies]
        a(f'\t\t<tr>\n\t\t\t<td>{NAMES[i]}</td>\n\t\t\t<td>{num(sum(vals))}</td>' + ''.join(f'\n\t\t\t\t<td>{num(v)}</td>' for v in vals) + '\n\t\t</tr>')

section('Resources', [901, 902, 903, 911], lambda b, i: b['res'].get(i, 0))
section('Buildings', BUILD, lambda b, i: b['lv'].get(i, 0))
a(f'\t\t<tr>\n\t\t\t<th colspan="{cs}">Technologies</th>\n\t\t</tr>')
for i in TECH:   # upstream tpl: Σ column = the level, and the same level repeated per body (page.empire.default.tpl:63-71)
    v = research.get(i, 0)
    a(f'\t\t<tr>\n\t\t\t<td>{NAMES[i]}</td>\n\t\t\t<td>{num(v)}</td>' + ''.join(f'\n\t\t\t\t<td>{num(v)}</td>' for _ in bodies) + '\n\t\t</tr>')
section('Ships', FLEET, lambda b, i: b['sh'].get(i, 0))
section('Defenses', DEF, lambda b, i: b['de'].get(i, 0))
a('\t</tbody>\n</table>')

html = f'''<!DOCTYPE html>
<!-- UPSTREAM-DERIVED FIXTURE, NOT A REAL PAGE. Rendered by tools/mechanics/gen_fixtures.py from 2Moons styles/templates/game/page.empire.default.tpl
     inside layout.full.tpl <div id="content">, with plausible data: 2 planets + 1 moon (moons are columns too upstream).
     The REAL GALAXYZ page (fixtures/mechanics-real-imperium.html) wraps the same rows in div.imparatorluk_tab.mainRS > table.empire.statList.list,
     uses 38x38 .gif images and adds the fork-only conveyor rows 71-73. -->
<html lang="en"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<title>Empire - Aeternum (New) - Aeterum (New)</title>
<meta name="generator" content="GALAXYZ 1.8.git">
<script type="text/javascript">var queryString = "page=imperium";</script>
</head>
<body id="imperium" class="full">
<div id="content">{chr(10).join(L)}
</div>
</body></html>
'''
open(os.path.join(out, 'mechanics-upstream-empire.html'), 'w', encoding='utf-8').write(html)
print('wrote', os.path.join(out, 'mechanics-upstream-empire.html'))

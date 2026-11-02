#!/usr/bin/env python3
"""Generate layout-live-synthetic-*.html from the REAL eu/pages/overview.html.

The skeleton (topnav, #resTable, #menuTable, event box, #planet, construction boxes, #rechts planet list, footer)
is the real GALAXYZ markup. Additions that were never seen on a real page are marked with <!-- GUESS ... --> comments:
moon option text, a.moonlink, #moon content, active construction box. Added fleet events reuse the REAL event markup
with upstream (class.FlyingFleetsTable.php) texts/classes.
Usage: python3 -I tools/gen_layout_fixtures.py   (cwd = specs/galaxyz)
"""
import os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REAL = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'eu', 'pages', 'overview.html'))
OUT = os.path.join(HERE, 'fixtures')

src = open(REAL, encoding='utf-8').read()


def sub1(s, old, new):
    if old not in s:
        sys.exit('pattern not found: ' + old[:80])
    return s.replace(old, new, 1)


HEADER = ('<!DOCTYPE html>\n<!-- OGX FIXTURE: SYNTHETIC. Skeleton copied from the REAL page eu/pages/overview.html '
          '(GALAXYZ 1.8.git, ogamex.eu/Aeternum, saved 2026-10-30). Player renamed. Parts marked GUESS were never seen '
          'on a real page (moons, active construction box) and follow upstream 2Moons semantics. Variant: %s -->\n')

MOON_OPTION = '\n<!-- GUESS: moon option text = upstream "<name> (Moon) [g:s:p]" (getNavigationData) -->\n<option value="254110"%s>Moon (Moon) [2:68:5]</option>\n'

MOONLINK = '''
							<!-- GUESS: moon entry in the live planet list (never seen on a real page) -->
							<a href="https://ogamex.eu/Aeternum/game.php?page=overview&amp;cp=254110" class="moonlink %s tooltipLeft tooltipClose js_hideTipOnMobile" title="
				&lt;div style=&#39;text-align:left&#39;&gt;
				&lt;b&gt;Moon [2:68:5]&lt;/b&gt;&lt;br&gt;
				-8°C to 32°C&lt;br&gt;
				8.888 km (1 / 1)&lt;br&gt;
				&lt;a href=&#39;game.php?page=overview&amp;cp=254110&#39;&gt;Overview&lt;/a&gt;&lt;br&gt;
				&lt;/div&gt;">
								<img class="icon-moon" src="./1_files/s_mond.gif">
							</a>
'''

HOSTILE_EVENT = '''
            <div id="OvfleetContent">
            <span style="text-align:center">
                <a class="OvfleetButton" href="javascript:eventHeader(&#39;.allFleetsEvent&#39;);" title="Activities"><img src="./1_files/dot.gif" width="15" height="15" alt=""></a>
            </span>
        </div>
                <div class="allFleetsEvent">
            <div id="OvfleetEvents" class="OvfleetEvents_" style="padding:5px 10px;background-color:#000">
                <span id="fleettime_1793348917397001" class="fleets" data-fleet-end-time="1793348917" data-fleet-time="1500">00:25:00</span>
				<span class="fleet_static_time" data-fleet-end-time="10:28:37" "="">10:28:37</span>
				<span><span class="flight attack">A hostile <a href="https://ogamex.eu/Aeternum/game.php?page=overview#" data-tooltip-content="&lt;table style=&#39;width:200px&#39;&gt;&lt;tr&gt;&lt;td style=&#39;width:50%;color:white&#39;&gt;Light Fighter:&lt;/td&gt;&lt;td style=&#39;width:50%;color:white&#39;&gt;1.200&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;" class="tooltip attack">Fleets</a><span class="textForBlind"> (1200 Light Fighter)</span> from player Raider <a href="https://ogamex.eu/Aeternum/game.php?page=overview#" onclick="return Dialog.PM(777)">[PM]</a> from Planet Raidbase <a href="https://ogamex.eu/Aeternum/game.php?page=galaxy&amp;galaxy=3&amp;system=120" class="attack">[3:120:9]</a> reached the Planet Главная планета <a href="https://ogamex.eu/Aeternum/game.php?page=galaxy&amp;galaxy=2&amp;system=68" class="attack">[2:68:5]</a>. Mission: Attack</span></span>
            </div>
        </div>
    '''

ACTIVE_BUILD = '''<!-- GUESS: active construction box markup (only the idle variant td.idle is REAL) -->
                        <td class="building">
                            <a href="https://ogamex.eu/Aeternum/game.php?page=buildings">Metal Mine (40)</a><br>
                            <span class="timer" data-time="3600">01:00:00</span>
                        </td>'''

IDLE_BUILD_RE = re.compile(r'<td colspan="2" class="idle">\s*<a class="tooltipTop  js_hideTipOnMobile" title="[^"]*" href="https://ogamex.eu/Aeternum/game.php\?page=buildings">.*?</td>', re.S)


def base(variant):
    s = src.replace('<!DOCTYPE html>\n', HEADER % variant, 1)
    s = s.replace('vodoleyko1992', 'TestPlayer')
    return s


def first_smallplanet_end(s):
    i = s.index('class="planet-name">Главная планета</span>')
    return s.index('</a>', i) + len('</a>')


# --- variant 1: current = planet with a moon, hostile attack incoming, building queue active ---
s = base('current body = planet 254102 (has moon 254110); hostile attack incoming; building queue active')
s = sub1(s, '<option value="254105">Colony [2:68:8]</option>\n', '<option value="254105">Colony [2:68:8]</option>' + MOON_OPTION % '')
j = first_smallplanet_end(s)
s = s[:j] + MOONLINK % '' + s[j:]
s = re.sub(r'<div id="moon">&nbsp;\s*</div>',
           '<div id="moon"><!-- GUESS: upstream page.overview.default.tpl moon cell -->'
           '<a href="game.php?page=overview&amp;cp=254110&amp;re=0" title="Moon"><img src="./styles/theme/gow/planeten/mond.jpg" height="50" width="50" alt="Moon (Moon)"></a><br>Moon (Moon)</div>',
           s, count=1)
k = s.index('\n</div>\n<style type="text/css">\n    .allFleetsEvent')
s = s[:k] + HOSTILE_EVENT + s[k:]
s, n = IDLE_BUILD_RE.subn(ACTIVE_BUILD, s, count=1)
assert n == 1
open(os.path.join(OUT, 'layout-live-synthetic-planet.html'), 'w', encoding='utf-8').write(s)

# --- variant 2: current = the moon ---
s = base('current body = moon 254110 of planet 254102')
s = sub1(s, '<option value="254102" selected="selected">', '<option value="254102">')
s = sub1(s, '<option value="254105">Colony [2:68:8]</option>\n', '<option value="254105">Colony [2:68:8]</option>' + MOON_OPTION % ' selected="selected"')
s = sub1(s, 'class="planetlink  active active-planet planetPic', 'class="planetlink   planetPic')
j = first_smallplanet_end(s)
s = s[:j] + MOONLINK % 'active' + s[j:]
s = re.sub(r'(<td id="planetImage">\s*<img src=")[^"]*(")', r'\1./1_files/s_mond.gif\2', s, count=1)
s = sub1(s, '<span id="planetNameHeader">Главная планета</span>', '<span id="planetNameHeader">Moon</span>')
s = re.sub(r'<span id="diameterContentField">.*?</span>',
           '<span id="diameterContentField">8.888 km (<a class="tooltip" data-tooltip-content="Fields used">1</a> / <a class="tooltip" data-tooltip-content="Max. Permitted fields">1</a>\n                                    Fields)</span>', s, count=1, flags=re.S)
s = re.sub(r'<span id="temperatureContentField">.*?</span>', '<span id="temperatureContentField">Approximately -8°C\n                                    to 32°C</span>', s, count=1, flags=re.S)
s = re.sub(r'(<span id="positionContentField"><a href="[^"]*">)\[2:68:5\]', r'\1[2:68:5]', s, count=1)
s = re.sub(r'production: [\d.]+,', 'production: 0,', s)          # moons: no mine production, no basic income
open(os.path.join(OUT, 'layout-live-synthetic-moon.html'), 'w', encoding='utf-8').write(s)
print('ok')

#!/usr/bin/env python3
"""Builds the fleet fixtures in specs/galaxyz/fixtures/ (run: python3 -I tools/gen_fleet_fixtures.py, cwd = specs/galaxyz).

* fleet-real-*.html          byte copies of the REAL saved pages (eu/pages/fleetTable|fleetStep1|2|3.html)
* fleet-live-synthetic-*.html  REAL page skeleton + content rendered from the UPSTREAM Smarty templates with plausible
                               data for cases the real account did not have (attack/ACS/deploy/return/hold rows, ACS
                               panel, hold-time select, expedition, shortcuts, ACS target list, error page).
* fleet-upstream-*.json      fleetAjax / checkTarget JSON bodies built exactly like ShowFleetAjaxPage / ShowFleetStep1Page.
"""
import json, os, re, html

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REAL = os.path.normpath(os.path.join(HERE, '../../../eu/pages'))
FIX = os.path.join(HERE, 'fixtures')
BASE = 'https://ogamex.eu/Aeternum/'
NOTE = ('<!-- SYNTHETIC fixture (UPSTREAM-derived, not real): skeleton = REAL eu/pages/{src}, inner content rendered by '
        'tools/gen_fleet_fixtures.py from 2Moons styles/templates/game/{tpl} with plausible data. {extra} -->\n')

def read(name):
    with open(os.path.join(REAL, name), encoding='utf-8') as f:
        return f.read()

def write(name, s):
    # keep <!DOCTYPE> first (a leading comment would switch the page to quirks mode)
    m = re.match(r'(<!--.*?-->\n)(\s*<!DOCTYPE[^>]*>\n?)', s, re.S | re.I)
    if m:
        s = m.group(2) + m.group(1) + s[m.end():]
    with open(os.path.join(FIX, name), 'w', encoding='utf-8') as f:
        f.write(s)

def pretty(n):
    return '{:,}'.format(int(n)).replace(',', '.')

def fly(sec):
    sec = max(0, int(sec))
    return '%02d:%02d:%02d' % (sec // 3600, sec // 60 % 60, sec % 60)

MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
TZ = 7200                     # user tz offset seen on the real pages (UTC+2)
NOW = 1793347460              # render time of the real fleetTable (10:04:20 wall)

def tdformat(unix):
    import datetime
    d = datetime.datetime.fromtimestamp(unix + TZ, datetime.timezone.utc)
    return '%02d. %s %d, %02d:%02d:%02d' % (d.day, MON[d.month - 1], d.year, d.hour, d.minute, d.second)

os.makedirs(FIX, exist_ok=True)

# ---------- 1. real copies ----------
for n in ('fleetTable', 'fleetStep1', 'fleetStep2', 'fleetStep3'):
    write('fleet-real-%s.html' % n, read(n + '.html'))

# ---------- 2. synthetic fleetTable ----------
MISSION = {1: 'Attack', 2: 'ACS - Attack on cooperation', 3: 'Transport', 4: 'Deploy', 5: 'Transfer', 6: 'Spying',
           7: 'Colonize', 8: 'Recycle', 9: 'Destroy', 15: 'Expedition'}
SHIPNAME = {202: 'Light Cargo', 203: 'Heavy Cargo', 204: 'Light Fighter', 206: 'Cruiser', 207: 'Battleship',
            208: 'Colony Ship', 209: 'Recycler', 210: 'Spy Probe', 212: 'Solar Satellite'}
# (fleetId, mission, state 0 out/1 return/2 hold, ships, start coords, start(arrival) unix, end coords, end unix)
FLEETS = [
    (397101, 1, 0, {204: 1200, 202: 300}, '2:68:5', NOW + 1500, '2:70:9', NOW + 3000),
    (397102, 3, 1, {203: 40}, '2:68:6', NOW - 900, '2:68:5', NOW + 600),
    (397103, 4, 0, {207: 15}, '2:68:5', NOW + 2400, '2:68:8', NOW + 4800),
    (397104, 15, 2, {203: 10, 210: 1}, '2:68:5', NOW - 1200, '2:68:16', NOW + 5000),
    (397105, 5, 2, {206: 50}, '2:68:7', NOW - 300, '2:71:4', NOW + 7300),
]
rows = []
for i, (fid, mis, state, ships, sc, st, ec, et) in enumerate(FLEETS, 1):
    returntime = st if (mis == 4 and state == 0) else et        # ShowFleetTablePage.class.php:225-232
    tip = ("<table list listOfOthers><tr><th colspan='2' style='text-align:center;'>Details</th></tr>" +
           ''.join("<tr><td class='transparent'>%s:</td><td class='transparent'>%d</td></tr>" % (SHIPNAME[k], v) for k, v in ships.items()) +
           '</table>')
    g1, s1, _ = sc.split(':'); g2, s2, _ = ec.split(':')
    state_html = ('<br><a title="Fleet return">(R)</a>' if state == 1 else '<br><a title="Fleet Target">(A)</a>')
    end_cell = '<td>-</td>' if (mis == 4 and state == 0) else ('<td%s>%s</td>' % (' style="color:lime"' if state != 0 else '', tdformat(et)))
    if state != 1:
        order = ('<form action="%sgame.php?page=fleetTable&amp;action=sendfleetback" method="post">\n'
                 '                                        <input name="fleetID" value="%d" type="hidden">\n'
                 '                                        <input class="button red small tooltip" data-tooltip-content="Return" value="Return" type="submit">\n'
                 '                                    </form>' % (BASE, fid))
        if mis == 1:
            order += ('\n                                    <form action="%sgame.php?page=fleetTable&amp;action=acs" method="post">\n'
                      '                                        <input name="fleetID" value="%d" type="hidden">\n'
                      '                                        <input class="button black small" value="ACS" type="submit">\n'
                      '                                    </form>' % (BASE, fid))
    else:
        order = '&nbsp;-&nbsp;'
    rows.append('''                            <tr>
                    <td>%d</td>
                    <td>%s
                                                    %s
                                            </td>
                    <td><a class="tooltip_sticky" data-tooltip-content="%s">%s</a>
                    </td>
                    <td><a href="%sgame.php?page=galaxy&amp;galaxy=%s&amp;system=%s">[%s]</a>
                    </td>
                    <td%s>%s</td>
                        <td><a href="%sgame.php?page=galaxy&amp;galaxy=%s&amp;system=%s">[%s]</a>
                        </td>
                                                    %s
                                                        <td id="fleettime_%d" class="fleets" data-fleet-end-time="%d" data-fleet-time="%d">%s</td>
                            <td>
                                    %s
                            </td>
                </tr>
''' % (i, MISSION[mis], state_html, html.escape(tip, quote=True), pretty(sum(ships.values())), BASE, g1, s1, sc,
       ' style="color:lime"' if state == 0 else '', tdformat(st), BASE, g2, s2, ec, end_cell, i, returntime,
       returntime - NOW, fly(returntime - NOW), order))

src = read('fleetTable.html')
start = src.index('<table style="width:650px;margin-left:8px" class="list listOfOthers">')
form_at = src.index('<form action="https://ogamex.eu/Aeternum/game.php?page=fleetStep1"')
table_old = src[start:form_at]
head_end = table_old.index('</tr>', table_old.index('<th class="textCenter">ID</th>')) + len('</tr>\n')
table_new = (table_old[:head_end]
             .replace('Fleet 1 /\n                        13', 'Fleet 5 /\n                        13')
             .replace('0 / 2\n                        expedition', '1 / 2\n                        expedition')
             + ''.join(rows) + '                    </tbody></table>\n')
ACS = '''<!-- ACS panel: UPSTREAM markup (shared.fleetTable.acsTable.tpl), fork markup unknown -->
<form action="%sgame.php?page=fleetTable&amp;action=acs" method="post">
<input name="fleetID" value="397101" type="hidden">
	<table class="table519">
		<tr style="height:20px;"><th colspan="2">ACS fleet</th></tr>
		<tr style="height:20px;"><th colspan="2">ACS name (<a href="javascript:Rename();">Change</a>)</th></tr>
		<tr><td colspan="2" id="acsName">AG482913377</td></tr>
		<tr style="height:20px;"><th style="width:50%%;">Guests</th><th style="width:50%%;">Invite members</th></tr>
		<tr><td colspan="2">Player  Nova  added to attack.</td></tr>
		<tr>
			<td><select size="5" style="width:80%%;">
<option value="1907">Vodoley</option>
<option value="2210">Nova</option>
</select></td>
			<td><p><input name="username" type="text"></p><p><input type="submit" value="Continue"></p></td>
		</tr>
	</table>
</form>
''' % BASE
# ships on planet: add a fast cargo with speed + keep the real rows
form_old_start = src.index('<td><img src="./7_files/208.gif"')
row_start = src.rindex('<tr>', 0, form_old_start)
extra_ship = '''<tr>
                        <td><img src="./7_files/202.gif" alt="Light Cargo" width="25" height="25" align="left"> <span class="tooltip" data-tooltip-content="Speed:  12000">Light Cargo</span>                        </td>
                        <td id="ship202_value">1.250</td>
                                                    <td><a class="button black small" href="javascript:maxShip(&#39;ship202&#39;);">max</a>
                            </td>
                            <td><input name="ship202" id="ship202_input" size="10" value="0"></td>
                                            </tr>
                                    '''
body = src[:start] + table_new + ACS + '                ' + src[form_at:row_start] + extra_ship + src[row_start:]
body = body.replace('<input type="hidden" name="galaxy" value="2">\n', '<input type="hidden" name="galaxy" value="2">\n', 1)
# prefill as if opened from galaxy: ?page=fleetTable&galaxy=2&system=70&planet=9&planettype=1&target_mission=1
body = re.sub(r'(<input type="hidden" name="system" value=")68(">)', r'\g<1>70\2', body, count=1)
body = re.sub(r'(<input type="hidden" name="planet" value=")5(">)', r'\g<1>9\2', body, count=1)
body = re.sub(r'(<input type="hidden" name="target_mission" value=")0(">)', r'\g<1>1\2', body, count=1)
write('fleet-live-synthetic-fleetTable.html', NOTE.format(src='fleetTable.html', tpl='page.fleetTable.default.tpl + shared.fleetTable.acsTable.tpl',
      extra='5 flights (attack out + ACS button, transport return, deploy out, expedition hold, ACS-defend hold), ACS panel, Light Cargo row, galaxy prefill 2:70:9 mission 1. Render time %d.' % NOW) + body)

# ---------- 3. synthetic fleetStep1: shortcuts, moon colony, ACS target list, 3 ships ----------
src = read('fleetStep1.html')
sc_old = src[src.index('<tr class="shortcut-none">'):src.index('<tr class="shortcut-edit shortcut-new">')]
sc_new = '''<tr style="height:20px;" class="shortcut-row">
                <td style="width:50%" class="shortcut-colum shortcut-isset">
                    <div class="shortcut-link">
                        <a href="javascript:setTarget(2,70,9,1);updateVars();">Farm(P) [2:70:9]</a>
                    </div>
                    <div class="shortcut-edit">
                        <input type="text" class="shortcut-input" name="shortcut[12][name]" value="Farm">
                        <div class="shortcut-delete" title="Delete"></div>
                    </div>
                </td>
                <td style="width:50%" class="shortcut-colum shortcut-isset">
                    <div class="shortcut-link">
                        <a href="javascript:setTarget(2,87,8,2);updateVars();">DF(DF) [2:87:8]</a>
                    </div>
                    <div class="shortcut-edit">
                        <input type="text" class="shortcut-input" name="shortcut[13][name]" value="DF">
                        <div class="shortcut-delete" title="Delete"></div>
                    </div>
                </td>
                </tr>
                '''
src = src.replace(sc_old, sc_new)
moon = '''<tr style="height:20px;">                    <td>
                        <a href="javascript:setTarget(2,68,5,3);updateVars();">Moon(M)                            [2:68:5]</a>
                    </td>
                                                        <td>&nbsp;</td></tr>
                                                        '''
anchor = '</tr></tbody></table>\n                <table class="table519 list listOfOthers hard-table" style="table-layout: fixed">\n            <tbody><tr style="height:20px;">\n                <td><input class="button green small"'
assert anchor in src, 'step1 anchor'
acs = ('</tr>' + moon + '</tbody></table>\n'
       '                <!-- ACS list: UPSTREAM markup (page.fleetStep1.default.tpl:137-154) -->\n'
       '                <table class="table519" style="table-layout: fixed;">\n'
       '		<tr style="height:20px;"><th colspan="2">Alliance attack</th></tr>\n'
       '		<tr style="height:20px;">\n'
       '			<td><a href="javascript:setACSTarget(2,70,9,1,5521);">AG482913377 - [2:70:9]</a></td>\n'
       '		</tr>\n'
       '	</table>\n'
       '                <table class="table519 list listOfOthers hard-table" style="table-layout: fixed">\n            <tbody><tr style="height:20px;">\n                <td><input class="button green small"')
src = src.replace(anchor, acs)
data = {"fleetroom": "1275000", "gamespeed": 7, "fleetspeedfactor": 1,
        "planet": {"galaxy": "2", "system": "68", "planet": "5", "planet_type": "1"}, "maxspeed": 12000,
        "ships": {"202": {"consumption": "20", "speed": 12000, "amount": "250"},
                  "204": {"consumption": "20", "speed": 27500, "amount": "1200"},
                  "210": {"consumption": "1", "speed": 220000000, "amount": "1"}}, "fleetMinDuration": 5}
src = re.sub(r'data\t\t\t= \{.*?\};', 'data\t\t\t= ' + json.dumps(data, separators=(',', ':')) + ';', src, count=1)
src = src.replace('name="system" size="3" maxlength="3" onkeyup="updateVars()" value="68"', 'name="system" size="3" maxlength="3" onkeyup="updateVars()" value="70"')
src = src.replace('name="planet" size="3" maxlength="2" onkeyup="updateVars()" value="5"', 'name="planet" size="3" maxlength="2" onkeyup="updateVars()" value="9"')
src = src.replace('<input type="hidden" name="target_mission" value="0">', '<input type="hidden" name="target_mission" value="1">')
write('fleet-live-synthetic-fleetStep1.html', NOTE.format(src='fleetStep1.html', tpl='page.fleetStep1.default.tpl',
      extra='2 shortcuts, own moon in My planets, ACS target list, 3 ship types in data, target 2:70:9 mission 1.') + src)

# ---------- 4. synthetic fleetStep2: attack target with hold select / expedition ----------
src = read('fleetStep2.html')
m_old = src[src.index('<tbody><tr style="height:20px;">\n                                    <td class="transparent left">'):src.index('</tbody></table>', src.index('radio_7'))]

def radios(ids, checked):
    out = []
    for k in ids:
        alert = ('<br><div style="color:red;padding-left:13px;">Attention! Explorations are dangerous missions, you can lose your fleet!</div><br>' if k == 15 else '')
        out.append('''<tr style="height:20px;">
                                    <td class="transparent left">
                                        <input id="radio_%d" type="radio" name="mission" value="%d"%s><label for="radio_%d"><span></span>%s</label><br>
                                        %s
                                    </td>
                                </tr>
''' % (k, k, ' checked="checked"' if k == checked else '', k, MISSION[k], alert))
    return '<tbody>' + ''.join(out)

def stay(opts):
    return ('''<!-- hold time: UPSTREAM markup (page.fleetStep2.default.tpl:222-231) -->
                <tr style="height:20px;"><th>At Flying</th></tr>
                <tr style="height:20px;">
                    <td>
                    <select name="staytime">
''' + '\n'.join('<option value="%s">%s</option>' % (k, v) for k, v in opts) + '''
</select> Hours
                    </td>
                </tr>
                ''')

fp_anchor = '<tr style="height:20px;">\n                    <td class="transparent" colspan="3">Fleet points:'
assert fp_anchor in src
for name, ids, checked, opts, cons, head in (
        ('attack', [3, 1, 5], 1, [(1, 1), (2, 2), (4, 4), (8, 8), (12, 12), (16, 16), (32, 32)], 236, 'Send fleet 2:68:5 - Planet'),
        ('expedition', [15], 0, [(i, i) for i in range(1, 9)], 1931, 'Send fleet 2:68:5 - Planet')):
    s = src.replace(m_old, radios(ids, checked))
    s = s.replace(fp_anchor, stay(opts) + fp_anchor)
    s = s.replace('<td class="left top" style="width:50%;margin:0;padding:0;">', '<td class="left top" style="width:50%;margin:0;padding:0;" rowspan="3">')
    s = s.replace('class="consumption">118</span>', 'class="consumption">%d</span>' % cons)
    s = s.replace('data	= {"fleetroom":"7500","consumption":"118"};', 'data	= {"fleetroom":"1275000","consumption":"%d"};' % cons)
    s = s.replace('<font color="lime">7.382</font>', '<font color="lime">%s</font>' % pretty(1275000 - cons))
    write('fleet-live-synthetic-fleetStep2-%s.html' % name, NOTE.format(src='fleetStep2.html', tpl='page.fleetStep2.default.tpl',
          extra='missions %s, staytime select (%s), checked=%s.' % (ids, 'hold 5' if name == 'attack' else 'expedition 1..astrophysics/halt_speed', checked)) + s)

# ---------- 5. error page (printMessage -> error.default.tpl) ----------
src = read('fleetStep3.html')
a = src.index('<div class="headerRS"></div>\n<div class="mainRS">')
b = src.index('<div class="footerRS"></div>', a)
err = '''<div class="headerRS"></div>
<div class="mainRS">
<!-- printMessage(): UPSTREAM markup (error.default.tpl); fork markup unknown -->
<table class="table519">
	<tr>
		<th>Info</th>
	</tr>
	<tr>
		<td><p>Not enough deuterium available.</p><p><a href="game.php?page=fleetTable"><button>Back</button></a></p></td>
	</tr>
</table>
</div>
'''
s = src[:a] + err + src[b:]
s = re.sub(r'\s*<meta http-equiv="refresh" content="3;URL=game.php\?page=fleetTable">', '', s, count=1)
write('fleet-live-synthetic-error.html', NOTE.format(src='fleetStep3.html', tpl='error.default.tpl',
      extra='fleetStep3 refused with fl_not_enough_deuterium.') + s)

# ---------- 6. JSON bodies (json_encode of the PHP arrays, key order preserved) ----------
J = {
    'fleet-upstream-fleetAjax-spy-ok.json': {"slots": 2, "ships": {"210": 99}, "code": 600, "mess": "Send 3 Spy Probe to 2:70:9 ..."},
    'fleet-upstream-fleetAjax-recycle-ok.json': {"slots": 2, "ships": {"219": 0, "209": 0}, "code": 600, "mess": "Send 12 Recycler to 2:87:8 ..."},
    'fleet-upstream-fleetAjax-noslots.json': {"slots": 13, "code": 612, "mess": "Fault, not enough fleet Slots"},
    'fleet-upstream-fleetAjax-noob.json': {"slots": 1, "ships": {"210": 99}, "code": 603, "mess": "Player is too weak"},
    'fleet-upstream-checkTarget-ok.json': "OK",
    'fleet-upstream-checkTarget-same.json': "Start and destination planet are identical!",
}
for k, v in J.items():
    write(k, json.dumps(v, separators=(',', ':')))   # PHP json_encode: no spaces, '/' escaped (none here)
print('ok', sorted(os.listdir(FIX)))

#!/usr/bin/env python3
"""Builds the messages fixtures in specs/galaxyz/fixtures/ (run: python3 -I tools/gen_messages_fixtures.py, cwd = specs/galaxyz).

* messages-real-{spy,all}.html     byte copies of the REAL saved pages eu/pages/messages-spy.html / messages-all.html
* messages-upstream-view-100-p2.html  body of GET game.php?page=messages&mode=view&messcat=100&site=2&ajax=1, rendered
                                    from 2Moons styles/templates/game/page.messages.view.tpl with one message of every
                                    kind the mission classes send (texts from language/en/FLEET.php, markup copied from
                                    MissionCase*.class.php, shared.mission.spyReport.tpl). SYNTHETIC data.
* messages-upstream-view-999.html   the same template for the outbox (messcat=999: no checkboxes, no action selects).
* (raport popup fixtures come from tools/messages/gen_messages_fixtures.php, real Smarty rendering)
Whitespace: GALAXYZ stores spy reports with the Smarty 'trimwhitespace' filter (one line, single spaces), exactly like
the REAL reports; the other bodies are built with PHP sprintf and have no newlines (MissionCaseAttack strips them).
"""
import os, re, shutil

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REAL = os.path.normpath(os.path.join(HERE, '../../../eu/pages'))
FIX = os.path.join(HERE, 'fixtures')
NOTE = ('<!-- SYNTHETIC fixture (UPSTREAM-derived, not real): rendered by tools/gen_messages_fixtures.py from 2Moons '
        '{tpl} with plausible data. {extra} -->\n')

def pretty(n):
    # pretty_number(): number_format($n, 0, ',', '.') -> ROUNDS (PHP number_format), not floor
    return '{:,}'.format(int(round(n))).replace(',', '.')

def write(name, s):
    with open(os.path.join(FIX, name), 'w', encoding='utf-8') as f:
        f.write(s)

# ---------------------------------------------------------------- element names (language/en/TECH.php as shown live)
SHIPS = [(202, 'Light Cargo'), (203, 'Heavy Cargo'), (204, 'Light Fighter'), (205, 'Heavy Fighter'), (206, 'Cruiser'),
         (207, 'Battleship'), (208, 'Colony Ship'), (209, 'Recycler'), (210, 'Spy Probe'), (211, 'Planet Bomber'),
         (212, 'Solar Satellite'), (213, 'Star Fighter'), (214, 'Battle Fortress'), (215, 'Battle Cruiser'),
         (216, 'Black Moon'), (217, 'Battle Transporter'), (218, 'Avatar'), (219, 'Battle Recycler'),
         (220, 'Dark Matter Collector')]
DEF = [(401, 'Missile Launcher'), (402, 'Light Laser Turret'), (403, 'Heavy Laser Turret'), (404, 'Gauss Cannon'),
       (405, 'Ion Cannon'), (406, 'Plasma Cannon'), (407, 'Small Shield Dome'), (408, 'Large Shield Dome'),
       (409, 'Atmospheric Shield'), (410, 'Gravitons Cannon'), (411, 'Orbital Defence Platform'),
       (502, 'Interceptor'), (503, 'Interplanetary missiles')]
BUILD = [(1, 'Metal Mine'), (2, 'Crystal Mine'), (3, 'Deuterium Refinery'), (4, 'Solar Power plant'), (6, 'University'),
         (12, 'Deuterium Power Plant'), (14, 'Robot Factory'), (15, 'Nanite Factory'), (21, 'Shipyard'),
         (22, 'Metal Storage'), (23, 'Crystal Storage'), (24, 'Deuterium Storage'), (31, 'Research Lab'),
         (33, 'Terraformer'), (34, 'Alliance Depot'), (41, 'Moon base'), (42, 'Phalax Sensor'), (43, 'Jumpgate'),
         (44, 'Missile Silo'), (71, 'Light conveyor'), (72, 'Average conveyor'), (73, 'Heavy conveyor')]
RESEARCH = [(106, 'Spy Technology'), (108, 'Computer Technology'), (109, 'Weapons Technology'),
            (110, 'Shield Technology'), (111, 'Armour Technology'), (113, 'Energy Technology'),
            (114, 'Hyperspace Technology'), (115, 'Combustion Engine'), (117, 'Impulse Engine'),
            (118, 'Hyperspace Engine'), (120, 'Laser Technology'), (121, 'Ion Technology'), (122, 'Plasma Technology'),
            (123, 'Intergalactic Research Network'), (124, 'Expedition Research'), (131, 'Mineral Research'),
            (132, 'Semi-Crystals Research'), (133, 'Fuel Research'), (199, 'Graviton Research')]
RES = [(901, 'Metal'), (902, 'Crystal'), (903, 'Deuterium'), (911, 'Energy')]
CLASS_NAME = {900: 'Ressources', 200: 'Ships', 400: 'Planetary Defense', 0: 'Buildings', 100: 'Research'}

# ---------------------------------------------------------------- shared.mission.spyReport.tpl (trimwhitespace output)
def spy_report(name, g, s, p, ptype, title_date, data, target_chance, spy_chance, sim=True):
    """data: list of (classId, [(id, name, amount)])  -- same order as MissionCaseSpy ($classIDs 900,200,400,0,100)."""
    o = ['<div class="spyRaport"> <div class="spyRaportHead"> <a href="game.php?page=galaxy&amp;galaxy=%d&amp;system=%d">'
         'Spy Report %s [%d:%d:%d] on %s</a> </div>' % (g, s, name, g, s, p, title_date)]
    for cls, items in data:
        o.append(' <div class="spyRaportContainer"> <div class="spyRaportContainerHead spyRaportContainerHeadClass%d">%s</div>'
                 % (cls, CLASS_NAME[cls]))
        for i, (eid, ename, amount) in enumerate(items, 1):
            if i % 2 == 1:
                o.append(' <div class="spyRaportContainerRow clearfix">')
            o.append(' <div class="spyRaportContainerCell">%s</div> <div class="spyRaportContainerCell">%s</div>'
                     % (ename, pretty(amount)))
            if i % 2 == 0:
                o.append(' </div>')          # an odd count leaves the last row OPEN (template bug, see REAL report 1)
        o.append(' </div>')
    o.append(' <div class="spyRaportFooter"> <a href="game.php?page=fleetTable&amp;galaxy=%d&amp;system=%d&amp;planet=%d'
             '&amp;planettype=%d&amp;target_mission=1">Attack</a> <br>' % (g, s, p, ptype))
    if target_chance >= spy_chance:
        o.append('<font color="red">Your spy probes were destroyed! </font>')
    else:
        o.append('The spy probes discovery chance was:  %d %% ' % target_chance)
    if sim:
        q = ''.join('&amp;im[%d]=%s' % (eid, ('%.15g' % amount)) for cls, items in data for eid, _, amount in items)
        o.append(' <br><a href="game.php?page=battleSimulator%s">Simulate</a>' % q)
    o.append(' </div> </div>')
    return ''.join(o)

# ---------------------------------------------------------------- MissionCaseAttack $messageHTML (newlines stripped)
def combat_msg(rid, cls_me, g, s, p, ptype, lost_a, lost_d, cls, steal, debris):
    return ('<div class="raportMessage"><table><tr><td colspan="2"><a href="game.php?page=raport&raport=%s" target="_blank">'
            '<span class="%s">Fight report [%d:%d:%d] (%s)</span></a></td></tr>'
            '<tr><td>Losses</td><td><span class="%s">Attacker: %s</span>&nbsp;<span class="%s">Defender: %s</span></td></tr>'
            '<tr><td>Profit</td><td><span>Metal:&nbsp;<span class="reportSteal element901">%s</span>&nbsp;</span>'
            '<span>Crystal:&nbsp;<span class="reportSteal element902">%s</span>&nbsp;</span>'
            '<span>Deuterium:&nbsp;<span class="reportSteal element903">%s</span></span></td></tr>'
            '<tr><td>Rubblefield</td><td><span>Metal:&nbsp;<span class="reportDebris element901">%s</span>&nbsp;</span>'
            '<span>Crystal:&nbsp;<span class="reportDebris element902">%s</span></span></td></tr></table></div>'
            % (rid, cls_me, g, s, p, ptype, cls[0], pretty(lost_a), cls[1], pretty(lost_d),
               pretty(steal[0]), pretty(steal[1]), pretty(steal[2]), pretty(debris[0]), pretty(debris[1])))

def addr(g, s, p):   # GetStartAddressLink / GetTargetAddressLink (class="" for messages)
    return '<a href="game.php?page=galaxy&amp;galaxy=%d&amp;system=%d" class="">[%d:%d:%d]</a>' % (g, s, g, s, p)

M = [  # (id, unread, time, from, subject, type, sender, text)
    (530112, 1, '30. Oct 2026, 11:02:14', 'Spying department', 'Intelligence report', 0, 0,
     spy_report('Kronos', 2, 70, 4, 1, '30. Oct 2026, 11:02:22',
                [(900, [(901, 'Metal', 4523000000.4), (902, 'Crystal', 1210500000.5), (903, 'Deuterium', 98000000), (911, 'Energy', -1250)]),
                 (200, [(i, n, {202: 1500, 203: 300, 209: 77, 210: 5, 212: 120}.get(i, 0)) for i, n in SHIPS]),
                 (400, [(i, n, {401: 2000, 402: 1500, 407: 1, 408: 1, 502: 20}.get(i, 0)) for i, n in DEF]),
                 (0, [(i, n, {1: 40, 2: 36, 3: 33, 4: 30, 14: 12, 15: 6, 21: 12, 22: 15, 31: 12}.get(i, 0)) for i, n in BUILD]),
                 (100, [(i, n, {106: 14, 108: 12, 109: 15, 110: 14, 111: 15, 113: 12, 115: 16}.get(i, 0)) for i, n in RESEARCH])],
                12, 57)),
    (530110, 1, '30. Oct 2026, 11:01:40', 'Spying department', 'Intelligence report', 0, 0,
     spy_report('Arrakeen (Moon)', 2, 71, 9, 3, '30. Oct 2026, 11:01:52',
                [(900, [(901, 'Metal', 1000), (902, 'Crystal', 0), (903, 'Deuterium', 52000.75), (911, 'Energy', 0)]),
                 (200, [(i, n, {204: 10}.get(i, 0)) for i, n in SHIPS])],
                80, 33)),
    (530101, 1, '30. Oct 2026, 10:58:03', 'Room monitoring', 'Spying activity', 0, 0,
     'A hostile fleet of the planet Aldebaran' + addr(2, 66, 7) + ' was sighted near your planet\n\t\tColony '
     + addr(2, 68, 6) + ' sighted'),
    (530099, 1, '30. Oct 2026, 10:55:00', 'Fleet Headquarters', 'Fight report', 3, 0,
     combat_msg('3f1c0d6e8a2b4c5d6e7f8091a2b3c4d5', 'raportWin', 2, 70, 4, 'P', 12000, 4580000,
                ('raportWin', 'raportLose'), (2261500000, 605250000, 49000000), (1374000, 1260000))),
    (530098, 0, '30. Oct 2026, 10:41:10', 'Fleet Headquarters', 'Fight report', 3, 0,
     combat_msg('0a1b2c3d4e5f60718293a4b5c6d7e8f9', 'raportLose', 2, 68, 5, 'P', 999000, 0,
                ('raportLose', 'raportWin'), (0, 0, 0), (299700, 299700))),
    (530090, 0, '30. Oct 2026, 10:30:55', 'Fleet Headquarters', 'Fleet return', 4, 0,
     'One of your fleets returns from a attack at the planet Kronos ' + addr(2, 70, 4)
     + '. You have captured 2.261.500.000 Metal, 605.250.000 Crystal and 49.000.000 Deuterium '),
    (530085, 0, '30. Oct 2026, 10:20:29', 'Fleet Headquarters', 'Recycling Report', 5, 0,
     'Having arrived at there destination your Recyclers collect 1.374.000 Metal and 1.260.000 Crystal'),
    (530080, 0, '30. Oct 2026, 10:20:01', 'Fleet Headquarters', 'Transportmessage', 5, 0,
     'One of your fleets reaches the planet Colony ' + addr(2, 68, 6) + ' and delivers 7.382 Metal, 0 Crystal and 0 Deuterium.'),
    (530079, 0, '30. Oct 2026, 10:19:44', 'Fleet Headquarters', 'Transportmessage', 5, 0,
     'A peaceful fleet of Aldebaran ' + addr(2, 66, 7) + ' reached Главная планета ' + addr(2, 68, 5)
     + ' and delivers 1.000.000 Metal, 500.000 Crystal and 0 Deuterium.'),
    (530075, 0, '30. Oct 2026, 10:10:12', 'Fleet Headquarters', 'Fleet return', 4, 0,
     'One of your fleets returns from the planet Главная планета ' + addr(2, 68, 5) + '.'),
    (530070, 0, '30. Oct 2026, 10:05:00', 'Fleet Headquarters', 'Expedition report', 15, 0,
     'Your expedition has discovered a small asteroids cluster from which some resources could be won. '),
    (530069, 0, '30. Oct 2026, 10:04:00', 'Fleet Headquarters', 'Expedition report', 15, 0,
     'We have found a gigantic ship cemetery. Some technicians of the expedition have managed to get the ship into operation again.'
     '<br>Light Cargo: 1.200<br>Cruiser: 35'),
    (530068, 0, '30. Oct 2026, 10:03:00', 'Fleet Headquarters', 'Expedition report', 15, 0,
     'Scans of this sector first promised to be good, but unfortunately we came back empty-handed.'),
    (530067, 0, '30. Oct 2026, 10:02:00', 'Fleet Headquarters', 'Fleet return', 4, 0,
     'Your fleet has returned from the expedition.<br>It deliveres Metal 812.000, Crystal 0, Deuterium 0 and Dark Matter 0.'),
    (530060, 0, '30. Oct 2026, 09:58:00', 'Colonisation', 'Colonisation report', 4, 0,
     'One of your fleets reaches the coordinates [2:68:9]. The settlers start to colonise the new planet.'),
    (530055, 0, '30. Oct 2026, 09:50:00', 'Fleet Headquarters', 'Located fleet', 5, 0,
     'Your fleet reaches the planet ' + addr(2, 68, 6) + ' and delivers 10 Metal, 20 Crystal and 30 Deuterium.'),
    (530050, 0, '30. Oct 2026, 09:40:00', 'Aldebaran [2:66:7]', 'Hi neighbour', 1, 412345, 'Want to trade?<br>Regards'),
]

ROW = '''	<tr id="message_{id}" class="message_head{unread}">
		<td style="width:40px;" rowspan="2">
		{chk}
		</td>
		<td>{time}</td>
		<td>{frm}</td>
		<td>{subject}
		{reply}
		</td>
	</tr>
	<tr class="messages_body">
		<td colspan="3" class="left">
		{text}
		</td>
	</tr>
'''

def pager(cat, page, maxpage, last_link_first):
    o = 'Page: '
    if page != 1:
        o += '<a href="#" onclick="Message.getMessages(%d, %d);return false;">&laquo;</a>&nbsp;' % (cat, 1 if last_link_first else page - 1)
    o += '&nbsp;'.join('<a href="#" onclick="Message.getMessages(%d, %d);return false;">%s</a>'
                       % (cat, i, '<b>[%d]</b>' % i if i == page else '[%d]' % i) for i in range(1, maxpage + 1))
    if page != maxpage:
        o += '&nbsp;<a href="#" onclick="Message.getMessages(%d, %d);return false;">&raquo;</a>' % (cat, maxpage if last_link_first else page + 1)
    return o

ACTIONS = '''	<tr>
		<td colspan="4">
			<select name="action{pos}">
				<option value="readmarked">Mark selected messages as read</option>
				<option value="readtypeall">Mark all messages of this type as read</option>
				<option value="readall">Mark all messages as read</option>
				<option value="deletemarked">Delete marked messages</option>
				<option value="deleteunmarked">Delete all messages not marked</option>
				<option value="deletetypeall">Delete all messages of this type</option>
				<option value="deleteall">Delete all messages</option>
			</select>
			<input value="Confirm" type="submit" name="submit{pos}">
		</td>
	</tr>
'''

def view(cat, page, maxpage, msgs):
    o = ['<form action="game.php?page=messages" method="post">\n<input type="hidden" name="mode" value="action">\n'
         '<input type="hidden" name="ajax" value="1">\n<input type="hidden" name="messcat" value="%d">\n'
         '<input type="hidden" name="side" value="%d">\n<table id="messagestable" style="width:760px;">\n'
         '\t<tr>\n\t\t<th colspan="4">Messages</th>\n\t</tr>\n' % (cat, page)]
    if cat != 999:
        o.append(ACTIONS.format(pos='Top'))
    o.append('\t<tr style="height: 20px;">\n\t\t<td class="right" colspan="4">%s</td>\n\t</tr>\n' % pager(cat, page, maxpage, False))
    o.append('\t<tr style="height: 20px;">\n\t\t<td>Action</td>\n\t\t<td>Date</td>\n\t\t<td>%s</td>\n\t\t<td>Subject</td>\n\t</tr>\n'
             % ('From' if cat != 999 else 'To'))
    for (mid, unread, time, frm, subject, typ, sender, text) in msgs:
        reply = ''
        if typ == 1 and cat != 999:
            reply = ('<a href="#" onclick="return Dialog.PM(%d, Message.CreateAnswer(\'%s\'));" title="Answer to %s">'
                     '<img src="./styles/theme/gow/img/m.gif" border="0"></a>' % (sender, subject, re.sub('<[^>]*>', '', frm)))
        o.append(ROW.format(id=mid, unread=' mes_unread' if (cat != 999 and unread) else '',
                            chk='<input name="messageID[%d]" value="1" type="checkbox">' % mid if cat != 999 else '',
                            time=time, frm=frm, subject=subject, reply=reply, text=text))
    o.append('\t<tr style="height: 20px;">\n\t\t<td class="right" colspan="4">%s</td>\n\t</tr>\n' % pager(cat, page, maxpage, True))
    if cat != 999:
        o.append(ACTIONS.format(pos='Bottom'))
    o.append('</table>\n</form>\n')
    return ''.join(o)

def main():
    for src, dst in (('messages-spy.html', 'messages-real-spy.html'), ('messages-all.html', 'messages-real-all.html')):
        shutil.copyfile(os.path.join(REAL, src), os.path.join(FIX, dst))
    write('messages-upstream-view-100-p2.html',
          NOTE.format(tpl='styles/templates/game/page.messages.view.tpl', extra='GET game.php?page=messages&mode=view&messcat=100&site=2&ajax=1 (an HTML FRAGMENT, no <html>).')
          + view(100, 2, 3, M))
    write('messages-upstream-view-999.html',
          NOTE.format(tpl='styles/templates/game/page.messages.view.tpl', extra='messcat=999 (outbox).')
          + view(999, 1, 1, [(530200, 0, '30. Oct 2026, 11:10:00', 'Aldebaran [2:66:7]', 'Re:Hi neighbour', 1, 254000, 'Sure.')]))
    # the raport popup fixture is rendered with the real Smarty templates by tools/messages/gen_messages_fixtures.php
    # (messages-upstream-raport*.html); RAPORT below is kept only as a quick reference and is not written.

# ---------------------------------------------------------------- shared.mission.raport.tpl (popup, show())
def ships_table(ships):
    if not ships:
        return '<table width="100%"><tr><td class="transparent"><br>Destroyed<br><br></td></tr></table>'
    rows = [('Type', [n for _, n, *_ in ships])] + [(lbl, [pretty(x[k]) for x in ships]) for lbl, k in
                                                     (('Amount', 2), ('Firepower', 3), ('Shield', 4), ('Armour', 5))]
    return '<table width="100%">' + ''.join('<tr><td class="transparent">%s</td>%s</tr>' % (
        lbl, ''.join('<td class="transparent">%s</td>' % v for v in vals)) for lbl, vals in rows) + '</table>'

def side(pos, name, koords, tech, ships):
    return ('<table><tr><td class="transparent"><table><tr><td>%s %s ([%s] (%s))<br>Firepower %d%% - Shield %d%% - Armour %d%%%s'
            '</td></tr></table></td></tr></table>' % (pos, name, koords[0], koords[1], tech[0], tech[1], tech[2], ships_table(ships)))

R1A = [(202, 'L.Cargo', 1500, 5, 10, 400), (206, 'Cruiser', 35, 400, 50, 2700)]
R1D = [(401, 'R.Launcher', 2000, 80, 20, 200), (407, 'S.Dome', 1, 1, 2000, 2000)]
RAPORT = ('<!DOCTYPE html>\n' + NOTE.format(tpl='styles/templates/game/shared.mission.raport.tpl',
                                            extra='GET game.php?page=raport&raport=3f1c0d6e8a2b4c5d6e7f8091a2b3c4d5 (popup, body.popup; GALAXYZ skin UNKNOWN). Ship short names are UPSTREAM $LNG.shortNames.')
          + '<html lang="en"><head><meta charset="UTF-8"><title>Fight report - Aeternum</title></head><body id="raport" class="popup">'
          '<div id="content"><div style="width:100%;text-align:center">\nThe following fleets face each other on:  \n30. Oct 2026, 10:55:00:<br><br>\n'
          + side('Attacker', 'vodoleyko1992', ('2:68:5', 'P'), (150, 140, 150), R1A)
          + '<br><br>' + side('Defender', 'Kronos-Owner', ('2:70:4', 'P'), (120, 110, 120), R1D)
          + '\nThe attacking fleet fires with a power of 1.234.000 at the defender. The shields of the defender absorb 56.000 damage points.<br>\n'
          'The defending fleet fires with a power of 160.000 at the attacker. The shields of the attacker absorb 20.000 damage points.<br><br>\n'
          + side('Attacker', 'vodoleyko1992', ('2:68:5', 'P'), (150, 140, 150), [(202, 'L.Cargo', 1498, 5, 10, 400), (206, 'Cruiser', 35, 400, 50, 2700)])
          + '<br><br>' + side('Defender', 'Kronos-Owner', ('2:70:4', 'P'), (120, 110, 120), [])
          + '\n<br><br>\nThe attacker has won the battle!<br>\nHe captures 2.261.500.000 Metal, 605.250.000 Crystal and 49.000.000 Deuterium\n<br><br>\n'
          'The attackers losses: 12.000 units<br>\nThe defenders losses: 4.580.000 units<br>\n'
          'At the coordinates are now: 1.374.000 Metal and 1.260.000 Crystal debris.<br><br>\n'
          'Moon Chance:  0 %<br>\n</div></div></body></html>\n')

if __name__ == '__main__':
    main()

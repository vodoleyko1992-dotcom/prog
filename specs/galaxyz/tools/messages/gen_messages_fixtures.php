<?php
/*
 * Renders the GALAXYZ messages fixtures from the UPSTREAM 2Moons sources (read-only):
 *   - the real Smarty templates (page.messages.view.tpl, shared.mission.spyReport.tpl, shared.mission.raport.tpl,
 *     page.battleHall.default.tpl) through the bundled Smarty 3.1.30,
 *   - message bodies built with the exact sprintf()/heredoc code of includes/classes/missions/*.php
 *     (the combat-message heredocs are extracted from the PHP files at run time, not retyped),
 *   - language strings from language/en and language/ru.
 * Sample data is invented (see the HTML comment at the top of every fixture). Real pages are only COPIED.
 * Usage (cwd = specs/galaxyz):  php tools/messages/gen_messages_fixtures.php
 */
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_WARNING);
$HERE = realpath(__DIR__ . '/../..');
$ROOT = realpath($HERE . '/../../..');                 // scratchpad
$SRC  = $ROOT . '/src/2Moons';
$REAL = $ROOT . '/eu/pages';
$FIX  = $HERE . '/fixtures';
@mkdir($FIX);

require $SRC . '/includes/libs/Smarty/Smarty.class.php';

function loadLng($SRC, $lang) {
    $LNG = array();
    foreach (array('L18N', 'INGAME', 'TECH', 'FLEET') as $f) include $SRC . "/language/$lang/$f.php";
    return $LNG;
}
$LNG = loadLng($SRC, 'en');
$LNGRU = loadLng($SRC, 'ru');

// includes/GeneralFunctions.php:237 + 329
function floatToString($n, $p = 0) { return sprintf("%." . $p . "f", $n); }
function pretty_number($n, $dec = 0) { return number_format(floatToString($n, $dec), $dec, ',', '.'); }
// includes/GeneralFunctions.php:222-230
function GetStartAddressLink($f, $t = '') { return '<a href="game.php?page=galaxy&amp;galaxy=' . $f['fleet_start_galaxy'] . '&amp;system=' . $f['fleet_start_system'] . '" class="' . $t . '">[' . $f['fleet_start_galaxy'] . ':' . $f['fleet_start_system'] . ':' . $f['fleet_start_planet'] . ']</a>'; }
function GetTargetAddressLink($f, $t = '') { return '<a href="game.php?page=galaxy&amp;galaxy=' . $f['fleet_end_galaxy'] . '&amp;system=' . $f['fleet_end_system'] . '" class="' . $t . '">[' . $f['fleet_end_galaxy'] . ':' . $f['fleet_end_system'] . ':' . $f['fleet_end_planet'] . ']</a>'; }
// php_tdformat 'd. M Y, H:i:s' (language/en/L18N.php:27) in the user's zone; we print fixed wall clocks
function tdate($ts) { return gmdate("d. M Y, H:i:s", $ts + 7200); }   // live zone UTC+2 (layout.md 6)

function smarty($SRC, $trim = false) {
    $s = new Smarty();
    $s->setTemplateDir($SRC . '/styles/templates/game/');
    $tmp = sys_get_temp_dir() . '/gzmsg_smarty';
    @mkdir($tmp);
    $s->setCompileDir($tmp);
    $s->setForceCompile(true);
    if ($trim) $s->loadFilter('output', 'trimwhitespace');   // MissionCaseSpy.class.php:142
    return $s;
}
function heredoc($file, $nth = 0) {
    $c = file_get_contents($file);
    preg_match_all('/<<<HTML\n(.*?)\nHTML;/s', $c, $m);
    return str_replace(array("\n", "\t", "\r"), "", $m[1][$nth]);   // "Minize HTML" (MissionCaseAttack.class.php:69)
}
$ATTACK_HTML = heredoc($SRC . '/includes/classes/missions/MissionCaseAttack.class.php');
$EXPE_HTML   = heredoc($SRC . '/includes/classes/missions/MissionCaseExpedition.class.php');

$BANNER = "<!-- UPSTREAM-DERIVED fixture, NOT a real page. Rendered by specs/galaxyz/tools/messages/gen_messages_fixtures.php from the\n"
        . "     upstream 2Moons 1.8 templates/mission code with invented data (player vodoleyko1992, Главная планета [2:68:5]).\n"
        . "     The GALAXYZ fork may differ; verify against a real page. %s -->\n";

// ---------------------------------------------------------------- sample world
$ME   = array('id' => 4377, 'name' => 'vodoleyko1992', 'planet' => 'Главная планета', 'g' => 2, 's' => 68, 'p' => 5);
$T0   = 1793340000;  // 2026-10-30 06:00:00 UTC = 08:00 wall clock in the server zone UTC+2
function fleet($sg, $ss, $sp, $eg, $es, $ep, $etype = 1, $res = array(0, 0, 0, 0)) {
    return array('fleet_start_galaxy' => $sg, 'fleet_start_system' => $ss, 'fleet_start_planet' => $sp,
        'fleet_end_galaxy' => $eg, 'fleet_end_system' => $es, 'fleet_end_planet' => $ep, 'fleet_end_type' => $etype,
        'fleet_resource_metal' => $res[0], 'fleet_resource_crystal' => $res[1], 'fleet_resource_deuterium' => $res[2],
        'fleet_resource_darkmatter' => $res[3]);
}

// ---------------------------------------------------------------- spy reports (MissionCaseSpy.class.php:88-161)
function spyReport($SRC, $LNG, $planet, $classes, $targetChance, $spyChance, $endTime, $isBattleSim = true) {
    $s = smarty($SRC, true);
    $s->assign('LNG', $LNG);
    $s->assign(array(
        'spyData' => $classes, 'targetPlanet' => $planet, 'targetChance' => $targetChance, 'spyChance' => $spyChance,
        'isBattleSim' => $isBattleSim,
        'title' => sprintf($LNG['sys_mess_head'], $planet['name'], $planet['galaxy'], $planet['system'], $planet['planet'], tdate($endTime)),
    ));
    return $s->fetch('shared.mission.spyReport.tpl');
}
$FLEET_IDS = range(202, 220);
$DEF_IDS = array(401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 502, 503);
$BUILD_IDS = array(1, 2, 3, 4, 6, 12, 14, 15, 21, 22, 23, 24, 31, 33, 34, 41, 42, 43, 44, 71, 72, 73);
$TECH_IDS = array(106, 108, 109, 110, 111, 113, 114, 115, 117, 118, 120, 121, 122, 123, 124, 131, 132, 133, 199);
function fill($ids, $vals) { $o = array(); foreach ($ids as $i) $o[$i] = isset($vals[$i]) ? $vals[$i] : 0; return $o; }

$target1 = array('name' => 'Kovacs Prime', 'galaxy' => 2, 'system' => 70, 'planet' => 4, 'planet_type' => 1);
$spyFull = array(
    900 => array(901 => 48211337.6, 902 => 21004410.2, 903 => 7300125.9, 911 => -1250),
    200 => fill($FLEET_IDS, array(202 => 120, 203 => 45, 204 => 800, 206 => 30, 209 => 12, 210 => 5, 212 => 400)),
    400 => fill($DEF_IDS, array(401 => 1500, 402 => 900, 403 => 120, 404 => 12, 407 => 1, 408 => 1, 502 => 20)),
    0   => fill($BUILD_IDS, array(1 => 30, 2 => 27, 3 => 25, 4 => 28, 12 => 5, 14 => 10, 15 => 4, 21 => 12, 22 => 11, 23 => 10, 24 => 9, 31 => 12, 44 => 4, 71 => 1)),
    100 => fill($TECH_IDS, array(106 => 10, 108 => 12, 109 => 14, 110 => 13, 111 => 15, 113 => 12, 114 => 8, 115 => 14, 117 => 9, 118 => 7, 120 => 12, 121 => 5, 122 => 7, 124 => 9)),
);
$spy1 = spyReport($SRC, $LNG, $target1, $spyFull, 3, 77, $T0 + 1800 + 9);
// spyMessagesMode == 1: array_filter() drops zero values (MissionCaseSpy.class.php:128-131); probes destroyed
$target2 = array('name' => 'Moon', 'galaxy' => 2, 'system' => 71, 'planet' => 12, 'planet_type' => 3);
$spyFiltered = array(
    900 => array_filter(array(901 => 1200000, 902 => 0, 903 => 85000, 911 => 0)),
    200 => array_filter(fill($FLEET_IDS, array(204 => 15, 214 => 1))),
    400 => array_filter(fill($DEF_IDS, array())),           // revealed, all zero -> header with no rows
);
$spy2 = spyReport($SRC, $LNG, $target2, $spyFiltered, 60, 40, $T0 + 2400 + 12);
// spy-detected message for the target (MissionCaseSpy.class.php:163-188)
function spyDetected($LNG, $senderPlanetName, $f, $targetName, $fromMoon = false) {
    $m = $LNG['sys_mess_spy_ennemyfleet'] . " " . $senderPlanetName;
    if ($fromMoon) $m .= $LNG['sys_mess_spy_report_moon'] . ' ';
    $text = '<a href="game.php?page=galaxy&amp;galaxy=%1$s&amp;system=%2$s">[%1$s:%2$s:%3$s]</a> %7$s
		%8$s <a href="game.php?page=galaxy&amp;galaxy=%4$s&amp;system=%5$s">[%4$s:%5$s:%6$s]</a> %9$s';
    return $m . sprintf($text, $f['fleet_start_galaxy'], $f['fleet_start_system'], $f['fleet_start_planet'],
        $f['fleet_end_galaxy'], $f['fleet_end_system'], $f['fleet_end_planet'], $LNG['sys_mess_spy_seen_at'], $targetName, $LNG['sys_mess_spy_seen_at2']);
}
$spyDet = spyDetected($LNG, 'Kovacs Prime', fleet(2, 70, 4, 2, 68, 5), 'Главная планета');

// ---------------------------------------------------------------- combat messages (MissionCaseAttack.class.php:395-476)
function combatMsg($tpl, $LNG, $rid, $won, $iAmAttacker, $coords, $etype, $lostA, $lostD, $steal, $debris) {
    $cls = $won == 'a' ? array('raportWin', 'raportLose') : ($won == 'r' ? array('raportLose', 'raportWin') : array('raportDraw', 'raportDraw'));
    $i = $iAmAttacker ? 0 : 1;
    return sprintf($tpl, $rid, $cls[$i], $LNG['sys_mess_attack_report'],
        sprintf($LNG['sys_adress_planet'], $coords[0], $coords[1], $coords[2]), $LNG['type_planet_short_' . $etype],
        $LNG['sys_lost'], $cls[0], $LNG['sys_attack_attacker_pos'], pretty_number($lostA), $cls[1], $LNG['sys_attack_defender_pos'], pretty_number($lostD),
        $LNG['sys_gain'], $LNG['tech'][901], pretty_number($steal[0]), $LNG['tech'][902], pretty_number($steal[1]), $LNG['tech'][903], pretty_number($steal[2]),
        $LNG['sys_debris'], $LNG['tech'][901], pretty_number($debris[0]), $LNG['tech'][902], pretty_number($debris[1]));
}
$RID1 = '3f9a2c7e5b1d4e8f9a0b1c2d3e4f5a6b';
$RID2 = '9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b';
$RID3 = '0123456789abcdef0123456789abcdef';
$cmb1 = combatMsg($ATTACK_HTML, $LNG, $RID1, 'a', true, array(2, 70, 4), 1, 36000, 1985000, array(12053668, 5251102, 1825031), array(495000, 225000));
$cmb2 = combatMsg($ATTACK_HTML, $LNG, $RID2, 'a', false, array(2, 68, 5), 1, 0, 4400000, array(150000, 80000, 20000), array(1050000, 600000));
// expedition battle: other heredoc (CombatReport.php link, raportSteal/raportDebris classes), sent with type 3 (MissionCaseExpedition.class.php:220-464)
$cmb3 = combatMsg($EXPE_HTML, $LNG, $RID3, 'r', true, array(2, 68, 16), 1, 2300000, 120000, array(0, 0, 0), array(0, 0));
// MIP report (MissionCaseMIP.class.php:110-150)
$mip = sprintf($LNG['sys_irak_mess'], 25, 'Главная планета ' . GetStartAddressLink(fleet(2, 68, 5, 2, 70, 4)), 'Kovacs Prime ' . GetTargetAddressLink(fleet(2, 68, 5, 2, 70, 4)))
     . sprintf($LNG['sys_irak_def'], 5) . '<br><br>' . sprintf('%s (- %d)<br>', $LNG['tech'][401], 300) . sprintf('%s (- %d)<br>', $LNG['tech'][402], 120);

// ---------------------------------------------------------------- expedition (MissionCaseExpedition.class.php:60-513, MissionCaseFoundDM)
$expShips = $LNG['sys_expe_found_ships_1_2'] . '<br>' . $LNG['tech'][202] . ': ' . pretty_number(37) . '<br>' . $LNG['tech'][204] . ': ' . pretty_number(1250);
$expShipsNone = $LNG['sys_expe_found_ships_2_1'] . '<br><br>' . $LNG['sys_expe_found_ships_nothing'];
$expedition = array(
    array('ress_1', $LNG['sys_expe_found_ress_1_1']),
    array('dm_2', $LNG['sys_expe_found_dm_2_3']),
    array('ships', $expShips),
    array('ships_none', $expShipsNone),
    array('nothing', $LNG['sys_expe_nothing_6']),
    array('slow', $LNG['sys_expe_time_slow_2']),
    array('fast', $LNG['sys_expe_time_fast_1']),
    array('lost', $LNG['sys_expe_lost_fleet_3']),
    array('attack', $LNG['sys_expe_attack_1_2_3']),
    array('ress_3', $LNG['sys_expe_found_ress_3_2']),
);

// ---------------------------------------------------------------- transport / recycle / stay / returns
$fT = fleet(2, 68, 5, 2, 68, 6, 1, array(500000, 250000, 100000, 0));
$trOwner = sprintf($LNG['sys_tran_mess_owner'], 'Colony', GetTargetAddressLink($fT, ''), pretty_number(500000), $LNG['tech'][901], pretty_number(250000), $LNG['tech'][902], pretty_number(100000), $LNG['tech'][903]);
$fF = fleet(2, 70, 4, 2, 68, 5, 1, array(1000, 2000, 3000, 0));
$trUser = sprintf($LNG['sys_tran_mess_user'], 'Kovacs Prime', GetStartAddressLink($fF, ''), 'Главная планета', GetTargetAddressLink($fF, ''), pretty_number(1000), $LNG['tech'][901], pretty_number(2000), $LNG['tech'][902], pretty_number(3000), $LNG['tech'][903]);
$recy = sprintf($LNG['sys_recy_gotten'], pretty_number(4145000), $LNG['tech'][901], pretty_number(2072500), $LNG['tech'][902]);
$fS = fleet(2, 68, 5, 2, 68, 7, 1, array(10, 20, 30, 0));
$stay = sprintf($LNG['sys_stat_mess'], GetTargetAddressLink($fS, ''), pretty_number(10), $LNG['tech'][901], pretty_number(20), $LNG['tech'][902], pretty_number(30 + 59), $LNG['tech'][903]);
// returns (type 4)
$fA = fleet(2, 68, 5, 2, 70, 4, 1, array(12053668, 5251102, 1825031, 0));
$retAttack = sprintf($LNG['sys_fleet_won'], 'Главная планета', GetTargetAddressLink($fA, ''), pretty_number(12053668), $LNG['tech'][901], pretty_number(5251102), $LNG['tech'][902], pretty_number(1825031), $LNG['tech'][903]);
$retTransport = sprintf($LNG['sys_tran_mess_back'], 'Главная планета', GetStartAddressLink($fT, ''));
$fR = fleet(2, 68, 5, 2, 87, 8, 2, array(4145000, 2072500, 0, 0));
$retRecycle = sprintf($LNG['sys_tran_mess_owner'], 'Главная планета', GetStartAddressLink($fR, ''), pretty_number(4145000), $LNG['tech'][901], pretty_number(2072500), $LNG['tech'][902], pretty_number(0), $LNG['tech'][903]);
$retExpe = sprintf($LNG['sys_expe_back_home'], $LNG['tech'][901], pretty_number(1254000), $LNG['tech'][902], pretty_number(0), $LNG['tech'][903], pretty_number(0), $LNG['tech'][921], pretty_number(450));
$retStay = sprintf($LNG['sys_stat_mess'], GetStartAddressLink($fS, ''), pretty_number(0), $LNG['tech'][901], pretty_number(0), $LNG['tech'][902], pretty_number(0), $LNG['tech'][903]);
$colo = sprintf($LNG['sys_colo_allisok'], GetTargetAddressLink(fleet(2, 68, 5, 2, 68, 9), ''));
$buildFail = sprintf($LNG['sys_notenough_money'], 'Colony', 254103, 2, 68, 6, $LNG['tech'][15], pretty_number(1200), $LNG['tech'][901], pretty_number(50), $LNG['tech'][902], pretty_number(0), $LNG['tech'][903], pretty_number(1000000), $LNG['tech'][901], pretty_number(500000), $LNG['tech'][902], pretty_number(100000), $LNG['tech'][903]);

// ---------------------------------------------------------------- page.messages.view.tpl renderer
function msg($id, $time, $from, $subject, $text, $type, $unread = 1, $sender = 0) {
    return array('id' => $id, 'time' => tdate($time), 'from' => $from, 'subject' => $subject, 'sender' => $sender,
        'type' => $type, 'unread' => $unread, 'text' => $text);
}
function view($SRC, $LNG, $cat, $list, $page = 1, $maxPage = 1) {
    $s = smarty($SRC);
    $s->assign(array('LNG' => $LNG, 'dpath' => './styles/theme/gow/', 'MessID' => $cat, 'MessageCount' => count($list),
        'MessageList' => $list, 'page' => $page, 'maxPage' => $maxPage));
    return $s->fetch('extends:layout.ajax.tpl|page.messages.view.tpl');
}
$Q = $LNG['sys_mess_tower'];
$views = array(
    0 => array(array(
        msg(520301, $T0 + 2400, $LNG['sys_mess_qg'], $LNG['sys_mess_spy_report'], $spy2, 0, 1),
        msg(520298, $T0 + 1800, $LNG['sys_mess_qg'], $LNG['sys_mess_spy_report'], $spy1, 0, 1),
        msg(520290, $T0 + 1500, $LNG['sys_mess_spy_control'], $LNG['sys_mess_spy_activity'], $spyDet, 0, 0),
    )),
    3 => array(array(
        msg(520410, $T0 + 3600, $Q, $LNG['sys_mess_attack_report'], $cmb1, 3, 1),
        msg(520402, $T0 + 3300, $Q, $LNG['sys_mess_attack_report'], $cmb2, 3, 1),
        msg(520399, $T0 + 3000, $Q, $LNG['sys_mess_attack_report'], $cmb3, 3, 0),
        msg(520390, $T0 + 2700, $Q, $LNG['sys_irak_subject'], $mip, 3, 0),
    )),
    5 => array(array(
        msg(520510, $T0 + 4000, $Q, $LNG['sys_mess_transport'], $trOwner, 5),
        msg(520509, $T0 + 3950, $Q, $LNG['sys_mess_transport'], $trUser, 5),
        msg(520505, $T0 + 3900, $Q, $LNG['sys_recy_report'], $recy, 5),
        msg(520501, $T0 + 3850, $Q, $LNG['sys_stat_mess_stay'], $stay, 5, 0),
    )),
    4 => array(array(
        msg(520610, $T0 + 5000, $Q, $LNG['sys_mess_fleetback'], $retAttack, 4),
        msg(520609, $T0 + 4900, $Q, $LNG['sys_mess_fleetback'], $retTransport, 4),
        msg(520608, $T0 + 4800, $Q, $LNG['sys_mess_fleetback'], $retRecycle, 4),
        msg(520607, $T0 + 4700, $Q, $LNG['sys_mess_fleetback'], $retExpe, 4),
        msg(520606, $T0 + 4600, $Q, $LNG['sys_mess_fleetback'], $retStay, 4),
        msg(520605, $T0 + 4500, $LNG['sys_colo_mess_from'], $LNG['sys_colo_mess_report'], $colo, 4, 0),
    )),
    99 => array(array(
        msg(520700, $T0 + 6000, $LNG['sys_buildlist'], $LNG['sys_buildlist_fail'], $buildFail, 99),
    )),
    1 => array(array(
        msg(520800, $T0 + 6100, 'Kovacs [2:70:4]', 'Re:hello', "Hi neighbour,<br />\nno attack please :)", 1, 1, 5512),
    )),
    999 => array(array(
        msg(520801, $T0 + 6200, 'Kovacs [2:70:4]', 'hello', 'Hello!', 1, 0, 4377),
    )),
);
$expList = array();
foreach ($expedition as $k => $e) $expList[] = msg(520900 + 20 - $k, $T0 + 7000 - $k * 60, $Q, $LNG['sys_expe_report'], $e[1], 15, $k < 3 ? 1 : 0);
$views[15] = array($expList, 1, 2);

$written = array();
foreach ($views as $cat => $v) {
    $html = view($SRC, $LNG, $cat, $v[0], isset($v[1]) ? $v[1] : 1, isset($v[2]) ? $v[2] : 1);
    $file = "messages-upstream-view-cat$cat.html";
    file_put_contents("$FIX/$file", sprintf($BANNER, "AJAX fragment of GET game.php?page=messages&mode=view&messcat=$cat&site=1&ajax=1 (layout.ajax.tpl = bare content block)") . $html);
    $written[] = $file;
    $fragments[$cat] = $html;
}

// ---------------------------------------------------------------- live-synthetic: real page skeleton + upstream rows in the LIVE wrapper markup
// Live differences [REAL messages-spy.html]: <div class="mainRS"> around #messagestable, class="hard-table".
function liveWrap($frag) {
    $frag = str_replace('<table id="messagestable" style="width:760px;">', "<div class=\"mainRS\">\n<table id=\"messagestable\" class=\"hard-table\" style=\"width:760px;\">", $frag);
    return preg_replace('#</table>\s*</form>\s*$#', "</table>\n</div>\n</form>", $frag);
}
$real = file_get_contents("$REAL/messages-spy.html");
$start = strpos($real, '<form action="https://ogamex.eu/Aeternum/game.php?page=messages" method="post">');
$end = strpos($real, '</form>', $start) + strlen('</form>');
foreach (array(3, 15, 5, 4) as $cat) {
    $page = substr($real, 0, $start) . "<!-- UPSTREAM-DERIVED list (category $cat) inserted below; everything else is the real page -->\n"
          . liveWrap($fragments[$cat]) . substr($real, $end);
    $page = preg_replace('/(<html[^>]*>)/', "$1\n" . sprintf($BANNER, "Skeleton = real eu/pages/messages-spy.html; the message list is upstream-rendered category $cat."), $page, 1);
    $file = "messages-live-synthetic-cat$cat.html";
    file_put_contents("$FIX/$file", $page);
    $written[] = $file;
}

// ---------------------------------------------------------------- combat report popup (ShowRaportPage.class.php + shared.mission.raport.tpl)
function ships($a) { $o = array(); foreach ($a as $id => $n) $o[$id] = array($n[0], $n[1], $n[2], $n[3]); return $o; }
$raport = array(
    'mode' => 0, 'time' => tdate($T0 + 3600 - 60 * 6),
    'start' => array(2, 68, 5, 1), 'koords' => array(2, 70, 4, 1),
    'units' => array(36000, 1985000), 'debris' => array(901 => 495000, 902 => 225000),
    'steal' => array(901 => 12053668, 902 => 5251102, 903 => 1825031), 'result' => 'a',
    'moon' => array('moonName' => 'Moon', 'moonChance' => 7, 'moonDestroyChance' => 0, 'moonDestroySuccess' => 0, 'fleetDestroyChance' => 0, 'fleetDestroySuccess' => 0),
    'additionalInfo' => '',
    'players' => array(
        4377 => array('name' => 'vodoleyko1992', 'koords' => array(2, 68, 5, 1), 'tech' => array(140, 130, 150)),
        5512 => array('name' => 'Kovacs', 'koords' => array(2, 70, 4, 1), 'tech' => array(100, 90, 110)),
    ),
    'rounds' => array(
        array('attacker' => array(array('userID' => 4377, 'ships' => ships(array(203 => array(400, 12, 60, 3000), 207 => array(150, 2400, 480, 15000))))),
              'defender' => array(array('userID' => 5512, 'ships' => ships(array(204 => array(800, 100, 20, 800), 401 => array(1500, 160, 40, 400), 402 => array(900, 200, 50, 400))))),
              'info' => array(1404000, 59200, 680000, 115000)),
        array('attacker' => array(array('userID' => 4377, 'ships' => ships(array(203 => array(388, 12, 60, 3000), 207 => array(150, 2400, 480, 15000))))),
              'defender' => array(array('userID' => 5512, 'ships' => ships(array(401 => array(210, 160, 40, 400), 402 => array(35, 200, 50, 400))))),
              'info' => array(1398000, 8400, 40600, 30000)),
        array('attacker' => array(array('userID' => 4377, 'ships' => ships(array(203 => array(388, 12, 60, 3000), 207 => array(150, 2400, 480, 15000))))),
              'defender' => array(array('userID' => 5512, 'ships' => array()))),
    ),
);
function raportPage($SRC, $LNG, $raport, $info = null, $title = '') {
    $s = smarty($SRC);
    $s->assign(array('LNG' => $LNG, 'Raport' => $raport, 'pageTitle' => $title));
    if ($info) $s->assign('Info', $info);
    $body = $s->fetch('extends:layout.ajax.tpl|shared.mission.raport.tpl');
    // layout.popup.tpl = main.header.tpl(bodyclass="popup") + <div id="content">…</div> + main.footer.tpl; header/footer shortened here.
    return "<!DOCTYPE html>\n<html lang=\"en\" class=\"no-js\">\n<head>\n\t<title>$title - Aeternum (New) - Aeterum (New)</title>\n\t<meta name=\"generator\" content=\"GALAXYZ 1.8.git\">\n"
         . "\t<meta http-equiv=\"content-type\" content=\"text/html; charset=UTF-8\">\n\t<script type=\"text/javascript\">\n\tvar serverTime \t= new Date(2026, 9, 30, 10, 05, 12);\n\tvar queryString\t= \"page=raport\";\n\t</script>\n</head>\n"
         . "<body id=\"raport\" class=\"popup\">\n<div id=\"content\">" . $body . "</div>\n</body>\n</html>\n";
}
file_put_contents("$FIX/messages-upstream-raport.html", sprintf($BANNER, "GET game.php?page=raport&raport=$RID1 (popup window; head/footer abbreviated)") . raportPage($SRC, $LNG, $raport, null, $LNG['sys_mess_attack_report']));
$written[] = 'messages-upstream-raport.html';
$hof = $raport;
file_put_contents("$FIX/messages-upstream-raport-battlehall.html", sprintf($BANNER, "GET game.php?page=raport&mode=battlehall&raport=$RID1 (Hall of Fame view: coordinates masked as [XX:XX:XX])") . raportPage($SRC, $LNG, $hof, array('vodoleyko1992', 'Kovacs'), $LNG['lm_topkb']));
$written[] = 'messages-upstream-raport-battlehall.html';
// a defender-won report with a destroyed attacker (sys_destroyed) for the "lost contact" rule
$r2 = $raport; $r2['result'] = 'r'; $r2['steal'] = array(901 => 0, 902 => 0, 903 => 0); $r2['moon']['moonName'] = null; $r2['moon']['moonChance'] = 0;
$r2['units'] = array(2300000, 120000); $r2['debris'] = array(901 => 0, 902 => 0);
$r2['rounds'] = array($raport['rounds'][0], array('attacker' => array(array('userID' => 4377, 'ships' => array())), 'defender' => $raport['rounds'][1]['defender']));
$r2['rounds'][0]['info'] = array(1404000, 59200, 680000, 115000);
file_put_contents("$FIX/messages-upstream-raport-defender-won.html", sprintf($BANNER, "GET game.php?page=raport&raport=$RID3 (defender won, attacker destroyed in round 1)") . raportPage($SRC, $LNG, $r2, null, $LNG['sys_mess_attack_report']));
$written[] = 'messages-upstream-raport-defender-won.html';

// ---------------------------------------------------------------- battle hall (ShowBattleHallPage.class.php + page.battleHall.default.tpl)
$s = smarty($SRC);
$top = array(
    array('result' => 'a', 'date' => tdate($T0 - 86400 * 3), 'time' => 86400 * 3, 'units' => 98500000000, 'rid' => 'aaaabbbbccccddddeeeeffff00001111', 'attacker' => 'Zeus & Hera', 'defender' => 'Titan'),
    array('result' => 'r', 'date' => tdate($T0 - 86400 * 9), 'time' => 86400 * 9, 'units' => 5400000000, 'rid' => '22223333444455556666777788889999', 'attacker' => 'Raider', 'defender' => 'Turtle'),
    array('result' => 'w', 'date' => tdate($T0 - 86400 * 20), 'time' => 86400 * 20, 'units' => 1200000000, 'rid' => 'abcdefabcdefabcdefabcdefabcdef12', 'attacker' => 'A', 'defender' => 'B'),
);
$s->assign(array('LNG' => $LNG, 'TopKBList' => $top, 'sort' => 'DESC', 'order' => 'units'));
$bh = $s->fetch('extends:layout.ajax.tpl|page.battleHall.default.tpl');
file_put_contents("$FIX/messages-upstream-battleHall.html", sprintf($BANNER, "content block of GET game.php?page=battleHall (full layout omitted)") . "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"UTF-8\"><title>Hall of Fame</title></head>\n<body id=\"battleHall\" class=\"full\"><div id=\"inhalt\">\n$bh\n</div></body></html>\n");
$written[] = 'messages-upstream-battleHall.html';

// ---------------------------------------------------------------- copies of the REAL pages
foreach (array('messages-spy.html' => 'messages-real-spy.html', 'messages-all.html' => 'messages-real-all.html') as $a => $b) {
    copy("$REAL/$a", "$FIX/$b");
    $written[] = $b;
}

// ---------------------------------------------------------------- texts (classification data), en + ru
$keys = array('sys_mess_tower', 'sys_mess_qg', 'sys_mess_spy_report', 'sys_mess_spy_control', 'sys_mess_spy_activity', 'sys_mess_attack_report',
    'sys_irak_subject', 'sys_mess_transport', 'sys_recy_report', 'sys_stat_mess_stay', 'sys_mess_fleetback', 'sys_expe_report',
    'sys_colo_mess_from', 'sys_colo_mess_report', 'sys_buildlist', 'sys_techlist', 'sys_buildlist_fail',
    'sys_mess_head', 'sys_mess_spy_lostproba', 'sys_mess_spy_destroyed', 'sys_mess_spy_ennemyfleet', 'sys_mess_spy_seen_at', 'sys_mess_spy_report_moon',
    'sys_tran_mess_owner', 'sys_tran_mess_user', 'sys_tran_mess_back', 'sys_recy_gotten', 'sys_stat_mess', 'sys_fleet_won',
    'sys_expe_back_home', 'sys_expe_back_home_without_dm', 'sys_expe_back_home_with_dm', 'sys_expe_found_ships_nothing', 'sys_expe_attackname_1', 'sys_expe_attackname_2',
    'sys_colo_allisok', 'sys_colo_badpos', 'sys_colo_notfree', 'sys_colo_maxcolo', 'sys_colo_notech',
    'sys_irak_mess', 'sys_irak_def', 'sys_irak_no_def', 'sys_irak_no_att',
    'sys_attack_title', 'sys_destruc_title', 'sys_attack_attacker_pos', 'sys_attack_defender_pos', 'sys_ship_type', 'sys_ship_count', 'sys_ship_weapon',
    'sys_ship_shield', 'sys_ship_armour', 'sys_destroyed', 'sys_attacker_won', 'sys_defender_won', 'sys_both_won', 'sys_stealed_ressources', 'sys_and',
    'sys_attacker_lostunits', 'sys_defender_lostunits', 'sys_units', 'debree_field_1', 'debree_field_2', 'sys_moonproba', 'sys_moonbuilt',
    'fleet_attack_1', 'fleet_attack_2', 'fleet_defs_1', 'fleet_defs_2', 'damage', 'sys_raport_not_found', 'sys_raport_lost_contact',
    'sys_lost', 'sys_gain', 'sys_debris', 'type_planet_short_1', 'type_planet_short_2', 'type_planet_short_3', 'type_mission_1', 'fl_simulate', 'php_tdformat');
$texts = array('_meta' => array('generatedBy' => 'specs/galaxyz/tools/messages/gen_messages_fixtures.php', 'source' => 'UPSTREAM language/{en,ru}/{FLEET,INGAME,TECH,L18N}.php; the fork may have edited strings (en spy strings confirmed REAL in messages-spy.html)'));
foreach (array('en' => $LNG, 'ru' => $LNGRU) as $lang => $L) {
    $t = array('mg_type' => $L['mg_type'], 'months' => isset($L['months']) ? $L['months'] : null, 'strings' => array(), 'expedition' => array(), 'classHeads' => array(), 'shortNames' => $L['shortNames']);
    foreach ($keys as $k) if (isset($L[$k])) $t['strings'][$k] = $L[$k];
    foreach ($L as $k => $v) {
        if (!is_string($v)) continue;
        if (preg_match('/^sys_expe_(nothing|found_ress|found_dm|found_ships|time_slow|time_fast|lost_fleet|attack|blackholl)_?(\d.*)?$/', $k, $m) && $k !== 'sys_expe_found_ships_nothing') {
            $outcome = array('nothing' => 'nothing', 'found_ress' => 'resources', 'found_dm' => 'darkmatter', 'found_ships' => 'ships', 'time_slow' => 'delay',
                'time_fast' => 'speedup', 'lost_fleet' => 'fleet_lost', 'attack' => 'battle', 'blackholl' => 'fleet_lost')[$m[1]];
            if (preg_match('/^sys_expe_attack_(\d)_/', $k, $mm)) $outcome = $mm[1] == '1' ? 'battle_pirates' : 'battle_aliens';
            $t['expedition'][$k] = array('outcome' => $outcome, 'text' => $v);
        }
    }
    foreach (array(0, 100, 200, 400, 500, 900) as $c) $t['classHeads'][$c] = $L['tech'][$c];
    $texts[$lang] = $t;
}
file_put_contents("$FIX/messages-texts.json", json_encode($texts, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
$written[] = 'messages-texts.json';
echo "wrote " . count($written) . " files:\n  " . implode("\n  ", $written) . "\n";

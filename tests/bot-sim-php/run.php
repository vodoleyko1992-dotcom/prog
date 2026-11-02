<?php
/**
 * tests/bot-sim-php/run.php — runs the UPSTREAM 2Moons calculateAttack()/calculateSteal() on JSON cases with injected
 * random numbers, so that OGX.botSim (ogamex-bot/modules/botsim/botsim.js) can be compared with the PHP source exactly.
 *
 *   php run.php <case.json | cases.json> [--src <2Moons root>] [--tmp <dir>]
 *
 * Input: one case object or { "cases": [case, ...] }. Case:
 *   { name, units: [{ id, metal, crystal, deuterium, attack, shield, capacity, rf: [[target, shots], ...] }, ...],
 *     attackers: [Side], defenders: [Side], FleetTF, DefTF, planet: { metal, crystal, deuterium },
 *     numbers: [int, ...], ranges?: [[min, max], ...] }
 *   Side = { tech: { weapons, shielding, armour }, factor: { Attack, Defensive, Shield, ShipStorage },
 *            units: [[id, n], ...] (PHP array order), carried: { metal, crystal, deuterium } }
 * The upstream files are copied as text into the tmp dir with every rand( / mt_rand( call rewritten to ogx_rand(, which
 * pops the next number of the case (asserting the [min, max] of each call when ranges are given, and that the list is
 * used up exactly). The upstream tree is never written.
 * Output (stdout): JSON array of { name, won, rounds, attackers: [[[id, n], ...]], defenders: [...], debris, unitLost,
 *   steal: { metal, crystal, deuterium }, used } or { name, error }.
 */
error_reporting(E_ALL);
ini_set('serialize_precision', '-1');
ini_set('precision', '17');

$args = $argv; array_shift($args);
$input = null; $src = getenv('OGX_2MOONS_SRC') ?: realpath(__DIR__ . '/../../../src/2Moons'); $tmp = __DIR__ . '/../out/bot-sim-php';
for ($i = 0; $i < count($args); $i++) {
	if ($args[$i] === '--src') { $src = $args[++$i]; continue; }
	if ($args[$i] === '--tmp') { $tmp = $args[++$i]; continue; }
	$input = $args[$i];
}
if (!$input) { fwrite(STDERR, "usage: php run.php <cases.json> [--src dir] [--tmp dir]\n"); exit(2); }
$fnDir = $src ? $src . '/includes/classes/missions/functions' : '';
if (!$src || !is_file($fnDir . '/calculateAttack.php') || !is_file($fnDir . '/calculateSteal.php')) {
	fwrite(STDERR, "run.php: upstream 2Moons not found (set OGX_2MOONS_SRC or --src): $src\n"); exit(3);
}
if (!is_dir($tmp)) mkdir($tmp, 0777, true);

define('MAX_ATTACK_ROUNDS', 6);   // includes/constants.php

$OGX_NUMS = array(); $OGX_RANGES = null; $OGX_POS = 0; $OGX_ERR = null;
function ogx_rand($min, $max) {
	global $OGX_NUMS, $OGX_RANGES, $OGX_POS, $OGX_ERR;
	if ($OGX_POS >= count($OGX_NUMS)) { throw new RuntimeException("random number list exhausted at call #$OGX_POS rand($min, $max)"); }
	if ($OGX_RANGES !== null) {
		$r = $OGX_RANGES[$OGX_POS];
		if ((int)$r[0] !== (int)$min || (int)$r[1] !== (int)$max) throw new RuntimeException("call #$OGX_POS: PHP rand($min, $max) but the list was made for rand($r[0], $r[1])");
	}
	$v = $OGX_NUMS[$OGX_POS++];
	if ($v < $min || $v > $max) throw new RuntimeException("call #$OGX_POS: number $v outside rand($min, $max)");
	return $v;
}

foreach (array('calculateAttack.php', 'calculateSteal.php') as $f) {
	$code = file_get_contents($fnDir . '/' . $f);
	$n = 0;
	$code = preg_replace('/\b(?:mt_)?rand\s*\(/', 'ogx_rand(', $code, -1, $n);
	if ($f === 'calculateAttack.php' && $n < 3) { fwrite(STDERR, "run.php: expected >= 3 rand calls in $f, got $n\n"); exit(4); }
	file_put_contents($tmp . '/' . $f, $code);
	require_once $tmp . '/' . $f;
}

function ogx_side($s, $isAttacker) {
	$tech = isset($s['tech']) ? $s['tech'] : array();
	$factor = isset($s['factor']) ? $s['factor'] : array();
	$units = array();
	foreach ($s['units'] as $p) { $units[(int)$p[0]] = $p[1]; }
	$carried = isset($s['carried']) ? $s['carried'] : array();
	return array(
		'player' => array(
			'military_tech' => isset($tech['weapons']) ? $tech['weapons'] : 0,
			'defence_tech'  => isset($tech['shielding']) ? $tech['shielding'] : 0,
			'shield_tech'   => isset($tech['armour']) ? $tech['armour'] : 0,
			'factor' => array(
				'Attack'      => isset($factor['Attack']) ? $factor['Attack'] : 0,
				'Defensive'   => isset($factor['Defensive']) ? $factor['Defensive'] : 0,
				'Shield'      => isset($factor['Shield']) ? $factor['Shield'] : 0,
				'ShipStorage' => isset($factor['ShipStorage']) ? $factor['ShipStorage'] : 0,
			),
		),
		'fleetDetail' => array(
			'fleet_resource_metal'     => isset($carried['metal']) ? $carried['metal'] : 0,
			'fleet_resource_crystal'   => isset($carried['crystal']) ? $carried['crystal'] : 0,
			'fleet_resource_deuterium' => isset($carried['deuterium']) ? $carried['deuterium'] : 0,
		),
		'unit' => $units,
	);
}
function ogx_pairs($units) { $o = array(); foreach ($units as $id => $n) $o[] = array($id, $n); return $o; }

$data = json_decode(file_get_contents($input), true);
if ($data === null) { fwrite(STDERR, "run.php: bad JSON\n"); exit(2); }
$cases = isset($data['cases']) ? $data['cases'] : array($data);
$out = array();
foreach ($cases as $c) {
	global $pricelist, $CombatCaps, $resource;
	$pricelist = array(); $CombatCaps = array();
	$resource = array(901 => 'metal', 902 => 'crystal', 903 => 'deuterium');
	foreach ($c['units'] as $u) {
		$id = (int)$u['id'];
		$pricelist[$id] = array('cost' => array(901 => $u['metal'], 902 => $u['crystal'], 903 => $u['deuterium']), 'capacity' => $u['capacity']);
		$sd = array();
		foreach ($u['rf'] as $p) $sd[(int)$p[0]] = $p[1];
		$CombatCaps[$id] = array('attack' => $u['attack'], 'shield' => $u['shield'], 'sd' => $sd);
	}
	$OGX_NUMS = $c['numbers']; $OGX_RANGES = isset($c['ranges']) ? $c['ranges'] : null; $OGX_POS = 0;
	$attackers = array(); $defenders = array();
	foreach ($c['attackers'] as $i => $s) $attackers[100 + $i] = ogx_side($s, true);
	foreach ($c['defenders'] as $i => $s) $defenders[200 + $i] = ogx_side($s, false);
	try {
		$r = calculateAttack($attackers, $defenders, $c['FleetTF'], $c['DefTF']);
		$steal = calculateSteal($attackers, $c['planet'], true);
		if ($OGX_POS !== count($OGX_NUMS)) throw new RuntimeException('unused random numbers: used ' . $OGX_POS . ' of ' . count($OGX_NUMS));
		$out[] = array(
			'name' => isset($c['name']) ? $c['name'] : null,
			'won' => $r['won'],
			'rounds' => count($r['rw']),
			'attackers' => array_values(array_map(function ($a) { return ogx_pairs($a['unit']); }, $attackers)),
			'defenders' => array_values(array_map(function ($d) { return ogx_pairs($d['unit']); }, $defenders)),
			'debris' => array(
				'attacker' => array('metal' => $r['debris']['attacker'][901], 'crystal' => $r['debris']['attacker'][902]),
				'defender' => array('metal' => $r['debris']['defender'][901], 'crystal' => $r['debris']['defender'][902]),
			),
			'unitLost' => $r['unitLost'],
			'steal' => array('metal' => $steal[901], 'crystal' => $steal[902], 'deuterium' => $steal[903]),
			'used' => $OGX_POS,
		);
	} catch (Throwable $e) {
		$out[] = array('name' => isset($c['name']) ? $c['name'] : null, 'error' => $e->getMessage());
	}
}
echo json_encode($out, JSON_PRESERVE_ZERO_FRACTION), "\n";

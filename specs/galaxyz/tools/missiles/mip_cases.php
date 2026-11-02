<?php
// Expected values for tests/gz-mod-inf-missiles.test.js: runs the UPSTREAM 2Moons 1.8 calculateMIPAttack
// (includes/classes/missions/functions/calculateMIPAttack.php, copied verbatim below) and the interceptor branch of
// MissionCaseMIP::TargetEvent on fixed cases. Prices/attack = install/install.sql vars rows 401-411, 502, 503.
//   php specs/galaxyz/tools/missiles/mip_cases.php > specs/galaxyz/tools/missiles/mip_cases.json
$pricelist = array(); $CombatCaps = array();
$vars = array(401=>array(2000,0),402=>array(1500,500),403=>array(6000,2000),404=>array(20000,15000),405=>array(2000,6000),
  406=>array(50000,50000),407=>array(10000,10000),408=>array(50000,50000),409=>array(10000000,5000000),410=>array(15000000,15000000),
  411=>array(5000000000,2000000000),502=>array(8000,0),503=>array(12500,2500));
foreach ($vars as $id => $c) $pricelist[$id] = array('cost' => array(901 => $c[0], 902 => $c[1]));
$CombatCaps[503] = array('attack' => 12000);
function calculateMIPAttack($TargetDefTech, $OwnerAttTech, $missiles, $targetDefensive, $firstTarget, $defenseMissles)
{
	global $pricelist, $CombatCaps;
	$destroyShips		= array();
	$countMissles 		= $missiles - $defenseMissles;
	if($countMissles == 0) { return $destroyShips; }
	$totalAttack 		= $countMissles * $CombatCaps[503]['attack'] * (1 +  0.1 * $OwnerAttTech);
	if(isset($targetDefensive[$firstTarget]))
	{
		$firstTargetData	= array($firstTarget => $targetDefensive[$firstTarget]);
		unset($targetDefensive[$firstTarget]);
		$targetDefensive	= $firstTargetData + $targetDefensive;
	}
	foreach($targetDefensive as $element => $count)
	{
		$elementStructurePoints = ($pricelist[$element]['cost'][901] + $pricelist[$element]['cost'][902]) * (1 + 0.1 * $TargetDefTech) / 10;
		$destroyCount           = floor($totalAttack / $elementStructurePoints);
		$destroyCount           = min($destroyCount, $count);
		$totalAttack  	       -= $destroyCount * $elementStructurePoints;
		$destroyShips[$element]	= $destroyCount;
		if($totalAttack <= 0) { return $destroyShips; }
	}
	return $destroyShips;
}
// MissionCaseMIP::TargetEvent, the part that decides interceptors and the primary target
function strike($c) {
	$order = array(401,402,403,404,405,406,407,408,409,410,411,502,503);
	$def = array(); foreach ($order as $id) $def[$id] = isset($c['def'][$id]) ? $c['def'][$id] : 0;
	$abm = $def[502]; unset($def[502]);
	$t = $c['target'];
	$primary = (!in_array($t, $order) || $t == 502 || $t == 0) ? 401 : $t;
	if ($abm >= $c['n']) return array('intercepted' => $c['n'], 'abmLeft' => $abm - $c['n'], 'destroyed' => new stdClass());
	$def = array_filter($def);
	$res = empty($def) ? array() : array_filter(calculateMIPAttack($c['shield'], $c['weapons'], $c['n'], $def, $primary, $abm));
	$o = new stdClass(); foreach ($res as $k => $v) $o->$k = (int)$v;
	return array('intercepted' => $abm, 'abmLeft' => 0, 'destroyed' => $o);
}
$cases = array(
  array('n'=>10,'weapons'=>0,'shield'=>0,'target'=>0,'def'=>array(401=>100)),
  array('n'=>25,'weapons'=>14,'shield'=>13,'target'=>0,'def'=>array(401=>1500,402=>900,403=>120,404=>12,407=>1,408=>1,502=>20)),
  array('n'=>20,'weapons'=>14,'shield'=>13,'target'=>0,'def'=>array(401=>1500,402=>900,403=>120,404=>12,407=>1,408=>1,502=>20)),
  array('n'=>15,'weapons'=>14,'shield'=>13,'target'=>0,'def'=>array(401=>1500,402=>900,502=>20)),
  array('n'=>60,'weapons'=>14,'shield'=>13,'target'=>404,'def'=>array(401=>1500,402=>900,403=>120,404=>12,407=>1,408=>1,502=>20)),
  array('n'=>500,'weapons'=>20,'shield'=>18,'target'=>406,'def'=>array(401=>30000,404=>2000,406=>500,408=>1,503=>50,502=>100)),
  array('n'=>7,'weapons'=>3,'shield'=>7,'target'=>502,'def'=>array(402=>5,405=>3,407=>1)),
  array('n'=>3,'weapons'=>0,'shield'=>0,'target'=>0,'def'=>array(410=>2)),
  array('n'=>40000,'weapons'=>25,'shield'=>22,'target'=>410,'def'=>array(401=>1000000,410=>500,409=>1,411=>1,502=>5000)),
  array('n'=>12,'weapons'=>10,'shield'=>10,'target'=>0,'def'=>array(503=>40)),
);
$out = array();
foreach ($cases as $c) $out[] = array('case' => $c, 'php' => strike($c));
echo json_encode($out, JSON_PRETTY_PRINT), "\n";

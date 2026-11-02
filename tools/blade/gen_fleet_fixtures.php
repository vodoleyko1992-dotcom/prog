<?php
/**
 * Renders fleet fixtures from the real OgameX Blade templates
 * (fleet/index, fleet/movement + partials/movement-row, fleetevents/*, phalanx/content)
 * with stubbed sample data. Controller logic (FleetController, FleetEventsController,
 * PhalanxService) is ported line by line so the view models match what OgameX builds.
 *
 * Usage: php gen_fleet_fixtures.php <fixtures-dir>
 */
require __DIR__ . '/blade.php';
require_once OGX_SRC . '/app/Enums/FleetMissionStatus.php';
require_once OGX_SRC . '/app/GameConstants/UniverseConstants.php';

date_default_timezone_set('UTC'); // config/app.php: timezone = UTC

use OGame\Facades\AppUtil;
use OGame\Services\PlanetService;
use OGame\Services\PlanetListService;
use OGame\Services\PlayerService;
use OGame\Services\SettingsService;
use OGame\Models\Resource;
use OGame\Models\Resources;
use OGame\Models\Enums\PlanetType;
use OGame\Models\Planet\Coordinate;
use OGame\Enums\FleetMissionStatus;

$outDir = rtrim($argv[1] ?? (__DIR__ . '/../../fixtures'), '/');
const CSRF = 'Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e';
$NOW = gmmktime(0, 57, 17, 10, 30, 2026); // 2026-10-30 00:57:17 UTC, same "now" as layout fixtures

// ------------------------------------------------------------------ extra stubs
// SettingsService: fleet speeds per mission class + universe size
class FleetSettings extends SettingsService
{
    public function numberOfGalaxies() { return 9; }
    public function fleetSpeedWar() { return 1; }
    public function fleetSpeedPeaceful() { return 1; }
    public function fleetSpeedHolding() { return 1; }
    public function allianceCombatSystemOn() { return true; }
}

/** Ship catalogue in ObjectService::getShipObjects() order (MilitaryShipObjects then CivilShipObjects). */
function ships(): array
{
    static $s = null;
    if ($s !== null) { return $s; }
    $rows = [
        // id, machine_name, class_name, [structural, shield, attack, speed, capacity, fuel, fuel_capacity]
        [204, 'light_fighter', 'fighterLight', 12500, 50, 20, null],
        [205, 'heavy_fighter', 'fighterHeavy', 10000, 100, 75, null],
        [206, 'cruiser', 'cruiser', 15000, 800, 300, null],
        [207, 'battle_ship', 'battleship', 10000, 1500, 500, null],
        [215, 'battlecruiser', 'interceptor', 10000, 750, 250, null],
        [211, 'bomber', 'bomber', 4000, 500, 700, null],
        [213, 'destroyer', 'destroyer', 5000, 2000, 1000, null],
        [214, 'deathstar', 'deathstar', 100, 1000000, 1, null],
        [218, 'reaper', 'reaper', 7000, 10000, 1100, null],
        [202, 'small_cargo', 'transporterSmall', 5000, 5000, 10, null],
        [203, 'large_cargo', 'transporterLarge', 7500, 25000, 50, null],
        [208, 'colony_ship', 'colonyShip', 2500, 7500, 100, null],
        [209, 'recycler', 'recycler', 2000, 20000, 300, null],
        [210, 'espionage_probe', 'espionageProbe', 100000000, 0, 1, 5],
        [212, 'solar_satellite', 'solarSatellite', 0, 0, 1, null],
        [217, 'crawler', 'resbuggy', 0, 0, 0, null],
        [219, 'pathfinder', 'explorer', 12000, 10000, 300, null],
    ];
    $s = [];
    foreach ($rows as [$id, $mn, $cn, $speed, $cap, $fuel, $fcap]) {
        $o = new stdClass();
        $o->id = $id; $o->machine_name = $mn; $o->class_name = $cn;
        $o->title = __('t_resources.' . $mn . '.title');
        $o->speed = $speed; $o->capacity = $cap; $o->fuel = $fuel; $o->fuel_capacity = $fcap ?? $cap;
        $s[$mn] = $o;
    }
    return $s;
}
function shipById(int $id) { foreach (ships() as $s) { if ($s->id === $id) { return $s; } } throw new RuntimeException("ship $id"); }

/**
 * Port of SpeedPropertyService / CapacityPropertyService / FuelCapacityPropertyService for the sample
 * player (Collector, combustion 6, impulse 4, hyperspace drive 0, hyperspace tech 2). Keeps PHP's
 * int/float result types because they show up in the JSON (e.g. "fuelConsumption":20.0).
 */
function shipData(stdClass $s, array $r, bool $collector): array
{
    // speed: effective base (speed_upgrade) + drive bonus
    $base = $s->speed;
    $perLevel = 0; $lvl = 0;
    $upgrades = [
        'small_cargo' => [['impulse_drive', 5, 10000]],
        'recycler' => [['impulse_drive', 17, 4000], ['hyperspace_drive', 15, 6000]],
        'pathfinder' => [['impulse_drive', 3, null], ['hyperspace_drive', 3, null]],
        'bomber' => [['hyperspace_drive', 8, 5000]],
        'reaper' => [['hyperspace_drive', 4, null]],
    ][$s->machine_name] ?? [];
    $drivePct = ['combustion_drive' => 10, 'impulse_drive' => 20, 'hyperspace_drive' => 30];
    foreach ($upgrades as [$drive, $need, $newBase]) {
        if (($r[$drive] ?? 0) >= $need) {
            if ($newBase !== null) { $base = $newBase; }
            $perLevel = $drivePct[$drive]; $lvl = $r[$drive];
        }
    }
    if ($perLevel === 0) {
        // fall back to the drive in the object's requirements (last one wins), see objects.jsonl
        $reqDrive = [
            'light_fighter' => 'combustion_drive', 'heavy_fighter' => 'impulse_drive', 'cruiser' => 'impulse_drive',
            'battle_ship' => 'hyperspace_drive', 'battlecruiser' => 'hyperspace_drive', 'bomber' => 'impulse_drive',
            'destroyer' => 'hyperspace_drive', 'deathstar' => 'hyperspace_drive', 'reaper' => 'hyperspace_drive',
            'small_cargo' => 'combustion_drive', 'large_cargo' => 'combustion_drive', 'colony_ship' => 'impulse_drive',
            'recycler' => 'combustion_drive', 'espionage_probe' => 'combustion_drive', 'crawler' => 'combustion_drive',
            'pathfinder' => 'combustion_drive',
        ][$s->machine_name] ?? null;
        if ($reqDrive) { $perLevel = $drivePct[$reqDrive]; $lvl = $r[$reqDrive] ?? 0; }
    }
    $speed = $base + (($base / 100) * ($perLevel * $lvl));
    if ($collector && in_array($s->id, [202, 203], true)) { $speed += (($base / 100) * 100); }

    $pct = 5 * ($r['hyperspace_technology'] ?? 0);
    $cap = $s->capacity + intdiv($s->capacity * $pct, 100);
    if ($collector && in_array($s->id, [202, 203], true)) { $cap += intdiv($s->capacity * 25, 100); }
    $fcap = $s->fuel_capacity + intdiv($s->fuel_capacity * $pct, 100);
    return [
        'id' => $s->id,
        'name' => $s->title,
        'baseFuelCapacity' => $fcap,
        'baseCargoCapacity' => $cap,
        'fuelConsumption' => $s->fuel * 1.0, // CharacterClassService::getDeuteriumConsumptionMultiplier() (float)
        'speed' => $speed,
    ];
}

// ---- UnitCollection stand-in (OGame\GameObjects\Models\Units\UnitCollection) ----
eval('namespace OGame\GameObjects\Models\Units; class UnitCollection { public array $units = []; public function addUnit($o, int $n) { $e = new \stdClass(); $e->unitObject = $o; $e->amount = $n; $this->units[] = $e; } }');
require_once OGX_SRC . '/app/ViewModels/FleetEventRowViewModel.php';
use OGame\GameObjects\Models\Units\UnitCollection;
use OGame\ViewModels\FleetEventRowViewModel;

// ------------------------------------------------------------------ sample universe
function mkPlanet(array $d): PlanetService { return new PlanetService($d); }

$home = mkPlanet([
    'id' => 1, 'name' => 'Homeworld', 'coords' => [1, 42, 8], 'diameter' => 12800,
    'fields_used' => 95, 'fields_max' => 163, 'temp' => [12, 52],
    'levels' => ['robot_factory' => 5, 'metal_mine' => 12, 'shipyard' => 7],
    'res' => ['metal' => 152347.29861111, 'crystal' => 98712.55, 'deuterium' => 41230.871527778],
    'prod' => ['metal' => 4128, 'crystal' => 2187, 'deuterium' => 1043],
    'storage' => ['metal' => 255000, 'crystal' => 140000, 'deuterium' => 75000],
    'energy' => ['max' => 2860, 'used' => 2754],
    'units' => ['light_fighter' => 40, 'cruiser' => 12, 'small_cargo' => 25, 'large_cargo' => 18,
        'colony_ship' => 1, 'recycler' => 6, 'espionage_probe' => 15, 'solar_satellite' => 20],
]);
$moon = mkPlanet([
    'id' => 5, 'name' => 'Moon', 'coords' => [1, 42, 8], 'diameter' => 8660, 'moon' => true,
    'fields_used' => 4, 'fields_max' => 7, 'temp' => [-28, 12],
    'levels' => ['lunar_base' => 2, 'jump_gate' => 1, 'sensor_phalanx' => 2],
    'res' => ['metal' => 12500, 'crystal' => 8300, 'deuterium' => 9000],
    'prod' => ['metal' => 0, 'crystal' => 0, 'deuterium' => 0],
    'storage' => ['metal' => 10000, 'crystal' => 10000, 'deuterium' => 10000],
    'energy' => ['max' => 0, 'used' => 0],
    'units' => [],
]);
$home->d['moonObj'] = $moon;
$moon->d['planetObj'] = $home;
$colony = mkPlanet([
    'id' => 3, 'name' => 'Colony', 'coords' => [2, 118, 12], 'diameter' => 14530,
    'fields_used' => 52, 'fields_max' => 188, 'temp' => [-61, -21], 'building' => true,
    'levels' => ['robot_factory' => 2],
    'res' => ['metal' => 30512.75, 'crystal' => 14876.5, 'deuterium' => 22340.25],
    'prod' => ['metal' => 1560, 'crystal' => 780, 'deuterium' => 690],
    'storage' => ['metal' => 50000, 'crystal' => 50000, 'deuterium' => 50000],
    'energy' => ['max' => 1210, 'used' => 1306],
    'units' => ['small_cargo' => 4, 'espionage_probe' => 2],
]);
$RESEARCH = ['combustion_drive' => 6, 'impulse_drive' => 4, 'hyperspace_drive' => 0, 'hyperspace_technology' => 2,
    'computer_technology' => 5, 'astrophysics' => 4, 'espionage_technology' => 4];
$player = new PlayerService([
    'id' => 108, 'username' => 'Commander Vega', 'class' => 1 /* Collector */, 'maxPlanets' => 8,
    'research' => $RESEARCH,
], new PlanetListService([$home, $colony], [$moon]));

// Foreign planets (owner id/name kept in d[])
$foreign = [
    77 => mkPlanet(['id' => 77, 'name' => 'Farmville', 'coords' => [1, 45, 6], 'owner' => [233, 'Raider42']]),
    41 => mkPlanet(['id' => 41, 'name' => 'Darkstar', 'coords' => [1, 40, 11], 'owner' => [233, 'Raider42']]),
    90 => mkPlanet(['id' => 90, 'name' => 'Haven', 'coords' => [2, 120, 5], 'owner' => [150, 'Nova']]),
    95 => mkPlanet(['id' => 95, 'name' => 'Vortex Prime', 'coords' => [1, 47, 3], 'owner' => [301, 'Vortex']]),
];
foreach ([$home, $moon, $colony] as $p) { $p->d['owner'] = [108, 'Commander Vega']; }
$ALLP = [1 => $home, 5 => $moon, 3 => $colony] + $foreign;
function planetById(int $id) { global $ALLP; return $ALLP[$id] ?? null; }

// ---- fleet_missions rows (only the columns the controllers read) ----
function mission(array $a): stdClass
{
    $m = (object)array_merge([
        'parent_id' => null, 'time_holding' => null, 'union_id' => null, 'union_slot' => null,
        'metal' => 0, 'crystal' => 0, 'deuterium' => 0, 'deuterium_consumption' => 0,
        'planet_id_from' => null, 'planet_id_to' => null, 'processed' => 0, 'canceled' => 0,
    ], $a);
    foreach (ships() as $s) { $m->{$s->machine_name} = $a['ships'][$s->machine_name] ?? 0; }
    unset($m->ships);
    return $m;
}
$N = $NOW;
$MISSIONS = [
    // Own: return trip of a Harvest (8) from debris field 1:42:9 to Homeworld (parent 1190 already processed)
    mission(['id' => 1199, 'user_id' => 108, 'mission_type' => 8, 'parent_id' => 1190,
        'type_from' => 2, 'galaxy_from' => 1, 'system_from' => 42, 'position_from' => 9,
        'type_to' => 1, 'planet_id_to' => 1, 'galaxy_to' => 1, 'system_to' => 42, 'position_to' => 8,
        'time_departure' => $N - 5300, 'time_arrival' => $N + 913,
        'ships' => ['recycler' => 4], 'metal' => 31200, 'crystal' => 18900]),
    // Own: Attack Homeworld -> Farmville (Raider42)
    mission(['id' => 1201, 'user_id' => 108, 'mission_type' => 1,
        'type_from' => 1, 'planet_id_from' => 1, 'galaxy_from' => 1, 'system_from' => 42, 'position_from' => 8,
        'type_to' => 1, 'planet_id_to' => 77, 'galaxy_to' => 1, 'system_to' => 45, 'position_to' => 6,
        'time_departure' => $N - 2000, 'time_arrival' => $N + 2340, 'deuterium_consumption' => 212,
        'ships' => ['light_fighter' => 20, 'large_cargo' => 10]]),
    // Own: Expedition Homeworld -> 1:42:16, 1 h hold, currently in the hold period
    mission(['id' => 1202, 'user_id' => 108, 'mission_type' => 15,
        'type_from' => 1, 'planet_id_from' => 1, 'galaxy_from' => 1, 'system_from' => 42, 'position_from' => 8,
        'type_to' => 4, 'galaxy_to' => 1, 'system_to' => 42, 'position_to' => 16,
        'time_departure' => $N - 3566, 'time_arrival' => $N - 1000, 'time_holding' => 3600, 'deuterium_consumption' => 120,
        'ships' => ['large_cargo' => 10, 'espionage_probe' => 1, 'pathfinder' => 1]]),
    // Own: Transport Colony -> Homeworld with cargo
    mission(['id' => 1203, 'user_id' => 108, 'mission_type' => 3,
        'type_from' => 1, 'planet_id_from' => 3, 'galaxy_from' => 2, 'system_from' => 118, 'position_from' => 12,
        'type_to' => 1, 'planet_id_to' => 1, 'galaxy_to' => 1, 'system_to' => 42, 'position_to' => 8,
        'time_departure' => $N - 3000, 'time_arrival' => $N + 8219, 'deuterium_consumption' => 1580,
        'ships' => ['large_cargo' => 5], 'metal' => 50000, 'crystal' => 30000, 'deuterium' => 10000]),
    // Hostile: Raider42 espionage Darkstar -> Homeworld
    mission(['id' => 1210, 'user_id' => 233, 'mission_type' => 6,
        'type_from' => 1, 'planet_id_from' => 41, 'galaxy_from' => 1, 'system_from' => 40, 'position_from' => 11,
        'type_to' => 1, 'planet_id_to' => 1, 'galaxy_to' => 1, 'system_to' => 42, 'position_to' => 8,
        'time_departure' => $N - 180, 'time_arrival' => $N + 420, 'deuterium_consumption' => 3,
        'ships' => ['espionage_probe' => 3]]),
    // Neutral: Nova transports to Colony
    mission(['id' => 1211, 'user_id' => 150, 'mission_type' => 3,
        'type_from' => 1, 'planet_id_from' => 90, 'galaxy_from' => 2, 'system_from' => 120, 'position_from' => 5,
        'type_to' => 1, 'planet_id_to' => 3, 'galaxy_to' => 2, 'system_to' => 118, 'position_to' => 12,
        'time_departure' => $N - 700, 'time_arrival' => $N + 3100, 'deuterium_consumption' => 40,
        'ships' => ['large_cargo' => 2], 'metal' => 20000, 'crystal' => 10000]),
];
$OWN_PLANET_IDS = [1, 5, 3];

/** FleetMissionService::getActiveFleetMissionsForCurrentPlayer() (sortBy display time). */
function activeMissions(): array
{
    global $MISSIONS, $OWN_PLANET_IDS, $NOW;
    $r = array_values(array_filter($MISSIONS, fn($m) => ($m->user_id === 108 || in_array($m->planet_id_to, $OWN_PLANET_IDS, true)) && !$m->canceled && !$m->processed));
    usort($r, function ($a, $b) use ($NOW) {
        $ka = $a->time_arrival >= $NOW ? $a->time_arrival : $a->time_arrival + ($a->time_holding ?? 0);
        $kb = $b->time_arrival >= $NOW ? $b->time_arrival : $b->time_arrival + ($b->time_holding ?? 0);
        return $ka <=> $kb;
    });
    return $r;
}
function missionName(int $t): string
{
    return [1 => 'Attack', 2 => 'Attack', 3 => 'Transport', 4 => 'Deployment', 5 => 'ACS Defend', 6 => 'Espionage',
        7 => 'Colonisation', 8 => 'Harvest', 9 => 'Moon Destruction', 10 => 'Missile Attack', 15 => 'Expedition'][$t];
}
function missionHasReturn(int $t): bool { return !in_array($t, [4, 7, 10], true); }
function missionStatus(int $t): string
{
    return [1 => 'hostile', 2 => 'hostile', 3 => 'neutral', 4 => 'neutral', 5 => 'friendly', 6 => 'hostile', 7 => 'neutral',
        8 => 'neutral', 9 => 'hostile', 10 => 'hostile', 15 => 'neutral'][$t];
}
function fleetUnits(stdClass $m): UnitCollection
{
    $u = new UnitCollection();
    foreach (ships() as $s) { if ($m->{$s->machine_name} > 0) { $u->addUnit($s, $m->{$s->machine_name}); } }
    return $u;
}
function fleetUnitCount(stdClass $m): int { $n = 0; foreach (ships() as $s) { $n += $m->{$s->machine_name}; } return $n; }
/** FleetMissionService::getResources(): deuterium + deuterium_consumption / 2 (for every mission type). */
function missionResources(stdClass $m): Resources { return new Resources($m->metal, $m->crystal, $m->deuterium + ($m->deuterium_consumption / 2), 0); }
function determineFriendly(stdClass $m): FleetMissionStatus
{
    if ($m->user_id != 108) {
        switch ($m->mission_type) {
            case 1: case 2: case 6: case 9: case 10: return FleetMissionStatus::Hostile;
            case 3: return FleetMissionStatus::Neutral;
            case 5: return FleetMissionStatus::Neutral;
        }
    }
    return FleetMissionStatus::Friendly;
}

// ------------------------------------------------------------------ layout
function composeResources(PlanetService $p, int $darkMatter): array
{
    $r = [];
    foreach (['metal', 'crystal', 'deuterium'] as $k) {
        $amount = (float)$p->d['res'][$k];
        $storage = (float)$p->d['storage'][$k];
        $ph = (float)$p->d['prod'][$k];
        $r[$k] = [
            'amount' => $amount,
            'amount_formatted' => (new Resource($amount))->getFormattedLong(),
            'production_hour' => $ph,
            'production_hour_formatted' => AppUtil::formatNumber($ph),
            'production_second' => $ph / 3600,
            'storage' => $storage,
            'storage_formatted' => (new Resource($storage))->getFormattedLong(),
            'storage_almost_full' => ($amount >= $storage * 0.9 && $amount < $storage),
        ];
    }
    $emax = (float)$p->d['energy']['max'];
    $eused = (float)$p->d['energy']['used'];
    $r['energy'] = [
        'amount' => $emax - $eused,
        'amount_formatted' => (new Resource($emax - $eused))->getFormattedLong(),
        'production' => $emax,
        'production_formatted' => (new Resource($emax))->getFormattedLong(),
        'consumption' => $eused,
        'consumption_formatted' => (new Resource($eused))->getFormattedLong(),
    ];
    $r['darkmatter'] = ['amount' => $darkMatter, 'amount_formatted' => AppUtil::formatNumber($darkMatter)];
    return $r;
}

function setCtx(string $path, array $query): void
{
    global $player, $NOW;
    $GLOBALS['__ctx'] = [
        'csrf' => CSRF, 'now' => $NOW, 'path' => $path, 'query' => $query,
        'settings' => new FleetSettings(), 'economySpeed' => 1, 'fleetSpeed' => 1, 'player' => $player,
    ];
    $GLOBALS['__sections'] = [];
}

function renderPage(string $view, string $path, array $query, PlanetService $cur, array $vars): string
{
    global $player;
    setCtx($path, $query);
    $layout = [
        'underAttack' => true, // 1210 is a hostile espionage mission to Homeworld
        'unreadMessagesCount' => 3,
        'buddyRequestCount' => 0,
        'onlineBuddiesCount' => 1,
        'unreadChatCount' => 0,
        'resources' => composeResources($cur, 8000),
        'currentPlayer' => $player,
        'currentPlanet' => $cur,
        'planets' => $player->planets,
        'highscoreRank' => 37,
        'settings' => new FleetSettings(),
        'body_id' => null, // FleetController never calls setBodyId() -> body#ingamepage
        'locale' => 'en',
        'isImpersonating' => false,
        'impersonateLeaveUrl' => null,
        'attackBlockActive' => false,
        'attackBlockUntil' => 0,
        'attackBlockTooltip' => '',
        'planet_move_in_progress' => false,
    ];
    return blade_render($view, array_merge($layout, $vars));
}

// ------------------------------------------------------------------ /fleet (FleetController::index)
function fleetIndexVars(PlanetService $planet, array $query): array
{
    global $player;
    $screen = [
        ['light_fighter', 'heavy_fighter', 'cruiser', 'battle_ship', 'battlecruiser', 'bomber', 'destroyer', 'deathstar', 'reaper', 'pathfinder'],
        ['small_cargo', 'large_cargo', 'colony_ship', 'recycler', 'espionage_probe'],
    ];
    $units = []; $count = 0;
    foreach ($screen as $row => $names) {
        foreach ($names as $mn) {
            $count++;
            $vm = new stdClass();
            $vm->object = ships()[$mn];
            $vm->count = $count;
            $vm->amount = $planet->getObjectAmount($mn);
            $units[$row][$vm->object->id] = $vm;
        }
    }
    return [
        'player' => $player,
        'planet' => $planet,
        'units' => $units,
        'objects' => array_values(ships()),
        'shipAmount' => $planet->getFlightShipAmount(),
        'galaxy' => $query['galaxy'] ?? null,
        'system' => $query['system'] ?? null,
        'position' => $query['position'] ?? null,
        'type' => $query['type'] ?? null,
        'mission' => $query['mission'] ?? null,
        'settings' => new FleetSettings(),
        'fleetSlotsInUse' => 4,          // 1199, 1201, 1202, 1203 (own, unprocessed)
        'fleetSlotsMax' => 6,            // computer_technology 5 + 1
        'expeditionSlotsInUse' => 1,     // 1202
        'expeditionSlotsMax' => 2,       // floor(sqrt(astrophysics 4))
        'fleetSpeedIncrement' => 10,     // not General
        'availableUnions' => [],
        'tacticalRetreatRatio' => 5,
        'tacticalRetreatDeuteriumCost' => 245,
        'hasAdmiral' => false,
    ];
}
file_put_contents("$outDir/fleet-dispatch-planet.html", renderPage('ingame.fleet.index', '/fleet', ['cp' => '1'], $home, fleetIndexVars($home, ['cp' => '1'])));
$q = ['galaxy' => '1', 'system' => '45', 'position' => '6', 'type' => '1', 'mission' => '1'];
file_put_contents("$outDir/fleet-dispatch-prefill.html", renderPage('ingame.fleet.index', '/fleet', $q, $home, fleetIndexVars($home, $q)));
file_put_contents("$outDir/fleet-dispatch-noships.html", renderPage('ingame.fleet.index', '/fleet', ['cp' => '5'], $moon, fleetIndexVars($moon, ['cp' => '5'])));

// ------------------------------------------------------------------ /fleet/movement (FleetController::movement)
function setPlanetFields(FleetEventRowViewModel $vm, string $side, ?int $planetId, Coordinate $c, int $type, bool $withImages): void
{
    $vm->{$side . '_planet_name'} = '';
    $vm->{$side . '_planet_coords'} = $c;
    $vm->{$side . '_planet_type'} = PlanetType::from($type);
    if ($planetId !== null && ($p = planetById($planetId)) !== null) {
        $vm->{$side . '_planet_name'} = $p->getPlanetName();
        $vm->{$side . '_planet_coords'} = $p->getPlanetCoordinates();
        if ($withImages) {
            $vm->{$side . '_planet_image_type'} = $p->getPlanetImageType();
            $vm->{$side . '_planet_biome_type'} = $p->getPlanetBiomeType();
        }
    }
}
$fleet_events = [];
foreach (activeMissions() as $row) {
    $vm = new FleetEventRowViewModel();
    $vm->id = $row->id;
    $vm->mission_type = $row->mission_type;
    $vm->mission_label = missionName($row->mission_type);
    $vm->mission_time_arrival = $row->time_arrival;
    $vm->time_departure = $row->time_departure;
    $vm->is_return_trip = !empty($row->parent_id);
    $from = new Coordinate($row->galaxy_from, $row->system_from, $row->position_from);
    $to = new Coordinate($row->galaxy_to, $row->system_to, $row->position_to);
    if ($vm->is_return_trip) {
        setPlanetFields($vm, 'origin', $row->planet_id_to, $to, $row->type_to, true);
        setPlanetFields($vm, 'destination', $row->planet_id_from, $from, $row->type_from, true);
    } else {
        setPlanetFields($vm, 'origin', $row->planet_id_from, $from, $row->type_from, true);
        setPlanetFields($vm, 'destination', $row->planet_id_to, $to, $row->type_to, true);
    }
    $vm->fleet_unit_count = fleetUnitCount($row);
    $vm->fleet_units = fleetUnits($row);
    $vm->resources = missionResources($row);
    $vm->active_recall_time = $NOW + ($NOW - $row->time_departure);
    $vm->friendly_status = missionStatus($row->mission_type);
    $isRelocationTransfer = ($row->mission_type === 4 && $row->planet_id_from === $row->planet_id_to);
    $vm->is_recallable = ($row->mission_type !== 10 && !$isRelocationTransfer);
    $vm->union_id = $row->union_id;
    $vm->can_create_federation = (in_array($row->mission_type, [1, 2]) && !$vm->is_return_trip);
    if (missionHasReturn($vm->mission_type) && !$vm->is_return_trip) {
        $vm->has_return_trip = true;
        $vm->return_time_arrival = $row->time_arrival + ($row->time_arrival - $row->time_departure) + ($row->time_holding ?? 0);
    }
    $vm->is_at_destination = $vm->has_return_trip && $vm->mission_time_arrival <= $NOW;
    if ($vm->is_at_destination && $vm->return_time_arrival) {
        $travel = $vm->mission_time_arrival - $vm->time_departure;
        $vm->timer_time = $vm->return_time_arrival - $travel;
    } else {
        $vm->timer_time = $vm->mission_time_arrival;
    }
    $vm->remaining_time = max(0, $vm->timer_time - $NOW);
    $vm->duration = max(1, $vm->mission_time_arrival - $vm->time_departure);
    if ($vm->has_return_trip && $vm->return_time_arrival) {
        $vm->return_remaining_time = max(0, $vm->return_time_arrival - $NOW);
    }
    $fleet_events[] = $vm;
}
usort($fleet_events, fn($a, $b) => $a->mission_time_arrival - $b->mission_time_arrival);
file_put_contents("$outDir/fleet-movement.html", renderPage('ingame.fleet.movement', '/fleet/movement', ['cp' => '1'], $home, [
    'player' => $player, 'planet' => $home, 'fleet_events' => $fleet_events,
    'fleetSlotsInUse' => 4, 'fleetSlotsMax' => 6, 'expeditionSlotsInUse' => 1, 'expeditionSlotsMax' => 2,
]));

// ------------------------------------------------------------------ GET /ajax/fleet/eventlist/fetch (FleetEventsController::fetchEventList)
setCtx('/ajax/fleet/eventlist/fetch', []);
$events = [];
foreach (activeMissions() as $row) {
    $vm = new FleetEventRowViewModel();
    $vm->id = $row->id;
    $vm->real_mission_id = $row->id;
    $vm->mission_type = $row->mission_type;
    $vm->mission_label = missionName($row->mission_type);
    $vm->mission_time_arrival = ($row->mission_type === 5 && $row->time_holding !== null) ? $row->time_arrival - $row->time_holding : $row->time_arrival;
    $vm->is_return_trip = !empty($row->parent_id);
    setPlanetFields($vm, 'origin', $row->planet_id_from, new Coordinate($row->galaxy_from, $row->system_from, $row->position_from), $row->type_from, false);
    setPlanetFields($vm, 'destination', $row->planet_id_to, new Coordinate($row->galaxy_to, $row->system_to, $row->position_to), $row->type_to, false);
    if ($row->planet_id_to !== null && ($pt = planetById($row->planet_id_to))) {
        $vm->destination_player_id = $pt->d['owner'][0];
        $vm->destination_player_name = $pt->d['owner'][1];
    }
    if ($vm->is_return_trip && $row->planet_id_from !== null && ($pf = planetById($row->planet_id_from))) {
        $vm->destination_player_id = $pf->d['owner'][0];
        $vm->destination_player_name = $pf->d['owner'][1];
    }
    $vm->fleet_unit_count = fleetUnitCount($row);
    $vm->fleet_units = fleetUnits($row);
    $vm->resources = missionResources($row);
    $vm->time_departure = $row->time_departure;
    $vm->active_recall_time = $NOW + ($NOW - $row->time_departure);
    $vm->union_id = $row->union_id; $vm->union_slot = $row->union_slot; $vm->user_id = $row->user_id;
    $fs = determineFriendly($row);
    $vm->friendly_status = $fs->value;
    $vm->is_recallable = false;
    if ($fs === FleetMissionStatus::Friendly) {
        $isRelocationTransfer = ($row->mission_type === 4 && $row->planet_id_from === $row->planet_id_to);
        if ($row->mission_type !== 10 && !$isRelocationTransfer) { $vm->is_recallable = true; }
    }
    $hold = $row->time_holding ?? 0;
    $inHold = false;
    if ($hold > 0) {
        $inHold = $row->mission_type === 5
            ? (($row->time_arrival - $hold) <= $NOW && $row->time_arrival > $NOW)
            : ($row->time_arrival <= $NOW && ($row->time_arrival + $hold) > $NOW);
    }
    if (!$inHold) { $events[] = $vm; }
    if (($fs === FleetMissionStatus::Friendly || $fs === FleetMissionStatus::Neutral) && $hold > 0 && !$vm->is_return_trip) {
        $w = new FleetEventRowViewModel();
        $w->is_return_trip = false;
        $w->is_recallable = ($fs === FleetMissionStatus::Friendly && $row->mission_type === 5);
        $w->id = $row->id + 888888;
        $w->real_mission_id = $row->id;
        $w->mission_type = $vm->mission_type;
        $w->mission_label = missionName($vm->mission_type);
        $w->mission_time_arrival = ($row->mission_type === 5) ? $row->time_arrival : $row->time_arrival + $hold;
        $w->time_departure = $row->time_departure;
        $w->active_recall_time = $vm->active_recall_time;
        foreach (['origin', 'destination'] as $side) {
            foreach (['name', 'coords', 'type'] as $f) { $w->{$side . '_planet_' . $f} = $vm->{$side . '_planet_' . $f}; }
        }
        $w->fleet_unit_count = $vm->fleet_unit_count; $w->fleet_units = $vm->fleet_units; $w->resources = $vm->resources;
        $events[] = $w;
    }
    if ($fs === FleetMissionStatus::Friendly && missionHasReturn($vm->mission_type) && !$vm->is_return_trip) {
        if ($row->mission_type === 5) {
            $retDep = $row->time_arrival; $oneWay = ($row->time_arrival - $row->time_holding) - $row->time_departure;
        } else {
            $retDep = $row->time_arrival + $hold; $oneWay = $row->time_arrival - $row->time_departure;
        }
        $r = new FleetEventRowViewModel();
        $r->is_return_trip = true;
        $r->is_recallable = false;
        $r->id = $row->id + 999999;
        $r->real_mission_id = $row->id;
        $r->mission_type = $vm->mission_type;
        $r->mission_label = missionName($vm->mission_type);
        $r->mission_time_arrival = $retDep + $oneWay;
        $r->time_departure = $retDep;
        $r->active_recall_time = 0;
        $r->origin_planet_name = $vm->destination_planet_name; $r->origin_planet_coords = $vm->destination_planet_coords; $r->origin_planet_type = $vm->destination_planet_type;
        $r->destination_planet_name = $vm->origin_planet_name; $r->destination_planet_coords = $vm->origin_planet_coords; $r->destination_planet_type = $vm->origin_planet_type;
        $r->fleet_unit_count = $vm->fleet_unit_count; $r->fleet_units = $vm->fleet_units;
        $r->resources = new Resources(0, 0, 0, 0);
        $r->destination_player_id = $vm->destination_player_id; $r->destination_player_name = $vm->destination_player_name;
        $events[] = $r;
    }
}
usort($events, fn($a, $b) => $a->mission_time_arrival - $b->mission_time_arrival);
file_put_contents("$outDir/fleet-eventlist.html", blade_render('ingame.fleetevents.eventlist', ['fleet_events' => $events, 'espionage_probe_count' => 3]));

// ------------------------------------------------------------------ GET /ajax/fleet/eventbox/fetch
$next = null; $nextT = null;
foreach (activeMissions() as $m) {
    $hold = $m->time_holding ?? 0; $inHold = false; $disp = $m->time_arrival;
    if ($hold > 0) {
        if ($m->mission_type === 5) { $phys = $m->time_arrival - $hold; $inHold = ($phys <= $NOW && $m->time_arrival > $NOW); $disp = $inHold ? $m->time_arrival : $phys; }
        else { $inHold = ($m->time_arrival <= $NOW && ($m->time_arrival + $hold) > $NOW); $disp = $inHold ? $m->time_arrival + $hold : $m->time_arrival; }
    }
    if ($disp > $NOW && ($nextT === null || $disp < $nextT)) { $nextT = $disp; $next = $m; }
}
$cnt = ['friendly' => 0, 'neutral' => 0, 'hostile' => 0];
foreach (activeMissions() as $m) { $cnt[determineFriendly($m)->value]++; }
$jsonFlags = 0; // Laravel response()->json() default
file_put_contents("$outDir/fleet-eventbox.json", json_encode([
    'components' => [], 'hostile' => $cnt['hostile'], 'neutral' => $cnt['neutral'], 'friendly' => $cnt['friendly'],
    'eventType' => determineFriendly($next)->value,
    'eventTime' => $nextT - $NOW,
    'eventText' => missionName($next->mission_type) . ($next->parent_id ? ' (R)' : ''),
    'newAjaxToken' => CSRF,
], $jsonFlags));
file_put_contents("$outDir/fleet-eventbox-empty.json", json_encode([
    'components' => [], 'hostile' => 0, 'neutral' => 0, 'friendly' => 0, 'eventType' => 'friendly', 'eventTime' => 0, 'eventText' => '', 'newAjaxToken' => CSRF,
], $jsonFlags));
// POST /ajax/fleet/eventlist/checkevents  ids[]=1210&ids[]=890090 after 1210 arrived (served as text/plain)
file_put_contents("$outDir/fleet-checkevents.json", json_encode(['rows' => ['1210', '890090']], $jsonFlags));

// ------------------------------------------------------------------ POST /ajax/fleet/dispatch/check-target
$shipsData = [];
foreach (ships() as $s) { $shipsData[$s->id] = shipData($s, $RESEARCH, true); }
$orders = function (array $enabled) { $o = []; foreach ([1, 2, 3, 4, 5, 6, 7, 8, 9, 15] as $m) { $o[$m] = in_array($m, $enabled, true); } return $o; };
$checkTarget = function (array $o) use ($shipsData) {
    return [
        'shipsData' => $shipsData,
        'status' => $o['status'],
        'errors' => $o['errors'],
        'additionalFlightSpeedinfo' => '',
        'targetInhabited' => $o['inhabited'],
        'targetIsStrong' => false,
        'targetIsOutlaw' => false,
        'targetIsBuddyOrAllyMember' => true,
        'targetPlayerId' => $o['pid'],
        'targetPlayerName' => $o['pname'],
        'targetPlayerColorClass' => 'active',
        'targetPlayerRankIcon' => '',
        'playerIsOutlaw' => false,
        'targetPlanet' => $o['planet'],
        'emptySystems' => $o['empty'],
        'inactiveSystems' => $o['inactive'],
        'bashingSystemLimitReached' => false,
        'targetOk' => true,
        'components' => [],
        'newAjaxToken' => '91cf2833548771ba423894d1f3dddb3c',
        'orders' => $o['orders'],
    ];
};
// am204=20&am203=10 galaxy=1 system=45 position=6 type=1 union=0 (from Homeworld)
file_put_contents("$outDir/fleet-check-target-player.json", json_encode($checkTarget([
    'status' => 'success', 'errors' => [], 'inhabited' => true, 'pid' => 233, 'pname' => 'Raider42',
    'planet' => ['galaxy' => 1, 'system' => 45, 'position' => 6, 'type' => 1, 'name' => 'Farmville'],
    'empty' => 0, 'inactive' => 1, 'orders' => $orders([1, 3]),
]), $jsonFlags));
// am203=10&am210=1&am219=1 galaxy=1 system=42 position=16 type=1
file_put_contents("$outDir/fleet-check-target-expedition.json", json_encode($checkTarget([
    'status' => 'success', 'errors' => [], 'inhabited' => false, 'pid' => 99999, 'pname' => 'Deep space',
    'planet' => ['galaxy' => 1, 'system' => 42, 'position' => 16, 'type' => 1, 'name' => 'Deep space'],
    'empty' => 0, 'inactive' => 0, 'orders' => $orders([15]),
]), $jsonFlags));
// am204=20 galaxy=1 system=42 position=10 type=1 (empty slot, no colony ship)
file_put_contents("$outDir/fleet-check-target-empty-slot.json", json_encode($checkTarget([
    'status' => 'failure', 'errors' => [['message' => 'Colony ships must be sent to colonise this planet!', 'error' => 0]],
    'inhabited' => false, 'pid' => 99999, 'pname' => 'Deep space',
    'planet' => ['galaxy' => 1, 'system' => 42, 'position' => 10, 'type' => 1, 'name' => 'Deep space'],
    'empty' => 0, 'inactive' => 0, 'orders' => $orders([]),
]), $jsonFlags));
// galaxy=12 -> coordinate validation failure (no shipsData!)
file_put_contents("$outDir/fleet-check-target-invalid.json", json_encode([
    'status' => 'failure', 'errors' => [['message' => 'Invalid galaxy coordinate. Must be between 1 and 9.', 'error' => 140020]],
], $jsonFlags));

// ------------------------------------------------------------------ POST /ajax/fleet/dispatch/send-fleet
file_put_contents("$outDir/fleet-send-fleet-success.json", json_encode([
    'success' => true, 'message' => 'Your fleet has been successfully sent.', 'components' => [], 'newAjaxToken' => CSRF, 'redirectUrl' => route('fleet.index'),
], $jsonFlags));
file_put_contents("$outDir/fleet-send-fleet-error.json", json_encode([
    'success' => false, 'errors' => [['message' => 'Not enough units on the planet to send the fleet. Units required: light_fighter, large_cargo', 'error' => 140020]],
    'components' => [], 'newAjaxToken' => CSRF,
], $jsonFlags));
file_put_contents("$outDir/fleet-send-fleet-validation-error.json", json_encode([
    'success' => false, 'errors' => [['message' => 'Fleet speed must be between 10% and 100% in 5% increments.', 'error' => 140020]],
    'components' => [], 'newAjaxToken' => CSRF,
], $jsonFlags));

// ------------------------------------------------------------------ POST /ajax/fleet/dispatch/send-mini-fleet
file_put_contents("$outDir/fleet-send-mini-fleet-success.json", json_encode([
    'response' => [
        'message' => __('t_ingame.fleet.fleet_dispatch'), 'type' => 1, 'slots' => 1, 'probes' => 11, 'recyclers' => 0, 'explorers' => 9,
        'missiles' => 0, 'shipsSent' => 3, 'coordinates' => ['galaxy' => 1, 'system' => 45, 'position' => 6], 'planetType' => 1, 'success' => true,
    ],
    'newAjaxToken' => CSRF, 'components' => [],
], $jsonFlags));
file_put_contents("$outDir/fleet-send-mini-fleet-error.json", json_encode([
    'response' => ['message' => 'Error, no ships available', 'coordinates' => ['galaxy' => 1, 'system' => 45, 'position' => 6], 'success' => false],
    'newAjaxToken' => CSRF, 'components' => [],
], $jsonFlags));

// ------------------------------------------------------------------ POST /ajax/fleet/dispatch/recall-fleet
file_put_contents("$outDir/fleet-recall-success.json", json_encode(['components' => [], 'newAjaxToken' => CSRF, 'success' => true], $jsonFlags));
file_put_contents("$outDir/fleet-recall-failure.json", json_encode(['components' => [], 'newAjaxToken' => CSRF, 'success' => false], $jsonFlags));

// ------------------------------------------------------------------ fleet templates
$tplShips = function (array $set) {
    // saveTemplate() keeps every posted ship[id] (form order of #fleetTemplatesEdit) as int, zeros included
    $r = [];
    foreach ([204, 205, 206, 207, 215, 211, 213, 214, 218, 219, 202, 203, 208, 209, 210] as $id) { $r[$id] = $set[$id] ?? 0; }
    return $r;
};
$t1 = ['id' => 3, 'name' => 'Raid LC', 'ships' => $tplShips([204 => 20, 203 => 10])];
$t2 = ['id' => 7, 'name' => 'Expo', 'ships' => $tplShips([203 => 10, 210 => 1, 219 => 1])];
file_put_contents("$outDir/fleet-templates.json", json_encode(['templates' => [$t1, $t2]], $jsonFlags));
file_put_contents("$outDir/fleet-template-save.json", json_encode(['success' => true, 'message' => 'Template saved successfully.', 'template' => $t2], $jsonFlags));
file_put_contents("$outDir/fleet-template-delete.json", json_encode(['success' => true, 'message' => 'Template deleted successfully.'], $jsonFlags));

// ------------------------------------------------------------------ POST /ajax/phalanx/scan (from Moon id 5, target 1:45:6 Farmville)
setCtx('/ajax/phalanx/scan', []);
$shipsOf = function (array $a) { $r = []; foreach (ships() as $s) { if (($a[$s->machine_name] ?? 0) > 0) { $r[$s->machine_name] = $a[$s->machine_name]; } } return $r; };
$names = [1 => 'Homeworld', 77 => 'Farmville', 41 => 'Darkstar', 95 => 'Vortex Prime'];
$scan = [];
// 1220: Raider42 transport Farmville -> Darkstar (outgoing -> only the predicted return row, id + 999999)
$s1220 = $shipsOf(['small_cargo' => 8]);
$scan[] = ['mission_id' => 1220 + 999999, 'mission_type' => 3, 'mission_type_name' => 'Transport', 'is_incoming' => true, 'is_return_trip' => true,
    'time_departure' => $N + 1500, 'time_arrival' => $N + 1500 + 2100, 'fleet_direction' => 'Friendly fleet', 'fleet_owner_id' => 233,
    'fleet_icon' => '014a5d88b102d4b47ab5146d4807c6.gif', 'display_time' => $N + 1500 + 2100,
    'origin' => ['galaxy' => 1, 'system' => 40, 'position' => 11, 'planet_name' => $names[41]],
    'destination' => ['galaxy' => 1, 'system' => 45, 'position' => 6, 'planet_name' => $names[77]],
    'ships' => $s1220, 'ship_count' => array_sum($s1220), 'fleet_speed' => 12000];
// 1201: own attack, incoming to Farmville
$s1201 = $shipsOf(['light_fighter' => 20, 'large_cargo' => 10]);
$scan[] = ['mission_id' => 1201, 'mission_type' => 1, 'mission_type_name' => 'Attack', 'is_incoming' => true, 'is_return_trip' => false,
    'time_departure' => $N - 2000, 'time_arrival' => $N + 2340, 'fleet_direction' => 'Own fleet', 'fleet_owner_id' => 108,
    'fleet_icon' => 'f9cb590cdf265f499b0e2e5d91fc75.gif', 'display_time' => $N + 2340,
    'origin' => ['galaxy' => 1, 'system' => 42, 'position' => 8, 'planet_name' => $names[1]],
    'destination' => ['galaxy' => 1, 'system' => 45, 'position' => 6, 'planet_name' => $names[77]],
    'ships' => $s1201, 'ship_count' => array_sum($s1201), 'fleet_speed' => 19500];
// 1223: third-party attack Vortex Prime -> Farmville
$s1223 = $shipsOf(['cruiser' => 30, 'large_cargo' => 15]);
$scan[] = ['mission_id' => 1223, 'mission_type' => 1, 'mission_type_name' => 'Attack', 'is_incoming' => true, 'is_return_trip' => false,
    'time_departure' => $N - 1000, 'time_arrival' => $N + 2700, 'fleet_direction' => 'Enemy fleet', 'fleet_owner_id' => 301,
    'fleet_icon' => 'f9cb590cdf265f499b0e2e5d91fc75.gif', 'display_time' => $N + 2700,
    'origin' => ['galaxy' => 1, 'system' => 47, 'position' => 3, 'planet_name' => $names[95]],
    'destination' => ['galaxy' => 1, 'system' => 45, 'position' => 6, 'planet_name' => $names[77]],
    'ships' => $s1223, 'ship_count' => array_sum($s1223), 'fleet_speed' => 12000];
$html = blade_render('ingame.phalanx.content', ['fleet_movements' => $scan, 'server_time' => $NOW, 'scanner_player_id' => 108]);
file_put_contents("$outDir/fleet-phalanx-scan.json", json_encode([
    'success' => true, 'server_time' => $NOW,
    'target' => ['galaxy' => 1, 'system' => 45, 'position' => 6, 'planet_name' => 'Farmville', 'player_name' => 'Raider42'],
    'scan_cost' => 5000, 'fleet_count' => count($scan), 'content_html' => $html,
], $jsonFlags));
file_put_contents("$outDir/fleet-phalanx-scan-error.json", json_encode([
    'success' => true, 'server_time' => $NOW,
    'target' => ['galaxy' => 1, 'system' => 52, 'position' => 4, 'planet_name' => '', 'player_name' => ''],
    'is_error' => true, 'error_message' => 'Target is out of range. Your sensor phalanx (Level 2) can scan up to 3 systems away.',
], $jsonFlags));

// ------------------------------------------------------------------ jump gate (JSON only)
file_put_contents("$outDir/fleet-jumpgate-execute.json", json_encode([
    'success' => true, 'message' => 'Jump has been executed successfully.', 'redirect' => route('facilities.index', ['cp' => 12]),
], $jsonFlags));

// ------------------------------------------------------------------ expected parse results for the recipes in specs/fleet.md
$expected = [
    'now' => $NOW,
    'eventlist' => array_map(fn($e) => [
        'rowId' => $e->id, 'realMissionId' => $e->real_mission_id ?? null, 'missionType' => $e->mission_type,
        'returnFlight' => $e->is_return_trip, 'arrival' => $e->mission_time_arrival, 'units' => $e->fleet_unit_count,
        'status' => $e->friendly_status ?? null,
        'recallable' => $e->is_recallable && !$e->is_return_trip, // eventrow.blade.php renders a.recallFleet only in the outbound branch
    ], $events),
    'movement' => array_map(fn($e) => [
        'id' => $e->id, 'missionType' => $e->mission_type, 'returnFlight' => $e->is_return_trip, 'arrival' => $e->mission_time_arrival,
        'status' => $e->friendly_status, 'timer' => $e->timer_time, 'returnArrival' => $e->return_time_arrival,
        'origin' => $e->origin_planet_coords->asString(), 'destination' => $e->destination_planet_coords->asString(),
    ], $fleet_events),
];
file_put_contents("$outDir/fleet-expected-parse.json", json_encode($expected, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
echo "ok\n";

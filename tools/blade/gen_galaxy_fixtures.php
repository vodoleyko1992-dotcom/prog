<?php
/**
 * Renders galaxy / players fixtures from the real OgameX Blade templates
 * (galaxy/index, highscore/*, search/overlay, buddies/*, alliance/info) with stubbed
 * sample data. JSON bodies are built by porting the controller code line by line:
 *   - GalaxyController::ajax / getGalaxyArray / createPlanetRow / createPlanetsArray /
 *     createDebrisFieldArray / createMoonArray / getAvailableMissions / getPlanetActions /
 *     getPlayerInfo / createEmptySpaceRow / createExpeditionDebrisRow / getPlanetActivityStatus /
 *     calculateColonizedSlots
 *   - SearchController::search
 *   - BuddiesController::getOnlineBuddies
 * Key order in every array is the controller's key order (it shows in the JSON).
 *
 * Usage: php gen_galaxy_fixtures.php <fixtures-dir>
 */
require __DIR__ . '/blade.php';
date_default_timezone_set('UTC');

use OGame\Facades\AppUtil;
use OGame\Services\PlanetService;
use OGame\Services\PlanetListService;
use OGame\Services\PlayerService;
use OGame\Services\SettingsService;
use OGame\Models\Resource;
use OGame\Models\Planet\Coordinate;

$outDir = rtrim($argv[1] ?? (__DIR__ . '/../../fixtures'), '/');
const CSRF = 'Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e';
$NOW = gmmktime(0, 57, 17, 10, 30, 2026); // same "now" as the layout/fleet fixtures
$N = $NOW;

class GalaxySettings extends SettingsService
{
    public function numberOfGalaxies() { return 9; }
}

// ------------------------------------------------------------------ sample universe (same own account as layout/fleet fixtures)
function mkPlanet(array $d): PlanetService { return new PlanetService($d); }

$home = mkPlanet([
    'id' => 1, 'name' => 'Homeworld', 'coords' => [1, 42, 8], 'diameter' => 12800,
    'fields_used' => 95, 'fields_max' => 163, 'temp' => [12, 52],
    'levels' => ['robot_factory' => 5, 'metal_mine' => 12, 'shipyard' => 7, 'missile_silo' => 2],
    'res' => ['metal' => 152347.29861111, 'crystal' => 98712.55, 'deuterium' => 41230.871527778],
    'prod' => ['metal' => 4128, 'crystal' => 2187, 'deuterium' => 1043],
    'storage' => ['metal' => 255000, 'crystal' => 140000, 'deuterium' => 75000],
    'energy' => ['max' => 2860, 'used' => 2754],
    'units' => ['light_fighter' => 40, 'cruiser' => 12, 'small_cargo' => 25, 'large_cargo' => 18,
        'colony_ship' => 1, 'recycler' => 6, 'espionage_probe' => 15, 'solar_satellite' => 20,
        'pathfinder' => 0, 'interplanetary_missile' => 5],
    'last_update' => $N,
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
    'last_update' => $N - 23 * 60,
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
    'last_update' => $N - 3 * 3600,
]);
$RESEARCH = ['combustion_drive' => 6, 'impulse_drive' => 4, 'hyperspace_drive' => 0, 'hyperspace_technology' => 2,
    'computer_technology' => 5, 'astrophysics' => 4, 'espionage_technology' => 4];
$player = new PlayerService([
    'id' => 108, 'username' => 'Commander Vega', 'class' => 1 /* Collector */, 'maxPlanets' => 8,
    'research' => $RESEARCH,
], new PlanetListService([$home, $colony], [$moon]));
$FLEET_SLOTS_USED = 4;   // same as fleet fixtures
$FLEET_SLOTS_MAX = 6;    // computer_technology 5 + 1
$HAS_ADMIRAL = false;

// users table (id => row). time = users.time (last request of that player, unix seconds).
$USERS = [
    108 => ['id' => 108, 'username' => 'Commander Vega', 'time' => $N, 'admin' => false, 'vacation' => false, 'banned' => false, 'alliance_id' => null],
    1 => ['id' => 1, 'username' => 'Legor', 'time' => $N - 3 * 86400, 'admin' => true, 'vacation' => false, 'banned' => false, 'alliance_id' => null],
    150 => ['id' => 150, 'username' => 'Nova', 'time' => $N - 120, 'admin' => false, 'vacation' => false, 'banned' => false, 'alliance_id' => 12],
    201 => ['id' => 201, 'username' => 'OldMiner', 'time' => $N - 10 * 86400, 'admin' => false, 'vacation' => false, 'banned' => false, 'alliance_id' => null],
    202 => ['id' => 202, 'username' => 'Sleeper', 'time' => $N - 40 * 86400, 'admin' => false, 'vacation' => true, 'banned' => false, 'alliance_id' => null],
    204 => ['id' => 204, 'username' => 'Rookie', 'time' => $N - 37 * 60, 'admin' => false, 'vacation' => false, 'banned' => false, 'alliance_id' => null],
    233 => ['id' => 233, 'username' => 'Raider42', 'time' => $N - 18 * 60, 'admin' => false, 'vacation' => false, 'banned' => false, 'alliance_id' => 7],
];
// highscores table: general points + general_rank (other categories in highscoreRows()).
$HS = [
    108 => [48213, 37], 150 => [412870, 5], 201 => [31020, 88], 202 => [5210, 150], 204 => [2105, 201], 233 => [198500, 12],
    1 => [0, null], // admin hidden from highscore (highscore_admin_visible = 0) -> rank NULL
];
$ALLIANCES = [
    12 => ['id' => 12, 'alliance_tag' => 'NOVA', 'alliance_name' => 'Nova Collective', 'members_count' => 8, 'general_rank' => 3, 'general' => 2154300, 'is_open' => true],
    7 => ['id' => 7, 'alliance_tag' => 'RAID', 'alliance_name' => 'Raiders of the Lost Ark', 'members_count' => 3, 'general_rank' => 9, 'general' => 412004, 'is_open' => false],
];
$BUDDIES = [[108, 150]]; // accepted buddy pairs

// planets table rows for the scanned systems (planet_type 1/3; destroyed = planets.destroyed)
$GPLANETS = [
    // 1:42
    ['id' => 61, 'name' => 'Nova Prime', 'coords' => [1, 42, 4], 'owner' => 150, 'last_update' => $N - 300, 'diameter' => 12100],
    ['id' => 62, 'name' => 'Mine Alpha', 'coords' => [1, 42, 6], 'owner' => 201, 'last_update' => $N - 10 * 86400, 'diameter' => 11800],
    ['ref' => $home, 'owner' => 108],
    ['id' => 63, 'name' => 'Frozen', 'coords' => [1, 42, 11], 'owner' => 202, 'last_update' => $N - 40 * 86400, 'diameter' => 9900],
    ['id' => 64, 'name' => 'Little Rock', 'coords' => [1, 42, 13], 'owner' => 204, 'last_update' => $N - 37 * 60, 'diameter' => 8200],
    // 1:45
    ['id' => 2, 'name' => 'Arakis', 'coords' => [1, 45, 1], 'owner' => 1, 'last_update' => $N - 3 * 86400, 'diameter' => 6400],
    ['id' => 70, 'name' => 'Ruins', 'coords' => [1, 45, 3], 'owner' => 233, 'last_update' => $N - 9 * 3600, 'diameter' => 7100, 'destroyed' => true],
    ['id' => 77, 'name' => 'Farmville', 'coords' => [1, 45, 6], 'owner' => 233, 'last_update' => $N - 18 * 60, 'diameter' => 13400,
        'moon' => ['id' => 78, 'name' => 'Moon', 'diameter' => 7450, 'last_update' => $N - 4 * 60]],
    ['id' => 79, 'name' => 'Haven', 'coords' => [1, 45, 9], 'owner' => 150, 'last_update' => $N - 2 * 60, 'diameter' => 14900],
];
// debris_fields rows (galaxy, system, position) => [metal, crystal, deuterium]
$DEBRIS = [
    '1:42:8' => [12400, 7800, 0],
    '1:42:9' => [3000, 2000, 0],      // empty position: never shown by OgameX (no planet there)
    '1:45:3' => [45000, 30000, 0],
    '1:42:16' => [8800, 5600, 1200],  // expedition debris, Discoverer only
];

// ------------------------------------------------------------------ helpers mirroring PlayerService / PlanetService
function u(int $id): array { global $USERS; return $USERS[$id]; }
function daysSince(int $ts): float { global $NOW; return ($NOW - $ts) / 86400; }
function isInactiveU(int $id): bool { return daysSince(u($id)['time']) >= 7; }      // PlayerService::isInactive
function isLongInactiveU(int $id): bool { return daysSince(u($id)['time']) >= 28; } // PlayerService::isLongInactive
function score(int $id): int { global $HS; return $HS[$id][0] ?? 0; }               // getCachedGeneralScore
function isNewbieU(int $id, int $me): bool { if (isInactiveU($id)) { return false; } return score($id) < score($me) * 0.2; }
function isStrongU(int $id, int $me): bool { if (isInactiveU($id)) { return false; } return score($id) > score($me) * 5; }
function minutesSince(int $ts): int { global $NOW; return intdiv($NOW - $ts, 60); }  // getMinutesSinceLastUpdate

function biome(array $c): string { return (new PlanetService(['coords' => $c]))->getPlanetBiomeType(); }
function imageType(array $c, bool $moon = false): string { return (new PlanetService(['coords' => $c, 'moon' => $moon]))->getPlanetImageType(); }

/** GalaxyController::getPlanetActivityStatus */
function activityStatus(int $lastUpdate): array
{
    $lastActivity = minutesSince($lastUpdate);
    $result = ['showMinutes' => true];
    if ($lastActivity > 60) { $result['idleTime'] = null; $result['showActivity'] = false; }
    elseif ($lastActivity >= 15) { $result['idleTime'] = $lastActivity; $result['showActivity'] = 60; }
    else { $result['idleTime'] = null; $result['showActivity'] = 15; }
    return $result;
}

/** Normalised body description used by the port below. */
function bodies(): array
{
    global $GPLANETS, $moon;
    $r = [];
    foreach ($GPLANETS as $g) {
        if (isset($g['ref'])) {
            $p = $g['ref'];
            $r[] = ['id' => $p->getPlanetId(), 'name' => $p->getPlanetName(), 'coords' => $p->d['coords'], 'owner' => 108,
                'last_update' => $p->d['last_update'], 'destroyed' => false,
                'moon' => ['id' => $moon->getPlanetId(), 'name' => $moon->getPlanetName(), 'diameter' => $moon->getPlanetDiameter(), 'last_update' => $moon->d['last_update']]];
        } else {
            $r[] = $g + ['destroyed' => false, 'moon' => null];
        }
    }
    return $r;
}

// ------------------------------------------------------------------ GalaxyController port
class GalaxyPort
{
    public function __construct(public PlanetService $current, public int $me, public string $class = 'collector') {}

    public function ajax(string $galaxyIn, string $systemIn): array
    {
        global $FLEET_SLOTS_USED, $FLEET_SLOTS_MAX, $HAS_ADMIRAL, $player;
        $planet = $this->current;
        $galaxy = $galaxyIn;   // $request->input() -> strings, echoed back as strings
        $system = $systemIn;
        $galaxyContent = $this->getGalaxyArray((int)$galaxy, (int)$system);
        $slotsColonized = $this->calculateColonizedSlots($galaxyContent);
        $can_system_phalanx = false;
        if ($planet->isMoon()) { $can_system_phalanx = $planet->getObjectLevel('sensor_phalanx') > 0; }
        return [
            'components' => [],
            'filterSettings' => [],
            'lifeformEnabled' => false,
            'newAjaxToken' => CSRF,
            'reservedPositions' => [],
            'success' => true,
            'system' => [
                'availableMissiles' => $planet->getObjectAmount('interplanetary_missile'),
                'availablePathfinders' => $planet->getObjectAmount('pathfinder'),
                'availableProbes' => $planet->getObjectAmount('espionage_probe'),
                'availableRecyclers' => $planet->getObjectAmount('recycler'),
                'canColonize' => $player->getResearchLevel('astrophysics') > 0,
                'canExpedition' => true,
                'canFly' => $FLEET_SLOTS_USED < $FLEET_SLOTS_MAX,
                'canSendSystemDiscovery' => true,
                'canSwitchGalaxy' => true,
                'canSystemEspionage' => false,
                'canSystemPhalanx' => $can_system_phalanx,
                'currentPlanetId' => $planet->getPlanetId(),
                'deuteriumInDebris' => true,
                'galaxy' => $galaxy,
                'system' => $system,
                'galaxyContent' => $galaxyContent,
                'hasAdmiral' => $HAS_ADMIRAL,
                'hasBirthdayPlanet' => false,
                'isOutlaw' => false,
                'maximumFleetSlots' => $FLEET_SLOTS_MAX,
                'playerId' => $this->me,
                'settingsProbeCount' => 3,
                'showOutlawWarning' => true,
                'slotsColonized' => $slotsColonized,
                'switchGalaxyDeuteriumCosts' => 10,
                'toGalaxyLink' => route('galaxy.index', ['galaxy' => $galaxy, 'system' => $system]),
                'usedFleetSlots' => $FLEET_SLOTS_USED,
            ],
        ];
    }

    public function getGalaxyArray(int $galaxy, int $system): array
    {
        $planets = [];
        foreach (bodies() as $b) {
            if ($b['coords'][0] === $galaxy && $b['coords'][1] === $system) { $planets[$b['coords'][2]] = $b; }
        }
        $rows = [];
        for ($i = 1; $i <= 15; $i++) {
            $rows[] = !empty($planets[$i]) ? $this->createPlanetRow($galaxy, $system, $i, $planets[$i]) : $this->createEmptySpaceRow($galaxy, $system, $i);
        }
        if ($this->class === 'discoverer') {
            $row = $this->createExpeditionDebrisRow($galaxy, $system, 16);
            if ($row['planets'] !== null) { $rows[] = $row; }
        }
        return $rows;
    }

    private function createPlanetRow(int $galaxy, int $system, int $position, array $b): array
    {
        $isDestroyed = $b['destroyed'];
        $availableMissions = $isDestroyed ? [] : $this->getAvailableMissions($galaxy, $system, $position, $b, 1);
        $planets_array = $this->createPlanetsArray($b, $availableMissions);
        return [
            'actions' => $isDestroyed ? [] : $this->getPlanetActions($b, $galaxy, $system, $position),
            'availableMissions' => [],
            'galaxy' => $galaxy,
            'planets' => $planets_array,
            'player' => $isDestroyed ? ['playerId' => 99999, 'playerName' => 'Deep space'] : $this->getPlayerInfo($b['owner']),
            'position' => $position,
            'positionFilters' => '',
            'system' => $system,
            'playerId' => $isDestroyed ? 99999 : $b['owner'],
            'playerName' => $isDestroyed ? 'Deep space' : u($b['owner'])['username'],
        ];
    }

    private function createPlanetsArray(array $b, array $availableMissions): array
    {
        global $DEBRIS;
        $isDestroyed = $b['destroyed'];
        $arr = [[
            'activity' => $isDestroyed ? null : activityStatus($b['last_update']),
            'availableMissions' => $availableMissions,
            'fleet' => [],
            'imageInformation' => biome($b['coords']) . '_' . imageType($b['coords']),
            'isDestroyed' => $isDestroyed,
            'planetId' => $b['id'],
            'planetName' => $isDestroyed ? __('t_galaxy.planet.destroyed') : $b['name'],
            'playerId' => $isDestroyed ? 99999 : $b['owner'],
            'planetType' => 1,
        ]];
        $key = implode(':', $b['coords']);
        if (isset($DEBRIS[$key]) && array_sum($DEBRIS[$key]) > 0) { $arr[] = $this->createDebrisFieldArray($DEBRIS[$key]); }
        if ($b['moon'] !== null) { $arr[] = $this->createMoonArray($b); }
        return $arr;
    }

    private function createDebrisFieldArray(array $d): array
    {
        global $player;
        // DebrisFieldService::calculateRequiredRecyclers(): recycler capacity 20000 + 5 %/hyperspace tech level
        $cap = 20000 + intdiv(20000 * 5 * $player->getResearchLevel('hyperspace_technology'), 100);
        return [
            'planetId' => 0,
            'planetName' => 'debris_field',
            'imageInformation' => 'debris_1',
            'availableMissions' => [['missionType' => 8, 'name' => __('t_ingame.galaxy.mission_harvest')]],
            'requiredShips' => (int)ceil(array_sum($d) / $cap),
            'planetType' => 2,
            'resources' => [
                'metal' => ['name' => 'Metal', 'amount' => (float)$d[0]],
                'crystal' => ['name' => 'Crystal', 'amount' => (float)$d[1]],
                'deuterium' => ['name' => 'Deuterium', 'amount' => (float)$d[2]],
            ],
            'recyclePossible' => true,
        ];
    }

    private function createMoonArray(array $b): array
    {
        $m = $b['moon'];
        $isDestroyed = false;
        [$g, $s, $p] = $b['coords'];
        return [
            'activity' => activityStatus($m['last_update']),
            'availableMissions' => $this->getAvailableMissions($g, $s, $p, $b, 3),
            'fleet' => [],
            'imageInformation' => $isDestroyed ? 'moon_c' : 'moon_a',
            'isDestroyed' => $isDestroyed,
            'planetId' => $m['id'],
            'planetName' => $m['name'],
            'playerId' => $b['owner'],
            'planetType' => 3,
            'size' => $m['diameter'],
            'tooltipInfo' => ['diameter' => $m['diameter'], 'name' => $m['name']],
        ];
    }

    private function getAvailableMissions(int $galaxy, int $system, int $position, array $b, int $type): array
    {
        global $BUDDIES;
        $am = [];
        $am[] = ['missionType' => 3, 'link' => route('fleet.index', ['galaxy' => $galaxy, 'system' => $system, 'position' => $position, 'type' => $type, 'mission' => 3]), 'name' => __('t_ingame.fleet.mission_transport')];
        $owner = $b['owner'];
        if ($owner !== $this->me) {
            if (u($owner)['username'] !== 'Legor') {
                $am[] = ['missionType' => 6, 'canSpy' => true, 'reportId' => '', 'reportLink' => '',
                    'link' => route('fleet.dispatch.sendfleet', ['galaxy' => $galaxy, 'system' => $system, 'position' => $position, 'type' => $type, 'mission' => 6, 'am210' => 1]),
                    'name' => __('t_ingame.fleet.mission_espionage')];
                $am[] = ['missionType' => 1, 'link' => route('fleet.index', ['galaxy' => $galaxy, 'system' => $system, 'position' => $position, 'type' => $type, 'mission' => 1]), 'name' => __('t_ingame.fleet.mission_attack')];
            }
            $isBuddy = in_array([$this->me, $owner], $BUDDIES, true) || in_array([$owner, $this->me], $BUDDIES, true);
            if ($isBuddy) {
                $am[] = ['missionType' => 5, 'link' => route('fleet.index', ['galaxy' => $galaxy, 'system' => $system, 'position' => $position, 'type' => $type, 'mission' => 5]), 'name' => __('t_ingame.fleet.mission_acs_defend')];
            }
            if ($type === 3) {
                $am[] = ['missionType' => 10, 'link' => route('fleet.index', ['galaxy' => $galaxy, 'system' => $system, 'position' => $position, 'type' => $type, 'mission' => 10]), 'name' => __('t_ingame.fleet.mission_destroy_moon')];
            }
        } else {
            $am[] = ['missionType' => 4, 'link' => route('fleet.index', ['galaxy' => $galaxy, 'system' => $system, 'position' => $position, 'type' => $type, 'mission' => 4]), 'name' => __('t_ingame.fleet.mission_deploy')];
        }
        return $am;
    }

    private function getPlanetActions(array $b, int $galaxy, int $system, int $position): array
    {
        global $player;
        $cur = $this->current;
        $canEspionage = $cur->getObjectAmount('espionage_probe') > 0 && $player->getResearchLevel('espionage_technology') > 0;
        $can_phalanx = false; $reason = '';
        $owner = $b['owner'];
        if ($cur->isMoon() && $owner !== $this->me && !u($owner)['admin']) {
            $lvl = $cur->getObjectLevel('sensor_phalanx');
            if ($lvl > 0) {
                $mc = $cur->getPlanetCoordinates();
                $range = $lvl * $lvl - 1; // PhalanxService::calculatePhalanxRange (no player id passed -> no Discoverer bonus)
                $dist = abs($mc->system - $system); // CoordinateDistanceCalculator::getSystemDistance (donut wrap irrelevant here)
                if ($mc->galaxy === $galaxy && $dist <= $range) {
                    if ($cur->deuterium()->get() >= 5000) { $can_phalanx = true; } else { $reason = __('t_ingame.galaxy.phalanx_no_deut'); }
                }
            }
        }
        $canBuddyRequest = $owner !== $this->me && !u($owner)['admin'];
        $canMissileAttack = false;
        $missileAttackLink = route('galaxy.index');
        if ($owner !== $this->me) {
            $range = $player->getResearchLevel('impulse_drive') === 0 ? 0 : $player->getResearchLevel('impulse_drive') * 5 - 1;
            $cc = $cur->getPlanetCoordinates();
            $distance = $cc->galaxy === $galaxy && $cc->system === $system ? 0 : ($cc->galaxy !== $galaxy ? PHP_INT_MAX : abs($cc->system - $system));
            if ($distance <= $range) {
                $canMissileAttack = true;
                $missileAttackLink = route('galaxy.missile-attack.overlay', ['galaxy' => $galaxy, 'system' => $system, 'position' => $position, 'type' => 1]);
            }
        }
        return [
            'canBeIgnored' => false,
            'canBuddyRequests' => $canBuddyRequest,
            'canEspionage' => $canEspionage,
            'canMissileAttack' => $canMissileAttack,
            'canPhalanx' => $can_phalanx || !empty($reason),
            'phalanxActive' => $can_phalanx,
            'phalanxInactive' => !empty($reason),
            'phalanxInactiveReason' => $reason,
            'canSendProbes' => $canEspionage,
            'canWrite' => false,
            'discoveryUnlocked' => __('t_galaxy.discovery.locked'),
            'missileAttackLink' => $missileAttackLink,
        ];
    }

    private function getPlayerInfo(int $id): array
    {
        global $HS, $ALLIANCES;
        $isForeign = $id !== $this->me;
        $isTargetAdmin = u($id)['admin'];
        $playerRank = $HS[$id][1] ?? null;
        $highscorePage = $playerRank !== null ? (int)ceil($playerRank / 100) : 1;
        $alliance = null; $allianceTag = null; $allianceName = null; $allianceData = null;
        $aid = u($id)['alliance_id'];
        if ($aid) {
            $alliance = $ALLIANCES[$aid];
            $allianceTag = $alliance['alliance_tag'];
            $allianceName = $alliance['alliance_name'];
            $highscoreRank = $alliance['general_rank'] ?? '?';
            $highscorePage = $highscoreRank !== '?' ? (int)ceil($highscoreRank / 100) : 1; // NB: overwrites the player's page (OgameX bug)
            $myAid = u($this->me)['alliance_id'];
            $allianceData = [
                'available' => true,
                'allianceId' => $alliance['id'],
                'allianceTag' => $allianceTag,
                'allianceName' => $allianceName,
                'memberCount' => $alliance['members_count'],
                'highscoreLink' => route('highscore.index', ['category' => 2, 'page' => $highscorePage]),
                'highscoreTitle' => (string)$highscoreRank,
                'infoPageLink' => route('alliance.index'),
                'infoPageTitle' => __('t_ingame.galaxy.alliance_page'),
                'allianceClassName' => null,
                'allianceClassCss' => null,
                'applicationLink' => (!$myAid && $alliance['is_open']) ? route('alliance.index', ['alliance_id' => $alliance['id']]) : null,
                'applicationTitle' => (!$myAid && $alliance['is_open']) ? __('t_ingame.galaxy.apply') : null,
            ];
        }
        $name = u($id)['username'];
        return [
            'actions' => [
                'alliance' => $allianceData ?? ['available' => false],
                'buddies' => ['available' => $isForeign && !$isTargetAdmin, 'playerId' => $id, 'link' => 'javascript:void(0);', 'title' => __('t_buddies.ui.buddy_request_to_player'), 'playerName' => $name],
                'ignore' => ['available' => $isForeign && !$isTargetAdmin, 'playerId' => $id, 'link' => 'javascript:void(0);', 'title' => __('t_buddies.ui.ignore_player_title'), 'playerName' => $name],
                'support' => ['available' => $isTargetAdmin, 'playerId' => $id, 'link' => 'javascript:void(0);', 'title' => __('t_ingame.galaxy.contact_support'), 'playerName' => $name],
                'highscore' => ['available' => $playerRank !== null, 'rank' => $playerRank, 'title' => __('t_ingame.galaxy.ranking'), 'link' => route('highscore.index', ['category' => 1, 'page' => $highscorePage])],
                'message' => ['available' => $isForeign && !$isTargetAdmin, 'disabledChatBar' => false, 'title' => __('t_ingame.highscore.write_message'), 'link' => 'javascript:void(0);', 'playerId' => $id],
            ],
            'playerId' => $id,
            'playerName' => $name,
            'isAdmin' => $isTargetAdmin,
            'isInactive' => isInactiveU($id),
            'isLongInactive' => isLongInactiveU($id),
            'isNewbie' => isNewbieU($id, $this->me),
            'isStrong' => isStrongU($id, $this->me),
            'isOnVacation' => u($id)['vacation'],
            'allianceId' => $alliance['id'] ?? null,
            'allianceTag' => $allianceTag,
            'allianceName' => $allianceName,
            'isAllianceMember' => $alliance !== null && $aid === u($this->me)['alliance_id'],
            'isBanned' => u($id)['banned'],
        ];
    }

    private function createEmptySpaceRow(int $galaxy, int $system, int $position): array
    {
        global $player, $FLEET_SLOTS_USED, $FLEET_SLOTS_MAX, $HAS_ADMIRAL;
        $desc = match (true) {
            $position <= 3 => __('t_galaxy.planet.description.nearest'),
            $position <= 6 => __('t_galaxy.planet.description.normal'),
            $position <= 9 => __('t_galaxy.planet.description.biggest'),
            $position <= 12 => __('t_galaxy.planet.description.normal'),
            default => __('t_galaxy.planet.description.farthest'),
        };
        $has_colonize_ship = $this->current->getObjectAmount('colony_ship') > 0;
        $colonize_ship_message = "<br><div><img src='/img/galaxy/activity.gif' />" . __('t_galaxy.mission.colonize.no_ship') . "</div>";
        $astro = $player->getResearchLevel('astrophysics');
        $canColonizePosition = !((($position === 1 || $position === 15) && $astro < 8) || (($position === 2 || $position === 14) && $astro < 6) || (($position === 3 || $position === 13) && $astro < 4));
        $canFly = $FLEET_SLOTS_USED < $FLEET_SLOTS_MAX;
        $description = __('t_galaxy.mission.colonize.name') . "<br>{$desc}";
        if (!$has_colonize_ship) { $description .= $colonize_ship_message; }
        if ($astro === 0 || !$canColonizePosition) { $description .= '<br>' . __('t_ingame.galaxy.astro_required'); }
        if (!$canFly) { $description .= '<br>' . __('t_ingame.fleet.no_free_slots'); if (!$HAS_ADMIRAL) { $description .= '<br>' . __('t_ingame.galaxy.hire_admiral'); } }
        $canColonize = $has_colonize_ship && $astro > 0 && $canColonizePosition && $canFly;
        return [
            'actions' => [],
            'availableMissions' => [
                ['missionType' => 0, 'planetMovePossible' => true, 'moveAction' => 'prepareMove', 'moveLink' => route('planetMove.move'),
                    'galaxyLink' => route('galaxy.index', ['galaxy' => $galaxy, 'system' => $system]), 'title' => __('t_ingame.galaxy.relocate_action')],
                ['missionType' => 7, 'link' => $canColonize ? "/fleet?galaxy={$galaxy}&system={$system}&position={$position}&type=1&mission=7" : '#', 'description' => $description],
            ],
            'galaxy' => $galaxy,
            'planets' => [],
            'player' => ['playerId' => 99999, 'playerName' => __('t_ingame.fleet.deep_space')],
            'playerId' => 99999,
            'playerName' => __('t_ingame.fleet.deep_space'),
            'position' => $position,
            'positionFilters' => 'empty_filter',
            'system' => $system,
        ];
    }

    private function createExpeditionDebrisRow(int $galaxy, int $system, int $position): array
    {
        global $DEBRIS;
        $key = "$galaxy:$system:$position";
        $obj = (isset($DEBRIS[$key]) && array_sum($DEBRIS[$key]) > 0) ? $this->createDebrisFieldArray($DEBRIS[$key]) : null;
        return [
            'actions' => [],
            'availableMissions' => [],
            'galaxy' => $galaxy,
            'planets' => $obj,
            'player' => ['playerId' => 99999, 'playerName' => __('t_ingame.fleet.deep_space')],
            'playerId' => 99999,
            'playerName' => __('t_ingame.fleet.deep_space'),
            'position' => $position,
            'positionFilters' => 'expedition_debris',
            'system' => $system,
        ];
    }

    private function calculateColonizedSlots(array $content): int
    {
        $n = 0;
        foreach ($content as $record) {
            if (!empty($record['planets'])) {
                $n += count(array_filter($record['planets'], fn($p) => empty($p['isDestroyed']) && !empty($p['playerId'])));
            }
        }
        return $n;
    }
}

// ------------------------------------------------------------------ layout helpers
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
        'settings' => new GalaxySettings(), 'economySpeed' => 1, 'fleetSpeed' => 1, 'player' => $player,
        'app' => 'appResolver',
    ];
    $GLOBALS['__sections'] = [];
}

function renderPage(string $view, string $path, array $query, PlanetService $cur, ?string $bodyId, array $vars): string
{
    global $player;
    setCtx($path, $query);
    $layout = [
        'underAttack' => true, // same account state as the fleet fixtures (hostile espionage 1210 incoming)
        'unreadMessagesCount' => 3,
        'buddyRequestCount' => 1,
        'onlineBuddiesCount' => 1,
        'unreadChatCount' => 0,
        'resources' => composeResources($cur, 8000),
        'currentPlayer' => $player,
        'currentPlanet' => $cur,
        'planets' => $player->planets,
        'highscoreRank' => 37,
        'settings' => new GalaxySettings(),
        'body_id' => $bodyId,
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

// ------------------------------------------------------------------ app() resolver for views that resolve services (buddies partials)
class FxUser
{
    public function __construct(public int $id, public string $username, public int $time) {}
    public function isOnline(): bool { global $NOW; return $this->time && ($NOW - $this->time) <= 900; } // User::isOnline
}
function fxUser(int $id): FxUser { $r = u($id); return new FxUser($r['id'], $r['username'], $r['time']); }
$HOMEWORLDS = [150 => [1, 42, 4], 201 => [1, 42, 6], 202 => [1, 42, 11], 204 => [1, 42, 13], 233 => [1, 45, 6], 108 => [1, 42, 8], 1 => [1, 45, 1]];
function appResolver($abstract, array $params)
{
    global $HOMEWORLDS;
    if ($abstract === \OGame\Services\PlayerService::class && isset($params['player_id'])) {
        $id = (int)$params['player_id'];
        $o = new stdClass();
        $o->id = $id;
        $o->planets = new class($HOMEWORLDS[$id] ?? null) {
            public function __construct(public ?array $c) {}
            public function first() { return $this->c === null ? null : new PlanetService(['coords' => $this->c]); }
        };
        return $o;
    }
    if ($abstract === 'OGame\\Services\\HighscoreService') {
        return new class {
            public function getHighscorePlayerRank($p): int { global $HS; return $HS[$p->id][1] ?? 0; }
            public function getPlayerScore($p): int { return score($p->id); }
        };
    }
    return null;
}

$fixtures = [];
function out(string $name, string $body): void { global $outDir, $fixtures; file_put_contents("$outDir/$name", $body); $fixtures[] = $name; }
function j($data): string { return json_encode($data); } // Laravel response()->json(): flags 0

// ================================================================== 1. GET /galaxy (full page)
function galaxyIndexVars(PlanetService $planet, int $g, int $s, bool $vacation = false): array
{
    global $FLEET_SLOTS_USED, $FLEET_SLOTS_MAX;
    return [
        'current_galaxy' => $g,
        'current_system' => $s,
        'espionage_probe_count' => $planet->getObjectAmount('espionage_probe'),
        'recycler_count' => $planet->getObjectAmount('recycler'),
        'interplanetary_missiles_count' => $planet->getObjectAmount('interplanetary_missile'),
        'used_slots' => $FLEET_SLOTS_USED,
        'max_slots' => $FLEET_SLOTS_MAX,
        'max_galaxies' => 9,
        'is_in_vacation_mode' => $vacation,
        'planet_relocation_cost' => 240000,
    ];
}
out('galaxy-page.html', renderPage('ingame.galaxy.index', '/galaxy', ['cp' => '1'], $home, null, galaxyIndexVars($home, 1, 42)));
out('galaxy-page-query.html', renderPage('ingame.galaxy.index', '/galaxy', ['galaxy' => '1', 'system' => '45', 'position' => '6'], $home, null, galaxyIndexVars($home, 1, 45)));
out('galaxy-page-vacation.html', renderPage('ingame.galaxy.index', '/galaxy', [], $home, null, galaxyIndexVars($home, 1, 42, true)));

// ================================================================== 2. POST /ajax/galaxy
setCtx('/ajax/galaxy', []);
$port = new GalaxyPort($home, 108);
out('galaxy-ajax-1-42.json', j($port->ajax('1', '42')));
out('galaxy-ajax-1-45.json', j($port->ajax('1', '45')));
out('galaxy-ajax-1-44-empty.json', j($port->ajax('1', '44')));
$portMoon = new GalaxyPort($moon, 108);
out('galaxy-ajax-1-45-from-moon.json', j($portMoon->ajax('1', '45')));
$portDisc = new GalaxyPort($home, 108, 'discoverer');
out('galaxy-ajax-1-42-discoverer.json', j($portDisc->ajax('1', '42')));
// vacation mode -> HTTP 403
out('galaxy-ajax-vacation-403.json', j(['success' => false, 'error' => __('t_ingame.galaxy.vacation_error')]));

// ================================================================== 3. Highscore
$FIRST = ['Astra', 'Bolt', 'Cygnus', 'Drake', 'Ember', 'Falcon', 'Gaia', 'Helix', 'Ion', 'Juno', 'Kraken', 'Lyra', 'Mako', 'Nyx', 'Orion', 'Pulsar', 'Quasar', 'Rigel', 'Sirius', 'Titan'];
$LAST = ['', '7', 'X', '_77', 'Prime', 'One', '2000', 'Rex', '_TR', 'Zero', 'Max'];
/** Monotonic sample general points by rank, pinned to the named players. */
function pointsForRank(int $r): int
{
    $pins = [1 => 1284330, 5 => 412870, 12 => 198500, 37 => 48213, 88 => 31020, 150 => 5210, 201 => 2105, 214 => 140];
    $ks = array_keys($pins);
    for ($i = 0; $i < count($ks) - 1; $i++) {
        [$a, $b] = [$ks[$i], $ks[$i + 1]];
        if ($r >= $a && $r <= $b) {
            if ($r === $a) { return $pins[$a]; }
            $t = ($r - $a) / ($b - $a);
            return (int)round($pins[$a] * pow($pins[$b] / $pins[$a], $t));
        }
    }
    return 0;
}
$NAMED_BY_RANK = [5 => 150, 12 => 233, 37 => 108, 88 => 201, 150 => 202, 201 => 204];
function hsRows(int $page, int $type): array
{
    global $FIRST, $LAST, $NAMED_BY_RANK, $HOMEWORLDS, $ALLIANCES, $USERS;
    $rows = [];
    for ($r = ($page - 1) * 100 + 1; $r <= min(214, $page * 100); $r++) {
        if (isset($NAMED_BY_RANK[$r])) {
            $id = $NAMED_BY_RANK[$r];
            $name = $USERS[$id]['username'];
            $c = $HOMEWORLDS[$id];
            $aid = $USERS[$id]['alliance_id'];
        } else {
            $id = 300 + $r;
            $name = $FIRST[$r % count($FIRST)] . $LAST[intdiv($r, count($FIRST)) % count($LAST)];
            $c = [1 + ($r * 7) % 9, 1 + ($r * 37) % 499, 1 + ($r * 5) % 15];
            $aid = ($r % 6 === 0) ? 12 : (($r % 11 === 0) ? 7 : null);
        }
        $pts = pointsForRank($r);
        if ($type === 3) { $pts = (int)round($pts * 0.31); }
        $rows[] = [
            'id' => $id,
            'name' => $name,
            'points' => $pts,
            'points_formatted' => AppUtil::formatNumber($pts),
            'planet_coords' => new Coordinate(...$c),
            'rank' => $r,
            'is_admin' => false,
            'alliance_tag' => $aid ? $ALLIANCES[$aid]['alliance_tag'] : null,
            'alliance_id' => $aid ? $ALLIANCES[$aid]['id'] : null,
            'total_ships' => $type === 3 ? (int)round($pts / 9.5) : null,
        ];
    }
    return $rows;
}
function hsPlayersView(int $page, int $type): string
{
    global $player;
    return blade_render('ingame.highscore.players_points', [
        'highscorePlayers' => hsRows($page, $type),
        'highscorePlayerAmount' => 214,
        'highscoreCurrentPlayerRank' => 37,
        'highscoreCurrentPlayerPage' => floor(37 / 100) + 1,
        'highscoreCurrentPage' => $page,
        'highscoreCurrentType' => $type,
        'player' => $player,
        'highscoreAdminVisible' => false,
        'currentPlayerIsAdmin' => false,
    ]);
}
function hsAlliancesView(int $type): string
{
    $tags = [[1, 31, 'Galactic Empire', 'GE', 4520110, 21], [2, 18, 'Free Traders', 'FTRD', 3011870, 17], [3, 12, 'Nova Collective', 'NOVA', 2154300, 8],
        [4, 40, 'Dark Matter Inc', 'DMI', 1650220, 12], [5, 22, 'Starfall', 'SF', 990300, 6], [6, 9, 'Iron Wolves', 'IW', 702560, 5],
        [7, 14, 'Blue Horizon', 'BLUE', 560010, 7], [8, 27, 'Eclipse', 'ECL', 450200, 4], [9, 7, 'Raiders of the Lost Ark', 'RAID', 412004, 3]];
    $rows = [];
    foreach ($tags as [$rank, $id, $name, $tag, $pts, $members]) {
        $avg = $members > 0 ? $pts / $members : 0;
        $rows[] = ['id' => $id, 'name' => $name, 'tag' => $tag, 'points' => $pts, 'points_formatted' => AppUtil::formatNumber($pts),
            'average_points' => $avg, 'average_points_formatted' => AppUtil::formatNumber($avg), 'member_count' => $members, 'rank' => $rank];
    }
    global $player;
    return blade_render('ingame.highscore.alliance_points', [
        'highscoreAlliances' => $rows,
        'highscoreAllianceAmount' => 9,
        'highscoreCurrentAllianceRank' => 0,
        'highscoreCurrentAlliancePage' => 1,
        'highscoreCurrentPage' => 1,
        'highscoreCurrentType' => $type,
        'currentUserAllianceId' => null,
        'player' => $player,
    ]);
}
setCtx('/highscore', []);
$initial = hsPlayersView(1, 0);
out('galaxy-highscore-page.html', renderPage('ingame.highscore.index', '/highscore', [], $home, 'highscore', ['initialContent' => $initial]));
setCtx('/ajax/highscore', ['category' => '1', 'type' => '3', 'page' => '1']);
out('galaxy-highscore-ajax-players-military.html', hsPlayersView(1, 3));
setCtx('/ajax/highscore', ['category' => '1', 'type' => '0', 'page' => '2']);
out('galaxy-highscore-ajax-players-page2.html', hsPlayersView(2, 0));
setCtx('/ajax/highscore', ['category' => '2', 'type' => '0']);
out('galaxy-highscore-ajax-alliances.html', hsAlliancesView(0));

// ================================================================== 4. Search
setCtx('/overlay/search', []);
out('galaxy-search-overlay.html', blade_render('ingame.search.overlay', []));
out('galaxy-search-players.json', j(['status' => 'success', 'results' => [
    ['id' => 233, 'name' => 'Raider42', 'type' => 'player'],
    ['id' => 327, 'name' => 'Drake', 'type' => 'player'],
], 'category' => 2]));
// SearchController::searchPlanets reads $planet->name, which is not a column (planet_name) -> always null.
out('galaxy-search-planets.json', j(['status' => 'success', 'results' => [
    ['id' => 77, 'name' => null, 'coordinates' => '[1:45:6]', 'owner_id' => 233, 'type' => 'planet'],
    ['id' => 412, 'name' => null, 'coordinates' => '[4:310:7]', 'owner_id' => 344, 'type' => 'planet'],
], 'category' => 3]));
out('galaxy-search-alliances.json', j(['status' => 'success', 'results' => [
    ['id' => 12, 'name' => 'Nova Collective', 'tag' => 'NOVA', 'member_count' => 8, 'rank' => 3, 'points' => 2154300, 'is_open' => true, 'type' => 'alliance'],
], 'category' => 4]));
out('galaxy-search-empty-term.json', j(['status' => 'error', 'message' => 'No search term entered', 'results' => []]));

// ================================================================== 5. Buddies
function br(int $id, int $from, int $to, int $ts, bool $viewed, ?string $msg): stdClass
{
    return (object)['id' => $id, 'sender_user_id' => $from, 'receiver_user_id' => $to, 'sender' => fxUser($from), 'receiver' => fxUser($to),
        'viewed' => $viewed, 'message' => $msg, 'created_at' => new \Carbon\Carbon($ts)];
}
$buddies = collect([br(41, 108, 150, $N - 20 * 86400, true, null)]);
$received = collect([br(57, 204, 108, $N - 5400, false, 'Hi! Neighbour from 1:42:13, want to trade?')]);
$sent = collect([br(58, 108, 233, $N - 7200, false, 'Truce?')]);
$ignored = collect([(object)['ignoredUser' => fxUser(202)]]);
out('galaxy-buddies-page.html', renderPage('ingame.buddies.index', '/buddies', [], $home, 'buddies', [
    'buddies' => $buddies, 'received_requests' => $received, 'sent_requests' => $sent, 'ignored_players' => $ignored, 'unread_requests_count' => 1,
]));
setCtx('/buddies/request-dialog', ['id' => '233', 'name' => 'Raider42']);
out('galaxy-buddies-request-dialog.html', blade_render('ingame.buddies.dialog', ['playerId' => '233', 'playerName' => 'Raider42']));
out('galaxy-buddies-online.json', j([
    'success' => true,
    'buddies' => [['id' => 150, 'username' => 'Nova', 'isOnline' => true, 'hasActiveChat' => true]],
    'count' => 1,
    'alliance' => null,
    'allianceMembers' => [],
    'recentPartners' => [['id' => 233, 'username' => 'Raider42', 'isOnline' => false]],
]));
out('galaxy-buddies-sendrequest-success.json', j(['success' => true, 'message' => __('t_buddies.success.request_sent'), 'request_id' => 59]));

// ================================================================== 6. Alliance info page (stand-alone HTML, opened in a new tab)
setCtx('/alliance/info/12', []);
$ally = (object)['id' => 12, 'alliance_tag' => 'NOVA', 'alliance_name' => 'Nova Collective', 'logo_url' => null,
    'external_text' => '[b]Nova Collective[/b] - miners and traders. Apply if you have 50k+ points.', 'homepage_url' => null, 'is_open' => true];
out('galaxy-alliance-info.html', blade_render('ingame.alliance.info', ['alliance' => $ally, 'memberCount' => 8, 'allianceRank' => 3, 'canApply' => true]));

echo implode("\n", $fixtures), "\n";

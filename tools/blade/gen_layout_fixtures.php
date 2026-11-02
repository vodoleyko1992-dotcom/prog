<?php
/**
 * Renders layout fixtures from the real OgameX Blade templates
 * (resources/views/ingame/layouts/main.blade.php + overview/index.blade.php,
 * ajax/object.blade.php) with stubbed sample data.
 *
 * Usage: php gen_layout_fixtures.php <fixtures-dir>
 */
require __DIR__ . '/blade.php';
require_once OGX_SRC . '/app/GameObjects/Models/Enums/GameObjectType.php';

use OGame\Facades\AppUtil;
use OGame\Services\PlanetService;
use OGame\Services\PlanetListService;
use OGame\Services\PlayerService;
use OGame\Services\SettingsService;
use OGame\Models\Resource;
use OGame\Models\Resources;
use OGame\GameObjects\Models\Enums\GameObjectType;

$outDir = rtrim($argv[1] ?? (__DIR__ . '/../../fixtures'), '/');

// ------------------------------------------------------------------ sample universe
function mkPlanet(array $d): PlanetService { return new PlanetService($d); }

function samplePlayer(bool $compact): PlayerService
{
    $home = mkPlanet([
        'id' => 1, 'name' => 'Homeworld', 'coords' => [1, 42, 8], 'diameter' => 12800,
        'fields_used' => 95, 'fields_max' => 163, 'temp' => [12, 52],
        'levels' => ['robot_factory' => 5, 'metal_mine' => 12],
        'res' => ['metal' => 152347.29861111, 'crystal' => 98712.55, 'deuterium' => 41230.871527778],
        'prod' => ['metal' => 4128, 'crystal' => 2187, 'deuterium' => 1043],
        'storage' => ['metal' => 255000, 'crystal' => 140000, 'deuterium' => 75000],
        'energy' => ['max' => 2860, 'used' => 2754],
    ]);
    $moon = mkPlanet([
        'id' => 5, 'name' => 'Moon', 'coords' => [1, 42, 8], 'diameter' => 8660, 'moon' => true,
        'fields_used' => 4, 'fields_max' => 7, 'temp' => [-28, 12],
        'levels' => ['lunar_base' => 2, 'jump_gate' => 1, 'sensor_phalanx' => 1],
        'res' => ['metal' => 12500, 'crystal' => 8300, 'deuterium' => 0],
        'prod' => ['metal' => 0, 'crystal' => 0, 'deuterium' => 0],
        'storage' => ['metal' => 10000, 'crystal' => 10000, 'deuterium' => 10000],
        'energy' => ['max' => 0, 'used' => 0],
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
    ]);
    $planets = [$home, $colony];
    $moons = [$moon];
    if ($compact) {
        $extra = [
            [4, 'Kepler', [2, 118, 4], 11000, 40, 172, [52, 92], false],
            [6, 'Tau Ceti', [3, 201, 9], 13400, 21, 181, [-3, 37], true],
            [7, 'Arrakis', [3, 205, 2], 9600, 18, 96, [118, 158], false],
            [8, 'Hoth', [4, 77, 14], 15100, 7, 233, [-122, -82], false],
        ];
        foreach ($extra as [$id, $name, $c, $dia, $fu, $fm, $t, $b]) {
            $planets[] = mkPlanet(['id' => $id, 'name' => $name, 'coords' => $c, 'diameter' => $dia,
                'fields_used' => $fu, 'fields_max' => $fm, 'temp' => $t, 'building' => $b, 'downgrading' => ($id === 6),
                'levels' => [], 'res' => ['metal' => 5000, 'crystal' => 2500, 'deuterium' => 0],
                'prod' => ['metal' => 300, 'crystal' => 150, 'deuterium' => 0],
                'storage' => ['metal' => 10000, 'crystal' => 10000, 'deuterium' => 10000],
                'energy' => ['max' => 22, 'used' => 0]]);
        }
    }
    return new PlayerService([
        'id' => 108, 'username' => 'Commander Vega', 'class' => 1 /* Collector */, 'maxPlanets' => 8,
    ], new PlanetListService($planets, $moons));
}

/** Mirrors app/Http/ViewComposers/IngameMainComposer.php::compose() */
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

function findById(PlayerService $pl, int $id): PlanetService
{
    foreach ([...$pl->planets->allPlanets(), ...$pl->planets->allMoons()] as $p) { if ($p->getPlanetId() === $id) { return $p; } }
    throw new RuntimeException("no planet $id");
}

function renderOverview(PlayerService $player, int $currentId, array $query): string
{
    $cur = findById($player, $currentId);
    $GLOBALS['__ctx'] = [
        'csrf' => 'Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e',
        'now' => gmmktime(0, 57, 17, 10, 30, 2026),
        'path' => '/overview', 'query' => $query,
        'settings' => new SettingsService(), 'economySpeed' => 1, 'fleetSpeed' => 1,
        'player' => $player,
    ];
    $GLOBALS['__sections'] = [];
    $isMoon = $cur->isMoon();
    $other = $isMoon ? $cur->planet() : ($cur->hasMoon() ? $cur->moon() : null);
    $vars = [
        // layout (IngameMainComposer)
        'underAttack' => false,
        'unreadMessagesCount' => 3,
        'buddyRequestCount' => 0,
        'onlineBuddiesCount' => 1,
        'unreadChatCount' => 0,
        'resources' => composeResources($cur, 8000),
        'currentPlayer' => $player,
        'currentPlanet' => $cur,
        'planets' => $player->planets,
        'highscoreRank' => 37,
        'settings' => new SettingsService(),
        'body_id' => 'overview',
        'locale' => 'en',
        'isImpersonating' => false,
        'impersonateLeaveUrl' => null,
        'attackBlockActive' => false,
        'attackBlockUntil' => 0,
        'attackBlockTooltip' => '',
        'planet_move_in_progress' => false,
        // overview (OverviewController::index)
        'header_filename' => $isMoon ? 'moon/' . $cur->getPlanetImageType() : $cur->getPlanetBiomeType(),
        'planet_name' => $cur->getPlanetName(),
        'planet_diameter' => $cur->getPlanetDiameter(),
        'planet_temp_min' => $cur->getPlanetTempMin(),
        'planet_temp_max' => $cur->getPlanetTempMax(),
        'planet_coordinates' => $cur->getPlanetCoordinates()->asString(),
        'planet_galaxy' => $cur->getPlanetCoordinates()->galaxy,
        'planet_system' => $cur->getPlanetCoordinates()->system,
        'planet_position' => $cur->getPlanetCoordinates()->position,
        'user_points' => AppUtil::formatNumber(48213),
        'user_rank' => 37,
        'max_rank' => 214,
        'user_honor_points' => 0,
        'build_active' => null,
        'building_count' => $cur->getBuildingCount(),
        'max_building_count' => $cur->getPlanetFieldMax(),
        'build_queue' => [],
        'research_active' => null,
        'research_queue' => [],
        'ship_active' => null,
        'ship_queue' => [],
        'ship_queue_time_countdown' => 0,
        'has_moon' => !$isMoon && $cur->hasMoon(),
        'has_planet' => $isMoon && $cur->hasPlanet(),
        'other_planet' => $other,
        'wreck_field' => null,
        'show_wreck_field_icon' => false,
        'planet_move' => null,
        'planet_move_countdown' => 0,
        'planet_move_target' => '',
        'planet_move_blockers' => [],
        'planet_move_cooldown' => 0,
    ];
    return blade_render('ingame.overview.index', $vars);
}

// ------------------------------------------------------------------ pages
$player = samplePlayer(false);
file_put_contents("$outDir/layout-overview-planet.html", renderOverview($player, 1, ['cp' => '1']));
file_put_contents("$outDir/layout-overview-moon.html", renderOverview($player, 5, ['cp' => '5']));
$player6 = samplePlayer(true);
file_put_contents("$outDir/layout-overview-compact.html", renderOverview($player6, 3, []));

// ------------------------------------------------------------------ GET /ajax/resources?technology=1
$GLOBALS['__ctx']['path'] = '/ajax/resources';
$GLOBALS['__ctx']['query'] = ['technology' => '1'];
$home = findById($player, 1);
$object = new stdClass();
$object->id = 1; $object->machine_name = 'metal_mine'; $object->class_name = 'metalMine';
$object->title = __('t_resources.metal_mine.title');
$object->type = GameObjectType::Building;
$object->consumesPlanetField = true;
$price = new Resources(7784, 1946, 0, 0);            // 60*1.5^12, 15*1.5^12 floored
$prodNext = new Resources(0, 0, 0, -448);
$downgrade = new Resources(5189, 1297, 0, 0);
$html = blade_render('ingame.ajax.object', [
    'object' => $object,
    'object_type' => $object->type,
    'planet_id' => 1,
    'current_level' => 12,
    'next_level' => 13,
    'description' => __('t_resources.metal_mine.description'),
    'title' => $object->title,
    'price' => $price,
    'planet' => $home,
    'production_time' => AppUtil::formatTimeDuration(2335),
    'production_datetime' => AppUtil::formatDateTimeDuration(2335),
    'production_next' => $prodNext,
    'energy_difference' => 72,
    'enough_resources' => true,
    'has_requirements' => false,
    'requirements_met' => true,
    'character_class_met' => true,
    'valid_planet_type' => true,
    'build_active' => 0,
    'build_active_current' => null,
    'build_queue_max' => false,
    'storage' => false,
    'current_storage' => 0,
    'max_storage' => 0,
    'max_build_amount' => 1,
    'current_amount' => 0,
    'research_lab_upgrading' => false,
    'research_in_progress' => false,
    'shipyard_upgrading' => false,
    'nanite_upgrading' => false,
    'ship_or_defense_in_progress' => false,
    'downgrade_price' => $downgrade,
    'downgrade_duration' => 1557,
    'downgrade_duration_formatted' => AppUtil::formatTimeDuration(1557),
    'ion_technology_level' => 0,
    'ion_technology_bonus' => 0,
    'can_downgrade' => true,
    'is_in_vacation_mode' => false,
    'is_missile_silo' => false,
    'current_missiles' => 0,
    'max_missiles' => 0,
    'fields_exceeded' => false,
    'use_production_energy' => false,
]);
// Laravel response()->json() => json_encode with flags 0 (escapes "/" and unicode)
$json = json_encode([
    'target' => 'technologydetails',
    'content' => ['technologydetails' => $html],
    'files' => ['js' => [], 'css' => []],
    'newAjaxToken' => $GLOBALS['__ctx']['csrf'],
    'page' => ['stateObj' => [], 'title' => 'OGameX', 'url' => route('resources.index')],
    'serverTime' => $GLOBALS['__ctx']['now'],
]);
file_put_contents("$outDir/layout-ajax-resources-technology-1.json", $json);
echo "ok\n";

// ------------------------------------------------------------------ GET /overlay/server-settings (HTML fragment, no layout)
$GLOBALS['__ctx']['path'] = '/overlay/server-settings';
$GLOBALS['__ctx']['query'] = [];
file_put_contents("$outDir/layout-overlay-server-settings.html", blade_render('ingame.serversettings.overlay', [
    'universe_name' => 'Universe',
    'fleet_speed_war' => 2,
    'fleet_speed_holding' => 1,
    'fleet_speed_peaceful' => 1,
    'economy_speed' => 1,
    'research_speed' => 1,
    'planet_fields_bonus' => 0,
    'dark_matter_bonus' => 8000,
    'alliance_combat_system_on' => true,
    'debris_field_from_ships' => 30,
    'debris_field_from_defense' => 0,
    'debris_field_deuterium_on' => false,
    'maximum_moon_chance' => 20,
    'ignore_empty_systems_on' => true,
    'ignore_inactive_systems_on' => true,
    'number_of_galaxies' => 9,
    'dark_matter_regen_enabled' => false,
    'dark_matter_regen_amount' => 150000,
    'dark_matter_regen_period' => 604800,
]));
echo "ok2\n";

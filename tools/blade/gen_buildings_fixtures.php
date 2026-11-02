<?php
/**
 * Renders the buildings-* fixtures from the REAL OgameX Blade templates
 * (resources/index, resources/settings, facilities/index, research/index,
 * shipyard/index, defense/index, overview/index, ajax/object, techtree/*)
 * with view data computed by ogx/tools/buildings/export.js (OgameX formulas).
 *
 * Usage:
 *   node ../buildings/export.js > /tmp/viewdata.json
 *   php gen_buildings_fixtures.php /tmp/viewdata.json <fixtures-dir>
 */
require __DIR__ . '/blade_b.php';
require_once OGX_SRC . '/app/GameObjects/Models/Enums/GameObjectType.php';

use OGame\Facades\AppUtil;
use OGame\Services\PlanetService;
use OGame\Services\PlanetListService;
use OGame\Services\PlayerService;
use OGame\Services\SettingsService;
use OGame\Models\Resource;
use OGame\Models\Resources;
use OGame\GameObjects\Models\Enums\GameObjectType;

$data = json_decode(file_get_contents($argv[1]), true);
$outDir = rtrim($argv[2] ?? (__DIR__ . '/../../fixtures'), '/');

/** GameObject stand-in (app/GameObjects/Models/Abstracts/GameObject.php) */
class GObj
{
    public int $id; public string $machine_name; public string $class_name; public string $title;
    public GameObjectType $type; public bool $consumesPlanetField = true; public $assets;
    public string $description = ''; public string $description_long = '';
    public $production = null; public $storage = null; public bool $hasReq = false;
    public function hasRequirements(): bool { return $this->hasReq; }
}
/** app/ViewModels/UnitViewModel.php stand-in */
class UnitVM
{
    public function __construct(array $p) { foreach ($p as $k => $v) { $this->$k = $v; } }
    public function getFormattedFull(): string { return AppUtil::formatNumber($this->amount); }
}

$OBJ = [];
foreach ($data['objects'] as $mn => $o) {
    $g = new GObj();
    $g->id = $o['id']; $g->machine_name = $mn; $g->class_name = $o['class_name'];
    $g->title = __("t_resources.$mn.title");
    $g->description = __("t_resources.$mn.description");
    $g->description_long = __("t_resources.$mn.description_long");
    $g->type = GameObjectType::from(strtolower($o['type']));
    $g->consumesPlanetField = $o['consumesPlanetField'];
    $g->assets = (object)['imgSmall' => $o['imgSmall'], 'imgMicro' => $o['imgMicro']];
    $g->production = $o['production'] ? (object)['x' => 1] : null;
    $g->storage = $o['storage'] ? (object)['x' => 1] : null;
    $g->hasReq = $o['hasRequirements'];
    $OBJ[$mn] = $g;
}

$PLANETS = [];
foreach ($data['planets'] as $p) { $PLANETS[$p['id']] = new PlanetService($p); }
$planetList = []; $moonList = [];
foreach ($PLANETS as $p) {
    if (!empty($p->d['moonId'])) { $p->d['moonObj'] = $PLANETS[$p->d['moonId']]; }
    if (!empty($p->d['parentId'])) { $p->d['planetObj'] = $PLANETS[$p->d['parentId']]; }
    if ($p->isMoon()) { $moonList[] = $p; } else { $planetList[] = $p; }
}
$player = new PlayerService(['id' => $data['player']['id'], 'username' => $data['player']['username'], 'class' => $data['player']['class'], 'maxPlanets' => $data['player']['maxPlanets']], new PlanetListService($planetList, $moonList));

function conv($v, bool $assocAsArray = false)
{
    global $OBJ, $PLANETS, $player;
    if (!is_array($v)) { return $v; }
    if (array_is_list($v)) { return array_map(fn($x) => conv($x, $assocAsArray), $v); }
    if (array_key_exists('__res', $v)) { return new Resources(...$v['__res']); }
    if (array_key_exists('__obj', $v)) { return $OBJ[$v['__obj']]; }
    if (array_key_exists('__planet', $v)) { return $PLANETS[$v['__planet']]; }
    if (array_key_exists('__enum', $v)) { return GameObjectType::from(strtolower($v['__enum'])); }
    if (array_key_exists('__title', $v)) { return $OBJ[$v['__title']]->title; }
    if (array_key_exists('__desc', $v)) { return $OBJ[$v['__desc']]->description; }
    if (array_key_exists('__fmtTime', $v)) { return AppUtil::formatTimeDuration($v['__fmtTime']); }
    if (array_key_exists('__fmtDateTime', $v)) { return AppUtil::formatDateTimeDuration($v['__fmtDateTime']); }
    if (array_key_exists('__fmtLong', $v)) { return AppUtil::formatNumberLong($v['__fmtLong']); }
    if (array_key_exists('__player', $v)) { return $player; }
    if (array_key_exists('__pi', $v)) { $o = new stdClass(); foreach ($v['__pi'] as $k => $r) { $o->$k = conv($r); } return $o; }
    $out = [];
    foreach ($v as $k => $x) { if ($k !== '__unitvm') { $out[$k] = conv($x, $assocAsArray); } }
    if (array_key_exists('__unitvm', $v)) { return new UnitVM($out); }
    return $assocAsArray ? $out : (object)$out;
}

function convVars(array $vars): array
{
    $out = [];
    foreach ($vars as $k => $v) {
        if (str_starts_with($k, '__')) { continue; }
        $asArr = in_array($k, ['building_resource_rows', 'building_energy_rows', 'officers', 'production_table'], true);
        $out[$k] = conv($v, $asArr);
    }
    return $out;
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

function setCtx(string $path, array $query): void
{
    global $data, $player;
    $GLOBALS['__ctx'] = [
        'csrf' => $data['csrf'], 'now' => $data['now'], 'path' => $path, 'query' => $query,
        'settings' => new SettingsService(), 'economySpeed' => $data['economySpeed'], 'fleetSpeed' => $data['fleetSpeed'],
        'player' => $player,
    ];
    $GLOBALS['__sections'] = [];
}

function layoutVars(PlanetService $cur, string $bodyId): array
{
    global $data, $player;
    return [
        'underAttack' => false, 'unreadMessagesCount' => 2, 'buddyRequestCount' => 0, 'onlineBuddiesCount' => 0, 'unreadChatCount' => 0,
        'resources' => composeResources($cur, $data['player']['darkMatter']),
        'currentPlayer' => $player, 'currentPlanet' => $cur, 'planets' => $player->planets,
        'highscoreRank' => $data['player']['highscoreRank'], 'settings' => new SettingsService(), 'body_id' => $bodyId, 'locale' => 'en',
        'isImpersonating' => false, 'impersonateLeaveUrl' => null, 'attackBlockActive' => false, 'attackBlockUntil' => 0, 'attackBlockTooltip' => '',
        'planet_move_in_progress' => false,
    ];
}

$written = [];
// ---------------------------------------------------------------- full pages
foreach ($data['pages'] as $pg) {
    setCtx($pg['path'], $pg['query']);
    $cur = $PLANETS[$pg['current']];
    $vars = array_merge(layoutVars($cur, $pg['body_id']), convVars($pg['vars']));
    file_put_contents("$outDir/{$pg['file']}", blade_render($pg['view'], $vars));
    $written[] = $pg['file'];
}

// ---------------------------------------------------------------- AJAX technology details (ObjectAjaxTrait::ajaxHandler)
foreach ($data['ajax'] as $aj) {
    setCtx($aj['path'], ['technology' => (string)$aj['technology']]);
    $vars = convVars($aj['vars']);
    $vars['description'] .= $aj['vars']['__extraDescription'];
    $html = blade_render('ingame.ajax.object', $vars);
    $json = json_encode([
        'target' => 'technologydetails',
        'content' => ['technologydetails' => $html],
        'files' => ['js' => [], 'css' => []],
        'newAjaxToken' => $data['csrf'],
        'page' => ['stateObj' => [], 'title' => 'OGameX', 'url' => route('resources.index')],
        'serverTime' => $data['now'],
    ]);
    file_put_contents("$outDir/{$aj['file']}", $json);
    $written[] = $aj['file'];
}

// ---------------------------------------------------------------- techtree overlay (TechtreeController::ajax, returns HTML)
foreach ($data['techtree'] as $tt) {
    setCtx('/ajax/techtree', []);
    $vars = convVars($tt['vars']);
    if ($tt['view'] === 'ingame.techtree.techinfo') {
        $vars['production_table'] = blade_render('ingame.techtree.info.production', [
            'object' => $vars['object'], 'planet' => $vars['planet'], 'production_table' => $vars['production_table'], 'current_level' => $vars['current_level'],
        ]);
        foreach (['storage_table', 'rapidfire_table', 'properties_table', 'plasma_table', 'astrophysics_table'] as $k) { $vars[$k] = ''; } // view('empty')
    }
    if ($tt['view'] === 'ingame.techtree.techtree') {
        $list = $vars['techtree'];
        foreach ($list as $i => $r) { if (is_object($r->parent ?? null) && isset($r->parent->__ref)) { $list[$i]->parent = $list[$r->parent->__ref]; } }
        // TechtreeController::ajax lines 37-60
        $columns = array_map(fn($r) => $r->column, $list);
        $byDepth = []; $added = []; $unique = [];
        foreach ($list as $r) {
            $key = $r->gameObject->id . '|' . $r->levelRequired;
            if (!isset($added[$key])) { $added[$key] = true; $byDepth[$r->depth][$r->column] = $r; }
            $unique[$r->gameObject->id . $r->levelRequired] ??= $r;
        }
        $vars = ['object' => $vars['object'], 'amount_of_columns' => max($columns) + 1, 'techtree' => $list, 'techtree_unique' => $unique, 'techtree_by_depth' => $byDepth];
    }
    file_put_contents("$outDir/{$tt['file']}", blade_render($tt['view'], $vars));
    $written[] = $tt['file'];
}

// ---------------------------------------------------------------- add-buildrequest / cancel / halve JSON bodies (exact controller arrays)
$J = function (string $f, array $a) use ($outDir, &$written) { file_put_contents("$outDir/$f", json_encode($a)); $written[] = $f; };
$J('buildings-addbuildrequest-success.json', ['status' => 'success', 'message' => __('t_ingame.buildings.building_started')]); // AbstractBuildingsController:274, ResearchController:189
$J('buildings-addbuildrequest-unit-success.json', ['status' => 'success', 'message' => 'Added to build order.']);           // AbstractUnitsController:165
$J('buildings-addbuildrequest-downgrade-success.json', ['status' => 'success', 'message' => 'Building downgrade started.']); // AbstractBuildingsController:311
$J('buildings-addbuildrequest-invalid-token.json', ['success' => false, 'message' => 'Invalid token.']);                     // :256
$J('buildings-addbuildrequest-error.json', ['success' => false, 'message' => 'Maximum number of items already in queue.']);   // :268 (BuildingQueueService:77)
$J('buildings-addbuildrequest-shipyard-busy.json', ['success' => false, 'errors' => [['message' => 'The Shipyard is still busy.']]]); // :244
$J('buildings-addbuildrequest-shipyard-upgrading.json', ['success' => false, 'errors' => [['message' => 'Shipyard is being upgraded.']]]); // ShipyardController:83
$J('buildings-addbuildrequest-downgrade-error.json', ['success' => false, 'errors' => [['message' => 'Cannot downgrade building: other buildings or research depend on this level.']]]); // :316
$J('buildings-addbuildrequest-vacation.json', ['success' => false]);                                                          // :232
$J('buildings-cancelbuildrequest-success.json', ['status' => 'success', 'message' => 'Building construction canceled.']);    // :338
$J('buildings-halve-building-success.json', ['success' => true, 'error' => false, 'newAjaxToken' => $data['csrf'], 'new_time_end' => $data['now'] + 4807, 'cost' => 5827, 'new_balance' => 2173, 'remaining_time' => 4807]); // FacilitiesController:131
$J('buildings-halve-error.json', ['success' => false, 'error' => true, 'message' => 'Invalid queue item ID', 'newAjaxToken' => $data['csrf']]);

echo implode("\n", $written), "\n";

<?php
/**
 * Renders messages fixtures from the real OgameX Blade templates
 * (resources/views/ingame/messages/**) with stubbed sample data.
 *
 * The GameMessage logic (subject/body/footer, placeholder replacement, number
 * formatting) is ported 1:1 from app/GameMessages/Abstracts/GameMessage.php,
 * app/GameMessages/*.php and app/Services/MessageService.php.
 *
 * Usage: php gen_messages_fixtures.php [<fixtures-dir>]
 */
require __DIR__ . '/blade.php';

use OGame\Facades\AppUtil;
use OGame\Services\PlanetService;
use OGame\Services\PlanetListService;
use OGame\Services\PlayerService;
use OGame\Services\SettingsService;
use OGame\Models\Resource;

$outDir = rtrim($argv[1] ?? (__DIR__ . '/../../fixtures'), '/');

const MSG_NOW = 1793321837; // 2026-10-30 00:57:17 UTC (same "now" as the layout fixtures)

// ====================================================================== helpers
/** Resources with sum()/any() (app/Models/Resources.php:39-52). */
class MsgResources extends \OGame\Models\Resources
{
    public function sum(): float { return $this->metal->get() + $this->crystal->get() + $this->deuterium->get() + $this->energy->get(); }
    public function any(): bool { return $this->metal->get() > 0 || $this->crystal->get() > 0 || $this->deuterium->get() > 0 || $this->energy->get() > 0; }
}

/** Game object table parsed from app/GameObjects/*.php (declaration order = ObjectService order). */
function msg_objects(): array
{
    static $all = null;
    if ($all !== null) { return $all; }
    $all = [];
    foreach (['MilitaryShipObjects', 'CivilShipObjects', 'DefenseObjects', 'BuildingObjects', 'StationObjects', 'ResearchObjects'] as $file) {
        $src = file_get_contents(OGX_SRC . "/app/GameObjects/$file.php");
        preg_match_all('/\$(\w+)->id = (\d+);/', $src, $m, PREG_SET_ORDER);
        foreach ($m as [$_, $var, $id]) {
            preg_match('/\$' . $var . '->machine_name = \'([^\']+)\'/', $src, $mn);
            preg_match('/\$' . $var . '->title = __\(\'([^\']+)\'\)/', $src, $tt);
            preg_match('/\$' . $var . '->assets->imgMicro = \'([^\']+)\'/', $src, $im);
            $o = new stdClass();
            $o->id = (int)$id;
            $o->machine_name = $mn[1];
            $o->title = __($tt[1]);
            $o->assets = (object)['imgMicro' => $im[1] ?? ''];
            $o->group = $file;
            $all[$o->machine_name] = $o;
        }
    }
    return $all;
}
function msg_obj(string $machine): stdClass { return msg_objects()[$machine]; }
function msg_objs_of(string $group): array { return array_values(array_filter(msg_objects(), fn($o) => $o->group === $group)); }
function msg_obj_by_id(int $id): stdClass { foreach (msg_objects() as $o) { if ($o->id === $id) { return $o; } } throw new RuntimeException("no object $id"); }

class MsgUnitEntry { public function __construct(public stdClass $unitObject, public int $amount) {} }
/** Port of app/GameObjects/Models/Units/UnitCollection.php (addUnit/getAmountByMachineName/getAmount). */
class MsgUnitCollection
{
    /** @var MsgUnitEntry[] */
    public array $units = [];
    public static function from(array $byMachine): MsgUnitCollection { $c = new MsgUnitCollection(); foreach ($byMachine as $k => $v) { $c->addUnit(msg_obj($k), $v); } return $c; }
    public function addUnit(stdClass $o, int $amount): void { foreach ($this->units as $e) { if ($e->unitObject->machine_name === $o->machine_name) { $e->amount += $amount; return; } } $this->units[] = new MsgUnitEntry($o, $amount); }
    public function getAmountByMachineName(string $m): int { foreach ($this->units as $e) { if ($e->unitObject->machine_name === $m) { return $e->amount; } } return 0; }
    public function getAmount(): int { $n = 0; foreach ($this->units as $e) { $n += $e->amount; } return $n; }
}

/**
 * Laravel translator replacement (Illuminate\Translation\Translator::makeReplacements):
 * strtr() with :key, :Key and :KEY variants (longest match wins).
 */
function msg_trans(string $key, array $replace = []): string
{
    $line = __($key);
    if (!is_string($line)) { throw new RuntimeException("translation $key is not a string"); }
    $r = [];
    foreach ($replace as $k => $v) {
        $v = (string)$v;
        $r[':' . ucfirst($k)] = ucfirst($v);
        $r[':' . strtoupper($k)] = strtoupper($v);
        $r[':' . $k] = $v;
    }
    return strtr($line, $r);
}

// ====================================================================== sample universe
function mkPlanet(array $d): PlanetService { return new PlanetService($d); }

function msgUniverse(): array
{
    $home = mkPlanet(['id' => 1, 'name' => 'Homeworld', 'coords' => [1, 42, 8], 'diameter' => 12800,
        'fields_used' => 95, 'fields_max' => 163, 'temp' => [12, 52], 'levels' => [],
        'res' => ['metal' => 152347.29861111, 'crystal' => 98712.55, 'deuterium' => 41230.871527778],
        'prod' => ['metal' => 4128, 'crystal' => 2187, 'deuterium' => 1043],
        'storage' => ['metal' => 255000, 'crystal' => 140000, 'deuterium' => 75000],
        'energy' => ['max' => 2860, 'used' => 2754]]);
    $moon = mkPlanet(['id' => 5, 'name' => 'Moon', 'coords' => [1, 42, 8], 'diameter' => 8660, 'moon' => true,
        'fields_used' => 4, 'fields_max' => 7, 'temp' => [-28, 12], 'levels' => [],
        'res' => ['metal' => 12500, 'crystal' => 8300, 'deuterium' => 0],
        'prod' => ['metal' => 0, 'crystal' => 0, 'deuterium' => 0],
        'storage' => ['metal' => 10000, 'crystal' => 10000, 'deuterium' => 10000],
        'energy' => ['max' => 0, 'used' => 0]]);
    $home->d['moonObj'] = $moon; $moon->d['planetObj'] = $home;
    $colony = mkPlanet(['id' => 3, 'name' => 'Colony', 'coords' => [2, 118, 12], 'diameter' => 14530,
        'fields_used' => 52, 'fields_max' => 188, 'temp' => [-61, -21], 'building' => true, 'levels' => [],
        'res' => ['metal' => 30512.75, 'crystal' => 14876.5, 'deuterium' => 22340.25],
        'prod' => ['metal' => 1560, 'crystal' => 780, 'deuterium' => 690],
        'storage' => ['metal' => 50000, 'crystal' => 50000, 'deuterium' => 50000],
        'energy' => ['max' => 1210, 'used' => 1306]]);
    $me = new PlayerService(['id' => 108, 'username' => 'Commander Vega', 'class' => 1, 'maxPlanets' => 8, 'research' => []],
        new PlanetListService([$home, $colony], [$moon]));

    // Foreign planets referenced by messages.
    $arrakeen = mkPlanet(['id' => 41, 'name' => 'Arrakeen', 'coords' => [1, 45, 9], 'owner' => 214]);
    $arrakeenMoon = mkPlanet(['id' => 42, 'name' => 'Moon', 'coords' => [1, 45, 9], 'moon' => true, 'owner' => 214]);
    $arrakeen->d['moonObj'] = $arrakeenMoon; $arrakeenMoon->d['planetObj'] = $arrakeen;
    $hagen = mkPlanet(['id' => 61, 'name' => 'Colony', 'coords' => [1, 39, 4], 'owner' => 87]);
    $kronos = mkPlanet(['id' => 77, 'name' => 'Kronos', 'coords' => [1, 42, 11], 'owner' => 156]);

    $planets = [1 => $home, 5 => $moon, 3 => $colony, 41 => $arrakeen, 42 => $arrakeenMoon, 61 => $hagen, 77 => $kronos];
    $players = [108 => 'Commander Vega', 214 => 'Lieutenant Nusakan', 87 => 'Hagen', 156 => 'Admiral Rigel'];
    return [$me, $planets, $players];
}

[$ME, $PLANETS, $PLAYERS] = msgUniverse();

// ====================================================================== GameMessage port
/** Port of GameMessage::replacePlaceholders() (app/GameMessages/Abstracts/GameMessage.php:294-373). */
function msg_replace_placeholders(string $body): string
{
    global $PLANETS, $PLAYERS;
    $body = preg_replace_callback('/\[player\](\d+)\[\/player\]/', function ($m) use ($PLAYERS) {
        return $PLAYERS[(int)$m[1]] ?? 'Unknown Player';
    }, $body) ?? '';
    $body = preg_replace_callback('/\[planet\](\d+)\[\/planet\]/', function ($m) use ($PLANETS) {
        $p = $PLANETS[(int)$m[1]] ?? null;
        if ($p === null) { return 'Unknown Planet'; }
        $planetIcon = ''; $planetIconTitle = ''; $planetIconHtml = '';
        if (!$p->isMoon()) {
            $planetIconHtml = '<img src="' . asset('img/planets/medium/' . $p->getPlanetBiomeType() . '_' . $p->getPlanetImageType() . '.png') . '" width="16" height="16" class="tooltip js_hideTipOnMobile" title="Planet">';
        } else {
            $planetIcon = 'moon'; $planetIconTitle = 'Moon';
        }
        if (empty($planetIconHtml)) {
            $planetIconHtml = '<figure class="planetIcon ' . $planetIcon . ' tooltip js_hideTipOnMobile" title="' . $planetIconTitle . '"></figure>';
        }
        $c = $p->getPlanetCoordinates();
        return '<a href="' . route('galaxy.index', ['galaxy' => $c->galaxy, 'system' => $c->system, 'position' => $c->position]) . '" class="txt_link">'
            . $planetIconHtml . ' '
            . $p->getPlanetName() . ' [' . $c->asString() . ']</a>';
    }, $body) ?? '';
    $body = preg_replace_callback('/\[coordinates\](\d+):(\d+):(\d+)\[\/coordinates\]/', function ($m) {
        $c = new \OGame\Models\Planet\Coordinate((int)$m[1], (int)$m[2], (int)$m[3]);
        return '<a href="' . route('galaxy.index', ['galaxy' => $c->galaxy, 'system' => $c->system, 'position' => $c->position]) . '" class="txt_link">
                                <figure class="planetIcon planet tooltip js_hideTipOnMobile" title="Planet"></figure>
                            [' . $c->asString() . ']</a>';
    }, $body) ?? '';
    $body = preg_replace_callback('/\[debrisfield\](\d+):(\d+):(\d+)\[\/debrisfield\]/', function ($m) {
        $c = new \OGame\Models\Planet\Coordinate((int)$m[1], (int)$m[2], (int)$m[3]);
        return '<a href="' . route('galaxy.index', ['galaxy' => $c->galaxy, 'system' => $c->system, 'position' => $c->position]) . '" class="txt_link">
                                <figure class="planetIcon tf tooltip js_hideTipOnMobile" title="Planet"></figure>
                            debris field [' . $c->asString() . ']</a>';
    }, $body) ?? '';
    return $body;
}

/** GameMessage::formatReservedParams() (GameMessage.php:266-286). */
function msg_format_reserved(array $params): array
{
    foreach ($params as $k => $v) {
        if (in_array($k, ['metal', 'crystal', 'deuterium', 'harvested_metal', 'harvested_crystal', 'harvested_deuterium', 'storage_capacity', 'ship_amount', 'resource_amount'], true)) {
            $params[$k] = AppUtil::formatNumber((int)$v);
        }
    }
    return $params;
}

/** Tab/subtab per key (initialize() of every app/GameMessages/*.php). */
function msg_key_meta(string $key): array
{
    $map = [
        'welcome_message' => ['universe', 'universe', ['player']],
        'return_of_fleet_with_resources' => ['fleets', 'other', ['from', 'to', 'metal', 'crystal', 'deuterium']],
        'return_of_fleet' => ['fleets', 'other', ['from', 'to']],
        'transport_arrived' => ['fleets', 'transport', ['from', 'to', 'metal', 'crystal', 'deuterium']],
        'transport_received' => ['fleets', 'other', ['from', 'to', 'metal', 'crystal', 'deuterium']],
        'colony_established' => ['economy', 'economy', ['coordinates']],
        'colony_establish_fail_astrophysics' => ['economy', 'economy', ['coordinates']],
        'fleet_deployment' => ['fleets', 'other', ['from', 'to']],
        'fleet_deployment_with_resources' => ['fleets', 'other', ['from', 'to', 'metal', 'crystal', 'deuterium']],
        'acs_defend_arrival_sender' => ['fleets', 'other', ['to']],
        'acs_defend_arrival_host' => ['fleets', 'other', ['to']],
        'espionage_report' => ['fleets', 'espionage', []],
        'espionage_detected' => ['fleets', 'espionage', ['planet', 'defender', 'attacker_name', 'chance']],
        'battle_report' => ['fleets', 'combat_reports', []],
        'fleet_lost_contact' => ['fleets', 'combat_reports', ['coordinates']],
        'debris_field_harvest' => ['fleets', 'other', ['to', 'coordinates', 'ship_name', 'ship_amount', 'storage_capacity', 'metal', 'crystal', 'deuterium', 'harvested_metal', 'harvested_crystal', 'harvested_deuterium']],
        'missile_attack_report' => ['fleets', 'combat_reports', []],
        'missile_defense_report' => ['fleets', 'combat_reports', []],
        'fleet_union_invite' => ['fleets', 'transport', ['sender_name', 'union_name', 'target_player', 'target_coords', 'arrival_time']],
        'planet_relocation_success' => ['economy', 'economy', ['planet_name', 'old_coordinates', 'new_coordinates']],
        'wreck_field_repair_completed' => ['economy', 'economy', ['planet', 'ship_count']],
        'buddy_request_accepted' => ['communication', 'information', ['accepter_name']],
    ];
    if (str_starts_with($key, 'expedition_')) { return ['fleets', 'expeditions', []]; }
    return $map[$key];
}

class SampleMessage
{
    public string $tab; public string $subtab; public array $paramNames;
    public ?array $espionage = null; public ?array $battle = null;
    public function __construct(public int $id, public string $key, public array $params, public int $createdAt, public bool $unread)
    {
        [$this->tab, $this->subtab, $this->paramNames] = msg_key_meta($key);
    }
    public function isUnread(): bool { return $this->unread; }
    public function getId(): int { return $this->id; }
    public function getKey(): string { return $this->key; }
    public function getTab(): string { return $this->tab; }
    public function getSubtab(): string { return $this->subtab; }
    public function getDateFormatted(): string { return gmdate('d.m.Y H:i:s', $this->createdAt); }
    public function getFrom(): string { return __('t_messages.' . $this->key . '.from'); }
    private function checkParams(array $p): array { foreach ($this->paramNames as $n) { if (!array_key_exists($n, $p)) { $p[$n] = '?undefined?'; } } return $p; }

    public function getSubject(): string
    {
        if ($this->key === 'espionage_report') {
            // EspionageReport::getSubject() (EspionageReport.php:54-68)
            return msg_replace_placeholders(msg_trans('Espionage report from :planet', ['planet' => '[planet]' . $this->espionage['planet_id'] . '[/planet]']));
        }
        if ($this->key === 'battle_report') {
            // BattleReport::getSubject() (BattleReport.php:58-72)
            return msg_replace_placeholders(msg_trans('Combat report :planet', ['planet' => '[planet]' . $this->battle['defender_planet_id'] . '[/planet]']));
        }
        return msg_replace_placeholders(msg_trans('t_messages.' . $this->key . '.subject', $this->checkParams($this->params)));
    }

    public function getBody(): string
    {
        $k = $this->key;
        if ($k === 'espionage_report') { return msg_render('ingame.messages.templates.espionage_report', espionage_params($this)); }
        if ($k === 'battle_report') { return msg_render('ingame.messages.templates.battle_report', battle_params($this)); }
        if ($k === 'missile_attack_report') { return missile_attack_body($this->params); }
        if ($k === 'missile_defense_report') { return missile_defense_body($this->params); }
        if (str_starts_with($k, 'expedition_')) { return expedition_body($k, $this->params); }
        $params = msg_format_reserved($this->checkParams($this->params));
        return msg_replace_placeholders(nl2br(msg_trans('t_messages.' . $k . '.body', $params)));
    }

    public function getBodyFull(): string
    {
        if ($this->key === 'espionage_report') { return msg_render('ingame.messages.templates.espionage_report_full', espionage_params($this)); }
        if ($this->key === 'battle_report') { return msg_render('ingame.messages.templates.battle_report_full', battle_params($this)); }
        return $this->getBody();
    }

    public function getFooterActions(): string { return ''; }

    public function getFooterDetails(): string
    {
        if ($this->key === 'espionage_report' || $this->key === 'battle_report') {
            // EspionageReport.php:111-119 / BattleReport.php:99-107
            return ' <a class="fright txt_link msg_action_link overlay"
                   href="' . $this->getFullMessageUrl() . '"
                   data-overlay-title="More details">
                    More details
                </a>';
        }
        return '';
    }

    /** GameMessage::getFullMessageUrl() (GameMessage.php:204-209). */
    public function getFullMessageUrl(): string
    {
        return route('messages.ajax.getmessage', ['messageId' => $this->id]) . '?tab=' . urlencode($this->tab) . '&subtab=' . urlencode($this->subtab);
    }
}

/** ExpeditionGameMessage::getBody() + subclass overrides. */
function expedition_body(string $key, array $raw): string
{
    $params = msg_format_reserved($raw);
    $body = msg_replace_placeholders(nl2br(msg_trans('t_messages.' . $key . '.body.' . $params['message_variation_id'], $params)));
    if ($key === 'expedition_gain_resources' && !empty($params['resource_type']) && !empty($params['resource_amount'])) {
        $label = ['metal' => 'Metal', 'crystal' => 'Crystal', 'deuterium' => 'Deuterium'][$params['resource_type']];
        $body .= '<br /><br />' . msg_trans('t_messages.expedition_resources_captured', ['resource_type' => $label, 'resource_amount' => $params['resource_amount']]);
    }
    if ($key === 'expedition_gain_dark_matter' && !empty($params['dark_matter_amount'])) {
        $body .= '<br /><br />' . msg_trans('t_messages.expedition_dark_matter_captured', ['dark_matter_amount' => $params['dark_matter_amount']]);
    }
    if ($key === 'expedition_gain_ships' && !empty($params)) {
        $body .= '<br /><br />' . __('t_messages.expedition_units_captured');
        foreach ($params as $k => $v) {
            if (str_starts_with($k, 'unit_')) {
                $o = msg_obj_by_id((int)str_replace('unit_', '', $k));
                $body .= '<br />' . $o->title . ': ' . AppUtil::formatNumber((int)$v);
            }
        }
    }
    return $body;
}

/** MissileAttackReport::getBody() (MissileAttackReport.php:36-111). */
function missile_attack_body(array $params): string
{
    $sent = $params['missiles_sent'] ?? 0;
    $body = $sent . ' ' . ($sent == 1 ? 'missile' : 'missiles') . ' from your planet ';
    $body .= ($params['origin_planet_id'] ?? 0) > 0 ? '[planet]' . $params['origin_planet_id'] . '[/planet]' : $params['origin_planet_name'] . ' [coordinates]' . $params['origin_planet_coords'] . '[/coordinates]';
    $body .= ' smashed into the planet ';
    $body .= ($params['target_planet_id'] ?? 0) > 0 ? '[planet]' . $params['target_planet_id'] . '[/planet]' : $params['target_planet_name'] . ' [coordinates]' . $params['target_coords'] . '[/coordinates]';
    $body .= '!';
    $body .= '<br><br>';
    $intercepted = $params['missiles_intercepted'] ?? 0;
    if ($intercepted > 0) { $body .= '<b>Missiles Intercepted:</b> ' . $intercepted . '<br><br>'; }
    $body .= '<b>Defenses Hit</b><br>';
    $data = json_decode($params['defenses_data'] ?? '[]', true) ?? [];
    if (!empty($data)) {
        foreach ($data as $d) { $body .= '<span style="display:inline-block;min-width:200px;">' . $d['name'] . '</span>'; $body .= $d['after'] . '(-' . $d['destroyed'] . ')<br>'; }
    } else { $body .= 'None<br>'; }
    return msg_replace_placeholders($body);
}

/** MissileDefenseReport::getBody() (MissileDefenseReport.php:33-93). */
function missile_defense_body(array $params): string
{
    $body = 'Your planet ';
    $body .= ($params['planet_id'] ?? 0) > 0 ? '[planet]' . $params['planet_id'] . '[/planet]' : $params['planet_name'] . ' [coordinates]' . $params['planet_coords'] . '[/coordinates]';
    $body .= ' has been attacked by interplanetary missiles from <b>' . ($params['attacker_name'] ?? 'Unknown') . '</b>!';
    $body .= '<br><br>';
    $body .= '<b>Incoming Missiles:</b> ' . ($params['missiles_incoming'] ?? 0) . '<br>';
    if (($params['missiles_intercepted'] ?? 0) > 0) { $body .= '<b>Missiles Intercepted:</b> ' . $params['missiles_intercepted'] . '<br>'; }
    $body .= '<br>';
    $body .= '<b>Defenses Hit</b><br>';
    $data = json_decode($params['defenses_data'] ?? '[]', true) ?? [];
    if (!empty($data)) {
        foreach ($data as $d) { $body .= '<span style="display:inline-block;min-width:200px;">' . $d['name'] . '</span>'; $body .= $d['after'] . '(-' . $d['destroyed'] . ')<br>'; }
    } else { $body .= 'None<br>'; }
    return msg_replace_placeholders($body);
}

/** EspionageReport::getEspionageReportParams() (EspionageReport.php:126-235). */
function espionage_params(SampleMessage $m): array
{
    $e = $m->espionage;
    $vm = function (?array $list, callable $lookup) {
        $r = [];
        foreach ($list ?? [] as $machine => $amount) { $o = $lookup($machine); $r[$o->machine_name] = (object)['amount' => $amount, 'object' => $o]; }
        return $r;
    };
    $res = $e['resources'];
    $deb = $e['debris'] ?? null;
    return [
        'subject' => $m->getSubject(),
        'from' => $m->getFrom(),
        'playername' => $e['player_name'],
        'date' => $m->getDateFormatted(),
        'resources' => new MsgResources($res['metal'], $res['crystal'], $res['deuterium'], $res['energy']),
        'debris' => $deb ? new MsgResources($deb['metal'], $deb['crystal'], $deb['deuterium'], 0) : new MsgResources(0, 0, 0, 0),
        'ships' => $vm($e['ships'], 'msg_obj'),
        'defense' => $vm($e['defense'], 'msg_obj'),
        'buildings' => $vm($e['buildings'], 'msg_obj'),
        'research' => $vm($e['research'], 'msg_obj'),
        'counter_espionage_chance' => $e['counter_espionage_chance'],
        'galaxy' => $e['coords'][0],
        'system' => $e['coords'][1],
        'position' => $e['coords'][2],
        'planet_type' => $e['planet_type'],
    ];
}

/** BattleReport::getBattleReportParams() (BattleReport.php:114-476). */
function battle_params(SampleMessage $m): array
{
    global $PLANETS, $PLAYERS, $ME;
    $b = $m->battle;
    $def = $PLANETS[$b['defender_planet_id']];
    $dc = $def->getPlanetCoordinates();
    $attackerPlayerId = $b['attacker']['player_id'];
    if ($attackerPlayerId < 0) {
        $attacker_name = match ($attackerPlayerId) { -1 => 'Pirates', -2 => 'Aliens', default => 'Unknown' };
    } else {
        $attacker_name = $PLAYERS[$attackerPlayerId];
    }
    if ($attackerPlayerId < 0 && ($b['attacker']['planet_id'] ?? null) === null) {
        $apn = 'Deep space'; $apc = $b['attacker']['planet_coords']; $apt = '';
    } else {
        $ap = $PLANETS[$b['attacker']['planet_id']];
        $apn = $ap->getPlanetName(); $apc = $ap->getPlanetCoordinates()->asString(); $apt = $ap->isMoon() ? 'Moon' : 'Planet';
    }
    $defender_name = $PLAYERS[$b['defender']['player_id']];
    $loot = new MsgResources($b['loot']['metal'], $b['loot']['crystal'], $b['loot']['deuterium'], 0);
    $debris = new MsgResources($b['debris']['metal'], $b['debris']['crystal'], $b['debris']['deuterium'], 0);
    $zero = new MsgResources(0, 0, 0, 0);
    $recyclerCap = 20000; // recycler base capacity, hyperspace technology 0 for the viewer
    $recyclers = (int)ceil(($b['debris']['metal'] + $b['debris']['crystal'] + $b['debris']['deuterium']) / $recyclerCap);
    $repaired = MsgUnitCollection::from($b['repaired_defenses'] ?? []);
    $rounds = [];
    foreach ($b['rounds'] as $r) {
        $o = new stdClass();
        foreach (['full_strength_attacker' => 'fullStrengthAttacker', 'full_strength_defender' => 'fullStrengthDefender', 'absorbed_damage_attacker' => 'absorbedDamageAttacker', 'absorbed_damage_defender' => 'absorbedDamageDefender', 'hits_attacker' => 'hitsAttacker', 'hits_defender' => 'hitsDefender'] as $src => $dst) { $o->$dst = $r[$src]; }
        foreach (['defender_ships' => 'defenderShips', 'attacker_ships' => 'attackerShips', 'defender_losses' => 'defenderLosses', 'attacker_losses' => 'attackerLosses', 'defender_losses_in_this_round' => 'defenderLossesInRound', 'attacker_losses_in_this_round' => 'attackerLossesInRound'] as $src => $dst) { $o->$dst = MsgUnitCollection::from($r[$src]); }
        $rounds[] = $o;
    }
    if (count($rounds) === 0) { $winner = 'attacker'; }
    else {
        $last = end($rounds);
        if ($last->attackerShips->getAmount() > 0 && $last->defenderShips->getAmount() > 0) { $winner = 'draw'; }
        elseif ($last->attackerShips->getAmount() > 0) { $winner = 'attacker'; }
        else { $winner = 'defender'; }
    }
    $viewerIsAttacker = $ME->getId() === $attackerPlayerId;
    $repairedCount = 0; foreach ($b['repaired_defenses'] ?? [] as $v) { $repairedCount += $v; }
    return [
        'subject' => $m->getSubject(),
        'from' => $m->getFrom(),
        'viewer_is_attacker' => $viewerIsAttacker,
        'report_datetime' => $m->getDateFormatted(),
        'attacker_name' => $attacker_name,
        'attacker_planet_name' => $apn,
        'attacker_planet_coords' => $apc,
        'attacker_planet_type' => $apt,
        'defender_name' => $defender_name,
        'attacker_class' => ($winner === 'attacker') ? 'undermark' : (($winner === 'draw') ? 'middlemark' : 'overmark'),
        'defender_class' => ($winner === 'defender') ? 'undermark' : (($winner === 'draw') ? 'middlemark' : 'overmark'),
        'attacker_character_class' => $b['attacker']['character_class'] ?? null,
        'defender_character_class' => $b['defender']['character_class'] ?? null,
        'defender_planet_name' => $def->getPlanetName(),
        'defender_planet_coords' => $dc->asString(),
        'defender_planet_link' => route('galaxy.index', ['galaxy' => $dc->galaxy, 'system' => $dc->system, 'position' => $dc->position]),
        'attacker_losses' => AppUtil::formatNumberLong($b['attacker']['resource_loss']),
        'defender_losses' => AppUtil::formatNumberLong($b['defender']['resource_loss']),
        'loot' => AppUtil::formatNumberShort($loot->sum()),
        'loot_resources' => $loot,
        'loot_percentage' => $b['loot']['percentage'],
        'debris_sum_formatted' => AppUtil::formatNumberLong($debris->sum()),
        'debris_resources' => $debris,
        'debris_recyclers_needed' => $recyclers,
        'collected_debris_resources' => $zero,
        'attacker_collected_debris_resources' => $zero,
        'defender_collected_debris_resources' => $zero,
        'remaining_debris_resources' => $debris,
        'remaining_debris_recyclers_needed' => $recyclers,
        'total_reapers_used' => 0,
        'wreckage_count' => 0,
        'wreckage_units' => new MsgUnitCollection(),
        'repaired_defenses_count' => $repairedCount,
        'repaired_defenses' => $repaired,
        'attacker_wreckage_count' => 0,
        'attacker_wreckage_units' => new MsgUnitCollection(),
        'moon_existed' => $b['general']['moon_existed'],
        'moon_chance' => $b['general']['moon_chance'],
        'moon_created' => $b['general']['moon_created'],
        'hamill_manoeuvre_triggered' => false,
        'tactical_retreat_ratio' => 1,
        'tactical_retreat_defender_fled' => false,
        'tactical_retreat_deuterium_cost' => 0,
        'tactical_retreat_deuterium_cost_formatted' => AppUtil::formatNumberLong(0),
        'attacker_weapons' => $b['attacker']['weapon_technology'] * 10,
        'attacker_shields' => $b['attacker']['shielding_technology'] * 10,
        'attacker_armor' => $b['attacker']['armor_technology'] * 10,
        'defender_weapons' => $b['defender']['weapon_technology'] * 10,
        'defender_shields' => $b['defender']['shielding_technology'] * 10,
        'defender_armor' => $b['defender']['armor_technology'] * 10,
        'military_objects' => msg_objs_of('MilitaryShipObjects'),
        'civil_objects' => msg_objs_of('CivilShipObjects'),
        'defense_objects' => msg_objs_of('DefenseObjects'),
        'attacker_units_start' => MsgUnitCollection::from($b['attacker']['units']),
        'defender_units_start' => MsgUnitCollection::from($b['defender']['units']),
        'rounds' => $rounds,
    ];
}

// ====================================================================== rendering
/** Blade @forelse/@empty/@endforelse -> @if/@foreach/@else (same output as Laravel's compiled forelse). */
function msg_preprocess(string $src): string
{
    return preg_replace_callback('/@forelse\s*\((.*?)\s+as\s+(\$\w+)\)(.*?)@empty(.*?)@endforelse/s', function ($m) {
        return '@if(count(' . $m[1] . ') > 0)@foreach(' . $m[1] . ' as ' . $m[2] . ')' . $m[3] . '@endforeach@else' . $m[4] . '@endif';
    }, $src);
}

function msg_render(string $__view, array $__data = []): string
{
    $__file = OGX_SRC . '/resources/views/' . str_replace('.', '/', $__view) . '.blade.php';
    $__compiled = blade_compile(msg_preprocess(file_get_contents($__file)));
    $__compiled = preg_replace('/(?<![\w>$:\\\\])time\(\)/', 'blade_now()', $__compiled);
    $__tmp = sys_get_temp_dir() . '/blade_msg_' . md5($__view) . '.php';
    file_put_contents($__tmp, $__compiled);
    foreach (array_keys($__data) as $__k) { if (str_starts_with($__k, '__')) { unset($__data[$__k]); } }
    extract($__data);
    $__extends = null;
    ob_start();
    include $__tmp;
    $__out = ob_get_clean();
    if ($__extends) { return blade_render($__extends, $__data); }
    return $__out;
}

// ====================================================================== sample messages
$T = fn(string $hms, int $day = 30) => gmmktime((int)substr($hms, 0, 2), (int)substr($hms, 3, 2), (int)substr($hms, 6, 2), 10, $day, 2026);

$MSGS = [];
function addMsg(int $id, string $key, array $params, int $t, bool $unread, ?array $esp = null, ?array $battle = null): SampleMessage
{
    global $MSGS;
    $m = new SampleMessage($id, $key, $params, $t, $unread);
    $m->espionage = $esp; $m->battle = $battle;
    $MSGS[$id] = $m;
    return $m;
}

// ---- espionage subtab
addMsg(2051, 'espionage_report', [], $T('00:41:05'), true, [
    'planet_id' => 41, 'player_name' => 'Lieutenant Nusakan', 'coords' => [1, 45, 9], 'planet_type' => 1,
    'resources' => ['metal' => 1468279, 'crystal' => 500451, 'deuterium' => 65266, 'energy' => 3120],
    'debris' => null,
    'ships' => ['light_fighter' => 120, 'cruiser' => 14, 'small_cargo' => 40, 'large_cargo' => 12, 'espionage_probe' => 9, 'solar_satellite' => 25],
    'defense' => ['rocket_launcher' => 150, 'light_laser' => 80, 'heavy_laser' => 12, 'gauss_cannon' => 4, 'small_shield_dome' => 1, 'anti_ballistic_missile' => 6],
    'buildings' => ['metal_mine' => 24, 'crystal_mine' => 20, 'deuterium_synthesizer' => 18, 'solar_plant' => 22, 'metal_store' => 8, 'crystal_store' => 7, 'deuterium_store' => 6, 'robot_factory' => 10, 'shipyard' => 9, 'research_lab' => 10, 'missile_silo' => 2],
    'research' => ['energy_technology' => 10, 'laser_technology' => 10, 'ion_technology' => 5, 'hyperspace_technology' => 6, 'combustion_drive' => 10, 'impulse_drive' => 7, 'espionage_technology' => 8, 'computer_technology' => 10, 'astrophysics' => 5, 'weapon_technology' => 9, 'shielding_technology' => 8, 'armor_technology' => 9],
    'counter_espionage_chance' => 4,
]);
addMsg(2049, 'espionage_detected', ['planet' => '[planet]77[/planet]', 'defender' => '[planet]1[/planet]', 'attacker_name' => 'Admiral Rigel', 'chance' => 0], $T('00:33:51'), true);
addMsg(2044, 'espionage_report', [], $T('23:58:12', 29), false, [
    'planet_id' => 42, 'player_name' => 'Lieutenant Nusakan', 'coords' => [1, 45, 9], 'planet_type' => 3,
    'resources' => ['metal' => 210500, 'crystal' => 98340, 'deuterium' => 12007, 'energy' => 0],
    'debris' => null,
    'ships' => ['battle_ship' => 6, 'large_cargo' => 30],
    'defense' => null, 'buildings' => null, 'research' => null,
    'counter_espionage_chance' => 1,
]);
addMsg(2038, 'espionage_report', [], $T('22:15:40', 29), false, [
    'planet_id' => 61, 'player_name' => 'Hagen', 'coords' => [1, 39, 4], 'planet_type' => 1,
    'resources' => ['metal' => 120345, 'crystal' => 64210, 'deuterium' => 30128, 'energy' => -14],
    'debris' => ['metal' => 2700, 'crystal' => 900, 'deuterium' => 0],
    'ships' => [],
    'defense' => ['rocket_launcher' => 10, 'light_laser' => 4],
    'buildings' => null, 'research' => null,
    'counter_espionage_chance' => 0,
]);

// ---- combat reports subtab
$roundsWin = [
    ['attacker_ships' => ['light_fighter' => 47, 'large_cargo' => 20], 'defender_ships' => ['light_laser' => 1], 'attacker_losses' => ['light_fighter' => 3], 'defender_losses' => ['rocket_launcher' => 10, 'light_laser' => 3], 'attacker_losses_in_this_round' => ['light_fighter' => 3], 'defender_losses_in_this_round' => ['rocket_launcher' => 10, 'light_laser' => 3], 'absorbed_damage_attacker' => 420, 'absorbed_damage_defender' => 175, 'full_strength_attacker' => 3500, 'full_strength_defender' => 1500, 'hits_attacker' => 70, 'hits_defender' => 14, ],
    ['attacker_ships' => ['light_fighter' => 47, 'large_cargo' => 20], 'defender_ships' => [], 'attacker_losses' => ['light_fighter' => 3], 'defender_losses' => ['rocket_launcher' => 10, 'light_laser' => 4], 'attacker_losses_in_this_round' => [], 'defender_losses_in_this_round' => ['light_laser' => 1], 'absorbed_damage_attacker' => 0, 'absorbed_damage_defender' => 25, 'full_strength_attacker' => 3290, 'full_strength_defender' => 100, 'hits_attacker' => 67, 'hits_defender' => 1, ],
];
addMsg(2053, 'battle_report', [], $T('00:50:22'), true, null, [
    'defender_planet_id' => 61,
    'attacker' => ['player_id' => 108, 'planet_id' => 1, 'resource_loss' => 12000, 'units' => ['light_fighter' => 50, 'large_cargo' => 20], 'weapon_technology' => 6, 'shielding_technology' => 5, 'armor_technology' => 6, 'character_class' => 'Collector'],
    'defender' => ['player_id' => 87, 'resource_loss' => 28000, 'units' => ['rocket_launcher' => 10, 'light_laser' => 4], 'weapon_technology' => 2, 'shielding_technology' => 2, 'armor_technology' => 3, 'character_class' => null],
    'loot' => ['percentage' => 50, 'metal' => 60172, 'crystal' => 32105, 'deuterium' => 15064],
    'debris' => ['metal' => 2700, 'crystal' => 900, 'deuterium' => 0],
    'repaired_defenses' => ['rocket_launcher' => 7, 'light_laser' => 3],
    'general' => ['moon_existed' => false, 'moon_chance' => 0, 'moon_created' => false],
    'rounds' => $roundsWin,
]);
$roundsLoss = [
    ['attacker_ships' => ['cruiser' => 30, 'large_cargo' => 15], 'defender_ships' => ['light_fighter' => 12, 'rocket_launcher' => 20], 'attacker_losses' => [], 'defender_losses' => ['light_fighter' => 28, 'small_cargo' => 5, 'rocket_launcher' => 40, 'light_laser' => 10], 'attacker_losses_in_this_round' => [], 'defender_losses_in_this_round' => ['light_fighter' => 28, 'small_cargo' => 5, 'rocket_launcher' => 40, 'light_laser' => 10], 'absorbed_damage_attacker' => 2100, 'absorbed_damage_defender' => 3600, 'full_strength_attacker' => 12150, 'full_strength_defender' => 3410, 'hits_attacker' => 30, 'hits_defender' => 125, ],
    ['attacker_ships' => ['cruiser' => 30, 'large_cargo' => 15], 'defender_ships' => [], 'attacker_losses' => [], 'defender_losses' => ['light_fighter' => 40, 'small_cargo' => 5, 'rocket_launcher' => 60, 'light_laser' => 10], 'attacker_losses_in_this_round' => [], 'defender_losses_in_this_round' => ['light_fighter' => 12, 'rocket_launcher' => 20], 'absorbed_damage_attacker' => 1300, 'absorbed_damage_defender' => 900, 'full_strength_attacker' => 12150, 'full_strength_defender' => 1600, 'hits_attacker' => 30, 'hits_defender' => 32, ],
];
addMsg(2050, 'battle_report', [], $T('00:12:03'), true, null, [
    'defender_planet_id' => 1,
    'attacker' => ['player_id' => 156, 'planet_id' => 77, 'resource_loss' => 0, 'units' => ['cruiser' => 30, 'large_cargo' => 15], 'weapon_technology' => 8, 'shielding_technology' => 7, 'armor_technology' => 8, 'character_class' => 'General'],
    'defender' => ['player_id' => 108, 'resource_loss' => 320000, 'units' => ['light_fighter' => 40, 'small_cargo' => 5, 'rocket_launcher' => 60, 'light_laser' => 10], 'weapon_technology' => 6, 'shielding_technology' => 5, 'armor_technology' => 6, 'character_class' => 'Collector'],
    'loot' => ['percentage' => 50, 'metal' => 76173, 'crystal' => 49356, 'deuterium' => 20615],
    'debris' => ['metal' => 39000, 'crystal' => 15000, 'deuterium' => 0],
    'repaired_defenses' => ['rocket_launcher' => 43, 'light_laser' => 7],
    'general' => ['moon_existed' => true, 'moon_chance' => 1, 'moon_created' => false],
    'rounds' => $roundsLoss,
]);
$roundsExp = [
    ['attacker_ships' => ['light_fighter' => 6, 'heavy_fighter' => 2], 'defender_ships' => ['large_cargo' => 25, 'light_fighter' => 30, 'espionage_probe' => 1], 'attacker_losses' => ['light_fighter' => 10, 'heavy_fighter' => 2], 'defender_losses' => ['light_fighter' => 2], 'attacker_losses_in_this_round' => ['light_fighter' => 10, 'heavy_fighter' => 2], 'defender_losses_in_this_round' => ['light_fighter' => 2], 'absorbed_damage_attacker' => 160, 'absorbed_damage_defender' => 1850, 'full_strength_attacker' => 1200, 'full_strength_defender' => 2240, 'hits_attacker' => 20, 'hits_defender' => 56, ],
    ['attacker_ships' => [], 'defender_ships' => ['large_cargo' => 25, 'light_fighter' => 28, 'espionage_probe' => 1], 'attacker_losses' => ['light_fighter' => 16, 'heavy_fighter' => 4], 'defender_losses' => ['light_fighter' => 2], 'attacker_losses_in_this_round' => ['light_fighter' => 6, 'heavy_fighter' => 2], 'defender_losses_in_this_round' => [], 'absorbed_damage_attacker' => 20, 'absorbed_damage_defender' => 610, 'full_strength_attacker' => 500, 'full_strength_defender' => 1680, 'hits_attacker' => 8, 'hits_defender' => 54, ],
];
addMsg(2034, 'battle_report', [], $T('21:40:10', 29), false, null, [
    'defender_planet_id' => 1,
    'attacker' => ['player_id' => -1, 'planet_id' => null, 'planet_coords' => '1:42:16', 'resource_loss' => 104000, 'units' => ['light_fighter' => 16, 'heavy_fighter' => 4], 'weapon_technology' => 4, 'shielding_technology' => 4, 'armor_technology' => 4],
    'defender' => ['player_id' => 108, 'resource_loss' => 8000, 'units' => ['large_cargo' => 25, 'light_fighter' => 30, 'espionage_probe' => 1], 'weapon_technology' => 6, 'shielding_technology' => 5, 'armor_technology' => 6],
    'loot' => ['percentage' => 0, 'metal' => 0, 'crystal' => 0, 'deuterium' => 0],
    'debris' => ['metal' => 23400, 'crystal' => 10200, 'deuterium' => 0],
    'repaired_defenses' => [],
    'general' => ['moon_existed' => false, 'moon_chance' => 0, 'moon_created' => false, 'expedition_battle' => true, 'npc_type' => 'pirate'],
    'rounds' => $roundsExp,
]);
addMsg(2043, 'fleet_lost_contact', ['coordinates' => '[coordinates]1:45:9[/coordinates]'], $T('23:31:44', 29), false);
addMsg(2040, 'missile_attack_report', [
    'origin_planet_id' => 1, 'origin_planet_name' => 'Homeworld', 'origin_planet_coords' => '1:42:8',
    'target_planet_id' => 41, 'target_planet_name' => 'Arrakeen', 'target_coords' => '1:45:9', 'target_type' => 'planet',
    'missiles_sent' => 10, 'missiles_intercepted' => '6', 'missiles_hit' => 4, 'defenses_destroyed' => 'Rocket Launcher: 40',
    'defenses_data' => json_encode([['name' => 'Rocket Launcher', 'before' => 150, 'after' => 110, 'destroyed' => 40]]),
], $T('23:05:00', 29), false);
addMsg(2039, 'missile_defense_report', [
    'attacker_name' => 'Admiral Rigel', 'planet_id' => 3, 'planet_name' => 'Colony', 'planet_coords' => '2:118:12',
    'missiles_incoming' => 5, 'missiles_intercepted' => 0, 'missiles_hit' => 5, 'defenses_destroyed' => 'Rocket Launcher: 30, Light Laser: 5',
    'defenses_data' => json_encode([['name' => 'Rocket Launcher', 'before' => 80, 'after' => 50, 'destroyed' => 30], ['name' => 'Light Laser', 'before' => 25, 'after' => 20, 'destroyed' => 5]]),
], $T('22:47:31', 29), false);

// ---- expeditions subtab (11 messages -> 2 pages of 10)
addMsg(2054, 'expedition_gain_resources', ['message_variation_id' => 2, 'resource_type' => 'metal', 'resource_amount' => 412500], $T('00:55:02'), true);
addMsg(2052, 'expedition_gain_ships', ['message_variation_id' => 4, 'unit_202' => 5, 'unit_204' => 12, 'unit_210' => 3], $T('00:44:18'), true);
addMsg(2048, 'expedition_gain_dark_matter', ['message_variation_id' => 2, 'dark_matter_amount' => 1850], $T('00:02:37'), true);
addMsg(2047, 'expedition_failed', ['message_variation_id' => 7], $T('23:59:59', 29), false);
addMsg(2046, 'expedition_failed_and_delay', ['message_variation_id' => 2], $T('23:49:06', 29), false);
addMsg(2045, 'expedition_failed_and_speedup', ['message_variation_id' => 1], $T('23:42:12', 29), false);
addMsg(2042, 'expedition_battle_aliens', ['message_variation_id' => 5], $T('23:20:45', 29), false);
addMsg(2041, 'expedition_merchant_found', ['message_variation_id' => 2], $T('23:11:09', 29), false);
addMsg(2037, 'expedition_gain_item', ['message_variation_id' => 1], $T('22:02:51', 29), false);
addMsg(2035, 'expedition_battle_pirates', ['message_variation_id' => 3], $T('21:40:10', 29), false);
addMsg(2030, 'expedition_loss_of_fleet', ['message_variation_id' => 1], $T('19:27:33', 29), false);

// ---- transport subtab
addMsg(2036, 'transport_arrived', ['from' => '[planet]1[/planet]', 'to' => '[planet]3[/planet]', 'metal' => '75000', 'crystal' => '40000', 'deuterium' => '12500'], $T('21:58:20', 29), false);
addMsg(2032, 'fleet_union_invite', ['sender_name' => 'Lieutenant Nusakan', 'union_name' => 'KV-1', 'target_player' => 'Admiral Rigel', 'target_coords' => '1:42:11', 'arrival_time' => '30.10.2026 02:15:00'], $T('20:31:00', 29), false);

// ---- other subtab
addMsg(2055, 'return_of_fleet_with_resources', ['from' => 'planet [planet]61[/planet]', 'to' => 'planet [planet]1[/planet]', 'metal' => '60172', 'crystal' => '32105', 'deuterium' => '15064'], $T('00:56:40'), true);
addMsg(2033, 'return_of_fleet', ['from' => '[coordinates]1:42:16[/coordinates]', 'to' => 'planet [planet]1[/planet]'], $T('21:12:40', 29), false);
addMsg(2031, 'fleet_deployment_with_resources', ['from' => '[planet]3[/planet]', 'to' => '[planet]5[/planet]', 'metal' => '20000', 'crystal' => '10000', 'deuterium' => '5321'], $T('20:45:00', 29), false);
addMsg(2029, 'transport_received', ['from' => '[planet]41[/planet]', 'to' => '[planet]3[/planet]', 'metal' => '15000', 'crystal' => '0', 'deuterium' => '2000'], $T('18:02:11', 29), false);
addMsg(2028, 'debris_field_harvest', ['from' => '[planet]1[/planet]', 'to' => '[debrisfield]1:39:4[/debrisfield]', 'coordinates' => '[coordinates]1:39:4[/coordinates]', 'ship_name' => 'Recycler', 'ship_amount' => 2, 'storage_capacity' => 40000, 'metal' => 2700, 'crystal' => 900, 'deuterium' => 0, 'harvested_metal' => 2700, 'harvested_crystal' => 900, 'harvested_deuterium' => 0], $T('17:30:00', 29), false);
addMsg(2027, 'fleet_deployment', ['from' => '[planet]5[/planet]', 'to' => '[planet]1[/planet]'], $T('16:00:05', 29), false);
addMsg(2026, 'acs_defend_arrival_sender', ['to' => '[planet]41[/planet]'], $T('15:20:00', 29), false);

// ---- economy / universe
addMsg(2025, 'colony_established', ['coordinates' => '2:118:12'], $T('12:00:00', 28), false);
addMsg(2024, 'colony_establish_fail_astrophysics', ['coordinates' => '2:120:7'], $T('11:00:00', 28), false);
addMsg(2023, 'wreck_field_repair_completed', ['planet' => '[planet]1[/planet]', 'ship_count' => '18'], $T('10:00:00', 28), false);
addMsg(1, 'welcome_message', ['player' => '[player]108[/player]'], $T('09:00:00', 20), false);

/** MessageService::getMessagesForTab() (ordering created_at desc, 10 per page). */
function msgs_for(string $tab, string $subtab, int $page = 1): array
{
    global $MSGS;
    $list = array_values(array_filter($MSGS, fn($m) => $m->tab === $tab && $m->subtab === $subtab));
    usort($list, fn($a, $b) => $b->createdAt <=> $a->createdAt ?: $b->id <=> $a->id);
    $total = count($list);
    $lastPage = max((int)ceil($total / 10), 1);
    return ['messages' => array_slice($list, ($page - 1) * 10, 10), 'pagination' => ['currentPage' => $page, 'totalPages' => $lastPage, 'totalCount' => $total, 'perPage' => 10]];
}
function unread_count(string $tab, ?string $subtab = null): int
{
    global $MSGS;
    return count(array_filter($MSGS, fn($m) => $m->unread && $m->tab === $tab && ($subtab === null || $m->subtab === $subtab)));
}

// ====================================================================== context
$GLOBALS['__ctx'] = [
    'csrf' => 'Xq2mZ8vR4kL0pT6yB1nW9cE3sH7jD5fA2gU8iO4e',
    'now' => MSG_NOW,
    'path' => '/ajax/messages', 'query' => [],
    'settings' => new SettingsService(), 'economySpeed' => 1, 'fleetSpeed' => 1,
    'player' => $ME,
];

function write_fixture(string $name, string $content): void
{
    global $outDir;
    file_put_contents("$outDir/$name", $content);
    echo "wrote $name (" . strlen($content) . " bytes)\n";
}

// ---- GET /ajax/messages?tab=X&subtab=Y (MessagesController::ajaxGetTabContents -> subTabContent)
function render_subtab(string $tab, string $subtab, int $page = 1): string
{
    $GLOBALS['__ctx']['path'] = '/ajax/messages';
    $GLOBALS['__ctx']['query'] = ['tab' => $tab, 'subtab' => $subtab] + ($page > 1 ? ['pagination' => (string)$page] : []);
    $r = msgs_for($tab, $subtab, $page);
    $view = $tab === 'fleets' ? 'ingame.messages.tabs.fleets.subtab' : 'ingame.messages.tabs.default.subtab';
    return msg_render($view, ['messages' => $r['messages'], 'pagination' => $r['pagination']]);
}

// The subtab fixtures are rendered BEFORE the unread flags are cleared (MessageService marks viewed after building objects).
$subtabs = [
    ['fleets', 'espionage', 1], ['fleets', 'combat_reports', 1], ['fleets', 'expeditions', 1], ['fleets', 'expeditions', 2],
    ['fleets', 'transport', 1], ['fleets', 'other', 1], ['economy', 'economy', 1], ['universe', 'universe', 1], ['system', 'system', 1],
];
$rendered = [];
foreach ($subtabs as [$tab, $sub, $page]) {
    $html = render_subtab($tab, $sub, $page);
    $rendered["$tab/$sub/$page"] = $html;
    write_fixture("messages-ajax-$tab-$sub" . ($page > 1 ? "-page$page" : '') . '.html', $html);
}

// ---- GET /ajax/messages?tab=fleets (tab template only)
$tabCounts = ['espionage' => unread_count('fleets', 'espionage'), 'combat_reports' => unread_count('fleets', 'combat_reports'), 'expeditions' => unread_count('fleets', 'expeditions'), 'transport' => unread_count('fleets', 'transport'), 'other' => unread_count('fleets', 'other')];
$fleetsTab = msg_render('ingame.messages.tabs.fleets.tab', ['unread_messages_count' => $tabCounts]);
write_fixture('messages-ajax-tab-fleets.html', $fleetsTab);
$commTab = msg_render('ingame.messages.tabs.communication.tab', ['unread_messages_count' => ['messages' => 0, 'information' => 0]]);
write_fixture('messages-ajax-tab-communication.html', $commTab);
write_fixture('messages-ajax-tab-economy.html', msg_render('ingame.messages.tabs.default.tab', ['subtab_content' => '']));

// ---- GET /ajax/messages/{id}?tab=&subtab= (MessagesController::ajaxGetMessage)
function render_full(int $id): string
{
    global $MSGS;
    $m = $MSGS[$id];
    $GLOBALS['__ctx']['path'] = '/ajax/messages/' . $id;
    $GLOBALS['__ctx']['query'] = ['tab' => $m->tab, 'subtab' => $m->subtab];
    // MessageService::getMessagePaginationContext() (MessageService.php:312-373); all messages of the subtab, newest first.
    $all = array_values(array_filter($MSGS, fn($x) => $x->tab === $m->tab && $x->subtab === $m->subtab));
    usort($all, fn($a, $b) => $b->createdAt <=> $a->createdAt ?: $b->id <=> $a->id);
    $ids = array_map(fn($x) => $x->id, $all);
    $idx = array_search($id, $ids, true);
    $pagination = [
        'currentIndex' => $idx + 1, 'totalCount' => count($ids),
        'firstId' => $ids[0], 'prevId' => $idx > 0 ? $ids[$idx - 1] : null,
        'nextId' => $idx < count($ids) - 1 ? $ids[$idx + 1] : null, 'lastId' => $ids[count($ids) - 1],
        'tab' => $m->tab, 'subtab' => $m->subtab,
    ];
    return msg_render('ingame.messages.message', ['messageId' => $id, 'messageBody' => $m->getBodyFull(), 'pagination' => $pagination]);
}
write_fixture('messages-ajax-message-2051-espionage-full.html', render_full(2051));
write_fixture('messages-ajax-message-2044-espionage-moon-partial.html', render_full(2044));
write_fixture('messages-ajax-message-2038-espionage-debris.html', render_full(2038));
write_fixture('messages-ajax-message-2053-battle-attacker-win.html', render_full(2053));
write_fixture('messages-ajax-message-2050-battle-defender-loss.html', render_full(2050));
write_fixture('messages-ajax-message-2034-battle-expedition-pirates.html', render_full(2034));
write_fixture('messages-ajax-message-2054-expedition-resources.html', render_full(2054));

// ---- POST /messages (action=103) -> response()->json([$messageId => true])
write_fixture('messages-post-delete-2047.json', json_encode(['2047' => true]));

// ====================================================================== full page GET /messages
function msgComposeResources(PlanetService $p, int $darkMatter): array
{
    $r = [];
    foreach (['metal', 'crystal', 'deuterium'] as $k) {
        $amount = (float)$p->d['res'][$k]; $storage = (float)$p->d['storage'][$k]; $ph = (float)$p->d['prod'][$k];
        $r[$k] = ['amount' => $amount, 'amount_formatted' => (new Resource($amount))->getFormattedLong(), 'production_hour' => $ph,
            'production_hour_formatted' => AppUtil::formatNumber($ph), 'production_second' => $ph / 3600, 'storage' => $storage,
            'storage_formatted' => (new Resource($storage))->getFormattedLong(), 'storage_almost_full' => ($amount >= $storage * 0.9 && $amount < $storage)];
    }
    $emax = (float)$p->d['energy']['max']; $eused = (float)$p->d['energy']['used'];
    $r['energy'] = ['amount' => $emax - $eused, 'amount_formatted' => (new Resource($emax - $eused))->getFormattedLong(), 'production' => $emax,
        'production_formatted' => (new Resource($emax))->getFormattedLong(), 'consumption' => $eused, 'consumption_formatted' => (new Resource($eused))->getFormattedLong()];
    $r['darkmatter'] = ['amount' => $darkMatter, 'amount_formatted' => AppUtil::formatNumber($darkMatter)];
    return $r;
}

function render_page(array $unreadTabs, int $unreadTotal, array $query): string
{
    global $ME, $PLANETS;
    $cur = $PLANETS[1];
    $GLOBALS['__ctx']['path'] = '/messages';
    $GLOBALS['__ctx']['query'] = $query;
    $GLOBALS['__sections'] = [];
    $vars = [
        'underAttack' => false, 'unreadMessagesCount' => $unreadTotal, 'buddyRequestCount' => 0, 'onlineBuddiesCount' => 1,
        'unreadChatCount' => 0, 'resources' => msgComposeResources($cur, 8000), 'currentPlayer' => $ME, 'currentPlanet' => $cur,
        'planets' => $ME->planets, 'highscoreRank' => 37, 'settings' => new SettingsService(), 'body_id' => 'messages', 'locale' => 'en',
        'isImpersonating' => false, 'impersonateLeaveUrl' => null, 'attackBlockActive' => false, 'attackBlockUntil' => 0,
        'attackBlockTooltip' => '', 'planet_move_in_progress' => false,
        // MessagesController::index()
        'unread_messages_count' => $unreadTabs,
        'tab_content' => '',
    ];
    return msg_render('ingame.messages.index', $vars);
}

// MessagesController::index() counts unread per tab first (MessagesController.php:25-32) ...
$unreadTabs = [];
foreach (['fleets', 'communication', 'economy', 'universe', 'system', 'favorites'] as $t) { $unreadTabs[$t] = unread_count($t); }
// ... then tabContent() marks the first espionage page viewed; the layout composer counts afterwards.
foreach (msgs_for('fleets', 'espionage')['messages'] as $m) { $m->unread = false; }
$unreadTotal = count(array_filter($MSGS, fn($m) => $m->unread));
$page = render_page($unreadTabs, $unreadTotal, []);
write_fixture('messages-page.html', $page);

// Post-JS DOM snapshot: jQuery UI tabs loaded /ajax/messages?tab=fleets into #ui-id-2 and then
// /ajax/messages?tab=fleets&subtab=espionage into #ui-id-14 (aria-controls of the active tab/subtab).
// Built by inserting the two real AJAX bodies into the real page; nothing else is changed.
$snap = $page;
$snap = preg_replace('#(<div id="ui-id-2" [^>]*>)\s*</div>#s', '$1' . "\n" . str_replace('$', '\\$', $fleetsTab) . "\n" . '</div>', $snap, 1, $c1);
$snap = preg_replace('#(<div id="ui-id-14" [^>]*>)\s*</div>#s', '$1' . "\n" . str_replace('$', '\\$', $rendered['fleets/espionage/1']) . "\n" . '</div>', $snap, 1, $c2);
if ($c1 !== 1 || $c2 !== 1) { throw new RuntimeException('snapshot insertion failed'); }
write_fixture('messages-page-loaded-espionage.html', $snap);

// ====================================================================== expedition text table (classification data)
$texts = [];
foreach (['en', 'fr', 'nl', 'zh-TW'] as $loc) {
    $f = OGX_SRC . "/resources/lang/$loc/t_messages.php";
    if (!is_file($f)) { continue; }
    $arr = include $f;
    foreach ($arr as $key => $val) {
        if (!str_starts_with($key, 'expedition_') || !is_array($val) || !isset($val['body']) || !is_array($val['body'])) { continue; }
        foreach ($val['body'] as $vid => $txt) { $texts[$loc][$key][(string)$vid] = $txt; }
    }
    foreach (['expedition_resources_captured', 'expedition_dark_matter_captured', 'expedition_units_captured'] as $k) {
        if (isset($arr[$k])) { $texts[$loc]['_suffix'][$k] = $arr[$k]; }
    }
    foreach ($arr as $key => $val) {
        if (str_starts_with($key, 'expedition_') && is_array($val) && isset($val['subject'])) { $texts[$loc]['_subject'] = $val['subject']; break; }
    }
}
$outcome = [
    'expedition_gain_resources' => 'resources', 'expedition_gain_ships' => 'ships', 'expedition_gain_dark_matter' => 'dark_matter',
    'expedition_gain_item' => 'item', 'expedition_merchant_found' => 'merchant', 'expedition_failed' => 'nothing',
    'expedition_failed_and_delay' => 'delay', 'expedition_failed_and_speedup' => 'speedup', 'expedition_battle_pirates' => 'pirates',
    'expedition_battle_aliens' => 'aliens', 'expedition_battle' => 'battle', 'expedition_loss_of_fleet' => 'fleet_lost',
];
write_fixture('messages-expedition-texts.json', json_encode([
    '_source' => 'resources/lang/{locale}/t_messages.php (expedition_* body variations); generated by tools/blade/gen_messages_fixtures.php',
    'outcome_by_key' => $outcome,
    'texts' => $texts,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

// ====================================================================== object titles (for parsing names in reports)
$objs = [];
foreach (msg_objects() as $o) { $objs[] = ['id' => $o->id, 'machine_name' => $o->machine_name, 'title_en' => $o->title, 'group' => $o->group]; }
write_fixture('messages-object-titles.json', json_encode($objs, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
echo "ok\n";

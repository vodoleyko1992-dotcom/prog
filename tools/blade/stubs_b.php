<?php

namespace Carbon {
    class Carbon
    {
        public function __construct(public int $ts) {}
        public static function now(): Carbon { return new Carbon($GLOBALS['__ctx']['now']); }
        public function format(string $f): string { return gmdate($f, $this->ts); }
        public function __toString(): string { return gmdate('Y-m-d H:i:s', $this->ts); }
        public function diffInSeconds($o, $abs = true) { return 0; }
    }
}

namespace OGame\Facades {
    class GitInfoUtil
    {
        public static function getAppVersion(): string { return '0.15.0'; }
        public static function getAppVersionBranchCommit(): string { return '0.15.0'; }
    }

    class AppUtil
    {
        // Copied verbatim from app/Facades/AppUtil.php
        public static function formatNumber(int|float $number): string
        {
            return number_format($number, 0, ',', ',');
        }

        public static function formatNumberShort(int|float $number): string
        {
            if ($number >= 1000000) {
                return number_format($number / 1000000, 0) . 'Mn';
            } elseif ($number > 10000) {
                return number_format(floor($number / 1000), 0) . 'K';
            } elseif ($number > 1000) {
                $thousands = floor(($number / 1000) * 10) / 10;
                $decimalPlaces = ($number % 1000) == 0 ? 0 : 1;
                return number_format($thousands, $decimalPlaces, ',', '') . 'K';
            } else {
                return number_format($number, 0, ',', ',');
            }
        }

        public static function formatNumberLong(int|float $number): string
        {
            if ($number >= 1000000) {
                $formattedNumber = number_format($number / 1000000, 3, '.', '');
                if (floor($number / 1000000) == $number / 1000000) {
                    return floor($number / 1000000) . 'Mn';
                }
                $formattedNumber = rtrim($formattedNumber, '0');
                $formattedNumber = rtrim($formattedNumber, '.');
                return $formattedNumber . 'Mn';
            } elseif ($number >= 1000) {
                return number_format((int) $number, 0, '.', ',');
            } else {
                return number_format((int) $number, 0, '.', ',');
            }
        }

        public static function formatTimeDuration(int|float $seconds): string
        {
            $weeks = floor($seconds / 604800);
            $days = floor(($seconds % 604800) / 86400);
            $hours = floor(($seconds % 86400) / 3600);
            $minutes = floor(($seconds / 60) % 60);
            $seconds = $seconds % 60;
            $formatted_string = '';
            if ($weeks > 0) { $formatted_string .= $weeks . 'w '; }
            if ($days > 0) { $formatted_string .= $days . 'd '; }
            if ($hours > 0) { $formatted_string .= $hours . 'h '; }
            if ($minutes > 0) { $formatted_string .= $minutes . 'm '; }
            if (empty($formatted_string)) { $formatted_string .= $seconds . 's'; }
            return trim($formatted_string);
        }

        public static function formatDateTimeDuration(int|float $seconds): string
        {
            $weeks = floor($seconds / 604800);
            $days = floor(($seconds % 604800) / 86400);
            $hours = floor(($seconds % 86400) / 3600);
            $minutes = floor(($seconds / 60) % 60);
            $seconds = $seconds % 60;
            $formatted_string = '';
            if ($weeks > 0) { $formatted_string .= $weeks . 'W'; }
            if ($days > 0) { $formatted_string .= $days . 'D'; }
            if ($hours > 0) { $formatted_string .= $hours . 'H'; }
            if ($minutes > 0) { $formatted_string .= $minutes . 'M'; }
            if ($seconds > 0) { $formatted_string .= $seconds . 'S'; }
            return 'PT' . trim($formatted_string);
        }
    }
}

namespace OGame\Models {
    use OGame\Facades\AppUtil;

    class Resource
    {
        public function __construct(public float $rawValue) {}
        public function get(): float { return $this->rawValue; }
        public function getFormatted(): string { return AppUtil::formatNumberShort($this->rawValue); }
        public function getFormattedLong(): string { return AppUtil::formatNumberLong($this->rawValue); }
        public function getFormattedFull(): string { return AppUtil::formatNumber($this->rawValue); }
    }

    class Resources
    {
        public Resource $metal; public Resource $crystal; public Resource $deuterium; public Resource $energy;
        public function __construct($m = 0, $c = 0, $d = 0, $e = 0)
        {
            $this->metal = new Resource($m); $this->crystal = new Resource($c);
            $this->deuterium = new Resource($d); $this->energy = new Resource($e);
        }
    }
}

namespace OGame\Services {
    use OGame\Models\Planet\Coordinate;
    use OGame\Models\Resource;

    class SettingsService
    {
        public function economySpeed() { return $GLOBALS['__ctx']['economySpeed'] ?? 1; }
        public function fleetSpeed() { return $GLOBALS['__ctx']['fleetSpeed'] ?? 1; }
    }

    class HalvingService
    {
        // Copied from app/Services/HalvingService.php::calculateHalvingCost
        public function calculateHalvingCost(int $remainingTimeSeconds, string $queueType): int
        {
            $cost = (int)ceil((($remainingTimeSeconds / 60) / 30) * 750);
            $cost = max(750, $cost);
            $maxCost = match ($queueType) { 'research' => 108000, default => 72000 };
            return min($cost, $maxCost);
        }
    }

    class WreckFieldService
    {
        public function __construct($player, $settings) {}
        public function loadActiveOrBlockedForCoordinates($c) { return false; }
        public function getWreckField() { return null; }
    }

    /** Data-driven planet stub. */
    class PlanetService
    {
        public function __construct(public array $d) {}
        public function getPlanetId(): int { return $this->d['id']; }
        public function getPlanetName(): string { return $this->d['name']; }
        public function getPlanetCoordinates(): Coordinate { return new Coordinate(...$this->d['coords']); }
        public function getPlanetDiameter(): int { return $this->d['diameter']; }
        public function isMoon(): bool { return !empty($this->d['moon']); }
        public function getBuildingCount(): int { return $this->d['fields_used']; }
        public function getPlanetFieldMax(): int { return $this->d['fields_max']; }
        public function getPlanetTempMin(): int { return $this->d['temp'][0]; }
        public function getPlanetTempMax(): int { return $this->d['temp'][1]; }
        public function isBuilding(): bool { return !empty($this->d['building']); }
        public function isDowngrading(): bool { return !empty($this->d['downgrading']); }
        public function hasMoon(): bool { return !$this->isMoon() && !empty($this->d['moonObj']); }
        public function moon(): PlanetService { return $this->d['moonObj']; }
        public function hasPlanet(): bool { return $this->isMoon() && !empty($this->d['planetObj']); }
        public function planet(): PlanetService { return $this->d['planetObj']; }
        public function getObjectLevel(string $m): int { return $this->d['levels'][$m] ?? 0; }

        // Copied logic from app/Services/PlanetService.php
        public function getPlanetBiomeType(): string
        {
            $c = $this->getPlanetCoordinates();
            $map = [
                1 => ['odd' => 'dry', 'even' => 'desert'], 2 => ['odd' => 'dry', 'even' => 'desert'],
                3 => ['odd' => 'dry', 'even' => 'desert'], 4 => ['odd' => 'normal', 'even' => 'dry'],
                5 => ['odd' => 'normal', 'even' => 'dry'], 6 => ['odd' => 'jungle', 'even' => 'normal'],
                7 => ['odd' => 'jungle', 'even' => 'normal'], 8 => ['odd' => 'water', 'even' => 'jungle'],
                9 => ['odd' => 'water', 'even' => 'jungle'], 10 => ['odd' => 'ice', 'even' => 'water'],
                11 => ['odd' => 'ice', 'even' => 'water'], 12 => ['odd' => 'gas', 'even' => 'ice'],
                13 => ['odd' => 'gas', 'even' => 'ice'], 14 => ['odd' => 'normal', 'even' => 'gas'],
                15 => ['odd' => 'normal', 'even' => 'gas'],
            ];
            return $map[$c->position][$c->system % 2 === 0 ? 'even' : 'odd'];
        }

        public function getPlanetImageType(): string
        {
            $c = $this->getPlanetCoordinates();
            $map = [1 => 3, 2 => 4, 3 => 5, 4 => 6, 5 => 7, 6 => 8, 7 => 9, 8 => 10, 9 => 1, 10 => 2, 11 => 3, 12 => 4, 13 => 5, 14 => 6, 15 => 7];
            $mod = ($c->system % 10) - 1;
            if ($mod === -1) { $mod = 9; }
            $type = $map[$c->position] + $mod;
            if ($type > 10) { $type -= 10; }
            if ($this->isMoon() && $type > 5) { $type -= 5; }
            return (string)$type;
        }

        public function metal(): Resource { return new Resource($this->d['res']['metal']); }
        public function crystal(): Resource { return new Resource($this->d['res']['crystal']); }
        public function deuterium(): Resource { return new Resource($this->d['res']['deuterium']); }
        public function energy(): Resource { return new Resource($this->d['energy']['max'] - $this->d['energy']['used']); }
        public function energyProduction(): Resource { return new Resource($this->d['energy']['max']); }
        public function energyConsumption(): Resource { return new Resource($this->d['energy']['used']); }
        public function getObjectAmount(string $m): int { return $this->d['units'][$m] ?? 0; }
        public function isPlanet(): bool { return !$this->isMoon(); }
    }

    class PlanetListService
    {
        public function __construct(public array $planets, public array $moons) {}
        public function allPlanets(): array { return $this->planets; }
        public function allMoons(): array { return $this->moons; }
        public function planetCount(): int { return count($this->planets); }
        public function allCount(): int { return count($this->planets) + count($this->moons); }
    }

    class BladeUser
    {
        public function __construct(public ?int $cls) {}
        public function getCharacterClassEnum() { return $this->cls === null ? null : \OGame\Enums\CharacterClass::tryFrom($this->cls); }
    }

    class PlayerService
    {
        public PlanetListService $planets;
        public function __construct(public array $d, PlanetListService $planets) { $this->planets = $planets; }
        public function getId(): int { return $this->d['id']; }
        public function isAdmin(): bool { return false; }
        public function getUsername(bool $formatted = true): string { return $this->d['username']; }
        public function getUser() { return new BladeUser($this->d['class']); }
        public function getMaxPlanetAmount(): int { return $this->d['maxPlanets']; }
    }
}

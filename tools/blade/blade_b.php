<?php
/**
 * Minimal Blade renderer (buildings variant: @props, $loop, HtmlString) used ONLY to produce fixtures from the real OgameX
 * Blade templates with stubbed services. Not shipped with the extensions.
 */

const OGX_SRC = '/tmp/claude-0/-home-claude/1ebb7366-d4fd-5fac-899e-5244b2310d13/scratchpad/src/OGameX';
const OGX_ORIGIN = 'http://localhost';

// ---------------------------------------------------------------- compiler
function blade_balanced(string $s, int $pos): array
{
    // $pos points at '('. Returns [inner, endPosAfterClosingParen]
    $depth = 0; $len = strlen($s); $q = null;
    for ($i = $pos; $i < $len; $i++) {
        $c = $s[$i];
        if ($q !== null) {
            if ($c === '\\') { $i++; continue; }
            if ($c === $q) { $q = null; }
            continue;
        }
        if ($c === '"' || $c === "'") { $q = $c; continue; }
        if ($c === '(') { $depth++; }
        elseif ($c === ')') { $depth--; if ($depth === 0) { return [substr($s, $pos + 1, $i - $pos - 1), $i + 1]; } }
    }
    throw new RuntimeException('Unbalanced parens at ' . $pos);
}

function blade_compile(string $src): string
{
    $src = preg_replace('/\{\{--.*?--\}\}/s', '', $src);
    // @php ... @endphp
    $src = preg_replace_callback('/@php(?!\s*\()(.*?)@endphp/s', fn($m) => '<?php ' . $m[1] . ' ?>', $src);
    // raw echos
    $src = preg_replace_callback('/\{!!\s*(.+?)\s*!!\}(\r?\n)?/s', function ($m) {
        return '<?php echo ' . $m[1] . '; ?>' . (isset($m[2]) ? $m[2] . $m[2] : '');
    }, $src);
    // escaped echos
    $src = preg_replace_callback('/(@)?\{\{\s*(.+?)\s*\}\}(\r?\n)?/s', function ($m) {
        if ($m[1] === '@') { return substr($m[0], 1); }
        return '<?php echo e(' . $m[2] . '); ?>' . (isset($m[3]) ? $m[3] . $m[3] : '');
    }, $src);

    // directives
    $out = '';
    $len = strlen($src);
    $i = 0;
    $withArgs = ['props', 'if', 'elseif', 'foreach', 'for', 'include', 'lang', 'json', 'vite', 'extends', 'section', 'yield', 'isset', 'unless', 'empty'];
    $noArgs = ['else', 'endif', 'endforeach', 'endfor', 'endsection', 'endisset', 'endunless', 'endempty', 'csrf'];
    while ($i < $len) {
        $at = strpos($src, '@', $i);
        if ($at === false) { $out .= substr($src, $i); break; }
        $out .= substr($src, $i, $at - $i);
        // skip inside php blocks
        $phpOpen = strrpos($out, '<?php');
        $phpClose = strrpos($out, '?>');
        if ($phpOpen !== false && ($phpClose === false || $phpClose < $phpOpen)) { $out .= '@'; $i = $at + 1; continue; }
        if (!preg_match('/\G@([a-zA-Z]+)/', $src, $m, 0, $at)) { $out .= '@'; $i = $at + 1; continue; }
        $name = $m[1];
        $after = $at + strlen($m[0]);
        if (in_array($name, $withArgs, true)) {
            $j = $after;
            while ($j < $len && ($src[$j] === ' ' || $src[$j] === "\t")) { $j++; }
            if ($j < $len && $src[$j] === '(') {
                [$args, $end] = blade_balanced($src, $j);
                $out .= blade_directive($name, $args);
                $i = $end;
                // PHP eats one newline after the closing tag automatically
                continue;
            }
        }
        if (in_array($name, $noArgs, true)) {
            $out .= blade_directive($name, null);
            $i = $after;
            continue;
        }
        $out .= '@';
        $i = $at + 1;
    }
    return $out;
}

function blade_directive(string $name, ?string $args): string
{
    switch ($name) {
        case 'if': return "<?php if($args): ?>";
        case 'elseif': return "<?php elseif($args): ?>";
        case 'else': return '<?php else: ?>';
        case 'endif': return '<?php endif; ?>';
        case 'unless': return "<?php if(!($args)): ?>";
        case 'endunless': return '<?php endif; ?>';
        case 'isset': return "<?php if(isset($args)): ?>";
        case 'endisset': return '<?php endif; ?>';
        case 'empty': return "<?php if(empty($args)): ?>";
        case 'endempty': return '<?php endif; ?>';
        case 'props': return '';
        case 'foreach':
            $GLOBALS['__loopN'] = ($GLOBALS['__loopN'] ?? 0) + 1; $n = $GLOBALS['__loopN'];
            return "<?php \$__li$n = 0; foreach($args): \$__li$n++; \$loop = (object)['iteration' => \$__li$n, 'index' => \$__li$n - 1]; ?>";
        case 'endforeach': return '<?php endforeach; ?>';
        case 'for': return "<?php for($args): ?>";
        case 'endfor': return '<?php endfor; ?>';
        case 'include': return "<?php echo blade_include_args(get_defined_vars(), $args); ?>";
        case 'lang': return "<?php echo __($args); ?>";
        case 'json': return "<?php echo json_encode($args, 15); ?>";
        case 'vite': return '<?php echo blade_vite(); ?>';
        case 'extends': return "<?php \$__extends = $args; ?>";
        case 'section': return "<?php ob_start(); \$__section = $args; ?>";
        case 'endsection': return "<?php \$GLOBALS['__sections'][\$__section] = ob_get_clean(); ?>";
        case 'yield': return "<?php echo \$GLOBALS['__sections'][$args] ?? ''; ?>";
        case 'csrf': return '<?php echo csrf_field(); ?>';
    }
    return '';
}

function blade_include_args(array $vars, string $view, array $data = []): string
{
    foreach (array_keys($vars) as $k) { if (str_starts_with($k, '__')) { unset($vars[$k]); } }
    return blade_render($view, array_merge($vars, $data));
}

function blade_render(string $__view, array $__data = []): string
{
    $__file = OGX_SRC . '/resources/views/' . str_replace('.', '/', $__view) . '.blade.php';
    $__compiled = blade_compile(file_get_contents($__file));
    $__tmp = sys_get_temp_dir() . '/bladeb_' . md5($__view) . '.php';
    file_put_contents($__tmp, $__compiled);
    foreach (array_keys($__data) as $__k) { if (str_starts_with($__k, '__')) { unset($__data[$__k]); } }
    extract($__data);
    $__extends = null;
    ob_start();
    include $__tmp;
    $__out = ob_get_clean();
    if ($__extends) {
        $__parent = $__data;
        return blade_render($__extends, $__parent);
    }
    return $__out;
}

function blade_vite(): string
{
    // Production output of laravel-vite-plugin for
    // @vite(['resources/css/ingame.css', 'resources/js/ingame.js']) with Vite::useScriptTagAttributes(['type' => false]).
    // Hashes are sample values.
    return '<link rel="preload" as="style" href="' . OGX_ORIGIN . '/build/assets/ingame-B7lWkX3v.css" />'
        . '<link rel="modulepreload" href="' . OGX_ORIGIN . '/build/assets/ingame-5d1c9e2a.js" />'
        . '<link rel="stylesheet" href="' . OGX_ORIGIN . '/build/assets/ingame-B7lWkX3v.css" />'
        . '<script src="' . OGX_ORIGIN . '/build/assets/ingame-5d1c9e2a.js"></script>';
}

// ---------------------------------------------------------------- helpers
function e($v): string
{
    if ($v instanceof BackedEnum) { $v = $v->value; }
    if ($v instanceof BladeHtmlString) { return (string)$v; }
    return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8', true);
}

$GLOBALS['__lang'] = [];
function __($key, array $replace = [])
{
    $parts = explode('.', $key);
    $file = $parts[0];
    $value = null;
    if (count($parts) > 1 && preg_match('/^[a-z_]+$/i', $file) && is_file(OGX_SRC . "/resources/lang/en/$file.php")) {
        if (!isset($GLOBALS['__lang'][$file])) { $GLOBALS['__lang'][$file] = include OGX_SRC . "/resources/lang/en/$file.php"; }
        $value = $GLOBALS['__lang'][$file];
        foreach (array_slice($parts, 1) as $p) {
            if (is_array($value) && array_key_exists($p, $value)) { $value = $value[$p]; } else { $value = null; break; }
        }
    }
    if ($value === null) { $value = $key; }
    if (is_string($value)) {
        foreach ($replace as $k => $r) { $value = str_replace(':' . $k, (string)$r, $value); }
    }
    return $value;
}

function blade_routes(): array
{
    static $routes = null;
    if ($routes !== null) { return $routes; }
    $routes = [];
    $web = file_get_contents(OGX_SRC . '/routes/web.php');
    preg_match_all("/Route::(?:get|post|delete|match)\((?:\[[^\]]*\],\s*)?'([^']+)'.*?->name\('([^']+)'\)/", $web, $m, PREG_SET_ORDER);
    foreach ($m as $r) { $routes[$r[2]] = '/' . ltrim($r[1], '/'); }
    $routes['logout'] = '/logout';
    $routes['impersonate.leave'] = '/impersonate/leave';
    return $routes;
}

function route(string $name, array $params = []): string
{
    $routes = blade_routes();
    if (!isset($routes[$name])) { throw new RuntimeException("Unknown route $name"); }
    $path = $routes[$name];
    foreach ($params as $k => $v) {
        if (str_contains($path, '{' . $k . '}')) { $path = str_replace('{' . $k . '}', (string)$v, $path); unset($params[$k]); }
    }
    $url = OGX_ORIGIN . ($path === '/' ? '' : $path);
    if ($params) { $url .= '?' . http_build_query($params); }
    return $url;
}

function asset(string $p): string { return OGX_ORIGIN . '/' . ltrim($p, '/'); }
function csrf_token(): string { return $GLOBALS['__ctx']['csrf']; }
class BladeHtmlString { public function __construct(public string $h) {} public function __toString(): string { return $this->h; } }
function csrf_field() { return new BladeHtmlString('<input type="hidden" name="_token" value="' . csrf_token() . '" autocomplete="off">'); }
function env($k, $d = null) { return $d; }
function config($k, $d = null) { return ['app.name' => 'OGameX'][$k] ?? $d; }
function session($k = null) { return null; }
function now() { return \Carbon\Carbon::now(); }

class BladeUrl { public function current() { return OGX_ORIGIN . $GLOBALS['__ctx']['path']; } }
function url($p = null) { return $p === null ? new BladeUrl() : OGX_ORIGIN . '/' . ltrim($p, '/'); }

class BladeRequest
{
    public function url() { return OGX_ORIGIN . $GLOBALS['__ctx']['path']; }
    public function query($k = null) { $q = $GLOBALS['__ctx']['query']; return $k === null ? $q : ($q[$k] ?? null); }
}
function request() { return new BladeRequest(); }

class BladeApp
{
    public function getLocale() { return 'en'; }
}
function app($abstract = null)
{
    if ($abstract === null) { return new BladeApp(); }
    if ($abstract === \OGame\Services\SettingsService::class) { return $GLOBALS['__ctx']['settings']; }
    if ($abstract === \OGame\Services\HalvingService::class) { return new \OGame\Services\HalvingService(); }
    if ($abstract === \OGame\Services\CharacterClassService::class) { return null; }
    return null;
}
class BladeAuthUser { public $alliance_id = null; }
class BladeAuth { public function user() { return new BladeAuthUser(); } public function id() { return $GLOBALS['__ctx']['player']->getId(); } }
function auth() { return new BladeAuth(); }

class Request { public static function is(string $pattern): bool { $p = ltrim($GLOBALS['__ctx']['path'], '/'); $re = '#^' . str_replace('\*', '.*', preg_quote($pattern, '#')) . '$#'; return (bool)preg_match($re, $p); } }
class URL { public static function to($p) { return OGX_ORIGIN . ($p === '/' ? '' : '/' . ltrim($p, '/')); } }
class Session { public static function has($k) { return false; } public static function get($k) { return null; } }

require_once OGX_SRC . '/app/Models/Planet/Coordinate.php';
require_once OGX_SRC . '/app/Enums/CharacterClass.php';
require_once __DIR__ . '/stubs_b.php';

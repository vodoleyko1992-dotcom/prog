# -*- coding: utf-8 -*-
"""Общие помощники базы знаний L2wap Bot (kb/).

Запуск скриптов: python3 -I kb/tools/build_all.py  (из корня репозитория или откуда угодно).
Скрипты только ЧИТАЮТ файлы репозитория и пишут в kb/data/. Значения ключа storage `auth`,
пароли и токены никуда не попадают (check_secrets проверяет каждый результат перед записью).
"""
import json, os, re, datetime

TOOLS = os.path.dirname(os.path.abspath(__file__))
KB = os.path.dirname(TOOLS)
REPO = os.path.dirname(KB)
DATA = os.path.join(KB, 'data')


def rp(*p):
    return os.path.join(REPO, *p)


def read(path):
    with open(rp(path) if not os.path.isabs(path) else path, encoding='utf-8') as f:
        return f.read()


def load_json(path):
    return json.loads(read(path))


_BASE = None


def base_profile():
    global _BASE
    if _BASE is None:
        _BASE = load_json('base-profile.json')
    return _BASE


def rt_warlock():
    return base_profile()['chars']['Warlock']['rt']


def iso(ms):
    """epoch ms → ISO UTC (журнал бота пишет часы браузера игрока UTC+10 — см. l2-log-review)."""
    try:
        if not ms:
            return None
        return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    except Exception:
        return None


def iso_local(ms):
    """epoch ms → время браузера игрока (UTC+10), как в журнале бота."""
    try:
        if not ms:
            return None
        tz = datetime.timezone(datetime.timedelta(hours=10))
        return datetime.datetime.fromtimestamp(ms / 1000, tz).strftime('%d.%m %H:%M')
    except Exception:
        return None


# ---------------- вывод JSON: читаемо, но мелкие объекты в одну строку ----------------
def _compact(o):
    return json.dumps(o, ensure_ascii=False, separators=(', ', ': '))


def pretty(o, indent=0, width=118):
    pad = '  ' * indent
    c = _compact(o)
    if not isinstance(o, (dict, list)) or len(c) + len(pad) <= width or not o:
        return c
    if isinstance(o, dict):
        items = [pad + '  ' + json.dumps(k, ensure_ascii=False) + ': ' + pretty(v, indent + 1, width).lstrip() for k, v in o.items()]
        return '{\n' + ',\n'.join(items) + '\n' + pad + '}'
    items = [pad + '  ' + pretty(v, indent + 1, width).lstrip() for v in o]
    return '[\n' + ',\n'.join(items) + '\n' + pad + ']'


SECRET_KEY = re.compile(r'^(auth|password|passwd|pass|token|jwt|cookie|session|login|email)$', re.I)


def check_secrets(o, path='$'):
    """Ничего похожего на пароль/токен/ключ auth в выходных данных."""
    if isinstance(o, dict):
        for k, v in o.items():
            if SECRET_KEY.match(str(k)) and v not in (None, '', {}, [], '***', '(скрыто)') and not isinstance(v, (bool, int, float)) \
                    and not (isinstance(v, str) and v.startswith('[')):
                raise ValueError(f'возможный секрет в {path}.{k}')
            check_secrets(v, f'{path}.{k}')
    elif isinstance(o, list):
        for i, v in enumerate(o):
            check_secrets(v, f'{path}[{i}]')


def write_json(name, obj):
    check_secrets(obj)
    os.makedirs(DATA, exist_ok=True)
    p = os.path.join(DATA, name)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(pretty(obj) + '\n')
    return p


# ---------------- разбор литералов JS (объекты/массивы/строки/числа/регулярки) ----------------
class JSParseError(Exception):
    pass


class JSLit:
    """Мини-разборщик литерала JS: {a: 1, 'b': [2, "x"], c: /re/i, d: new Set([...])}.
    Непонятное выражение не роняет разбор: значение становится {"$expr": "<исходный текст>"}."""

    def __init__(self, s, i=0):
        self.s, self.i = s, i

    def ws(self):
        s = self.s
        while self.i < len(s):
            c = s[self.i]
            if c in ' \t\r\n':
                self.i += 1
            elif s.startswith('//', self.i):
                j = s.find('\n', self.i)
                self.i = len(s) if j < 0 else j + 1
            elif s.startswith('/*', self.i):
                j = s.find('*/', self.i + 2)
                self.i = len(s) if j < 0 else j + 2
            else:
                break

    def peek(self):
        self.ws()
        return self.s[self.i] if self.i < len(self.s) else ''

    def raw_until_sep(self):
        """сырой текст до ',' / '}' / ']' / ';' на нулевой глубине"""
        s, d, j = self.s, 0, self.i
        q = None
        while j < len(s):
            c = s[j]
            if q:
                if c == '\\':
                    j += 2
                    continue
                if c == q:
                    q = None
            elif c in '\'"`':
                q = c
            elif c in '([{':
                d += 1
            elif c in ')]}':
                if d == 0:
                    break
                d -= 1
            elif c in ',;\n' and d == 0:
                break
            j += 1
        t = s[self.i:j].strip()
        self.i = j
        return t

    def string(self):
        s, q = self.s, self.s[self.i]
        self.i += 1
        out = []
        while self.i < len(s):
            c = s[self.i]
            if c == '\\':
                n = s[self.i + 1]
                m = {'n': '\n', 't': '\t', 'r': '\r', '0': '\0'}
                if n == 'u':
                    out.append(chr(int(s[self.i + 2:self.i + 6], 16)))
                    self.i += 6
                    continue
                out.append(m.get(n, n))
                self.i += 2
                continue
            if c == q:
                self.i += 1
                return ''.join(out)
            out.append(c)
            self.i += 1
        raise JSParseError('строка не закрыта')

    def regex(self):
        s, j, cls = self.s, self.i + 1, False
        while j < len(s):
            c = s[j]
            if c == '\\':
                j += 2
                continue
            if c == '[':
                cls = True
            elif c == ']':
                cls = False
            elif c == '/' and not cls:
                break
            j += 1
        body = s[self.i + 1:j]
        j += 1
        k = j
        while k < len(s) and s[k].isalpha():
            k += 1
        self.i = k
        return {'$regex': body, 'flags': s[j:k]}

    def value(self):
        c = self.peek()
        if c == '{':
            return self.obj()
        if c == '[':
            return self.arr()
        if c in '\'"':
            v = self.string()
            return self.after(v)
        if c == '`':
            v = self.string()
            return v if '${' not in v else {'$expr': '`' + v + '`'}
        if c == '/':
            return self.regex()
        if self.s.startswith('new Set(', self.i):
            self.i += len('new Set(')
            v = self.value()
            self.ws()
            if self.s[self.i] == ')':
                self.i += 1
            return {'$set': v}
        m = re.compile(r'-?(?:\d[\d_]*\.?\d*(?:e[+-]?\d+)?|\.\d+)').match(self.s, self.i)
        if m and m.group(0) not in ('-', ''):
            start = self.i
            self.i = m.end()
            v = float(m.group(0).replace('_', ''))
            v = int(v) if v.is_integer() and '.' not in m.group(0) else v
            nx = self.peek()
            if nx and nx not in ',}];)':
                self.i = start
                raw = self.raw_until_sep()
                if re.fullmatch(r'[\d\s.*]+', raw):
                    p = 1
                    for x in raw.split('*'):
                        p *= float(x)
                    return int(p) if p.is_integer() else p
                return {'$expr': raw}
            return v
        m = re.compile(r'[A-Za-z_$][\w$]*').match(self.s, self.i)
        if m:
            w = m.group(0)
            nx_i = m.end()
            rest = self.s[nx_i:nx_i + 1]
            if w in ('true', 'false', 'null', 'undefined', 'Infinity') and (not rest or rest in ' ,}]\n\r\t;)'):
                self.i = nx_i
                return {'true': True, 'false': False, 'null': None, 'undefined': None, 'Infinity': 'Infinity'}[w]
        return {'$expr': self.raw_until_sep()}

    def after(self, v):
        nx = self.peek()
        if nx and nx not in ',}];)':
            raw = self.raw_until_sep()
            return {'$expr': json.dumps(v, ensure_ascii=False) + ' ' + raw}
        return v

    def key(self):
        c = self.peek()
        if c in '\'"':
            return self.string()
        if c == '[':
            self.i += 1
            k = self.value()
            self.ws()
            self.i += 1
            return json.dumps(k, ensure_ascii=False)
        m = re.compile(r'[\w$]+').match(self.s, self.i)
        if not m:
            raise JSParseError('ключ не распознан у ' + self.s[self.i:self.i + 40])
        self.i = m.end()
        return m.group(0)

    def obj(self):
        self.i += 1
        out = {}
        while True:
            c = self.peek()
            if c == '}':
                self.i += 1
                return out
            if self.s.startswith('...', self.i):
                self.i += 3
                out['$spread' + str(len(out))] = self.raw_until_sep()
            else:
                k = self.key()
                c = self.peek()
                if c == ':':
                    self.i += 1
                    out[k] = self.value()
                elif c == '(':   # метод — пропускаем тело
                    out[k] = {'$expr': self.raw_until_sep()}
                else:            # краткая запись {a, b}
                    out[k] = {'$expr': k}
            c = self.peek()
            if c == ',':
                self.i += 1

    def arr(self):
        self.i += 1
        out = []
        while True:
            c = self.peek()
            if c == ']':
                self.i += 1
                return out
            out.append(self.value())
            if self.peek() == ',':
                self.i += 1


def js_const(src, name, file=''):
    """Значение `const NAME = <литерал>` (или `, NAME = ` в цепочке объявлений)."""
    m = re.search(r'(?:\bconst|\blet|\bvar|,)\s*' + re.escape(name) + r'\s*=\s*', src)
    if not m:
        raise JSParseError(f'{name} не найден в {file}')
    p = JSLit(src, m.end())
    return p.value()


def js_const_file(path, name):
    return js_const(read(path), name, path)


def line_of(src, needle):
    i = src.find(needle)
    return src.count('\n', 0, i) + 1 if i >= 0 else None


def il_db():
    """skills-il.js → dict id → запись Interlude (n имя, c категория, t тип, mp, pow, reuse мс …)."""
    s = read('skills-il.js')
    i = s.index('const IL_DB = ') + len('const IL_DB = ')
    j = s.index('};', i) + 1
    return json.loads(s[i:j])


_ITEMS = None


def items_il():
    global _ITEMS
    if _ITEMS is None:
        _ITEMS = load_json('items-il.json')
    return _ITEMS


def meta(title, sources, note=''):
    return {'title': title, 'generated_by': 'kb/tools/build_all.py (python3 -I)', 'sources': sources,
            'note': note, 'repo_version': load_json('manifest.json').get('version')}

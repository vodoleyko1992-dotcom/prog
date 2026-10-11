# -*- coding: utf-8 -*-
"""Ссылки кода на игру → kb/data/api.json (запросы к серверу l2wap.com) и kb/data/selectors.json (разметка страниц).

api.json = автообучение бота (base-profile.json learn.api: что игра реально запрашивала, статусы, ключи ответов, формы ошибок)
         + упоминания путей в коде (файл:строка) и в документации + вручную выписанные поля запросов/ответов (API_DOC ниже).
selectors.json = строки-селекторы из content.js и modules/*.js (файл:строка), селекторы автообучения learn.sel (по страницам)
         + словарь id/классов, которые бот видел на каждой странице (learn.pages[*].tok), + ключевые селекторы из CLAUDE.md.
Запуск: python3 -I kb/tools/build_code_refs.py
"""
import os, sys, re, glob, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kblib as K

CODE = ['content.js', 'hook.js', 'background.js', 'popup.js', 'battle-cooldown.js', 'engine-core.js', 'ui-v7.js'] + \
       sorted(os.path.relpath(p, K.REPO) for p in glob.glob(K.rp('modules', '*.js')))
DOCS = ['CLAUDE.md', 'README-RU.md', 'WARLOCK-TO-78-RU.md'] + sorted(os.path.relpath(p, K.REPO) for p in glob.glob(K.rp('CHANGELOG-*.md'))) + \
       sorted(os.path.relpath(p, K.REPO) for p in glob.glob(K.rp('.claude', 'skills', '*', 'SKILL.md')))
TESTS = sorted(os.path.relpath(p, K.REPO) for p in glob.glob(K.rp('tests', '*.js')) + glob.glob(K.rp('tests', '*.cjs')))


def norm_path(p):
    p = p.split('?')[0].rstrip('.,:;)')
    p = re.sub(r'/l2dop_rb_\d+', '/<spawnId>', p)
    p = re.sub(r'/spawn/\$\{[^}]+\}', '/spawn/<spawnId>', p)
    p = re.sub(r'/spawn/<id>', '/spawn/<spawnId>', p)
    p = re.sub(r'/by-name/[^/]+/', '/by-name/<name>/', p)
    p = re.sub(r'/siege/l2dop_\w+/', '/siege/<castle>/', p)
    p = re.sub(r'/profession-quest/[a-z\-]+-second/status', '/profession-quest/<class>-second/status', p)
    return p


# ---- вручную: поля запросов/ответов, которые использует бот (по коду и документации) ----
API_DOC = {
    'POST /game/battle/action': {
        'request': {'battleSpawnId': 'spawnId боя (в цепочке «Охотиться дальше» игра шлёт id ПЕРВОГО боя цепочки, URL меняется — 7.2.1)',
                    'action': "'l2_<skillId>' | 'attack' | 'battle_potion_use' (банка)"},
        'response_used': ['kind: delta | battle-end (5144 из 8830 ответов — delta, 8.0)', 'delta.serverNowMs', 'delta.skillCooldowns {l2_<id>: untilMs} — откат ЭТОГО нажатия (8.0.3)',
                          'delta.mysticSkillCdUntil (смысл не ясен, пишется в «КД сервера»)', 'delta.characterHp/characterMaxHp', 'delta.activeSummon {key, hp, maxHp, nameUk}',
                          'battle / victory / defeat / lethalMeta (итог)', 'character.inventory.stacks[{itemId, qty}] (сумка — hook.js отдаёт целиком полем inv)',
                          'старый формат: globalCooldownUntilMs, cooldownUntilMs, readyAtMs, skillRemainingMs, normalizedSkillId (игра больше не шлёт globalCooldownUntilMs — 11.10)',
                          'attack: nextPhysicalAttackAt, attackIntervalMs, requestedAction, remainingMs/readyAtMs при отказе'],
        'errors': ['400 skill_cooldown {blockedBy: global|skill, globalCooldownUntilMs, globalRemainingMs, serverNowMs}', '400 mystic_spiritshot_grade_mismatch (заряды не того грейда, 14 раз)',
                   '409 revision_conflict {serverRevision}', 'pve_farm_blocked {blockedUntil, remainingSeconds, messageRu/Uk}', 'battle_too_far (v5.3.1)'],
        'timing': 'ответ ≈0,6–1,1 с после клика; после ответа игра шлёт GET /character (≈8 мс, идёт 0,25–0,56 с) — клик в это окно теряется (8.0.3); ответ > 8 с = сервер висит (8.0.4)',
        'bot': 'клик по слоту панели; hook.js netStart/конец с rid; combat.gameFree; battle-cooldown.observe'},
    'POST /game/battle/start': {'response_used': ['battle', 'character', 'activeSummon'], 'bot': 'клик «В бой» в окне моба на карте'},
    'POST /game/battle/hunt-continue': {'response_used': ['battle', 'character', 'activeSummon'], 'bot': 'кнопка #battle-victory-hunt «Охотиться дальше» — цепочка ≈5,4 с/моб против ≈11,4 с через карту'},
    'GET /game/battle/sync': {'response_used': ['serverNowMs', 'skillCooldowns', 'mysticSkillCdUntil', 'activeSummon', 'characterHp/Mp/MaxHp/MaxMp', 'battleEnded', 'outcome', 'logTail', 'globalCooldownUntilMs (до 11.10)'],
                              'bot': 'battle-cooldown.observeSync (запасной путь отката, 7.1.14)'},
    'GET /game/battle': {'response_used': ['battle.activeSummon', 'globalCooldownUntilMs', 'serverNowMs']},
    'POST /game/battle/leave': {'request': {'battleSpawnId': 'бой, из которого выходим'}, 'response_used': ['character'],
                                'bot': '#battle-back-map «Назад на карту» — работает и посреди боя с РБ (аварийный выход 8.0.4, отход с эпика)'},
    'POST /game/battle/return-to-town': {'bot': '«Вернуться в город» после смерти; метка sessionStorage l2bot.toTown; сбрасывает rt.zone (8.0.3)'},
    'GET /game/map/spawns': {'response_used': ['nearbySpawns[{id, kind, name, level, distance}] — hook.js отдаёт до 3000 строк полем sp (метки карты тип моба больше не несут)'],
                             'bot': 'content.netSpawns → rt.spawns (spawnId → [имя, ур.])'},
    'GET /character': {'response_used': ['character (огромный объект: инвентарь, статы)', 'character.inventory.stacks', 'catalogVersion', 'pvpIncoming'],
                       'timing': 'игра шлёт сама после каждого хода; пока в полёте — клики теряются (8.0.3)'},
    'POST /character/equip': {'request': {'action': "'equip' | 'unequip'", 'itemId': 'id предмета (items-il.json)', 'enchant': 'заточка', 'enchantPAtkBonus': 'бонус P.Atk',
                                          'targetInstanceId': 'экземпляр', 'slot': 'при unequip (weapon/rhand/lrhand)'},
                              'response_used': ['character'], 'bot': 'content.weaponEquipNote — надетое оружие → грейд зарядов (7.1.28)'},
    'GET /character/profession-quest/<class>-second/status': {'response_used': ['status.accepted', 'status.kills[{name, need, have}]', 'status.stage', 'status.completed', 'status.titleUk', 'status.instructionUk'],
                                                              'bot': 'content.profQuestNote → ★-цели квеста профессии (7.1.23)'},
    'POST /game/drops-shop/buy': {'request': {'shopKey': '"consumable/blessed_spiritshot_d" и т. п.', 'qty': 'количество (3000)'}, 'response_used': ['character'],
                                  'bot': 'economy: сверка ключа товара (грейд/тип) после покупки — «⚠ куплено не то» → сутки не докупать (7.1.26)'},
    'GET /game/drops-shop': {'bot': 'магазин /gm-shop.html'},
    'GET /game/raid-bosses': {'response_used': ['bosses[]', 'page', 'pageSize', 'total', 'totalPages', 'adenaCost', 'baseAdenaCost', 'vipFreeApplied', 'characterLevel', 'minRaidBossLevel'],
                              'bot': 'список РБ /rb-bosses.html (пагинация #rb-pager-*); частичный список дописывается (8.0.3)'},
    'POST /game/raid-boss/teleport': {'request': {'spawnId': 'l2dop_rb_<npcId>', 'expectedRevision': 'ревизия персонажа', 'expectedAdenaCost': '100000'},
                                      'bot': 'кнопка .l2-rb-row__tp[data-spawn-id]; только после проверки сил по цифрам (raid.rbInfo / RB_KNOWN); сбрасывает rt.zone'},
    'GET /game/spawn/<spawnId>/info': {'response_used': ['stats {maxHp, pAtk, pDef, mAtk, mDef}', 'drops', 'rewardExp', 'rewardSp', 'адена награды'],
                                       'bot': 'СВОЙ fetch бота (raid.rbInfo, таймаут 6 с) + пассивно, когда игра запрашивает при нажатии на РБ на карте; журнал сети свой запрос бота не видит'},
    'GET /game/epic-bosses': {'request': {'?page': '1'}, 'response_used': ['bosses[{spawnId, name, level, bossType, isAlive, canAttack, attackBlockedReasonUk, coinOfLuckCost, adenaCost, respawnHours, icon}]',
                                                                          'total', 'characterLevel', 'minRaidBossLevel (= герой − 9)', 'baseCoinOfLuckCost', 'vipFreeApplied'],
                              'bot': 'СВОЙ fetch бота (epics) + пассивно со страницы /epic-bosses.html; hook.js отдаёт bosses целиком полем eb'},
    'POST /game/epic-boss/teleport': {'request': {'spawnId': 'l2dop_rb_290xx', 'expectedRevision': 'ревизия', 'expectedCoinOfLuckCost': '1'}, 'response_used': ['200 + {character} (явного ok нет)'],
                                      'bot': 'только через epicPayGate при положительном лимите CoL (по умолчанию 0 = никогда)'},
    'GET /game/tvt': {'response_used': ['phase (REGISTRATION/…/ACTIVE/FINISHED)', 'isRegistered', 'myTeam', 'schedule.next {registrationOpensAt, preparationStartsAt, battleStartsAt}', 'serverNow', 'eventId', 'startsAt'],
                      'bot': 'TvT: слоты 08:00, 15:00, 20:00 (игровое время), запись за 10 мин; окно #l2-tvt-registration-prompt'},
    'GET /game/tvt/combat/sync': {'response_used': ['self', 'selectedTarget {hp, cp, alive, stunnedUntil}']},
    'POST /game/tvt/action': {'response_used': ['targetHp', 'targetCp', 'targetDead']},
    'GET /game/time': {'bot': 'СВОЙ лёгкий запрос: проба сервера раз в 10 с, пока сервер лежит (content.srvUp, 7.2.5); background.srvProbe; 200+HTML = сервер не отвечает (8.0)'},
    'POST /game/fishing/action': {'request': {'action': 'cast | pumping | reeling | selectBait | selectRod | buyFishingSpot | buyFishingTime', 'expectedRevision': 'ревизия (следующий запрос её несёт)'},
                                  'response_used': ['fishing.serverNowMs', 'fishing.cooldowns (структура неизвестна)', 'character', 'revision'],
                                  'errors': ['400 action_cooldown {messageRu, messageUk} — ложные при лаге сервера'],
                                  'timing': 'откат действия ≥≈0,9–1,05 с; считать от времени сервера (8.0.4)'},
    'GET /game/fishing/state': {'response_used': ['bait', 'basicBait', 'goodBait', 'cooldowns', 'economy', 'fishingSoulshot', 'fishingSpot', 'fishingTime', 'learnedSkills', 'rod', 'rods', 'starterShop', 'target', 'training', 'unlocked', 'serverNowMs']},
    'POST /game/fishing/buy-starter': {'request': {'offerKey': 'starter_rod | bait_x10 | soulshot_x50', 'amount': 'пакетов'}, 'response_used': ['character', 'fishing', 'revision']},
    'POST /character/town/fast-aden-buffer/apply': {'request': {'set': 'набор', 'skillId': 'id баффа', 'expectedCostFastAden': '1 | 5'},
                                                    'response_used': ['buffsApplied', 'costFastAden', 'fastAdenBalance', 'character']},
    'POST /character/town/buffer': {'bot': 'новый городской баффер (11.10); кнопка .l2-town-buffer-set-apply[data-set-id]'},
    'POST /game/teleport': {'errors': ['409 revision_conflict'], 'bot': 'кнопки «Телепорта» [data-teleport-id] (Окрестности городов)'},
    'GET /game/farm-guide': {'response_used': ['resources', 'keyMaterials', 'raidEquipment', 'resourceTeleportAdenaCost']},
    'POST /game/farm-guide/resource-teleport': {'bot': 'телепорт со страницы «Фарм ресурсов» (кнопка страницы)'},
    'POST /auth/login': {'bot': 'автовход; тело и ответ скрыты в журнале («(скрыто)»), пароль никогда не пишется'},
}


def scan_paths(files, pat):
    out = collections.defaultdict(list)
    for f in files:
        try:
            lines = K.read(f).split('\n')
        except Exception:
            continue
        for i, l in enumerate(lines, 1):
            for m in pat.finditer(l):
                yield f, i, m, l


PATH_RE = re.compile(r"(?:\\/|/)(?:game|character|auth)(?:(?:\\/|/)[A-Za-z0-9_\-\$\{\}\.<>]+)*")
DOC_RE = re.compile(r"\b(GET|POST|PUT|DELETE)\s+(/[A-Za-z0-9_/<>\{\}\.\-]+)(\s*\{[^}\n]*\})?")


def build_api():
    learn = K.base_profile()['learn']['api']
    E = {}

    def ep(method, path):
        k = f'{method} {path}'
        if k not in E:
            E[k] = {'method': method, 'path': path, 'observed': None, 'code_refs': [], 'doc_refs': [], 'botFetchesItself': False}
        return E[k]

    raw_variants = collections.defaultdict(set)
    for key, v in learn.items():
        method, path = key.split(' ', 1)
        np = norm_path(path)
        raw_variants[f'{method} {np}'].add(path)
        e = ep(method, np)
        ob = e['observed'] or {'n': 0, 'statuses': collections.Counter(), 'responseKeys': set(), 'forms': set(), 'pages': set(), 'first': None, 'last': None}
        ob['n'] += v.get('n', 0)
        for s, c in (v.get('st') or {}).items():
            ob['statuses'][s] += c
        ob['responseKeys'] |= set(v.get('keys', {}))
        ob['forms'] |= set(v.get('forms', {}))
        if v.get('page'):
            ob['pages'].add(v['page'])
        ob['first'] = min(x for x in (ob['first'], v.get('first')) if x) if v.get('first') else ob['first']
        ob['last'] = max(x for x in (ob['last'], v.get('last')) if x) if v.get('last') else ob['last']
        e['observed'] = ob
    for k, d in API_DOC.items():
        m, p = k.split(' ', 1)
        e = ep(m, p)
        e.update({x: y for x, y in d.items()})
        if 'СВОЙ' in d.get('bot', ''):
            e['botFetchesItself'] = True
    # пути в коде (метод неизвестен — прикрепляем ко всем методам с этим путём, иначе GET?)
    code_paths = collections.defaultdict(set)
    for f, i, m, line in scan_paths(CODE, PATH_RE):
        p = norm_path(m.group(0).replace('\\/', '/'))
        p = re.sub(r'[\(\|\?\*\+\[\]\^\$].*$', '', p).rstrip('/')
        if len(p) < 6 or p.endswith('.html'):
            continue
        code_paths[p].add(f'{f}:{i}')
    # упоминания в документации и комментариях
    for f, i, m, line in scan_paths(DOCS + CODE + TESTS, DOC_RE):
        p = norm_path(m.group(2))
        if not re.match(r'^/(game|character|auth)\b', p):
            continue
        e = ep(m.group(1), p)
        ref = f'{f}:{i}'
        if m.group(3):
            ref += ' ' + m.group(3).strip()
        if ref not in e['doc_refs'] and len(e['doc_refs']) < 12:
            e['doc_refs'].append(ref)
    for p, refs in code_paths.items():
        targets = [e for e in E.values() if e['path'] == p]
        if not targets:
            # путь-префикс из регулярки (/character/profession-quest/[\w-]+/status) — к путям, которые с него начинаются
            targets = [e for e in E.values() if e['path'].startswith(p + '/')][:3] or [ep('ANY', p)]
        for e in targets:
            e['code_refs'] = sorted(set(e['code_refs']) | refs)[:20]
    out = []
    for k in sorted(E, key=lambda x: (E[x]['path'], E[x]['method'])):
        e = E[k]
        ob = e['observed']
        if ob:
            e['observed'] = {'requests': ob['n'], 'statuses': dict(ob['statuses']), 'responseTopKeys': sorted(ob['responseKeys']),
                             'responseForms': sorted(ob['forms']), 'pages': sorted(ob['pages']), 'first': K.iso(ob['first']), 'last': K.iso(ob['last']),
                             'rawPaths': sorted(raw_variants.get(k, []))[:12] if len(raw_variants.get(k, [])) > 1 else None}
            if not e['observed']['rawPaths']:
                del e['observed']['rawPaths']
        mod = sorted({os.path.basename(r.split(':')[0]) for r in e['code_refs']})
        e['usedByFiles'] = mod
        e['noise'] = bool(re.search(r'unread|/chat/|news|online|party/hud|public-stats|achievements|catalog-version|siege|story-quests|mail|item-transfer|clans|latest-news', e['path']))
        out.append(e)
    return {
        'meta': K.meta('API игры l2wap.com, которое видит или использует бот', [
            'base-profile.json learn.api (автообучение: 86 путей, n запросов, статусы, ключи ответа верхнего уровня; 09.10 07:10 – 10.10 12:40 UTC)',
            'код: ' + ', '.join(CODE), 'документация: CLAUDE.md, CHANGELOG-*.md, .claude/skills/*/SKILL.md, tests/*', 'API_DOC в kb/tools/build_code_refs.py — поля, выписанные из кода/документов'],
            'Бот почти всё делает кликами по странице и ЧИТАЕТ ответы игры через hook.js (MAIN world: fetch/XHR → postMessage net/netStart; пароли/токены вырезаны; массивы > 8 обрезаны, '
            'кроме inv/sp/eb). Свои запросы бот шлёт только: GET /game/spawn/<id>/info, GET /game/epic-bosses?page=1, GET /game/time (botFetchesItself). '
            'Путь нормализован: l2dop_rb_N → <spawnId>, профессия → <class>, замок → <castle>, ник → <name>. noise — фоновые опросы игры.'),
        'hook': {'TRACK_for_click_gate': '^/(character|game/battle/(action|start|hunt-continue))$', 'secret_keys_redacted': 'pass|token|auth|session|sid|cookie|secret|csrf|sign|captcha|email|phone|login|user|nick|account|jwt|bearer|ticket|apikey|refresh',
                 'full_arrays': {'inv': 'character.inventory.stacks → [itemId, qty]', 'sp': '/game/map/spawns nearbySpawns → [id, kind, name, level, distance] (≤3000)', 'eb': '/game/epic-bosses bosses'},
                 'journal_truncation': 'ответ в журнале ≤800 знаков; GET 2xx одного пути — не чаще раза в 3 с; шумные — раз в минуту'},
        'counts': {'endpoints': len(out), 'observed': sum(1 for e in out if e['observed']), 'with_code_refs': sum(1 for e in out if e['code_refs']),
                   'with_field_notes': sum(1 for e in out if 'request' in e or 'response_used' in e), 'bot_fetches_itself': sum(1 for e in out if e['botFetchesItself'])},
        'endpoints': out,
    }


# ------------------------------------------------------------------------------------------------
LIT = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*)`")
SELISH = re.compile(r"^[\s,]*(?:[#.\[]|[a-z]+[#.\[:])[\w\-#.\[\]=\"'*^$~|:(), >+]*$")
OWN = re.compile(r'#l2bot|#mage$|^#[0-9a-f]{6}$|^#app$')

PAGE_RULES = [
    ('battle', r'#battle-|\.l2-battle-|data-slot-cd|l2-hotbar-shot|#l2-bh-|whirlwind|data-hotbar-row'),
    ('map', r'#map-|\.l2-map-|data-spawn-id(?!.*rb-row)'),
    ('fishing', r'#fishing-|\.l2-fishing-|\.l2-fshop-|data-offer|open-rod-select|data-fishing-inventory-tab'),
    ('char', r'#char-|\.l2-char-|data-l2-slot|data-inv-|data-fishing-inventory-row|data-item-json'),
    ('gm-shop', r'gm-shop|drops-shop|drops-buy|data-buy-qty|data-consumablesub|\[data-grade\]|data-preview'),
    ('rb-bosses', r'#rb-|\.l2-rb-|#epic-'),
    ('teleport', r'teleport-miru|data-teleport-id|data-surroundings-key'),
    ('town-buffer', r'town-buffer|\.l2-fa-buy|fast-aden|buffer-statue'),
    ('magister', r'magister'),
    ('character', r'#character-'),
    ('tvt-arena', r'tvt'),
    ('forum-farm-resources', r'\.l2-farm-'),
    ('forum-recipe-hunt', r'recipe-hunt'),
    ('dungeon', r'#dungeon-|dungeon-enter'),
    ('quests', r'starter-story|character-quests|complete-chapter|quest-te|quest-tr|captain-andrei|campaign|mail-starter'),
    ('hud', r'#l2-hud-|\.l2-hud-|#l2-nav-bottom|data-nav-role|player-identity'),
    ('misc', r'antibot|cf-|\.l2-page|role=tab|\[id|\[role'),
]


def page_of(sel):
    for p, rx in PAGE_RULES:
        if re.search(rx, sel):
            return p
    return 'прочее'


CLAUDE_SELECTORS = {
    'battle': ['.l2-battle-hotbar-slot[data-slot-cd="l2_1220"] — слот скилла по id', '#battle-victory-hunt — «Охотиться дальше»', '#battle-mob-hp-val — HP моба «cur / max»',
               '#l2-hud-companion — кот (шапка «Активний слуга»)', '.l2-battle-hotbar-modal → .l2-battle-hotbar-tab[data-tab-key=consumable] → .l2-battle-hotbar-pick[title="Зілля мани (велика банка) ×150"] — окно слота',
               '#battle-back-map — «Назад на карту» (и посреди боя с РБ)'],
    'map': ['#map-mob-list a.l2-map-mob-link («★ Giant Fungus · ур. 40», модификаторы --champion, --raid)', '#map-mob-markers[data-l2-marker-sig] (типы champion/raid/epic_guard)',
            '#map-mob-page-next — пагинация (PAGE_SIZE 15)', 'spawnId l2dop_eg_* — миньоны эпика, l2dop_rb_* — РБ: не цели фарма'],
    'gm-shop': ['.l2-drops-shop-tab[data-category|data-grade|data-consumablesub]', '.l2-gm-shop-row--grade-d .l2-gm-shop-name',
                                       '#l2-drops-shop-buy-qty-modal [data-buy-qty-input] / [data-buy-qty-confirm]'],
    'fishing': ['.l2-fishing-hotbar-slot[data-slot=fishing|pumping|reeling|soulshot|basicBait|goodBait] (выбранное --toggle-on; счётчик невыбранной наживки = 0)',
                '#fishing-gear-row', '#fishing-target', '[data-action=open-rod-select] / #fishing-rod-select-list', '#fishing-shop-open / #fishing-starter-offers [data-offer]', '#fishing-spot-buy',
                'button.l2-fishing-trainer-learn-btn[data-skill]'],
    'char': ['.l2-char-bag-row[data-item-json]', 'img[data-l2-slot="weapon"]', '.l2-char-bag-equip--wear'],
    'hud': ['#l2-hud-active-buffs .l2-hud-active-buff[data-skill-id][data-expires-at][data-dur-ms][title] (title «… · Lv.3»)'],
}


def build_selectors():
    learn = K.base_profile()['learn']
    found = collections.defaultdict(lambda: {'refs': set()})
    for f in [x for x in CODE if x.startswith('modules') or x == 'content.js']:
        s = K.read(f)
        for m in LIT.finditer(s):
            t = next(g for g in m.groups() if g is not None)
            if len(t) < 3 or len(t) > 300 or '${' in t or not SELISH.match(t):
                continue
            if not re.search(r"#[a-z][\w-]+|\.l2-[\w-]+|\[data-[\w-]+|\.[a-z][\w-]*-[\w-]+", t) or OWN.search(t):
                continue
            ln = s.count('\n', 0, m.start()) + 1
            found[t]['refs'].add(f'{f}:{ln}')
    pages = collections.defaultdict(lambda: {'bot_selectors': [], 'learned_selectors': [], 'observed_tokens': [], 'claude_md': []})
    for sel, d in sorted(found.items()):
        pages[page_of(sel)]['bot_selectors'].append({'selector': sel, 'refs': sorted(d['refs'])[:8]})
    for pg, S in learn.get('sel', {}).items():
        for sel, st in sorted(S.items()):
            if OWN.search(sel):
                continue
            pages[pg]['learned_selectors'].append({'selector': sel, 'visits': st.get('v'), 'found': st.get('h'), 'missing': st.get('ms')})
    for pg, P in learn.get('pages', {}).items():
        pages[pg]['observed_tokens'] = sorted((P.get('tok') or {}).keys())
        pages[pg]['visits'] = P.get('n')
        if P.get('gone'):
            pages[pg]['tokens_gone'] = sorted(P['gone'])
        if P.get('neu'):
            pages[pg]['tokens_new'] = sorted(P['neu'])
    for pg, L in CLAUDE_SELECTORS.items():
        pages[pg]['claude_md'] = L
    out = {}
    for k in sorted(pages):
        v = pages[k]
        out[k] = {x: y for x, y in v.items() if y}
    return {
        'meta': K.meta('Разметка страниц игры, которую использует бот', [
            'строковые селекторы в content.js и modules/*.js (файл:строка)', 'base-profile.json learn.sel (селекторы автообучения по страницам: visits/found/missing)',
            'base-profile.json learn.pages[*].tok (все id/классы, которые бот видел на странице), gone/neu (пропавшие/новые)', 'CLAUDE.md «Разметка игры»'],
            'Ключи страниц двух видов: группы бота (battle, map, fishing…, по префиксам селекторов) и имена страниц автообучения (battle, map, city, char…). '
            'Ищите элементы по id/классам/data-атрибутам, не по тексту: интерфейс UA|RU, а серверные строки всегда украинские.'),
        'counts': {'pages': len(out), 'bot_selectors': sum(len(v.get('bot_selectors', [])) for v in out.values()),
                   'learned_selectors': sum(len(v.get('learned_selectors', [])) for v in out.values()),
                   'observed_tokens': sum(len(v.get('observed_tokens', [])) for v in out.values())},
        'pageKeys': {'battle': 'бой', 'map': 'карта/список мобов', 'fishing': 'рыбалка', 'fishing-shop': 'магазин рыбака', 'char': 'инвентарь /char.html', 'character': 'окно героя',
                     'gm-shop': 'магазин /gm-shop.html', 'rb-bosses': 'список РБ (и эпики — #epic-*)', 'teleport': 'Телепорт (Окрестности городов)', 'town-buffer': 'городской баффер и баффер FA',
                     'fast-aden-buffer': 'баффер FA', 'magister': 'магистр', 'tvt-arena': 'TvT', 'forum-farm-resources': 'форум «Фарм ресурсов»', 'forum-recipe-hunt': 'форум «Охота на рецепты»',
                     'dungeon': 'катакомбы/подземелье', 'quests': 'сюжетные квесты/кампания', 'hud': 'шапка всех страниц (HP/MP, баффы, кот, навигация)', 'misc': 'антибот, Cloudflare, прочее',
                     'city/index/mail/clan-*/item-transfer/skill-panel/magister-profession/human-mystic-second-profession-npc': 'страницы автообучения (только learned_selectors/observed_tokens)'},
        'urls': {'battle': '/battle.html?…', 'map': '/map.html', 'fishing': '/fishing.html', 'inventory': '/char.html', 'shop': '/gm-shop.html', 'rb': '/rb-bosses.html', 'epics': '/epic-bosses.html',
                 'magister_learned': '/magister.html?mode=learned', 'character': '/character.html', 'quests': '/character-quests.html', 'settings_lang': '/character-settings.html (UA|RU)',
                 'farm_forum': '/forum-farm-resources.html', 'recipe_forum': '/forum-recipe-hunt.html', 'catacombs': '/catacombs.html → /dungeon.html', 'town_buffer': '/town-buffer.html',
                 'fa_buffer': '/fast-aden-buffer.html', 'tvt': '/tvt-arena.html'},
        'pages': out,
    }


BUILDERS = {'api.json': build_api, 'selectors.json': build_selectors}


def main(names=None):
    res = {}
    for n, f in BUILDERS.items():
        if names and n not in names:
            continue
        o = f()
        p = K.write_json(n, o)
        res[n] = o.get('counts')
        print(f'{n}: {o.get("counts")}  → {os.path.relpath(p, K.REPO)}')
    return res


if __name__ == '__main__':
    main(sys.argv[1:] or None)

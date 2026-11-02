# python3 -I gen_elements.py <2Moons src dir> <out elements.json>
# Builds the GALAXYZ element catalog: REAL data from the saved ogamex.eu pages (tools/buildings/_real.json, written by
# extract-real.js) layered over upstream 2Moons (install/install.sql + language/*/TECH.php). Every field carries its source in e.src.
import re, json, sys, os

src, out = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
REAL = json.load(open(os.path.join(HERE, '_real.json'), encoding='utf-8'))
SQL_PATH = 'install/install.sql'
sql = open(os.path.join(src, SQL_PATH), encoding='utf-8').read()
lines = sql.split('\n')


def split_tuples(body):
    rows = []; i = 0; n = len(body)
    while i < n:
        if body[i] == '(':
            vals = []; cur = ''; i += 1; inq = False
            while True:
                c = body[i]
                if inq:
                    if c == '\\': cur += body[i + 1]; i += 2; continue
                    if c == "'":
                        if body[i + 1] == "'": cur += "'"; i += 2; continue
                        inq = False; i += 1; continue
                    cur += c; i += 1; continue
                if c == "'": inq = True; i += 1; continue
                if c == ',': vals.append(cur.strip()); cur = ''; i += 1; continue
                if c == ')': vals.append(cur.strip()); i += 1; break
                cur += c; i += 1
            rows.append(vals)
        elif body[i] == ';': break
        else: i += 1
    return rows


def conv(v):
    if v == 'NULL': return None
    try:
        f = float(v); return int(f) if f == int(f) and '.' not in v else f
    except ValueError:
        return v


def insert(table):
    m = re.search(r"INSERT INTO `%PREFIX%" + table + r"` \(([^)]*)\) VALUES\s*", sql)
    cols = [c.strip(' `') for c in m.group(1).split(',')]
    start = sql[:m.start()].count('\n') + 1
    return cols, split_tuples(sql[m.end():]), start


def line_of(start, prefix):
    for n in range(start, len(lines)):
        if lines[n].startswith(prefix): return n + 1
    return start


cols, rows, vline = insert('vars')
_, rf, rfline = insert('vars_rapidfire')
_, rq, rqline = insert('vars_requriements')
mig = open(os.path.join(src, 'install/migrations/migration_2.sql')).read()
mig_ids = set(int(x) for x in re.search(r'IN \(([^)]*)\)', mig).group(1).split(','))


def names(lang):
    t = open(f'{src}/language/{lang}/TECH.php', encoding='utf-8').read()
    blk = re.search(r"\$LNG\['tech'\]\s*=\s*array\((.*?)\n\);", t, re.S).group(1)
    return {int(a): b.replace("\\'", "'") for a, b in re.findall(r"(\d+)\s*=>\s*'((?:[^'\\]|\\.)*)'", blk)}


en = names('en'); ru = names('ru')
KIND = {0: 'building', 100: 'research', 200: 'ship', 400: 'defense', 500: 'missile', 600: 'officer', 700: 'dmfunc'}
BONUS = ['Attack', 'Defensive', 'Shield', 'BuildTime', 'ResearchTime', 'ShipTime', 'DefensiveTime', 'Resource', 'Energy', 'ResourceStorage',
         'ShipStorage', 'FlyTime', 'FleetSlots', 'Planets', 'SpyPower', 'Expedition', 'GateCoolTime', 'MoreFound']
U = lambda ln: f'UPSTREAM {SQL_PATH}:{ln}'

E = {}
for r in rows:
    d = {c: conv(v) for c, v in zip(cols, r)}
    for k in ['production901', 'production902', 'production903', 'production911', 'production921', 'storage901', 'storage902', 'storage903']:
        raw = r[cols.index(k)]; d[k] = None if raw == 'NULL' else raw
    eid = d['elementID']; ln = line_of(vline, f'({eid}, ')
    f = d['factor']
    cost = {str(k): d['cost' + str(k)] for k in (901, 902, 903, 911, 921) if d['cost' + str(k)]}
    e = {'id': eid, 'key': d['name'], 'kind': KIND[d['class']], 'name': en.get(eid), 'nameRu': ru.get(eid),
         'onPlanetType': [int(x) for x in str(d['onPlanetType']).split(',') if x], 'onePerPlanet': bool(d['onePerPlanet']),
         'factor': f, 'maxLevel': d['maxLevel'], 'cost': cost}
    s = {k: U(ln) for k in ('key', 'onPlanetType', 'onePerPlanet', 'factor', 'maxLevel', 'cost')}
    s['name'] = 'UPSTREAM language/en/TECH.php'; s['nameRu'] = 'UPSTREAM language/ru/TECH.php'
    if eid in mig_ids and f not in (1, 1.0):
        e['costNote'] = 'upstream migration_2.sql stores cost/factor; the price of level L is cost * factor^(L-1) (BuildFunctions.php:94-95)'
    if d['class'] in (200, 400, 500):
        e.update({'structure': d['cost901'] + d['cost902'], 'attack': d['attack'], 'shield': d['defend']})
        for k in ('structure', 'attack', 'shield'): s[k] = U(ln)
    if d['class'] == 200:
        e.update({'speed': d['speed1'], 'speed2': d['speed2'], 'speedTech': d['speedTech'], 'capacity': d['capacity'],
                  'consumption': d['consumption1'], 'consumption2': d['consumption2']})
        for k in ('speed', 'speed2', 'speedTech', 'capacity', 'consumption', 'consumption2'): s[k] = U(ln)
    b = {k: {'value': d['bonus' + k], 'unit': 'absolute' if d['bonus' + k + 'Unit'] else 'percent'} for k in BONUS if d['bonus' + k]}
    if b: e['bonus'] = b; s['bonus'] = U(ln)
    p = {k[-3:]: d[k] for k in ['production901', 'production902', 'production903', 'production911', 'production921'] if d[k]}
    if p: e['production'] = p; s['production'] = U(ln)
    st = {k[-3:]: d[k] for k in ['storage901', 'storage902', 'storage903'] if d[k]}
    if st: e['storage'] = st; s['storage'] = U(ln)
    e['requirements'] = {}; s['requirements'] = f'UPSTREAM {SQL_PATH}:{rqline}+'
    e['rapidfire'] = {'to': {}, 'from': {}}; s['rapidfire'] = f'UPSTREAM {SQL_PATH}:{rfline}+'
    e['src'] = s
    E[eid] = e
for a, b, c in rq: E[int(a)]['requirements'][str(int(b))] = int(c)
for a, b, c in rf:
    a, b, c = int(a), int(b), int(c)
    if a in E: E[a]['rapidfire']['to'][str(b)] = c
    if b in E: E[b]['rapidfire']['from'][str(a)] = c
upstreamReq = {k: dict(v['requirements']) for k, v in E.items()}

diffs = []   # every REAL value that differs from upstream


def real(eid, field, value, tag):
    e = E.get(eid)
    if e is None:
        e = E[eid] = {'id': eid, 'forkOnly': True, 'src': {}}
    old = e.get(field)
    if field in e and old is not None and old != value and not e.get('forkOnly'):
        diffs.append({'id': eid, 'field': field, 'upstream': old, 'real': value, 'src': tag})
        e.setdefault('upstreamValue', {})[field] = old
    e[field] = value; e['src'][field] = tag


# names, keys, order, where listed (REAL list pages)
pages = {}
for page in ('buildings', 'research', 'shipyard-fleet', 'shipyard-defense'):
    for pos, it in enumerate(REAL['list.' + page]):
        eid = it['id']
        real(eid, 'name', it['name'], f'REAL {page}.html')
        if page in ('buildings', 'research'): real(eid, 'key', it['cssKey'], f'REAL {page}.html div.icon class')
        pages.setdefault(eid, []).append(page)
        E[eid]['listedOn'] = {'page': page, 'position': pos}
        E[eid]['src']['listedOn'] = f'REAL {page}.html'
        if E[eid].get('forkOnly') and 'kind' not in E[eid]:
            E[eid]['kind'] = 'building' if page == 'buildings' else 'research' if page == 'research' else 'ship' if page == 'shipyard-fleet' else ('missile' if eid >= 500 else 'defense')
            E[eid]['src']['kind'] = f'REAL {page}.html'

# requirements + techtree tab (REAL techtree.html)
tabs = {}
for t in REAL['techtree']:
    eid = t['id']
    tabs.setdefault(eid, []).append(t['tab'])
    if not E.get(eid, {}).get('src', {}).get('name', '').startswith('REAL'): real(eid, 'name', t['name'], 'REAL techtree.html')
    req = {str(q['id']): q['need'] for q in t['reqs']}
    real(eid, 'requirements', req, 'REAL techtree.html')
for eid, tl in tabs.items():
    E[eid]['techtreeTabs'] = tl; E[eid]['src']['techtreeTabs'] = 'REAL techtree.html'

# ship/defense prices (REAL fleetDealer.html var CostInfo) - covers 202-220, 401-406, 410
for c in REAL['fleetDealer']['catalog']:
    real(c['id'], 'name', c['name'], E[c['id']]['src']['name'])
    real(c['id'], 'cost', {k: v for k, v in c['cost'].items()}, 'REAL fleetDealer.html var CostInfo')
    if E[c['id']].get('kind') in ('ship', 'defense', 'missile') and 'structure' in E[c['id']]:
        e = E[c['id']]; e['structure'] = e['cost'].get('901', 0) + e['cost'].get('902', 0)
        e['src']['structure'] = 'DERIVED metal+crystal of REAL cost (2Moons rule)'

# officers: name, key, max level (REAL officier.html)
for o in REAL['officier']:
    if o['id'] is None: continue
    real(o['id'], 'name', o['name'], 'REAL officier.html')
    real(o['id'], 'key', o['cssKey'], 'REAL officier.html div.officers100 class')
    real(o['id'], 'maxLevel', o['max'], 'REAL officier.html span.level "cur/max"')

# speed check against REAL fleetStep1 data (tech-adjusted). 208 impulse(117)=7 -> base*(1+0.2*7)
for sid, sd in REAL['fleetStep1']['ships'].items():
    e = E[int(sid)]
    e['realCheck'] = {'fleetStep1.speed': sd['speed'], 'fleetStep1.consumption': int(sd['consumption']),
                      'note': 'speed with Impulse Engine 7: 2500*(1+0.2*7)=6000 -> upstream base speed confirmed; consumption 1000 confirmed'}
    e['src']['speed'] = e['src']['consumption'] = 'UPSTREAM, CONFIRMED by REAL fleetStep1.html data.ships'
E[210]['realCheck'] = {'fleetTable.tooltip': 'Speed:  220000000', 'note': 'Combustion 12: 100000000*(1+0.1*12)=220000000 -> upstream base confirmed'}
E[210]['src']['speed'] = 'UPSTREAM, CONFIRMED by REAL fleetTable.html tooltip'

# buildings/research costs+factors: no real price is shown on list pages, but button.upgrade presence matched
# "price(level+1) <= stock" for all 35 items (verify-buyable.js), incl. borderline 14, 23, 24, 15, 31 -> factor^(L-1) rule confirmed
for x in REAL['list.buildings'] + REAL['list.research']:
    e = E[x['id']]
    if e.get('cost'):
        for k in ('cost', 'factor'): e['src'][k] += ', CONSISTENT with REAL buyable buttons (verify-buyable.js 35/35)'

# fork-only buildings 71-73: nothing but name/key/requirements is known
for eid in (71, 72, 73):
    e = E[eid]
    e.update({'onPlanetType': [1], 'cost': None, 'factor': None, 'maxLevel': None})
    e['src'].update({'onPlanetType': 'INFERRED listed on a planet (buildings.html); moon unknown',
                     'cost': 'UNKNOWN (fork-only; read TechnologyDetailsAjax .costs li.cost-item[data-base])',
                     'factor': 'UNKNOWN (TechnologyDetailsAjax .costs[data-factor])', 'maxLevel': 'UNKNOWN (.costs[data-max])'})
    e['note'] = 'Fork-only "conveyor" building, not in 2Moons. Effect unknown (name suggests shipyard production speed; requires Nanite+Shipyard).'

reqDiff = sorted(eid for eid in E if eid in upstreamReq and {k: v for k, v in E[eid].get('requirements', {}).items()} != upstreamReq[eid])
lists = {
    'buildings': [x['id'] for x in REAL['list.buildings']], 'research': [x['id'] for x in REAL['list.research']],
    'shipyardFleet': [x['id'] for x in REAL['list.shipyard-fleet']], 'shipyardDefense': [x['id'] for x in REAL['list.shipyard-defense']],
    'officers': [o['id'] for o in REAL['officier'] if o['id']],
    'moonBuildingsTab': [t['id'] for t in REAL['techtree'] if t['tab'] == 'Moon Buildings'],
    'upstreamAllowMoon': [k for k, v in E.items() if v.get('kind') == 'building' and 3 in (v.get('onPlanetType') or [])],
}
doc = {'_meta': {
    'generatedBy': 'specs/galaxyz/tools/buildings/gen_elements.py (input: _real.json from extract-real.js, upstream 2Moons)',
    'server': 'ogamex.eu/Aeternum, GALAXYZ 1.8.git (2Moons fork), English UI, saved 2026-10-30',
    'srcTags': {'REAL <page>.html': 'copied from the real saved page eu/pages/<page>.html',
                'UPSTREAM <file>:<line>': 'upstream 2Moons default (the fork keeps vars in the DB; admins may have changed it)',
                'DERIVED': 'computed from REAL values by an upstream rule', 'INFERRED': 'reasoned, not seen', 'UNKNOWN': 'no source'},
    'resources': {'901': 'Metal', '902': 'Crystal', '903': 'Deuterium', '911': 'Energy', '921': 'Dark Matter'},
    'formulas': {
        'buildingResearchPrice': 'price(level L) = cost * factor^(L-1), per resource, floored for display (UPSTREAM class.BuildFunctions.php:65-96); cost here = level-1 price',
        'unitPrice': 'ships/defense/missiles: cost * amount',
        'buildTime': 'hours = (metal+crystal) / (game_speed * (1 + robot14)) * 0.5^nanite15 * (1 + BuildTime bonus); ships use shipyard21 (UPSTREAM class.BuildFunctions.php:152-156)',
        'researchTime': 'hours = (metal+crystal) / (1000 * (1 + lab31 incl. IRN)) / (game_speed/2500) * (1 - factor_university/100)^university6 * (1 + ResearchTime bonus) (UPSTREAM :170)',
        'note': 'game_speed and factor_university are server config, not visible on any saved page; fleetStep1 data.gamespeed=7 is the FLEET speed only. Prefer times shown by the details AJAX.'},
    'lists': lists,
    'diffsFromUpstream': diffs,
    'requirementsDifferFromUpstream': reqDiff,
    'notes': [
        'Every element on a list page is shown, also those whose requirements are unmet (div.icon[data-status=off]); upstream hid them.',
        '220 Dark Matter Collector: REAL CostInfo is 100x cheaper than upstream (60000/70000/30000 vs 6M/7M/3M).',
        '407-409, 411, 502, 503: not in CostInfo (fleetDealer cannot scrap them) -> cost is UPSTREAM only.',
        '41-43 (moon) never appear on a saved list page (all saved pages are planets).',
        'Ship attack/shield/capacity/rapidfire: no real page shows them; UPSTREAM only.'],
}, 'elements': {str(k): E[k] for k in sorted(E)}}
json.dump(doc, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(E), 'elements; diffs:', [(d['id'], d['field']) for d in diffs], 'reqDiff:', reqDiff)
print('moon tab', lists['moonBuildingsTab'], 'upstream moon', lists['upstreamAllowMoon'])

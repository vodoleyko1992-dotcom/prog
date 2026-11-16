"""Собирает data/mobs.js из выгрузки droplist.php (jsonl): [eid, имя, ур., опыт, макс.HP, агро, x, y]."""
import json, re, sys
src, dst = sys.argv[1], sys.argv[2]
seen, rows = set(), []
for line in open(src, encoding='utf-8'):
    try: r = json.loads(line)
    except Exception: continue
    if r['eid'] in seen or not r.get('name'): continue
    seen.add(r['eid'])
    hp = re.search(r'макс\.\s*(\d+)', r.get('hp') or '') or re.match(r'(\d+)', r.get('hp') or '')
    exp = re.match(r'(\d+)', (r.get('exp') or '').replace(' ', ''))
    rows.append([r['eid'], r['name'], r['level'], int(exp.group(1)) if exp else 0, int(hp.group(1)) if hp else 0,
                 1 if (r.get('agro') or '').upper().startswith('ДА') else 0, r.get('x'), r.get('y')])
rows.sort()
with open(dst, 'w', encoding='utf-8') as f:
    f.write('/* База мобов l2mobi.pro (droplist.php): [eid, имя, уровень, опыт, макс.HP, агро, x, y]. Создано tools/mobdb.py. */\n')
    f.write('(function(r){r.L2MMobs=' + json.dumps(rows, ensure_ascii=False, separators=(',', ':')) + ';if(typeof module!=="undefined")module.exports=r.L2MMobs;})(typeof globalThis!=="undefined"?globalThis:this);\n')
print(len(rows))

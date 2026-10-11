import sys,re,json,glob
out={}
for f in sorted(glob.glob(sys.argv[1]+'/*l2bot-log-*.txt')):
    for line in open(f,encoding='utf8',errors='replace'):
        if '/game/spawn/' not in line or '"stats"' not in line: continue
        m=re.search(r'GET /game/spawn/([^/\s]+)/info',line)
        if not m: continue
        sid=m.group(1)
        j=line.find('ответ: {')
        if j<0: continue
        txt=line[j+7:]
        st=re.search(r'"stats":\{"maxHp":(\d+),"pAtk":(\d+),"pDef":(\d+),"mAtk":(\d+),"mDef":(\d+)\}',txt)
        if not st: continue
        name=re.search(r'"name":"([^"]+)"',txt); lvl=re.search(r'"level":(\d+)',txt); kind=re.search(r'"kind":"([^"]+)"',txt)
        ad=re.search(r'"kind":"adena","chance":([\d.]+),"min":(\d+),"max":(\d+)',txt)
        hp,pa,pd,ma,md=map(int,st.groups())
        rec={'hp':hp,'patk':pa,'pdef':pd,'matk':ma,'mdef':md,'name':name.group(1) if name else '','lvl':int(lvl.group(1)) if lvl else 0,'kind':kind.group(1) if kind else ''}
        if ad: rec['adena']=round((int(ad.group(2))+int(ad.group(3)))/2*float(ad.group(1)))
        out[sid]=rec
print(json.dumps(out,ensure_ascii=False,indent=0)[:200])
json.dump(out,open('rbstats.json','w'),ensure_ascii=False)
print(len(out), sorted((v['lvl'],v['name'],v['kind']) for v in out.values())[:80])

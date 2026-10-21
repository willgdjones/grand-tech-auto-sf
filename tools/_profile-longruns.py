# Lane D (gtasf-qvajw): pair with tools/_ready-profile.mjs OUT=...cpuprofile on an unminified build.
import json, sys, glob
# usage: longruns.py <cpuprofile> <app assets dir>  - busy runs (between idle samples) > 50 ms, top app functions by source region
p = json.load(open(sys.argv[1])); assets = sys.argv[2]
nodes = {n['id']: n for n in p['nodes']}; parent = {}
for n in p['nodes']:
    for c in n.get('children', []): parent[c] = n['id']
regions = {}
for f in glob.glob(assets + '/*.js'):
    lst = []
    for ln, line in enumerate(open(f, errors='ignore'), 1):
        if line.startswith('//#region '): lst.append((ln, line[10:].strip().split('GTASF/')[-1]))
    regions[f.split('/')[-1]] = lst
def region(file, line):
    r = file
    for ln, cur in regions.get(file, []):
        if ln <= line: r = cur
        else: break
    return r
def name(n):
    f = n['callFrame']; return f['functionName'] or '(anon)', f['url'].split('/')[-1], f['lineNumber'] + 1
t = 0; runs = []; cur = None
for i, sid in enumerate(p['samples']):
    dt = (p['timeDeltas'][i + 1] if i + 1 < len(p['timeDeltas']) else p['timeDeltas'][i]) / 1000
    if name(nodes[sid])[0] == '(idle)':
        if cur: runs.append(cur); cur = None
    else:
        if not cur: cur = {'start': t, 'dur': 0, 'samples': []}
        cur['dur'] += dt; cur['samples'].append((sid, dt))
    t += dt
if cur: runs.append(cur)
long = [r for r in runs if r['dur'] > 50]
print(len(runs), 'runs;', len(long), '>50ms; total long', round(sum(r['dur'] for r in long)), 'ms; max', round(max([r['dur'] for r in long] or [0])), 'ms')
for r in long:
    agg = {}
    for sid, dt in r['samples']:
        seen = set(); i = sid
        while i is not None and i in nodes:
            fn, file, line = name(nodes[i]); i = parent.get(i)
            if not file or 'three' in file or fn in ('(root)', '(program)'): continue
            k = f"{fn} [{region(file, line)}]"
            if k in seen: continue
            seen.add(k); agg[k] = agg.get(k, 0) + dt
    top = [x for x in sorted(agg.items(), key=lambda x: -x[1]) if not x[0].startswith(('loop ', 'tick ', 'render ', 'draw '))][:3]
    print(f"{r['start']:6.0f} ms {r['dur']:5.0f} ms  " + ' | '.join(f"{k} {v:.0f}" for k, v in top))

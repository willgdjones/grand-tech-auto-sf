"""gtasf-6w9a citywide LiDAR roof/height summary, STREAMED (laptop has ~30 GB free; full LAZ is 100-180 GB).

  tools/heavy.sh /tmp/claude-501/lidar-venv/bin/python tools/map/lidar/citywide.py --out tools/map/out/lidar \
      [--districts haight,mission,sunset,richmond] [--all] [--skip-depths 2] [--workers 4] [--limit N]

Per ~250 m tile (priority districts first, then the rest of SF):
  1. DataSF Building Footprints (ynuv-fyni) whose centroid falls in the tile.
  2. USGS 3DEP CA_SanFrancisco_1_B23 EPT nodes covering tile + 60 m margin, downloaded to MEMORY (never to disk),
     decoded, filtered, dropped. --skip-depths 2 stops two octree levels above full density (~9 pts/m2, ~16x less
     download): plenty for a 1 m roof grid. Hierarchy JSON is cached under <out>/hierarchy (small).
  3. 1 m max-height grid of single-return class-1 points (roofs; tree canopy is multi-return), 4 m ground grid.
  4. Per footprint: height, roof type (flat / flat-parapet / gable / stepped / pitched / complex) + shape params.
  5. Checkpoint: <out>/tiles/<ix>_<iz>.jsonl.gz written atomically; existing tiles are skipped (resumable).
`--merge` writes <out>/roofs.json (compact, for the map bake) from all finished tiles.
Coordinates in records are the game's map frame (ENU metres from 37.7842,-122.4078; +x east, -z north).
"""
import argparse, gzip, io, json, math, os, socket, ssl, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
import numpy as np, laspy
from pyproj import Transformer

# gtasf-6w9a: some Python builds (e.g. a uv-managed interpreter) ship no system CA bundle, so every HTTPS
# fetch dies with CERTIFICATE_VERIFY_FAILED and the whole stream makes no progress. Verify against certifi's
# bundle when it is installed; fall back to the default context otherwise.
try:
    import certifi
    SSL_CTX: "ssl.SSLContext | None" = ssl.create_default_context(cafile=certifi.where())
except Exception:
    SSL_CTX = None

# gtasf-6w9a: a hung EPT read once stalled the whole run at 0% CPU for ~1 h — urllib's per-call timeout
# does not bound a slow-trickle / half-open socket, and ThreadPoolExecutor.map() then waits forever on it.
# A global socket default timeout bounds EVERY socket op (connect/handshake/read); fetch_points below also
# puts a hard per-node future timeout on top and skips a node that still won't come, so one bad tile can
# never hang the stream. Tunable via LIDAR_HTTP_TIMEOUT.
REQUEST_TIMEOUT = float(os.environ.get('LIDAR_HTTP_TIMEOUT', '45'))
socket.setdefaulttimeout(REQUEST_TIMEOUT)

EPT = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SanFrancisco_1_B23/'
ORIGIN = (37.7842, -122.4078)
SF = (37.7080, -122.5150, 37.8120, -122.3570)            # south, west, north, east (land + margin)
TILE_LAT, TILE_LON = 0.00225, 0.00285                      # ~250 m x ~250 m
DISTRICTS = {                                              # south, west, north, east
    'haight': (37.7655, -122.4560, 37.7740, -122.4330),
    'mission': (37.7480, -122.4260, 37.7690, -122.4060),
    'sunset': (37.7360, -122.5100, 37.7650, -122.4600),
    'richmond': (37.7720, -122.5120, 37.7880, -122.4560),
    # Castro / Noe: the 'grey lot' blocks of gtasf-917l are rowhouses dropped by the coarse bake (gtasf-tdbw).
    'castro': (37.7480, -122.4420, 37.7660, -122.4260),
    # Marina: residential rowhouses for bake B's small-footprint boxes (gtasf-tdbw).
    'marina': (37.7980, -122.4450, 37.8070, -122.4250),
}
to3857 = Transformer.from_crs(4326, 3857, always_xy=True)
from3857 = Transformer.from_crs(3857, 4326, always_xy=True)

def enu(lat, lon):
    """Same WGS84 ECEF->ENU as web/src/radar/projection.ts (gridRotationDeg 0): returns (x east, z = -north)."""
    f = 1 / 298.257223563; e2 = f * (2 - f); r = math.pi / 180
    def ecef(la, lo):
        phi, lam = np.asarray(la) * r, np.asarray(lo) * r
        n = 6378137 / np.sqrt(1 - e2 * np.sin(phi) ** 2)
        return n * np.cos(phi) * np.cos(lam), n * np.cos(phi) * np.sin(lam), n * (1 - e2) * np.sin(phi)
    ax, ay, az = ecef(ORIGIN[0], ORIGIN[1]); bx, by, bz = ecef(lat, lon)
    dx, dy, dz = bx - ax, by - ay, bz - az
    phi, lam = ORIGIN[0] * r, ORIGIN[1] * r
    east = -math.sin(lam) * dx + math.cos(lam) * dy
    north = -math.sin(phi) * math.cos(lam) * dx - math.sin(phi) * math.sin(lam) * dy + math.cos(phi) * dz
    return east, -north

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT, context=SSL_CTX) as resp: return resp.read()
        except Exception:
            if i == tries - 1: raise
            time.sleep(2 * (i + 1))

class Hierarchy:
    def __init__(self, cache):
        self.cache = cache; os.makedirs(cache, exist_ok=True)
        self.ept = json.loads(get(EPT + 'ept.json')); self.b = self.ept['bounds']; self.files = {}
    def file(self, key):
        if key not in self.files:
            path = os.path.join(self.cache, key + '.json')
            if os.path.exists(path): self.files[key] = json.load(open(path))
            else:
                data = json.loads(get(EPT + 'ept-hierarchy/' + key + '.json'))
                tmp = path + '.tmp'; json.dump(data, open(tmp, 'w')); os.replace(tmp, path); self.files[key] = data
        return self.files[key]
    def nodes(self, x0, y0, x1, y1, max_depth):
        b = self.b; out = []; pending = ['0-0-0-0']
        while pending:
            for key, count in self.file(pending.pop()).items():
                d, x, y, z = map(int, key.split('-'))
                size = (b[3] - b[0]) / (2 ** d); nx, ny = b[0] + x * size, b[1] + y * size
                if nx > x1 or nx + size < x0 or ny > y1 or ny + size < y0: continue
                if count == -1:
                    if d < max_depth: pending.append(key)
                elif count > 0 and d <= max_depth: out.append(key)
        return out

def fetch_points(h, tile, margin_m, max_depth, workers):
    s, w, n, e = tile
    x0, y0 = to3857.transform(w, s); x1, y1 = to3857.transform(e, n)
    k = 1 / math.cos(math.radians((s + n) / 2)); mg = margin_m * k   # mercator metres per ground metre
    x0, y0, x1, y1 = x0 - mg, y0 - mg, x1 + mg, y1 + mg
    keys = h.nodes(x0, y0, x1, y1, max_depth)
    def one(key):
        las = laspy.read(io.BytesIO(get(EPT + 'ept-data/' + key + '.laz')))
        x, y = np.asarray(las.x), np.asarray(las.y)
        m = (x >= x0) & (x <= x1) & (y >= y0) & (y <= y1)
        return x[m], y[m], np.asarray(las.z)[m].astype(np.float32), np.asarray(las.classification)[m], np.asarray(las.number_of_returns)[m]
    # Download nodes in parallel but never block the whole tile on one slow node: each has a hard future
    # backstop (well above get()'s own bounded retries) and a node that still won't come is skipped. The
    # global socket timeout means a leaked worker's socket dies on its own, so shutdown need not wait on it.
    ex = ThreadPoolExecutor(workers)
    futs = [ex.submit(one, key) for key in keys]
    parts, skipped = [], 0
    for fut in futs:
        try: parts.append(fut.result(timeout=max(240.0, REQUEST_TIMEOUT * 5)))
        except Exception: skipped += 1
    ex.shutdown(wait=False, cancel_futures=True)
    if skipped: print(json.dumps({'tile_warn': 'skipped_nodes', 'skipped': skipped, 'of': len(keys)}), flush=True)
    if not parts: return None, len(keys)
    x, y, z, c, r = (np.concatenate([p[i] for p in parts]) for i in range(5))
    lon, lat = from3857.transform(x, y)
    ex, ez = enu(lat, lon)
    return (ex.astype(np.float32), ez.astype(np.float32), z, c, r), len(keys)

def footprints(tile):
    s, w, n, e = tile
    poly = f'POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))'
    q = urllib.parse.urlencode({'$where': f"intersects(shape,'{poly}')", '$limit': 5000})
    feats = json.loads(get('https://data.sfgov.org/resource/ynuv-fyni.geojson?' + q)).get('features', [])
    out = []
    for f in feats:
        g = f['geometry']; polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        outer = max((p[0] for p in polys), key=len)
        lon = np.array([p[0] for p in outer]); lat = np.array([p[1] for p in outer])
        if not (s <= lat.mean() < n and w <= lon.mean() < e): continue   # owned by the tile holding its centroid
        x, z = enu(lat, lon)
        out.append({'id': f['properties'].get('sf16_bldgid') or f['properties'].get('globalid'), 'x': np.asarray(x), 'z': np.asarray(z),
                    'ref': float(f['properties'].get('hgt_median_m') or 'nan')})
    return out

def inside(px, pz, rx, rz):
    c = np.zeros(px.shape, bool); j = len(rx) - 1
    for i in range(len(rx)):
        cond = ((rz[i] > pz) != (rz[j] > pz)) & (px < (rx[j] - rx[i]) * (pz - rz[i]) / (rz[j] - rz[i] + 1e-12) + rx[i])
        c ^= cond; j = i
    return c

def classify(fp, dsm, dsm_x0, dsm_z0, ground, gx0, gz0):
    rx, rz = fp['x'], fp['z']
    x0, x1, z0, z1 = int(math.floor(rx.min())), int(math.ceil(rx.max())), int(math.floor(rz.min())), int(math.ceil(rz.max()))
    i0, i1, j0, j1 = x0 - dsm_x0, x1 - dsm_x0, z0 - dsm_z0, z1 - dsm_z0
    if i0 < 0 or j0 < 0 or i1 > dsm.shape[0] or j1 > dsm.shape[1]: return None
    gi0, gi1 = max(0, (x0 - 12 - gx0) // 4), max(0, (x1 + 12 - gx0) // 4 + 1); gj0, gj1 = max(0, (z0 - 12 - gz0) // 4), max(0, (z1 + 12 - gz0) // 4 + 1)
    gwin = ground[gi0:gi1, gj0:gj1]; gvals = gwin[np.isfinite(gwin)]
    if gvals.size == 0: return None
    g = float(np.median(gvals))
    cx, cz = np.meshgrid(np.arange(x0, x1) + .5, np.arange(z0, z1) + .5, indexing='ij')
    win = dsm[i0:i1, j0:j1]; m = inside(cx, cz, rx, rz) & np.isfinite(win) & (win > g + 2.5)
    hs = np.sort(win[m] - g); px, pz = cx[m], cz[m]
    rec = {'id': fp['id'], 'cx': round(float(rx.mean()), 1), 'cz': round(float(rz.mean()), 1)}
    if hs.size < 10: rec['type'] = 'no-data'; return rec
    p10, p50, p95 = (float(hs[min(hs.size - 1, int(q * hs.size))]) for q in (.1, .5, .95))
    hist = {}
    for v in np.round(hs).astype(int): hist[v] = hist.get(v, 0) + 1
    tiers = []
    for v, c in sorted(hist.items(), key=lambda t: -t[1]):
        t = next((t for t in tiers if abs(t[0] - v) < 3), None)
        if t: t[1] += c
        else: tiers.append([v, c])
    big = sorted([t for t in tiers if t[1] >= .12 * hs.size], key=lambda t: -t[0])
    vals = win[m] - g; mx, mz = px.mean(), pz.mean()
    cov = np.cov(np.stack([px - mx, pz - mz])); axis = 0.5 * math.atan2(2 * cov[0, 1], cov[0, 0] - cov[1, 1])
    ux, uz = math.cos(axis), math.sin(axis); d = -(px - mx) * uz + (pz - mz) * ux
    def fit(sel):
        if sel.sum() < 8: return 0, 0, 1e9
        # gtasf-6w9a: a collinear/singular slope set makes polyfit's SVD not converge; one such footprint
        # must not abort the whole tile — treat it as flat (0 slope) and move on.
        try: b = np.polyfit(d[sel], vals[sel], 1)
        except Exception: return 0, 0, 1e9
        res = vals[sel] - np.polyval(b, d[sel])
        return math.degrees(math.atan(abs(b[0]))), np.sign(b[0]), float(np.sqrt((res ** 2).mean()))
    ls, ld, lr = fit(d < 0); rs, rd, rr = fit(d >= 0)
    gable = ls > 15 and rs > 15 and ld == -rd and ld != 0 and max(lr, rr) < 1.0
    if p95 - p10 < 1.5: t = 'flat'
    elif gable: t = 'gable'
    elif len(big) >= 2 and big[0][0] - big[-1][0] >= 3: t = 'stepped'
    elif len(big) == 1 and p95 - big[0][0] <= 3.5: t = 'flat-parapet'
    else: t = 'complex'
    r1 = lambda v: round(float(v), 1)
    rec.update(type=t, h=r1(p50), p95=r1(p95))
    if t == 'flat-parapet': rec.update(h=r1(big[0][0]), parapet=r1(p95))
    elif t == 'gable': rec.update(h=r1(hs[int(.25 * hs.size)]), ridge=r1(p95), axis=round(axis, 3))
    elif t == 'stepped':
        top = big[0][0]; up = vals >= top - 1.5
        a = (px[up] - mx) * ux + (pz[up] - mz) * uz; c = d[up]
        rec.update(h=r1(big[-1][0]), upper={'h': r1(top), 'x': r1(mx + (a.min() + a.max()) / 2 * ux - (c.min() + c.max()) / 2 * uz),
            'z': r1(mz + (a.min() + a.max()) / 2 * uz + (c.min() + c.max()) / 2 * ux), 'l': r1(a.max() - a.min() + 1), 'w': r1(c.max() - c.min() + 1), 'axis': round(axis, 3)})
    if math.isfinite(fp['ref']): rec['ref'] = r1(fp['ref'])
    return rec

def process_tile(h, tile, args):
    fps = footprints(tile)
    if not fps: return [], 0, 0
    pts, nodes = fetch_points(h, tile, 60, args.max_depth, args.workers)
    if pts is None: return [], nodes, 0
    x, z, y, c, r = pts
    x0, z0 = int(math.floor(x.min())), int(math.floor(z.min()))
    nx, nz = int(math.ceil(x.max())) - x0 + 1, int(math.ceil(z.max())) - z0 + 1
    roof = (c == 1) & (r == 1)
    dsm = np.full((nx, nz), -np.inf, np.float32)
    np.maximum.at(dsm, ((x[roof] - x0).astype(int), (z[roof] - z0).astype(int)), y[roof])
    dsm[~np.isfinite(dsm)] = np.nan
    gm = c == 2; gnx, gnz = nx // 4 + 1, nz // 4 + 1
    ground = np.full((gnx, gnz), np.inf, np.float32)
    np.minimum.at(ground, (((x[gm] - x0) // 4).astype(int), ((z[gm] - z0) // 4).astype(int)), y[gm])
    ground[~np.isfinite(ground)] = np.nan
    recs = [rec for rec in (classify(fp, dsm, x0, z0, ground, x0, z0) for fp in fps) if rec]
    return recs, nodes, int(x.size)

def tiles(selected, all_):
    lat_n = int(math.ceil((SF[2] - SF[0]) / TILE_LAT)); lon_n = int(math.ceil((SF[3] - SF[1]) / TILE_LON))
    def box(i, j): return (SF[0] + i * TILE_LAT, SF[1] + j * TILE_LON, SF[0] + (i + 1) * TILE_LAT, SF[1] + (j + 1) * TILE_LON)
    order, seen = [], set()
    for name in selected:
        s, w, n, e = DISTRICTS[name]
        for i in range(lat_n):
            for j in range(lon_n):
                b = box(i, j)
                if b[0] < n and b[2] > s and b[1] < e and b[3] > w and (i, j) not in seen: seen.add((i, j)); order.append((i, j, b))
    if all_:
        for i in range(lat_n):
            for j in range(lon_n):
                if (i, j) not in seen: seen.add((i, j)); order.append((i, j, box(i, j)))
    return order

def merge(out):
    recs = []
    for name in sorted(os.listdir(os.path.join(out, 'tiles'))):
        if name.endswith('.jsonl.gz'):
            with gzip.open(os.path.join(out, 'tiles', name), 'rt') as f: recs += [json.loads(l) for l in f if l.strip()]
    recs = [r for r in recs if r.get('type') not in (None, 'no-data')]
    path = os.path.join(out, 'roofs.json'); json.dump({'version': 1, 'source': 'USGS 3DEP CA_SanFrancisco_1_B23 + DataSF ynuv-fyni', 'buildings': recs}, open(path, 'w'), separators=(',', ':'))
    print(json.dumps({'merged': len(recs), 'bytes': os.path.getsize(path)}))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='tools/map/out/lidar'); ap.add_argument('--districts', default='haight,castro,mission,sunset,richmond')
    ap.add_argument('--all', action='store_true'); ap.add_argument('--skip-depths', type=int, default=2); ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--limit', type=int, default=0); ap.add_argument('--merge', action='store_true')
    args = ap.parse_args()
    os.makedirs(os.path.join(args.out, 'tiles'), exist_ok=True)
    if args.merge: return merge(args.out)
    h = Hierarchy(os.path.join(args.out, 'hierarchy'))
    full = max(int(k.split('-')[0]) for k in h.file('0-0-0-0'))  # root file depth; deeper levels live in subtree files
    args.max_depth = 64 if args.skip_depths <= 0 else None
    done = 0
    for i, j, tile in tiles([d for d in args.districts.split(',') if d], args.all):
        path = os.path.join(args.out, 'tiles', f'{i}_{j}.jsonl.gz')
        if os.path.exists(path): continue
        if args.max_depth is None:
            # Deepest level present over this tile, minus --skip-depths (full density ~145 pts/m2 -> ~9 at skip 2).
            s, w, n, e = tile; x0, y0 = to3857.transform(w, s); x1, y1 = to3857.transform(e, n)
            deepest = max([int(k.split('-')[0]) for k in h.nodes(x0, y0, x1, y1, 64)] or [0])
            depth = max(0, deepest - args.skip_depths)
        else: depth = args.max_depth
        t0 = time.time()
        try:
            saved = args.max_depth; args.max_depth = depth
            recs, nodes, npts = process_tile(h, tile, args)
            args.max_depth = saved
        except Exception as ex:
            print(json.dumps({'tile': f'{i}_{j}', 'error': str(ex)[:200]}), flush=True); args.max_depth = saved; continue
        tmp = path + '.tmp'
        with gzip.open(tmp, 'wt') as f:
            for rec in recs: f.write(json.dumps(rec, separators=(',', ':')) + '\n')
        os.replace(tmp, path)
        done += 1
        print(json.dumps({'tile': f'{i}_{j}', 'depth': depth, 'nodes': nodes, 'points': npts, 'buildings': len(recs), 'seconds': round(time.time() - t0, 1)}), flush=True)
        if args.limit and done >= args.limit: break

if __name__ == '__main__': main()

"""gtasf-6w9a: fetch USGS 3DEP LiDAR points for a small lat/lon box from the public Entwine (EPT) index.

  python ept_fetch.py <name> <south> <west> <north> <east> [--out DIR] [--dataset CA_SanFrancisco_1_B23]

Walks the EPT octree hierarchy, downloads only nodes whose bounds intersect the box (all depths, so full density),
decodes LAZ with laspy[lazrs], keeps points inside the box, and writes <out>/<name>.npz with x, y (EPSG:3857 metres),
z (metres), cls (ASPRS classification: 2 ground, 6 building), nret (returns per pulse). Prints node/byte/point counts and timing.
"""
import io, json, sys, time, urllib.request, argparse
import numpy as np, laspy
from pyproj import Transformer

BASE = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public/'

def get(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('name'); ap.add_argument('south', type=float); ap.add_argument('west', type=float)
    ap.add_argument('north', type=float); ap.add_argument('east', type=float)
    ap.add_argument('--out', default='.'); ap.add_argument('--dataset', default='CA_SanFrancisco_1_B23')
    a = ap.parse_args()
    root = BASE + a.dataset + '/'
    ept = json.loads(get(root + 'ept.json'))
    to3857 = Transformer.from_crs(4326, 3857, always_xy=True)
    x0, y0 = to3857.transform(a.west, a.south); x1, y1 = to3857.transform(a.east, a.north)
    b = ept['bounds']  # cubic octree bounds: minx, miny, minz, maxx, maxy, maxz
    def node_bounds(d, x, y, z):
        size = (b[3] - b[0]) / (2 ** d)
        return b[0] + x * size, b[1] + y * size, b[0 + 0] and b[2] + z * size, size
    keys, hierarchy_files, t0 = [], ['0-0-0-0'], time.time()
    while hierarchy_files:
        h = json.loads(get(root + 'ept-hierarchy/' + hierarchy_files.pop() + '.json'))
        for key, count in h.items():
            d, x, y, z = map(int, key.split('-'))
            size = (b[3] - b[0]) / (2 ** d)
            nx0, ny0 = b[0] + x * size, b[1] + y * size
            if nx0 > x1 or nx0 + size < x0 or ny0 > y1 or ny0 + size < y0: continue
            if count == -1: hierarchy_files.append(key)
            elif count > 0: keys.append(key)
    xs, ys, zs, cs, rs, nbytes = [], [], [], [], [], 0
    for key in keys:
        raw = get(root + 'ept-data/' + key + '.laz'); nbytes += len(raw)
        las = laspy.read(io.BytesIO(raw))
        x, y = np.asarray(las.x), np.asarray(las.y)
        m = (x >= x0) & (x <= x1) & (y >= y0) & (y <= y1)
        xs.append(x[m]); ys.append(y[m]); zs.append(np.asarray(las.z)[m]); cs.append(np.asarray(las.classification)[m])
        rs.append(np.asarray(las.number_of_returns)[m])
    x, y, z, c, r = (np.concatenate(v) if v else np.zeros(0) for v in (xs, ys, zs, cs, rs))
    # nret: number of returns per pulse; roofs are single-return, tree canopy multi-return (vegetation filter).
    np.savez_compressed(f'{a.out}/{a.name}.npz', x=x, y=y, z=z, cls=c, nret=r)
    area = (x1 - x0) * (y1 - y0) * (np.cos(np.radians((a.south + a.north) / 2)) ** 2)  # mercator scale -> ground m2
    print(json.dumps({'name': a.name, 'nodes': len(keys), 'downloadMB': round(nbytes / 1e6, 1), 'points': int(len(x)),
      'buildingPts': int((c == 6).sum()), 'groundPts': int((c == 2).sum()), 'areaM2': round(area), 'ptsPerM2': round(len(x) / max(area, 1), 1),
      'seconds': round(time.time() - t0, 1)}))

if __name__ == '__main__': main()

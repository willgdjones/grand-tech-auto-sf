"""gtasf-6w9a: npz (EPSG:3857) -> <name>.bin of float64 [lon, lat, z, cls, nret] rows for the TS roof prototype."""
import sys, numpy as np
from pyproj import Transformer
src = sys.argv[1]; d = np.load(src)
lon, lat = Transformer.from_crs(3857, 4326, always_xy=True).transform(d['x'], d['y'])
nret = d['nret'] if 'nret' in d.files else np.ones(len(lon))
np.stack([lon, lat, d['z'], d['cls'].astype(np.float64), nret.astype(np.float64)], axis=1).astype('<f8').tofile(src.replace('.npz', '.bin'))
print(src.replace('.npz', '.bin'), len(lon))

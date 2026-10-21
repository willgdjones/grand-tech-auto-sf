import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * gtasf-7vt00 (lane D): standard gzip, but as small as the host allows. On the published road graph, macOS's
 * /usr/bin/gzip -9 (Apple gzip 479) is ~21 % smaller than node zlib level 9 on the SAME bytes (roadgraph.bin
 * 10.91 -> 8.65 MB), still plain RFC 1952 that every browser/CDN inflates. Chunk files gain only ~1 %, so this is
 * used for the road graphs. `-n` omits name/timestamp, so the output is deterministic for given bytes on a host.
 * Every candidate is round-trip checked (gunzip must reproduce the input exactly); the smaller valid one wins, and
 * node zlib level 9 is always the fallback (other hosts, or MAP_STRONG_GZIP=0).
 */
export function strongGzip(bytes: Uint8Array): Buffer {
  const zlib = gzipSync(bytes, { level: 9 });
  if (process.env.MAP_STRONG_GZIP === '0' || !existsSync('/usr/bin/gzip')) return zlib;
  const run = spawnSync('/usr/bin/gzip', ['-9', '-n', '-c'], { input: bytes, maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0 || !run.stdout?.length) return zlib;
  const candidate = Buffer.from(run.stdout);
  try { if (!Buffer.from(gunzipSync(candidate)).equals(Buffer.from(bytes))) return zlib; } catch { return zlib; }
  return candidate.length < zlib.length ? candidate : zlib;
}

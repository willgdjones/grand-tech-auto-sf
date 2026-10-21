/** Copied from BDTS shared/net/reservedIp.ts; original bounded address parser retained.
 * §9.3.1 / R1-090: private and special-purpose address ranges a link check must never fetch. An address
 * embedding IPv4 (::ffff:0:0/96, 64:ff9b::/96, 2002::/16) is judged by the embedded IPv4.
 */

export type ParsedIp =
  { readonly family: 4; readonly bytes: Uint8Array } | { readonly family: 6; readonly bytes: Uint8Array };

/** Strict dotted-quad: four decimal octets, no leading zeros (DoH answers are canonical). */
export function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (const [i, part] of parts.entries()) {
    if (!/^(0|[1-9][0-9]{0,2})$/u.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[i] = value;
  }
  return bytes;
}

/** RFC 4291 text forms, including `::` compression and a trailing dotted IPv4; no zone ids. */
export function parseIpv6(text: string): Uint8Array | null {
  if (!/^[0-9a-fA-F:.]+$/u.test(text) || text.length > 45) return null;
  const double = text.indexOf('::');
  if (double !== text.lastIndexOf('::')) return null;
  const words: number[] = [];
  const parseSide = (side: string, allowIpv4: boolean): number[] | null => {
    if (side === '') return [];
    const groups = side.split(':');
    const out: number[] = [];
    for (const [i, group] of groups.entries()) {
      if (allowIpv4 && i === groups.length - 1 && group.includes('.')) {
        const v4 = parseIpv4(group);
        if (!v4) return null;
        out.push(((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0));
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/u.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  if (double === -1) {
    const all = parseSide(text, true);
    if (!all || all.length !== 8) return null;
    words.push(...all);
  } else {
    const head = parseSide(text.slice(0, double), false);
    const tail = parseSide(text.slice(double + 2), true);
    if (!head || !tail || head.length + tail.length > 7) return null;
    words.push(...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail);
  }
  const bytes = new Uint8Array(16);
  for (const [i, word] of words.entries()) {
    bytes[2 * i] = word >> 8;
    bytes[2 * i + 1] = word & 0xff;
  }
  return bytes;
}

export function parseIp(text: string): ParsedIp | null {
  const v4 = parseIpv4(text);
  if (v4) return { family: 4, bytes: v4 };
  const v6 = parseIpv6(text);
  return v6 ? { family: 6, bytes: v6 } : null;
}

type Range = readonly [prefix: readonly number[], bits: number];

const IPV4_RESERVED: readonly Range[] = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

const words = (...w: number[]) => w.flatMap((x) => [x >> 8, x & 0xff]);
const IPV6_RESERVED: readonly Range[] = [
  [words(0, 0, 0, 0, 0, 0, 0, 0), 128], // ::/128
  [words(0, 0, 0, 0, 0, 0, 0, 1), 128], // ::1/128
  [words(0x100, 0, 0, 0), 64], // 100::/64 discard-only
  [words(0x2001, 0xdb8), 32], // documentation
  [words(0x3fff), 20], // documentation (RFC 9637)
  [words(0x2001), 23], // IETF protocol assignments, incl. Teredo 2001::/32
  [words(0x64, 0xff9b, 1), 48], // local-use NAT64
  [words(0xfc00), 7], // unique local
  [words(0xfe80), 10], // link-local
  [words(0xfec0), 10], // site-local (deprecated)
  [words(0xff00), 8], // multicast
];

function inRange(bytes: Uint8Array, [prefix, bits]: Range): boolean {
  for (let bit = 0; bit < bits; bit++) {
    const byte = bit >> 3;
    const mask = 0x80 >> (bit & 7);
    if (((bytes[byte] ?? 0) & mask) !== ((prefix[byte] ?? 0) & mask)) return false;
  }
  return true;
}

function reservedV4(bytes: Uint8Array): boolean {
  return IPV4_RESERVED.some((range) => inRange(bytes, range));
}

/** Private or reserved (the embedded IPv4 decides mapped, NAT64 and 6to4 addresses). */
export function isReservedIp(text: string): boolean {
  const ip = parseIp(text);
  if (!ip) return true; // an answer we cannot read is never treated as public
  if (ip.family === 4) return reservedV4(ip.bytes);
  const b = ip.bytes;
  if (inRange(b, [words(0, 0, 0, 0, 0, 0xffff), 96]) || inRange(b, [words(0x64, 0xff9b, 0, 0, 0, 0), 96]))
    return reservedV4(b.slice(12, 16));
  if (inRange(b, [words(0x2002), 16])) return reservedV4(b.slice(2, 6));
  return IPV6_RESERVED.some((range) => inRange(b, range));
}

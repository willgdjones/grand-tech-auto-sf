export const SF_TIME_ZONE = 'America/Los_Angeles';

/** Parses explicit date+time only. Rejects date-only, rollover and DST gaps/ambiguities. */
export function toInstant(value: string | undefined, timeZone = SF_TIME_ZONE): string | null {
  const m = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [number, number, number, number, number, number];
  const ms = Number((m[7] ?? '').padEnd(3, '0'));
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const d = new Date(wall);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59) return null;
  if (m[8]) {
    const zone = m[8].toUpperCase();
    if (zone !== 'Z') {
      const parts = zone.slice(1).replace(':', '');
      if (Number(parts.slice(0, 2)) > 23 || Number(parts.slice(2)) > 59) return null;
    }
    const instant = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}.${String(ms).padStart(3, '0')}${zone}`);
    return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const localEpoch = (instant: number): number => {
      const p = Object.fromEntries(fmt.formatToParts(instant).map(({ type, value: v }) => [type, v]));
      return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    };
    const matches = new Set<number>();
    for (const offset of [-86_400_000, 0, 86_400_000]) {
      const probe = wall - ms + offset;
      const candidate = wall - (localEpoch(probe) - probe);
      if (localEpoch(candidate) === wall - ms) matches.add(candidate);
    }
    return matches.size === 1 ? new Date([...matches][0]!).toISOString() : null;
  } catch { return null; }
}

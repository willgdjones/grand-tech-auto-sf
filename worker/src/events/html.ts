const ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (full, key: string) => {
    if (!key.startsWith('#')) return ENTITIES[key.toLowerCase()] ?? full;
    const code = key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�';
  });
}

export function plainText(html: string): string {
  return decodeEntities(html.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export interface HtmlTag { name: string; attrs: Record<string, string>; body: string; index: number }

/** Small non-executing extractor for anchors/meta/raw JSON scripts, not a DOM renderer. */
export function tags(html: string): HtmlTag[] {
  const result: HtmlTag[] = [];
  const pattern = /<!--[^]*?-->|<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  for (let m = pattern.exec(html); m; m = pattern.exec(html)) {
    if (!m[1]) continue;
    const name = m[1].toLowerCase();
    const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const a of (m[2] ?? '').matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const key = a[1]!.toLowerCase();
      if (!(key in attrs)) attrs[key] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    }
    let body = '';
    if (name === 'script' || name === 'style') {
      const end = new RegExp(`</${name}\\s*>`, 'gi');
      end.lastIndex = pattern.lastIndex;
      const close = end.exec(html);
      if (close) {
        body = html.slice(pattern.lastIndex, close.index);
        pattern.lastIndex = end.lastIndex;
      }
    }
    result.push({ name, attrs, body, index: m.index });
  }
  return result;
}

export function jsonValue(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
export function number(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return undefined;
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

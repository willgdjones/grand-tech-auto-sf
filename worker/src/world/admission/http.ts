export function admissionJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
/** Bound the actual stream, not only the optional Content-Length header. */
export async function smallJson(request: Request, maximum = 2048): Promise<Record<string, unknown> | undefined> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') return undefined;
  if (!request.body || Number(request.headers.get('content-length') ?? 0) > maximum) return undefined;
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) { await reader.cancel(); return undefined; }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}
export function secretToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

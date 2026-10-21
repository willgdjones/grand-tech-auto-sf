import { createHash, createHmac } from 'node:crypto';
import { Agent, request } from 'node:https';
import type { PublishedObject } from './publication';

/**
 * Single-process R2 upload over the S3 API (gtasf-o0cb): one keep-alive connection pool with bounded
 * concurrency, instead of one `wrangler` child per object. The whole-city release is ~7600 objects; the
 * old per-file wrangler spawn (node + CLI startup each) collapsed the laptop (load > 600). SigV4 is
 * hand-rolled so this needs no SDK/dependency. Credentials come from the environment, never code:
 *   R2_S3_ACCESS_KEY_ID, R2_S3_SECRET_ACCESS_KEY  (an R2 "Object Read & Write" API token).
 */
export interface R2Target { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }

export function r2Credentials(accountId: string, bucket: string): R2Target {
  const accessKeyId = process.env.R2_S3_ACCESS_KEY_ID, secretAccessKey = process.env.R2_S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) throw new Error('Set R2_S3_ACCESS_KEY_ID and R2_S3_SECRET_ACCESS_KEY (an R2 S3 API token) to upload');
  return { endpoint: `https://${accountId}.r2.cloudflarestorage.com`, region: 'auto', bucket, accessKeyId, secretAccessKey };
}

const sha256hex = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

type Method = 'HEAD' | 'PUT';
const ATTEMPTS = 3, REQUEST_TIMEOUT_MS = 30_000;

function sign(target: R2Target, method: Method, key: string, body: Buffer, extra: Record<string, string>): { path: string; headers: Record<string, string | number> } {
  const host = new URL(target.endpoint).host;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);
  // Path-style: /<bucket>/<key>, each path segment percent-encoded, '/' preserved as separators.
  const path = '/' + [target.bucket, ...key.split('/')].map(s => encodeURIComponent(s)).join('/');
  const signed: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map(n => `${n}:${signed[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${target.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(Buffer.from(canonicalRequest))].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + target.secretAccessKey, dateStamp), target.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${target.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { path, headers: { ...signed, authorization, 'content-length': body.length, ...extra } };
}

class HttpError extends Error {
  constructor(method: Method, key: string, readonly status: number, detail: string) {
    super(`${method} ${key} -> ${status}: ${detail}`);
  }
}

function transient(error: unknown): boolean {
  if (error instanceof HttpError) return error.status >= 500 && error.status < 600 || error.status === 408 || error.status === 429;
  const networkError = error as NodeJS.ErrnoException | undefined;
  const code = networkError?.code;
  return typeof code === 'string' && (
    ['ECONNRESET', 'ECONNABORTED', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)
    || code.startsWith('ERR_SSL_') && /BAD_RECORD_MAC/.test(code)
    || code === 'EPROTO' && /bad[ _]record[ _]mac/i.test(networkError?.message ?? '')
  );
}

/** A deadline covers the entire request, including a stalled response body. */
function send(agent: Agent, target: R2Target, method: Method, object: PublishedObject, body: Buffer): Promise<number> {
  const extra: Record<string, string> = method === 'PUT'
    ? { 'content-type': object.contentType, 'content-encoding': object.contentEncoding, 'cache-control': object.cacheControl } : {};
  const { path, headers } = sign(target, method, object.key, body, extra);
  const endpoint = new URL(target.endpoint);
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => { clearTimeout(timer); reject(error); };
    const req = request({ method, hostname: endpoint.hostname, port: endpoint.port || 443, path, agent, headers }, res => {
      let detail = '';
      res.on('data', (d: Buffer) => { if (detail.length < 300) detail += d.toString().slice(0, 300 - detail.length); });
      res.on('error', fail);
      res.on('aborted', () => fail(Object.assign(new Error(`${method} ${object.key}: response aborted`), { code: 'ECONNRESET' })));
      res.on('end', () => {
        clearTimeout(timer);
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300 || method === 'HEAD' && status === 404) resolve(status);
        else reject(new HttpError(method, object.key, status, detail));
      });
    });
    const timer = setTimeout(() => {
      req.destroy(Object.assign(new Error(`${method} ${object.key}: request timed out`), { code: 'ETIMEDOUT' }));
    }, REQUEST_TIMEOUT_MS);
    req.on('error', fail);
    req.end(body);
  });
}

async function retry(agent: Agent, target: R2Target, method: Method, object: PublishedObject, body: Buffer): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try { return await send(agent, target, method, object, body); }
    catch (error) {
      if (attempt >= ATTEMPTS || !transient(error)) throw error;
      console.warn(`${method} ${object.key}: transient failure, retry ${attempt + 1}/${ATTEMPTS}`);
      await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
}

/** Resume only content-addressed release objects; always PUT the stable alias alone last. */
export async function uploadToR2(target: R2Target, objects: PublishedObject[], read: (object: PublishedObject) => Promise<Buffer>, concurrency = 16): Promise<void> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Upload concurrency must be a positive integer');
  if (!objects.length) throw new Error('Map publication must include a stable alias');
  const agent = new Agent({ keepAlive: true, maxSockets: concurrency });
  const release = objects.slice(0, -1), alias = objects.at(-1)!;
  let next = 0, done = 0, skipped = 0, failed = false;
  const one = async (object: PublishedObject, canSkip: boolean) => {
    // The caller rechecks its snapshot hash here, even when a remote object will be skipped.
    const body = await read(object);
    if (canSkip && /^map\/releases\/[a-f0-9]{64}\/.+$/.test(object.key)
      && await retry(agent, target, 'HEAD', object, Buffer.alloc(0)) !== 404) { skipped++; return; }
    await retry(agent, target, 'PUT', object, body);
  };
  const worker = async () => {
    try {
      while (!failed && next < release.length) {
        await one(release[next++]!, true);
        if (++done % 500 === 0) console.log(`completed ${done}/${release.length} (${skipped} already uploaded)`);
      }
    } catch (error) { failed = true; throw error; }
  };
  try {
    // Drain in-flight workers before closing the pool; a failed worker starts no more objects.
    const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, release.length) }, worker));
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    await one(alias, false); // interrupted release uploads leave the previous alias live
    console.log(`uploaded ${release.length - skipped} release objects + alias; ${skipped} already uploaded`);
  } finally { agent.destroy(); }
}

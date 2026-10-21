/** Short-lived review proxy: current dev app/Worker, isolated validated map and kerbs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, request as upstreamRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { resolve, sep } from 'node:path';
import { createLocalMapMiddleware } from '../../web/mapLocalPlugin';

const root = resolve('tools/map/out/district-tm7m');
const artRoot = resolve(root, 'art');
const port = 5197, upstreamPort = 5173;
const report = JSON.parse(await readFile(resolve(root, 'district-rollout.json'), 'utf8'));
const manifest = await readFile(resolve(root, 'manifest.json'));
assert.equal(createHash('sha256').update(manifest).digest('hex'), report.manifestSha256, 'Candidate must match its validated manifest');
const kerbs = JSON.parse(await readFile(resolve(root, 'district-roads-smoke.json'), 'utf8'));
assert(kerbs.passed && !kerbs.checkOnly && kerbs.mapRoot === root && kerbs.artRoot === artRoot, 'Generate the paired candidate art tree first');
const upstream = await fetch(`http://127.0.0.1:${upstreamPort}/`, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
assert(upstream.ok, 'The existing dev app must be running on port 5173');
const map = createLocalMapMiddleware(root);

function proxy(req: IncomingMessage, res: ServerResponse) {
  const target = upstreamRequest({ hostname: '127.0.0.1', port: upstreamPort, path: req.url,
    method: req.method, headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` } }, response => {
    res.writeHead(response.statusCode ?? 502, response.headers);
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  target.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Dev app unavailable'); });
  req.on('aborted', () => target.destroy());
  res.on('close', () => target.destroy());
  req.pipe(target);
}

async function serve(req: IncomingMessage, res: ServerResponse) {
  const pathname = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  if (pathname === '/art/road-details.json' || pathname.startsWith('/art/district-roads/')) {
    const path = resolve(artRoot, pathname.slice('/art/'.length));
    if (!path.startsWith(artRoot + sep) || !path.endsWith('.json')) { res.writeHead(403).end(); return; }
    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error('Not a file');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': info.size, 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') res.end();
      else createReadStream(path).on('error', () => res.destroy()).pipe(res);
    } catch { res.writeHead(404).end('Candidate art missing'); }
    return;
  }
  await map(req, res, () => proxy(req, res));
}

const sockets = new Set<Socket>();
const server = createServer((req, res) => {
  void serve(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end('Candidate preview request failed'); });
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
// Forward both the game's Worker websocket and Vite's existing HMR connection.
server.on('upgrade', (req, socket, head) => {
  const target = connect(upstreamPort, '127.0.0.1', () => {
    const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]!;
      lines.push(`${name}: ${name.toLowerCase() === 'host' ? `127.0.0.1:${upstreamPort}` : req.rawHeaders[i + 1]!}`);
    }
    target.write(lines.join('\r\n') + '\r\n\r\n');
    if (head.length) target.write(head);
    socket.pipe(target).pipe(socket);
  });
  target.on('error', () => socket.destroy());
  socket.on('error', () => target.destroy());
  socket.on('close', () => target.destroy());
});
function stop() { server.close(); for (const socket of sockets) socket.destroy(); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
server.listen(port, '127.0.0.1', () => console.log(`Candidate review: http://127.0.0.1:${port}/ — map ${report.manifestSha256}; active dev map untouched`));

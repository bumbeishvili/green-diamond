// Local stand-in for Vercel: serves the game and runs the functions in api/ with an in-memory
// store, so multiplayer can be tried with a few browser tabs and no account.
//
//   npm run dev                  http://127.0.0.1:8787
//   PORT=9000 API_DELAY=120 node tools/dev.mjs     (API_DELAY: ms added to every API call)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { useMemoryStore } from '../api/_lib/store.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DELAY = +(process.env.API_DELAY || 0);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

const store = useMemoryStore();
const handlers = new Map();
async function handler(name) {
  if (!handlers.has(name)) handlers.set(name, import(pathToFileURL(join(ROOT, 'api', `${name}.js`)).href).then((m) => m.default));
  return handlers.get(name);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    const api = url.pathname.match(/^\/api\/([a-z]+)$/);
    if (api) {
      const h = await handler(api[1]).catch(() => null);
      if (!h) { res.writeHead(404).end(); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks);
      if (DELAY) await new Promise((r) => setTimeout(r, DELAY * (0.7 + Math.random() * 0.6)));
      const out = await h.fetch(new Request(url, { method: req.method, headers: req.headers, body }));
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    if (url.pathname === '/__store') {             // what the "Blob store" holds right now
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ops: store.ops, blobs: [...store.map.keys()] }, null, 1));
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (!path || path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || /(^|[/\\])(\.|node_modules|api[/\\]_lib)/.test(path)) { res.writeHead(403).end(); return; }
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(PORT, HOST, () => console.log(`Green Diamond dev server: http://${HOST}:${PORT}  (multiplayer API with an in-memory store)`));

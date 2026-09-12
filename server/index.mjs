import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { ROOT, DATA_DIR, SOURCE_DIR, schema, loadLibrary, coverage, getClaimDetail } from './dataset.mjs';

const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
const library = await loadLibrary(DATA_DIR);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8' };
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store'
};
function json(res, status, value, headers = {}) {
  res.writeHead(status, { ...securityHeaders, 'Content-Type': mime['.json'], ...headers });
  res.end(JSON.stringify(value));
}
async function asset(res, file) {
  try {
    const body = await readFile(file);
    res.writeHead(200, { ...securityHeaders, 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') json(res, 404, { error: 'Asset not found' });
    else throw e;
  }
}
const server = http.createServer(async (req, res) => {
  try {
    const validHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    if (!validHosts.has(req.headers.host)) return json(res, 403, { error: 'Local host required' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Read-only API; use the import CLI to add papers' }, { Allow: 'GET, HEAD' });
    const path = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname);
    if (path === '/api/health') return json(res, 200, { status: 'ok', schema_version: '1.0', papers: library.size });
    if (path === '/api/schema') return json(res, 200, schema);
    if (path === '/api/papers') return json(res, 200, [...library.values()].map(d => ({ ...d.paper, stats: coverage(d) })));
    const match = path.match(/^\/api\/papers\/([a-zA-Z0-9_.-]+)(?:\/(claims|sources|export)(?:\/([a-zA-Z0-9_.-]+))?)?$/);
    if (match) {
      const data = library.get(match[1]);
      if (!data) return json(res, 404, { error: 'Paper not found' });
      if (!match[2]) return json(res, 200, { ...data, stats: coverage(data) });
      if (match[2] === 'export') return json(res, 200, data, { 'Content-Disposition': `attachment; filename="${data.paper.id}.json"` });
      if (match[2] === 'claims') {
        const detail = match[3] ? getClaimDetail(data, match[3]) : data.claims;
        return json(res, detail ? 200 : 404, detail || { error: 'Claim not found' });
      }
      const source = match[3] ? data.sources.find(s => s.id === match[3]) : data.sources;
      return json(res, source ? 200 : 404, source || { error: 'Source not found' });
    }
    if (path.startsWith('/api/')) return json(res, 404, { error: 'Route not found' });
    if (path === '/') return asset(res, resolve(ROOT, 'dist/index.html'));
    if (['/app.js', '/style.css'].includes(path)) return asset(res, resolve(ROOT, `dist${path}`));
    if (/^\/vendor\/katex\/(katex\.mjs|katex\.min\.css|contrib\/auto-render\.mjs|fonts\/[A-Za-z0-9_.-]+\.(woff2?|ttf))$/.test(path)) return asset(res, resolve(ROOT, 'node_modules/katex/dist', path.slice('/vendor/katex/'.length)));
    if (/^\/sources\/[A-Za-z0-9_.-]+$/.test(path)) {
      const relative = path.slice(1);
      if ([...library.values()].some(d => d.sources.some(s => s.local_path === relative))) return asset(res, resolve(SOURCE_DIR, path.slice('/sources/'.length)));
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) json(res, error instanceof URIError ? 400 : 500, { error: error instanceof URIError ? 'Invalid URL' : 'Could not read the requested resource' });
    else res.end();
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Evidence Atlas: http://127.0.0.1:${port} (${library.size} papers)`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));

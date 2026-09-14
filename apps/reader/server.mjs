import http from 'node:http';
import { createCatalog, CatalogError } from '../../packages/core/catalog.mjs';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openResearchStore } from '../../packages/core/research-store.mjs';
import { WORKSPACE_DIR } from '../../packages/core/paths.mjs';
import { ROOT, DATA_DIR, SOURCE_DIR, schema, loadLibrary, coverage, getClaimDetail } from '../../packages/core/dataset.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8' };
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
export function createReaderServer({ port = 4317, dataDir = DATA_DIR } = {}) {
const sourceDir = resolve(dataDir, '../sources');
const catalog = createCatalog(dataDir);
const server = http.createServer(async (req, res) => {
  try {
    const validHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    if (!validHosts.has(req.headers.host)) return json(res, 403, { error: 'Local host required' });
    const path = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (path !== '/api/catalog' || req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
      if (req.headers.origin !== `http://${req.headers.host}` || req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, 403, { error: 'Same-origin JSON required' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 65536) return json(res, 413, { error: 'Request too large' }); }
      let action;
      try { action = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
      if (!action || typeof action !== 'object') return json(res, 400, { error: 'Invalid action' });
      const papers = await loadLibrary(dataDir);
      return json(res, 200, await catalog.update(action, new Set(papers.keys())));
    }
    if (path === '/api/catalog') return json(res, 200, await catalog.read());
    if (path === '/api/research' || path.startsWith('/api/research/')) {
      const store = await openResearchStore(process.env.EVIDENCE_RESEARCH_DIR || resolve(WORKSPACE_DIR, 'research-library'));
      try {
        const parts = path.split('/').filter(Boolean);
        let result;
        if (parts.length === 2) result = store.search(new URL(req.url, `http://${req.headers.host}`).searchParams.get('q') || '');
        else if (parts[2] === 'works' && parts[4] === 'versions') result = store.versions(parts[3]);
        else if (parts[2] === 'works' && parts[4] === 'sources') result = store.sources(parts[3]);
        else if (parts[2] === 'analyses') result = store.analysis(parts[3]);
        return json(res, result ? 200 : 404, result || { error: 'Record not found' });
      } finally { store.close(); }
    }
    const library = path.startsWith('/api/') || path.startsWith('/sources/') ? await loadLibrary(dataDir) : new Map();
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
    if (path === '/') return asset(res, resolve(ROOT, 'apps/reader/public/index.html'));
    if (['/app.js', '/library.js', '/style.css'].includes(path)) return asset(res, resolve(ROOT, `apps/reader/public${path}`));
    if (/^\/vendor\/katex\/(katex\.mjs|katex\.min\.css|contrib\/auto-render\.mjs|fonts\/[A-Za-z0-9_.-]+\.(woff2?|ttf))$/.test(path)) return asset(res, resolve(ROOT, 'node_modules/katex/dist', path.slice('/vendor/katex/'.length)));
    if (/^\/sources\/[A-Za-z0-9_.-]+$/.test(path)) {
      const relative = path.slice(1);
      if ([...library.values()].some(d => d.sources.some(s => s.local_path === relative))) return asset(res, resolve(sourceDir, path.slice('/sources/'.length)));
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    if (error instanceof CatalogError) return json(res, error.status, { error: error.message });
    console.error(error.message);
    if (!res.headersSent) json(res, error instanceof URIError ? 400 : 500, { error: error instanceof URIError ? 'Invalid URL' : 'Could not read the requested resource' });
    else res.end();
  }
});
return server;
}

export async function startReader({ port = Number(process.env.PORT || 4317), dataDir = DATA_DIR } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  const library = await loadLibrary(dataDir);
  const server = createReaderServer({ port, dataDir });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  console.log(`Evidence Atlas: http://127.0.0.1:${port} (${library.size} papers)`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startReader().catch(error => { console.error(error.message); process.exitCode = 1; });
}

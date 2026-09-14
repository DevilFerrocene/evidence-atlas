import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const [page, destination] = process.argv.slice(2);
if (!page || !destination) throw new Error('Usage: node scripts/export-html.mjs reader-url output.html');
const url = new URL(page), id = url.searchParams.get('paper');
if (!id) throw new Error('The reader URL must select a paper');
const root = resolve(import.meta.dirname, '..');
async function get(path) {
  const r = await fetch(new URL(path, url));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r;
}
const data = await (await get(`/api/papers/${encodeURIComponent(id)}`)).json();
const routes = { '/api/papers': [{ ...data.paper, stats: data.stats }], [`/api/papers/${id}`]: data };
for (const claim of data.claims) routes[`/api/papers/${id}/claims/${claim.id}`] = await (await get(`/api/papers/${id}/claims/${claim.id}`)).json();
const assets = {};
for (const source of data.sources.filter(s => s.local_path)) {
  const path = `/${source.local_path}`;
  if (assets[path]) continue;
  const r = await get(path);
  assets[path] = `data:${r.headers.get('content-type') || 'application/octet-stream'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
}
assets[`/api/papers/${id}/export`] = `data:application/json;base64,${Buffer.from(JSON.stringify(data, null, 2)).toString('base64')}`;
let css = await readFile(resolve(root, 'node_modules/katex/dist/katex.min.css'), 'utf8');
for (const match of [...css.matchAll(/url\((fonts\/[^)]+)\)/g)]) {
  const file = match[1];
  const bytes = await readFile(resolve(root, 'node_modules/katex/dist', file));
  css = css.replaceAll(`url(${file})`, `url(data:font/${file.endsWith('woff2') ? 'woff2' : file.endsWith('woff') ? 'woff' : 'ttf'};base64,${bytes.toString('base64')})`);
}
css += await readFile(resolve(root, 'apps/reader/public/style.css'), 'utf8');
css += '\n#local-label{display:none!important}';
let app = await readFile(resolve(root, 'apps/reader/public/app.js'), 'utf8');
app = app.replace(/^import .*;\n/gm, '');
app = app.replace('const response = await fetch(path);', 'const response = { ok: Object.hasOwn(STATIC_ROUTES, path), status: 404, json: async () => structuredClone(STATIC_ROUTES[path]) };');
app = app.replace('node.href = href;', 'node.href = STATIC_ASSETS[href] || href;');
app = app.replace("try { lang = localStorage.getItem('evidence-atlas-language') === 'en' ? 'en' : 'zh'; } catch {}", '');
const safe = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const bootstrap = `const STATIC_ROUTES=${safe(routes)};const STATIC_ASSETS=${safe(assets)};const createLibraryManager=()=>({open(){},render(){}});`;
const katex = await readFile(resolve(root, 'node_modules/katex/dist/katex.min.js'), 'utf8');
const auto = await readFile(resolve(root, 'node_modules/katex/dist/contrib/auto-render.min.js'), 'utf8');
const script = text => `<script>${text.replace(/<\/script/gi, '<\\/script')}</script>`;
let html = await readFile(resolve(root, 'apps/reader/public/index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]+>/g, '').replace(/<script type="module"[^>]+><\/script>/, '');
html = html.replace('</head>', () => `<style>${css}</style></head>`).replace('href="/"', 'href="#paper"');
html = html.replace('</body>', () => `${script(katex)}${script(auto)}${script(bootstrap + '\n' + app)}</body>`);
await mkdir(dirname(resolve(destination)), { recursive: true });
await writeFile(destination, html, { flag: 'wx' });
console.log(JSON.stringify({ path: resolve(destination), bytes: Buffer.byteLength(html), claims: data.claims.length, evidence: data.evidence.length, sources: data.sources.length }));

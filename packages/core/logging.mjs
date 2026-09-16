import { mkdir, appendFile, stat, rename, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LOG_DIR } from './paths.mjs';
const queues = new Map();
const cleaned = new Set();
export function cleanLog(value, key = '') {
  if (/token|secret|password|authorization|cookie|api.?key/i.test(key)) return '[redacted]';
  if (typeof value === 'string') return value.replace(/https?:\/\/[^\s<>"']+/g, raw => { try { const u = new URL(raw); return u.origin + u.pathname; } catch { return '[url]'; } }).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 30).map(v => cleanLog(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,cleanLog(v,k)]));
  return value;
}
export async function logEvent(module, event, { directory = LOG_DIR } = {}) {
  const file = resolve(directory, `${module.replace(/[^a-z0-9-]/gi, '-')}-${process.pid}.jsonl`);
  const pending = (queues.get(file) || Promise.resolve()).then(async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!cleaned.has(directory)) {
      for (const name of await readdir(directory)) {
        if (!/\.jsonl(?:\.[1-3])?$/.test(name)) continue;
        const old = resolve(directory, name);
        try { if (Date.now() - (await stat(old)).mtimeMs > 14 * 86400000) await unlink(old); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      cleaned.add(directory);
    }
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', ...cleanLog(event), module }) + '\n';
    let size = 0;
    try { size = (await stat(file)).size; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (size + Buffer.byteLength(line) > 10 * 1024 * 1024) {
      for (let i = 3; i >= 1; i--) {
        try { await rename(i === 1 ? file : `${file}.${i-1}`, `${file}.${i}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
    }
    await appendFile(file, line, { mode: 0o600 });
  }).catch(e => { process.stderr.write(`Log write failed: ${e.code || 'error'}\n`); });
  queues.set(file, pending);
  await pending;
}

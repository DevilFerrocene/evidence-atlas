import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import Ajv from 'ajv';
import path from 'node:path';
import { getClaimDetail, coverage, readDataset, validateDataset } from '../packages/core/dataset.mjs';
import { publishBundle } from '../packages/core/library.mjs';
import { cropImage, extractPdfText, renderPdfPage } from './pdf.mjs';
import { redact } from './workspace.mjs';

const MAX_WEB_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 12_000_000;
const IMAGE_TYPES = new Map([
  ['.png', { mimeType: 'image/png', signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }],
  ['.jpg', { mimeType: 'image/jpeg', signature: Buffer.from([0xff, 0xd8, 0xff]) }],
  ['.jpeg', { mimeType: 'image/jpeg', signature: Buffer.from([0xff, 0xd8, 0xff]) }],
  ['.webp', { mimeType: 'image/webp', signature: Buffer.from('RIFF'), webp: true }]
]);

function fail(message) { throw new Error(message); }
function requiredString(value, name) { if (typeof value !== 'string' || !value.trim()) fail(`${name} must be a non-empty string.`); return value.trim(); }
function textString(value, name) { if (typeof value !== 'string') fail(`${name} must be a string.`); return value; }
function bounded(value, name, { defaultValue, min, max, integer = false } = {}) {
  if (value === undefined) return defaultValue;
  const number = Number(value);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || number < min || number > max) fail(`${name} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`);
  return number;
}
function textResult(result) { return JSON.stringify(result, null, 2); }
function ipv4FromMappedIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (!normalized.includes(':')) return null;
  const [left, right = ''] = normalized.split('::');
  const before = left ? left.split(':').filter(Boolean) : [];
  const after = right ? right.split(':').filter(Boolean) : [];
  const groups = [...before, ...Array(8 - before.length - after.length).fill('0'), ...after];
  if (groups.length !== 8 || !groups.every(group => /^[0-9a-f]{1,4}$/.test(group))) return null;
  if (!groups.slice(0, 5).every(group => Number.parseInt(group, 16) === 0) || !['0', 'ffff'].includes(groups[5])) return null;
  const high = Number.parseInt(groups[6], 16), low = Number.parseInt(groups[7], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}
function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (!family) return true;
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19));
  }
  const normalized = address.toLowerCase().split('%')[0];
  const mapped = ipv4FromMappedIpv6(normalized);
  if (mapped) return true;
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('100:') || normalized.startsWith('2001:0') || normalized.startsWith('2001:db8');
}
async function assertPublicUrl(value) {
  const url = new URL(requiredString(value, 'url'));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('Only credential-free public http(s) URLs are allowed.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost')) fail('Localhost is not allowed.');
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) fail('Private or local network addresses are not allowed.');
    return { url, address: hostname, family: net.isIP(hostname) };
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) fail('URL resolves to a private, local, or unsupported network address.');
  const chosen = addresses[0];
  return { url, address: chosen.address, family: chosen.family };
}
function requestPinned(target, signal) {
  return new Promise((resolve, reject) => {
    const client = target.url.protocol === 'https:' ? https : http;
    const request = client.request(target.url, {
      method: 'GET',
      autoSelectFamily: false,
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [{ address: target.address, family: target.family }]) : callback(null, target.address, target.family),
      headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1', 'accept-encoding': 'identity', 'user-agent': 'EvidenceAtlasAgent/1.0' }
    }, response => resolve(response));
    request.once('error', reject);
    const abort = () => request.destroy(signal?.reason instanceof Error ? signal.reason : new Error('Request cancelled'));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    request.once('close', () => signal?.removeEventListener('abort', abort));
    request.end();
  });
}
async function readCappedBody(response, maxBytes) {
  const chunks = []; let total = 0;
  for await (const chunk of response) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (total + part.length > maxBytes) { response.destroy(); return { body: Buffer.concat(chunks), truncated: true }; }
    chunks.push(part); total += part.length;
  }
  return { body: Buffer.concat(chunks), truncated: false };
}
async function fetchPublicWeb(urlValue, signal) {
  let target = await assertPublicUrl(urlValue);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await requestPinned(target, signal);
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      response.resume();
      if (!location || Array.isArray(location)) fail('Redirect response omitted its location.');
      target = await assertPublicUrl(new URL(location, target.url).toString());
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); fail(`Public webpage returned HTTP ${response.statusCode}.`); }
    const type = String(response.headers['content-type'] || 'application/octet-stream');
    if (!/^text\/|application\/(?:xhtml\+xml|json|xml)/i.test(type)) { response.resume(); fail(`Webpage content type is not text: ${type}`); }
    const { body, truncated } = await readCappedBody(response, MAX_WEB_BYTES);
    return { url: target.url.toString(), content_type: type, text: body.toString('utf8'), truncated, bytes: body.length };
  }
  fail('Too many redirects.');
}
function inspectImage(relativePath, buffer) {
  const spec = IMAGE_TYPES.get(path.extname(relativePath).toLowerCase());
  if (!spec) fail('Only PNG, JPEG, and WebP image files are supported.');
  if (!buffer.subarray(0, spec.signature.length).equals(spec.signature) || (spec.webp && buffer.subarray(8, 12).toString('ascii') !== 'WEBP')) fail('Image signature does not match its file extension.');
  return spec.mimeType;
}
function compactPaper(data) {
  return { id: data.paper.id, title: data.paper.title, source_url: data.paper.source_url, coverage: coverage(data) };
}

export const TOOL_DEFINITIONS = [
  { name: 'atlas_list_workspace', description: 'List files below the agent workspace. Symbolic links and paths outside the workspace are never returned.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, recursive: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_read_workspace_file', description: 'Read a UTF-8 text-file byte range from the workspace. Use offset and length to inspect large files incrementally.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: 1000000 } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_write_workspace_file', description: 'Write a UTF-8 draft or source text file in the current run only. Direct writes to the library and run records are not available.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string', maxLength: 1000000 } }, required: ['path', 'text'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_fetch_public_webpage', description: 'Fetch a public http(s) text webpage with URL/source content recorded in this run. Local, private, credentialed, binary, overlarge, and redirected-to-private URLs are rejected.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
  { name: 'atlas_read_image', description: 'Read a PNG, JPEG, or WebP image from the workspace. MCP returns an image block; the agent loop attaches it for vision-capable models.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_crop_image', description: 'Crop a workspace image and write a PNG into this run’s sources directory.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 } }, required: ['path', 'x', 'y', 'width', 'height'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_read_pdf', description: 'Extract text only from selected PDF pages in the workspace. Empty extraction is reported explicitly; this tool does not do OCR.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, page: { type: 'integer', minimum: 1 }, page_end: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_render_pdf_page', description: 'Render one PDF page from the workspace into a PNG in this run’s sources directory for visual reading.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, page: { type: 'integer', minimum: 1 }, scale: { type: 'number', minimum: 0.5, maximum: 3 } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_read_contract', description: 'Read the run-local copy of the Evidence Atlas skill or paper JSON schema.', inputSchema: { type: 'object', properties: { name: { type: 'string', enum: ['skill', 'paper_schema'] } }, required: ['name'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_validate_paper', description: 'Validate a paper JSON file in the workspace against the Evidence Atlas data contract.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_read_paper_summary', description: 'Read a validated paper JSON summary and its coverage counts from the workspace.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_get_claim', description: 'Read one claim and its evidence/source closure from a validated workspace paper JSON.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, claim_id: { type: 'string' } }, required: ['path', 'claim_id'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_publish_library', description: 'Validate and publish a workspace paper bundle to the workspace library. Success means validation and publication both completed.', inputSchema: { type: 'object', properties: { file: { type: 'string' }, source_dir: { type: 'string' }, replace: { type: 'boolean' } }, required: ['file', 'source_dir'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }
];

export function createToolRegistry({ workspace, run }) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validators = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, ajv.compile(tool.inputSchema)]));
  const handlers = {
    atlas_list_workspace: async args => workspace.list(args.path || '.', { recursive: Boolean(args.recursive), limit: bounded(args.limit, 'limit', { defaultValue: 200, min: 1, max: 500, integer: true }) }),
    atlas_read_workspace_file: async args => {
      const relative = requiredString(args.path, 'path');
      return { path: relative, ...(await workspace.readTextSlice(relative, { offset: bounded(args.offset, 'offset', { defaultValue: 0, min: 0, max: Number.MAX_SAFE_INTEGER, integer: true }), length: bounded(args.length, 'length', { defaultValue: 200_000, min: 1, max: 1_000_000, integer: true }) })) };
    },
    atlas_write_workspace_file: async args => {
      const relative = requiredString(args.path, 'path');
      const permitted = [`${run.relativeDir}/drafts/`, `${run.relativeDir}/sources/`];
      if (!permitted.some(prefix => relative.startsWith(prefix))) fail(`Write path must be below ${run.relativeDir}/drafts or ${run.relativeDir}/sources.`);
      return { path: await workspace.writeText(relative, textString(args.text, 'text')) };
    },
    atlas_fetch_public_webpage: async (args, signal) => {
      const page = await fetchPublicWeb(requiredString(args.url, 'url'), signal);
      const output = path.posix.join(run.relativeDir, 'sources', `web-${Date.now()}.json`);
      await workspace.writeText(output, JSON.stringify({ fetched_at: new Date().toISOString(), ...page }, null, 2));
      await run.event('public_webpage_fetched', { url: page.url, output, bytes: page.bytes, truncated: page.truncated });
      return { ...page, saved_to: output };
    },
    atlas_read_image: async args => {
      const relative = requiredString(args.path, 'path');
      const image = await workspace.readBuffer(relative, { maxBytes: MAX_IMAGE_BYTES });
      const mimeType = inspectImage(relative, image);
      return { path: relative, bytes: image.length, mime_type: mimeType, vision: { mimeType, data: image.toString('base64') } };
    },
    atlas_crop_image: async args => cropImage(workspace, run, requiredString(args.path, 'path'), args),
    atlas_read_pdf: async args => extractPdfText(workspace, requiredString(args.path, 'path'), args),
    atlas_render_pdf_page: async args => renderPdfPage(workspace, run, requiredString(args.path, 'path'), args),
    atlas_read_contract: async args => {
      const file = args.name === 'skill' ? 'contract/SKILL.md' : args.name === 'paper_schema' ? 'contract/paper.schema.json' : fail('name must be skill or paper_schema.');
      const relative = path.posix.join(run.relativeDir, file);
      return { name: args.name, path: relative, text: await workspace.readText(relative, { maxBytes: 1_000_000 }) };
    },
    atlas_validate_paper: async args => {
      const file = await workspace.pathFor(requiredString(args.path, 'path'), { allowMissing: false });
      const raw = JSON.parse(await workspace.readText(requiredString(args.path, 'path'), { maxBytes: 5_000_000 }));
      const result = validateDataset(raw);
      if (!result.valid) return { path: args.path, ...result };
      await readDataset(file);
      run.validated = true;
      await run.event('paper_validated', { path: args.path, coverage: result.stats });
      return { path: args.path, ...result };
    },
    atlas_read_paper_summary: async args => compactPaper(await readDataset(await workspace.pathFor(requiredString(args.path, 'path'), { allowMissing: false }))),
    atlas_get_claim: async args => {
      const data = await readDataset(await workspace.pathFor(requiredString(args.path, 'path'), { allowMissing: false }));
      const detail = getClaimDetail(data, requiredString(args.claim_id, 'claim_id'));
      if (!detail) fail(`Claim not found: ${args.claim_id}`);
      return detail;
    },
    atlas_publish_library: async args => {
      const fileRelative = requiredString(args.file, 'file');
      const file = await workspace.pathFor(fileRelative, { allowMissing: false });
      const sourceDir = await workspace.pathFor(requiredString(args.source_dir, 'source_dir'), { allowMissing: false });
      const raw = JSON.parse(await workspace.readText(fileRelative, { maxBytes: 5_000_000 }));
      const validation = validateDataset(raw);
      if (!validation.valid) fail(`Paper validation failed: ${validation.errors.join('; ')}`);
      const dataDir = await workspace.pathFor('library/papers');
      const published = await publishBundle({ file, sourceDir, replace: Boolean(args.replace), dataDir });
      run.validated = true; run.published = true;
      await run.event('paper_published', { file: fileRelative, id: published.id, path: path.relative(workspace.root, published.path) });
      if (run.kind === 'mcp') await run.setStatus('published', { id: published.id });
      return { id: published.id, path: path.relative(workspace.root, published.path), validation };
    }
  };
  return {
    definitions: TOOL_DEFINITIONS,
    async execute(name, args = {}, { signal } = {}) {
      const handler = handlers[name];
      if (!handler) return { ok: false, error: `Unknown tool: ${name}`, modelContent: `Unknown tool: ${name}` };
      const validate = validators.get(name);
      if (!validate(args)) {
        const error = `Invalid arguments: ${ajv.errorsText(validate.errors, { separator: '; ' })}`;
        return { ok: false, error, modelContent: textResult({ error }) };
      }
      try {
        const result = await handler(args, signal);
        const vision = result?.vision;
        const serializable = vision ? { ...result, vision: { available: true, mime_type: vision.mimeType } } : result;
        await run.event('tool_succeeded', { name, arguments: args, result: serializable });
        return { ok: true, result: serializable, vision, modelContent: textResult(serializable) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await run.event('tool_failed', { name, arguments: args, error: message });
        return { ok: false, error: message, modelContent: textResult({ error: message }) };
      }
    }
  };
}

export { redact };

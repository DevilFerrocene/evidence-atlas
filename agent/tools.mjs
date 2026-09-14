import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import Ajv from 'ajv';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { cropImage, extractPdfText, renderPdfPage } from './pdf.mjs';
import { redact } from './workspace.mjs';
import { ARTICLE_TOOLS } from './article-tools.mjs';
import { createArticleWorkflow } from './article-workflow.mjs';
import { JOB_TOOLS, createPaperJobs } from './paper-jobs.mjs';
import { readRoleContract } from './role-contract.mjs';

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
function textResult(result) { return JSON.stringify(result); }
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
function networkFailure(stage, hostname, error) {
  const details = [];
  const visit = (item, depth = 0) => {
    if (!item || depth > 3) return;
    if (typeof item.code === 'string') details.push(item.code);
    else if (typeof item.name === 'string' && item.name !== 'Error') details.push(item.name);
    if (Array.isArray(item.errors)) item.errors.slice(0, 4).forEach(child => visit(child, depth + 1));
    visit(item.cause, depth + 1);
  };
  visit(error);
  return new Error(`Public fetch ${stage} failed for ${hostname}: ${[...new Set(details)].join(', ') || 'network connection failed'}.`, { cause: error });
}
async function resolvePublicProxyAddress(hostname, signal) {
  const endpoint = new URL('https://cloudflare-dns.com/dns-query');
  endpoint.searchParams.set('name', hostname);
  endpoint.searchParams.set('type', 'A');
  let response;
  try { response = await fetch(endpoint, {
    headers: { accept: 'application/dns-json' },
    redirect: 'error', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(15000)])
  }); } catch (error) { throw networkFailure('public DNS lookup', hostname, error); }
  if (!response.ok) fail(`Public DNS lookup returned HTTP ${response.status}.`);
  const payload = await response.json();
  const addresses = (payload.Answer || []).filter(item => item.type === 1)
    .map(item => ({ address: item.data, family: 4 }));
  if (payload.Status !== 0 || !addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    fail('Public DNS did not return a permitted public address.');
  }
  return addresses;
}
async function assertPublicUrl(value, signal) {
  const url = new URL(requiredString(value, 'url'));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('Only credential-free public http(s) URLs are allowed.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost')) fail('Localhost is not allowed.');
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) fail('Private or local network addresses are not allowed.');
    return { url, address: hostname, family: net.isIP(hostname) };
  }
  signal?.throwIfAborted();
  let addresses;
  try {
    addresses = await new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      lookup(hostname, { all: true, verbatim: true }).then(resolve, reject)
        .finally(() => signal?.removeEventListener('abort', abort));
    });
  }
  catch (error) { throw networkFailure('system DNS lookup', hostname, error); }
  signal?.throwIfAborted();
  if (addresses.length && addresses.every(item => /^198\.(18|19)\./.test(item.address))) {
    addresses = await resolvePublicProxyAddress(hostname, signal);
  }
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
    request.once('error', error => reject(networkFailure('connection', target.url.hostname, error)));
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
  signal = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(30000)]);
  let target = await assertPublicUrl(urlValue, signal);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await requestPinned(target, signal);
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      response.resume();
      if (!location || Array.isArray(location)) fail('Redirect response omitted its location.');
      target = await assertPublicUrl(new URL(location, target.url).toString(), signal);
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.resume();
      const next = [401, 403].includes(response.statusCode)
        ? ' This public fetch has no publisher session; use scientist-literature literature_read for scholarly articles.' : '';
      fail(`Public webpage returned HTTP ${response.statusCode}.${next}`);
    }
    const type = String(response.headers['content-type'] || 'application/octet-stream');
    if (!/^text\/|application\/(?:xhtml\+xml|json|xml)/i.test(type)) { response.resume(); fail(`Webpage content type is not text: ${type}`); }
    const { body, truncated } = await readCappedBody(response, MAX_WEB_BYTES);
    return { url: target.url.toString(), content_type: type, text: body.toString('utf8'), truncated, bytes: body.length };
  }
  fail('Too many redirects.');
}
async function fetchPublicImage(urlValue, signal) {
  signal = AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(30000)]);
  let target = await assertPublicUrl(urlValue, signal);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const response = await requestPinned(target, signal);
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      response.resume();
      if (typeof location !== 'string') fail('Image redirect omitted its location.');
      target = await assertPublicUrl(new URL(location, target.url).toString(), signal);
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); fail(`Image returned HTTP ${response.statusCode}.`); }
    if (!/^image\/(png|jpeg|webp)(?:;|$)/i.test(String(response.headers['content-type']))) { response.resume(); fail('Expected a publisher PNG, JPEG or WebP image.'); }
    const { body, truncated } = await readCappedBody(response, MAX_IMAGE_BYTES);
    if (truncated) fail('Image exceeds the 12 MB limit.');
    return body;
  }
  fail('Too many image redirects.');
}
function inspectImage(relativePath, buffer) {
  const spec = IMAGE_TYPES.get(path.extname(relativePath).toLowerCase());
  if (!spec) fail('Only PNG, JPEG, and WebP image files are supported.');
  if (!buffer.subarray(0, spec.signature.length).equals(spec.signature) || (spec.webp && buffer.subarray(8, 12).toString('ascii') !== 'WEBP')) fail('Image signature does not match its file extension.');
  return spec.mimeType;
}
const FILE_TOOL_DEFINITIONS = [
  { name: 'atlas_list_workspace', description: 'List files below the agent workspace. Symbolic links and paths outside the workspace are never returned.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, recursive: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_read_workspace_file', description: 'Read a UTF-8 text-file byte range from the workspace. Use offset and length to inspect large files incrementally.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: 20000 } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_write_workspace_file', description: 'Write a UTF-8 draft or source text file in the current run only. Direct writes to the library and run records are not available.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string', maxLength: 1000000 } }, required: ['path', 'text'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_fetch_public_webpage', description: 'Fetch a public http(s) text webpage with URL/source content recorded in this run. Local, private, credentialed, binary, overlarge, and redirected-to-private URLs are rejected.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
  { name: 'atlas_read_image', description: 'Read a PNG, JPEG, or WebP image from the workspace. MCP returns an image block; the agent loop attaches it for vision-capable models.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_crop_image', description: 'Crop a workspace image and write a PNG into this run’s sources directory.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 } }, required: ['path', 'x', 'y', 'width', 'height'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_read_pdf', description: 'Read selected PDF pages with line breaks and suggested paragraph boundaries. Compare formulas with rendered pages; this is text extraction, not mathematical transcription or OCR. To save the whole paper as source blocks, pass the PDF path directly to atlas_prepare_article or atlas_import_source.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, page: { type: 'integer', minimum: 1 }, page_end: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_render_pdf_page', description: 'Render one PDF page from the workspace into a PNG in this run’s sources directory for visual reading.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, page: { type: 'integer', minimum: 1 }, scale: { type: 'number', minimum: 0.5, maximum: 3 } }, required: ['path'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'atlas_read_contract', description: 'Read the run-local copy of the Evidence Atlas skill or paper JSON schema.', inputSchema: { type: 'object', properties: { name: { type: 'string', enum: ['skill', 'paper_schema'] } }, required: ['name'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
];

export const TOOL_DEFINITIONS = [
  ...JOB_TOOLS,
  ...ARTICLE_TOOLS,
  ...FILE_TOOL_DEFINITIONS.map(tool => {
    if (tool.name === 'atlas_read_contract') return { ...tool, description: 'Read the shared skill, sentence-explanation examples or a fixed writer/reviewer role contract. Codex, OpenCode and the standalone loop share these contracts. Paper bundle schemas are internal to the assembler.', inputSchema: { type: 'object', properties: { name: { enum: ['skill', 'paper-worker', 'evidence-reviewer', 'explanation-examples'] } }, required: ['name'], additionalProperties: false } };
    if (tool.name === 'atlas_write_workspace_file') return { ...tool, description: 'Save source text or a small supporting calculation in the current run. Article translations and annotations use the dedicated article tools, not hand-written paper JSON.' };
    return tool;
  })
];

export function createToolRegistry({ workspace, run }) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validators = new Map(TOOL_DEFINITIONS.map(tool => [tool.name, ajv.compile(tool.inputSchema)]));
  const articleWorkflow = createArticleWorkflow({ workspace, run, fetchImage: fetchPublicImage });
  const handlers = {
    ...articleWorkflow,
    ...createPaperJobs({ workspace, articleWorkflow }),
    atlas_list_workspace: async args => workspace.list(args.path || '.', { recursive: Boolean(args.recursive), limit: bounded(args.limit, 'limit', { defaultValue: 200, min: 1, max: 500, integer: true }) }),
    atlas_read_workspace_file: async args => {
      const relative = requiredString(args.path, 'path');
      return { path: relative, ...(await workspace.readTextSlice(relative, { offset: bounded(args.offset, 'offset', { defaultValue: 0, min: 0, max: Number.MAX_SAFE_INTEGER, integer: true }), length: bounded(args.length, 'length', { defaultValue: 8000, min: 1, max: 20000, integer: true }) })) };
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
      return { url: page.url, content_type: page.content_type, bytes: page.bytes, truncated: page.truncated,
        saved_to: output, excerpt: page.text.slice(0, 1500), next: 'Pass saved_to to atlas_prepare_article; use a publisher article selector for HTML.' };
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
      if (['paper-worker', 'evidence-reviewer'].includes(args.name)) return { name: args.name, text: await readRoleContract(args.name) };
      if (args.name !== 'skill') return { name: args.name, text: await readFile(new URL(`./prompts/${args.name}.${args.name === 'explanation-examples' ? 'md' : 'txt'}`, import.meta.url), 'utf8'), next: 'Use the shared skill and available task context as needed.' };
      return { name: args.name, text: await readFile(new URL('../SKILL.md', import.meta.url), 'utf8') };
    },

  };
  return {
    definitions: TOOL_DEFINITIONS,
    async execute(name, args = {}, { signal } = {}) {
      const handler = handlers[name];
      if (!handler || !validators.has(name)) return { ok: false, error: `Unknown tool: ${name}. Use the article tools returned by tools/list.`, modelContent: `Unknown tool: ${name}. Use the article tools returned by tools/list.` };
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

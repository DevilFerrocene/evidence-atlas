import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, appendFile, lstat, mkdir, open, readFile, realpath, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, WORKSPACE_DIR } from '../packages/core/paths.mjs';

const MAX_TEXT_BYTES = 1_000_000;
const SECRET_KEY = /(api[-_ ]?key|token|secret|password|authorization|cookie)/i;
const SECRET_VALUE = /(?:sk|rk|pk|AIza)[-_][A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+/gi;

function fail(message) { throw new Error(message); }
function isMissing(error) { return error?.code === 'ENOENT'; }
function relativeParts(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) fail('A non-empty relative path is required.');
  if (relativePath.includes('\0') || path.isAbsolute(relativePath)) fail('Paths must be relative to the workspace.');
  const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../')) fail('Path traversal is not allowed.');
  return normalized === '.' ? [] : normalized.split('/').filter(Boolean);
}
function redact(value, fieldName = '') {
  if (SECRET_KEY.test(fieldName)) return '[redacted]';
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[redacted]');
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, key)]));
  return value;
}

export function resolveWorkspaceRoot(override) {
  return path.resolve(override || process.env.EVIDENCE_WORKSPACE || WORKSPACE_DIR || path.join(ROOT, 'workspace'));
}

export class Workspace {
  constructor(root = resolveWorkspaceRoot()) {
    this.requestedRoot = path.resolve(root);
    this.root = null;
  }

  async initialize() {
    await mkdir(this.requestedRoot, { recursive: true });
    this.root = await realpath(this.requestedRoot);
    const info = await stat(this.root);
    if (!info.isDirectory()) fail('Workspace path must be a directory.');
    return this;
  }

  async pathFor(relativePath, { allowMissing = true } = {}) {
    if (!this.root) fail('Workspace has not been initialized.');
    const parts = relativeParts(relativePath);
    let cursor = this.root;
    for (const part of parts) {
      cursor = path.join(cursor, part);
      try {
        const entry = await lstat(cursor);
        if (entry.isSymbolicLink()) fail('Symbolic links are not allowed inside the workspace.');
      } catch (error) {
        if (isMissing(error) && allowMissing) break;
        throw error;
      }
    }
    const candidate = path.resolve(this.root, ...parts);
    if (candidate !== this.root && !candidate.startsWith(`${this.root}${path.sep}`)) fail('Path escapes the workspace.');
    return candidate;
  }

  async ensureDirectory(relativePath) {
    const target = await this.pathFor(relativePath);
    await mkdir(target, { recursive: true });
    await this.pathFor(relativePath, { allowMissing: false });
    return target;
  }

  async readBuffer(relativePath, { maxBytes = MAX_TEXT_BYTES } = {}) {
    const target = await this.pathFor(relativePath, { allowMissing: false });
    const info = await stat(target);
    if (!info.isFile()) fail('Path must name a regular file.');
    if (info.size > maxBytes) fail(`File exceeds the ${maxBytes} byte tool limit.`);
    return readFile(target);
  }

  async readText(relativePath, options = {}) {
    const buffer = await this.readBuffer(relativePath, options);
    return buffer.toString('utf8');
  }

  async readTextSlice(relativePath, { offset = 0, length = 200_000 } = {}) {
    const target = await this.pathFor(relativePath, { allowMissing: false });
    const info = await stat(target);
    if (!info.isFile()) fail('Path must name a regular file.');
    const start = Number(offset), requested = Number(length);
    if (!Number.isInteger(start) || start < 0 || !Number.isInteger(requested) || requested < 1 || requested > MAX_TEXT_BYTES) fail(`offset and length must be valid byte ranges up to ${MAX_TEXT_BYTES}.`);
    if (start > info.size) fail('offset is beyond the end of the file.');
    const size = Math.min(requested, info.size - start);
    const handle = await open(target, 'r');
    try {
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, start);
      return { text: buffer.subarray(0, bytesRead).toString('utf8'), offset: start, length: bytesRead, totalBytes: info.size, truncated: start + bytesRead < info.size };
    } finally { await handle.close(); }
  }

  async writeBuffer(relativePath, data) {
    const target = await this.pathFor(relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await this.pathFor(path.relative(this.root, path.dirname(target)) || '.', { allowMissing: false });
    await writeFile(target, data, { flag: 'w' });
    return path.relative(this.root, target);
  }

  async writeText(relativePath, text) {
    if (typeof text !== 'string') fail('Text content must be a string.');
    if (Buffer.byteLength(text) > MAX_TEXT_BYTES) fail(`Text exceeds the ${MAX_TEXT_BYTES} byte tool limit.`);
    return this.writeBuffer(relativePath, text);
  }

  async list(relativePath = '.', { recursive = false, limit = 200 } = {}) {
    const root = await this.pathFor(relativePath, { allowMissing: false });
    const entries = [];
    const visit = async (directory, prefix = '') => {
      const children = await readdir(directory, { withFileTypes: true });
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entries.length >= limit) return;
        if (child.isSymbolicLink()) continue;
        const itemPath = path.join(directory, child.name);
        const display = path.posix.join(prefix, child.name);
        entries.push({ path: display, type: child.isDirectory() ? 'directory' : child.isFile() ? 'file' : 'other' });
        if (recursive && child.isDirectory()) await visit(itemPath, display);
      }
    };
    await visit(root);
    return { path: relativePath, entries, truncated: entries.length >= limit };
  }

  async startRun(kind) {
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const relativeDir = path.posix.join('runs', id);
    await this.ensureDirectory(relativeDir);
    const run = new AgentRun(this, relativeDir, kind);
    await run.initialize();
    return run;
  }
}

export class AgentRun {
  constructor(workspace, relativeDir, kind) {
    this.workspace = workspace;
    this.relativeDir = relativeDir;
    this.kind = kind;
    this.status = 'running';
    this.published = false;
    this.validated = false;
    this.eventQueue = Promise.resolve();
    this.secrets = [];
  }

  async initialize() {
    await this.workspace.ensureDirectory(path.posix.join(this.relativeDir, 'sources'));
    await this.workspace.ensureDirectory(path.posix.join(this.relativeDir, 'inputs'));
    await this.workspace.ensureDirectory(path.posix.join(this.relativeDir, 'drafts'));
    await this.workspace.ensureDirectory(path.posix.join(this.relativeDir, 'contract'));
    await this.copyBundledContract();
    await this.setStatus('running');
    await this.event('run_started', { kind: this.kind });
  }

  async copyBundledContract() {
    const sourceFiles = [
      ['SKILL.md', 'contract/SKILL.md'],
      ['schemas/paper.schema.json', 'contract/paper.schema.json']
    ];
    for (const [sourceRelative, destinationRelative] of sourceFiles) {
      const source = path.join(ROOT, sourceRelative);
      try {
        await access(source, fsConstants.R_OK);
        await this.workspace.writeBuffer(path.posix.join(this.relativeDir, destinationRelative), await readFile(source));
      } catch (error) {
        throw new Error(`Required bundled contract is unavailable: ${sourceRelative} (${error.message})`);
      }
    }
  }

  safeJson(value) {
    let text = JSON.stringify(redact(value));
    for (const secret of this.secrets.filter(value => typeof value === 'string' && value)) text = text.split(secret).join('[redacted]');
    return text;
  }

  async event(type, data = {}) {
    const line = `${this.safeJson({ at: new Date().toISOString(), type, data })}\n`;
    const relative = path.posix.join(this.relativeDir, 'events.jsonl');
    const append = this.eventQueue.catch(() => {}).then(async () => {
      const target = await this.workspace.pathFor(relative);
      await appendFile(target, line, { encoding: 'utf8', flag: 'a' });
    });
    this.eventQueue = append;
    await append;
  }

  async setStatus(status, detail = {}) {
    this.status = status;
    await this.workspace.writeText(path.posix.join(this.relativeDir, 'status.json'), `${this.safeJson({
      id: this.relativeDir.split('/').at(-1), kind: this.kind, status, updated_at: new Date().toISOString(),
      validated: this.validated, published: this.published, ...detail
    })}\n`);
  }

  async copyInput(inputPath) {
    const absolute = path.resolve(inputPath);
    const info = await stat(absolute);
    if (!info.isFile()) fail('Each --input path must name a regular file.');
    const safeName = path.basename(absolute).replace(/[^A-Za-z0-9._-]/g, '_');
    const relative = path.posix.join(this.relativeDir, 'inputs', `${Date.now()}-${safeName}`);
    await this.workspace.writeBuffer(relative, await readFile(absolute));
    await this.event('input_copied', { path: relative, bytes: info.size });
    return relative;
  }
}

export { MAX_TEXT_BYTES, redact };

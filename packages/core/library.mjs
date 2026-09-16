import { readFile, writeFile, mkdir, copyFile, readdir, realpath, stat, rename, rm } from 'node:fs/promises';
import { resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, EXAMPLE_DIR, WORKSPACE_DIR, RESEARCH_DIR } from './paths.mjs';
import { readDataset, loadLibrary } from './dataset.mjs';

import { requireFullText } from './full-text.mjs';
import { openResearchStore } from './research-store.mjs';

export { loadLibrary } from './dataset.mjs';

async function insideFile(base, localPath) {
  const root = await realpath(base);
  const file = await realpath(resolve(root, localPath));
  const rel = relative(root, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !(await stat(file)).isFile()) {
    throw new Error(`Source must be a regular file inside the source directory: ${localPath}`);
  }
  return file;
}

export async function initializeLibrary({ dataDir = DATA_DIR, workspaceDir = WORKSPACE_DIR, examples = false } = {}) {
  await mkdir(dataDir, { recursive: true });
  await mkdir(resolve(dataDir, '../sources'), { recursive: true });
  await mkdir(resolve(workspaceDir, 'runs'), { recursive: true });
  const imported = [];
  if (examples) {
    for (const name of (await readdir(resolve(EXAMPLE_DIR, 'papers'))).filter(n => n.endsWith('.json')).sort()) {
      const result = await publishBundle({ file: resolve(EXAMPLE_DIR, 'papers', name), sourceDir: EXAMPLE_DIR, dataDir, bundledExample: true });
      imported.push(result.id);
    }
  }
  return { workspace: workspaceDir, library: dataDir, imported };
}

export async function publishBundle({ file, sourceDir = dirname(resolve(file)), replace = false, dataDir = DATA_DIR, bundledExample = false }) {
  const data = await readDataset(resolve(file));
  if (!bundledExample) await requireFullText(data, async localPath => readFile(await insideFile(sourceDir, localPath), 'utf8'));
  await mkdir(dataDir, { recursive: true });
  const libraryBase = resolve(dataDir, '..');
  const sourcesDir = resolve(libraryBase, 'sources');
  await mkdir(sourcesDir, { recursive: true });
  const lock = resolve(dataDir, '.publish-lock');
  try { await mkdir(lock); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another publication is in progress. Retry after it finishes.');
    throw error;
  }
  const created = [];
  const destination = resolve(dataDir, `${data.paper.id}.json`);
  const temporary = resolve(dataDir, `.${data.paper.id}.${randomUUID()}.tmp`);
  let committed = false;
  try {
    const library = await loadLibrary(dataDir);
    if (library.has(data.paper.id) && !replace) throw new Error(`Paper exists: ${data.paper.id}; use replace explicitly`);
    const previous = library.get(data.paper.id);
    const inputs = new Map();
    for (const source of data.sources.filter(s => s.local_path)) {
      if (!inputs.has(source.local_path)) inputs.set(source.local_path, await insideFile(sourceDir, source.local_path));
    }
    const revision = randomUUID();
    const paths = new Map();
    for (const [original, input] of inputs) {
      const sourceIds = new Set(data.sources.filter(s => s.local_path === original).map(s => s.id));
      const oldSource = previous?.sources.find(s => sourceIds.has(s.id) && s.local_path);
      if (oldSource) {
        try {
          const existing = await insideFile(libraryBase, oldSource.local_path);
          const [before, after] = await Promise.all([readFile(existing), readFile(input)]);
          if (before.equals(after)) {
            paths.set(original, oldSource.local_path);
            continue;
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      const localPath = `sources/${data.paper.id}-${revision}-${basename(original)}`;
      const output = resolve(libraryBase, localPath);
      await copyFile(input, output, 1);
      created.push(output);
      paths.set(original, localPath);
    }
    for (const source of data.sources) if (source.local_path) source.local_path = paths.get(source.local_path);
    for (const figure of data.figures || []) if (figure.original_path) figure.original_path = paths.get(figure.original_path);
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    const store = await openResearchStore(RESEARCH_DIR);
    let archived;
    try { archived = await store.ingest(data, libraryBase); } finally { store.close(); }
    await rename(temporary, destination);
    committed = true;
    return { id: data.paper.id, path: destination, ...archived };
  } finally {
    await rm(temporary, { force: true });
    if (!committed) for (const path of created) await rm(path, { force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

export async function exportBundle({ id, outputDir, dataDir = DATA_DIR }) {
  const data = (await loadLibrary(dataDir)).get(id);
  if (!data) throw new Error(`Unknown paper: ${id}`);
  const output = resolve(outputDir);
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Export requires an empty output directory');
  for (const source of data.sources.filter(s => s.local_path)) {
    const input = await insideFile(resolve(dataDir, '..'), source.local_path);
    const destination = resolve(output, source.local_path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(input, destination);
  }
  await writeFile(resolve(output, `${id}.json`), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  return { id, directory: output };
}

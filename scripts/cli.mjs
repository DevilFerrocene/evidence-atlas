import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { DATA_DIR, SOURCE_DIR, readDataset, loadLibrary, validateDataset, coverage } from '../server/dataset.mjs';

const [command, ...args] = process.argv.slice(2);
const exists = async path => { try { await access(path); return true; } catch { return false; } };
async function copySources(data, from, to, replace) {
  for (const source of data.sources.filter(s => s.local_path)) {
    const input = resolve(from, source.local_path);
    const output = resolve(to, source.local_path);
    if (input === output) continue;
    if (await exists(output) && !replace) throw new Error(`File exists: ${output}; use an empty destination or --replace`);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(input, output);
  }
}
async function sourcePreflight(data, from, to, replace) {
  for (const s of data.sources.filter(s => s.local_path)) {
    const input = resolve(from, s.local_path), output = resolve(to, s.local_path);
    if (!(await exists(input))) throw new Error(`Missing local source: ${input}`);
    if (input !== output && await exists(output) && !replace) throw new Error(`File exists: ${output}; choose an empty destination or --replace`);
  }
}
try {
  if (command === 'validate') {
    if (args.length > 1) throw new Error('Usage: validate [paper.json]');
    if (args[0]) {
      const data = JSON.parse(await readFile(resolve(args[0]), 'utf8'));
      const result = validateDataset(data);
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exitCode = 1;
    } else {
      const library = await loadLibrary();
      if (!library.size) throw new Error('No paper bundles in data/papers');
      for (const data of library.values()) console.log(JSON.stringify({ id: data.paper.id, valid: true, ...coverage(data) }, null, 2));
    }
  } else if (command === 'import') {
    const file = args[0];
    const replace = args.includes('--replace');
    const sourceIndex = args.indexOf('--source-dir');
    if (!file || file.startsWith('--')) throw new Error('Usage: import paper.json [--source-dir directory] [--replace]');
    const allowed = new Set([0]);
    if (sourceIndex >= 0) {
      if (!args[sourceIndex + 1] || args[sourceIndex + 1].startsWith('--')) throw new Error('--source-dir requires a directory');
      allowed.add(sourceIndex); allowed.add(sourceIndex + 1);
    }
    if (replace) allowed.add(args.indexOf('--replace'));
    if (args.some((_, i) => !allowed.has(i))) throw new Error('Unknown or duplicate argument');
    const data = await readDataset(resolve(file));
    const inputBase = sourceIndex >= 0 ? resolve(args[sourceIndex + 1]) : dirname(resolve(file));
    const destination = resolve(DATA_DIR, `${data.paper.id}.json`);
    if (await exists(destination) && !replace) throw new Error(`Paper exists: ${data.paper.id}; --replace explicitly replaces it`);
    await mkdir(DATA_DIR, { recursive: true });
    const incomingPaths = new Set(data.sources.filter(s => s.local_path).map(s => s.local_path));
    for (const existing of (await loadLibrary()).values()) {
      if (existing.paper.id === data.paper.id) continue;
      const conflict = existing.sources.find(s => incomingPaths.has(s.local_path));
      if (conflict) throw new Error(`Source path ${conflict.local_path} belongs to ${existing.paper.id}; use a distinct filename`);
    }
    await sourcePreflight(data, inputBase, dirname(SOURCE_DIR), replace);
    await copySources(data, inputBase, dirname(SOURCE_DIR), replace);
    await writeFile(destination, JSON.stringify(data, null, 2) + '\n', { flag: replace ? 'w' : 'wx' });
    console.log(JSON.stringify({ imported: data.paper.id, path: destination, action: 'Restart the server to load the new library' }, null, 2));
  } else if (command === 'export') {
    if (args.length !== 2) throw new Error('Usage: export paper-id output-directory');
    const data = (await loadLibrary()).get(args[0]);
    if (!data) throw new Error(`Unknown paper: ${args[0]}`);
    const output = resolve(args[1]);
    const file = resolve(output, `${data.paper.id}.json`);
    if (await exists(file)) throw new Error(`File exists: ${file}`);
    await sourcePreflight(data, dirname(SOURCE_DIR), output, false);
    await mkdir(output, { recursive: true });
    await copySources(data, dirname(SOURCE_DIR), output, false);
    await writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ exported: data.paper.id, directory: output }, null, 2));
  } else {
    console.log('Evidence Atlas\n  node scripts/cli.mjs validate [paper.json]\n  node scripts/cli.mjs import paper.json [--source-dir directory] [--replace]\n  node scripts/cli.mjs export paper-id output-directory\n  npm start');
    if (command && !['--help', 'help'].includes(command)) process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }

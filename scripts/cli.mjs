#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { validateDataset, loadLibrary, coverage } from '../packages/core/dataset.mjs';
import { initializeLibrary, publishBundle, exportBundle } from '../packages/core/library.mjs';

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'init') {
    if (args.some(a => a !== '--examples') || args.length > 1) throw new Error('Usage: init [--examples]');
    console.log(JSON.stringify(await initializeLibrary({ examples: args.includes('--examples') }), null, 2));
  } else if (command === 'validate') {
    if (args.length > 1) throw new Error('Usage: validate [paper.json]');
    if (args[0]) {
      const result = validateDataset(JSON.parse(await readFile(resolve(args[0]), 'utf8')));
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exitCode = 1;
    } else {
      for (const data of (await loadLibrary()).values()) console.log(JSON.stringify({ id: data.paper.id, valid: true, ...coverage(data) }));
    }
  } else if (command === 'import') {
    const file = args.shift();
    if (!file || file.startsWith('--')) throw new Error('Usage: import paper.json [--source-dir directory] [--replace]');
    let replace = false, sourceDir = dirname(resolve(file)), sawSource = false;
    while (args.length) {
      const flag = args.shift();
      if (flag === '--replace' && !replace) replace = true;
      else if (flag === '--source-dir' && !sawSource && args[0] && !args[0].startsWith('--')) { sourceDir = resolve(args.shift()); sawSource = true; }
      else throw new Error(`Invalid or duplicate option: ${flag}`);
    }
    console.log(JSON.stringify(await publishBundle({ file: resolve(file), sourceDir, replace }), null, 2));
  } else if (command === 'export') {
    if (args.length !== 2) throw new Error('Usage: export paper-id empty-output-directory');
    console.log(JSON.stringify(await exportBundle({ id: args[0], outputDir: args[1] }), null, 2));
  } else {
    console.log('Evidence Atlas\n  evidence-atlas init [--examples]\n  evidence-atlas validate [paper.json]\n  evidence-atlas import paper.json [--source-dir directory] [--replace]\n  evidence-atlas export paper-id empty-output-directory\n  npm start\n  npm run mcp\n  npm run agent -- --help');
    if (command && !['--help', 'help'].includes(command)) process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }

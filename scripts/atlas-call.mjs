#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Workspace } from '../agent/workspace.mjs';
import { createToolRegistry, TOOL_DEFINITIONS } from '../agent/tools.mjs';

export async function resolveTextFiles(value, workspace) {
  if (Array.isArray(value)) return Promise.all(value.map(item => resolveTextFiles(item, workspace)));
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$text === 'string') {
      return readFile(await workspace.pathFor(value.$text, { allowMissing: false }), 'utf8');
    }
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await resolveTextFiles(item, workspace)])));
  }
  return value;
}

async function main() {
  const [root, name, input] = process.argv.slice(2);
  if (root === '--describe') {
    const selected = name ? TOOL_DEFINITIONS.find(tool => tool.name === name) : TOOL_DEFINITIONS;
    if (!selected) throw new Error(`Unknown tool: ${name}`);
    console.log(JSON.stringify(selected, null, 2));
    return;
  }
  if (!root || !name) throw new Error('Usage: node scripts/atlas-call.mjs WORKSPACE TOOL [ARGUMENTS.json|-]; omit input or use - to read JSON from stdin.');
  const workspace = await new Workspace(resolve(root)).initialize();
  let source;
  if (!input || input === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    source = Buffer.concat(chunks).toString('utf8');
  } else source = await readFile(resolve(input), 'utf8');
  const args = await resolveTextFiles(JSON.parse(source), workspace);
  const run = await workspace.startRun('tool-call');
  const result = await createToolRegistry({ workspace, run }).execute(name, args);
  console.log(JSON.stringify(result.ok ? result.result : result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

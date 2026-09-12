#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createToolRegistry } from './tools.mjs';
import { Workspace, resolveWorkspaceRoot } from './workspace.mjs';

function workspaceFlag(argv) {
  const index = argv.indexOf('--workspace');
  if (index === -1) return undefined;
  if (!argv[index + 1]) throw new Error('--workspace requires a path.');
  return argv[index + 1];
}

export async function startMcp({ workspaceRoot = workspaceFlag(process.argv.slice(2)) } = {}) {
  const workspace = await new Workspace(resolveWorkspaceRoot(workspaceRoot)).initialize();
  const run = await workspace.startRun('mcp');
  const registry = createToolRegistry({ workspace, run });
  const server = new Server({ name: 'evidence-atlas', version: '1.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.definitions }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const result = await registry.execute(request.params.name, request.params.arguments || {});
    const content = [{ type: 'text', text: result.modelContent }];
    if (result.vision) content.push({ type: 'image', data: result.vision.data, mimeType: result.vision.mimeType });
    return { content, isError: !result.ok };
  });
  server.onerror = error => { void run.event('mcp_error', { error: error.message || String(error) }); };
  const transport = new StdioServerTransport();
  let finalized = false;
  const finalize = async status => {
    if (finalized) return;
    finalized = true;
    await run.setStatus(status);
    await run.event('mcp_closed', { status });
  };
  transport.onclose = () => { void finalize(run.published ? 'published' : 'closed'); };
  const cancel = async () => {
    await finalize('cancelled');
    await transport.close();
  };
  process.once('SIGINT', () => { void cancel(); });
  process.once('SIGTERM', () => { void cancel(); });
  process.stdin.once('end', () => { void (async () => { await finalize(run.published ? 'published' : 'closed'); await transport.close(); })(); });
  await server.connect(transport);
  await run.event('mcp_connected', { tools: registry.definitions.map(tool => tool.name) });
  return { server, workspace, run, close: async () => { await finalize(run.published ? 'published' : 'closed'); await transport.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startMcp().catch(error => {
    console.error(`Evidence Atlas MCP failed: ${error.message}`);
    process.exitCode = 1;
  });
}

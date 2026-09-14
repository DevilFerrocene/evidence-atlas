#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../packages/core/paths.mjs';
import { startBridge } from '../agent/literature-bridge.mjs';
const legacy = resolve(ROOT, '../Scientist-literature-browser-mcp');
const state = process.env.LITERATURE_STATE_DIR || resolve(legacy, 'state');
process.env.LITERATURE_STATE_DIR = state;
const envFile = process.env.LITERATURE_ENV_FILE || resolve(legacy, '.env');
const compose = ['compose', ...(existsSync(envFile) ? ['--env-file', envFile] : []), '-f', resolve(ROOT, 'modules/literature/docker-compose.yml')];
await startBridge([...process.argv.slice(2), '--', process.env.DOCKER_BIN || '/usr/local/bin/docker', ...compose, 'run', '--rm', '--no-deps', '-T', 'mcp']);

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const WORKSPACE_DIR = resolve(process.env.EVIDENCE_WORKSPACE || resolve(ROOT, 'data/workspace'));
export const DATA_DIR = resolve(process.env.EVIDENCE_DATA_DIR || resolve(WORKSPACE_DIR, 'library/papers'));
export const SOURCE_DIR = resolve(DATA_DIR, '../sources');
export const EXAMPLE_DIR = resolve(ROOT, 'examples/library');

export const LOG_DIR = resolve(process.env.EVIDENCE_LOG_DIR || resolve(ROOT, 'data/logs'));
export const RESEARCH_DIR = resolve(process.env.EVIDENCE_RESEARCH_DIR || resolve(WORKSPACE_DIR, 'research-library'));

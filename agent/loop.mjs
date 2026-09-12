#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createToolRegistry } from './tools.mjs';
import { Workspace, resolveWorkspaceRoot } from './workspace.mjs';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_TURNS = 40;

function fail(message) { throw new Error(message); }
function parseArgs(argv) {
  const values = { inputs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') values.help = true;
    else if (['--task', '--task-file', '--input', '--model', '--base-url', '--workspace', '--config', '--max-turns', '--timeout-ms'].includes(flag)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith('--')) fail(`${flag} requires a value.`);
      if (flag === '--input') values.inputs.push(value);
      else values[flag.slice(2).replaceAll('-', '_')] = value;
    } else fail(`Unknown option: ${flag}`);
  }
  return values;
}
function redactApiKey(value, apiKey) {
  if (typeof value === 'string') return apiKey ? value.split(apiKey).join('[redacted]') : value;
  if (Array.isArray(value)) return value.map(item => redactApiKey(item, apiKey));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactApiKey(item, apiKey)]));
  return value;
}
function usage() {
  return 'Usage: node agent/loop.mjs --task "..." [--input FILE] [--model MODEL] [--base-url URL] [--workspace DIR] [--max-turns N]';
}
async function optionalJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error(`Cannot read agent config: ${error.message}`); }
}
async function resolveConfig(args) {
  const configPath = args.config || process.env.EVIDENCE_AGENT_CONFIG || path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'evidence-atlas', 'agent.json');
  const config = await optionalJson(configPath);
  const apiKey = process.env.EVIDENCE_API_KEY || process.env.OPENAI_API_KEY || config.api_key || config.apiKey;
  const baseUrl = args.base_url || process.env.EVIDENCE_BASE_URL || config.base_url || config.baseUrl || DEFAULT_BASE_URL;
  const model = args.model || process.env.EVIDENCE_MODEL || config.model;
  if (!apiKey) fail('Set EVIDENCE_API_KEY or OPENAI_API_KEY, or put api_key in your user agent config.');
  if (!model) fail('Provide --model, set EVIDENCE_MODEL, or set model in your user agent config.');
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('base URL must be a credential-free http(s) URL.');
  return { apiKey, model, baseUrl: url.toString().replace(/\/$/, ''), configPath };
}
function boundedInteger(value, name, defaultValue, max) {
  const number = value === undefined ? defaultValue : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) fail(`${name} must be an integer from 1 to ${max}.`);
  return number;
}
function timeoutSignal(parent, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason || new Error('Cancelled'));
  if (parent?.aborted) abort(); else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', abort); } };
}
async function callModel(config, body, { signal, timeoutMs }) {
  const timed = timeoutSignal(signal, timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST', signal: timed.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body)
    });
    const raw = await response.text();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { fail(`Model endpoint returned non-JSON HTTP ${response.status}.`); }
    if (!response.ok) fail(redactApiKey(`Model endpoint returned HTTP ${response.status}: ${parsed.error?.message || 'request failed'}`, config.apiKey));
    return parsed;
  } finally { timed.dispose(); }
}
function apiTools(definitions) {
  return definitions.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
}
function systemPrompt() {
  return [
    'You work only through the supplied Evidence Atlas tools and the workspace they expose.',
    'Read the run-local skill and paper schema before authoring or publishing a paper dataset.',
    'Use source URLs and local inputs as evidence, and record actual sources through the tools. Do not claim literature quality, complete coverage, or a result that the available evidence does not support.',
    'A run is successful only after atlas_publish_library has succeeded. Before that, keep working or state the concrete blocker. Never invent tool results.',
    'For image inspection, call atlas_read_image; the image will be attached to the next model turn when supported.'
  ].join(' ');
}
function answerText(message) {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) return message.content.map(item => item.text || '').join('\n');
  return '';
}

export async function runLoop(options = {}) {
  const args = options.args || parseArgs(process.argv.slice(2));
  if (args.help) return { help: usage() };
  if (Boolean(args.task) === Boolean(args.task_file)) fail('Provide exactly one of --task or --task-file.');
  const task = args.task || (await readFile(path.resolve(args.task_file), 'utf8'));
  if (!task.trim()) fail('Task must not be empty.');
  const config = await resolveConfig(args);
  const maxTurns = boundedInteger(args.max_turns, 'max-turns', 12, MAX_TURNS);
  const timeoutMs = boundedInteger(args.timeout_ms, 'timeout-ms', DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const workspace = await new Workspace(resolveWorkspaceRoot(args.workspace)).initialize();
  const run = await workspace.startRun('loop');
  run.secrets.push(config.apiKey);
  const controller = new AbortController();
  const cancel = signal => controller.abort(new Error(`Received ${signal}`));
  const onSigint = () => cancel('SIGINT');
  const onSigterm = () => cancel('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  try {
    const inputs = [];
    for (const input of args.inputs) inputs.push(await run.copyInput(input));
    await run.event('loop_configured', { model: config.model, base_url: config.baseUrl, max_turns: maxTurns, timeout_ms: timeoutMs, inputs });
    const registry = createToolRegistry({ workspace, run });
    const messages = [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: `Task:\n${task}\n\nCurrent run: ${run.relativeDir}. Write new working text only below ${run.relativeDir}/drafts/ or ${run.relativeDir}/sources/. Run-local input files: ${inputs.length ? inputs.join(', ') : '(none)'}` }
    ];
    for (let turn = 1; turn <= maxTurns; turn += 1) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const response = await callModel(config, { model: config.model, messages, tools: apiTools(registry.definitions), tool_choice: 'auto' }, { signal: controller.signal, timeoutMs });
      const message = response.choices?.[0]?.message;
      if (!message) fail('Model endpoint returned no message choice.');
      messages.push(message);
      const calls = message.tool_calls || [];
      await run.event('model_turn', { turn, tool_calls: calls.map(call => call.function?.name).filter(Boolean), has_text: Boolean(answerText(message)) });
      if (!calls.length) {
        const final = answerText(message);
        if (!run.published) {
          await run.setStatus('failed', { reason: 'Model ended without successful validation and publication.', final_response: redactApiKey(final, config.apiKey) });
          return { ok: false, run: run.relativeDir, reason: 'Model ended without successful validation and publication.', response: redactApiKey(final, config.apiKey) };
        }
        await run.setStatus('succeeded', { final_response: redactApiKey(final, config.apiKey) });
        return { ok: true, run: run.relativeDir, response: redactApiKey(final, config.apiKey) };
      }
      const visionResults = [];
      for (const call of calls) {
        let argumentsValue;
        try { argumentsValue = JSON.parse(call.function.arguments || '{}'); }
        catch { argumentsValue = {}; }
        const toolTimed = timeoutSignal(controller.signal, timeoutMs);
        let result;
        try { result = await registry.execute(call.function.name, argumentsValue, { signal: toolTimed.signal }); }
        finally { toolTimed.dispose(); }
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.modelContent });
        if (result.vision) visionResults.push(result);
      }
      for (const result of visionResults) messages.push({ role: 'user', content: [
        { type: 'text', text: `The requested workspace image is attached. Its tool result was: ${result.modelContent}` },
        { type: 'image_url', image_url: { url: `data:${result.vision.mimeType};base64,${result.vision.data}` } }
      ] });
    }
    if (run.published) {
      await run.setStatus('succeeded', { reason: 'Validation and publication completed before the turn limit.' });
      return { ok: true, run: run.relativeDir, response: 'Validation and publication completed.' };
    }
    await run.setStatus('failed', { reason: `Reached max_turns (${maxTurns}) without successful validation and publication.` });
    return { ok: false, run: run.relativeDir, reason: `Reached max_turns (${maxTurns}) without successful validation and publication.` };
  } catch (error) {
    const reason = redactApiKey(error instanceof Error ? error.message : String(error), config.apiKey);
    const status = controller.signal.aborted ? 'cancelled' : 'failed';
    await run.setStatus(status, { reason });
    await run.event('run_finished', { status, reason });
    return { ok: false, run: run.relativeDir, reason, cancelled: status === 'cancelled' };
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runLoop().then(result => {
    if (result.help) console.log(result.help);
    else console.log(JSON.stringify(result, null, 2));
    if (!result.ok && !result.help) process.exitCode = 1;
  }).catch(error => {
    console.error(`Evidence Atlas agent failed: ${error.message}`);
    process.exitCode = 1;
  });
}

import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DATA_DIR = process.env.EVIDENCE_DATA_DIR ? resolve(process.env.EVIDENCE_DATA_DIR) : resolve(ROOT, 'data/papers');
export const SOURCE_DIR = resolve(DATA_DIR, '../sources');
export const schema = JSON.parse(await readFile(resolve(ROOT, 'schemas/paper.schema.json'), 'utf8'));
const checkShape = new Ajv({ allErrors: true, strict: true }).compile(schema);

export function validateDataset(data) {
  if (!checkShape(data)) return { valid: false, errors: checkShape.errors.map(e => `${e.instancePath || '/'} ${e.message}`) };
  const errors = [];
  const index = (items, name) => {
    const map = new Map();
    for (const item of items) {
      if (map.has(item.id)) errors.push(`Duplicate ${name} id: ${item.id}`);
      map.set(item.id, item);
    }
    return map;
  };
  const paragraphs = index(data.paragraphs, 'paragraph');
  const segments = index(data.paragraphs.flatMap(p => p.segments), 'segment');
  const claims = index(data.claims, 'claim');
  const evidence = index(data.evidence, 'evidence');
  const sources = index(data.sources, 'source');
  const requireRef = (map, id, from) => { if (!map.has(id)) errors.push(`${from}: missing reference ${id}`); };
  for (const p of data.paper.sections || []) requireRef(paragraphs, p.paragraph_id, 'section');
  for (const s of segments.values()) {
    if (!s.claim_ids.length && (s.kind !== 'context' || !s.exclusion_reason)) errors.push(`${s.id}: unannotated text needs context kind and exclusion_reason`);
    for (const id of s.claim_ids) {
      requireRef(claims, id, s.id);
      if (claims.has(id) && !claims.get(id).segment_ids.includes(s.id)) errors.push(`${s.id}: ${id} lacks reverse anchor`);
    }
  }
  for (const c of claims.values()) {
    for (const id of c.segment_ids) {
      requireRef(segments, id, c.id);
      if (segments.has(id) && !segments.get(id).claim_ids.includes(c.id)) errors.push(`${c.id}: ${id} lacks reverse claim`);
    }
    for (const id of c.evidence_ids) requireRef(evidence, id, c.id);
    for (const paragraph of c.story) for (const id of paragraph.evidence_ids) requireRef(evidence, id, c.id);
    for (const f of c.findings || []) for (const id of f.evidence_ids) requireRef(evidence, id, c.id);
  }
  for (const e of evidence.values()) {
    if (e.source_id !== null) requireRef(sources, e.source_id, e.id);
    if (!e.depends_on.length && !e.terminal) errors.push(`${e.id}: leaf must explain where the investigation stops`);
    for (const edge of e.depends_on) requireRef(evidence, edge.evidence_id, e.id);
  }
  const active = new Set(), visited = new Set();
  function visit(id) {
    if (active.has(id)) { errors.push(`Evidence dependency cycle at ${id}; represent a circular citation as a finding, not a circular derivation`); return; }
    if (visited.has(id) || !evidence.has(id)) return;
    active.add(id);
    for (const edge of evidence.get(id).depends_on) visit(edge.evidence_id);
    active.delete(id); visited.add(id);
  }
  for (const id of evidence.keys()) visit(id);
  return { valid: !errors.length, errors, stats: coverage(data) };
}

export function coverage(data) {
  const segments = data.paragraphs.flatMap(p => p.segments);
  const annotated = segments.filter(s => s.claim_ids.length).length;
  const excluded = segments.length - annotated;
  const statuses = {};
  for (const c of data.claims) statuses[c.assessment] = (statuses[c.assessment] || 0) + 1;
  return { paragraphs: data.paragraphs.length, segments: segments.length, annotated_segments: annotated, excluded_context_segments: excluded, claims: data.claims.length, sources: data.sources.length, evidence_nodes: data.evidence.length, statuses };
}

export async function readDataset(path) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  const result = validateDataset(data);
  if (!result.valid) throw new Error(`${basename(path)}: ${result.errors.join('; ')}`);
  return data;
}

export async function loadLibrary(directory = DATA_DIR) {
  const files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
  const library = new Map();
  for (const file of files) {
    const data = await readDataset(resolve(directory, file));
    if (library.has(data.paper.id)) throw new Error(`Duplicate paper id: ${data.paper.id}`);
    for (const source of data.sources.filter(s => s.local_path)) {
      const location = resolve(directory, '..', source.local_path);
      if (!(await stat(location)).isFile()) throw new Error(`Local source is not a file: ${source.local_path}`);
    }
    library.set(data.paper.id, data);
  }
  return library;
}

export function getClaimDetail(data, id) {
  const claim = data.claims.find(c => c.id === id);
  if (!claim) return null;
  const map = new Map(data.evidence.map(e => [e.id, e]));
  const reached = new Set();
  function walk(eid) {
    if (reached.has(eid)) return;
    reached.add(eid);
    for (const edge of map.get(eid).depends_on) walk(edge.evidence_id);
  }
  for (const eid of [...claim.evidence_ids, ...claim.story.flatMap(p => p.evidence_ids), ...(claim.findings || []).flatMap(f => f.evidence_ids)]) walk(eid);
  const evidence = [...reached].map(eid => map.get(eid));
  const sourceIds = new Set(evidence.map(e => e.source_id));
  return { claim, evidence, sources: data.sources.filter(s => sourceIds.has(s.id)) };
}

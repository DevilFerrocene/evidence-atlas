import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { resolve, basename, relative, isAbsolute } from 'node:path';
import { ROOT, DATA_DIR, SOURCE_DIR } from './paths.mjs';
export { ROOT, DATA_DIR, SOURCE_DIR } from './paths.mjs';
import Ajv from 'ajv';

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
  const figures = index(data.figures || [], 'figure');
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
    for (const paragraph of c.story || []) for (const id of paragraph.evidence_ids) requireRef(evidence, id, c.id);
    for (const f of c.findings || []) for (const id of f.evidence_ids) requireRef(evidence, id, c.id);
  }
  for (const e of evidence.values()) {
    if (e.source_id !== null) requireRef(sources, e.source_id, e.id);
    if (!e.depends_on.length && !e.terminal) errors.push(`${e.id}: leaf must explain where the investigation stops`);
    for (const edge of e.depends_on) requireRef(evidence, edge.evidence_id, e.id);
  }
  for (const figure of figures.values()) {
    requireRef(sources, figure.source_id, figure.id);
    requireRef(paragraphs, figure.placement.paragraph_id, figure.id);
    requireRef(segments, figure.placement.after_segment_id, figure.id);
    const placementParagraph = paragraphs.get(figure.placement.paragraph_id);
    if (placementParagraph && !placementParagraph.segments.some(s => s.id === figure.placement.after_segment_id)) errors.push(`${figure.id}: placement segment must belong to its placement paragraph`);
    if (sources.has(figure.source_id) && sources.get(figure.source_id).local_path !== figure.original_path) errors.push(`${figure.id}: original_path must be the local asset of its source`);
    const featureMap = index(figure.features, `${figure.id} feature`);
    const featureIds = new Set();
    const rect = (r, label) => {
      if (r.x + r.width > 1.000001 || r.y + r.height > 1.000001) errors.push(`${label}: rectangle exceeds image bounds`);
    };
    rect(figure.crop, `${figure.id} crop`);
    if (figure.page_crop) rect(figure.page_crop, `${figure.id} page crop`);
    for (const feature of figure.features) {
      if (featureIds.has(feature.id)) errors.push(`${figure.id}: duplicate feature id ${feature.id}`);
      featureIds.add(feature.id);
      for (const id of feature.evidence_ids || []) requireRef(evidence, id, `${figure.id}/${feature.id}`);
      if (feature.geometry.width === undefined || feature.geometry.height === undefined) errors.push(`${figure.id}/${feature.id}: reading-aid rectangle needs width and height`);
      for (const region of feature.regions || [feature.geometry]) {
        if (region.width === undefined || region.height === undefined) errors.push(`${figure.id}/${feature.id}: each reading-aid region needs width and height`);
        rect(region, `${figure.id}/${feature.id}`);
      }
      const regionIds = (feature.regions || []).map(r => r.id);
      if (new Set(regionIds).size !== regionIds.length) errors.push(`${figure.id}/${feature.id}: duplicate region id`);
      for (const child of feature.children || []) {
        const childId = typeof child === 'string' ? child : child.id;
        requireRef(featureMap, childId, `${figure.id}/${feature.id}`);
        const childRegions = new Set((featureMap.get(childId)?.regions || []).map(r => r.id));
        for (const regionId of typeof child === 'object' ? child.region_ids || [] : []) {
          if (!childRegions.has(regionId)) errors.push(`${figure.id}/${feature.id}: missing child region ${regionId}`);
        }
      }
    }
    const visiting = new Set(), done = new Set();
    function visitFeature(id) {
      if (visiting.has(id)) { errors.push(`${figure.id}: feature hierarchy cycle at ${id}`); return; }
      if (done.has(id) || !featureMap.has(id)) return;
      visiting.add(id);
      for (const child of featureMap.get(id).children || []) visitFeature(typeof child === 'string' ? child : child.id);
      visiting.delete(id); done.add(id);
    }
    for (const id of featureMap.keys()) visitFeature(id);
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
  return { paragraphs: data.paragraphs.length, segments: segments.length, annotated_segments: annotated, excluded_context_segments: excluded, claims: data.claims.length, sources: data.sources.length, figures: (data.figures || []).length, evidence_nodes: data.evidence.length, statuses };
}

export async function readDataset(path) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  const result = validateDataset(data);
  if (!result.valid) throw new Error(`${basename(path)}: ${result.errors.join('; ')}`);
  return data;
}

export async function loadLibrary(directory = DATA_DIR) {
  let files;
  try { files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort(); }
  catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
  const library = new Map();
  const base = await realpath(resolve(directory, '..'));
  for (const file of files) {
    const paperPath = await realpath(resolve(directory, file));
    const paperRelative = relative(base, paperPath);
    if (paperRelative.startsWith('..') || isAbsolute(paperRelative)) throw new Error(`Paper is outside the library: ${file}`);
    const data = await readDataset(paperPath);
    if (library.has(data.paper.id)) throw new Error(`Duplicate paper id: ${data.paper.id}`);
    for (const source of data.sources.filter(s => s.local_path)) {
      const location = await realpath(resolve(directory, '..', source.local_path));
      const rel = relative(base, location);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Local source is outside the library: ${source.local_path}`);
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
  for (const eid of [...claim.evidence_ids, ...(claim.story || []).flatMap(p => p.evidence_ids), ...(claim.findings || []).flatMap(f => f.evidence_ids)]) walk(eid);
  const evidence = [...reached].map(eid => map.get(eid));
  const sourceIds = new Set(evidence.map(e => e.source_id));
  return { claim, evidence, sources: data.sources.filter(s => sourceIds.has(s.id)) };
}

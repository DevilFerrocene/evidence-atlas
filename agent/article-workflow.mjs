import { readSourceFile, sourceIdentity, sourceKey, sourceAccess, sourceContent, normalizeSourceBlocks } from './source-cache.mjs';
import { resolveEvidenceQuote } from '../packages/core/evidence-quote.mjs';
import { anchoredParagraphs } from '../packages/core/claim-anchors.mjs';
import { referenceClues, referenceMarks, missingReferenceMarks } from '../packages/core/article-references.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { loadImage } from '@napi-rs/canvas';
import { importArticle } from '../packages/core/article-import.mjs';
import { validateDataset } from '../packages/core/dataset.mjs';
import { publishBundle } from '../packages/core/library.mjs';

const normalize = text => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
const pair = (state, original, translation) => state.language === 'en' ? { en: original, zh: translation } : { zh: original, en: translation };
const directory = id => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Use article_id or source_article_id returned by the article tools.');
  return `articles/${id}`;
};
const numberedFigures = state => state.blocks.filter(b => b.figure?.number).map(b => Number(b.figure.number));
function selectBlocks(state, ids) {
  return ids.map(id => {
    const block = state.blocks.find(b => b.id === id);
    if (!block) throw new Error(`Unknown source block ${id}. Read the article to get its IDs.`);
    return block;
  });
}
function summary(state) {
  const translationBlocks = state.blocks.filter(block => block.kind !== 'page_misc');
  return { article_id: state.id, paper_id: state.metadata.paper_id, blocks: state.blocks.length,
    translation_blocks: translationBlocks.length, translated: translationBlocks.filter(block => block.translation).length,
    figures: state.blocks.filter(b => b.figure).length, attached_figures: Object.keys(state.images).length,
    evidence: state.evidence.length, annotations: state.claims.length,
    reference_clue_count: referenceClues(state.blocks).length,
    next_untranslated: translationBlocks.find(block => !block.translation)?.id || null };
}
function translationReferenceNotes(state, ids) {
  return state.blocks.filter(block => ids.includes(block.id)).flatMap(block => {
    const marks = missingReferenceMarks(block, block.translation, state.blocks);
    return marks.length ? [{ block_id: block.id, missing_marks: marks, source_context: block.original.slice(0, 1000) }] : [];
  });
}
function blockers(state) {
  const gaps = [];
  const add = (kind, items) => { if (items.length) gaps.push({ kind, count: items.length, ids: items.slice(0, 30) }); };
  add('missing_translation', state.blocks.filter(b => b.kind !== 'page_misc' && !b.translation).map(b => b.id));




  return gaps;
}

export function createArticleWorkflow({ workspace, run, fetchImage }) {
  const load = async id => {
    const state = JSON.parse(await workspace.readText(`${directory(id)}/state.json`, { maxBytes: 20_000_000 }));
    if (!state.source_access) {
      const raw = await workspace.readText(`${directory(id)}/source.raw`, { maxBytes: 20_000_000 }).catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
      if (raw.trimStart().startsWith('{')) {
        const article = JSON.parse(raw);
        if (article.access_state || article.access || article.success === false || article.text_truncated || article.article_html_truncated || article.truncated) state.source_access = sourceAccess(article);
      }
      state.source_access ||= 'provided_full_text';
    }
    return state;
  };
  const drafts = async () => {
    let listing;
    try { listing = await workspace.list('articles', { limit: 100 }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const states = [];
    for (const entry of listing.entries.filter(item => item.type === 'directory' && /^[a-f0-9-]{36}$/.test(item.path))) {
      try { states.push(await load(entry.path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return states.sort((a, b) => b.created.localeCompare(a.created));
  };
  const save = async state => {
    const base = directory(state.id), temporary = `${base}/state-${randomUUID()}.tmp`;
    await workspace.writeBuffer(temporary, Buffer.from(JSON.stringify(state)));
    await rename(await workspace.pathFor(temporary), await workspace.pathFor(`${base}/state.json`));
  };
  const edit = async (id, operation) => {
    const lock = await workspace.pathFor(`${directory(id)}/.lock`);
    const deadline = Date.now() + 5000;
    while (true) {
      try { await mkdir(lock); break; } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) return { article_id: id, status: 'busy', saved: false, next: 'Article update still running; retry this operation shortly.' };
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    try { const state = await load(id); const result = await operation(state); await save(state); return result; }
    finally { await rm(lock, { recursive: true, force: true }); }
  };
  const sourceRecord = (state, id, localPath) => ({ id, title: state.metadata.title[state.language],
    authors: state.metadata.authors.length ? state.metadata.authors.join('; ') : 'Authors not supplied', year: state.metadata.year,
    ...(state.metadata.url ? { url: state.metadata.url } : {}), ...(state.metadata.doi ? { doi: state.metadata.doi } : {}),
    type: state.source_access === 'abstract_only' ? 'article abstract' : state.source_access === 'metadata_only' ? 'bibliographic metadata' : 'article text',
    access: state.source_access || 'provided_full_text', retrieved_at: state.created.slice(0, 10),
    note: state.metadata.edition, local_path: localPath });

  const sourceResult = (state, reused) => ({ source_article_id: state.id, article_id: state.id, reused,
    title: state.metadata.title, authors: state.metadata.authors, year: state.metadata.year, doi: state.metadata.doi,
    url: state.metadata.url, access: state.source_access, block_count: state.blocks.length,
    reference_clues: referenceClues(state.blocks).slice(0, 5),
    blocks: state.blocks.slice(0, 6).map(block => ({ id: block.id, locator: block.locator, original: block.original.slice(0, 900) })),
    next_after: state.blocks.length > 6 ? state.blocks[5].id : null, warnings: state.warnings,
    next: 'Use source_article_id and these block IDs in atlas_record_evidence. Read/search only further passages needed with atlas_read_article; upstream sources do not require translation or review registration.' });
  const importSource = async args => {
    const { article, input } = await readSourceFile(workspace, args.source_path);
    for (const field of ['url', 'title', 'authors', 'year']) if (args[field] !== undefined) article[field] = args[field];
    if (args.access) article.access_state = args.access;
    const identity = sourceIdentity(article), key = sourceKey(article);
    for (const field of ['url', 'title', 'authors', 'year']) if (args[field] !== undefined) identity[field] = args[field];
    const parsed = sourceContent(article, args);
    if (!parsed.blocks.length) return { imported: false, source_path: args.source_path, access: parsed.access, title: identity.title,
      warnings: parsed.warnings, next: 'No source text was available in this saved response. A failed retrieval remains unavailable; use another saved source or refresh its retrieval.' };
    const content = normalizeSourceBlocks(parsed.blocks);
    for (const previous of await drafts()) {
      if (key && (previous.source_key || sourceKey({ ...previous.metadata, title: previous.metadata.title?.en })) !== key) continue;
      if (normalizeSourceBlocks(previous.blocks) !== content) continue;
      if (previous.source_access && previous.source_access !== parsed.access) continue;
      return sourceResult(previous, true);
    }
    const id = randomUUID(), base = directory(id), title = identity.title || path.basename(args.source_path);
    const scope = { full_text: ['Saved article full text', '已取得的论文全文'], provided_full_text: ['Provided full text', '已提供的全文'],
      abstract_only: ['Saved article abstract', '已取得的论文摘要'], metadata_only: ['Saved bibliographic metadata', '已取得的书目信息'],
      provided_excerpt: ['Saved source excerpt', '已取得的来源片段'] }[parsed.access];
    const state = { id, purpose: 'source', source_access: parsed.access, source_key: key,
      metadata: { paper_id: `source-${id}`, title: { en: title, zh: title }, authors: identity.authors, year: identity.year,
        doi: identity.doi, url: identity.url, citation: [identity.authors.join('; '), title, identity.journal, identity.year, identity.doi].filter(Boolean).join('. '),
        edition: { en: scope[0], zh: scope[1] } },
      language: identity.language, created: article.cached_at || article.fetched_at || new Date().toISOString(), source_path: args.source_path, format: parsed.format,
      blocks: parsed.blocks, warnings: parsed.warnings, evidence: [], claims: [], images: {}, seen: { translation: [], evidence: [] } };
    await workspace.writeBuffer(`${base}/source.raw`, Buffer.from(input));
    await workspace.writeBuffer(`${base}/source-blocks.json`, Buffer.from(JSON.stringify(parsed.blocks)));
    await save(state);
    return sourceResult(state, false);
  };
  const resolveSource = async (id, sourcePath) => {
    if (sourcePath) {
      const imported = await importSource({ source_path: sourcePath });
      return imported.source_article_id ? { state: await load(imported.source_article_id) } : { result: imported };
    }
    try { return { state: await load(id) }; }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        const imported = await importSource({ source_path: `literature/${id}/article.json` });
        return imported.source_article_id ? { state: await load(imported.source_article_id) } : { result: imported };
      } catch (sourceError) {
        if (sourceError.code !== 'ENOENT') throw sourceError;
        return { result: { imported: false, status: 'source_not_found', source_article_id: id,
          next: 'Use atlas_import_source with the saved source_path, or literature_read_saved({query}) to find its cache.' } };
      }
    }
  };

  async function assemble(state) {
    const base = `${directory(state.id)}/bundle`;
    const text = state.blocks.filter(b => b.kind !== 'page_misc').map(b => b.original).join('\n\n');
    await workspace.writeBuffer(`${base}/sources/original.txt`, Buffer.from(text));
    const sources = [sourceRecord(state, 'source-main', 'sources/original.txt')];
    const evidence = [];
    for (const item of state.evidence) {
      let sourceId = 'source-main';
      if (item.source_article_id !== state.id) {
        sourceId = `source-${item.source_article_id}`;
        if (!sources.some(s => s.id === sourceId)) {
          const source = await load(item.source_article_id);
          const localPath = `sources/${sourceId}.txt`;
          await workspace.writeBuffer(`${base}/${localPath}`, Buffer.from(source.blocks.map(b => b.original).join('\n\n')));
          sources.push(sourceRecord(source, sourceId, localPath));
        }
      }
      evidence.push({ id: item.id, source_id: sourceId, locator: item.locator, quote: item.quote,
        role: 'source evidence', relation: 'supports the attached interpretation', finding: item.finding, method: item.method,
        depends_on: item.depends_on.map(id => ({ evidence_id: id, relation: 'depends on', label: { en: 'Supporting evidence', zh: '依据' } })),
        ...(!item.depends_on.length ? { terminal: { kind: 'source-observation', reason: item.stop_reason } } : {}) });
    }
    const figures = [];
    for (const block of state.blocks.filter(b => b.figure)) {
      const image = state.images[block.id];
      if (!image) {
        const full = pair(state, block.original, block.translation);
        figures.push({ id: `figure-${block.id}`, number: { en: `Figure ${block.figure.number || ''}`.trim(), zh: `图 ${block.figure.number || ''}`.trim() },
          source_id: 'source-main', availability: 'missing', source_url: block.figure.url || state.metadata.url,
          ...(state.figureAccess?.[block.id] ? { access_detail: state.figureAccess[block.id].reason } : {}),
          caption: full, full_caption: full, source_note: state.metadata.edition,
          placement: { paragraph_id: block.id, after_segment_id: `s-${block.id}` },
          crop: { x: 0, y: 0, width: 1, height: 1 }, features: [] });
        continue;
      }
      const localPath = `sources/${block.id}${path.extname(image.path)}`, sourceId = `source-${block.id}`;
      await workspace.writeBuffer(`${base}/${localPath}`, await workspace.readBuffer(image.path, { maxBytes: 12_000_000 }));
      sources.push({ ...sourceRecord(state, sourceId, localPath), type: 'article figure', url: image.url || state.metadata.url });
      const full = pair(state, block.original, block.translation);
      figures.push({ id: `figure-${block.id}`, number: { en: `Figure ${block.figure.number || ''}`.trim(), zh: `图 ${block.figure.number || ''}`.trim() },
        source_id: sourceId, original_path: localPath, image_size: { width: image.width, height: image.height },
        caption: full, full_caption: full, source_note: state.metadata.edition,
        placement: { paragraph_id: block.id, after_segment_id: `s-${block.id}` },
        crop: { x: 0, y: 0, width: 1, height: 1 }, features: (image.marks || []).map(({ parent_id, ...mark }) => ({
          ...mark, children: (image.marks || []).filter(child => child.parent_id === mark.id).map(child => child.id)
        })) });
    }
    const { paragraphs, claims } = anchoredParagraphs(state);
    for (const figure of figures) figure.placement.after_segment_id = paragraphs.find(p => p.id === figure.placement.paragraph_id).segments.at(-1).id;
    const meta = state.metadata;
    const bundle = { schema_version: '1.0', paper: {
      id: meta.paper_id, title: meta.title, authors: meta.authors, year: meta.year, citation: meta.citation,
      source_url: meta.url, rights: meta.rights, edition: meta.edition,
      scope: { en: 'Full bilingual article with annotations at the selected passages.', zh: '完整双语论文，在所选段落附有解读。' },
      audited_at: new Date().toISOString().slice(0, 10), full_text: { source_id: 'source-main', language: state.language },
      sections: state.blocks.filter(b => b.kind === 'heading').map(b => ({ id: `section-${b.id}`, label: pair(state, b.original, b.translation), paragraph_id: b.id }))
    }, paragraphs, claims, evidence, sources, figures };
    const result = validateDataset(bundle);
    if (!result.valid) throw new Error(`Assembly failed: ${result.errors.slice(0, 8).join('; ')}`);
    await workspace.writeBuffer(`${base}/paper.json`, Buffer.from(JSON.stringify(bundle)));
    return base;
  }

  const snapshot = async state => {
    const { seen, sourceReview, ...content } = state;
    content.blocks = state.blocks.map(({ reviewed, ...block }) => block);
    content.evidence = state.evidence.map(({ reviewed, ...item }) => item);
    const upstream = [];
    for (const id of [...new Set(state.evidence.map(e => e.source_article_id))].filter(id => id !== state.id)) {
      const source = await load(id);
      upstream.push({ id, metadata: source.metadata, blocks: source.blocks.map(({ translation, reviewed, ...block }) => block) });
    }
    return JSON.stringify({ content, upstream });
  };
  const deliver = args => edit(args.article_id, async state => {
    const gaps = blockers(state);
    if (gaps.length) return { published: false, article_id: state.id, blockers: gaps };
    if (args.expected !== undefined && args.expected !== await snapshot(state)) {
      return { blockers: [{ kind: 'changed_during_review', detail: 'The article or an upstream source changed. Return revise and review the new draft.' }] };
    }
    const frozen = JSON.parse(await workspace.readText(`${directory(state.id)}/source-blocks.json`, { maxBytes: 20_000_000 }));
    for (const block of frozen) {
      const correction = state.sourceCorrections?.[block.id];
      if (correction) { block.kind = correction.kind; if (correction.figure) block.figure = correction.figure; else delete block.figure;
        if (correction.reference !== undefined) block.reference = correction.reference; }
    }
    if (JSON.stringify(frozen) !== JSON.stringify(state.blocks.map(({ translation, reviewed, ...block }) => block))) throw new Error('Source blocks changed after import. Prepare from the corrected source instead of rewriting original blocks.');
    const base = await assemble(state);
    const result = { article_id: state.id, paper_id: state.metadata.paper_id, bundle_path: `${base}/paper.json`, published: false };
    run.validated = true;
    if (!args.publish) return result;
    const output = await publishBundle({ file: await workspace.pathFor(`${base}/paper.json`), sourceDir: await workspace.pathFor(base),
      dataDir: await workspace.pathFor('library/papers'), replace: Boolean(args.replace) });
    run.published = true;
    if (run.kind === 'mcp') await run.setStatus('published', { id: output.id });
    return { ...result, published: true, reader_url: `http://127.0.0.1:4317/?paper=${encodeURIComponent(output.id)}`, ...summary(state) };
  });

  return {
    atlas_repair_import: args => edit(args.article_id, async state => {
      const ids = args.corrections.map(c => c.block_id);
      if (new Set(ids).size !== ids.length) throw new Error('Provide each block once per correction batch.');
      selectBlocks(state, ids);
      const images = { ...state.images };
      for (const c of args.corrections) {
        if (!['body', 'caption', 'heading', 'equation', 'table', 'footnote', 'page_misc'].includes(c.kind)) throw new Error('Unsupported block kind.');
        if (c.kind === 'page_misc' && (state.claims.some(item => item.block_ids.includes(c.block_id)) || state.evidence.some(item => item.block_ids?.includes(c.block_id))))
          throw new Error(`${c.block_id} has scientific annotations or evidence. Retarget these through their update tools before excluding it.`);
        if (c.image_from_block_id && (c.kind !== 'caption' || !images[c.image_from_block_id])) throw new Error('Choose an attached source image and a caption destination.');
      }
      state.sourceCorrections ||= {};
      for (const c of args.corrections) {
        const block = state.blocks.find(b => b.id === c.block_id);
        block.kind = c.kind;
        if (c.reference !== undefined) block.reference = c.reference;
        if (c.kind === 'caption') {
          block.figure = { ...(block.figure || { url: null }), number: c.figure_number === undefined ? block.figure?.number || null : c.figure_number };
          if (c.image_from_block_id) state.images[block.id] = images[c.image_from_block_id];
        } else { delete block.figure; delete state.images[block.id]; }
        state.sourceCorrections[block.id] = { kind: block.kind, figure: block.figure || null,
          ...(block.reference !== undefined ? { reference: block.reference } : {}) };
      }
      delete state.sourceReview;
      return { ...summary(state), repaired: ids, next: 'Review corrected source structure, then continue the saved task.', blockers: blockers(state) };
    }),
    snapshotArticle: async id => snapshot(await load(id)),
    deliverArticle: deliver,
    atlas_import_source: importSource,
    atlas_prepare_article: async args => {
      const { input, article: source } = await readSourceFile(workspace, args.source_path);
      for (const previous of await drafts()) {
        if (previous.language === args.language && (!args.format || previous.format === args.format) &&
            Object.entries(previous.metadata).every(([key, value]) => JSON.stringify(value) === JSON.stringify(args[key])) &&
            await workspace.readText(`${directory(previous.id)}/source.raw`, { maxBytes: 20_000_000 }) === input) {
          return { ...summary(previous), reused: true, warnings: previous.warnings, next: 'atlas_read_article' };
        }
      }
      const parsed = importArticle(input, args);
      if (source.extraction_notice) parsed.warnings.push(source.extraction_notice);
      if (source.extraction_warning) parsed.warnings.push(source.extraction_warning);
      const oversized = parsed.blocks.find(b => b.original.length > 20000);
      if (oversized) parsed.warnings.push(`${oversized.id} exceeds 20,000 characters. Source preserved; inspect paragraph boundaries before translating this block.`);
      const id = randomUUID(), base = directory(id);
      const { source_path, selector, format, language, ...metadata } = args;
      const url = new URL(metadata.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Provide a credential-free publisher http(s) URL.');
      let source_access = 'provided_full_text';
      if (input.trimStart().startsWith('{')) {
        const wrapper = JSON.parse(input);
        if (wrapper.access_state || wrapper.access || wrapper.success === false || wrapper.text_truncated || wrapper.article_html_truncated || wrapper.truncated) source_access = sourceAccess(wrapper);
      }
      const state = { id, metadata, language, source_access, created: new Date().toISOString(), source_path, format: parsed.format,
        blocks: parsed.blocks.map(block => block.reference || block.kind === 'equation'
          ? { ...block, translation: block.original, reviewed: 'Preserved verbatim by the tool.' } : block),
        warnings: parsed.warnings, evidence: [], claims: [], images: {}, seen: { translation: [], evidence: [] } };
      await workspace.writeBuffer(`${base}/source.raw`, Buffer.from(input));
      await workspace.writeBuffer(`${base}/source-blocks.json`, Buffer.from(JSON.stringify(parsed.blocks)));
      await save(state);
      return { ...summary(state), reference_clues: referenceClues(state.blocks).slice(0, 5), warnings: state.warnings, next: 'atlas_read_article' };
    },
    atlas_read_article: async args => {
      if (!args.article_id) return { drafts: (await drafts()).slice(0, 20).map(state => ({ ...summary(state), title: state.metadata.title })) };
      const resolved = await resolveSource(args.article_id);
      if (!resolved.state) return resolved.result;
      return edit(resolved.state.id, async state => {
      const view = args.view || (state.purpose === 'source' ? 'all' : 'pending'), budget = args.max_chars || 8000;
      if (view === 'outline') return { ...summary(state), warnings: state.warnings,
        outline: state.blocks.filter(b => b.kind === 'heading' || b.figure || b.kind === 'table').map(b => ({ id: b.id, type: b.kind, text: b.original.slice(0, 180), image_url: b.figure?.url, figure_index: b.figure?.figure_index,
          ...(state.images[b.id] ? { image_path: state.images[b.id].path, marks: state.images[b.id].marks || [] } : {}) })) };
      let items;
      if (view === 'evidence') {
        items = [];
        for (const item of state.evidence.filter(item => args.block_ids || args.query || !item.reviewed)) {
          const source = item.source_article_id === state.id ? state : await load(item.source_article_id);
          items.push({ id: item.id, source_url: source.metadata.url, locator: item.locator, quote: item.quote,
            finding: item.finding, method: item.method, depends_on: item.depends_on, stop_reason: item.stop_reason,
            source_blocks: selectBlocks(source, item.block_ids).map(b => ({ id: b.id, original: b.original })),
            annotations: state.claims.filter(c => c.evidence_ids.includes(item.id)).map(c => ({ title: c.title, explanation: c.explanation, anchors: c.anchors, summary: c.summary, why: c.why, limits: c.limits })), reviewed: Boolean(item.reviewed) });
        }
      } else if (view === 'references') {
        items = referenceClues(state.blocks).map(clue => {
          const block = state.blocks.find(item => item.id === clue.block_id);
          return { id: block.id, type: block.kind, reference_kind: clue.kind, original: block.original,
            translation: block.translation || null, reference_marks: referenceMarks(block, state.blocks) };
        });
      } else items = state.blocks.filter(b => view === 'pending' ? b.kind !== 'page_misc' && !b.translation : view === 'review' ? b.kind !== 'page_misc' && b.translation && !b.reviewed : true)
        .map(b => ({ id: b.id, type: b.kind, original: b.original, translation: b.translation || null,
          ...(b.reference ? { reference: true } : {}),
          ...(referenceMarks(b, state.blocks).length ? { reference_marks: referenceMarks(b, state.blocks) } : {}),
          ...(b.figure ? { figure: { ...b.figure, attached: Boolean(state.images[b.id]) } } : {}),
          ...(b.reference || b.kind === 'equation' ? { preserve_original_allowed: true } : {}),
          ...(view === 'review' ? { numbers: b.original.match(/\d+(?:[.,]\d+)?/g) || [] } : {}) }));
      if (view !== 'evidence') items = items.map(item => ({ ...item,
        annotations: state.claims.filter(c => c.block_ids.includes(item.id)).map(c => ({ claim_id: c.id, title: c.title, anchor: c.anchors?.find(a => a.block_id === item.id) || null }))
      }));
      if (args.block_ids) items = items.filter(b => args.block_ids.includes(b.id));
      if (args.query) items = items.filter(b => JSON.stringify(b).toLowerCase().includes(args.query.toLowerCase()));
      let cursorRecovery;
      if (args.after) {
        const order = new Map((view === 'evidence' ? state.evidence : state.blocks).map((item, index) => [item.id, index]));
        const index = order.get(args.after);
        if (index === undefined) cursorRecovery = 'Unknown cursor; restarted the current view.';
        else {
          const remaining = items.filter(item => order.get(item.id) > index);
          if (!remaining.length && items.length && (view === 'pending' || view === 'review')) {
            cursorRecovery = 'Reached the end; returning outstanding items earlier in the article.';
          } else items = remaining;
        }
      }
      const selected = []; let used = 0;
      for (const item of items) {
        const size = JSON.stringify(item).length;
        if (selected.length && used + size > budget) break;
        selected.push(item); used += size;
        if (used >= budget) break;
      }
      if (view === 'review' || view === 'evidence') {
        const scope = view === 'review' ? 'translation' : 'evidence';
        state.seen[scope] = [...new Set([...state.seen[scope], ...selected.map(b => b.id)])];
      }
      return { article_id: state.id, view, items: selected, next_after: items.length > selected.length ? selected.at(-1)?.id : null,
        remaining_in_view: items.length - selected.length, ...(cursorRecovery ? { cursor_recovery: cursorRecovery } : {}), review_focus: view === 'review' ? 'Compare meaning, negation, direction, numbers, units and qualifiers; numbers alone do not establish translation accuracy.' : undefined };
      });
    },
    atlas_save_translations: async args => edit(args.article_id, async state => {
      const saved = [], issues = [];
      for (const item of args.translations) {
        try {
        const block = selectBlocks(state, [item.block_id])[0];
        if (item.preserve_original && !block.reference && block.kind !== 'equation') throw new Error(`${block.id} is not a bibliography entry or standalone formula; provide its translation.`);
        if (!item.preserve_original && !item.text?.trim()) throw new Error(`${block.id} needs translated text.`);
        if ((item.text?.length || 0) > 60000) throw new Error(`${block.id} translation exceeds 60,000 characters.`);
        if (block.kind === 'table') {
          const shape = text => text.split('\n').filter(line => line.trim()).map(line => line.split('|').length);
          if (JSON.stringify(shape(block.original)) !== JSON.stringify(shape(item.text))) throw new Error(`${block.id}: keep the same table rows and | cell separators while translating each cell.`);
        }
        block.translation = item.preserve_original ? block.original : item.text;
        if (item.preserve_original) block.reviewed = 'Preserved verbatim by the tool.';
        else delete block.reviewed;
        state.seen.translation = state.seen.translation.filter(id => id !== block.id);
        saved.push(block.id);
        } catch (error) { issues.push({ block_id: item.block_id, message: error.message }); }
      }
      const notes = translationReferenceNotes(state, saved);
      return { ...summary(state), saved: saved.length, saved_ids: saved, issues,
        ...(notes.length ? { missing_reference_marks: notes } : {}),
        ...(issues.length ? { next: 'Correct only the listed items; successful translations are saved.' } : {}) };
    }),
    atlas_record_evidence: async args => edit(args.article_id, async state => {
      const resolved = args.source_path || (args.source_article_id && args.source_article_id !== state.id)
        ? await resolveSource(args.source_article_id, args.source_path) : { state };
      if (!resolved.state) return { article_id: state.id, recorded: false, ...resolved.result, input: args };
      const source = resolved.state, sourceId = source.id;
      const requestedBlocks = args.block_ids || [];
      const missing = requestedBlocks.filter(id => !source.blocks.some(b => b.id === id));
      let selected = source.blocks.filter(b => requestedBlocks.includes(b.id));
      if (missing.length || !selected.length) {
        const recovered = args.quote ? resolveEvidenceQuote([], args.quote, source.blocks) : null;
        if (recovered?.status === 'relocated') selected = selectBlocks(source, recovered.block_ids);
        else {
          state.pendingEvidence ||= {};
          const pendingId = args.evidence_id || randomUUID();
          state.pendingEvidence[pendingId] = args;
          const words = (args.quote || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
          const candidates = source.blocks.map(b => ({ block: b, score: words.reduce((n, word) => n + Number(b.original.toLowerCase().includes(word)), 0) }))
            .sort((a, b) => b.score - a.score).slice(0, 6).map(({ block }) => ({ block_id: block.id, locator: block.locator, excerpt: block.original.slice(0, 240) }));
          return { article_id: state.id, status: 'needs_source_selection', saved: true, recorded: false,
            source_article_id: source.id, source_title: source.metadata.title, pending_id: pendingId, unknown_block_ids: missing,
            available_blocks: source.blocks.length, candidates,
            next: 'Draft evidence input retained in pendingEvidence. Read this source_article_id with atlas_read_article (query or outline), then retry with the correct block_ids and original evidence fields. Block IDs belong to their source article, not the destination article.' };
        }
      }
      const resolvedQuote = resolveEvidenceQuote(selected, args.quote, source.blocks);
      const blocks = selectBlocks(source, resolvedQuote.block_ids);
      const id = args.evidence_id || `e${state.evidence.length + 1}`;
      const previous = state.evidence.findIndex(e => e.id === id);
      const existing = state.evidence[previous];
      const dependencies = args.depends_on ?? existing?.depends_on ?? [];
      const unknownDependencies = dependencies.filter(id => !state.evidence.some(e => e.id === id));
      if (unknownDependencies.length) return { article_id: state.id, recorded: false, status: 'needs_dependency', unknown_ids: unknownDependencies, available_evidence: state.evidence.map(e => ({ id: e.id, finding: e.finding })), input: args, next: 'Use an existing evidence ID or record the missing upstream evidence, then retry this input.' };
      if (args.evidence_id && previous < 0) return { article_id: state.id, recorded: false, status: 'needs_evidence_id', available_ids: state.evidence.map(e => e.id), input: args, next: 'Select the existing item to update, or omit evidence_id to create one.' };
      const reaches = (eid, visited = new Set()) => {
        if (eid === id) return true;
        if (visited.has(eid)) return false;
        visited.add(eid);
        return (state.evidence.find(e => e.id === eid)?.depends_on || []).some(next => reaches(next, visited));
      };
      if (dependencies.some(dep => reaches(dep))) throw new Error('Evidence dependency would form a cycle. Describe circular citations as an unresolved finding.');
      const item = { id, source_article_id: sourceId, block_ids: resolvedQuote.block_ids, quote: resolvedQuote.quote, quote_resolution: resolvedQuote.status,
        locator: blocks.map(b => b.locator).join('; '),
        finding: args.finding ?? existing?.finding, method: args.method, stop_reason: args.stop_reason, depends_on: dependencies };
      if (previous < 0) state.evidence.push(item); else state.evidence[previous] = item;
      const affected = new Set([id]);
      let expanded;
      do {
        expanded = false;
        for (const evidence of state.evidence) {
          if (!affected.has(evidence.id) && (evidence.depends_on || []).some(dep => affected.has(dep))) {
            affected.add(evidence.id); expanded = true;
          }
        }
      } while (expanded);
      for (const evidence of state.evidence) if (affected.has(evidence.id)) delete evidence.reviewed;
      state.seen.evidence = state.seen.evidence.filter(eid => !affected.has(eid));
      return { article_id: state.id, evidence_id: id, depends_on: item.depends_on, ...(item.finding ? { finding: item.finding } : {}), source_article_id: sourceId, source_access: source.source_access, quote_resolution: resolvedQuote.status, source_block_ids: resolvedQuote.block_ids, ...(resolvedQuote.note ? { note: resolvedQuote.note, candidates: resolvedQuote.candidates } : {}), next: 'Use this evidence_id in atlas_annotate_article; review the relevant content already available; reread only as needed.' };
    }),
    atlas_annotate_article: async args => edit(args.article_id, async state => {
      const { article_id, annotations, translations = [], ...single } = args;
      const requested = [...(Object.keys(single).length ? [single] : []), ...(annotations || [])];
      const issues = [], affectedBlocks = new Set(translations.map(item => item.block_id));
      const required = ['block_ids', 'anchors', 'evidence_ids', 'explanation', 'assessment'];
      const explicitIds = new Set(), translationIds = new Set();
      for (const [index, item] of requested.entries()) {
        const missing = required.filter(key => item[key] === undefined);
        if (missing.length) { issues.push({ annotation_index: index, kind: 'missing_fields', fields: missing }); continue; }
        if (item.claim_id && explicitIds.has(item.claim_id)) issues.push({ annotation_index: index, kind: 'duplicate_claim_id', claim_id: item.claim_id });
        if (item.claim_id) explicitIds.add(item.claim_id);
        for (const blockId of item.block_ids) affectedBlocks.add(blockId);
        const unknown = item.block_ids.filter(blockId => !state.blocks.some(block => block.id === blockId));
        if (unknown.length) {
          const candidates = state.blocks.filter(block => item.anchors.some(anchor =>
            (anchor[state.language] && block.original.includes(anchor[state.language])) ||
            (anchor[state.language === 'en' ? 'zh' : 'en'] && block.translation?.includes(anchor[state.language === 'en' ? 'zh' : 'en']))));
          issues.push({ annotation_index: index, kind: 'unknown_source_blocks', block_ids: unknown,
            candidates: candidates.slice(0, 6).map(block => ({ block_id: block.id, original: block.original.slice(0, 300) })) });
        }
        if (!item.block_ids.length || item.anchors.length !== item.block_ids.length || new Set(item.anchors.map(anchor => anchor.block_id)).size !== item.block_ids.length || item.anchors.some(anchor => !item.block_ids.includes(anchor.block_id)))
          issues.push({ annotation_index: index, kind: 'anchor_blocks', message: 'Each selected block needs one corresponding bilingual anchor.' });
        const unknownEvidence = item.evidence_ids.filter(id => !state.evidence.some(evidence => evidence.id === id));
        if (unknownEvidence.length) issues.push({ annotation_index: index, kind: 'unknown_evidence', evidence_ids: unknownEvidence,
          available_evidence: state.evidence.map(evidence => ({ id: evidence.id, finding: evidence.finding })).slice(0, 20) });
      }
      for (const item of translations) {
        if (translationIds.has(item.block_id)) issues.push({ kind: 'duplicate_translation', block_id: item.block_id });
        translationIds.add(item.block_id);
        const block = state.blocks.find(block => block.id === item.block_id);
        if (!block) { issues.push({ kind: 'unknown_translation_block', block_id: item.block_id }); continue; }
        if (!item.text?.trim() || item.text.length > 60000) issues.push({ kind: 'translation_text', block_id: item.block_id, message: 'Provide nonempty translated text up to 60,000 characters.' });
        if (block.kind === 'table' && item.text) {
          const shape = text => text.split('\n').filter(line => line.trim()).map(line => line.split('|').length);
          if (JSON.stringify(shape(block.original)) !== JSON.stringify(shape(item.text))) issues.push({ kind: 'table_format', block_id: item.block_id, message: 'Keep the source table rows and | cell separators.' });
        }
      }
      if (!requested.length && !translations.length) issues.push({ kind: 'empty_request', message: 'Supply annotation fields, annotations, or translations to save.' });
      const correction = (status, problems, draft = state) => ({ article_id, saved: false, atomic: true, status, issues: problems,
        blocks: draft.blocks.filter(block => affectedBlocks.has(block.id)).slice(0, 8).map(block => ({ block_id: block.id,
          original: block.original.slice(0, 1600), translation: block.translation?.slice(0, 1600) || null,
          annotations: draft.claims.filter(claim => claim.block_ids.includes(block.id)).map(claim => ({ claim_id: claim.id, anchor: claim.anchors?.find(anchor => anchor.block_id === block.id) || null })) })),
        ...(problems.some(issue => /unknown.*block/.test(issue.kind)) ? { available_blocks: state.blocks.slice(0, 12).map(block => ({ block_id: block.id, original: block.original.slice(0, 120) })) } : {}),
        next: 'Correct the listed local fields and resubmit this request. The draft still contains its previous translations and annotations; no reading or review registration is required.' });
      if (issues.length) return correction('needs_correction', issues);
      const draft = structuredClone(state), usedIds = new Set([...draft.claims.map(claim => claim.id), ...explicitIds]);
      const saved = [], translated = [], changedEvidence = new Set();
      for (const item of translations) {
        const block = draft.blocks.find(block => block.id === item.block_id);
        if (block.translation !== item.text) { block.translation = item.text; delete block.reviewed; translated.push(block.id); }
      }
      for (const fields of requested) {
        let id = fields.claim_id;
        if (!id) { let suffix = 1; while (usedIds.has(`c${suffix}`)) suffix++; id = `c${suffix}`; }
        usedIds.add(id);
        const index = draft.claims.findIndex(claim => claim.id === id);
        if (index >= 0) for (const blockId of draft.claims[index].block_ids) affectedBlocks.add(blockId);
        const { claim_id, ...content } = fields;
        const claim = { id, ...content, limits: [] };
        if (index < 0) draft.claims.push(claim); else draft.claims[index] = claim;
        for (const evidenceId of fields.evidence_ids) changedEvidence.add(evidenceId);
        saved.push({ claim_id: id, created: index < 0, block_ids: fields.block_ids, anchor_count: fields.anchors.length });
      }
      try {
        anchoredParagraphs({ ...draft, blocks: draft.blocks.filter(block => affectedBlocks.has(block.id)),
          claims: draft.claims.filter(claim => claim.block_ids.some(blockId => affectedBlocks.has(blockId))) });
      } catch (error) {
        return correction('needs_anchor_adjustment', [{ kind: 'anchor_text_or_overlap', message: error.message.replace(' Read the current translation and choose an unambiguous quote.', '') }], draft);
      }
      for (const evidence of draft.evidence) if (changedEvidence.has(evidence.id)) delete evidence.reviewed;
      draft.seen.translation = draft.seen.translation.filter(id => !translated.includes(id));
      draft.seen.evidence = draft.seen.evidence.filter(id => !changedEvidence.has(id));
      Object.assign(state, { blocks: draft.blocks, claims: draft.claims, evidence: draft.evidence, seen: draft.seen });
      return { article_id, saved: true, atomic: true, annotations: saved, claim_ids: saved.map(item => item.claim_id),
        ...(saved.length === 1 ? { claim_id: saved[0].claim_id } : {}), translations_saved: translations.map(item => item.block_id),
        ...(translationReferenceNotes(state, translations.map(item => item.block_id)).length
          ? { missing_reference_marks: translationReferenceNotes(state, translations.map(item => item.block_id)) } : {}),
        anchored_blocks: [...new Set(saved.flatMap(item => item.block_ids))], anchor_count: saved.reduce((total, item) => total + item.anchor_count, 0) };
    }),
    atlas_attach_figure: async (args, signal) => edit(args.article_id, async state => {
      const block = selectBlocks(state, [args.block_id])[0];
      if (!block.figure) throw new Error('Choose an imported figure caption block from the outline.');
      const unavailable = reason => {
        state.figureAccess ||= {};
        state.figureAccess[block.id] = { status: 'missing', reason, url: block.figure.url || state.metadata.url };
        return { article_id: state.id, block_id: block.id, attached: false, status: state.images[block.id] ? 'existing_image_retained' : 'missing', caption_preserved: true, publication_allowed: true,
          source_url: block.figure.url || state.metadata.url, reason,
          next: 'Continue writing or supply image_path later. The figure number, caption and source link remain in the published article.' };
      };
      let bytes;
      if (args.image_path) bytes = await workspace.readBuffer(args.image_path, { maxBytes: 12_000_000 });
      else if (block.figure.url) {
        try { bytes = await fetchImage(block.figure.url, signal); }
        catch (error) { return unavailable(error.message); }
      }
      else return unavailable('This source did not include an image URL.');
      const image = await loadImage(bytes);
      if (image.width * image.height > 16_000_000) throw new Error('Image exceeds 16 million pixels; use the publisher reading-size asset.');
      const extension = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? '.png'
        : bytes[0] === 255 && bytes[1] === 216 ? '.jpg'
        : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? '.webp' : null;
      if (!extension) throw new Error('Use an original PNG, JPEG or WebP figure.');
      const output = `${directory(state.id)}/images/${block.id}${extension}`;
      await workspace.writeBuffer(output, bytes);
      const previous = state.images[block.id];
      state.images[block.id] = { path: output, width: image.width, height: image.height, url: block.figure.url,
        ...(previous?.marks?.length ? { previous_marks: previous.marks } : previous?.previous_marks ? { previous_marks: previous.previous_marks } : {}) };
      if (state.figureAccess) delete state.figureAccess[block.id];
      delete state.sourceReview;
      return { article_id: state.id, block_id: block.id, width: image.width, height: image.height, image_path: output };
    }),
    atlas_check_article: async args => {
      const state = await load(args.article_id);
      const gaps = blockers(state);
      const numbers = numberedFigures(state);
      const numbering = numbers.some((number, index) => numbers.indexOf(number) !== index) ||
        [...new Set(numbers)].sort((a, b) => a - b).some((number, index) => number !== index + 1);
      return { ...summary(state), ready_to_publish: !gaps.length, blockers: gaps, review_status: { source_reviewed: Boolean(state.sourceReview), unreviewed_translation: state.blocks.filter(b => b.kind !== 'page_misc' && b.translation && !b.reviewed).map(b => b.id), unreviewed_evidence: state.evidence.filter(e => !e.reviewed).map(e => e.id) }, warnings: [...(state.warnings || []),
        ...(numbering ? ['Figure numbering is nonconsecutive or repeated; compare with the source if needed.'] : [])] };
    },
    atlas_mark_figure: async args => edit(args.article_id, async state => {
      const image = state.images[args.block_id];
      if (!image) throw new Error('Attach and inspect this figure before marking it.');
      const tolerance = 1e-6;
      if (args.x + args.width > 1 + tolerance || args.y + args.height > 1 + tolerance) return { article_id: state.id, saved: false, status: 'needs_region', image_size: { width: image.width, height: image.height }, next: 'Use normalized coordinates between 0 and 1; the whole rectangle must fit within the image.', supplied_region: { x: args.x, y: args.y, width: args.width, height: args.height } };
      args = { ...args, width: Math.min(args.width, 1 - args.x), height: Math.min(args.height, 1 - args.y) };
      for (const id of args.evidence_ids || []) if (!state.evidence.some(e => e.id === id)) throw new Error(`Unknown evidence ${id}.`);
      const marks = image.marks ||= [];
      const id = args.mark_id || `m${marks.length + 1}`;
      const index = marks.findIndex(m => m.id === id);
      if (args.mark_id && index < 0) throw new Error('Unknown mark_id. Omit it to create a mark.');
      if (args.parent_id && !marks.some(m => m.id === args.parent_id)) throw new Error('Unknown parent_id. Create the parent mark first.');
      for (let parent = args.parent_id; parent; parent = marks.find(m => m.id === parent)?.parent_id) {
        if (parent === id) throw new Error('Figure hierarchy would form a cycle.');
      }
      const mark = { id, type: 'region', parent_id: args.parent_id, observation: args.observation, reading: args.reading,
        geometry: { shape: 'rect', x: args.x, y: args.y, width: args.width, height: args.height },
        ...(args.evidence_ids ? { evidence_ids: args.evidence_ids } : {}) };
      if (index < 0) marks.push(mark); else marks[index] = mark;
      delete state.sourceReview;
      return { article_id: state.id, block_id: args.block_id, mark_id: id };
    }),
    atlas_review_article: async args => edit(args.article_id, async state => {
      const issues = []; let reviewedCount = 0;
      if (args.scope === 'source') { state.sourceReview = args.note; reviewedCount = 1; }
      else {
        if (!args.ids?.length) issues.push({ message: 'Provide the IDs actually compared in this review.' });
        for (const id of args.ids || []) {
          const item = (args.scope === 'translation' ? state.blocks : state.evidence).find(b => b.id === id);
          if (!item || (args.scope === 'translation' && !item.translation)) { issues.push({ id, message: 'No reviewable item.' }); continue; }
          item.reviewed = args.note; reviewedCount++;
        }
      }
      return { article_id: state.id, recorded_review: args.scope, reviewed_count: reviewedCount, issues, blockers: blockers(state) };
    }),
    atlas_publish_article: args => deliver({ ...args, publish: true })
  };
}

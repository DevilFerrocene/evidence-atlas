const str = { type: 'string', minLength: 1 };
const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$', maxLength: 100 };
const bi = { type: 'object', properties: { en: str, zh: str }, required: ['en', 'zh'], additionalProperties: false };
const ids = { type: 'array', items: id, minItems: 1, maxItems: 50, uniqueItems: true };
const annotationFields = {
  claim_id: id, block_ids: ids,
  anchors: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: { block_id: id, en: str, zh: str }, required: ['block_id', 'en', 'zh'], additionalProperties: false } },
  evidence_ids: ids, title: { ...bi, description: 'Legacy compatibility field. Omit for new annotations; explanations have no headings.' }, explanation: bi,
  assessment: { enum: ['supported', 'conditional', 'open', 'proposal', 'mixed', 'unsupported', 'miscited', 'outdated'] }
};
const annotationRequired = ['block_ids', 'anchors', 'evidence_ids', 'explanation', 'assessment'];
const article = { article_id: id };
const tool = (name, description, properties, required, readOnly = false) => ({ name, description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false } });

export const ARTICLE_TOOLS = [
  tool('atlas_repair_import', 'Correct importer classifications after inspecting the source. Batch edits preserve original text, IDs, translations and evidence. Set kind, including footnote for author notes; set reference for bibliography entries. Captions may set figure_number and image_from_block_id to move an existing image with its marks. Non-caption blocks lose figure associations. page_misc retains the source block but excludes it from reader text and translation requirements; author notes and citations remain article content. Keeps the corrected source available without re-import.', {
    ...article, corrections: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: {
      block_id: id, kind: { enum: ['body', 'caption', 'heading', 'equation', 'table', 'footnote', 'page_misc'] },
      reference: { type: 'boolean', description: 'Whether this source block is a bibliography entry; preserve its authors, year, locator and citation label.' },
      figure_number: { type: ['string', 'null'], maxLength: 30 }, image_from_block_id: id
    }, required: ['block_id', 'kind'], additionalProperties: false } }
  }, ['article_id', 'corrections']),
  tool('atlas_prepare_article', 'Import a saved PDF, publisher HTML, paragraph-preserving text/Markdown or literature response file ONCE. PDF text is extracted with line and suggested paragraph boundaries; compare formulas and layout with the source pages. Preserves source blocks; creates stable IDs, figure inventory and resumable translation work. Returns a compact status, not the paper JSON. Source paths are workspace-relative. Never split sentences or author bundle JSON.', {
    source_path: str, selector: str, format: { enum: ['auto', 'html', 'text'] }, language: { enum: ['en', 'zh'] },
    paper_id: id, title: bi, authors: { type: 'array', items: str, minItems: 1 }, year: { type: 'integer' }, citation: str,
    url: str, rights: bi, edition: bi, trace_policy: { type: 'object', properties: { max_depth: { type: 'integer', minimum: 0 }, mode: { enum: ['targeted', 'balanced', 'deep'] }, crosscheck: { enum: ['off', 'when-needed', 'always-for-core'] }, stop_conditions: { type: 'array', items: str, maxItems: 12 } }, additionalProperties: false }
  }, ['source_path', 'language', 'paper_id', 'title', 'authors', 'year', 'citation', 'url', 'rights', 'edition']),
  tool('atlas_import_source', 'Import a saved upstream paper, abstract or source excerpt for citations without translating it or filling a main-paper contract. Accepts PDF, literature article.json, saved webpage JSON, HTML or paragraph-preserving text. PDF extraction retains line and suggested paragraph boundaries; compare formulas with the rendered source. Restores cached metadata and actual access scope, reuses identical imported content and returns source_article_id with block IDs. Optional metadata supplies or corrects source identity; access states the actual saved scope. No fetch or publication is performed.', {
    source_path: str, selector: str, format: { enum: ['auto', 'html', 'text'] }, url: str, title: str,
    authors: { type: 'array', items: str }, year: { type: ['integer', 'null'] },
    access: { enum: ['full_text', 'provided_full_text', 'provided_excerpt', 'abstract_only', 'metadata_only', 'unavailable', 'abstract', 'excerpt', 'fulltext', 'metadata'] }
  }, ['source_path']),
  tool('atlas_read_article', 'Omit article_id to list saved drafts. Otherwise read whole source paragraphs with translations and IDs, bounded by a character budget. Default: next untranslated blocks. references selects saved bibliography, author notes and citation clues, including references outside the initial preview; these are discovery clues, not retrieved upstream evidence. review compares translations; evidence shows quotes and attached interpretations; outline shows source inventory. reference_marks identifies source citation labels to preserve in translation. Reuse article_id across reconnects.', {
    ...article, view: { enum: ['pending', 'all', 'review', 'evidence', 'outline', 'references'] }, after: id, query: str,
    block_ids: ids, max_chars: { type: 'integer', minimum: 1000, maximum: 20000 }
  }, []),
  tool('atlas_save_translations', 'Save translations by returned block ID; original text and paragraph boundaries stay fixed. Saves valid items individually; retries replace the same blocks and return only unresolved items. References may use preserve_original=true. Returns remaining work without echoing text. Edits invalidate that block’s review.', {
    ...article, translations: { type: 'array', minItems: 1, items: { type: 'object', properties: {
      block_id: id, text: str, preserve_original: { type: 'boolean' }
    }, required: ['block_id'], additionalProperties: false } }
  }, ['article_id', 'translations']),
  tool('atlas_record_evidence', 'Block IDs are local to source_article_id (defaults to destination article). Unknown IDs relocate only when quote uniquely identifies a block in that source; otherwise returns needs_source_selection with source title and candidate IDs while retaining the input. Record evidence from source block IDs, or provide an exact quote and omit block_ids for automatic location. source_path can import a saved source directly. When block IDs are supplied, quote is optional and the tool copies their original text. Optional quote narrows the excerpt: typography differences are tolerated, a unique match elsewhere in the same article relocates the source. An unmatched quote saves the selected source verbatim and returns a source-check note, never presents supplied unmatched wording as a quotation. Reuse evidence_id to correct the saved item. source_article_id can identify an upstream source returned by atlas_import_source; a literature cache article_id is also accepted and imported automatically. Reuse returned evidence_id; update with evidence_id rather than duplicating. Record the upstream evidence IDs this result relies on in depends_on in this same call; independent cross-checks stay separate evidence. The response returns the saved dependencies. Updating with depends_on omitted preserves existing dependencies; pass [] to clear them. finding is optional: omit it when the quotation already conveys the result, rather than supplying generic filler. Observed bands and literature-based assignments are separate dependencies.', {
    ...article, evidence_id: id, source_article_id: id, source_path: str, block_ids: ids, quote: str,
    finding: bi, method: bi, stop_reason: bi,
    depends_on: { type: 'array', items: id, uniqueItems: true, maxItems: 30 }
  }, ['article_id', 'method', 'stop_reason']),
  tool('atlas_annotate_article', 'Save one annotation using the top-level fields, or several using annotations:[...]. Optional translations:[{block_id,text}] replaces those translations in the SAME atomic save as their updated sentence anchors: no separate translation/read step is required. Each annotation contains one continuous bilingual explanation, usually for one sentence or reasoning step, with exact English and Chinese anchors. Existing claim_id updates that annotation; a new stable claim_id creates it; omitted IDs are allocated without collisions. All unmentioned annotations and original paragraphs remain intact. Multiple disjoint anchors in one paragraph create separate reading entries. If wording or IDs need correction, returns local help and saves none of this request. Do not submit repeated summary/why/limits sections or annotations merely to mark text checked.', {
    ...article, ...annotationFields,
    annotations: { type: 'array', minItems: 1, items: { type: 'object', properties: annotationFields, required: annotationRequired, additionalProperties: false } },
    translations: { type: 'array', minItems: 1, items: { type: 'object', properties: { block_id: id, text: str }, required: ['block_id', 'text'], additionalProperties: false } }
  }, ['article_id']),
  tool('atlas_attach_figure', 'Attach a figure to its imported caption block. Use a workspace image_path, or omit it to download the imported image URL. Dimensions, source records, placement and full caption are automatic. No invented PDF page, crop or feature required. Replaces only this caption’s image. A failed download preserves the caption, number and source URL with missing status; publication remains available.', {
    ...article, block_id: id, image_path: str
  }, ['article_id', 'block_id']),
  tool('atlas_mark_figure', 'After visually reading the attached image, mark one meaningful rectangle and its bilingual explanation. Coordinates are fractions of the whole image. Optional parent_id nests it under an existing mark; IDs, children and geometry are assembled automatically. Only mark features needed for this interpretation.', {
    ...article, block_id: id, mark_id: id, parent_id: id,
    x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 },
    width: { type: 'number', exclusiveMinimum: 0, maximum: 1 }, height: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
    observation: bi, reading: bi, evidence_ids: ids
  }, ['article_id', 'block_id', 'x', 'y', 'width', 'height', 'observation', 'reading']),
  tool('atlas_check_article', 'Summarize missing translations and images plus informational source/review progress without changing the draft. Figure numbering and review registration are informational; structural checks cannot determine scientific truth.', article, ['article_id'], true),
  tool('atlas_review_article', 'Record actual comparison of source structure, translations or evidence. Relevant text may already be available in context; no prescribed reading view or reread is required. note describes the concrete comparison, not praise. This records a model judgment, not a correctness proof.', {
    ...article, scope: { enum: ['source', 'translation', 'evidence'] }, ids, note: str
  }, ['article_id', 'scope', 'note']),
  tool('atlas_publish_article', 'Check and assemble the article internally, copy sources and publish to the reader. Input is only article_id (and replace for an existing paper). Missing work returns actionable blockers. Publication is a storage operation; report content findings separately.', {
    ...article, replace: { type: 'boolean' }
  }, ['article_id'])
];

import path from 'node:path';
import { parseHTML } from 'linkedom';
import { importArticle } from '../packages/core/article-import.mjs';
import { extractPdfSource } from './pdf.mjs';

const first = value => Array.isArray(value) ? value.find(item => typeof item === 'string' && item.trim()) : value;
const clean = value => typeof value === 'string' ? value.replace(/<[^>]+>/g, '').replace(/\s+/gu, ' ').trim() : '';
const values = value => (Array.isArray(value) ? value : value ? [value] : []).map(item => typeof item === 'string' ? clean(item) : clean(item?.name)).filter(Boolean);
export const normalizeSourceText = text => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
export const normalizeSourceBlocks = blocks => JSON.stringify(blocks.map(block => normalizeSourceText(block.original)));
const optionalJson = async (workspace, filename) => {
  try { return JSON.parse(await workspace.readText(filename, { maxBytes: 20_000_000 })); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
};

export async function readSourceFile(workspace, sourcePath) {
  const header = await workspace.readTextSlice(sourcePath, { length: 5 });
  if (header.text === '%PDF-') {
    const article = await extractPdfSource(workspace, sourcePath);
    return { article, input: JSON.stringify(article) };
  }
  const input = await workspace.readText(sourcePath, { maxBytes: 20_000_000 });
  let article;
  if (input.trimStart().startsWith('{')) article = JSON.parse(input);
  else article = { text: input, ...( /<(?:!doctype|html|article|main|p|h[1-6])(?:\s|>)/i.test(input) ? { article_html: input } : {}) };
  if (/^literature\/[a-f0-9-]{36}\/(?:article\.(?:json|html)|text\.txt)$/.test(sourcePath)) {
    const base = path.posix.dirname(sourcePath);
    const saved = sourcePath.endsWith('article.json') ? article : await optionalJson(workspace, `${base}/article.json`);
    const [metadata, access] = await Promise.all([optionalJson(workspace, `${base}/metadata.txt`), optionalJson(workspace, `${base}/access.txt`)]);
    article = { ...access, ...saved, metadata: { ...metadata, ...saved.metadata }, cache_article_id: base.split('/').at(-1) };
  }
  if (!article.metadata || typeof article.metadata !== 'object' || Array.isArray(article.metadata)) article.metadata = {};
  const html = article.article_html || (/html/i.test(article.content_type || '') ? article.text : '');
  if (html) {
    const { document } = parseHTML(html);
    for (const meta of document.querySelectorAll('meta[name], meta[property]')) {
      const key = meta.getAttribute('name') || meta.getAttribute('property'), value = meta.getAttribute('content');
      if (value && article.metadata[key] === undefined) article.metadata[key] = [...document.querySelectorAll('meta[name], meta[property]')]
        .filter(node => (node.getAttribute('name') || node.getAttribute('property')) === key).map(node => node.getAttribute('content')).filter(Boolean);
    }
    article.article_html ||= html;
    article.article_html_truncated ??= Boolean(article.truncated);
    article.title ||= document.querySelector('title')?.textContent;
    article.url ||= document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  }
  return { article, input };
}

export function sourceIdentity(article = {}) {
  const m = article.metadata || {};
  const pick = (...keys) => keys.map(key => clean(first(m[key]))).find(Boolean) || '';
  const title = clean(first(article.title?.en || article.title)) || pick('citation_title', 'dc.title', 'og:title', 'title');
  const url = clean(article.final_url || article.url || article.article_html_source_url) || pick('citation_fulltext_html_url', 'og:url', 'prism.url');
  const doiInput = clean(first(article.doi)) || pick('citation_doi', 'prism.doi', 'dc.identifier', 'DOI', 'doi');
  const doi = (doiInput.match(/10\.\d{4,9}\/\S+/i)?.[0] || url.match(/10\.\d{4,9}\/[^?#\s]+/i)?.[0] || '').replace(/[.,;]$/, '').toLowerCase();
  const authorValues = article.authors || m.citation_author || m['dc.creator'] || m.authors;
  const authors = values(authorValues);
  const yearValue = article.year || pick('citation_publication_date', 'citation_online_date', 'prism.publicationDate', 'dc.date', 'year');
  const year = String(yearValue).match(/\b(?:18|19|20)\d{2}\b/)?.[0];
  const journal = clean(article.journal) || pick('citation_journal_title', 'prism.publicationName');
  return { title: pick('citation_title', 'dc.title') || title, authors, year: year ? Number(year) : null, journal, doi,
    url: url || (doi ? `https://doi.org/${doi}` : ''), language: /^(zh|chinese)/i.test(clean(article.language) || pick('citation_language', 'dc.language')) ? 'zh' : 'en' };
}

function resourceKind(article, url) {
  let location = url || '';
  try { location = decodeURIComponent(location); } catch { /* Keep literal URLs with malformed escapes. */ }
  const declared = String(article.content_kind || article.source_kind || article.kind || '').toLowerCase();
  if (/supplement|supporting|^(?:si|esm)$/.test(declared) ||
      /(?:\/(?:esm|suppl(?:ement(?:ary)?)?|suppinfo|supplementary[-_]material|attachment)(?:[/.?_-]|$)|MOESM\d*|[_-]ESM(?:[._/-]|$))/i.test(location)) return 'supplement';
  if (/^(?:figure|image)$/.test(declared) || /(?:\/(?:figures?|images?)(?:[/?]|$)|\.(?:png|jpe?g|webp|gif|tiff?|svg)(?:[?#]|$))/i.test(location)) return 'figure';
  return 'article';
}

export function sourceKey(article) {
  const identity = sourceIdentity(article), kind = resourceKind(article, identity.url);
  if (identity.doi && kind === 'article') return `doi:${identity.doi}`;
  try {
    const url = new URL(identity.url);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    const canonical = url.toString().replace(/\/$/, '');
    return kind === 'article' ? canonical : `${kind}:${canonical}`;
  } catch { return identity.doi ? `${kind}:doi:${identity.doi}` : ''; }
}

function hasArticleBody(article) {
  try {
    const parsed = importArticle(JSON.stringify(article), { url: sourceIdentity(article).url });
    const section = /^(?:[IVX]+[. ]+|\d+(?:\.\d+)*[. ]+)?(?:Introduction|Method(?:s|ology)?|Materials and Methods|Experimental(?: Section| Methods)?|Results(?: and Discussion)?|Discussion|Theory|Conclusions?|Concluding Remarks|Computational (?:Details|Methods))$/i;
    return parsed.blocks.some((block, index) => block.kind === 'heading' && section.test(block.original.trim()) &&
      parsed.blocks.slice(index + 1).find(next => next.kind !== 'heading')?.kind === 'body');
  } catch { return false; }
}

function abstractText(article) {
  if (typeof article.abstract === 'string' && article.abstract.trim()) return article.abstract.trim();
  const text = article.text || '';
  const headings = [...text.matchAll(/(?:^|\n)\s*Abstract\s*\n([\s\S]*?)(?=\n\s*(?:Keywords?|Visual Abstract|Graphical Abstract|Subjects|Topics|Supporting Information|References|Cited By|Citing Literature|Article Information|Introduction)\b[^\n]*(?:\n|$)|$)/gi)];
  const marked = headings.map(match => match[1].trim()).filter(value => value.length > 80).sort((a, b) => b.length - a.length)[0];
  if (marked) return marked;
  const metadata = article.metadata || {};
  for (const key of ['citation_abstract', 'description', 'og:description', 'dc.description']) {
    const description = clean(first(metadata[key]));
    if (description.length < 80) continue;
    const prefix = normalizeSourceText(description).slice(0, 100);
    const matched = text.split(/\n\s*\n/).find(paragraph => normalizeSourceText(paragraph).startsWith(prefix));
    if (matched) return matched.trim();
  }
  return '';
}

export function sourceAccess(article) {
  let state = article.access_state || article.access || '';
  state = { abstract: 'abstract_only', excerpt: 'provided_excerpt', fulltext: 'full_text', metadata: 'metadata_only' }[state] || state;
  if (article.success === false || /^(?:read_failed|challenge|unavailable|blocked|login_required)$/.test(state)) return 'unavailable';
  const hasHtml = Boolean(article.article_html?.trim());
  const completeText = Boolean(article.text?.trim()) && !article.text_truncated && !article.truncated && article.text !== article.article_html;
  const truncated = hasHtml ? Boolean(article.article_html_truncated) && !completeText : Boolean(article.text_truncated || article.truncated);
  const paywall = /Available to Purchase|Pay.Per.View|Purchase this article|Get access to the full article/i.test(article.text || '');
  const bodyPresent = /(?:^|\n)\s*(?:[IVX]+[. ]+|[1-9][. ]+)?(?:INTRODUCTION|MATERIALS AND METHODS|RESULTS AND DISCUSSION|CONCLUSIONS?)\s*(?:\n|$)/im.test(article.text || '');
  const abstract = abstractText(article);
  if (!hasHtml && paywall && !bodyPresent) return abstract ? 'abstract_only' : 'provided_excerpt';
  if (/^(?:full_text|provided_full_text|open_access_full_text|publisher_full_text|institutional_full_text|full_text_visible)$/.test(state)) {
    if (!hasHtml && !article.text?.trim()) return 'metadata_only';
    return truncated ? 'provided_excerpt' : state === 'provided_full_text' ? state : 'full_text';
  }
  if (hasHtml && state === 'metadata_or_abstract' && hasArticleBody(article)) return article.article_html_truncated ? 'provided_excerpt' : 'full_text';
  if (state === 'abstract_only' || article.abstract?.trim()) return 'abstract_only';
  if (state === 'metadata_only') return 'metadata_only';
  if (state === 'metadata_or_abstract' && abstract) return 'abstract_only';
  return hasHtml || article.text?.trim() ? 'provided_excerpt' : 'metadata_only';
}

export function sourceContent(article, { selector, format = 'auto', url } = {}) {
  const access = sourceAccess(article);
  if (access === 'unavailable') return { blocks: [], warnings: ['The saved retrieval failed; no source text was imported.'], access, format: 'text' };
  let supplied = article, extractedAbstract = false;
  if (article.article_html_truncated && article.text?.trim() && !article.text_truncated && !article.truncated && article.text !== article.article_html) supplied = { ...article, article_html: '' };
  if (access === 'abstract_only') {
    const abstract = abstractText(article);
    if (abstract) { supplied = { text: abstract }; extractedAbstract = true; }
  }
  if (access === 'metadata_only') {
    const identity = sourceIdentity(article);
    supplied = { text: [identity.title, identity.authors.join('; '), identity.year, identity.journal, identity.doi].filter(Boolean).join('\n') };
  }
  if (!supplied.text?.trim() && !supplied.article_html?.trim()) return { blocks: [], warnings: ['The saved response contains no readable source text.'], access, format: 'text' };
  let parsed;
  try { parsed = importArticle(JSON.stringify(supplied), { selector, format, url: url || sourceIdentity(article).url }); }
  catch (error) {
    if (!supplied.text?.trim() || supplied.text === supplied.article_html || /<html[\s>]/i.test(supplied.text)) throw error;
    parsed = importArticle(supplied.text, { format: 'text', url: url || sourceIdentity(article).url });
    parsed.warnings.push(`Preserved saved text because structured HTML could not be parsed: ${error.message}`);
  }
  if (extractedAbstract) parsed.blocks = parsed.blocks.map((block, i) => ({ ...block, locator: `Abstract, paragraph ${i + 1}` }));
  if (article.extraction_notice) parsed.warnings.push(article.extraction_notice);
  if (article.extraction_warning) parsed.warnings.push(article.extraction_warning);
  return { ...parsed, access };
}

export async function savedSources(workspace) {
  let listing;
  try { listing = await workspace.list('literature', { limit: 10000 }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const entries = [];
  for (const item of listing.entries.filter(item => item.type === 'directory' && /^[a-f0-9-]{36}$/.test(item.path))) {
    try {
      const sourcePath = `literature/${item.path}/article.json`;
      const { article } = await readSourceFile(workspace, sourcePath);
      entries.push({ id: item.path, source_path: sourcePath, article, identity: sourceIdentity(article), access: sourceAccess(article), key: sourceKey(article) });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return entries.sort((a, b) => sourceScore(b) - sourceScore(a));
}
export function sourceScore(entry) {
  const article = entry.article || entry;
  const access = entry.access || sourceAccess(article);
  return ({ full_text: 6, provided_full_text: 6, provided_excerpt: 3, abstract_only: 2, metadata_only: 1, unavailable: 0 }[access] || 0) * 1e8 + Math.min(9e7, (article.article_html?.length || 0) + (article.text?.length || 0));
}

import { parseHTML } from 'linkedom';

const compact = value => value.replace(/\s+/gu, ' ').trim();
const captionNumber = text => text.match(/^(?:Figure|Fig\.?|图)\s*(\d+)/i)?.[1];
const heading = /^(?:Abstract|Introduction|Results(?: and Discussion)?|Discussion|Conclusions?|Methods|Materials and Methods|Experimental(?: Section)?|References|Acknowledg(?:e)?ments?|Supporting Information|摘要|引言|结果与讨论|结论|方法|参考文献)$/i;
const boundary = 'div,section,article,main,p,li,ol,ul,h1,h2,h3,h4,h5,h6,figure,table,pre';
const sourceNote = '[role="doc-footnote"],[role="doc-endnote"],.footnote,.fn';
const sourceReference = '.ref,[role="doc-biblioentry"]';
const citationLink = 'a[role="doc-biblioref"],a[role="doc-noteref"],a[href*="#ref"],a[href*="#Ref"],a[href*="#bib"],a[href*="#B"],a[href*="#CR"],a[href*="#fn"],a[href*="#note"],xref[ref-type="bibr"],xref[ref-type="fn"]';
const blockBoundary = `${boundary},img,${sourceNote},${sourceReference}`;

function mathLatex(node) {
  if (node.nodeType === 3) return node.textContent.trim();
  const tag = node.localName;
  if (['annotation', 'annotation-xml', 'maligngroup', 'malignmark', 'mspace'].includes(tag)) return '';
  const parts = [...node.children].map(mathLatex);
  if (tag === 'mtable') return `\\begin{matrix}${parts.join(' \\\\ ')}\\end{matrix}`;
  if (tag === 'mtr') return parts.join(' & ');
  if (tag === 'mtd' || tag === 'mpadded') return parts.join(' ');

  if (tag === 'msub') return `{${parts[0]}}_{${parts[1]}}`;
  if (tag === 'msup') return `{${parts[0]}}^{${parts[1]}}`;
  if (tag === 'msubsup') return `{${parts[0]}}_{${parts[1]}}^{${parts[2]}}`;
  if (tag === 'mfrac') return `\\frac{${parts[0]}}{${parts[1]}}`;
  if (tag === 'msqrt') return `\\sqrt{${parts.join(' ')}}`;
  if (tag === 'mroot') return `\\sqrt[${parts[1]}]{${parts[0]}}`;
  if (tag === 'mo') return ({ '×': '\\times ', '−': '-', '⁡': '', '≤': '\\le ', '≥': '\\ge ' })[node.textContent] ?? node.textContent;
  if (tag === 'mi' || tag === 'mn' || tag === 'mtext') {
    const value = node.textContent.replace(/[{}\\]/g, '');
    return tag === 'mtext' || node.getAttribute('mathvariant') === 'normal' ? `\\mathrm{${value}}` : value;
  }
  if (['math', 'mrow', 'semantics', 'mstyle'].includes(tag)) return parts.join(' ');
  if (['annotation', 'annotation-xml'].includes(tag)) return '';
  throw new Error(`MathML element ${tag} needs a supported source representation; preserve its source rather than flattening the formula.`);
}

// Text nodes remain in source order; inline elements never introduce paragraph breaks.
function visibleText(node, issues = []) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return '';
  if (node.localName === 'br') return '\n';
  if (node.localName === 'math') {
    const latex = node.querySelector('annotation[encoding="application/x-tex"]');
    let content;
    try {
      content = latex ? latex.textContent : mathLatex(node);
      if (!content.trim()) throw new Error('Empty formula');
    } catch (error) {
      const raw = node.outerHTML;
      issues.push({ raw, reason: error.message });
      return raw;
    }
    return node.getAttribute('display') === 'block' ? `\\[${content}\\]` : `\\(${content}\\)`;
  }
  return [...node.childNodes].map(child => visibleText(child, issues)).join('');
}

export function importArticle(input, { format = 'auto', selector, url } = {}) {
  let text = input, access = {}, warnings = [], blocks = [], figureManifest = [];
  const mathIssues = [];
  const readVisible = node => visibleText(node, mathIssues);
  const imageUrl = value => {
    if (!value) return null;
    try { const resolved = new URL(value, url); if (!['http:', 'https:'].includes(resolved.protocol)) throw new Error('Unsupported image scheme'); return resolved.toString(); }
    catch { warnings.push(`Image URL could not be resolved: ${value}. Attach the corresponding image to the saved block.`); return null; }
  };
  if (text.trimStart().startsWith('{')) {
    const wrapper = JSON.parse(text);
    if (typeof wrapper.text !== 'string' && typeof wrapper.article_html !== 'string') throw new Error('Source JSON needs an article text field. Use the saved literature text or publisher HTML.');
    const hasHtml = typeof wrapper.article_html === 'string' && wrapper.article_html.trim();
    figureManifest = Array.isArray(wrapper.figures) ? wrapper.figures : [];
    text = hasHtml ? wrapper.article_html : wrapper.text;
    if (hasHtml) {
      format = 'html';
      url = wrapper.article_html_source_url || url;
      selector ||= wrapper.article_html_selector;
    }
    access = { truncated: hasHtml ? wrapper.article_html_truncated : wrapper.text_truncated || wrapper.truncated, state: wrapper.access_state };
  }
  if (access.truncated) warnings.push('Source response is truncated. Available content is saved; obtain missing portions before describing it as complete.');
  if (format === 'auto') format = /<(?:!doctype|html|article|main|p|h[1-6])(?:\s|>)/i.test(text) ? 'html' : 'text';
  const push = (kind, content, extra = {}) => {
    if (content.trim()) blocks.push({ id: `b${blocks.length + 1}`, kind, original: content.trim(), ...extra });
  };
  if (format === 'html') {
    const { document } = parseHTML(text);
    let roots = selector ? [...document.querySelectorAll(selector)] : [document.querySelector('article') || document.querySelector('main') ||
      document.querySelector('.article__body, .article-body, .c-article-body, .widget-ArticleFulltext, #article-section__full, #body, .Body')].filter(Boolean);
    roots = roots.filter(node => !roots.some(other => other !== node && other.contains(node)));
    if (!roots.length) throw new Error('No article container found. Supply the publisher article selector; do not flatten the whole webpage.');
    for (const root of roots) {
      root.querySelectorAll('script,style,nav,button,form,.fig-modal,.citation-links,#sr-fig-viewer-action,.widget-ArticleDataSupplements,.c-article-references__download').forEach(node => node.remove());
      root.querySelectorAll('aside,[hidden]').forEach(node => {
        if (!node.matches(`${sourceNote},${sourceReference}`) && !node.querySelector(`${sourceNote},${sourceReference}`)) node.remove();
      });
    }
    for (const root of roots) root.querySelectorAll('.ref a').forEach(node => {
      if (/^(?:Crossref|Search ADS|Google Scholar|PubMed)$/i.test(node.textContent.trim())) node.remove();
    });
    // Publisher download controls inside supplementary item titles are navigation, not content.
    for (const root of roots) root.querySelectorAll('.c-article-supplementary__title a, .c-article-supplementary__title').forEach(node => {
      [...node.childNodes].forEach(child => {
        if (child.nodeType === 3 && /\(download/i.test(child.textContent)) child.textContent = child.textContent.replace(/\s*\(download[^)]*$/i, '');
        if (child.nodeType === 3 && /^\s*\)\s*$/.test(child.textContent)) child.remove();
      });
      node.querySelectorAll('svg').forEach(svg => svg.remove());
    });
    const walk = node => {
      if (node.nodeType === 3) { if (node.textContent.trim()) push('body', compact(node.textContent), { locator: 'unwrapped text' }); return; }
      if (node.nodeType !== 1) return;
      const tag = node.localName;
      const locator = node.id ? `#${node.id}` : `${tag} ${blocks.length + 1}`;
      const marks = [...new Set([...node.querySelectorAll(citationLink)].map(link => compact(readVisible(link))).filter(Boolean))];
      const nodeSource = { locator, ...(marks.length ? { citation_markers: marks } : {}) };
      if (node.matches(sourceReference)) { push('body', compact(readVisible(node)), { ...nodeSource, reference: true }); return; }
      if (node.matches(sourceNote)) { push('footnote', compact(readVisible(node)), nodeSource); return; }
      if (node.matches('.permissionstatement-section-wrapper')) { push('footnote', compact(readVisible(node)), { locator, reference: false }); return; }
      if (node.matches('.article-metadata')) {
        const label = node.querySelector('strong');
        const content = compact(readVisible(node));
        push('body', label ? content.replace(label.textContent, label.textContent + ': ') : content, { locator });
        return;
      }
      if (tag === 'figure' || node.matches('div.figure,div.fig,div.NLM_fig,div.figure-container,div.fig-section')) {
        const cap = node.querySelector('figcaption') || node.querySelector('[class*="caption"]');
        const desc = node.querySelector('.c-article-section__figure-description, [data-test="bottom-caption"], .figure-description');
        const image = node.querySelector('img');
        const label = compact(node.querySelector('.fig-label')?.textContent || '');
        const parts = [];
        if (cap) parts.push(compact(readVisible(cap)));
        if (desc && (!cap || !cap.contains(desc))) parts.push(compact(readVisible(desc)));
        const captionText = compact(parts.join(' '));
        const caption = label && !captionNumber(captionText) ? `${label}. ${captionText}` : captionText;
        if (!caption) warnings.push(`Figure at ${locator} has no caption.`);
        const src = image?.getAttribute('data-src') || image?.getAttribute('src');
        push('caption', caption || image?.getAttribute('alt') || 'Figure', {
          locator, figure: { number: captionNumber(caption) || null, url: imageUrl(src) }
        });
        return;
      }
      if (tag === 'img') {
        const src = node.getAttribute('data-src') || node.getAttribute('src');
        const alt = node.closest('.graphical-abstract')?.querySelector('h2')?.textContent || node.getAttribute('alt') || 'Graphic';
        push('caption', alt, { locator, figure: { number: captionNumber(alt) || null, url: imageUrl(src) } });
        return;
      }
      if (tag === 'table') {
        const rows = [...node.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => compact(readVisible(cell))).join(' | '));
        const cap = node.querySelector('caption');
        push('table', [cap ? compact(readVisible(cap)) : '', ...rows].filter(Boolean).join('\n'), { locator });
        return;
      }
      if (/^h[1-6]$/.test(tag)) { push('heading', compact(readVisible(node)), nodeSource); return; }
      if (['p', 'li', 'figcaption', 'pre'].includes(tag) && !node.querySelector('figure,table,p,li')) {
        const content = compact(readVisible(node));
        push(tag === 'figcaption' ? 'caption' : 'body', content, nodeSource);
        return;
      }
      let inline = '';
      const flush = () => { if (inline.trim()) push(inline.trim().startsWith('\\[') ? 'equation' : 'body', compact(inline),
        { locator, ...(marks.filter(mark => inline.includes(mark)).length ? { citation_markers: marks.filter(mark => inline.includes(mark)) } : {}) }); inline = ''; };
      for (const child of node.childNodes) {
        if (child.nodeType === 1 && (child.matches(blockBoundary) || child.querySelector(blockBoundary))) { flush(); walk(child); }
        else inline += readVisible(child);
      }
      flush();
    };
    for (const root of roots) walk(root);
  } else {
    for (const part of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
      const raw = part.trim();
      if (!raw) continue;
      const image = raw.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (image) { push('caption', image[1] || 'Figure', { figure: { number: captionNumber(image[1]) || null, url: imageUrl(image[2]) } }); continue; }
      if (/^#{1,6}\s+/.test(raw)) push('heading', raw.replace(/^#{1,6}\s+/, ''));
      else if (heading.test(raw)) push('heading', raw);
      else push(captionNumber(raw) ? 'caption' : raw.startsWith('\\[') || raw.startsWith('$$') ? 'equation' : /^\|/m.test(raw) ? 'table' : 'body', raw);
    }
    warnings.push('Text input preserves supplied blank-line paragraphs. Compare these boundaries, formulas, tables and figure inventory with the publisher source.');
    if (blocks.length < 2 && text.length > 2000) warnings.push('Source text has lost paragraph boundaries. Supply structured publisher HTML or paragraph-preserving Markdown; sentence splitting cannot recover the article.');
  }
  if (!blocks.length) throw new Error('No article blocks extracted.');
  let inReferences = false;
  for (const block of blocks) {
    if (block.kind === 'heading') inReferences = /^(?:References|参考文献)$/i.test(block.original);
    if (inReferences && block.kind !== 'heading' && block.reference !== false) block.reference = true;
    if (block.kind === 'caption' && !block.figure) block.figure = { number: captionNumber(block.original) || null, url: null };
    if (block.figure) {
      const manifest = figureManifest.find(item => block.figure.number
        ? captionNumber(item.caption || '') === block.figure.number
        : item.src && block.figure.url && imageUrl(item.src) === block.figure.url);
      if (manifest?.src && !block.figure.url) block.figure.url = imageUrl(manifest.src);
      if (Number.isInteger(manifest?.index)) block.figure.figure_index = manifest.index;
    }
  }
  const texts = new Set();
  for (const block of blocks.filter(b => b.kind === 'caption')) {
    const key = compact(block.original);
    if (texts.has(key)) warnings.push(`Repeated caption at ${block.id}; inspect the publisher container before translation.`);
    texts.add(key);
  }
  let section = 'Article', paragraph = 0;
  for (const block of blocks) {
    block.dom_locator = block.locator;
    if (block.kind === 'heading') { section = block.original; paragraph = 0; block.locator = section; }
    else if (block.figure?.number) block.locator = `Figure ${block.figure.number}`;
    else if (block.reference) block.locator = `References; entry ${block.original.match(/^\d+/)?.[0] || ++paragraph}`;
    else block.locator = `${section}; paragraph ${++paragraph}`;
  }
  for (const issue of mathIssues) {
    const ids = blocks.filter(b => b.original.includes(compact(issue.raw))).map(b => b.id);
    warnings.push(`Unconverted MathML in ${ids.join(', ') || 'source'}: ${issue.reason}. Raw MathML is retained in the source text; inspect it and the publisher formula.`);
  }
  return { format, blocks, warnings: [...new Set(warnings)], access };
}

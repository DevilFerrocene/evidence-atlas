import { createLibraryManager } from '/library.js';
import katex from '/vendor/katex/katex.mjs';
import renderMathInElement from '/vendor/katex/contrib/auto-render.mjs';

const $ = selector => document.querySelector(selector);
const mathOptions = { throwOnError: true, trust: false, maxExpand: 500, maxSize: 20, strict: 'ignore' };
function displayMathWrapper(display) {
  const parent = display.parentElement;
  return parent?.childNodes.length === 1 && parent.firstChild === display ? parent : display;
}
function trimDisplayMathBoundary(display, direction) {
  const wrapper = displayMathWrapper(display);
  const sibling = direction === 'before' ? wrapper.previousSibling : wrapper.nextSibling;
  if (sibling?.nodeType !== Node.TEXT_NODE) return;
  sibling.textContent = direction === 'before'
    ? sibling.textContent.replace(/\s+$/, '')
    : sibling.textContent.replace(/^\s+/, '');
}
function typeset(root) {
  try {
    renderMathInElement(root, {
      ...mathOptions,
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true }
      ],
      ignoredClasses: ['katex', 'katex-display']
    });
    for (const display of root.querySelectorAll('.katex-display')) {
      trimDisplayMathBoundary(display, 'before');
      trimDisplayMathBoundary(display, 'after');
    }
  } catch (error) {
    console.warn('Could not typeset one or more explicit math expressions.', error);
  }
}
const ui = {
  zh: {
    library: '本地文献库', choose: '选择文献', outline: '文献导览', read: '论文正文', sources: '参考与追溯来源', claims: '条观点', coverage: '全文逐段核对', sourceCount: '个来源', original: '所用全文 ↗', german: '原刊扫描 ↗', export: '结构化数据 ↓',
    guide: '悬停划线文字查看证据；点击固定详情。', guideTouch: '点按划线文字查看证据。', supported: '有据可循', conditional: '依赖前提', open: '尚待验证', proposal: '实验建议', mixed: '证据不一', unsupported: '支持不足', miscited: '引用有误', outdated: '已过时',
    details: '观点详情', claim: '观点', pin: '固定', pinned: '已固定', close: '关闭', emptyTitle: '每条观点，都可以往回追。', emptyBody: '把鼠标移到正文划线处，展开结论、证据链与原始来源。点击可固定详情，方便继续阅读。', example: '从核心观点开始 →', assessment: 'AI 整理结论', reasoning: '为什么这样判断', chain: '依据', limits: '需要注意', findings: '调查中发现', quantities: '数字与计算', refs: '来源详情', method: '核查详情', terminal: '追溯至此', shared: '此依据已在上方展开', sourceNone: '本例独立整理', depth: '依赖', edition: '版本、翻译与阅读范围', scope: '阅读范围', translation: '版本说明', rights: '全文使用依据', context: '处衔接文字已保留', annotations: '处片段已关联观点', coverageExplain: '覆盖表示正文已逐段标注，结论是否成立请查看各条证据。', updated: '查阅于', footer: '全文与证据均从本地数据读取 · 外部链接通往来源页面', loadError: '文献读取失败', retry: '重新读取', noPapers: '文献库中还没有论文。', sourcesTitle: '原文引用及倒查补充来源', aiNote: '原文与译文范围见版本说明；判断与证据链为 AI 整理。', copyLink: '链接', loading: '正在读取证据…', related: '这段文字包含', viewSource: '打开来源 ↗', localSource: '本地原文 ↓', sectionNote: '导览分段为阅读辅助',
    full_text: '已查阅全文', abstract_only: '仅查阅摘要', metadata_only: '仅查阅书目信息', unavailable: '全文未取得', original_citation: '原文明确引用', backtrace: '倒查补充', later_test: '后验实验', calculation: '独立计算', assumption: '前提辨析', main_text: '本文论证', later_theory: '后续理论', supports: '支持', qualifies: '限定范围', contradicts: '相抵触', contextRelation: '背景', derives_from: '由此推导', uses: '采用', unverified_dependency: '依赖待验证论断', alternative: '另一路径', measurement: '原始测量', derivation: '可复核推导', postulate: '明确假设', unresolved: '未解决的问题', definition: '定义或约定', historical_proposal: '当时的建议', access_gap: '来源访问缺口', bibliographic: '原始书目',
  },
  en: {
    library: 'LOCAL LIBRARY', choose: 'Choose a paper', outline: 'IN THIS PAPER', read: 'Paper', sources: 'References & traced sources', claims: 'claims', coverage: 'Paragraph-level coverage', sourceCount: 'sources', original: 'Source full text ↗', german: 'Original scan ↗', export: 'Structured data ↓',
    guide: 'Hover over an underline to trace a claim. Click to keep the panel open.', guideTouch: 'Tap an underlined passage to trace its evidence.', supported: 'Supported', conditional: 'Conditional', open: 'Unresolved', proposal: 'Proposed test', mixed: 'Mixed evidence', unsupported: 'Insufficient support', miscited: 'Miscited', outdated: 'Outdated',
    details: 'CLAIM DETAIL', claim: 'Claim', pin: 'Pin', pinned: 'Pinned', close: 'Close', emptyTitle: 'Follow a claim back to its evidence.', emptyBody: 'Hover over an underlined passage for a readable assessment, evidence chain, and original sources. Click to pin the detail while you read.', example: 'Start with a central claim →', assessment: 'AI assessment', reasoning: 'Reasoning', chain: 'TRACE THE EVIDENCE', limits: 'Conditions & remaining questions', findings: 'Findings along the way', quantities: 'Numbers & calculations', refs: 'Source details', method: 'Evidence & method', terminal: 'Where this branch stops', shared: 'This evidence is expanded above', sourceNone: 'Independent analysis in this example', depth: 'Dependency', edition: 'Edition, translation & scope', scope: 'Reading scope', translation: 'Edition', rights: 'Reuse basis', context: 'connecting passages retained', annotations: 'passages linked to claims', coverageExplain: 'Coverage means the text has been annotated. Read each assessment to judge its evidential support.', updated: 'Accessed', footer: 'Text and evidence are read locally · External links lead to source pages', loadError: 'Could not load the paper', retry: 'Try again', noPapers: 'The library is empty.', sourcesTitle: 'Original citations and additional traced sources', aiNote: 'See the edition note for original and translated text. Assessments and evidence chains are AI-organized.', copyLink: 'Link to this claim', loading: 'Loading evidence…', related: 'Claims in this passage', viewSource: 'Open source ↗', localSource: 'Local original ↓', sectionNote: 'Navigation sections are editorial',
    full_text: 'Full text inspected', abstract_only: 'Abstract only', metadata_only: 'Metadata only', unavailable: 'Full text unavailable', original_citation: 'Original citation', backtrace: 'Additional backtrace', later_test: 'Later experiment', calculation: 'Independent calculation', assumption: 'Premise analysis', main_text: 'This paper', later_theory: 'Later theory', supports: 'Supports', qualifies: 'Qualifies', contradicts: 'Contradicts', contextRelation: 'Context', derives_from: 'Derived from', uses: 'Uses', unverified_dependency: 'Unverified dependency', alternative: 'Alternative route', measurement: 'Primary measurement', derivation: 'Reproducible derivation', postulate: 'Explicit postulate', unresolved: 'Unresolved issue', definition: 'Definition or convention', historical_proposal: 'Historical proposal', access_gap: 'Source access gap', bibliographic: 'Primary bibliography',
  }
};
let lang = 'zh';
try { lang = localStorage.getItem('evidence-atlas-language') === 'en' ? 'en' : 'zh'; } catch {}
let paper, paperList = [], currentClaim = null, currentSegment = null, currentFigure = null, currentFeature = null, figurePath = [], pinned = false, detailRequestId = 0, paperLoadId = 0, loadingPaper = false, hoverTimer, restoringClaimFocus = false;
const libraryManager = createLibraryManager({ language: () => lang, onSelect: id => loadPaper(id) });
const detailCache = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const scrollBehavior = () => reducedMotion.matches ? 'auto' : 'smooth';
const narrowLayout = () => matchMedia('(max-width: 900px)').matches;
const t = key => ui[lang][key] || key;
Object.assign(ui.zh, { details: '解读', reasoning: '推导提要', story: '理解与推导', why: '核心理由', supporting: '查看依据', tertiary: '来源', provided_excerpt: '已读用户提供摘录', provided_full_text: '已读用户提供全文', guide: '悬停划线文字查看结论；点击固定详情。', guideTouch: '点按划线文字查看结论。', emptyTitle: '结论与依据，一处读清。', emptyBody: '正文划线处直接展示结论和关键理由，需要时展开原始证据与计算。', figure: '图像证据', originalFigure: '查看原图', fullCaption: '完整图注', featureHint: '直接点图进入概览，再点框逐层查看。', readingRegion: '图像助读区域', overview: '整图导览', structures: '结构与子谱', peaks: '逐峰', peakList: '选择峰', choosePeak: '请选择峰', previousPeak: '上一峰', nextPeak: '下一峰', moreReading: '更多解读与依据', editRegions: '调整区域', finishEditing: '完成调整', exportFigureData: '导出助读区域 ↓', tools: '工具', viewFeatureDetail: '查看详细解读', backToImage: '返回上一级', featureDetail: '图像助读', observation: '视觉观察', authorAttribution: '作者归属', audit: '审计判断', reading: '助读', ambiguities: '未解决处', figureEvidence: '关联证据', peak: '峰', shoulder: '肩部或近重叠特征', valley: '谷', region: '区域', marker: '标记', curve: '曲线', structure: '结构式', panel: '子图', spectrum: '谱图' });
Object.assign(ui.en, { details: 'EXPLANATION', reasoning: 'Derivation outline', story: 'Understanding the argument', why: 'The central reason', supporting: 'Evidence, calculations & additional findings', tertiary: 'References & source details', provided_excerpt: 'User-provided excerpt inspected', provided_full_text: 'User-provided full text inspected', guide: 'Hover over an underline for the conclusion. Click to pin it.', guideTouch: 'Tap an underlined passage for the conclusion.', emptyTitle: 'Conclusions with their evidence.', emptyBody: 'Underlined passages show the conclusion and its key reason. Expand sources and calculations when needed.', figure: 'FIGURE EVIDENCE', originalFigure: 'View original figure', fullCaption: 'Full caption', featureHint: 'Tap the figure for an overview, then follow the regions one level at a time.', readingRegion: 'Figure reading region', overview: 'Overview', structures: 'Structures & traces', peaks: 'Individual peaks', peakList: 'Choose peak', choosePeak: 'Select a peak', previousPeak: 'Previous peak', nextPeak: 'Next peak', moreReading: 'More reading & evidence', editRegions: 'Adjust regions', finishEditing: 'Finish adjusting', exportFigureData: 'Export reading regions ↓', tools: 'Tools', viewFeatureDetail: 'View detailed reading', backToImage: 'Back one level', featureDetail: 'FIGURE READING', observation: 'Visual observation', authorAttribution: 'Author attribution', audit: 'Audit judgment', reading: 'Reading aid', ambiguities: 'Unresolved points', figureEvidence: 'Linked evidence', peak: 'Peak', shoulder: 'Shoulder or near-overlap', valley: 'Valley', region: 'Region', marker: 'Marker', curve: 'Curve', structure: 'Structure', panel: 'Panel', spectrum: 'Spectrum' });
const bi = value => typeof value === 'string' ? value : value?.[lang] || '';
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function link(text, href, className = '', external = true) {
  const node = el('a', className, text);
  node.href = href;
  if (external) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
  return node;
}
function button(text, fn, className = '') {
  const node = el('button', className, text);
  node.type = 'button'; node.addEventListener('click', fn);
  return node;
}
async function api(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
const paperPath = () => `/api/papers/${encodeURIComponent(paper.paper.id)}`;
const claimClass = assessment => ['supported', 'conditional', 'proposal'].includes(assessment) ? assessment : 'open';
function syncChrome() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  $('#lang-zh').setAttribute('aria-pressed', String(lang === 'zh'));
  $('#lang-en').setAttribute('aria-pressed', String(lang === 'en'));
  libraryManager.render();
  $('#select-label').textContent = t('choose');
  $('#footer').textContent = t('footer');
  $('#evidence-panel').setAttribute('aria-label', t('details'));
  $('#outline').setAttribute('aria-label', t('outline'));
  for (const option of $('#paper-select').options) option.textContent = bi(paperList.find(p => p.id === option.value)?.title);
}
function setLanguage(next) {
  if (next === lang) return;
  const anchor = [...document.querySelectorAll('.paper-paragraph')].find(p => p.getBoundingClientRect().bottom > 80);
  const oldOffset = anchor?.getBoundingClientRect().top;
  lang = next;
  try { localStorage.setItem('evidence-atlas-language', lang); } catch {}
  syncChrome();
  if (!paper) return;
  renderPaper();
  if (anchor) {
    const replacement = document.getElementById(anchor.id);
    window.scrollBy(0, replacement.getBoundingClientRect().top - oldOffset);
  }
  if (currentClaim) showClaim(currentClaim, currentSegment, { pin: pinned }); else renderEmpty();
}
$('#lang-zh').addEventListener('click', () => setLanguage('zh'));
$('#lang-en').addEventListener('click', () => setLanguage('en'));

function cleanReferenceText(text) {
  return text.replace(/^参考文献书目信息（按原文保留）：\s*/, '').replace(/\s*\[(?:Google Scholar|CrossRef|Scilit|PubMed)\]/g, '').trim();
}
function titleKey(text) {
  return text.toLocaleLowerCase().replace(/[\s.．。:：;；,，、\-—–()[\]{}]/g, '');
}
function isLeadingSectionLabel(text, section, hasBodyText) {
  if (!section || hasBodyText) return false;
  const value = text.trim();
  if (titleKey(value) === titleKey(section.label[lang])) return true;
  return /^\d+(?:\.\d+)*\.?\s+/.test(value);
}
function isKeywordLine(text) {
  return /^(?:关键词|Keywords)\s*[:：]/i.test(text.trim());
}
function articleTable(text) {
  const wrapper = el('div', 'article-table-wrap'), table = el('table', 'article-table');
  let rowNumber = 0;
  for (const line of text.split('\n').filter(line => line.trim())) {
    if (!line.includes('|')) { wrapper.append(el('p', '', line)); continue; }
    const cells = line.replace(/^\s*\||\|\s*$/g, '').split('|').map(value => value.trim());
    if (cells.every(value => /^:?-+:?$/.test(value))) continue;
    const row = el('tr', '');
    for (const cell of cells) row.append(el(rowNumber ? 'td' : 'th', '', cell));
    table.append(row); rowNumber++;
  }
  wrapper.append(table); return wrapper;
}
function renderPaper() {
  const root = $('#paper'); root.replaceChildren();
  const header = el('header', 'paper-header');
  header.append(el('h1', '', bi(paper.paper.title)));
  const links = el('div', 'paper-links'); links.append(link(t('original'), paper.paper.source_url)); header.append(links); root.append(header);
  const content = el('div', 'paper-content');
  const sectionMap = new Map((paper.paper.sections || []).map(s => [s.paragraph_id, s]));
  const claimMap = new Map(paper.claims.map(c => [c.id, c]));
  const figuresByPlacement = new Map((paper.figures || []).map(figure => [`${figure.placement.paragraph_id}/${figure.placement.after_segment_id}`, figure]));
  const hiddenParagraphs = new Set(['p-metadata', 'p-availability-rights', 'p-ai-audit-boundary']);
  paper.paragraphs.forEach((paragraph, index) => {
    if (hiddenParagraphs.has(paragraph.id)) return;
    const section = sectionMap.get(paragraph.id), authoredHeading = paragraph.type === 'heading', references = paragraph.id === 'p-references';
    if (section && !authoredHeading) { const heading = el('h2', 'section-heading', bi(section.label)); heading.id = section.id; content.append(heading); }
    const block = el(authoredHeading ? 'h2' : 'div', `${references ? 'reference-list' : 'paper-paragraph'} ${authoredHeading ? 'section-heading' : ''} ${paragraph.type === 'equation' ? 'equation-paragraph' : ''} ${paragraph.type === 'footnote' ? 'footnote' : ''}`);
    block.id = paragraph.id;
    if (section && authoredHeading) block.id = section.id;
    if (!references && !authoredHeading) block.append(el('span', 'paragraph-number', String(index + 1).padStart(2, '0')));
    let hasBodyText = false;
    for (const [i, segment] of paragraph.segments.entries()) {
      const figure = figuresByPlacement.get(`${paragraph.id}/${segment.id}`), rawText = segment[lang];
      if (references) { block.append(el('p', 'reference-entry', cleanReferenceText(rawText))); continue; }
      if (rawText.trim() === '图文摘要' || rawText.trim() === 'Graphical Abstract') continue;
      if (!authoredHeading && isLeadingSectionLabel(rawText, section, hasBodyText)) continue;
      if (isKeywordLine(rawText)) { block.append(el('p', 'keyword-line', rawText)); continue; }
      const isCaptionBeforeFigure = figure && (paragraph.type === 'caption' || /^(图|Figure)\s*\d+[。．.]/i.test(rawText.trim()));
      if (!isCaptionBeforeFigure) {
        hasBodyText = true;

        const mark = el(paragraph.type === 'table' ? 'div' : 'span', segment.claim_ids.length ? `claim-mark ${claimClass(claimMap.get(segment.claim_ids[0]).assessment)}` : 'context-text');
        mark.id = segment.id;
        if (paragraph.type === 'table') mark.append(articleTable(rawText));
        else if (segment.latex) { try { katex.render(segment.latex, mark, { ...mathOptions, displayMode: paragraph.type === 'equation' }); } catch { mark.textContent = rawText; } } else mark.textContent = rawText;
        if (segment.claim_ids.length) {
          mark.tabIndex = 0; mark.role = 'button'; mark.dataset.claims = segment.claim_ids.join(' '); mark.setAttribute('aria-controls', 'evidence-panel'); mark.setAttribute('aria-label', `${rawText} — ${t('details')}`);
          mark.addEventListener('pointerenter', event => { if (event.pointerType !== 'mouse' || pinned || narrowLayout()) return; clearTimeout(hoverTimer); hoverTimer = setTimeout(() => showClaim(segment.claim_ids[0], segment.id), 100); });
          mark.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
          mark.addEventListener('focus', () => { if (!narrowLayout() && !pinned && !restoringClaimFocus) showClaim(segment.claim_ids[0], segment.id); });
          mark.addEventListener('click', () => showClaim(segment.claim_ids[0], segment.id, { pin: true }));
          mark.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); showClaim(segment.claim_ids[0], segment.id, { pin: true }); } });
        }
        block.append(mark);
      }
      if (figure) block.append(renderFigure(figure));
    }
    if (block.childNodes.length) content.append(block);
  });
  root.append(content);
  const outline = $('#outline'); outline.replaceChildren(el('p', 'outline-title', t('outline')));
  for (const section of paper.paper.sections || []) if (!hiddenParagraphs.has(section.paragraph_id)) outline.append(link(bi(section.label), `#${section.id}`, '', false));
  typeset(root); highlightCurrent();
}
function featureBoxPosition(figure, region) { return { left: `${((region.x - figure.crop.x) / figure.crop.width) * 100}%`, top: `${((region.y - figure.crop.y) / figure.crop.height) * 100}%`, width: `${(region.width / figure.crop.width) * 100}%`, height: `${(region.height / figure.crop.height) * 100}%` }; }
function featureRegions(feature) { return feature.regions?.length ? feature.regions : [feature.geometry]; }
function featureChildren(feature) { return (feature.children || []).map(item => typeof item === 'string' ? { id: item } : item); }
function rootFeatures(figure) {
  const children = new Set(figure.features.flatMap(feature => featureChildren(feature).map(item => item.id)));
  return figure.features.filter(feature => !children.has(feature.id));
}
function findFeature(figure, id) { return figure.features.find(feature => feature.id === id); }
function hierarchyTitle(figure, feature) { return feature ? bi(feature.short_label || feature.observation) : `${bi(figure.number)} · ${t('overview')}`; }
function hierarchyPathLabel(figure, path) { return [bi(figure.number), t('overview'), ...path.map(id => hierarchyTitle(figure, findFeature(figure, id)))].join(' · '); }
function renderHierarchyPanel(frame, figure, path) {
  const panel = $('#evidence-panel'), feature = path.length ? findFeature(figure, path.at(-1)) : null, hasChildren = feature ? featureChildren(feature).length > 0 : true;
  panel.classList.add('is-open'); panel.dataset.view = JSON.stringify([paper.paper.id, figure.id, ...path, lang]); panel.removeAttribute('aria-busy'); panel.replaceChildren();
  const head = el('div', 'panel-head'), eyebrow = el('div', 'panel-eyebrow', t('featureDetail')), controls = el('div', 'panel-controls');
  controls.append(button(t('close'), () => closeFigureHierarchy(frame), 'figure-back')); head.append(eyebrow, controls);
  const body = el('div', 'panel-body is-entering');
  const shortPath = path.length ? [bi(figure.number), ...path.map(id => hierarchyTitle(figure, findFeature(figure, id)))] : [bi(figure.number)];
  body.append(el('div', 'figure-hierarchy-path', shortPath.join(' › ')));
  const text = feature ? bi(feature.quick_reading || feature.observation || feature.reading) : bi(figure.full_caption || figure.caption);
  body.append(el('p', 'claim-summary', text));
  const actions = el('div', 'figure-hierarchy-actions');
  if (path.length) actions.append(button(t('backToImage'), () => navigateFigureHierarchy(frame, figure, path.slice(0, -1)), 'figure-hierarchy-back'));
  if (feature && !hasChildren) {
    const more = button(t('moreReading'), null, 'feature-more-toggle'), detail = el('div', 'figure-hierarchy-detail'); detail.hidden = true; more.setAttribute('aria-expanded', 'false');
    detail.append(el('p', '', bi(feature.reading)));
    if (feature.author_attribution) detail.append(el('p', '', bi(feature.author_attribution)));
    if (feature.audit) detail.append(el('p', '', bi(feature.audit)));
    if (feature.ambiguities?.length) feature.ambiguities.forEach(item => detail.append(el('p', '', bi(item))));
    if (feature.evidence_ids?.length) renderFeatureEvidence(detail, feature);
    more.addEventListener('click', () => { const open = detail.hidden; detail.hidden = !open; more.setAttribute('aria-expanded', String(open)); }); actions.append(more); body.append(actions, detail);
  } else if (actions.childNodes.length) {
    body.append(actions);
  }
  panel.append(head, body); panel.scrollTop = 0;
}
function drawHierarchyChildren(frame, figure, parent) {
  frame.querySelectorAll('.feature-box').forEach(box => box.remove());
  const entries = parent ? featureChildren(parent) : rootFeatures(figure).map(feature => ({ id: feature.id }));
  const stage = frame.querySelector('.figure-focus');
  for (const entry of entries) {
    const feature = findFeature(figure, entry.id); if (!feature) continue;
    const regions = entry.region_ids?.length ? featureRegions(feature).filter(region => entry.region_ids.includes(region.id)) : featureRegions(feature);
    for (const region of regions) {
      const box = button('', event => enterFigureFeature(frame, figure, feature, event.currentTarget), `feature-box ${feature.type} ${region.role}`);
      box.dataset.featureId = feature.id; box.dataset.regionId = region.id; box.setAttribute('aria-label', `${t('readingRegion')} · ${hierarchyTitle(figure, feature)}`); box.title = hierarchyTitle(figure, feature); Object.assign(box.style, featureBoxPosition(figure, region));
      stage.append(box);
    }
  }
  for (const box of frame.querySelectorAll('.feature-box')) box.classList.toggle('selected', box.dataset.featureId === currentFeature);
}
function enterFigureRoot(frame, figure) {
  clearTimeout(hoverTimer); currentClaim = null; currentSegment = null; currentFigure = figure.id; currentFeature = null; figurePath = []; pinned = true;
  drawHierarchyChildren(frame, figure, null); renderHierarchyPanel(frame, figure, []); highlightCurrent();
}
function enterFigureFeature(frame, figure, feature) {
  clearTimeout(hoverTimer); currentClaim = null; currentSegment = null; currentFigure = figure.id; currentFeature = feature.id; figurePath = [...figurePath, feature.id]; pinned = true;
  if (featureChildren(feature).length) drawHierarchyChildren(frame, figure, feature);
  renderHierarchyPanel(frame, figure, figurePath); highlightCurrent();
}
function navigateFigureHierarchy(frame, figure, path) {
  currentFigure = figure.id; currentFeature = path.at(-1) || null; figurePath = path; const parent = path.length ? findFeature(figure, path.at(-1)) : null;
  drawHierarchyChildren(frame, figure, parent); renderHierarchyPanel(frame, figure, path); highlightCurrent();
}
function closeFigureHierarchy(frame) {
  currentFigure = null; currentFeature = null; figurePath = []; pinned = false; frame.querySelectorAll('.feature-box').forEach(box => box.remove()); highlightCurrent(); renderEmpty();
}
function navigateFigure(figure) { document.getElementById(figure.id)?.scrollIntoView({ block: 'start', behavior: scrollBehavior() }); }
function renderFigure(figure) {
  const frame = el('figure', 'evidence-figure'); frame.id = figure.id;
  const heading = el('figcaption', 'figure-head');
  const caption = bi(figure.caption).replace(/^(?:Figure|Fig\.?|图)\s*\d+\s*[.。．:]?\s*/i, '');
  heading.append(el('span', 'figure-number', bi(figure.number)), el('span', 'figure-caption', caption));
  const index = paper.figures.findIndex(item => item.id === figure.id), nav = el('div', 'figure-nav');
  if (index > 0) nav.append(button(`← ${bi(paper.figures[index - 1].number)}`, () => navigateFigure(paper.figures[index - 1]), 'figure-step'));
  if (index < paper.figures.length - 1) nav.append(button(`${bi(paper.figures[index + 1].number)} →`, () => navigateFigure(paper.figures[index + 1]), 'figure-step'));
  heading.append(nav); frame.append(heading);
  if (figure.availability === 'missing') {
    const notice = el('p', 'figure-unavailable', lang === 'zh' ? '图像暂缺，图注保留。' : 'Image unavailable; caption preserved.');
    if (figure.source_url) {
      const link = el('a', '', lang === 'zh' ? '查看来源' : 'View source');
      link.href = figure.source_url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      notice.append(' ', link);
    }
    frame.append(notice); return frame;
  }
  const stage = el('div', 'figure-focus'); stage.setAttribute('aria-label', `${bi(figure.number)} · ${t('featureHint')}`); stage.style.backgroundImage = `url("/${figure.original_path}")`;
  const fullCanvas = figure.crop.x === 0 && figure.crop.y === 0 && figure.crop.width === 1 && figure.crop.height === 1; stage.style.backgroundSize = fullCanvas ? '100% auto' : `${100 / figure.crop.width}% auto`; stage.style.backgroundPosition = fullCanvas ? '0 0' : `${(figure.crop.x / (1 - figure.crop.width)) * 100}% ${(figure.crop.y / (1 - figure.crop.height)) * 100}%`; stage.style.aspectRatio = `${figure.crop.width * figure.image_size.width} / ${figure.crop.height * figure.image_size.height}`;
  stage.addEventListener('click', event => { if (event.target === stage) enterFigureRoot(frame, figure); });
  frame.append(stage); return frame;
}
function figureEvidenceLabel(item) {
  const labels = {
    'rendered primary visual|shows marked spectral features': { zh: '保留图像中的可见谱形与标记', en: 'Visible spectrum and markers in the preserved figure' },
    'primary textual spectrum description|states region and allocation': { zh: '正文与图注中的谱图说明', en: 'Spectrum description in the text and caption' }
  };
  return bi(labels[`${item.role}|${item.relation}`]) || (lang === 'zh' ? '相关原文与证据' : 'Source text and evidence');
}
function renderFeatureEvidence(target, feature) {
  const section = el('section', 'detail-section'); section.append(el('h3', '', t('figureEvidence')));
  const evidence = new Map(paper.evidence.map(item => [item.id, item]));
  const sources = new Map(paper.sources.map(item => [item.id, item]));
  const shown = new Set();
  function add(eid, depth = 0) {
    if (shown.has(eid) || !evidence.has(eid)) return;
    shown.add(eid);
    const item = evidence.get(eid), source = sources.get(item.source_id);
    const node = el('div', 'evidence-node'); node.style.marginLeft = `${5 + Math.min(depth, 3) * 10}px`;
    node.append(el('p', 'node-meta', figureEvidenceLabel(item)), el('p', 'node-finding', bi(item.finding)));
    const citation = el('div', 'node-source');
    if (source) citation.append(link(source.title, source.local_path ? `/${source.local_path}` : source.url, '', !source.local_path));
    citation.append(el('span', 'locator', item.locator)); node.append(citation);
    if (item.terminal) node.append(el('p', 'feature-terminal', bi(item.terminal.reason)));
    section.append(node);
    for (const edge of item.depends_on) add(edge.evidence_id, depth + 1);
  }
  for (const id of feature.evidence_ids || []) add(id);
  target.append(section);
}
function clearFigureDetail() { currentFigure = null; currentFeature = null; figurePath = []; pinned = false; document.querySelectorAll('.evidence-figure').forEach(frame => frame.querySelectorAll('.feature-box').forEach(box => box.remove())); highlightCurrent(); const panel = $('#evidence-panel'); if (panel?.classList.contains('is-open')) renderEmpty(); }
function highlightCurrent() {
  for (const mark of document.querySelectorAll('.claim-mark')) {
    const active = Boolean(currentClaim && mark.dataset.claims.split(' ').includes(currentClaim));
    mark.classList.toggle('active', active); mark.setAttribute('aria-expanded', String(active));
  }
  for (const marker of document.querySelectorAll('.feature-box')) marker.classList.toggle('selected', marker.dataset.featureId === currentFeature);
}
function closePanel({ restoreFocus = true } = {}) {
  const trigger = restoreFocus && $('#evidence-panel').contains(document.activeElement) ? document.getElementById(currentSegment) : null;
  clearTimeout(hoverTimer); detailRequestId++; currentClaim = null; currentFigure = null; currentFeature = null; figurePath = []; pinned = false;
  highlightCurrent(); renderEmpty();
  if (trigger) {
    restoringClaimFocus = true;
    trigger.focus({ preventScroll: true });
    restoringClaimFocus = false;
  }
}
function renderEmpty() { const panel = $('#evidence-panel'); panel.classList.remove('is-open'); panel.replaceChildren(); delete panel.dataset.view; panel.removeAttribute('aria-busy'); }
async function showClaim(id, segmentId, options = {}) {
  clearTimeout(hoverTimer);
  if (loadingPaper || !paper?.claims.some(c => c.id === id)) return;
  currentClaim = id; currentSegment = segmentId; pinned = options.pin ?? pinned;
  highlightCurrent();
  const ticket = ++detailRequestId;
  const key = `${paper.paper.id}/${id}`;
  const panel = $('#evidence-panel'); panel.classList.add('is-open');
  const view = JSON.stringify([paper.paper.id, id, segmentId, lang]);
  if (panel.dataset.view === view) {
    panel.removeAttribute('aria-busy');
    syncPinButton();
    return;
  }
  if (!detailCache.has(key)) {
    panel.setAttribute('aria-busy', 'true');
    const pin = $('#pin-claim');
    if (pin) pin.disabled = true;
    if (!panel.dataset.view) panel.replaceChildren(el('p', 'panel-body loading', t('loading')));
    try { detailCache.set(key, await api(`${paperPath()}/claims/${encodeURIComponent(id)}`)); }
    catch (error) {
      if (ticket !== detailRequestId) return;
      delete panel.dataset.view;
      panel.removeAttribute('aria-busy');
      const box = el('div', 'panel-body'); box.append(el('p', '', `${t('loadError')} (${error.message})`), button(t('retry'), () => showClaim(id, segmentId, options)), button(t('close'), closePanel)); panel.replaceChildren(box); return;
    }
  }
  if (ticket !== detailRequestId) return;
  renderDetail(detailCache.get(key));
  panel.scrollTop = 0;
}
function syncPinButton() {
  const pin = $('#pin-claim');
  if (!pin) return;
  pin.disabled = false;
  const label = pinned ? (lang === 'zh' ? '取消固定解读' : 'Unpin this explanation') : (lang === 'zh' ? '固定解读' : 'Pin this explanation');
  pin.setAttribute('aria-label', label);
  pin.title = label;
  pin.classList.toggle('pinned', pinned);
  pin.setAttribute('aria-pressed', String(pinned));
}
function panelIconButton(label, path, onClick) {
  const control = button('', onClick, 'panel-icon-button');
  control.setAttribute('aria-label', label); control.title = label;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path); svg.append(shape); control.append(svg);
  return control;
}
function renderDetail(detail) {
  const { claim, evidence, sources } = detail;
  const panel = $('#evidence-panel'); panel.replaceChildren();
  panel.dataset.view = JSON.stringify([paper.paper.id, claim.id, currentSegment, lang]);
  panel.removeAttribute('aria-busy');
  const head = el('div', 'panel-head claim-panel-head'); head.append(el('div', 'panel-eyebrow', lang === 'zh' ? '解读' : 'Explanation'));
  const controls = el('div', 'panel-controls');
  const pin = panelIconButton(t('pin'), 'M8 3h8m-7 0v6l-3 4v2h12v-2l-3-4V3M12 15v6', () => { pinned = !pinned; syncPinButton(); });
  pin.id = 'pin-claim';
  controls.append(pin, panelIconButton(t('close'), 'M6 6l12 12M6 18L18 6', closePanel)); head.append(controls); panel.append(head);
  syncPinButton();
  const body = el('div', 'panel-body is-entering');
  const segment = paper.paragraphs.flatMap(p => p.segments).find(s => s.id === currentSegment);
  if (segment?.claim_ids.length > 1) {
    const tabs = el('div', 'claim-tabs'); tabs.setAttribute('aria-label', t('related'));
    for (const [index, id] of segment.claim_ids.entries()) {
      const c = paper.claims.find(item => item.id === id);
      const tab = button(`${t('claim')} ${index + 1} · ${t(c.assessment)}`, () => showClaim(id, segment.id, { pin: pinned }), id === claim.id ? 'selected' : '');
      tab.setAttribute('aria-pressed', String(id === claim.id)); tabs.append(tab);
    }
    body.append(tabs);
  }
  const explanation = el('div', 'claim-explanation');
  explanation.setAttribute('aria-label', lang === 'zh' ? '解读正文' : 'Explanation text');
  const evidenceMap = new Map(evidence.map(item => [item.id, item]));
  const sourceMap = new Map(sources.map(item => [item.id, item]));
  const traceTargets = new Map(), inlineEvidence = new Set(), citationNumbers = new Map();
  function evidenceLink(label, id, className = 'inline-citation') {
    const citation = link(label, `#trace-${claim.id}-${id}`, className, false);
    const item = evidenceMap.get(id), source = sourceMap.get(item?.source_id);
    citation.title = [source?.title, item?.locator].filter(Boolean).join(' · ');
    citation.addEventListener('click', event => {
      const target = traceTargets.get(id);
      if (!target) return;
      event.preventDefault(); pinned = true; syncPinButton();
      for (let node = target.parentElement; node && node !== body; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
      target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
    });
    return citation;
  }
  function citationLabel(source) {
    const author = source.authors.split(';')[0].trim();
    const name = author.includes(',') ? author.split(',')[0] : author.split(/\s+/).at(-1);
    return `${name} (${source.year ?? 'n.d.'})`;
  }
  function appendCitedText(target, text) {
    let cursor = 0, explicit = false;
    for (const match of text.matchAll(/\[([^\]\n]+)\]\(evidence:([a-zA-Z0-9_.:-]+)\)/g)) {
      target.append(document.createTextNode(text.slice(cursor, match.index)));
      if (evidenceMap.has(match[2])) {
        const label = /^\d+$/.test(match[1]) ? `[${match[1]}]` : match[1];
        if (/^\d+$/.test(match[1])) citationNumbers.set(match[2], label);
        target.append(evidenceLink(label, match[2])); inlineEvidence.add(match[2]); explicit = true;
      } else target.append(document.createTextNode(match[1]));
      cursor = match.index + match[0].length;
    }
    target.append(document.createTextNode(text.slice(cursor)));
    return explicit;
  }
  const seenText = new Set();
  function paragraph(value, evidenceIds = []) {
    const text = bi(value);
    if (!text || seenText.has(text.trim())) return;
    seenText.add(text.trim());
    const pieces = text.split(/\n\s*\n/);
    let p, explicit = false;
    for (const piece of pieces) {
      p = el('p'); explicit = appendCitedText(p, piece) || explicit; explanation.append(p);
    }
    const cited = new Set();
    for (const id of explicit ? [] : evidenceIds) {
      const item = evidenceMap.get(id), source = sourceMap.get(item?.source_id);
      if (!source || cited.has(source.id)) continue;
      cited.add(source.id);
      p.append(evidenceLink(` [${citationLabel(source)}]`, id, 'inline-citation citation-fallback'));
    }
  }
  if (claim.explanation) {
    paragraph(claim.explanation, claim.evidence_ids);
  } else if (claim.story?.length) {
    for (const item of claim.story) paragraph(item.text, item.evidence_ids || []);
  } else {
    paragraph(claim.why || claim.summary, claim.evidence_ids);
    if (!claim.why) for (const item of claim.reasoning || []) paragraph(item);
  }
  for (const item of claim.limits || []) paragraph(item);
  for (const item of claim.findings || []) paragraph(item.detail, item.evidence_ids);
  for (const item of claim.quantities || []) {
    paragraph(`${bi(item.label)}：${item.value}\n${item.calculation}\n${bi(item.interpretation)}`);
  }
  body.append(explanation);
  const trace = el('details', 'claim-trace');
  trace.append(el('summary', '', lang === 'zh' ? '文献倒查链' : 'Trace cited evidence'));
  const visited = new Set();
  function traceNode(id) {
    const item = evidenceMap.get(id);
    if (!item) return el('p', '', lang === 'zh' ? '来源记录缺失' : 'Missing evidence record');
    if (visited.has(id)) return evidenceLink(lang === 'zh' ? '查看上方同一依据 ↑' : 'See this evidence above ↑', id, 'trace-repeat');
    visited.add(id);
    const entry = el('div', 'trace-entry'), source = sourceMap.get(item.source_id);
    entry.id = `trace-${claim.id}-${id}`; entry.tabIndex = -1; traceTargets.set(id, entry);
    if (source) entry.append(link([citationNumbers.get(id), citationLabel(source)].filter(Boolean).join(' '), source.url, 'trace-source'));
    if (bi(item.finding)) entry.append(el('p', 'trace-finding', bi(item.finding)));
    const sourceDetails = el('details', 'trace-source-details');
    sourceDetails.append(el('summary', '', t('refs')));
    if (source) {
      sourceDetails.append(link(source.title, source.url, 'source-title'), el('p', 'source-authors', `${source.authors} (${source.year ?? 'n.d.'})`));
      sourceDetails.append(el('p', 'trace-access', `${t(source.access)} · ${t('updated')} ${source.retrieved_at}`));
      if (bi(source.note)) sourceDetails.append(el('p', '', bi(source.note)));
      if (source.local_path) sourceDetails.append(link(t('localSource'), `/${source.local_path}`, 'trace-local-source', false));
    }
    sourceDetails.append(el('p', 'trace-locator', item.locator));
    if (item.quote) sourceDetails.append(el('blockquote', '', item.quote));
    if (bi(item.method)) sourceDetails.append(el('p', 'trace-method', bi(item.method)));
    if (item.terminal?.reason) sourceDetails.append(el('p', 'trace-stop', bi(item.terminal.reason)));
    entry.append(sourceDetails);
    for (const edge of item.depends_on || []) {
      const branch = el('div', 'trace-branch');
      branch.append(el('span', 'trace-relation', bi(edge.label) || (lang === 'zh' ? '依据来自 ↓' : 'Based on ↓')), traceNode(edge.evidence_id));
      entry.append(branch);
    }
    return entry;
  }
  for (const id of new Set([...(claim.evidence_ids || []), ...(claim.story || []).flatMap(p => p.evidence_ids || []), ...(claim.findings || []).flatMap(p => p.evidence_ids || []), ...inlineEvidence])) if (!visited.has(id)) trace.append(traceNode(id));
  if (visited.size) body.append(trace);
  const foot = el('div', 'panel-foot'); foot.append(el('span', '', `${t('updated')} ${paper.paper.audited_at}`), link(t('copyLink'), `/?paper=${encodeURIComponent(paper.paper.id)}&claim=${encodeURIComponent(claim.id)}&lang=${lang}`, '', false)); body.append(foot);
  typeset(body);
  panel.append(body);
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });
$('#paper-select').addEventListener('change', event => loadPaper(event.target.value));
async function loadPaper(id, claimId) {
  closePanel({ restoreFocus: false }); loadingPaper = true;
  const ticket = ++paperLoadId;
  $('#paper').setAttribute('aria-busy', 'true');
  try {
    const loaded = await api(`/api/papers/${encodeURIComponent(id)}`);
    if (ticket !== paperLoadId) return;
    loadingPaper = false;
    $('#paper').removeAttribute('aria-busy');
    paper = loaded; currentSegment = null; currentFigure = null; currentFeature = null; renderPaper(); renderEmpty();
    $('#notice').hidden = true;
    $('#paper-select').value = id;
    if (claimId && paper.claims.some(c => c.id === claimId)) {
      const c = paper.claims.find(item => item.id === claimId);
      await showClaim(claimId, c.segment_ids[0], { pin: true });
      if (ticket !== paperLoadId || paper.paper.id !== id) return;
      document.getElementById(c.segment_ids[0])?.scrollIntoView({ block: 'center' });
    }
  } catch (error) {
    if (ticket === paperLoadId) {
      loadingPaper = false; $('#paper').removeAttribute('aria-busy');
      showError(error, () => loadPaper(id, claimId));
    }
  }
}
function showError(error, retry) {
  const box = el('div', 'error-view'); box.append(el('p', '', `${t('loadError')}: ${error.message}`), button(t('retry'), retry)); $('#paper').replaceChildren(box);
}
async function boot() {
  const params = new URLSearchParams(location.search);
  if (['zh', 'en'].includes(params.get('lang'))) lang = params.get('lang');
  syncChrome(); renderEmpty();
  try {
    paperList = await api('/api/papers');
    if (!paperList.length) { $('#paper').replaceChildren(el('p', 'coverage-note', t('noPapers'))); return; }
    const select = $('#paper-select'); select.replaceChildren();
    paperList.forEach(p => { const option = el('option', '', bi(p.title)); option.value = p.id; select.append(option); });
    select.hidden = paperList.length < 2;
    const id = paperList.some(p => p.id === params.get('paper')) ? params.get('paper') : paperList[0].id;
    await loadPaper(id, params.get('claim'));
  } catch (error) { showError(error, boot); }
}
boot();

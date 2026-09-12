import katex from '/vendor/katex/katex.mjs';
import renderMathInElement from '/vendor/katex/contrib/auto-render.mjs';

const $ = selector => document.querySelector(selector);
const mathOptions = { throwOnError: true, trust: false, maxExpand: 500, maxSize: 20, strict: 'ignore' };
function typeset(root) {
  renderMathInElement(root, {
    ...mathOptions,
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\(', right: '\\)', display: false },
      { left: '\\[', right: '\\]', display: true }
    ],
    ignoredClasses: ['katex', 'katex-display']
  });
}
const ui = {
  zh: {
    library: '本地文献库', choose: '选择文献', outline: '文献导览', read: '论文正文', sources: '参考与追溯来源', claims: '条观点', coverage: '全文逐段核对', sourceCount: '个来源', original: '所用全文 ↗', german: '原刊扫描 ↗', export: '结构化数据 ↓',
    guide: '悬停划线文字查看证据；点击固定详情。', guideTouch: '点按划线文字查看证据。', supported: '有据可循', conditional: '依赖前提', open: '尚待验证', proposal: '实验建议', mixed: '证据不一', unsupported: '支持不足', miscited: '引用有误', outdated: '已过时',
    details: '观点详情', pin: '固定', pinned: '已固定', close: '关闭', emptyTitle: '每条观点，都可以往回追。', emptyBody: '把鼠标移到正文划线处，展开结论、证据链与原始来源。点击可固定详情，方便继续阅读。', example: '从核心观点开始 →', assessment: 'AI 整理结论', reasoning: '为什么这样判断', chain: '往回追溯', limits: '适用前提与保留问题', findings: '调查中发现', quantities: '数字与计算', refs: '来源详情', method: '展开依据与方法', terminal: '追溯至此', shared: '此依据已在上方展开', sourceNone: '本例独立整理', depth: '依赖', edition: '版本、翻译与阅读范围', scope: '阅读范围', translation: '版本说明', rights: '全文使用依据', context: '处衔接文字已保留', annotations: '处片段已关联观点', coverageExplain: '覆盖表示正文已逐段标注，结论是否成立请查看各条证据。', updated: '查阅于', footer: '全文与证据均从本地数据读取 · 外部链接通往来源页面', loadError: '文献读取失败', retry: '重新读取', noPapers: '文献库中还没有论文。请导入完成校验的文献数据后重启服务。', sourcesTitle: '原文引用及倒查补充来源', aiNote: '原文与译文范围见版本说明；判断与证据链为 AI 整理。', copyLink: '该观点链接', loading: '正在读取证据…', related: '这段文字包含', viewSource: '打开来源 ↗', localSource: '本地原文 ↓', sectionNote: '导览分段为阅读辅助',
    full_text: '已查阅全文', abstract_only: '仅查阅摘要', metadata_only: '仅查阅书目信息', unavailable: '全文未取得', original_citation: '原文明确引用', backtrace: '倒查补充', later_test: '后验实验', calculation: '独立计算', assumption: '前提辨析', main_text: '本文论证', later_theory: '后续理论', supports: '支持', qualifies: '限定范围', contradicts: '相抵触', contextRelation: '背景', derives_from: '由此推导', uses: '采用', unverified_dependency: '依赖待验证论断', alternative: '另一路径', measurement: '原始测量', derivation: '可复核推导', postulate: '明确假设', unresolved: '未解决的问题', definition: '定义或约定', historical_proposal: '当时的建议', access_gap: '来源访问缺口', bibliographic: '原始书目',
  },
  en: {
    library: 'LOCAL LIBRARY', choose: 'Choose a paper', outline: 'IN THIS PAPER', read: 'Paper', sources: 'References & traced sources', claims: 'claims', coverage: 'Paragraph-level coverage', sourceCount: 'sources', original: 'Source full text ↗', german: 'Original scan ↗', export: 'Structured data ↓',
    guide: 'Hover over an underline to trace a claim. Click to keep the panel open.', guideTouch: 'Tap an underlined passage to trace its evidence.', supported: 'Supported', conditional: 'Conditional', open: 'Unresolved', proposal: 'Proposed test', mixed: 'Mixed evidence', unsupported: 'Insufficient support', miscited: 'Miscited', outdated: 'Outdated',
    details: 'CLAIM DETAIL', pin: 'Pin', pinned: 'Pinned', close: 'Close', emptyTitle: 'Follow a claim back to its evidence.', emptyBody: 'Hover over an underlined passage for a readable assessment, evidence chain, and original sources. Click to pin the detail while you read.', example: 'Start with a central claim →', assessment: 'AI assessment', reasoning: 'Reasoning', chain: 'TRACE THE EVIDENCE', limits: 'Conditions & remaining questions', findings: 'Findings along the way', quantities: 'Numbers & calculations', refs: 'Source details', method: 'Evidence & method', terminal: 'Where this branch stops', shared: 'This evidence is expanded above', sourceNone: 'Independent analysis in this example', depth: 'Dependency', edition: 'Edition, translation & scope', scope: 'Reading scope', translation: 'Edition', rights: 'Reuse basis', context: 'connecting passages retained', annotations: 'passages linked to claims', coverageExplain: 'Coverage means the text has been annotated. Read each assessment to judge its evidential support.', updated: 'Accessed', footer: 'Text and evidence are read locally · External links lead to source pages', loadError: 'Could not load the paper', retry: 'Try again', noPapers: 'The library is empty. Import a validated paper bundle and restart the server.', sourcesTitle: 'Original citations and additional traced sources', aiNote: 'See the edition note for original and translated text. Assessments and evidence chains are AI-organized.', copyLink: 'Link to this claim', loading: 'Loading evidence…', related: 'Claims in this passage', viewSource: 'Open source ↗', localSource: 'Local original ↓', sectionNote: 'Navigation sections are editorial',
    full_text: 'Full text inspected', abstract_only: 'Abstract only', metadata_only: 'Metadata only', unavailable: 'Full text unavailable', original_citation: 'Original citation', backtrace: 'Additional backtrace', later_test: 'Later experiment', calculation: 'Independent calculation', assumption: 'Premise analysis', main_text: 'This paper', later_theory: 'Later theory', supports: 'Supports', qualifies: 'Qualifies', contradicts: 'Contradicts', contextRelation: 'Context', derives_from: 'Derived from', uses: 'Uses', unverified_dependency: 'Unverified dependency', alternative: 'Alternative route', measurement: 'Primary measurement', derivation: 'Reproducible derivation', postulate: 'Explicit postulate', unresolved: 'Unresolved issue', definition: 'Definition or convention', historical_proposal: 'Historical proposal', access_gap: 'Source access gap', bibliographic: 'Primary bibliography',
  }
};
let lang = 'zh';
try { lang = localStorage.getItem('evidence-atlas-language') === 'en' ? 'en' : 'zh'; } catch {}
let paper, paperList = [], currentClaim = null, currentSegment = null, pinned = false, detailRequestId = 0, paperLoadId = 0, loadingPaper = false, hoverTimer, restoringClaimFocus = false;
const detailCache = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const scrollBehavior = () => reducedMotion.matches ? 'auto' : 'smooth';
const t = key => ui[lang][key] || key;
Object.assign(ui.zh, { details: 'AI 解读', reasoning: '推导提要', story: '理解与推导', why: '核心理由', supporting: '查阅证据、计算与补充发现', tertiary: '参考文献与来源详情', provided_excerpt: '已读用户提供摘录', provided_full_text: '已读用户提供全文', guide: '悬停划线文字查看结论；点击固定详情。', guideTouch: '点按划线文字查看结论。', emptyTitle: '结论与依据，一处读清。', emptyBody: '正文划线处直接展示结论和关键理由，需要时展开原始证据与计算。' });
Object.assign(ui.en, { details: 'AI READING', reasoning: 'Derivation outline', story: 'Understanding the argument', why: 'The central reason', supporting: 'Evidence, calculations & additional findings', tertiary: 'References & source details', provided_excerpt: 'User-provided excerpt inspected', provided_full_text: 'User-provided full text inspected', guide: 'Hover over an underline for the conclusion. Click to pin it.', guideTouch: 'Tap an underlined passage for the conclusion.', emptyTitle: 'Conclusions with their evidence.', emptyBody: 'Underlined passages show the conclusion and its key reason. Expand sources and calculations when needed.' });
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
  $('#local-label').textContent = t('library');
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

function renderPaper() {
  const root = $('#paper'); root.replaceChildren();
  const header = el('header', 'paper-header');
  header.append(el('p', 'paper-kicker', `${paper.paper.authors.join(' / ').toUpperCase()} · ${paper.paper.year}`));
  header.append(el('h1', '', bi(paper.paper.title)));
  document.title = `${bi(paper.paper.title)} · Evidence Atlas`;
  header.append(el('p', 'byline', paper.paper.authors.join(' · ')), el('div', 'paper-meta', paper.paper.citation));
  const links = el('div', 'paper-links');
  links.append(link(t('original'), paper.paper.source_url));
  if (paper.paper.original_url) links.append(link(t('german'), paper.paper.original_url));
  const exportLink = link(t('export'), `${paperPath()}/export`, '', false); exportLink.download = `${paper.paper.id}.json`; links.append(exportLink);
  header.append(links); root.append(header);
  const guide = el('div', 'reading-guide', matchMedia('(hover:none)').matches ? t('guideTouch') : t('guide'));
  const legend = el('div', 'legend');
  for (const status of new Set(paper.claims.map(claim => claim.assessment))) legend.append(el('span', claimClass(status), t(status)));
  guide.append(legend); root.append(guide);
  const content = el('div', 'paper-content');
  const sectionMap = new Map((paper.paper.sections || []).map(s => [s.paragraph_id, s]));
  const claimMap = new Map(paper.claims.map(c => [c.id, c]));
  paper.paragraphs.forEach((paragraph, index) => {
    const section = sectionMap.get(paragraph.id);
    const authoredHeading = paragraph.type === 'heading';
    if (section && !authoredHeading) {
      const heading = el('h2', 'section-heading', bi(section.label)); heading.id = section.id; heading.title = t('sectionNote'); content.append(heading);
    }
    const block = el(authoredHeading ? 'h2' : 'div', `paper-paragraph ${authoredHeading ? 'section-heading' : ''} ${paragraph.type === 'equation' ? 'equation-paragraph' : ''} ${paragraph.type === 'footnote' ? 'footnote' : ''}`);
    block.id = paragraph.id;
    const number = el('span', 'paragraph-number', String(index + 1).padStart(2, '0'));
    if (section && authoredHeading) number.id = section.id;
    block.append(number);
    for (const [i, segment] of paragraph.segments.entries()) {
      if (i > 0 && lang === 'en') block.append(document.createTextNode(' '));
      const mark = el('span', segment.claim_ids.length ? `claim-mark ${claimClass(claimMap.get(segment.claim_ids[0]).assessment)}` : 'context-text');
      mark.id = segment.id;
      if (segment.latex) {
        try { katex.render(segment.latex, mark, { ...mathOptions, displayMode: paragraph.type === 'equation' }); }
        catch { mark.textContent = segment[lang]; }
      } else mark.textContent = segment[lang];
      if (segment.claim_ids.length) {
        mark.tabIndex = 0; mark.role = 'button'; mark.dataset.claims = segment.claim_ids.join(' ');
        mark.setAttribute('aria-controls', 'evidence-panel');
        mark.setAttribute('aria-label', `${segment[lang]} — ${t('details')}`);
        mark.addEventListener('pointerenter', event => {
          if (event.pointerType !== 'mouse' || pinned) return;
          clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => showClaim(segment.claim_ids[0], segment.id), 100);
        });
        mark.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
        mark.addEventListener('focus', () => { if (!pinned && !restoringClaimFocus) showClaim(segment.claim_ids[0], segment.id); });
        mark.addEventListener('click', () => showClaim(segment.claim_ids[0], segment.id, { pin: true }));
        mark.addEventListener('keydown', event => {
          if (['Enter', ' '].includes(event.key)) { event.preventDefault(); showClaim(segment.claim_ids[0], segment.id, { pin: true }); }
        });
      }
      block.append(mark);
    }
    content.append(block);
  });
  root.append(content);
  const edition = el('details', 'edition-note');
  edition.append(el('summary', '', t('edition')));
  for (const [key, value] of [['translation', paper.paper.edition], ['scope', paper.paper.scope], ['rights', paper.paper.rights]]) {
    const para = el('p'); para.append(el('strong', '', `${t(key)} · `), document.createTextNode(bi(value))); edition.append(para);
  }
  edition.append(el('p', '', t('aiNote'))); root.append(edition);
  const coverage = el('div', 'coverage-note');
  const stats = paper.stats;
  coverage.append(el('p', '', `${stats.annotated_segments} ${t('annotations')} · ${stats.excluded_context_segments} ${t('context')}。 ${t('coverageExplain')}`));
  root.append(coverage);
  const refs = el('section', 'sources-section'); refs.id = 'references'; refs.append(el('h2', '', t('sourcesTitle')));
  const list = el('ol', 'source-list');
  for (const source of paper.sources) {
    const li = el('li'); li.id = `source-${source.id}`;
    li.append(link(source.title, source.url), el('div', 'source-year', `${source.authors} · ${source.year ?? 'n.d.'} · ${t(source.access)}`));
    list.append(li);
  }
  refs.append(list); root.append(refs);
  const outline = $('#outline'); outline.replaceChildren(el('p', 'outline-title', t('outline')));
  for (const section of paper.paper.sections || []) outline.append(link(bi(section.label), `#${section.id}`, '', false));
  outline.append(link(t('sources'), '#references', '', false));
  const counts = el('div', 'count-box');
  counts.append(el('div', 'count-number', `${stats.claims}`), el('div', 'count-label', `${t('claims')} / ${stats.sources} ${t('sourceCount')}`));
  outline.append(counts, el('div', 'outline-bottom', `${t('coverage')}\n${paper.paper.audited_at}`));
  typeset(root);
  highlightCurrent();
}
function highlightCurrent() {
  for (const mark of document.querySelectorAll('.claim-mark')) {
    const active = Boolean(currentClaim && mark.dataset.claims.split(' ').includes(currentClaim));
    mark.classList.toggle('active', active); mark.setAttribute('aria-expanded', String(active));
  }
}
function closePanel({ restoreFocus = true } = {}) {
  const trigger = restoreFocus && $('#evidence-panel').contains(document.activeElement) ? document.getElementById(currentSegment) : null;
  clearTimeout(hoverTimer); detailRequestId++; currentClaim = null; pinned = false;
  highlightCurrent(); renderEmpty();
  if (trigger) {
    restoringClaimFocus = true;
    trigger.focus({ preventScroll: true });
    restoringClaimFocus = false;
  }
}
function renderEmpty() {
  const panel = $('#evidence-panel'); panel.classList.remove('is-open'); panel.replaceChildren();
  delete panel.dataset.view;
  panel.removeAttribute('aria-busy');
  const head = el('div', 'panel-head'); head.append(el('div', 'panel-eyebrow', t('details')));
  const empty = el('div', 'panel-empty');
  empty.append(el('div', 'empty-symbol', '↳'), el('h2', '', t('emptyTitle')), el('p', '', t('emptyBody')));
  if (paper?.claims.length) {
    const primary = paper.claims.find(c => c.kind === 'main_conclusion') || paper.claims[0];
    empty.append(button(t('example'), () => { showClaim(primary.id, primary.segment_ids[0], { pin: true }); document.getElementById(primary.segment_ids[0])?.scrollIntoView({ block: 'center', behavior: scrollBehavior() }); }, 'example-button'));
  }
  panel.append(head, empty);
}
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
  pin.textContent = t(pinned ? 'pinned' : 'pin');
  pin.classList.toggle('pinned', pinned);
  pin.setAttribute('aria-pressed', String(pinned));
}
function renderDetail(detail) {
  const { claim, evidence, sources } = detail;
  const panel = $('#evidence-panel'); panel.replaceChildren();
  panel.dataset.view = JSON.stringify([paper.paper.id, claim.id, currentSegment, lang]);
  panel.removeAttribute('aria-busy');
  const head = el('div', 'panel-head'); head.append(el('div', 'panel-eyebrow', t('details')));
  const controls = el('div', 'panel-controls');
  const pin = button(t(pinned ? 'pinned' : 'pin'), () => { pinned = !pinned; syncPinButton(); }, pinned ? 'pinned' : '');
  pin.id = 'pin-claim';
  pin.setAttribute('aria-pressed', String(pinned));
  controls.append(pin, button(t('close'), closePanel)); head.append(controls); panel.append(head);
  const body = el('div', 'panel-body is-entering');
  const segment = paper.paragraphs.flatMap(p => p.segments).find(s => s.id === currentSegment);
  if (segment?.claim_ids.length > 1) {
    const tabs = el('div', 'claim-tabs'); tabs.setAttribute('aria-label', t('related'));
    for (const id of segment.claim_ids) {
      const c = paper.claims.find(item => item.id === id);
      const tab = button(`${id.toUpperCase()} · ${t(c.assessment)}`, () => showClaim(id, segment.id, { pin: pinned }), id === claim.id ? 'selected' : '');
      tab.setAttribute('aria-pressed', String(id === claim.id)); tabs.append(tab);
    }
    body.append(tabs);
  }
  const label = el('div', 'claim-id', claim.id.toUpperCase()); label.append(el('span', `status ${claimClass(claim.assessment)}`, t(claim.assessment))); body.append(label);
  body.append(el('p', 'claim-summary', bi(claim.summary)));
  if (claim.why) {
    body.append(el('p', 'claim-reason', bi(claim.why)));
  }
  const supplemental = el('details', 'supporting-details');
  supplemental.append(el('summary', '', t('supporting')));
  const supporting = el('div', 'supporting-body');
  const explanation = claim.story?.length ? claim.story : (claim.reasoning || []).map(text => ({ text }));
  if (explanation.length) {
    const story = el('section', 'story-section');
    for (const paragraph of explanation) story.append(el('p', '', bi(paragraph.text)));
    supporting.append(story);
  }
  if (claim.limits.length) {
    const box = el('div', 'limit-box'); box.append(el('strong', '', t('limits'))); claim.limits.forEach(r => box.append(el('p', '', bi(r)))); supporting.append(box);
  }
  if (claim.findings?.length) {
    const section = el('section', 'detail-section'); section.append(el('h3', '', t('findings')));
    for (const f of claim.findings) {
      section.append(el('strong', 'node-finding', bi(f.label)), el('p', 'node-finding', bi(f.detail)));
      for (const eid of f.evidence_ids) section.append(link(eid, `#node-${eid}`, 'node-source', false));
    }
    supporting.append(section);
  }
  if (claim.quantities?.length) {
    const section = el('section', 'detail-section'); section.append(el('h3', '', t('quantities')));
    for (const q of claim.quantities) {
      const box = el('div', 'quantity'); box.append(el('b', '', bi(q.label)), el('div', '', q.value), el('div', 'calculation', q.calculation), el('div', '', bi(q.interpretation))); section.append(box);
    }
    supporting.append(section);
  }
  const chain = el('section', 'detail-section'); chain.append(el('h3', '', t('chain')));
  const map = new Map(evidence.map(e => [e.id, e])), sourceMap = new Map(sources.map(s => [s.id, s])), shown = new Set();
  function node(eid, depth = 0, edgeLabel) {
    if (shown.has(eid)) {
      const shared = link(`↳ ${edgeLabel ? edgeLabel + ' · ' : ''}${t('shared')} (${eid})`, `#node-${eid}`, 'node-branch', false);
      shared.addEventListener('click', event => { event.preventDefault(); document.getElementById(`node-${eid}`)?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }); });
      chain.append(shared); return;
    }
    shown.add(eid);
    const e = map.get(eid), source = sourceMap.get(e.source_id);
    const block = el('div', 'evidence-node'); block.id = `node-${eid}`;
    block.style.marginLeft = `${5 + Math.min(depth, 3) * 10}px`;
    if (edgeLabel) block.append(el('div', 'node-branch', `↳ ${edgeLabel}`));
    block.append(el('p', 'node-meta', `${t(e.role)} · ${t(e.relation === 'context' ? 'contextRelation' : e.relation)}`), el('p', 'node-finding', bi(e.finding)));
    const citation = el('div', 'node-source');
    if (source) citation.append(link(`${source.authors} · ${source.year ?? 'n.d.'}`, source.url)); else citation.append(el('span', '', t('sourceNone')));
    citation.append(el('span', 'locator', e.locator)); block.append(citation);
    const method = el('details', 'node-method'); method.append(el('summary', '', t('method')), el('p', '', bi(e.method))); block.append(method);
    if (e.terminal) {
      const terminal = el('div', `terminal ${e.terminal.kind}`); terminal.append(el('strong', '', `${t('terminal')} · ${t(e.terminal.kind)}`), document.createTextNode(bi(e.terminal.reason))); block.append(terminal);
    }
    chain.append(block);
    for (const edge of e.depends_on) node(edge.evidence_id, depth + 1, edge.label ? bi(edge.label) : t(edge.relation === 'context' ? 'contextRelation' : edge.relation));
  }
  for (const eid of [...claim.evidence_ids, ...(claim.story || []).flatMap(p => p.evidence_ids), ...(claim.findings || []).flatMap(f => f.evidence_ids)]) node(eid);
  supporting.append(chain);
  const refs = el('details', 'detail-section detail-sources'); refs.append(el('summary', '', `${t('tertiary')} · ${sources.length}`));
  for (const source of sources) {
    const item = el('details'); item.append(el('summary', '', `${source.authors} (${source.year ?? 'n.d.'}). ${source.title}`));
    item.append(el('p', '', `${t(source.access)} · ${t('updated')} ${source.retrieved_at}`), el('p', '', bi(source.note)), link(t('viewSource'), source.url));
    if (source.doi) item.append(el('p', '', `DOI: ${source.doi}`));
    if (source.local_path) {
      const local = link(t('localSource'), `/${source.local_path}`, '', false);
      local.download = source.local_path.split('/').pop();
      item.append(el('p', '', ''), local);
    }
    refs.append(item);
  }
  supporting.append(refs); supplemental.append(supporting); body.append(supplemental);
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
    paper = loaded; currentSegment = null; renderPaper(); renderEmpty();
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

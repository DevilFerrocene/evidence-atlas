import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MAX_PDF_BYTES = 50_000_000;
const MAX_TEXT_CHARS = 200_000;
const MAX_PIXELS = 16_000_000;
const MAX_RENDER_BYTES = 12_000_000;
const WASM_URL = `${fileURLToPath(new URL('../node_modules/pdfjs-dist/wasm/', import.meta.url))}${path.sep}`;

function fail(message) { throw new Error(message); }
function boundedInteger(value, name, { min = 1, max } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || (max !== undefined && number > max)) fail(`${name} must be an integer between ${min} and ${max}.`);
  return number;
}
async function loadPdf(workspace, relativePath) {
  if (path.extname(relativePath).toLowerCase() !== '.pdf') fail('PDF tools accept only .pdf files.');
  const bytes = await workspace.readBuffer(relativePath, { maxBytes: MAX_PDF_BYTES });
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail('File does not have a PDF signature.');
  const task = getDocument({ data: new Uint8Array(bytes), disableWorker: true, stopAtErrors: true, isEvalSupported: false, wasmUrl: WASM_URL, verbosity: 0 });
  try {
    return { document: await task.promise, task };
  } catch (error) {
    throw new Error(`PDF could not be opened: ${error.message}`);
  }
}
function outputBase(relativePath, page) {
  const stem = path.basename(relativePath, path.extname(relativePath)).replace(/[^A-Za-z0-9._-]/g, '_');
  return `${stem}-page-${page}.png`;
}

function textLayout(content) {
  const lines = [];
  let items = [];
  const flush = () => {
    const visible = items.filter(item => item.str?.trim());
    if (visible.length) {
      lines.push({ text: items.map(item => item.str).join(' ').replace(/\s+/gu, ' ').trim(),
        x: Math.min(...visible.map(item => item.transform[4])),
        y: visible[0].transform[5],
        width: Math.max(...visible.map(item => item.transform[4] + item.width)) - Math.min(...visible.map(item => item.transform[4])),
        height: Math.max(...visible.map(item => item.height || 1)) });
    }
    items = [];
  };
  for (const item of content.items) {
    if (typeof item.str !== 'string') continue;
    items.push(item);
    if (item.hasEOL) flush();
  }
  flush();
  const heights = lines.map(line => line.height).sort((a, b) => a - b);
  const size = heights[Math.floor(heights.length / 2)] || 10;
  const prose = lines.filter(line => line.text.length > 45);
  const margin = prose.length ? Math.min(...prose.map(line => line.x)) : 0;
  const paragraphs = [];
  for (const [index, line] of lines.entries()) {
    const previous = lines[index - 1];
    const gap = previous ? previous.y - line.y : 0;
    const separated = !previous || (!/^[.,;:!?，。；：！？]+$/u.test(line.text) &&
      (gap > Math.max(size, line.height, previous.height) * 1.65 ||
      (line.x > margin + size * 0.8 && line.text.length > 45 && previous.x <= margin + size * 0.5)));
    if (separated) paragraphs.push([]);
    paragraphs.at(-1).push(line.text);
  }
  return { lines, paragraphs: paragraphs.map(lines => lines.join('\n')) };
}

export async function extractPdfText(workspace, relativePath, options = {}) {
  const loaded = await loadPdf(workspace, relativePath);
  const { document, task } = loaded;
  try {
    const from = boundedInteger(options.page ?? 1, 'page', { max: document.numPages });
    const to = boundedInteger(options.page_end ?? (options.allPages ? document.numPages : from), 'page_end', { min: from, max: document.numPages });
    let remaining = options.allPages ? Infinity : MAX_TEXT_CHARS;
    const pages = [];
    for (let pageNo = from; pageNo <= to; pageNo += 1) {
      const page = await document.getPage(pageNo);
      const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
      const layout = textLayout(content);
      const raw = layout.paragraphs.join('\n\n');
      const text = raw.slice(0, remaining);
      remaining -= text.length;
      pages.push({ page: pageNo, text, text_available: Boolean(raw), truncated: raw.length > text.length,
        paragraph_count: layout.paragraphs.length,
        layout: options.allPages && raw.length <= text.length ? layout : undefined });
      if (remaining <= 0) break;
    }
    const truncated = pages.length < to - from + 1 || pages.some(page => page.truncated);
    return {
      file: relativePath, page_count: document.numPages, requested_pages: [from, to], pages, truncated,
      next_page: pages.at(-1)?.page < document.numPages ? pages.at(-1).page + 1 : null,
      layout_notice: 'Line positions and suggested paragraph breaks retain PDF text order. Fractions, scripts, columns and page boundaries still require comparison with the rendered source; extraction is not mathematical transcription.',
      notice: pages.some(page => !page.text_available)
        ? 'One or more requested pages contain no extractable text. Render the page for visual inspection; this tool does not perform OCR.'
        : undefined
    };
  } finally {
    await task.destroy();
  }
}

export async function extractPdfSource(workspace, relativePath) {
  const result = await extractPdfText(workspace, relativePath, { allPages: true });
  return { text: result.pages.map(page => page.text).join('\n\n'), pages: result.pages,
    source_pdf: relativePath, page_count: result.page_count,
    access_state: result.pages.every(page => page.text_available) ? 'provided_full_text' : 'provided_excerpt',
    extraction_notice: result.layout_notice, extraction_warning: result.notice,
    text_truncated: result.truncated };
}

export async function renderPdfPage(workspace, run, relativePath, options = {}) {
  const loaded = await loadPdf(workspace, relativePath);
  const { document, task } = loaded;
  try {
    const pageNo = boundedInteger(options.page ?? 1, 'page', { max: document.numPages });
    const scale = Number(options.scale ?? 1.5);
    if (!Number.isFinite(scale) || scale < 0.5 || scale > 3) fail('scale must be between 0.5 and 3.');
    const page = await document.getPage(pageNo);
    const viewport = page.getViewport({ scale });
    if (viewport.width * viewport.height > MAX_PIXELS) fail(`Rendered page exceeds the ${MAX_PIXELS} pixel limit; lower scale.`);
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    const png = await canvas.encode('png');
    if (png.length > MAX_RENDER_BYTES) fail(`Rendered PNG exceeds the ${MAX_RENDER_BYTES} byte limit; lower scale.`);
    const destination = path.posix.join(run.relativeDir, 'sources', outputBase(relativePath, pageNo));
    await workspace.writeBuffer(destination, png);
    await run.event('pdf_page_rendered', { file: relativePath, page: pageNo, output: destination, bytes: png.length });
    return { file: relativePath, page: pageNo, page_count: document.numPages, output: destination, width: canvas.width, height: canvas.height, bytes: png.length };
  } finally {
    await task.destroy();
  }
}

export async function cropImage(workspace, run, relativePath, options = {}) {
  const input = await workspace.readBuffer(relativePath, { maxBytes: MAX_RENDER_BYTES });
  const image = await loadImage(input);
  const x = boundedInteger(options.x, 'x', { min: 0, max: image.width - 1 });
  const y = boundedInteger(options.y, 'y', { min: 0, max: image.height - 1 });
  const width = boundedInteger(options.width, 'width', { min: 1, max: image.width - x });
  const height = boundedInteger(options.height, 'height', { min: 1, max: image.height - y });
  if (width * height > MAX_PIXELS) fail(`Crop exceeds the ${MAX_PIXELS} pixel limit.`);
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, width, height);
  const png = await canvas.encode('png');
  if (png.length > MAX_RENDER_BYTES) fail(`Cropped PNG exceeds the ${MAX_RENDER_BYTES} byte limit.`);
  const destination = path.posix.join(run.relativeDir, 'sources', `${path.basename(relativePath, path.extname(relativePath)).replace(/[^A-Za-z0-9._-]/g, '_')}-crop-${Date.now()}.png`);
  await workspace.writeBuffer(destination, png);
  await run.event('image_cropped', { file: relativePath, output: destination, x, y, width, height, bytes: png.length });
  return { input: relativePath, output: destination, width, height, bytes: png.length };
}

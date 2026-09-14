const normalized = text => text.normalize('NFC').replace(/\s+/gu, '');

export async function requireFullText(data, readSource) {
  const contract = data.paper.full_text;
  if (!contract) throw new Error('全文双语稿缺少 paper.full_text：须指定完整原文的 source_id 与 language，不能发布摘录代替全文。');
  const source = data.sources.find(item => item.id === contract.source_id);
  if (!source?.local_path?.endsWith('.txt')) throw new Error('全文原文必须对应 sources 中已保存的 UTF-8 .txt 文件。');
  const original = normalized(await readSource(source.local_path));
  if (!original) throw new Error('全文原文文件为空。');
  const translation = contract.language === 'en' ? 'zh' : 'en';
  const segments = data.paragraphs.flatMap(paragraph => paragraph.segments);
  for (const paragraph of data.paragraphs) {
    if (!paragraph.segments.map(segment => segment[contract.language] || '').join('').trim() ||
        !paragraph.segments.map(segment => segment[translation] || '').join('').trim()) {
      throw new Error(`段落 ${paragraph.id} 缺少原文或译文。`);
    }
  }
  const rendered = normalized(segments.map(segment => segment[contract.language]).join(''));
  if (rendered !== original) {
    let position = 0;
    while (position < rendered.length && position < original.length && rendered[position] === original[position]) position++;
    throw new Error(`页面原文与保存的全文不一致：全文 ${original.length} 字符，页面 ${rendered.length} 字符，首个差异在 ${position}。须按原文顺序完整保留正文、标题、图注与表格文字，并逐段翻译。`);
  }
  return { original_matches_saved_text: true, bilingual_segments: segments.length };
}

const noteStart = /^\s*([*∗†‡])\s+(?=\p{L})/u;
const bibliography = /(?:\b10\.\d{4,9}\/\S+|\b(?:18|19|20)\d{2}\b.*\b\d{1,4}\b|\b(?:Ann\.|Phys\.|Vol\.|pp?\.)[^\n]*(?:18|19|20)\d{2})/i;
const crossReference = /(?:§\s*\d+|\b(?:previous|earlier|preceding|prior)\s+(?:investigation|study|work|paper|research)|\b(?:Ref(?:erence)?s?\.?|Section)\s*\d+|前(?:一篇|述|人).*?(?:研究|工作)|文献\s*\[?\d+)/i;

export function referenceClues(blocks) {
  return blocks.flatMap(block => {
    const lines = block.original.split('\n');
    const bibliographicLines = lines.filter(line => bibliography.test(line));
    const kind = block.reference ? 'bibliography' : bibliographicLines.length ? 'bibliographic_clue'
      : block.kind === 'footnote' || noteStart.test(block.original) ? 'footnote'
      : block.citation_markers?.length || crossReference.test(block.original) ? 'citation_context' : null;
    return kind ? [{ block_id: block.id, kind,
      text: (bibliographicLines.length && !block.reference ? bibliographicLines.join('\n') : block.original).slice(0, 1000) }] : [];
  });
}

export function referenceMarks(block, blocks) {
  const marks = new Set(block.citation_markers || []);
  const prose = block.original.replace(/\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$/g, '');
  for (const match of prose.matchAll(/\[\d+(?:\s*[,;–−-]\s*\d+)*\]/g)) marks.add(match[0]);
  const knownNotes = new Set(blocks.map(item => item.original.match(noteStart)?.[1]).filter(Boolean));
  for (const match of prose.matchAll(/(?<![\p{L}\p{N}_])([*∗†‡])(?!\s*[=+\-/])/gu)) {
    if (knownNotes.has(match[1])) marks.add(match[1]);
  }
  return [...marks];
}

export function missingReferenceMarks(block, translation, blocks) {
  const canonical = text => text.normalize('NFKC').replaceAll('∗', '*').replace(/\s+/g, '');
  const target = canonical(translation || '');
  return referenceMarks(block, blocks).filter(mark => !target.includes(canonical(mark)));
}

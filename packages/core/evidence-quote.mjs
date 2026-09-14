const normalized = value => value.normalize('NFC').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u00ad\u200b]/g, '').replace(/\s+/gu, ' ').trim();

export function resolveEvidenceQuote(blocks, quote, allBlocks = blocks) {
  const selected = blocks.map(b => b.original).join('\n\n');
  if (!quote) return { quote: selected, status: 'source_blocks', block_ids: blocks.map(b => b.id) };
  if (normalized(selected).includes(normalized(quote))) {
    // Store source text rather than a typographically altered quotation.
    return { quote: selected.includes(quote) ? quote : selected, status: selected.includes(quote) ? 'exact' : 'typography_normalized', block_ids: blocks.map(b => b.id) };
  }
  const matches = allBlocks.filter(b => normalized(b.original).includes(normalized(quote)));
  if (matches.length === 1) return { quote: matches[0].original, status: 'relocated', block_ids: [matches[0].id] };
  return { quote: selected, status: 'source_blocks_used', block_ids: blocks.map(b => b.id),
    note: 'Requested quote did not match. Saved the selected source blocks verbatim, not the supplied wording. Check that these blocks support the finding; update this evidence_id if the source selection is wrong.',
    candidates: matches.map(b => b.id).slice(0, 8) };
}

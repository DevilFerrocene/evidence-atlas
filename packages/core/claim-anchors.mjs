// Bilingual ranges preserve paragraph text and order while sharing claim targets.
export function anchoredParagraphs(state) {
  const targets = new Map(state.claims.map(c => [c.id, []]));
  const paragraphs = state.blocks.filter(b => b.kind !== 'page_misc').map(block => {
    const text = state.language === 'en' ? { en: block.original, zh: block.translation ?? '' } : { zh: block.original, en: block.translation ?? '' };
    const claims = state.claims.filter(c => c.block_ids.includes(block.id));
    const ranges = [];
    for (const claim of claims) {
      const anchor = claim.anchors?.find(a => a.block_id === block.id);
      if (!anchor) continue;
      const range = { claims: [claim.id] };
      for (const lang of ['en', 'zh']) {
        const quote = anchor[lang], start = text[lang]?.indexOf(quote);
        if (!quote || start < 0 || text[lang].indexOf(quote, start + 1) !== -1) throw new Error(`${block.id}: ${lang} anchor must match one exact passage. Read the current translation and choose an unambiguous quote.`);
        range[lang] = [start, start + quote.length];
      }
      const same = ranges.find(r => ['en','zh'].every(l => r[l][0] === range[l][0] && r[l][1] === range[l][1]));
      if (same) same.claims.push(claim.id); else ranges.push(range);
    }
    ranges.sort((a,b) => a.en[0] - b.en[0]);
    const cursor = {en:0,zh:0}, segments = [];
    const add = (end, ids) => {
      const values = Object.fromEntries(['en','zh'].map(l => [l,text[l].slice(cursor[l],end[l])]));
      if (!values.en && !values.zh) return;
      const id = `s-${block.id}-${segments.length + 1}`;
      segments.push({id,...values,kind:ids.length?'claim':'context',claim_ids:ids});
      for (const claimId of ids) targets.get(claimId).push(id);
      Object.assign(cursor,end);
    };
    const legacy = claims.filter(c => !c.anchors?.length).map(c => c.id);
    for (const range of ranges) {
      if (['en','zh'].some(l => range[l][0] < cursor[l])) throw new Error(`${block.id}: overlapping or differently ordered bilingual anchors. Use disjoint passages or the same exact passage for shared claims.`);
      add({en:range.en[0],zh:range.zh[0]},legacy);
      add({en:range.en[1],zh:range.zh[1]},[...legacy,...range.claims]);
    }
    add({en:text.en.length,zh:text.zh.length},legacy);
    return {id:block.id,type:block.kind,locator:block.locator || block.id,segments};
  });
  return {paragraphs,claims:state.claims.map(({block_ids,anchors,...claim})=>({...claim,kind:'interpretation',segment_ids:targets.get(claim.id)}))};
}

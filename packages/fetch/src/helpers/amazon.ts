import { parseHTML } from 'linkedom';
import { collectText } from '@gut/shared';
import { FetchError } from '../errors.js';
import type { Helper } from './types.js';

export interface RankEntry {
  rank: number;
  category: string;
}

/** Every "#N in Category" after "Best Sellers Rank" on an Amazon product page. */
export function parseSalesRanks(html: string): RankEntry[] {
  const doc = parseHTML(html).document as unknown as { body: never };
  const text = collectText(doc.body).text;
  const at = text.search(/Best Sellers Rank/i);
  if (at < 0) return [];
  const section = text.slice(at, at + 600);
  const out: RankEntry[] = [];
  for (const m of section.matchAll(/#([\d,]+)\s+in\s+([^#(]+?)(?=\s*(?:\(|#|Customer Reviews|$))/g)) {
    out.push({ rank: Number(m[1].replace(/,/g, '')), category: m[2].trim() });
  }
  return out;
}

export const amazonSalesrank: Helper = {
  name: 'amazon_salesrank',
  title: 'Amazon sales rank (by ASIN)',
  description: 'Overall or per-category Best Sellers Rank for an ASIN, through the residential proxy, with a headless-browser fallback.',
  params: [
    { key: 'asin', label: 'ASIN or product URL', type: 'string', required: true, placeholder: 'B0ABCDEFGH' },
    { key: 'category', label: 'Category', type: 'string', default: '', help: 'Blank for the overall (first) rank, or part of a category name, e.g. "Sudoku".' },
    { key: 'domain', label: 'Store', type: 'select', default: 'amazon.com', options: ['amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de'].map((v) => ({ value: v, label: v })) },
  ],
  suggest: () => ({ unit: '#', frequency: 'daily' }),
  async fetch(p, ctx) {
    const asin = /([A-Z0-9]{10})/.exec(String(p.asin).toUpperCase())?.[1];
    if (!asin) throw new FetchError('helper_error', `not an ASIN: ${p.asin}`);
    const html = await ctx.page(`https://www.${p.domain ?? 'amazon.com'}/dp/${asin}`, { proxy: true });
    const ranks = parseSalesRanks(html);
    if (!ranks.length) throw new FetchError('selector_miss', 'no Best Sellers Rank on the page');
    const cat = String(p.category ?? '').trim().toLowerCase();
    const hit = cat ? ranks.find((r) => r.category.toLowerCase().includes(cat)) : ranks[0];
    if (!hit) throw new FetchError('selector_miss', `no rank in a category matching "${p.category}" (have: ${ranks.map((r) => r.category).join(', ')})`);
    return { value: hit.rank, raw: `#${hit.rank.toLocaleString('en-US')} in ${hit.category}` };
  },
};

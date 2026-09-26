import { FetchError } from '../errors.js';
import type { Helper } from './types.js';

type ClickyResponse = Array<{ type: string; dates?: Array<{ date: string; items?: Array<{ value?: string }> }>; error?: string }>;

export const clickyStats: Helper = {
  name: 'clicky_stats',
  title: 'Clicky web analytics',
  description: 'A total from the Clicky stats API (visitors, actions, …). Uses CLICKY_SITE_ID / CLICKY_SITEKEY unless given here.',
  params: [
    { key: 'type', label: 'Metric', type: 'select', default: 'visitors', options: ['visitors', 'visitors-unique', 'actions', 'bounce-rate', 'time-average'].map((v) => ({ value: v, label: v })) },
    { key: 'date', label: 'Period', type: 'select', default: 'today', options: ['today', 'yesterday', 'last-7-days', 'last-30-days', 'this-month'].map((v) => ({ value: v, label: v })) },
    { key: 'site_id', label: 'Site id (optional)', type: 'string' },
    { key: 'sitekey', label: 'Site key (optional)', type: 'string' },
  ],
  suggest: () => ({ unit: 'visitors', frequency: 'hourly' }),
  async fetch(p, ctx) {
    const site = String(p.site_id || ctx.config.clickySiteId || '');
    const key = String(p.sitekey || ctx.config.clickySitekey || '');
    if (!site || !key) throw new FetchError('helper_error', 'Clicky site id / sitekey not configured');
    const url = `https://api.clicky.com/api/stats/4?site_id=${encodeURIComponent(site)}&sitekey=${encodeURIComponent(key)}&type=${encodeURIComponent(String(p.type ?? 'visitors'))}&date=${encodeURIComponent(String(p.date ?? 'today'))}&output=json`;
    const r = await ctx.json<ClickyResponse>(url);
    if (r?.[0]?.error) throw new FetchError('helper_error', `Clicky: ${r[0].error}`);
    const v = r?.[0]?.dates?.[0]?.items?.[0]?.value;
    if (v == null) throw new FetchError('selector_miss', 'Clicky returned no value');
    return { value: Number(v), raw: `${p.type} ${p.date}` };
  },
};

import { FetchError } from '../errors.js';
import { queryJson } from '../jsonpath.js';
import { aggregate } from '@gut/shared';
import type { Helper } from './types.js';

export const AGGS = ['first', 'last', 'sum', 'avg', 'min', 'max', 'count'] as const;

export function aggregateValues(values: unknown[], agg: string): number {
  if (agg === 'count') return values.length;
  const nums = values.map((v) => (typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v))).filter((n) => Number.isFinite(n));
  if (!nums.length) throw new FetchError('parse_fail', 'JSONPath matched no numeric values');
  if (agg === 'first') return nums[0];
  return aggregate(nums, agg as 'avg' | 'min' | 'max' | 'last' | 'sum');
}

export const jsonApi: Helper = {
  name: 'json_api',
  title: 'JSON API',
  description: 'Fetch a JSON URL, pick values with a JSONPath, optionally aggregate them. Uses credentials.json for the host.',
  params: [
    { key: 'url', label: 'URL', type: 'string', required: true, placeholder: 'https://example.com/stats.json' },
    { key: 'path', label: 'JSONPath', type: 'string', required: true, placeholder: '$.series[*].hits', help: 'Supports . [n] [-1] [*] and ..key' },
    { key: 'agg', label: 'Aggregate', type: 'select', default: 'first', options: AGGS.map((a) => ({ value: a, label: a })) },
    { key: 'headers', label: 'Extra headers (JSON)', type: 'text', placeholder: '{"x-api-key": "…"}' },
  ],
  async fetch(p, ctx) {
    const url = String(p.url);
    let headers: Record<string, string> | undefined;
    if (p.headers) {
      try {
        headers = JSON.parse(String(p.headers));
      } catch {
        throw new FetchError('helper_error', 'headers must be a JSON object');
      }
    }
    const data = await ctx.json(url, { credential: ctx.credentialsFor(url), headers });
    let values: unknown[];
    try {
      values = queryJson(data, String(p.path));
    } catch (e) {
      throw new FetchError('helper_error', (e as Error).message);
    }
    const agg = String(p.agg ?? 'first');
    const value = aggregateValues(values, agg);
    return { value, raw: `${agg} of ${values.length} value(s) at ${p.path}` };
  },
};

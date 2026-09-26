import { TypeSafeClient, noul, type NoulQuestion } from '@typesafe-ai/sdk';
import { FetchError } from '../errors.js';
import type { Helper, HelperContext } from './types.js';
import { cached } from './types.js';

export interface HnStory {
  i: number;
  title: string;
  domain: string | null;
  points: number;
  id: string;
}

interface AlgoliaHit {
  objectID: string;
  title: string;
  url?: string | null;
  points?: number;
}

export type HnList = 'top' | 'new';

const algoliaBase = () => process.env.GUT_HN_API_BASE || 'https://hn.algolia.com';
const firebaseBase = () => process.env.GUT_HN_FIREBASE_BASE || 'https://hacker-news.firebaseio.com';

function toStory(h: AlgoliaHit, i: number): HnStory {
  let domain: string | null = null;
  try {
    domain = h.url ? new URL(h.url).hostname.replace(/^www\./, '') : null;
  } catch {
    /* ignore */
  }
  return { i, title: h.title, domain, points: h.points ?? 0, id: h.objectID };
}

/**
 * Stories from HN, fetched once per tick and shared by every topic number (D15).
 *  top: the official ranked list (what scores high), then one Algolia request for all titles.
 *  new: Algolia newest-first (what is being submitted now).
 */
export async function hnStories(ctx: HelperContext, list: HnList, n: number): Promise<HnStory[]> {
  return cached(ctx, `hn:${list}:${n}`, async () => {
    if (list === 'new') {
      const r = await ctx.json<{ hits: AlgoliaHit[] }>(`${algoliaBase()}/api/v1/search_by_date?tags=story&hitsPerPage=${n}`);
      return (r.hits ?? []).filter((h) => h.title).map(toStory);
    }
    const ids = (await ctx.json<number[]>(`${firebaseBase()}/v0/topstories.json`)).slice(0, n);
    if (!ids.length) return [];
    const tags = `story,(${ids.map((id) => `story_${id}`).join(',')})`;
    const r = await ctx.json<{ hits: AlgoliaHit[] }>(`${algoliaBase()}/api/v1/search?tags=${encodeURIComponent(tags)}&hitsPerPage=${n}`);
    const byId = new Map((r.hits ?? []).map((h) => [Number(h.objectID), h]));
    // Keep HN's rank order; ids Algolia no longer has (deleted/flagged) drop out.
    return ids.flatMap((id) => (byId.get(id)?.title ? [byId.get(id)!] : [])).map(toStory);
  });
}

/** Back-compat name used by earlier code: the top 30. */
export const frontPage = (ctx: HelperContext, n = 30) => hnStories(ctx, 'top', n);

export interface JudgedItem {
  title: string;
  p: number;
}

/**
 * One Jev request: a Noul per item, all answered in parallel inside the call (D15).
 * Each question carries its own title. Referring to `items[i]` in shared state was
 * tried first and confused neighbouring items (live test, 2026-09-26).
 */
export async function judgeItems(items: Array<{ title: string; domain?: string | null }>, topic: string, apiKey: string, model?: string): Promise<JudgedItem[]> {
  const client = new TypeSafeClient({ apiKey });
  const questions: Record<string, NoulQuestion> = {};
  items.forEach((it, i) => {
    questions[`i${i}`] = noul(
      { question: 'Is this Hacker News story about `topic`?', story_title: it.title, ...(it.domain ? { site: it.domain } : {}) },
      { true: 'The story is mainly about the topic, or the topic is central to it.', false: 'The topic is absent or only incidental to the story.' },
    );
  });
  const res = await client.systemOne({ state: { topic }, questions, ...(model ? { model } : {}) });
  return items.map((it, i) => ({ title: it.title, p: res.answers[`i${i}`]?.noul ?? 0 }));
}

export const hnTopicCount: Helper = {
  name: 'hn_topic_count',
  title: 'Hacker News: stories about a topic (Jev)',
  description:
    'Counts top or new Hacker News stories (30, 60 or 100) that TypeSafe Jev judges to be about the topic. The story list is fetched once per tick and shared by all topic numbers; one Jev call per topic. Needs TYPESAFE_API_KEY.',
  params: [
    { key: 'topic', label: 'Topic', type: 'string', required: true, placeholder: 'AI (artificial intelligence, machine learning, LLMs)', help: 'The topic text is the model\'s only definition; spell out what counts.' },
    { key: 'threshold', label: 'Threshold', type: 'number', default: 0.5, help: 'Count stories whose probability of "yes" is at least this.' },
    { key: 'list', label: 'List', type: 'select', default: 'top', options: [{ value: 'top', label: 'Top stories (ranked)' }, { value: 'new', label: 'New stories (latest submissions)' }], help: 'Compare what is being submitted with what scores high by tracking both.' },
    { key: 'stories', label: 'Stories', type: 'select', default: '30', options: [{ value: '30', label: '30 (front page)' }, { value: '60', label: '60' }, { value: '100', label: '100' }] },
  ],
  suggest: (p) => ({ label: `HN ${p.list === 'new' ? 'new' : 'top'} ${p.stories ?? 30}: ${String(p.topic ?? '').split('(')[0].trim()} stories`, unit: 'stories', frequency: 'daily' }),
  async fetch(p, ctx) {
    const key = ctx.config.typesafeApiKey;
    if (!key) throw new FetchError('helper_error', 'TYPESAFE_API_KEY is not set');
    const topic = String(p.topic ?? '').trim();
    if (!topic) throw new FetchError('helper_error', 'topic is required');
    const threshold = Number(p.threshold ?? 0.5);
    const n = [30, 60, 100].includes(Number(p.stories)) ? Number(p.stories) : 30;
    const list: HnList = p.list === 'new' ? 'new' : 'top';
    const stories = await hnStories(ctx, list, n);
    if (!stories.length) throw new FetchError('selector_miss', `Hacker News returned no ${list} stories`);
    let judged: JudgedItem[];
    try {
      judged = await judgeItems(stories, topic, key);
    } catch (e) {
      throw new FetchError('helper_error', `Jev: ${(e as Error).message}`);
    }
    const matched = judged.filter((j) => j.p >= threshold).sort((a, b) => b.p - a.p);
    return {
      value: matched.length,
      raw: JSON.stringify({ topic, list, threshold, total: stories.length, matched: matched.map((m) => ({ title: m.title, p: Math.round(m.p * 100) / 100 })) }),
    };
  },
};

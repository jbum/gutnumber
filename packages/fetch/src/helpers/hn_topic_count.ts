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

export async function frontPage(ctx: HelperContext, n: number): Promise<HnStory[]> {
  return cached(ctx, `hn:front:${n}`, async () => {
    const base = process.env.GUT_HN_API_BASE || 'https://hn.algolia.com';
    const r = await ctx.json<{ hits: AlgoliaHit[] }>(`${base}/api/v1/search?tags=front_page&hitsPerPage=${n}`);
    return (r.hits ?? []).map((h, i) => {
      let domain: string | null = null;
      try {
        domain = h.url ? new URL(h.url).hostname.replace(/^www\./, '') : null;
      } catch {
        /* ignore */
      }
      return { i, title: h.title, domain, points: h.points ?? 0, id: h.objectID };
    });
  });
}

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
  title: 'Hacker News front page: stories about a topic (Jev)',
  description:
    'Counts front-page stories that TypeSafe Jev judges to be about the topic. One HN fetch per tick (shared by all topics) and one Jev call per topic. Needs TYPESAFE_API_KEY.',
  params: [
    { key: 'topic', label: 'Topic', type: 'string', required: true, placeholder: 'AI (artificial intelligence, machine learning, LLMs)', help: 'The topic text is the model\'s only definition; spell out what counts.' },
    { key: 'threshold', label: 'Threshold', type: 'number', default: 0.5, help: 'Count stories whose probability of "yes" is at least this.' },
    { key: 'stories', label: 'Stories', type: 'select', default: '30', options: [{ value: '30', label: 'Front page (30)' }, { value: '60', label: 'Two pages (60)' }] },
  ],
  suggest: (p) => ({ label: `HN front page: ${String(p.topic ?? '').split('(')[0].trim()} stories`, unit: 'stories', frequency: 'daily' }),
  async fetch(p, ctx) {
    const key = ctx.config.typesafeApiKey;
    if (!key) throw new FetchError('helper_error', 'TYPESAFE_API_KEY is not set');
    const topic = String(p.topic ?? '').trim();
    if (!topic) throw new FetchError('helper_error', 'topic is required');
    const threshold = Number(p.threshold ?? 0.5);
    const stories = await frontPage(ctx, Number(p.stories ?? 30) === 60 ? 60 : 30);
    if (!stories.length) throw new FetchError('selector_miss', 'Hacker News returned no front-page stories');
    let judged: JudgedItem[];
    try {
      judged = await judgeItems(stories, topic, key);
    } catch (e) {
      throw new FetchError('helper_error', `Jev: ${(e as Error).message}`);
    }
    const matched = judged.filter((j) => j.p >= threshold).sort((a, b) => b.p - a.p);
    return {
      value: matched.length,
      raw: JSON.stringify({ topic, threshold, total: stories.length, matched: matched.map((m) => ({ title: m.title, p: Math.round(m.p * 100) / 100 })) }),
    };
  },
};

import { FetchError } from '../errors.js';
import type { Helper, HelperContext } from './types.js';
import { cached } from './types.js';

export interface FeedEntry {
  videoId: string;
  title: string;
  published: string;
  views: number | null;
  likes: number | null;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function parseChannelFeed(xml: string): { channel: string; entries: FeedEntry[] } {
  const channel = decode(/<title>([^<]*)<\/title>/.exec(xml)?.[1] ?? '');
  const entries: FeedEntry[] = [];
  for (const block of xml.split('<entry>').slice(1)) {
    const videoId = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(block)?.[1];
    if (!videoId) continue;
    const views = /<media:statistics views="(\d+)"/.exec(block)?.[1];
    const likes = /<media:starRating count="(\d+)"/.exec(block)?.[1];
    entries.push({
      videoId,
      title: decode(/<title>([^<]*)<\/title>/.exec(block)?.[1] ?? ''),
      published: /<published>([^<]+)<\/published>/.exec(block)?.[1] ?? '',
      views: views ? Number(views) : null,
      likes: likes ? Number(likes) : null,
    });
  }
  return { channel, entries };
}

/** Accept "UC…", a /channel/UC… URL, or an @handle / handle URL. */
export async function resolveChannelId(input: string, ctx: HelperContext): Promise<string> {
  const s = input.trim();
  const direct = /(UC[\w-]{22})/.exec(s);
  if (direct) return direct[1];
  const handle = /@([\w.-]+)/.exec(s)?.[1] ?? (/^[\w.-]+$/.test(s) ? s : null);
  if (!handle) throw new FetchError('helper_error', `cannot find a channel id in "${input}"`);
  return cached(ctx, `yt:handle:${handle}`, async () => {
    const r = await ctx.http(`https://www.youtube.com/@${handle}`);
    // The canonical link / externalId are the channel's own id; bare "channelId" fields
    // earlier on the page can belong to featured channels.
    const id =
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(r.body)?.[1] ??
      /"externalId":"(UC[\w-]{22})"/.exec(r.body)?.[1] ??
      /itemprop="identifier" content="(UC[\w-]{22})"/.exec(r.body)?.[1];
    if (!id) throw new FetchError('helper_error', `could not resolve @${handle} to a channel id`);
    return id;
  });
}

export function videoIdFrom(input: string): string | null {
  const s = input.trim();
  const m = /(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/.exec(s) ?? /^([\w-]{11})$/.exec(s);
  return m?.[1] ?? null;
}

/** Views from the watch page's inline JSON (works without an API key). */
export async function watchPageViews(videoId: string, ctx: HelperContext): Promise<number> {
  const r = await ctx.http(`https://www.youtube.com/watch?v=${videoId}`);
  const m = /"viewCount":"(\d+)"/.exec(r.body);
  if (!m) throw new FetchError('selector_miss', 'viewCount not found in the watch page');
  return Number(m[1]);
}

export const youtubeChannelFeed: Helper = {
  name: 'youtube_channel_feed',
  title: 'YouTube video views (channel RSS, no key)',
  description:
    "Reads the channel's public RSS feed, which lists view counts for its latest 15 uploads. Falls back to the watch page when the video has scrolled out of the feed.",
  params: [
    { key: 'channel', label: 'Channel', type: 'string', required: true, placeholder: 'UC… or @handle or channel URL' },
    { key: 'video', label: 'Video', type: 'string', required: true, default: 'latest', placeholder: 'video id, watch URL, or "latest"' },
    { key: 'metric', label: 'Metric', type: 'select', default: 'views', options: [{ value: 'views', label: 'Views' }, { value: 'likes', label: 'Likes' }] },
  ],
  suggest: () => ({ unit: 'views', frequency: 'hourly' }),
  async fetch(p, ctx) {
    const channelId = await resolveChannelId(String(p.channel), ctx);
    const feed = await cached(ctx, `yt:feed:${channelId}`, async () => parseChannelFeed((await ctx.http(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { accept: 'any', raw: true })).body));
    const want = String(p.video ?? 'latest').trim();
    const metric = String(p.metric ?? 'views') as 'views' | 'likes';
    const entry = want === 'latest' ? feed.entries[0] : feed.entries.find((e) => e.videoId === videoIdFrom(want));
    if (entry && entry[metric] != null) return { value: entry[metric]!, raw: `${metric} of "${entry.title}" (${entry.videoId}) via RSS` };
    const vid = want === 'latest' ? null : videoIdFrom(want);
    if (vid && metric === 'views') return { value: await watchPageViews(vid, ctx), raw: `views of ${vid} via watch page (not in the channel feed)` };
    throw new FetchError('selector_miss', want === 'latest' ? 'the channel feed is empty' : `video ${want} is not in the channel's last 15 uploads`);
  },
};

type StatsResponse = { items?: Array<{ id: string; snippet?: { title?: string }; statistics?: Record<string, string> }> };

export const youtubeVideoStats: Helper = {
  name: 'youtube_video_stats',
  title: 'YouTube video stats (Data API)',
  description: 'Views, likes or comments for any video via the YouTube Data API (1 quota unit). Needs YOUTUBE_API_KEY.',
  params: [
    { key: 'video', label: 'Video', type: 'string', required: true, placeholder: 'video id or URL' },
    { key: 'metric', label: 'Metric', type: 'select', default: 'viewCount', options: [{ value: 'viewCount', label: 'Views' }, { value: 'likeCount', label: 'Likes' }, { value: 'commentCount', label: 'Comments' }] },
  ],
  suggest: () => ({ unit: 'views', frequency: 'hourly' }),
  async fetch(p, ctx) {
    const key = ctx.config.youtubeApiKey;
    if (!key) throw new FetchError('helper_error', 'YOUTUBE_API_KEY is not set');
    const id = videoIdFrom(String(p.video));
    if (!id) throw new FetchError('helper_error', `not a video id: ${p.video}`);
    const r = await ctx.json<StatsResponse>(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${id}&key=${encodeURIComponent(key)}`);
    const item = r.items?.[0];
    const v = item?.statistics?.[String(p.metric ?? 'viewCount')];
    if (v == null) throw new FetchError('selector_miss', `no ${p.metric} for video ${id}`);
    return { value: Number(v), raw: `${p.metric} of "${item?.snippet?.title ?? id}"` };
  },
};

export const youtubeChannelStats: Helper = {
  name: 'youtube_channel_stats',
  title: 'YouTube channel stats (Data API)',
  description: 'Subscribers, total views or video count for a channel. Needs YOUTUBE_API_KEY.',
  params: [
    { key: 'channel', label: 'Channel', type: 'string', required: true, placeholder: 'UC… or @handle' },
    { key: 'metric', label: 'Metric', type: 'select', default: 'subscriberCount', options: [{ value: 'subscriberCount', label: 'Subscribers' }, { value: 'viewCount', label: 'Total views' }, { value: 'videoCount', label: 'Videos' }] },
  ],
  suggest: () => ({ unit: 'subscribers', frequency: 'daily' }),
  async fetch(p, ctx) {
    const key = ctx.config.youtubeApiKey;
    if (!key) throw new FetchError('helper_error', 'YOUTUBE_API_KEY is not set');
    const ch = String(p.channel).trim();
    const handle = /@([\w.-]+)/.exec(ch)?.[1];
    const q = handle ? `forHandle=${encodeURIComponent('@' + handle)}` : `id=${await resolveChannelId(ch, ctx)}`;
    const r = await ctx.json<StatsResponse>(`https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&${q}&key=${encodeURIComponent(key)}`);
    const item = r.items?.[0];
    const v = item?.statistics?.[String(p.metric ?? 'subscriberCount')];
    if (v == null) throw new FetchError('selector_miss', `no ${p.metric} for channel ${ch}`);
    return { value: Number(v), raw: `${p.metric} of "${item?.snippet?.title ?? ch}"` };
  },
};

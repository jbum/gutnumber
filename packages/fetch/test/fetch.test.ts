import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { queryJson, detectBotWall, credentialLookup, proxyUrl, splitProxy, parseChannelFeed, videoIdFrom, parseSalesRanks, aggregateValues, normalizeParams, getHelper, listHelpers } from '@gut/fetch';

const fx = (n: string) => readFileSync(new URL(`../../../test-fixtures/${n}`, import.meta.url), 'utf8');

describe('jsonpath', () => {
  const data = { series: [{ t: 'a', hits: { human: 10 } }, { t: 'b', hits: { human: 20 } }, { t: 'c', hits: { human: 12 } }], meta: { total: { n: 42 } } };
  it('wildcards', () => expect(queryJson(data, '$.series[*].hits.human')).toEqual([10, 20, 12]));
  it('negative index', () => expect(queryJson(data, '$.series[-1].hits.human')).toEqual([12]));
  it('bracket keys', () => expect(queryJson(data, "$['meta']['total'].n")).toEqual([42]));
  it('recursive', () => expect(queryJson(data, '$..n')).toEqual([42]));
  it('misses', () => expect(queryJson(data, '$.nope[*]')).toEqual([]));
  it('rejects junk', () => expect(() => queryJson(data, 'series')).toThrow());
  it('aggregates', () => {
    expect(aggregateValues([10, 20, 12], 'sum')).toBe(42);
    expect(aggregateValues([10, 20, 12], 'last')).toBe(12);
    expect(aggregateValues(['1,000', 5], 'max')).toBe(1000);
    expect(aggregateValues([1, 2, 3], 'count')).toBe(3);
  });
});

describe('bot walls', () => {
  it('amazon captcha', () => expect(detectBotWall('<p>api-services-support@amazon.com</p>', 200)).toMatch(/amazon/));
  it('youtube', () => expect(detectBotWall("Sign in to confirm you're not a bot", 200)).toMatch(/youtube/));
  it('short 403', () => expect(detectBotWall('<h1>nope</h1>', 403)).toMatch(/403/));
  it('real pages pass', () => expect(detectBotWall(fx('amazon-bullets.html'), 200)).toBeNull());
});

describe('credentials and proxy', () => {
  const look = credentialLookup({ 'example.com': { type: 'basic', user: 'u', pass: 'p' } });
  it('matches host and parents', () => {
    expect(look('https://example.com/x')?.user).toBe('u');
    expect(look('https://stats.example.com/x')?.user).toBe('u');
    expect(look('https://other.org/')).toBeNull();
  });
  it('fresh session per call', () => {
    const t = 'http://user:pass_session-{session}@proxy.example:12321';
    const a = proxyUrl(t)!;
    const b = proxyUrl(t)!;
    expect(a).not.toBe(b);
    expect(splitProxy(a)).toMatchObject({ server: 'http://proxy.example:12321', username: 'user' });
  });
});

describe('youtube', () => {
  it('parses the channel feed', () => {
    const f = parseChannelFeed(fx('youtube-feed.xml'));
    expect(f.entries.length).toBe(2);
    expect(f.entries[0]).toMatchObject({ videoId: 'VKlulHwMxgU' });
    expect(f.entries[0].views).toBeGreaterThan(900000);
  });
  it('video ids', () => {
    expect(videoIdFrom('https://youtu.be/UD9X5WxZ5nE?is=x')).toBe('UD9X5WxZ5nE');
    expect(videoIdFrom('https://www.youtube.com/watch?v=UD9X5WxZ5nE&t=3')).toBe('UD9X5WxZ5nE');
    expect(videoIdFrom('UD9X5WxZ5nE')).toBe('UD9X5WxZ5nE');
  });
});

describe('amazon ranks', () => {
  it('bullets layout', () => {
    expect(parseSalesRanks(fx('amazon-bullets.html'))).toEqual([
      { rank: 12345, category: 'Books' },
      { rank: 17, category: 'Sudoku' },
      { rank: 211, category: 'Logic & Brain Teasers' },
    ]);
  });
  it('table layout', () => {
    expect(parseSalesRanks(fx('amazon-table.html')).map((r) => r.rank)).toEqual([48211, 95]);
  });
});

describe('helper registry', () => {
  it('has the built-ins', () => {
    expect(listHelpers().map((h) => h.name)).toEqual(expect.arrayContaining(['youtube_channel_feed', 'hn_topic_count', 'json_api', 'amazon_salesrank']));
  });
  it('normalises params', () => {
    const h = getHelper('hn_topic_count')!;
    expect(normalizeParams(h, { topic: 'AI' })).toEqual({ topic: 'AI', threshold: 0.5, list: 'top', stories: '30' });
    expect(() => normalizeParams(h, {})).toThrow(/Topic is required/);
    expect(() => normalizeParams(h, { topic: 'x', stories: '99' })).toThrow(/one of/);
  });
});

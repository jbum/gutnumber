import { describe, expect, it } from 'vitest';
import { nextDue, retryAt, zonedParts, zonedToUtc, canonicalUrl, slugify, buildGraph, findCycle } from '@gut/shared';

const LA = { dailyHour: 6, weeklyDay: 1, tz: 'America/Los_Angeles' };
const at = (iso: string) => Date.parse(iso) / 1000;

describe('nextDue', () => {
  it('5m aligns to the clock plus jitter', () => {
    const now = at('2026-09-26T13:02:10Z');
    const t = nextDue('5m', now, LA, 0);
    expect(t).toBe(at('2026-09-26T13:05:00Z'));
    expect(nextDue('5m', now, LA, 3) - t).toBeLessThan(20);
  });
  it('hourly', () => {
    expect(nextDue('hourly', at('2026-09-26T13:59:59Z'), LA, 0)).toBe(at('2026-09-26T14:00:00Z'));
  });
  it('daily fires at 06:00 local, tomorrow when past', () => {
    expect(nextDue('daily', at('2026-09-26T12:00:00Z'), LA, 0)).toBe(at('2026-09-26T13:00:00Z')); // 06:00 PDT
    expect(nextDue('daily', at('2026-09-26T14:00:00Z'), LA, 0)).toBe(at('2026-09-27T13:00:00Z'));
  });
  it('daily across the DST change (Nov 1 2026, PDT→PST)', () => {
    expect(nextDue('daily', at('2026-11-01T02:00:00Z'), LA, 0)).toBe(at('2026-11-01T14:00:00Z')); // 06:00 PST
  });
  it('weekly on Monday', () => {
    const t = nextDue('weekly', at('2026-09-26T12:00:00Z'), LA, 0); // Saturday
    expect(zonedParts(t, LA.tz)).toMatchObject({ wd: 1, h: 6, d: 28 });
  });
  it('zonedToUtc handles a DST gap', () => {
    const t = zonedToUtc(2026, 3, 8, 2, 30, LA.tz); // 02:30 does not exist
    expect(Number.isFinite(t)).toBe(true);
  });
  it('backoff caps at the frequency', () => {
    expect(retryAt('daily', 0, 1)).toBe(900);
    expect(retryAt('daily', 0, 3)).toBe(3600);
    expect(retryAt('5m', 0, 5)).toBe(300);
  });
});

describe('urls and slugs', () => {
  it('canonicalises youtu.be share links', () => {
    expect(canonicalUrl('https://youtu.be/UD9X5WxZ5nE?is=aKpQl86pUAUMgmav')).toBe('https://www.youtube.com/watch?v=UD9X5WxZ5nE');
  });
  it('strips tracking and shortens amazon', () => {
    expect(canonicalUrl('https://www.amazon.com/Some-Book/dp/B0ABCDEFGH/ref=sr_1_1?utm_source=x&crid=1')).toBe('https://www.amazon.com/dp/B0ABCDEFGH');
    expect(canonicalUrl('https://example.com/a?utm_medium=y&keep=1')).toBe('https://example.com/a?keep=1');
  });
  it('slugifies', () => expect(slugify('Sudoku Vol 1 — Amazon rank!')).toBe('sudoku-vol-1-amazon-rank'));
});

describe('cycle detection', () => {
  it('finds dashboard → playlist → dashboard', () => {
    const g = buildGraph({ dashboards: [{ id: 1, playlistIds: [7] }], playlists: [{ id: 7, dashboardIds: [1] }] });
    expect(findCycle(g, 'd:1')).toEqual(['d:1', 'p:7', 'd:1']);
  });
  it('allows a DAG', () => {
    const g = buildGraph({ dashboards: [{ id: 1, playlistIds: [7] }, { id: 2, playlistIds: [] }], playlists: [{ id: 7, dashboardIds: [2] }] });
    expect(findCycle(g, 'd:1')).toBeNull();
  });
});

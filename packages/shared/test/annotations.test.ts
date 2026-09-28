import { describe, expect, it } from 'vitest';
import { annotationTime, VizConfigSchema } from '@gut/shared';

describe('annotations', () => {
  it('parses dates as local midnight and datetimes as local time', () => {
    expect(annotationTime('2026-09-28')).toBe(new Date(2026, 8, 28).getTime() / 1000);
    expect(annotationTime('2026-09-28T09:30')).toBe(new Date(2026, 8, 28, 9, 30).getTime() / 1000);
    expect(annotationTime('Sept 28')).toBeNull();
  });
  it('defaults to none and validates dates', () => {
    expect(VizConfigSchema.parse({}).annotations).toEqual([]);
    expect(VizConfigSchema.safeParse({ annotations: [{ at: '2026-09-28', label: 'Top 100 from here' }] }).success).toBe(true);
    expect(VizConfigSchema.safeParse({ annotations: [{ at: 'yesterday', label: 'x' }] }).success).toBe(false);
    expect(VizConfigSchema.safeParse({ annotations: [{ at: '2026-09-28', label: '' }] }).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { parseNumber, findNumbers, formatValue, formatCompact, formatAxis } from '@gut/shared';

describe('parseNumber (SELECTORS.md §4)', () => {
  const cases: Array<[string, Record<string, unknown>, number | null]> = [
    ['#12,345 in Books (See Top 100 in Books)', {}, 12345],
    ['1,234,567 views', {}, 1234567],
    ['1.2K views', {}, 1200],
    ['3.4M subscribers', {}, 3400000],
    ['Rank 3 of 42', { pick: 'last' }, 42],
    ['€ 1.234,56', { thousands: '.', decimal: ',' }, 1234.56],
    ['No reviews yet', {}, null],
    ['Top-10 list with 7 items', {}, 10],
    ['-5 degrees', {}, -5],
    ['temp −3', {}, -3],
    ['41.2%', {}, 41.2],
    ['12 Books', {}, 12],
    ['5 minutes ago', {}, 5],
    ['1.234.567 visitors', {}, 1234567],
    ['a 3 b 900 c 12', { pick: 'largest' }, 900],
    ['a 3 b 900 c 12', { pick: 'nth:2' }, 12],
    ['233,368 views', {}, 233368],
    ['version v2 has 17 bugs', {}, 17],
  ];
  it.each(cases)('%s → %s', (text, opts, expected) => {
    const r = parseNumber(text, opts);
    if (expected === null) expect(r.ok).toBe(false);
    else expect(r.ok && r.value).toBe(expected);
  });

  it('can turn off suffixes', () => {
    expect(parseNumber('3M views', { suffixes: false })).toMatchObject({ ok: true, value: 3 });
  });
  it('reports every token', () => {
    expect(findNumbers('#17 in Sudoku #211 in Logic').map((t) => t.value)).toEqual([17, 211]);
  });
});

describe('formatValue', () => {
  it('formats units', () => {
    expect(formatValue(233368, 'views')).toBe('233,368 views');
    expect(formatValue(1204, '#')).toBe('#1,204');
    expect(formatValue(12.5, '$', 2)).toBe('$12.50');
    expect(formatValue(3.21, '%', 1)).toBe('3.2%');
    expect(formatValue(null)).toBe('—');
    expect(formatCompact(70094195)).toBe('70.1M');
    expect(formatCompact(4812)).toBe('4,812');
  });
});

describe('singular units and axis labels', () => {
  it('singularises a count of one', () => {
    expect(formatValue(1, 'stories')).toBe('1 story');
    expect(formatValue(1, 'views')).toBe('1 view');
    expect(formatValue(2, 'stories')).toBe('2 stories');
    expect(formatValue(1, 'bus')).toBe('1 bus');
  });
  it('never prints neighbouring ticks the same', () => {
    const ticks = [13400, 13450, 13500, 13550, 13600];
    const labels = ticks.map((t) => formatAxis(t, 50));
    expect(new Set(labels).size).toBe(ticks.length);
    expect(labels[1]).toBe('13.45K');
    expect(formatAxis(226000, 500)).toBe('226.0K');
    expect(formatAxis(30, 5)).toBe('30');
    expect(formatAxis(70_000_000, 10_000_000)).toBe('70M');
  });
});

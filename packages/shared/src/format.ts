/** Display formatting for gutnumber values ("233,368 views", "#1,204", "$12.50", "3.2%"). */

const PREFIX_UNITS = new Set(['#', '$', '€', '£', '¥']);

export function formatValue(value: number | null | undefined, unit?: string | null, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const n = value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (!unit) return n;
  if (PREFIX_UNITS.has(unit)) return unit + n;
  if (unit === '%') return n + '%';
  return `${n} ${value === 1 ? singular(unit) : unit}`;
}

/** "stories" → "story", "views" → "view"; leaves non-plurals alone. */
export function singular(unit: string): string {
  if (/[^aeiou]ies$/i.test(unit)) return unit.slice(0, -3) + 'y';
  if (/[^su]s$/i.test(unit)) return unit.slice(0, -1);
  return unit;
}

/**
 * Axis tick label: compact, but with enough digits that neighbouring ticks never
 * print the same (13.55K and 13.6K, not 13.6K twice). `step` is the tick spacing.
 */
export function formatAxis(value: number, step: number): string {
  const a = Math.abs(value);
  const [div, suffix] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e4 ? [1e3, 'K'] : [1, ''];
  const decimals = step > 0 ? Math.max(0, Math.min(6, Math.ceil(-Math.log10(step / div) - 1e-9))) : 0;
  return (value / div).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
}

/** Compact form for axes and tiles: 1.2K, 3.4M. */
export function formatCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const a = Math.abs(value);
  const f = (v: number, s: string) => `${Number(v.toPrecision(3))}${s}`;
  if (a >= 1e9) return f(value / 1e9, 'B');
  if (a >= 1e6) return f(value / 1e6, 'M');
  if (a >= 1e4) return f(value / 1e3, 'K');
  return Number(value.toPrecision(6)).toLocaleString('en-US');
}

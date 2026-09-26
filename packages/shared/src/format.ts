/** Display formatting for gutnumber values ("233,368 views", "#1,204", "$12.50", "3.2%"). */

const PREFIX_UNITS = new Set(['#', '$', '€', '£', '¥']);

export function formatValue(value: number | null | undefined, unit?: string | null, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const n = value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (!unit) return n;
  if (PREFIX_UNITS.has(unit)) return unit + n;
  if (unit === '%') return n + '%';
  return `${n} ${unit}`;
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

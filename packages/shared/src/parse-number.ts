import { normalizeText } from './text.js';

export interface ParserOptions {
  /** 'first' | 'last' | 'largest' | 'nth:<i>' (0-based). */
  pick: string;
  thousands: string;
  decimal: string;
  /** Apply K/M/B multipliers ("1.2K" → 1200). */
  suffixes: boolean;
}

export const DEFAULT_PARSER: ParserOptions = { pick: 'first', thousands: ',', decimal: '.', suffixes: true };

export interface NumberToken {
  value: number;
  token: string;
  index: number;
}

export type ParseResult = { ok: true; value: number; token: string; tokens: NumberToken[] } | { ok: false; tokens: NumberToken[] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MULT: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/** Every numeric token in `text`, in order of appearance. */
export function findNumbers(text: string, opts: Partial<ParserOptions> = {}): NumberToken[] {
  const o = { ...DEFAULT_PARSER, ...opts };
  const t = normalizeText(text);
  const T = esc(o.thousands);
  const D = esc(o.decimal);
  // sign (not glued to a word) · digits with separators only between digits · optional K/M/B glued to the digits and not followed by a letter
  const sepPart = [o.thousands === ' ' ? ' ' : T, D].filter(Boolean).join('|');
  const re = new RegExp(
    `(?<![\\w.,])([-+\\u2212])?(\\d(?:\\d|(?:${sepPart})(?=\\d))*)(?:([KkMmBb])(?![A-Za-z]))?`,
    'g',
  );
  const out: NumberToken[] = [];
  for (const m of t.matchAll(re)) {
    const sign = m[1] === '-' || m[1] === '−' ? -1 : 1;
    let digits = m[2];
    const suffix = o.suffixes ? m[3] : undefined;
    const dCount = o.decimal ? digits.split(o.decimal).length - 1 : 0;
    let num: number;
    if (dCount > 1) {
      // "1.234.567" with '.' as the decimal: the dots must really be thousands separators.
      num = Number(digits.split(o.decimal).join('').split(o.thousands).join(''));
    } else {
      if (o.thousands) digits = digits.split(o.thousands).join('');
      if (o.decimal && o.decimal !== '.') digits = digits.replace(o.decimal, '.');
      num = Number(digits);
    }
    if (!Number.isFinite(num)) continue;
    if (suffix) num *= MULT[suffix.toLowerCase()];
    // Avoid float noise from multipliers: 1.2 * 1000 = 1200.0000000000002
    num = Number((sign * num).toPrecision(15));
    out.push({ value: num, token: m[0], index: m.index ?? 0 });
  }
  return out;
}

/** Parse a number from text following `opts.pick`. */
export function parseNumber(text: string, opts: Partial<ParserOptions> = {}): ParseResult {
  const o = { ...DEFAULT_PARSER, ...opts };
  const tokens = findNumbers(text, o);
  if (tokens.length === 0) return { ok: false, tokens };
  let chosen: NumberToken | undefined;
  if (o.pick === 'first') chosen = tokens[0];
  else if (o.pick === 'last') chosen = tokens[tokens.length - 1];
  else if (o.pick === 'largest') chosen = tokens.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
  else if (o.pick.startsWith('nth:')) chosen = tokens[Number(o.pick.slice(4))];
  else chosen = tokens[0];
  if (!chosen) return { ok: false, tokens };
  return { ok: true, value: chosen.value, token: chosen.token, tokens };
}

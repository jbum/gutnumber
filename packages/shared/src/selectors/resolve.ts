import { collectText } from '../text.js';
import { parseNumber, type ParserOptions, DEFAULT_PARSER } from '../parse-number.js';
import { evaluateXPath } from './xpath.js';
import type { Bundle, Selector, SelectorType } from './types.js';

/** Anything with a DOM-ish Document API: browser document or linkedom. */
export type DocumentLike = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ResolveInput {
  doc?: DocumentLike;
  /** Raw response body (http) or documentElement.outerHTML (browser); used by RegexSource. */
  html?: string;
}

export type ResolveResult =
  | { ok: true; value: number; raw: string; strategy: SelectorType; index: number; perSelector: PerSelector }
  | { ok: false; error: 'selector_miss' | 'parse_fail'; message: string; perSelector: PerSelector };

/** For previews: the raw text each selector found (null = no match). */
export type PerSelector = Array<{ type: SelectorType; text: string | null; value: number | null }>;

const TQ_WINDOW = 200;
const TQ_NO_SUFFIX_TAKE = 64;

/** Digit runs (with separators) collapse to '#', so "1,234 ratings" ≈ "1,299 ratings". */
function mask(s: string): { masked: string; map: number[] } {
  let masked = '';
  const map: number[] = [];
  const re = /\d(?:[\d,.]*\d)?/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    const i = m.index ?? 0;
    for (let k = last; k < i; k++) {
      masked += s[k];
      map.push(k);
    }
    masked += '#';
    map.push(i);
    last = i + m[0].length;
  }
  for (let k = last; k < s.length; k++) {
    masked += s[k];
    map.push(k);
  }
  map.push(s.length);
  return { masked, map };
}

/** Candidate texts for a TextQuote selector, most specific first. */
export function textQuoteCandidates(text: string, sel: { exact: string; prefix?: string; suffix?: string }): string[] {
  const out: string[] = [];
  const T = mask(text);
  const prefix = sel.prefix ?? '';
  const suffix = sel.suffix ?? '';
  const tails = prefix ? [prefix, prefix.slice(-32), prefix.slice(-20), prefix.slice(-12)].filter((p, i, a) => p.trim().length >= 4 && a.indexOf(p) === i) : [];
  const heads = suffix ? [suffix, suffix.slice(0, 32), suffix.slice(0, 20), suffix.slice(0, 12)].filter((p, i, a) => p.trim().length >= 3 && a.indexOf(p) === i) : [];

  for (const p of tails) {
    const mp = mask(p).masked;
    let from = 0;
    for (;;) {
      const at = T.masked.indexOf(mp, from);
      if (at < 0) break;
      from = at + 1;
      const startOrig = T.map[at + mp.length];
      let endOrig = Math.min(text.length, startOrig + TQ_NO_SUFFIX_TAKE);
      if (heads.length) {
        const windowMasked = mask(text.slice(startOrig, startOrig + TQ_WINDOW));
        for (const h of heads) {
          const hm = mask(h).masked;
          const k = windowMasked.masked.indexOf(hm);
          if (k >= 0) {
            endOrig = startOrig + windowMasked.map[k];
            break;
          }
        }
      }
      const cand = text.slice(startOrig, endOrig).trim();
      if (cand) out.push(cand);
    }
    if (out.length) return out;
  }
  // No prefix hit: the exact text itself may still be on the page (value unchanged).
  if (sel.exact && text.includes(sel.exact)) out.push(sel.exact);
  // Or anchor on the suffix alone and take what precedes it.
  if (!out.length && heads.length) {
    for (const h of heads) {
      const hm = mask(h).masked;
      const at = T.masked.indexOf(hm);
      if (at >= 0) {
        const endOrig = T.map[at];
        out.push(text.slice(Math.max(0, endOrig - TQ_NO_SUFFIX_TAKE), endOrig).trim());
        break;
      }
    }
  }
  return out;
}

function elementText(el: unknown): string | null {
  if (!el) return null;
  return collectText(el as never).text || null;
}

function docRoot(doc: DocumentLike) {
  return doc.body ?? doc.documentElement;
}

/** Text found by one selector (null if it matched nothing). May return several candidates. */
export function resolveSelectorTexts(sel: Selector, input: ResolveInput, pageText?: string): string[] {
  const { doc, html } = input;
  switch (sel.type) {
    case 'CssSelector': {
      if (!doc) return [];
      let el: unknown = null;
      try {
        el = doc.querySelector(sel.value);
      } catch {
        return [];
      }
      const t = elementText(el);
      return t ? [t] : [];
    }
    case 'XPathSelector': {
      if (!doc) return [];
      const t = elementText(evaluateXPath(doc, sel.value));
      return t ? [t] : [];
    }
    case 'TextQuoteSelector': {
      const text = pageText ?? (doc ? collectText(docRoot(doc)).text : '');
      return text ? textQuoteCandidates(text, sel) : [];
    }
    case 'RegexSource': {
      const body = html ?? doc?.documentElement?.outerHTML ?? '';
      let re: RegExp;
      try {
        re = new RegExp(sel.pattern, sel.flags ?? '');
      } catch {
        return [];
      }
      const m = re.exec(body);
      const g = m?.[sel.group ?? 1] ?? m?.[0];
      return g ? [g] : [];
    }
  }
}

/** Resolve a bundle: first selector whose text parses to a number wins. */
export function resolveBundle(bundle: Pick<Bundle, 'selectors'> & { parser?: Partial<ParserOptions> }, input: ResolveInput): ResolveResult {
  const parser = { ...DEFAULT_PARSER, ...(bundle.parser ?? {}) };
  const pageText = input.doc ? collectText(docRoot(input.doc)).text : undefined;
  const perSelector: PerSelector = [];
  let winner: { value: number; raw: string; strategy: SelectorType; index: number } | null = null;
  let anyText = false;
  bundle.selectors.forEach((sel, index) => {
    const texts = resolveSelectorTexts(sel, input, pageText);
    let found: { text: string; value: number } | null = null;
    for (const t of texts) {
      const p = parseNumber(t, parser);
      if (p.ok) {
        found = { text: t, value: p.value };
        break;
      }
    }
    if (texts.length) anyText = true;
    perSelector.push({ type: sel.type, text: found?.text ?? texts[0] ?? null, value: found?.value ?? null });
    if (found && !winner) winner = { value: found.value, raw: found.text, strategy: sel.type, index };
  });
  if (winner) return { ok: true, ...(winner as { value: number; raw: string; strategy: SelectorType; index: number }), perSelector };
  return anyText
    ? { ok: false, error: 'parse_fail', message: 'a selector matched but no number could be parsed', perSelector }
    : { ok: false, error: 'selector_miss', message: 'no selector matched the page', perSelector };
}

import { collectText, normalizeText } from '../text.js';
import { parseNumber, DEFAULT_PARSER, type ParserOptions } from '../parse-number.js';
import type { Bundle, Selector } from './types.js';
import type { DocumentLike } from './resolve.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

const GENERATED_ID = [/\d{6,}/, /[0-9a-f]{8}-[0-9a-f]{4}-/i, /^(ember|react|:r|radix|mui|css-|sc-|_|yui_|ext-gen)/i, /^[a-z]{1,3}\d{3,}$/i];
const SEMANTIC_ATTRS = ['data-testid', 'itemprop', 'data-asin', 'name', 'aria-label', 'data-field', 'data-metric', 'data-stat'];

export function cssEscape(s: string): string {
  return s.replace(/([\0-\x2c\x2e\x2f\x3a-\x40\x5b-\x5e\x60\x7b-\x7f])/g, '\\$1').replace(/^(\d)/, '\\3$1 ');
}

export function isStableId(id: string | null | undefined): id is string {
  return !!id && id.length < 64 && !GENERATED_ID.some((r) => r.test(id));
}

function isStableClass(c: string): boolean {
  if (!c || c.length > 40) return false;
  if (/^a-[a-z-]+$/.test(c)) return true; // Amazon utility classes are stable
  if (/^(css-|sc-|_|jsx-|svelte-|emotion-)/.test(c)) return false; // CSS-in-JS output
  if ((c.match(/\d/g) ?? []).length >= 3) return false; // hash-like
  if (/[A-Z]/.test(c) && /[a-z]/.test(c) && /\d/.test(c)) return false; // mixed-case hash
  if (/^[A-Za-z]{5,10}$/.test(c) && (c.slice(1).match(/[A-Z]/g) ?? []).length >= 2) return false; // styled-components (kXzLtr)
  if (/^(is-|has-)?(active|hover|focus|focused|selected|open|visible|hidden|loading)$/.test(c)) return false; // state
  return true;
}

function unique(doc: DocumentLike, sel: string, el: El): boolean {
  try {
    const all = doc.querySelectorAll(sel);
    return all.length === 1 && all[0] === el;
  } catch {
    return false;
  }
}

function nthOfType(el: El): number {
  let n = 1;
  let s = el.previousElementSibling;
  while (s) {
    if (s.tagName === el.tagName) n++;
    s = s.previousElementSibling;
  }
  return n;
}

function hasSameTagSiblings(el: El): boolean {
  const p = el.parentElement;
  if (!p) return false;
  return Array.from(p.children as ArrayLike<El>).filter((c: El) => c.tagName === el.tagName).length > 1;
}

function describe(el: El): string {
  const tag = el.tagName.toLowerCase();
  for (const a of SEMANTIC_ATTRS) {
    const v = el.getAttribute?.(a);
    if (v && v.length < 80) return `${tag}[${a}="${v.replace(/"/g, '\\"')}"]`;
  }
  const id = el.getAttribute?.('id');
  if (id && !isStableId(id)) {
    // prefixed generated ids like p13n-asin-index-3: keep the stable prefix
    const m = /^([a-zA-Z][\w-]*?[-_])\d/.exec(id);
    if (m && m[1].length >= 4) return `${tag}[id^="${m[1]}"]`;
  }
  const classes = String(el.getAttribute?.('class') ?? '')
    .split(/\s+/)
    .filter(isStableClass)
    .slice(0, 2);
  return tag + classes.map((c) => '.' + cssEscape(c)).join('');
}

/** Shortest selector unique in `doc` that is likely to survive re-rendering. */
export function generateCss(el: El, doc: DocumentLike): string | null {
  const parts: string[] = [];
  let cur: El = el;
  while (cur && cur.nodeType === 1) {
    const id = cur.getAttribute?.('id');
    if (isStableId(id)) {
      parts.unshift('#' + cssEscape(id));
      const c = parts.join(' > ');
      if (unique(doc, c, el)) return c;
      // id not unique (it happens); fall back to positional below it
      parts.shift();
    }
    let part = describe(cur);
    parts.unshift(part);
    let cand = parts.join(' > ');
    if (unique(doc, cand, el)) return cand;
    if (hasSameTagSiblings(cur)) {
      part = `${part}:nth-of-type(${nthOfType(cur)})`;
      parts[0] = part;
      cand = parts.join(' > ');
      if (unique(doc, cand, el)) return cand;
    }
    if (cur.tagName.toLowerCase() === 'html') break;
    cur = cur.parentElement;
  }
  const full = parts.join(' > ');
  return unique(doc, full, el) ? full : null;
}

/** XPath anchored at the nearest stable id, positional below it. */
export function generateXPath(el: El): string {
  const steps: string[] = [];
  let cur: El = el;
  while (cur && cur.nodeType === 1) {
    const id = cur.getAttribute?.('id');
    if (isStableId(id) && !id.includes("'")) {
      steps.unshift(`/*[@id='${id}']`);
      return '/' + steps.join('');
    }
    const tag = cur.tagName.toLowerCase();
    steps.unshift(hasSameTagSiblings(cur) ? `/${tag}[${nthOfType(cur)}]` : `/${tag}`);
    cur = cur.parentElement;
  }
  return steps.join('');
}

export function generateTextQuote(el: El, doc: DocumentLike, span = 48): Extract<Selector, { type: 'TextQuoteSelector' }> | null {
  const root = doc.body ?? doc.documentElement;
  const { text, start, end } = collectText(root, el);
  if (start < 0 || end <= start) return null;
  let prefix = text.slice(Math.max(0, start - span), start);
  let suffix = text.slice(end, end + span);
  // Start the prefix / end the suffix on a word boundary where possible.
  const sp = prefix.indexOf(' ');
  if (start - span > 0 && sp >= 0 && sp < prefix.length - 8) prefix = prefix.slice(sp + 1);
  const ss = suffix.lastIndexOf(' ');
  if (end + span < text.length && ss > 8) suffix = suffix.slice(0, ss);
  const sel: Extract<Selector, { type: 'TextQuoteSelector' }> = { type: 'TextQuoteSelector', exact: text.slice(start, end) };
  if (prefix) sel.prefix = prefix;
  if (suffix) sel.suffix = suffix;
  return sel;
}

/**
 * If the number also appears in the raw source as a JSON field (`"viewCount":"233368"`),
 * return a RegexSource for it. Valuable for client-rendered pages such as YouTube.
 */
export function generateRegexSource(value: number, html: string): Extract<Selector, { type: 'RegexSource' }> | null {
  if (!Number.isInteger(value) || Math.abs(value) < 10) return null;
  const digits = String(Math.abs(value));
  const re = new RegExp(`"([A-Za-z_][\\w]{1,40})"\\s*:\\s*"?${digits}(?![\\d.])`, 'g');
  const keys = new Map<string, number>();
  for (const m of html.matchAll(re)) keys.set(m[1], (keys.get(m[1]) ?? 0) + 1);
  if (!keys.size) return null;
  const preferred = [...keys.keys()].find((k) => /count|views|rank|total|value|num/i.test(k)) ?? [...keys.keys()][0];
  return { type: 'RegexSource', pattern: `"${preferred}"\\s*:\\s*"?(\\d+)`, group: 1 };
}

/** Clicked element plus up to 3 ancestors, capped at maxLen. */
export function contextHtml(el: El, maxLen = 16000): string {
  let best: string = String(el.outerHTML ?? '').slice(0, maxLen);
  let cur: El = el.parentElement;
  for (let i = 0; i < 3 && cur; i++) {
    const h = String(cur.outerHTML ?? '');
    if (h.length > maxLen) break;
    best = h;
    cur = cur.parentElement;
  }
  return best;
}

export interface CaptureResult {
  bundle: Bundle;
  text: string;
  value: number | null;
}

/** Build a full selector bundle for a clicked element. */
export function captureBundle(el: El, doc: DocumentLike, opts: { parser?: Partial<ParserOptions>; html?: string } = {}): CaptureResult {
  const parser: ParserOptions = { ...DEFAULT_PARSER, ...(opts.parser ?? {}) };
  const text = collectText(el).text;
  const parsed = parseNumber(text, parser);
  const selectors: Selector[] = [];
  const css = generateCss(el, doc);
  if (css) selectors.push({ type: 'CssSelector', value: css });
  selectors.push({ type: 'XPathSelector', value: generateXPath(el) });
  const tq = generateTextQuote(el, doc);
  if (tq) selectors.push(tq);
  if (parsed.ok) {
    const html = opts.html ?? String(doc.documentElement?.outerHTML ?? '');
    const rs = generateRegexSource(parsed.value, html);
    if (rs) selectors.push(rs);
  }
  return {
    text,
    value: parsed.ok ? parsed.value : null,
    bundle: {
      version: 1,
      selectors,
      parser,
      context_html: contextHtml(el),
      captured_text: normalizeText(text).slice(0, 2000),
      captured_value: parsed.ok ? parsed.value : undefined,
      captured_at: new Date().toISOString(),
    },
  };
}

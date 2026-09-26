/**
 * Text normalisation shared by the picker (browser) and the fetchers (Node).
 * What the picker saw at capture time must compare equal to what the daemon
 * sees at poll time, so both sides go through exactly these functions.
 */

const SPACE_LIKE = /[   -   　]/g;
const ZERO_WIDTH = /[​-‍⁠﻿]/g;

/** Character-level normalisation: NFC, odd spaces → space, zero-width removed. */
export function normalizeChars(s: string): string {
  return s.normalize('NFC').replace(ZERO_WIDTH, '').replace(SPACE_LIKE, ' ');
}

/** Full normalisation of a free-standing string: chars + whitespace collapse + trim. */
export function normalizeText(s: string): string {
  return normalizeChars(s).replace(/\s+/g, ' ').trim();
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'OBJECT', 'CANVAS', 'HEAD']);
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL', 'OPTION', 'BUTTON', 'LABEL',
]);

export interface CollectedText {
  text: string;
  /** Offsets of `target` inside `text`, or -1 when no target was given / found. */
  start: number;
  end: number;
}

/** Minimal structural node interface satisfied by browser DOM and linkedom. */
interface NodeLike {
  nodeType: number;
  childNodes: ArrayLike<NodeLike>;
  nodeValue?: string | null;
  tagName?: string;
}

/**
 * Walk `root` and produce whitespace-collapsed visible-ish text, skipping
 * script/style and inserting a space at block boundaries. Offsets of `target`
 * (an element under root) are reported in the normalised string.
 */
export function collectText(root: NodeLike, target?: NodeLike | null): CollectedText {
  let out = '';
  let lastSpace = true;
  let start = -1;
  let end = -1;

  const push = (s: string) => {
    const t = normalizeChars(s);
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') {
        if (!lastSpace) {
          out += ' ';
          lastSpace = true;
        }
      } else {
        out += ch;
        lastSpace = false;
      }
    }
  };

  const walk = (node: NodeLike) => {
    if (node.nodeType === 3) {
      push(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    const tag = (node.tagName ?? '').toUpperCase();
    if (SKIP_TAGS.has(tag)) return;
    const block = BLOCK_TAGS.has(tag);
    if (block) push(' ');
    const isTarget = target != null && node === target;
    if (isTarget) start = out.length;
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) walk(kids[i]);
    if (isTarget) end = out.length;
    if (block) push(' ');
  };

  walk(root);

  // Tighten target offsets past collapsed spaces at its edges.
  if (start >= 0) {
    while (start < end && out[start] === ' ') start++;
    while (end > start && out[end - 1] === ' ') end--;
  }
  // Trim the whole string, shifting offsets.
  let lead = 0;
  while (lead < out.length && out[lead] === ' ') lead++;
  let text = out.slice(lead);
  if (text.endsWith(' ')) text = text.slice(0, -1);
  if (start >= 0) {
    start = Math.max(0, start - lead);
    end = Math.min(text.length, Math.max(start, end - lead));
  }
  return { text, start, end };
}

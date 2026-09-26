/**
 * A tiny XPath subset, enough for the paths this project generates:
 *   //*[@id='x']/ul/li[3]/span     /html/body/div[2]/span     //li[2]
 * linkedom has no document.evaluate, and using one implementation everywhere
 * keeps capture and poll behaviour identical.
 */

interface El {
  tagName: string;
  children: ArrayLike<El>;
  parentElement?: El | null;
  getAttribute(n: string): string | null;
}
interface DocLike {
  documentElement: El | null;
}

interface Step {
  descendant: boolean;
  tag: string; // '*' or lower-case tag
  id?: string;
  index?: number; // 1-based among same-tag siblings
}

const STEP_RE = /^([a-zA-Z*][\w-]*)(?:\[@id=(['"])(.*?)\2\])?(?:\[(\d+)\])?$/;

export function parseXPath(path: string): Step[] | null {
  const steps: Step[] = [];
  let i = 0;
  const s = path.trim();
  if (!s.startsWith('/')) return null;
  while (i < s.length) {
    let descendant = false;
    if (s.startsWith('//', i)) {
      descendant = true;
      i += 2;
    } else if (s[i] === '/') i += 1;
    else return null;
    // read until next '/' not inside quotes or brackets
    let j = i;
    let depth = 0;
    let quote: string | null = null;
    while (j < s.length) {
      const c = s[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '[') depth++;
      else if (c === ']') depth--;
      else if (c === '/' && depth === 0) break;
      j++;
    }
    const m = STEP_RE.exec(s.slice(i, j));
    if (!m) return null;
    steps.push({ descendant, tag: m[1].toLowerCase(), id: m[3], index: m[4] ? Number(m[4]) : undefined });
    i = j;
  }
  return steps.length ? steps : null;
}

const kids = (e: El): El[] => Array.from(e.children);

function matches(e: El, st: Step, siblings: El[]): boolean {
  const tag = e.tagName.toLowerCase();
  if (st.tag !== '*' && tag !== st.tag) return false;
  if (st.id !== undefined && e.getAttribute('id') !== st.id) return false;
  if (st.index !== undefined) {
    const same = siblings.filter((s) => st.tag === '*' || s.tagName.toLowerCase() === st.tag);
    if (same.indexOf(e) !== st.index - 1) return false;
  }
  return true;
}

function descendants(e: El, out: El[] = []): El[] {
  for (const k of kids(e)) {
    out.push(k);
    descendants(k, out);
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function evaluateXPath(doc: DocLike, path: string): any {
  const steps = parseXPath(path);
  const root = doc.documentElement;
  if (!steps || !root) return null;
  // Context set starts at a virtual document node whose only child is <html>.
  const virtual: El = { tagName: '#document', children: [root], getAttribute: () => null };
  let ctx: El[] = [virtual];
  for (const st of steps) {
    const next: El[] = [];
    for (const c of ctx) {
      const pool = st.descendant ? descendants(c) : kids(c);
      for (const e of pool) {
        const parent = st.descendant ? (e.parentElement ?? virtual) : c;
        if (matches(e, st, kids(parent)) && !next.includes(e)) next.push(e);
      }
    }
    ctx = next;
    if (ctx.length === 0) return null;
  }
  return ctx[0] ?? null;
}

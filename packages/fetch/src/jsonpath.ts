/**
 * JSONPath subset: $ . .key ['key'] [n] [-n] [*] and ..key (recursive).
 * Enough for "$.series[*].hits.human" and "$.items[-1].views".
 */
type Tok = { k: 'key'; v: string } | { k: 'idx'; v: number } | { k: 'all' } | { k: 'deep'; v: string };

export function parsePath(path: string): Tok[] {
  const p = path.trim();
  if (!p.startsWith('$')) throw new Error('JSONPath must start with $');
  const toks: Tok[] = [];
  let i = 1;
  while (i < p.length) {
    if (p.startsWith('..', i)) {
      const m = /^\.\.([A-Za-z_$][\w$-]*)/.exec(p.slice(i));
      if (!m) throw new Error(`bad JSONPath near "${p.slice(i)}"`);
      toks.push({ k: 'deep', v: m[1] });
      i += m[0].length;
    } else if (p[i] === '.') {
      const m = /^\.([A-Za-z_$][\w$-]*|\*)/.exec(p.slice(i));
      if (!m) throw new Error(`bad JSONPath near "${p.slice(i)}"`);
      toks.push(m[1] === '*' ? { k: 'all' } : { k: 'key', v: m[1] });
      i += m[0].length;
    } else if (p[i] === '[') {
      const m = /^\[\s*(?:(\*)|(-?\d+)|'([^']*)'|"([^"]*)")\s*\]/.exec(p.slice(i));
      if (!m) throw new Error(`bad JSONPath near "${p.slice(i)}"`);
      if (m[1]) toks.push({ k: 'all' });
      else if (m[2] !== undefined) toks.push({ k: 'idx', v: Number(m[2]) });
      else toks.push({ k: 'key', v: m[3] ?? m[4] });
      i += m[0].length;
    } else throw new Error(`bad JSONPath near "${p.slice(i)}"`);
  }
  return toks;
}

function deepFind(v: unknown, key: string, out: unknown[]) {
  if (Array.isArray(v)) v.forEach((x) => deepFind(x, key, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === key) out.push(x);
      deepFind(x, key, out);
    }
  }
}

export function queryJson(data: unknown, path: string): unknown[] {
  let cur: unknown[] = [data];
  for (const t of parsePath(path)) {
    const next: unknown[] = [];
    for (const v of cur) {
      if (t.k === 'key') {
        if (v && typeof v === 'object' && t.v in (v as object)) next.push((v as Record<string, unknown>)[t.v]);
      } else if (t.k === 'idx') {
        if (Array.isArray(v)) {
          const x = v[t.v < 0 ? v.length + t.v : t.v];
          if (x !== undefined) next.push(x);
        }
      } else if (t.k === 'all') {
        if (Array.isArray(v)) next.push(...v);
        else if (v && typeof v === 'object') next.push(...Object.values(v));
      } else deepFind(v, t.v, next);
    }
    cur = next;
  }
  return cur;
}

export function slugify(label: string): string {
  const s = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
  return s || 'number';
}

/** Strip tracking params and canonicalise a few known URL shapes. */
export function canonicalUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (u.hostname === 'youtu.be') {
    const id = u.pathname.slice(1);
    return `https://www.youtube.com/watch?v=${id}`;
  }
  const drop = [/^utm_/, /^fbclid$/, /^gclid$/, /^si$/, /^is$/, /^ref_?$/, /^pd_rd_/, /^pf_rd_/, /^_encoding$/, /^psc$/, /^feature$/];
  for (const k of [...u.searchParams.keys()]) if (drop.some((r) => r.test(k))) u.searchParams.delete(k);
  if (/(^|\.)amazon\./.test(u.hostname)) {
    const m = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/.exec(u.pathname);
    if (m) return `${u.protocol}//${u.hostname}/dp/${m[1]}`;
  }
  return u.toString();
}

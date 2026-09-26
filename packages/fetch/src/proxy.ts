import { randomBytes } from 'node:crypto';

/**
 * PROXY_URL_TEMPLATE like http://USER:PASS_session-{session}@host:port.
 * {session} → 8 random chars (a fresh residential IP per request),
 * {country} → next entry of PROXY_COUNTRIES (rotating).
 */
let countryIdx = 0;
export function proxyUrl(template: string | null, countries: string[] = []): string | null {
  if (!template) return null;
  const session = randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8);
  let u = template.replaceAll('{session}', session);
  if (u.includes('{country}')) {
    const c = countries.length ? countries[countryIdx++ % countries.length] : 'us';
    u = u.replaceAll('{country}', c);
  }
  return u;
}

/** Split a proxy URL into server + credentials (Chromium wants them separately). */
export function splitProxy(url: string): { server: string; username?: string; password?: string } {
  const u = new URL(url);
  const server = `${u.protocol}//${u.host}`;
  return { server, username: u.username ? decodeURIComponent(u.username) : undefined, password: u.password ? decodeURIComponent(u.password) : undefined };
}

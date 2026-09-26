import { fetch as ufetch } from 'undici';

/** Pushover notification; silently skipped when not configured. */
export async function pushover(cfg: { pushoverUser: string | null; pushoverToken: string | null }, title: string, message: string, url?: string): Promise<boolean> {
  if (!cfg.pushoverUser || !cfg.pushoverToken) return false;
  try {
    const body = new URLSearchParams({ token: cfg.pushoverToken, user: cfg.pushoverUser, title, message: message.slice(0, 1000) });
    if (url) body.set('url', url);
    const r = await ufetch('https://api.pushover.net/1/messages.json', { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
    return r.ok;
  } catch {
    return false;
  }
}

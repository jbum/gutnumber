/** Pages that answer 200 but are really a captcha or block (ARCHITECTURE §6.3). */
const MARKERS: Array<{ re: RegExp; what: string }> = [
  { re: /api-services-support@amazon\.com|\/errors\/validateCaptcha|Type the characters you see in this image/i, what: 'amazon captcha' },
  { re: /Sign in to confirm you(?:’|'|&#39;)re not a bot/i, what: 'youtube bot check' },
  { re: /cf-browser-verification|challenges\.cloudflare\.com\/turnstile|<title>Just a moment\.\.\.<\/title>/i, what: 'cloudflare challenge' },
  { re: /<title>\s*(?:Access Denied|Attention Required!|Robot Check)\s*<\/title>/i, what: 'access denied page' },
  { re: /px-captcha|perimeterx/i, what: 'perimeterx challenge' },
  { re: /geo\.captcha-delivery\.com|datadome/i, what: 'datadome challenge' },
];

export function detectBotWall(html: string, status: number): string | null {
  // Only scan the first 200 KB; walls are small pages.
  const head = html.length > 200_000 ? html.slice(0, 200_000) : html;
  for (const m of MARKERS) if (m.re.test(head)) return m.what;
  if ((status === 403 || status === 429 || status === 503) && head.length < 20_000) return `blocked (HTTP ${status})`;
  return null;
}

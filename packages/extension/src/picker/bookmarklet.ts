import { startPicker } from './picker.js';
import type { ApiResponse, Transport } from '../transport.js';

/*
 * Bookmarklet build: loaded as <script src="https://gut.example.com/bookmarklet/picker.js">.
 * Calls the API directly with the browser's cached basic-auth credentials (CORS with credentials).
 * Pages with a strict Content-Security-Policy will block the script; use the extension there.
 */
const w = window as unknown as { __gutnumberPicker?: () => void };
const src = (document.currentScript as HTMLScriptElement | null)?.src ?? '';
const apiBase = src ? new URL(src).origin : location.origin;

const transport: Transport = {
  config: async () => ({ apiBase, defaultFrequency: 'daily', configured: true }),
  post: async <T>(path: string, body: unknown): Promise<ApiResponse<T>> => {
    try {
      const r = await fetch(`${apiBase}/api/v1${path}`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const text = await r.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { ok: r.ok, status: r.status, data: data as T };
    } catch (e) {
      return { ok: false, status: 0, data: null as T, error: `Could not reach ${apiBase} (${(e as Error).message}). Log in to the site in this browser first, or use the extension.` };
    }
  },
  openTab: (url: string) => void window.open(url, '_blank'),
};

if (w.__gutnumberPicker) w.__gutnumberPicker();
else w.__gutnumberPicker = startPicker(transport);

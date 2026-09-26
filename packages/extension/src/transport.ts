/** How the picker talks to the gutnumber server: via the extension's service worker, or directly (bookmarklet). */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  error?: string;
}

export interface PickerConfig {
  apiBase: string;
  defaultFrequency: string;
  configured: boolean;
}

export interface Transport {
  config(): Promise<PickerConfig>;
  post<T = unknown>(path: string, body: unknown): Promise<ApiResponse<T>>;
  openTab(url: string): void;
}

export interface Settings {
  apiBase: string;
  user: string;
  pass: string;
  defaultFrequency: string;
}

export const DEFAULT_SETTINGS: Settings = { apiBase: 'http://localhost:3100', user: '', pass: '', defaultFrequency: 'daily' };

export function errorText(r: ApiResponse): string {
  const d = r.data as { error?: { message?: string } } | null;
  if (r.status === 401) return 'The server asked for credentials: check the username and password in the extension options.';
  if (r.status === 0) return r.error ?? 'Could not reach the server: check the URL in the extension options.';
  return d?.error?.message ?? r.error ?? `HTTP ${r.status}`;
}

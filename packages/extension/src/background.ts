import { DEFAULT_SETTINGS, type ApiResponse, type Settings } from './transport.js';

async function settings(): Promise<Settings> {
  const s = (await chrome.storage.local.get('settings')).settings as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

async function api(path: string, method: string, body?: unknown): Promise<ApiResponse> {
  const s = await settings();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (s.user) headers.authorization = 'Basic ' + btoa(`${s.user}:${s.pass}`);
  try {
    const r = await fetch(s.apiBase.replace(/\/+$/, '') + '/api/v1' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: { message: text.slice(0, 200) } };
    }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: `Could not reach ${s.apiBase}: ${(e as Error).message}` };
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !/^https?:/.test(tab.url)) return;
  const s = await settings();
  const configured = !!(await chrome.storage.local.get('settings')).settings;
  if (!configured) {
    chrome.runtime.openOptionsPage();
    return;
  }
  void s;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['picker.js'] });
});

chrome.runtime.onMessage.addListener((msg: { type: string; path?: string; body?: unknown; url?: string }, _sender, reply) => {
  (async () => {
    if (msg.type === 'config') {
      const s = await settings();
      const configured = !!(await chrome.storage.local.get('settings')).settings;
      return { apiBase: s.apiBase, defaultFrequency: s.defaultFrequency, configured };
    }
    if (msg.type === 'post') return api(msg.path!, 'POST', msg.body);
    if (msg.type === 'get') return api(msg.path!, 'GET');
    if (msg.type === 'open') {
      await chrome.tabs.create({ url: msg.url! });
      return { ok: true };
    }
    return { ok: false, status: 0, data: null, error: `unknown message ${msg.type}` };
  })().then(reply);
  return true; // async reply
});

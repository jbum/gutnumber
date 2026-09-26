import { DEFAULT_SETTINGS, type Settings } from './transport.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fields = ['apiBase', 'user', 'pass', 'defaultFrequency'] as const;

async function load() {
  const s = { ...DEFAULT_SETTINGS, ...((await chrome.storage.local.get('settings')).settings ?? {}) } as Settings;
  for (const f of fields) $<HTMLInputElement>(f).value = s[f];
}

function read(): Settings {
  const s = Object.fromEntries(fields.map((f) => [f, $<HTMLInputElement>(f).value.trim()])) as unknown as Settings;
  s.apiBase = s.apiBase.replace(/\/+$/, '');
  return s;
}

function status(msg: string, ok: boolean) {
  const el = $('status');
  el.textContent = msg;
  el.className = ok ? 'ok' : 'err';
}

async function test(s: Settings): Promise<boolean> {
  const headers: Record<string, string> = {};
  if (s.user) headers.authorization = 'Basic ' + btoa(`${s.user}:${s.pass}`);
  try {
    const r = await fetch(`${s.apiBase}/api/v1/settings`, { headers });
    if (r.status === 401) return status('Connected, but the username or password was refused.', false), false;
    if (!r.ok) return status(`Server answered HTTP ${r.status}.`, false), false;
    const j = await r.json();
    status(`Connected. Server time zone ${j.tz}; daily polls at ${j.daily_hour}:00.`, true);
    return true;
  } catch (e) {
    status(`Could not reach ${s.apiBase}: ${(e as Error).message}`, false);
    return false;
  }
}

$('save').addEventListener('click', async () => {
  const s = read();
  let origin: string;
  try {
    origin = new URL(s.apiBase).origin;
  } catch {
    return status('The server URL is not valid.', false);
  }
  // Host permission for the API origin, so the service worker can call it without CORS.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) return status('Chrome did not grant access to the server; nothing saved.', false);
  await chrome.storage.local.set({ settings: s });
  if (await test(s)) status($('status').textContent + ' Saved.', true);
});

$('test').addEventListener('click', async () => {
  const s = read();
  const origin = new URL(s.apiBase).origin;
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) return status('Save first so Chrome can grant access to the server.', false);
  await test(s);
});

void load();

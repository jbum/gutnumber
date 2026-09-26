import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Helper } from './types.js';
import { jsonApi } from './json_api.js';
import { youtubeChannelFeed, youtubeVideoStats, youtubeChannelStats } from './youtube.js';
import { hnTopicCount } from './hn_topic_count.js';
import { clickyStats } from './clicky.js';
import { amazonSalesrank } from './amazon.js';

const registry = new Map<string, Helper>();
for (const h of [youtubeChannelFeed, youtubeVideoStats, youtubeChannelStats, hnTopicCount, jsonApi, clickyStats, amazonSalesrank]) registry.set(h.name, h);

export function registerHelper(h: Helper): void {
  if (!h?.name || typeof h.fetch !== 'function') throw new Error('invalid helper');
  registry.set(h.name, h);
}
export const getHelper = (name: string) => registry.get(name) ?? null;
export const listHelpers = () => [...registry.values()];

/** Personal helpers from $GUTNUMBER_PRIVATE_DIR/helpers/*.{js,mjs}; default export is a Helper or Helper[]. */
export async function loadPrivateHelpers(privateDir: string | null, log: (m: string) => void = () => {}): Promise<string[]> {
  if (!privateDir) return [];
  const dir = join(privateDir, 'helpers');
  if (!existsSync(dir)) return [];
  const loaded: string[] = [];
  for (const f of readdirSync(dir).filter((f) => /\.(m?js)$/.test(f)).sort()) {
    try {
      const mod = await import(pathToFileURL(join(dir, f)).href);
      const list = ([] as Helper[]).concat(mod.default ?? mod.helpers ?? []);
      for (const h of list) {
        registerHelper(h);
        loaded.push(h.name);
      }
    } catch (e) {
      log(`helper ${f} failed to load: ${(e as Error).message}`);
    }
  }
  return loaded;
}

/** Validate params against a helper's declaration; fills defaults. */
export function normalizeParams(h: Helper, params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of h.params) {
    let v = params[p.key];
    if (v === undefined || v === '') v = p.default;
    if ((v === undefined || v === '') && p.required) throw new Error(`${p.label} is required`);
    if (v !== undefined && p.type === 'number') {
      v = Number(v);
      if (!Number.isFinite(v)) throw new Error(`${p.label} must be a number`);
    }
    if (v !== undefined && p.type === 'boolean') v = v === true || v === 'true' || v === '1';
    if (v !== undefined && p.type === 'select' && p.options && !p.options.some((o) => o.value === String(v))) throw new Error(`${p.label} must be one of ${p.options.map((o) => o.value).join(', ')}`);
    if (v !== undefined) out[p.key] = v;
  }
  return out;
}

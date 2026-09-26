import { BundleSchema, type Bundle, type PerSelector, type ErrorClass } from '@gut/shared';
import { asFetchError, FetchError } from './errors.js';
import { PollContext, type PageFetcher } from './poll.js';
import { resolveBundle } from '@gut/shared';
import { parseHTML } from 'linkedom';
import { getHelper, normalizeParams } from './helpers/registry.js';

export interface PreviewStrategyResult {
  strategy: PageFetcher;
  ok: boolean;
  value?: number;
  raw?: string;
  selector?: string;
  error_class?: ErrorClass;
  message?: string;
  http_status?: number;
  duration_ms: number;
}

export interface PreviewResult {
  results: PreviewStrategyResult[];
  per_selector: PerSelector | null;
  recommended_fetcher: PageFetcher | null;
  fragment_warning?: string;
}

/** Server-side test fetch for the extension dialog and the editor (API.md /preview). */
export async function previewFetch(
  ctx: PollContext,
  input: { url: string; bundle: unknown; proxy?: 'none' | 'residential'; strategies?: PageFetcher[]; stop_on_success?: boolean },
): Promise<PreviewResult> {
  const bundle: Bundle = BundleSchema.parse(input.bundle);
  const strategies = input.strategies?.length ? input.strategies : (['http', 'browser'] as PageFetcher[]);
  const stop = input.stop_on_success ?? true;
  const results: PreviewStrategyResult[] = [];
  let perSelector: PerSelector | null = null;
  for (const s of strategies) {
    const started = Date.now();
    try {
      const page = await ctx.page(input.url, s, input.proxy === 'residential', { screenshot: false });
      const r = resolveBundle(bundle, { doc: parseHTML(page.html).document, html: page.html });
      perSelector = r.perSelector;
      if (r.ok) results.push({ strategy: s, ok: true, value: r.value, raw: r.raw, selector: r.strategy, http_status: page.status, duration_ms: Date.now() - started });
      else results.push({ strategy: s, ok: false, error_class: r.error, message: r.message, http_status: page.status, duration_ms: Date.now() - started });
    } catch (e) {
      const fe = asFetchError(e);
      results.push({ strategy: s, ok: false, error_class: fe.errorClass, message: fe.message, http_status: fe.httpStatus, duration_ms: Date.now() - started });
    }
    if (stop && results[results.length - 1].ok) break;
  }
  const rec = results.find((r) => r.ok)?.strategy ?? null;
  const out: PreviewResult = { results, per_selector: perSelector, recommended_fetcher: rec };
  if (input.url.includes('#') && !results.find((r) => r.strategy === 'http')?.ok)
    out.fragment_warning = 'This URL has a #fragment, which is never sent to the server. If the page reads it in JavaScript, use the browser fetcher, or point json_api at the data endpoint the page calls.';
  return out;
}

export async function testHelper(ctx: PollContext, name: string, params: Record<string, unknown>) {
  const h = getHelper(name);
  if (!h) return { ok: false as const, error_class: 'helper_error' as ErrorClass, message: `unknown helper ${name}` };
  const started = Date.now();
  try {
    const p = normalizeParams(h, params);
    const r = await h.fetch(p, ctx.helperContext());
    return { ok: true as const, value: r.value, raw: r.raw, duration_ms: Date.now() - started, suggest: h.suggest?.(p) ?? null };
  } catch (e) {
    const fe = e instanceof FetchError ? e : new FetchError('helper_error', (e as Error).message);
    return { ok: false as const, error_class: fe.errorClass, message: fe.message, duration_ms: Date.now() - started };
  }
}

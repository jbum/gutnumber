// Import shared modules directly (not the index) so zod and the schemas stay out of the page bundle.
import { captureBundle } from '@gut/shared/selectors/generate';
import type { Bundle } from '@gut/shared/selectors/types';
import { collectText } from '@gut/shared/text';
import { parseNumber } from '@gut/shared/parse-number';
import { canonicalUrl } from '@gut/shared/slug';
import { formatValue } from '@gut/shared/format';
import { CSS } from './styles.js';
import { errorText, type Transport, type PickerConfig } from '../transport.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type PreviewResponse = {
  results: Array<{ strategy: 'http' | 'browser'; ok: boolean; value?: number; selector?: string; error_class?: string; message?: string; duration_ms: number }>;
  recommended_fetcher: 'http' | 'browser' | null;
  fragment_warning?: string;
};

const MAX_TEXT = 300;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function cleanTitle(t: string): string {
  return t
    .replace(/\s*[-|–]\s*YouTube\s*$/, '')
    .replace(/^Amazon\.com\s*:\s*/, '')
    .replace(/\s*:\s*(Books|Kindle Store)\s*$/, '')
    .replace(/^\(\d+\)\s*/, '')
    .trim()
    .slice(0, 120);
}

function guessUnit(text: string): string {
  if (/\bviews?\b/i.test(text)) return 'views';
  if (/#\s?\d/.test(text) || /\brank\b/i.test(text)) return '#';
  if (/\$\s?\d/.test(text)) return '$';
  if (/\d\s?%/.test(text)) return '%';
  if (/subscribers?/i.test(text)) return 'subscribers';
  if (/followers?/i.test(text)) return 'followers';
  return '';
}

function guessLabel(text: string): string {
  const base = cleanTitle(document.title) || location.hostname;
  if (/\bviews?\b/i.test(text)) return `${base} — views`;
  if (/sellers rank|\brank\b/i.test(text)) return `${base} — sales rank`;
  return base;
}

/** YouTube watch pages: offer the RSS helper, which is steadier than the DOM. */
function youtubeInfo(): { videoId: string; channel: string } | null {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return null;
  const videoId = new URLSearchParams(location.search).get('v');
  const a = document.querySelector('ytd-video-owner-renderer a[href^="/@"], #owner a[href^="/@"]') as HTMLAnchorElement | null;
  const handle = a?.getAttribute('href')?.split('/')[1];
  return videoId && handle ? { videoId, channel: handle } : null;
}

export function startPicker(transport: Transport): () => void {
  const host = document.createElement('gutnumber-picker');
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style><div class="hl"></div><div class="badge"></div>
    <div class="bar"><span><b>Gutnumber</b>: hover a number and click it</span><span class="muted">↑/↓ widen · Esc cancel</span><button data-x="cancel">cancel</button></div>`;
  document.documentElement.appendChild(host);
  const hl = root.querySelector('.hl') as HTMLDivElement;
  const badge = root.querySelector('.badge') as HTMLDivElement;
  const bar = root.querySelector('.bar') as HTMLDivElement;

  let current: Element | null = null;
  const narrower: Element[] = [];
  let picking = true;
  let config: PickerConfig | null = null;
  void transport.config().then((c) => (config = c));

  const numberIn = (el: Element) => {
    const text = collectText(el as never).text;
    if (!text || text.length > MAX_TEXT) return null;
    const p = parseNumber(text);
    return p.ok ? { text, value: p.value } : null;
  };

  const show = (el: Element | null) => {
    current = el;
    if (!el) {
      hl.style.display = badge.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(hl.style, { display: 'block', left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
    const n = numberIn(el);
    hl.classList.toggle('num', !!n);
    if (n) {
      badge.textContent = formatValue(n.value);
      Object.assign(badge.style, { display: 'block', left: `${Math.max(4, r.left)}px`, top: `${Math.max(4, r.top - 24)}px` });
    } else badge.style.display = 'none';
  };

  const inside = (e: Event) => e.composedPath().includes(host);

  const onMove = (e: MouseEvent) => {
    if (!picking || inside(e)) return;
    const el = e.target as Element;
    if (el && el !== current) {
      narrower.length = 0;
      show(el);
    }
  };
  const block = (e: Event) => {
    if (!picking || inside(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onClick = (e: MouseEvent) => {
    if (!picking || inside(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (current && numberIn(current)) openDialog(current);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      stop();
    } else if (picking && current && e.key === 'ArrowUp' && current.parentElement && current.parentElement !== document.documentElement) {
      e.preventDefault();
      narrower.push(current);
      show(current.parentElement);
    } else if (picking && e.key === 'ArrowDown' && narrower.length) {
      e.preventDefault();
      show(narrower.pop()!);
    } else if (picking && e.key === 'Enter' && current && numberIn(current)) {
      e.preventDefault();
      openDialog(current);
    }
  };
  const onScroll = () => current && picking && show(current);

  window.addEventListener('mousemove', onMove, true);
  for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick']) window.addEventListener(t, block, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, true);
  (root.querySelector('[data-x=cancel]') as HTMLButtonElement).onclick = () => stop();

  function stop() {
    picking = false;
    window.removeEventListener('mousemove', onMove, true);
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick']) window.removeEventListener(t, block, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    host.remove();
    (window as any).__gutnumberPicker = undefined;
  }

  function openDialog(el: Element) {
    picking = false;
    hl.style.display = badge.style.display = bar.style.display = 'none';
    const html = document.documentElement.outerHTML;
    let cap = captureBundle(el, document, { html });
    const url = canonicalUrl(location.href);
    const amazon = /(^|\.)amazon\./.test(location.hostname);
    const yt = youtubeInfo();
    const freq = config?.defaultFrequency ?? 'daily';
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="dlg" role="dialog" aria-label="Track this number">
      <h2>Track this number</h2>
      <div class="value"><span class="big" data-f="value"></span><span class="raw" data-f="raw"></span></div>
      <label>Label</label><input data-f="label" maxlength="200">
      <label>URL</label><input data-f="url">
      <div class="grid">
        <div><label>Frequency</label><select data-f="frequency"><option value="5m">Every 5 minutes</option><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></div>
        <div><label>Which number in the text</label><select data-f="pick"><option value="first">First</option><option value="last">Last</option><option value="largest">Largest</option></select></div>
        <div><label>Unit</label><input data-f="unit" maxlength="16" placeholder="views, #, $, %"></div>
        <div><label>Fetch with</label><select data-f="fetcher"><option value="http">Plain HTTP</option><option value="browser">Headless browser</option></select></div>
      </div>
      <div class="check"><input type="checkbox" data-f="proxy" id="gp"><span>Use the residential proxy (needed for Amazon)</span></div>
      <div class="preview" data-f="preview"><span class="muted">Checking the page from the server…</span></div>
      ${yt ? `<div class="tip">This is a YouTube video. The <b>channel RSS helper</b> reads the view count without scraping and is steadier. <button class="btn" data-x="yt">Track with the YouTube helper</button></div>` : ''}
      <div class="actions"><button class="btn" data-x="cancel">Cancel</button><button class="btn primary" data-x="create">Create</button></div>
    </div>`;
    root.appendChild(bg);
    const f = <T extends HTMLElement = HTMLInputElement>(k: string) => bg.querySelector(`[data-f="${k}"]`) as T;
    f('label').value = guessLabel(cap.text);
    f('url').value = url;
    f<HTMLSelectElement>('frequency').value = freq;
    f('unit').value = guessUnit(cap.text);
    f('proxy').checked = amazon;
    const setValue = () => {
      f('value').textContent = cap.value == null ? 'no number' : formatValue(cap.value, f('unit').value || null);
      f('raw').textContent = cap.text.slice(0, 160);
    };
    setValue();
    f('unit').oninput = setValue;
    f<HTMLSelectElement>('pick').onchange = () => {
      cap = captureBundle(el, document, { html, parser: { pick: f<HTMLSelectElement>('pick').value } });
      setValue();
      void preview();
    };

    let previewSeq = 0;
    const preview = async () => {
      const seq = ++previewSeq;
      const box = f('preview');
      box.innerHTML = '<span class="muted">Checking the page from the server…</span>';
      const r = await transport.post<PreviewResponse>('/preview', { url: f('url').value, bundle: cap.bundle, proxy: f('proxy').checked ? 'residential' : 'none', strategies: ['http', 'browser'] });
      if (seq !== previewSeq) return;
      if (!r.ok) {
        box.innerHTML = `<span class="err">${esc(errorText(r))}</span><div class="muted">You can still create it; the daemon will retry.</div>`;
        return;
      }
      const rows = r.data.results
        .map((x) => `<div class="row"><span>${x.strategy === 'http' ? 'Plain HTTP' : 'Browser'}</span>${x.ok ? `<span class="ok">${esc(formatValue(x.value))} ✓ <span class="muted">(${esc(x.selector ?? '')})</span></span>` : `<span class="err">${esc(x.error_class ?? 'failed')}${x.message ? ': ' + esc(x.message.slice(0, 80)) : ''}</span>`}</div>`)
        .join('');
      const mismatch = r.data.results.find((x) => x.ok && cap.value != null && x.value !== cap.value);
      box.innerHTML = `${rows}${mismatch ? `<div class="muted">The server sees ${esc(formatValue(mismatch.value))}; the page shows ${esc(formatValue(cap.value))}. Values that tick live can differ; a big gap means the selector grabbed another number.</div>` : ''}${
        r.data.recommended_fetcher ? '' : '<div class="err">Neither method found the number from the server. Try the proxy, or a helper.</div>'
      }${r.data.fragment_warning ? `<div class="muted">${esc(r.data.fragment_warning)}</div>` : ''}`;
      if (r.data.recommended_fetcher) f<HTMLSelectElement>('fetcher').value = r.data.recommended_fetcher;
    };
    f('proxy').onchange = () => void preview();
    f('url').onchange = () => void preview();
    void preview();

    const done = (id: number, slug: string) => {
      const link = `${config?.apiBase ?? ''}/#numbers/${id}`;
      bg.querySelector('.dlg')!.innerHTML = `<h2>Tracking “${esc(slug)}”</h2><p>The first poll runs within a minute.</p><div class="actions"><button class="btn" data-x="open">Open the editor</button><button class="btn primary" data-x="close">Done</button></div>`;
      (bg.querySelector('[data-x=open]') as HTMLButtonElement).onclick = () => transport.openTab(link);
      (bg.querySelector('[data-x=close]') as HTMLButtonElement).onclick = () => stop();
    };
    const fail = (msg: string) => {
      f('preview').insertAdjacentHTML('beforeend', `<div class="err">${esc(msg)}</div>`);
    };

    (bg.querySelector('[data-x=cancel]') as HTMLButtonElement).onclick = () => stop();
    const createBtn = bg.querySelector('[data-x=create]') as HTMLButtonElement;
    createBtn.onclick = async () => {
      createBtn.disabled = true;
      const body = {
        label: f('label').value.trim() || cleanTitle(document.title),
        url: f('url').value.trim(),
        fetcher: f<HTMLSelectElement>('fetcher').value,
        bundle: cap.bundle as Bundle,
        proxy: f('proxy').checked ? 'residential' : 'none',
        frequency: f<HTMLSelectElement>('frequency').value,
        unit: f('unit').value.trim() || null,
      };
      const r = await transport.post<{ id: number; slug: string }>('/gutnumbers', body);
      createBtn.disabled = false;
      if (r.ok) done(r.data.id, r.data.slug);
      else fail(errorText(r));
    };
    const ytBtn = bg.querySelector('[data-x=yt]') as HTMLButtonElement | null;
    if (ytBtn && yt)
      ytBtn.onclick = async () => {
        ytBtn.disabled = true;
        const r = await transport.post<{ id: number; slug: string }>('/gutnumbers', {
          label: f('label').value.trim(),
          fetcher: 'helper',
          helper_name: 'youtube_channel_feed',
          helper_params: { channel: yt.channel, video: yt.videoId, metric: 'views' },
          frequency: f<HTMLSelectElement>('frequency').value,
          unit: 'views',
        });
        ytBtn.disabled = false;
        if (r.ok) done(r.data.id, r.data.slug);
        else fail(errorText(r));
      };
  }

  return stop;
}

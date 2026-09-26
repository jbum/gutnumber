import { useEffect, useState, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { render } from 'preact';

// ---- toasts -----------------------------------------------------------------
type Toast = { id: number; text: string; kind: 'info' | 'err' };
let toastListeners: Array<(t: Toast[]) => void> = [];
let toasts: Toast[] = [];
let tid = 0;
export function toast(text: string, kind: 'info' | 'err' = 'info') {
  const t = { id: ++tid, text, kind };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l(toasts));
  }, kind === 'err' ? 7000 : 3500);
}
export const toastError = (e: unknown) => toast((e as Error).message ?? String(e), 'err');
export function Toasts() {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    toastListeners.push(setList);
    return () => (toastListeners = toastListeners.filter((l) => l !== setList));
  }, []);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} class={`toast ${t.kind === 'err' ? 'err' : ''}`}>{t.text}</div>
      ))}
    </div>
  );
}

// ---- modal / drawer -----------------------------------------------------------
export function Modal(props: { title: ComponentChildren; onClose: () => void; wide?: boolean; children: ComponentChildren; footer?: ComponentChildren }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [props.onClose]);
  return (
    <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={`modal ${props.wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <header>
          <h2>{props.title}</h2>
          <button class="icon-btn" aria-label="Close" onClick={props.onClose}>✕</button>
        </header>
        <div class="body">{props.children}</div>
        {props.footer && <footer>{props.footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer(props: { title: ComponentChildren; sub?: ComponentChildren; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [props.onClose]);
  return (
    <aside class="drawer" role="dialog">
      <header>
        <div>
          <h2>{props.title}</h2>
          {props.sub && <div class="muted mono" style="font-size:12px;margin-top:4px">{props.sub}</div>}
        </div>
        <button class="icon-btn" aria-label="Close" onClick={props.onClose}>✕</button>
      </header>
      <div class="body">{props.children}</div>
    </aside>
  );
}

/** Promise-based confirm rendered in-page (no browser dialog). */
export function confirmDialog(message: ComponentChildren, okLabel = 'Delete'): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const close = (v: boolean) => {
      render(null, host);
      host.remove();
      resolve(v);
    };
    render(
      <Modal title="Are you sure?" onClose={() => close(false)} footer={<div class="right"><button class="btn" onClick={() => close(false)}>Cancel</button><button class="btn accent" onClick={() => close(true)} autoFocus>{okLabel}</button></div>}>
        <p>{message}</p>
      </Modal>,
      host,
    );
  });
}

// ---- small controls -----------------------------------------------------------
export function Switch(props: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button class="switch" role="switch" aria-checked={props.on} aria-label={props.label} title={props.on ? 'Enabled' : 'Disabled'} onClick={() => props.onChange(!props.on)} />;
}

export function Sparkline(props: { points?: Array<[number, number]>; color: string; width?: number; height?: number }) {
  const w = props.width ?? 110;
  const h = props.height ?? 28;
  const pts = props.points ?? [];
  if (pts.length < 2) return <svg width={w} height={h} aria-hidden="true"><line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="var(--rule)" stroke-dasharray="2 3" /></svg>;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => (x1 === x0 ? w / 2 : ((x - x0) / (x1 - x0)) * (w - 4) + 2);
  const sy = (y: number) => (y1 === y0 ? h / 2 : h - 3 - ((y - y0) / (y1 - y0)) * (h - 6));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} aria-hidden="true">
      <path d={d} fill="none" stroke={props.color} stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={sx(last[0])} cy={sy(last[1])} r="2.4" fill={props.color} />
    </svg>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: Error | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: Error | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [n, setN] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => alive.current && setState({ data, error: null, loading: false }),
      (error) => alive.current && setState({ data: null, error, loading: false }),
    );
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, reload: () => setN((x) => x + 1) };
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 0) return `in ${fmtDur(-s)}`;
  if (s < 45) return 'just now';
  return `${fmtDur(s)} ago`;
}
export function fmtDur(s: number): string {
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 129600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export const FREQ_LABEL: Record<string, string> = { '5m': 'every 5 min', hourly: 'hourly', daily: 'daily', weekly: 'weekly' };

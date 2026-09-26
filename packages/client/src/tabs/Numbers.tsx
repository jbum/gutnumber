import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatValue, FREQUENCIES, PALETTE, type Selector, type Bundle } from '@gut/shared';
import { api, type GutnumberRow, type HelperInfo, type PreviewResult, type LogRow, type HelperTest } from '../api';
import { Modal, Drawer, Switch, Sparkline, toast, toastError, confirmDialog, useAsync, ago, FREQ_LABEL } from '../components/ui';

const STATUS_LABEL: Record<string, string> = { ok: 'ok', drifted: 'drifted', failing: 'failing', new: 'new', disabled: 'off' };

export function NumbersTab(props: { openId?: number | null; onNavigate: (hash: string) => void }) {
  const list = useAsync(() => api.numbers(), []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<GutnumberRow | null>(null);
  const [helperOpen, setHelperOpen] = useState(false);
  const [drawer, setDrawer] = useState<number | null>(props.openId ?? null);
  const [rows, setRows] = useState<GutnumberRow[]>([]);

  useEffect(() => setRows(list.data ?? []), [list.data]);
  useEffect(() => setDrawer(props.openId ?? null), [props.openId]);
  useEffect(() => {
    const t = setInterval(list.reload, 30_000);
    return () => clearInterval(t);
  }, []);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((g) => (!status || g.status === status) && (!t || `${g.label} ${g.slug} ${g.host ?? ''} ${g.helper_name ?? ''}`.toLowerCase().includes(t)));
  }, [rows, q, status]);

  const patch = async (g: GutnumberRow, b: Record<string, unknown>) => {
    try {
      const u = await api.patchNumber(g.id, b);
      setRows((rs) => rs.map((r) => (r.id === g.id ? u : r)));
    } catch (e) {
      toastError(e);
    }
  };
  const pollNow = async (g: GutnumberRow) => {
    await api.pollNow(g.id).catch(toastError);
    toast(`Polling “${g.label}” within 15 seconds`);
    setTimeout(list.reload, 16_000);
  };
  const openDrawer = (id: number | null) => {
    setDrawer(id);
    props.onNavigate(id ? `numbers/${id}` : 'numbers');
  };
  const counts = useMemo(() => rows.reduce<Record<string, number>>((a, g) => ((a[g.status] = (a[g.status] ?? 0) + 1), a), {}), [rows]);

  return (
    <section>
      <div class="section-head">
        <div>
          <h1>Numbers</h1>
          <p>Everything being tracked. Toggle, retime or poll a number here; click a label for its history.</p>
        </div>
        <div class="toolbar">
          <input class="search" placeholder="Search numbers" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Search numbers" />
          <select class="field" style="width:auto" value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {['ok', 'drifted', 'failing', 'new', 'disabled'].map((s) => <option value={s}>{STATUS_LABEL[s]} ({counts[s] ?? 0})</option>)}
          </select>
          <button class="btn accent" onClick={() => setHelperOpen(true)}>＋ New from helper</button>
        </div>
      </div>

      {list.loading && !rows.length ? (
        <div class="empty">Loading…</div>
      ) : !rows.length ? (
        <div class="empty">
          <h2>Nothing tracked yet</h2>
          <p>Use the Chrome extension (or the bookmarklet on the Capture tab) to click a number on any page, or start from a helper.</p>
          <button class="btn accent" onClick={() => setHelperOpen(true)}>＋ New from helper</button>
        </div>
      ) : (
        <table class="ledger">
          <thead>
            <tr>
              <th style="width:52px"><span class="sr-only">Enabled</span></th>
              <th>Number</th>
              <th class="hide-sm">Frequency</th>
              <th style="text-align:right">Latest</th>
              <th class="hide-sm">Trend</th>
              <th class="hide-sm">Polled</th>
              <th>Status</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((g, i) => (
              <tr key={g.id} style={{ animationDelay: `${Math.min(i, 20) * 18}ms` }}>
                <td><Switch on={g.enabled} label={`Enable ${g.label}`} onChange={(v) => patch(g, { enabled: v })} /></td>
                <td class="label-cell">
                  <a href={`#numbers/${g.id}`} onClick={(e) => (e.preventDefault(), openDrawer(g.id))} style="color:inherit;text-decoration:none">
                    <strong><span class="swatch" style={{ background: g.color, marginRight: '8px' }} />{g.label}</strong>
                  </a>
                  <small>{g.slug} · {g.fetcher === 'helper' ? `helper ${g.helper_name}` : `${g.host ?? ''} · ${g.fetcher}${g.proxy === 'residential' ? ' · proxy' : ''}`}</small>
                </td>
                <td class="hide-sm">
                  <select class="inline" value={g.frequency} aria-label="Frequency" onChange={(e) => patch(g, { frequency: (e.target as HTMLSelectElement).value })}>
                    {FREQUENCIES.map((f) => <option value={f}>{FREQ_LABEL[f]}</option>)}
                  </select>
                </td>
                <td class="value" title={g.last_raw ?? ''}>{formatValue(g.last_value, g.unit, g.decimals)}</td>
                <td class="hide-sm"><Sparkline points={g.sparkline} color={g.color} /></td>
                <td class="hide-sm muted" style="font-size:13px" title={g.last_polled_at ? new Date(g.last_polled_at * 1000).toLocaleString() : ''}>{ago(g.last_polled_at)}</td>
                <td><span class={`status ${g.status}`} title={g.last_error ?? ''}>{STATUS_LABEL[g.status]}</span></td>
                <td class="actions">
                  <button class="icon-btn" title="Poll now" aria-label={`Poll ${g.label} now`} onClick={() => pollNow(g)}>↻</button>
                  <button class="btn small" onClick={() => setEditing(g)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && <EditNumber g={editing} onClose={() => setEditing(null)} onSaved={(u) => (setRows((rs) => rs.map((r) => (r.id === u.id ? u : r))), setEditing(null))} onDeleted={(id) => (setRows((rs) => rs.filter((r) => r.id !== id)), setEditing(null))} />}
      {helperOpen && <NewFromHelper onClose={() => setHelperOpen(false)} onCreated={(g) => (setRows((rs) => [...rs, g].sort((a, b) => a.label.localeCompare(b.label))), setHelperOpen(false))} />}
      {drawer && <NumberDrawer id={drawer} onClose={() => openDrawer(null)} onEdit={(g) => setEditing(g)} />}
    </section>
  );
}

// ---------------------------------------------------------------------------

function PreviewBox({ r }: { r: PreviewResult | null }) {
  if (!r) return null;
  return (
    <div class="result">
      {r.results.map((x) => (
        <div class="r" key={x.strategy}>
          <span>{x.strategy === 'http' ? 'Plain HTTP' : 'Headless browser'}</span>
          {x.ok ? <span class="ok num">{formatValue(x.value)} ✓ <span class="muted">{x.selector}</span></span> : <span class="err">{x.error_class}{x.message ? `: ${x.message.slice(0, 90)}` : ''}</span>}
        </div>
      ))}
      {r.per_selector && (
        <table class="mini" style="margin-top:6px">
          <thead><tr><th>Selector</th><th>Found</th><th>Value</th></tr></thead>
          <tbody>{r.per_selector.map((p, i) => <tr key={i}><td>{p.type}</td><td class="mono" style="font-size:11px">{p.text?.slice(0, 60) ?? <span class="err">no match</span>}</td><td class="num">{p.value == null ? '—' : formatValue(p.value)}</td></tr>)}</tbody>
        </table>
      )}
      {r.fragment_warning && <div class="hint">{r.fragment_warning}</div>}
    </div>
  );
}

function SelectorEditor({ s, onChange, onRemove }: { s: Selector; onChange: (s: Selector) => void; onRemove: () => void }) {
  const set = (k: string, v: unknown) => onChange({ ...s, [k]: v } as Selector);
  return (
    <div class="result" style="background:var(--card)">
      <div class="r"><span class="kind">{s.type}</span><button class="icon-btn" aria-label="Remove selector" onClick={onRemove}>✕</button></div>
      {s.type === 'CssSelector' || s.type === 'XPathSelector' ? (
        <input class="field mono" value={s.value} onInput={(e) => set('value', (e.target as HTMLInputElement).value)} aria-label={s.type} />
      ) : s.type === 'TextQuoteSelector' ? (
        <div class="row3">
          <div><label class="lbl">Prefix</label><input class="field" value={s.prefix ?? ''} onInput={(e) => set('prefix', (e.target as HTMLInputElement).value)} /></div>
          <div><label class="lbl">Exact (at capture)</label><input class="field" value={s.exact} onInput={(e) => set('exact', (e.target as HTMLInputElement).value)} /></div>
          <div><label class="lbl">Suffix</label><input class="field" value={s.suffix ?? ''} onInput={(e) => set('suffix', (e.target as HTMLInputElement).value)} /></div>
        </div>
      ) : (
        <div class="row2">
          <div><label class="lbl">Pattern (regex over page source)</label><input class="field mono" value={s.pattern} onInput={(e) => set('pattern', (e.target as HTMLInputElement).value)} /></div>
          <div><label class="lbl">Group</label><input class="field" type="number" min="0" value={s.group ?? 1} onInput={(e) => set('group', Number((e.target as HTMLInputElement).value))} /></div>
        </div>
      )}
    </div>
  );
}

function EditNumber({ g, onClose, onSaved, onDeleted }: { g: GutnumberRow; onClose: () => void; onSaved: (g: GutnumberRow) => void; onDeleted: (id: number) => void }) {
  const [tab, setTab] = useState<'general' | 'source' | 'repair'>('general');
  const [f, setF] = useState({ label: g.label, slug: g.slug, color: g.color, unit: g.unit ?? '', decimals: g.decimals, frequency: g.frequency, notes: g.notes ?? '', url: g.url ?? '', fetcher: g.fetcher, proxy: g.proxy });
  const [bundle, setBundle] = useState<Bundle | null>(g.bundle ? structuredClone(g.bundle) : null);
  const [params, setParams] = useState<Record<string, unknown>>({ ...(g.helper_params ?? {}) });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [helperTest, setHelperTest] = useState<HelperTest | null>(null);
  const [busy, setBusy] = useState(false);
  const helpers = useAsync(() => api.helpers(), []);
  const helper = helpers.data?.find((h) => h.name === g.helper_name);
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { label: f.label, slug: f.slug, color: f.color, unit: f.unit || null, decimals: Number(f.decimals), frequency: f.frequency, notes: f.notes || null };
      if (g.fetcher === 'helper') body.helper_params = params;
      else Object.assign(body, { url: f.url, fetcher: f.fetcher, proxy: f.proxy, bundle });
      onSaved(await api.patchNumber(g.id, body));
      toast('Saved; a fresh poll is queued');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    setPreview(null);
    try {
      if (g.fetcher === 'helper') setHelperTest(await api.testHelper(g.helper_name!, params));
      else setPreview(await api.repairTest(g.id, { bundle, url: f.url }));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!(await confirmDialog(<>Delete <b>{g.label}</b> and all of its history? It is also removed from any visualizations.</>))) return;
    try {
      const r = await api.deleteNumber(g.id);
      toast(r.affected_visualizations.length ? `Deleted; removed from ${r.affected_visualizations.length} visualization(s)` : 'Deleted');
      onDeleted(g.id);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Modal wide title={<>Edit <em>{g.label}</em></>} onClose={onClose} footer={<><button class="btn danger ghost" onClick={del}>Delete</button><div class="right"><button class="btn" onClick={test} disabled={busy}>Test on server</button><button class="btn primary" onClick={save} disabled={busy}>Save</button></div></>}>
      <div class="tabset" role="tablist">
        {(['general', 'source', ...(g.fetcher === 'helper' ? [] : ['repair'])] as const).map((t) => (
          <button role="tab" aria-selected={tab === t} onClick={() => setTab(t as typeof tab)}>{t === 'general' ? 'General' : t === 'source' ? (g.fetcher === 'helper' ? 'Helper' : 'Source') : 'Repair'}</button>
        ))}
      </div>
      {tab === 'general' && (
        <div>
          <label class="lbl">Label</label><input class="field" value={f.label} onInput={(e) => set('label', (e.target as HTMLInputElement).value)} />
          <div class="row3">
            <div><label class="lbl">Unique id (slug)</label><input class="field mono" value={f.slug} onInput={(e) => set('slug', (e.target as HTMLInputElement).value)} /></div>
            <div><label class="lbl">Frequency</label><select class="field" value={f.frequency} onChange={(e) => set('frequency', (e.target as HTMLSelectElement).value)}>{FREQUENCIES.map((x) => <option value={x}>{FREQ_LABEL[x]}</option>)}</select></div>
            <div>
              <label class="lbl">Default graph colour</label>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <input type="color" value={f.color} onInput={(e) => set('color', (e.target as HTMLInputElement).value)} aria-label="Colour" />
                {PALETTE.slice(0, 6).map((c) => <button class="swatch" style={{ background: c, cursor: 'pointer', width: '18px', height: '18px' }} aria-label={c} onClick={() => set('color', c)} />)}
              </div>
            </div>
          </div>
          <div class="row2">
            <div><label class="lbl">Unit</label><input class="field" value={f.unit} placeholder="views, #, $, %" onInput={(e) => set('unit', (e.target as HTMLInputElement).value)} /><div class="hint">Shown as {formatValue(g.last_value ?? 1234, f.unit || null, Number(f.decimals))}</div></div>
            <div><label class="lbl">Decimals</label><input class="field" type="number" min="0" max="6" value={f.decimals} onInput={(e) => set('decimals', Number((e.target as HTMLInputElement).value))} /></div>
          </div>
          <label class="lbl">Notes</label><textarea class="field" style="font-family:var(--sans);font-size:14px" value={f.notes} onInput={(e) => set('notes', (e.target as HTMLTextAreaElement).value)} />
        </div>
      )}
      {tab === 'source' && g.fetcher === 'helper' && (
        <div>
          <p class="muted">{helper?.title ?? g.helper_name}: {helper?.description}</p>
          {helper && <HelperForm helper={helper} params={params} onChange={setParams} />}
          {helperTest && <HelperTestBox t={helperTest} />}
        </div>
      )}
      {tab === 'source' && g.fetcher !== 'helper' && (
        <div>
          <label class="lbl">URL</label><input class="field mono" value={f.url} onInput={(e) => set('url', (e.target as HTMLInputElement).value)} />
          <div class="row2">
            <div><label class="lbl">Fetch with</label><select class="field" value={f.fetcher} onChange={(e) => set('fetcher', (e.target as HTMLSelectElement).value)}><option value="http">Plain HTTP (falls back to browser)</option><option value="browser">Headless browser</option></select></div>
            <div><label class="lbl">Proxy</label><select class="field" value={f.proxy} onChange={(e) => set('proxy', (e.target as HTMLSelectElement).value)}><option value="none">None</option><option value="residential">Residential</option></select></div>
          </div>
          <label class="lbl">Selectors, tried in order</label>
          {bundle?.selectors.map((s, i) => (
            <SelectorEditor key={i} s={s} onChange={(n) => setBundle((b) => b && { ...b, selectors: b.selectors.map((x, j) => (j === i ? n : x)) })} onRemove={() => setBundle((b) => b && { ...b, selectors: b.selectors.filter((_, j) => j !== i) })} />
          ))}
          <div class="toolbar" style="margin-top:8px">
            <span class="muted" style="font-size:13px">Add:</span>
            {(['CssSelector', 'TextQuoteSelector', 'RegexSource', 'XPathSelector'] as const).map((t) => (
              <button class="btn small" onClick={() => setBundle((b) => ({ version: 1, parser: b?.parser ?? { pick: 'first', thousands: ',', decimal: '.', suffixes: true }, ...b, selectors: [...(b?.selectors ?? []), t === 'TextQuoteSelector' ? { type: t, exact: '', prefix: '' } : t === 'RegexSource' ? { type: t, pattern: '', group: 1 } : { type: t, value: '' }] }) as Bundle)}>{t.replace('Selector', '').replace('Source', ' regex')}</button>
            ))}
          </div>
          <div class="row3">
            <div><label class="lbl">Which number</label><select class="field" value={bundle?.parser.pick ?? 'first'} onChange={(e) => setBundle((b) => b && { ...b, parser: { ...b.parser, pick: (e.target as HTMLSelectElement).value } })}><option value="first">First</option><option value="last">Last</option><option value="largest">Largest</option></select></div>
            <div><label class="lbl">Thousands / decimal</label><select class="field" value={`${bundle?.parser.thousands ?? ','}${bundle?.parser.decimal ?? '.'}`} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setBundle((b) => b && { ...b, parser: { ...b.parser, thousands: v[0], decimal: v[1] } }); }}><option value=",.">1,234.5</option><option value=".,">1.234,5</option><option value=" ,">1 234,5</option></select></div>
            <label class="check"><input type="checkbox" checked={bundle?.parser.suffixes ?? true} onChange={(e) => setBundle((b) => b && { ...b, parser: { ...b.parser, suffixes: (e.target as HTMLInputElement).checked } })} /> K / M / B suffixes</label>
          </div>
          <PreviewBox r={preview} />
        </div>
      )}
      {tab === 'repair' && <Repair g={g} bundle={bundle} />}
    </Modal>
  );
}

function Repair({ g, bundle }: { g: GutnumberRow; bundle: Bundle | null }) {
  const page = useAsync(() => api.numberPage(g.id), [g.id]);
  return (
    <div>
      <p class="muted">What the page looked like when the number was captured, next to the last page the daemon fetched successfully. Edit selectors on the Source tab and use <b>Test on server</b>.</p>
      <div class="row2">
        <div>
          <label class="lbl">At capture {bundle?.captured_at ? `(${new Date(bundle.captured_at).toLocaleDateString()})` : ''}</label>
          <div class="hint">Text: <span class="mono">{bundle?.captured_text?.slice(0, 120) ?? '—'}</span></div>
          <pre class="code">{bundle?.context_html ?? 'not recorded'}</pre>
        </div>
        <div>
          <label class="lbl">Last fetched page {page.data ? `(${new Date(page.data.fetched_at).toLocaleString()})` : ''}</label>
          {page.error ? <p class="muted">{page.error.message}</p> : <pre class="code">{page.data ? excerpt(page.data.html, bundle?.captured_text) : 'loading…'}</pre>}
        </div>
      </div>
    </div>
  );
}

/** Show the part of the fetched page around the captured words, not the whole page. */
function excerpt(html: string, capturedText?: string): string {
  const words = (capturedText ?? '').replace(/[\d,.#]+/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  for (const w of words) {
    const i = html.indexOf(w);
    if (i >= 0) return html.slice(Math.max(0, i - 1500), i + 1500);
  }
  return html.slice(0, 3000);
}

// ---------------------------------------------------------------------------

function HelperForm({ helper, params, onChange }: { helper: HelperInfo; params: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...params, [k]: v });
  return (
    <div>
      {helper.params.map((p) => (
        <div key={p.key}>
          <label class="lbl">{p.label}{p.required ? ' *' : ''}</label>
          {p.type === 'select' ? (
            <select class="field" value={String(params[p.key] ?? p.default ?? '')} onChange={(e) => set(p.key, (e.target as HTMLSelectElement).value)}>{p.options?.map((o) => <option value={o.value}>{o.label}</option>)}</select>
          ) : p.type === 'text' ? (
            <textarea class="field" placeholder={p.placeholder} value={String(params[p.key] ?? '')} onInput={(e) => set(p.key, (e.target as HTMLTextAreaElement).value)} />
          ) : p.type === 'boolean' ? (
            <label class="check"><input type="checkbox" checked={!!(params[p.key] ?? p.default)} onChange={(e) => set(p.key, (e.target as HTMLInputElement).checked)} /> {p.help}</label>
          ) : (
            <input class="field" type={p.type === 'number' ? 'number' : 'text'} step="any" placeholder={p.placeholder ?? (p.default != null ? String(p.default) : '')} value={String(params[p.key] ?? '')} onInput={(e) => set(p.key, (e.target as HTMLInputElement).value)} />
          )}
          {p.help && p.type !== 'boolean' && <div class="hint">{p.help}</div>}
        </div>
      ))}
    </div>
  );
}

function HelperTestBox({ t }: { t: HelperTest }) {
  if (!t.ok) return <div class="result err">{t.error_class}: {t.message}</div>;
  let detail: unknown = t.raw;
  try {
    detail = JSON.parse(t.raw);
  } catch {
    /* plain text */
  }
  const matched = (detail as { matched?: Array<{ title: string; p: number }> })?.matched;
  return (
    <div class="result">
      <div class="r"><span>Value</span><b class="num ok">{formatValue(t.value)}</b></div>
      {matched ? (
        <table class="mini"><tbody>{matched.map((m) => <tr><td>{m.title}</td><td class="num">{Math.round(m.p * 100)}%</td></tr>)}</tbody></table>
      ) : (
        <div class="muted" style="font-size:12px">{t.raw} · {t.duration_ms} ms</div>
      )}
    </div>
  );
}

function NewFromHelper({ onClose, onCreated }: { onClose: () => void; onCreated: (g: GutnumberRow) => void }) {
  const helpers = useAsync(() => api.helpers(), []);
  const [name, setName] = useState('');
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [label, setLabel] = useState('');
  const [unit, setUnit] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [t, setT] = useState<HelperTest | null>(null);
  const [busy, setBusy] = useState(false);
  const helper = helpers.data?.find((h) => h.name === name);
  useEffect(() => {
    if (!name && helpers.data?.length) setName(helpers.data[0].name);
  }, [helpers.data]);
  useEffect(() => {
    setParams({});
    setT(null);
  }, [name]);

  const test = async () => {
    setBusy(true);
    try {
      const r = await api.testHelper(name, params);
      setT(r);
      if (r.ok && r.suggest) {
        if (!label && r.suggest.label) setLabel(r.suggest.label);
        if (!unit && r.suggest.unit) setUnit(r.suggest.unit);
        if (r.suggest.frequency) setFrequency(r.suggest.frequency);
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    setBusy(true);
    try {
      const g = await api.createNumber({ label: label || helper?.title, fetcher: 'helper', helper_name: name, helper_params: params, frequency, unit: unit || null });
      toast(`Tracking “${g.label}”; first poll within a minute`);
      onCreated({ ...g, sparkline: [] });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New number from a helper" onClose={onClose} footer={<div class="right"><button class="btn" onClick={test} disabled={busy || !name}>Test</button><button class="btn primary" onClick={create} disabled={busy || !name}>Create</button></div>}>
      <label class="lbl">Helper</label>
      <select class="field" value={name} onChange={(e) => setName((e.target as HTMLSelectElement).value)}>{helpers.data?.map((h) => <option value={h.name}>{h.title}</option>)}</select>
      {helper && <p class="hint">{helper.description}</p>}
      {helper && <HelperForm helper={helper} params={params} onChange={setParams} />}
      {t && <HelperTestBox t={t} />}
      <div class="row3">
        <div><label class="lbl">Label</label><input class="field" value={label} placeholder="Filled in by Test" onInput={(e) => setLabel((e.target as HTMLInputElement).value)} /></div>
        <div><label class="lbl">Unit</label><input class="field" value={unit} onInput={(e) => setUnit((e.target as HTMLInputElement).value)} /></div>
        <div><label class="lbl">Frequency</label><select class="field" value={frequency} onChange={(e) => setFrequency((e.target as HTMLSelectElement).value)}>{FREQUENCIES.map((x) => <option value={x}>{FREQ_LABEL[x]}</option>)}</select></div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function NumberDrawer({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (g: GutnumberRow) => void }) {
  const g = useAsync(() => api.number(id), [id]);
  const log = useAsync(() => api.numberLog(id, 40), [id]);
  const samples = useAsync(() => api.numberSamples(id, 30), [id]);
  const [view, setView] = useState<'samples' | 'log'>('samples');
  const del = async (ts: number) => {
    if (!(await confirmDialog('Delete this sample? Use this for a bad reading.'))) return;
    await api.deleteSample(id, ts).catch(toastError);
    samples.reload();
    g.reload();
  };
  const n = g.data;
  return (
    <Drawer title={n?.label ?? '…'} sub={n ? `${n.slug} · ${n.url ?? `helper ${n.helper_name}`}` : ''} onClose={onClose}>
      {n && (
        <>
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
            <div class="num" style="font-size:40px;letter-spacing:-.04em">{formatValue(n.last_value, n.unit, n.decimals)}</div>
            <span class={`status ${n.status}`}>{STATUS_LABEL[n.status]}</span>
          </div>
          <Sparkline points={n.sparkline} color={n.color} width={500} height={70} />
          <dl class="kv" style="margin-top:12px">
            <dt>Polled</dt><dd>{n.last_polled_at ? new Date(n.last_polled_at * 1000).toLocaleString() : 'never'}</dd>
            <dt>Next</dt><dd>{n.next_due_at ? new Date(n.next_due_at * 1000).toLocaleString() : '—'}</dd>
            <dt>Read via</dt><dd>{n.last_strategy ?? '—'}</dd>
            {n.last_error && <><dt>Last error</dt><dd class="err">{n.last_error}</dd></>}
            {n.notes && <><dt>Notes</dt><dd style="font-family:var(--sans)">{n.notes}</dd></>}
          </dl>
          <div class="toolbar" style="margin:14px 0 4px"><button class="btn small" onClick={() => onEdit(n)}>Edit</button>{n.url && <a class="btn small" href={n.url} target="_blank" rel="noreferrer">Open page ↗</a>}</div>
          <div class="tabset"><button aria-selected={view === 'samples'} onClick={() => setView('samples')}>Samples (30 days)</button><button aria-selected={view === 'log'} onClick={() => setView('log')}>Poll log</button></div>
          {view === 'samples' ? (
            <table class="mini">
              <thead><tr><th>When</th><th>Value</th><th>Via</th><th /></tr></thead>
              <tbody>
                {(samples.data?.samples ?? []).slice().reverse().slice(0, 200).map((s) => (
                  <tr key={s.ts}><td>{new Date(s.ts * 1000).toLocaleString()}</td><td class="num" title={s.raw ?? ''}>{formatValue(s.value, n.unit, n.decimals)}</td><td class="muted">{s.strategy}</td><td><button class="icon-btn" aria-label="Delete sample" onClick={() => del(s.ts)}>✕</button></td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <LogTable rows={log.data ?? []} />
          )}
        </>
      )}
    </Drawer>
  );
}

export function LogTable({ rows, withLabel }: { rows: LogRow[]; withLabel?: boolean }) {
  if (!rows.length) return <p class="muted">Nothing logged yet.</p>;
  return (
    <table class="mini">
      <thead><tr><th>When</th>{withLabel && <th>Number</th>}<th>Result</th><th>Via</th><th>ms</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td style="white-space:nowrap">{new Date(r.ts * 1000).toLocaleString()}</td>
            {withLabel && <td><a href={`#numbers/${r.gutnumber_id}`}>{r.label}</a></td>}
            <td>{r.ok ? <span class={r.error_class ? 'warn' : 'ok'}>{r.error_class ? `ok, ${r.error_class}` : 'ok'}</span> : <span class="err">{r.error_class}</span>} <span class="muted" style="font-size:12px">{r.message?.slice(0, 120)}</span></td>
            <td class="muted">{[r.fetcher, r.strategy, r.proxy_used ? 'proxy' : ''].filter(Boolean).join(' · ')}{r.http_status ? ` · ${r.http_status}` : ''}</td>
            <td class="num">{r.duration_ms ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

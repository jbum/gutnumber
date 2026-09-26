import { useState } from 'preact/hooks';
import { api } from '../api';
import { useAsync } from '../components/ui';
import { LogTable } from './Numbers';

export function LogTab() {
  const [problems, setProblems] = useState(true);
  const log = useAsync(() => api.log(problems, 300), [problems]);
  return (
    <section>
      <div class="section-head">
        <div>
          <h1>Poll log</h1>
          <p>Every poll attempt for the last 30 days. Suspect values (a jump over 1000×) are recorded but flagged here.</p>
        </div>
        <div class="toolbar">
          <label class="check" style="margin:0"><input type="checkbox" checked={problems} onChange={(e) => setProblems((e.target as HTMLInputElement).checked)} /> Problems only</label>
          <button class="btn" onClick={log.reload}>Refresh</button>
        </div>
      </div>
      <div class="card" style="padding:6px 12px">{log.data ? <LogTable rows={log.data} withLabel /> : <p class="muted">Loading…</p>}</div>
    </section>
  );
}

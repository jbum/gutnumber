import { useEffect, useRef } from 'preact/hooks';
import { Chart, type Plugin, LineController, BarController, LineElement, BarElement, PointElement, LinearScale, LogarithmicScale, TimeScale, Tooltip, Legend, Filler, type ChartDataset } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { annotationTime, formatAxis, formatCompact, formatValue, type VizAnnotation, type VizConfig, type VizData } from '@gut/shared';

Chart.register(LineController, BarController, LineElement, BarElement, PointElement, LinearScale, LogarithmicScale, TimeScale, Tooltip, Legend, Filler);

const cssVar = (name: string, el: Element = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim();

/** Dashed vertical line with a small label for each annotation inside the visible time range. */
function annotationPlugin(notes: VizAnnotation[], o: { color: string; bg: string; font: string; size: number }): Plugin {
  return {
    id: 'gutAnnotations',
    afterDatasetsDraw(chart) {
      const x = chart.scales.x;
      const { top, bottom, left, right } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = `${o.size}px ${o.font}`;
      ctx.fillStyle = o.color;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      for (const n of notes) {
        const t = annotationTime(n.at);
        if (t == null) continue;
        const px = Math.round(x.getPixelForValue(t * 1000)) + 0.5;
        if (px < left || px > right) continue;
        ctx.beginPath();
        ctx.moveTo(px, top);
        ctx.lineTo(px, bottom);
        ctx.stroke();
        // Label beside the line, flipped to the left when it would run off the right edge.
        const w = ctx.measureText(n.label).width;
        const flip = px + 4 + w > right;
        const tx = flip ? px - 4 : px + 4;
        ctx.fillStyle = o.bg; // keep the label legible over the lines
        ctx.fillRect(flip ? tx - w - 2 : tx - 2, top + 1, w + 4, o.size + 4);
        ctx.fillStyle = o.color;
        ctx.textAlign = flip ? 'right' : 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(n.label, tx, top + 3);
      }
      ctx.restore();
    },
  };
}

export interface ChartProps {
  config: VizConfig;
  data: VizData | null;
  theme?: 'light' | 'dark' | 'eink';
  compact?: boolean;
}

/** Stat tile: the latest value, big, with the change over the range. */
function Stat({ data, config }: { data: VizData; config: VizConfig }) {
  return (
    <div class="stat-tiles">
      {data.series.map((s) => {
        const first = s.points[0]?.[1];
        const last = s.latest?.value;
        const delta = first != null && last != null ? last - first : null;
        const better = delta == null || delta === 0 ? '' : (delta > 0) !== s.invert ? 'up' : 'down';
        return (
          <div class="stat" key={s.gutnumber_id}>
            <div class="stat-label"><i style={{ background: s.color }} />{s.label}</div>
            <div class="stat-value num">
              {s.unit && ['#', '$', '€', '£'].includes(s.unit) ? s.unit : ''}
              {formatValue(last, null, s.decimals)}
              {s.unit && !['#', '$', '€', '£'].includes(s.unit) && <small>{s.unit}</small>}
            </div>
            {config.options.show_latest !== false && delta != null && (
              <div class={`stat-delta num ${better}`}>
                {delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} {formatCompact(Math.abs(delta))} <span class="muted">over range</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function VizChart({ config, data, theme, compact }: ChartProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);

  useEffect(() => {
    if (config.type === 'stat' || !canvas.current || !data) return;
    const el = canvas.current;
    const ink = cssVar('--ink', el) || '#1b1a17';
    const muted = cssVar('--muted', el) || '#7d766a';
    const rule = cssVar('--rule', el) || '#d8d0c0';
    const eink = theme === 'eink' || document.documentElement.dataset.theme === 'eink';
    const mono = cssVar('--mono', el) || 'monospace';
    const dash = [[], [6, 4], [2, 3], [10, 3, 2, 3]];

    const datasets: ChartDataset<'line' | 'bar', Array<{ x: number; y: number }>>[] = data.series.map((s, i) => {
      const color = eink ? '#000' : s.color;
      const common = {
        label: s.label,
        data: s.points.map(([t, v]) => ({ x: t * 1000, y: v })),
        yAxisID: s.axis === 'right' ? 'y2' : 'y',
        borderColor: color,
        backgroundColor: config.type === 'bar' ? (eink ? '#000' : color + 'cc') : color + '22',
      };
      if (config.type === 'bar') return { ...common, type: 'bar' as const, borderWidth: 0, barPercentage: 0.9, categoryPercentage: 0.9 };
      return {
        ...common,
        type: 'line' as const,
        borderWidth: eink ? 3 : compact ? 1.6 : 2.2,
        pointRadius: s.points.length < 40 && !compact ? 2.5 : 0,
        pointHoverRadius: 4,
        tension: config.type === 'step' ? 0 : 0.25,
        stepped: config.type === 'step' ? ('before' as const) : false,
        fill: config.type === 'area' ? 'origin' : false,
        borderDash: eink ? dash[i % dash.length] : [],
      };
    });

    const inverted = (axis: 'left' | 'right') => data.series.some((s) => (s.axis ?? 'left') === axis && s.invert);
    const unitFor = (axis: 'left' | 'right') => data.series.find((s) => (s.axis ?? 'left') === axis);
    const hasRight = data.series.some((s) => s.axis === 'right');
    const nearZero = (axis: 'left' | 'right') => {
      const vals = data.series.filter((s) => (s.axis ?? 'left') === axis).flatMap((s) => s.points.map((p) => p[1]));
      if (!vals.length || config.options.log_scale) return false;
      const lo = Math.min(...vals), hi = Math.max(...vals);
      return lo >= 0 && lo <= 0.15 * (hi - lo);
    };
    const yScale = (axis: 'left' | 'right') => ({
      type: config.options.log_scale ? ('logarithmic' as const) : ('linear' as const),
      position: axis,
      reverse: inverted(axis),
      beginAtZero: config.options.y_from_zero,
      // Counts that start at or near zero: keep nice ticks but never below zero.
      min: nearZero(axis) ? 0 : undefined,
      grid: { color: eink ? '#b5b5b5' : rule, drawTicks: false, display: axis === 'left', lineWidth: 1 },
      border: { display: false },
      ticks: { color: muted, font: { family: mono, size: compact ? 9 : 11 }, padding: 6, maxTicksLimit: compact ? 4 : 6, callback: (v: number | string, _i: number, ticks: Array<{ value: number }>) => (unitFor(axis)?.unit === '#' ? '#' : '') + formatAxis(Number(v), ticks.length > 1 ? Math.abs(ticks[1].value - ticks[0].value) : 0) },
    });

    chart.current?.destroy();
    chart.current = new Chart(el, {
      type: config.type === 'bar' ? 'bar' : 'line',
      plugins: config.annotations?.length ? [annotationPlugin(config.annotations, { color: eink ? '#000' : muted, bg: eink ? '#fff' : cssVar('--paper', el) || '#fff', font: mono, size: compact ? 9 : 11 })] : [],
      data: { datasets: datasets as never },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: eink || compact ? false : { duration: 450 },
        interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        parsing: false as never,
        normalized: true,
        scales: {
          x: { type: 'time', min: data.range.from * 1000, max: data.range.to * 1000, offset: config.type === 'bar', grid: { display: false }, border: { color: rule }, ticks: { color: muted, font: { family: mono, size: compact ? 9 : 11 }, maxRotation: 0, autoSkipPadding: 18 } },
          y: yScale('left'),
          ...(hasRight ? { y2: yScale('right') } : {}),
        },
        plugins: {
          legend: { display: config.options.legend && data.series.length > 1 && !compact, position: 'bottom', labels: { color: ink, usePointStyle: true, pointStyle: 'line', boxWidth: 24, font: { size: 12 } } },
          tooltip: {
            backgroundColor: ink,
            titleColor: cssVar('--paper', el),
            bodyColor: cssVar('--paper', el),
            bodyFont: { family: mono, size: 12 },
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatValue(ctx.parsed.y, data.series[ctx.datasetIndex]?.unit, data.series[ctx.datasetIndex]?.decimals)}` },
          },
        },
      },
    });
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
  }, [config, data, theme, compact]);

  if (!data) return <div class="chart-wrap loading" />;
  if (!data.series.length) return <div class="chart-wrap empty-chart muted">No numbers selected</div>;
  if (config.type === 'stat') return <Stat data={data} config={config} />;
  const noData = data.series.every((s) => s.points.length === 0);
  return (
    <div class="chart-wrap">
      {!compact && config.options.show_latest && (
        <div class="latest">
          {data.series.map((s) => (
            <span key={s.gutnumber_id}><i style={{ background: s.color }} /><b class="num">{formatValue(s.latest?.value, s.unit, s.decimals)}</b></span>
          ))}
        </div>
      )}
      <div class="canvas-box">{noData ? <div class="empty-chart muted">No samples in this range yet</div> : <canvas ref={canvas} role="img" aria-label={data.series.map((s) => s.label).join(', ')} />}</div>
    </div>
  );
}

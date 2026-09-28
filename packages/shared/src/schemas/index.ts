import { z } from 'zod';
import { BundleSchema } from '../selectors/types.js';
import { FREQUENCIES } from '../schedule.js';

export const FrequencySchema = z.enum(FREQUENCIES);
export const FetcherSchema = z.enum(['http', 'browser', 'helper']);
export const ProxySchema = z.enum(['none', 'residential']);
export const StatusSchema = z.enum(['new', 'ok', 'drifted', 'failing', 'disabled']);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export const GutnumberCreateSchema = z
  .object({
    label: z.string().min(1).max(200),
    slug: Slug.optional(),
    url: z.string().url().max(2000).optional().nullable(),
    fetcher: FetcherSchema,
    bundle: BundleSchema.optional().nullable(),
    helper_name: z.string().max(64).optional().nullable(),
    helper_params: z.record(z.string(), z.unknown()).optional().nullable(),
    proxy: ProxySchema.default('none'),
    frequency: FrequencySchema.default('daily'),
    enabled: z.boolean().default(true),
    color: Color.optional(),
    unit: z.string().max(16).optional().nullable(),
    decimals: z.number().int().min(0).max(6).default(0),
    notes: z.string().max(4000).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.fetcher === 'helper') {
      if (!v.helper_name) ctx.addIssue({ code: 'custom', path: ['helper_name'], message: 'helper_name is required for helper numbers' });
    } else {
      if (!v.url) ctx.addIssue({ code: 'custom', path: ['url'], message: 'url is required' });
      if (!v.bundle) ctx.addIssue({ code: 'custom', path: ['bundle'], message: 'bundle is required' });
    }
  });

export const GutnumberPatchSchema = z
  .object({
    label: z.string().min(1).max(200),
    slug: Slug,
    url: z.string().url().max(2000).nullable(),
    fetcher: FetcherSchema,
    bundle: BundleSchema.nullable(),
    helper_name: z.string().max(64).nullable(),
    helper_params: z.record(z.string(), z.unknown()).nullable(),
    proxy: ProxySchema,
    frequency: FrequencySchema,
    enabled: z.boolean(),
    color: Color,
    unit: z.string().max(16).nullable(),
    decimals: z.number().int().min(0).max(6),
    notes: z.string().max(4000).nullable(),
  })
  .partial();

export type GutnumberCreate = z.input<typeof GutnumberCreateSchema>;
export type GutnumberPatch = z.infer<typeof GutnumberPatchSchema>;

// ---- visualizations -------------------------------------------------------

export const RangePresetSchema = z.enum(['24h', '7d', '30d', '90d', '1y', 'all']);
export const RangeSchema = z.union([
  z.object({ preset: RangePresetSchema }),
  z.object({ from: z.string(), to: z.string().optional() }),
]);

export const TransformSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('raw') }),
  z.object({ kind: z.literal('delta') }),
  z.object({ kind: z.literal('running_avg'), window: z.number().int().min(2).max(1000) }),
  z.object({
    kind: z.literal('bucket'),
    unit: z.enum(['hour', 'day', 'week']),
    agg: z.enum(['avg', 'min', 'max', 'last', 'sum']),
  }),
]);

export const SeriesSchema = z.object({
  gutnumber_id: z.number().int(),
  label: z.string().max(200).optional(),
  color: Color.optional(),
  transform: TransformSchema.default({ kind: 'raw' }),
  axis: z.enum(['left', 'right']).optional(),
  invert: z.boolean().optional(),
});

/** `YYYY-MM-DD` (local midnight) or `YYYY-MM-DDTHH:MM` (local time) → epoch seconds; null if unparseable. */
export function annotationTime(at: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(at.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}

/** A dated note drawn as a vertical line across the chart (a method change, a launch, an outage). */
export const AnnotationSchema = z.object({
  at: z.string().refine((s) => annotationTime(s) != null, 'at must be YYYY-MM-DD or YYYY-MM-DDTHH:MM'),
  label: z.string().min(1).max(120),
});

export const VizOptionsSchema = z.object({
  subtitle: z.string().max(200).optional(),
  legend: z.boolean().default(true),
  y_from_zero: z.boolean().default(false),
  log_scale: z.boolean().default(false),
  show_latest: z.boolean().default(true),
  points: z.number().int().min(10).max(5000).default(600),
});

export const VizConfigSchema = z.object({
  v: z.literal(1).default(1),
  type: z.enum(['line', 'bar', 'area', 'step', 'stat']).default('line'),
  range: RangeSchema.default({ preset: '7d' }),
  series: z.array(SeriesSchema).max(20).default([]),
  annotations: z.array(AnnotationSchema).max(50).default([]),
  options: VizOptionsSchema.default({ legend: true, y_from_zero: false, log_scale: false, show_latest: true, points: 600 }),
});

export const VisualizationInputSchema = z.object({
  title: z.string().min(1).max(200),
  config: VizConfigSchema,
  carousel_seconds: z.number().int().min(3).max(3600).default(20),
});

// ---- dashboards ------------------------------------------------------------

const Box = { id: z.string().min(1).max(40), x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1).max(12), h: z.number().int().min(1).max(40) };

export const DashboardItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...Box, kind: z.literal('viz'), viz_id: z.number().int() }),
  z.object({ ...Box, kind: z.literal('carousel'), playlist_id: z.number().int(), seconds: z.number().int().min(3).max(3600).optional() }),
  z.object({ ...Box, kind: z.literal('clock'), format: z.enum(['12h', '24h']).default('12h'), show_date: z.boolean().default(true) }),
  z.object({ ...Box, kind: z.literal('text'), markdown: z.string().max(4000) }),
  z.object({ ...Box, kind: z.literal('image'), url: z.string().url().max(2000), fit: z.enum(['contain', 'cover']).default('contain') }),
]);

export const DashboardLayoutSchema = z.object({
  v: z.literal(1).default(1),
  columns: z.literal(12).default(12),
  items: z.array(DashboardItemSchema).max(100).default([]),
});

export const DashboardOptionsSchema = z.object({
  theme: z.enum(['light', 'dark', 'eink']).default('light'),
  show_title: z.boolean().default(true),
  refresh_seconds: z.number().int().min(10).max(86400).default(300),
});

export const DashboardInputSchema = z.object({
  title: z.string().min(1).max(200),
  layout: DashboardLayoutSchema.default({ v: 1, columns: 12, items: [] }),
  options: DashboardOptionsSchema.default({ theme: 'light', show_title: true, refresh_seconds: 300 }),
});

// ---- playlists -------------------------------------------------------------

export const PlaylistItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('viz'), viz_id: z.number().int(), seconds: z.number().int().min(3).max(3600).optional() }),
  z.object({ kind: z.literal('dashboard'), dashboard_id: z.number().int(), seconds: z.number().int().min(3).max(3600).default(30) }),
]);

export const PlaylistInputSchema = z.object({
  title: z.string().min(1).max(200),
  items: z.array(PlaylistItemSchema).max(200).default([]),
});

export type VizConfig = z.infer<typeof VizConfigSchema>;
export type VizSeries = z.infer<typeof SeriesSchema>;
export type VizAnnotation = z.infer<typeof AnnotationSchema>;
export type Transform = z.infer<typeof TransformSchema>;
export type DashboardItem = z.infer<typeof DashboardItemSchema>;
export type DashboardLayout = z.infer<typeof DashboardLayoutSchema>;
export type DashboardOptions = z.infer<typeof DashboardOptionsSchema>;
export type PlaylistItem = z.infer<typeof PlaylistItemSchema>;
export type VisualizationInput = z.input<typeof VisualizationInputSchema>;
export type DashboardInput = z.input<typeof DashboardInputSchema>;
export type PlaylistInput = z.input<typeof PlaylistInputSchema>;

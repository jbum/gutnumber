import { z } from 'zod';

export const CssSelectorSchema = z.object({ type: z.literal('CssSelector'), value: z.string().min(1) });
export const XPathSelectorSchema = z.object({ type: z.literal('XPathSelector'), value: z.string().min(1) });
export const TextQuoteSelectorSchema = z.object({
  type: z.literal('TextQuoteSelector'),
  exact: z.string(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
});
/** Gutnumber extension: a regex over the raw response body (inline JSON etc). */
export const RegexSourceSchema = z.object({
  type: z.literal('RegexSource'),
  pattern: z.string().min(1),
  group: z.number().int().min(0).default(1),
  flags: z.string().regex(/^[imsu]*$/).optional(),
});

export const SelectorSchema = z.discriminatedUnion('type', [
  CssSelectorSchema,
  XPathSelectorSchema,
  TextQuoteSelectorSchema,
  RegexSourceSchema,
]);

export const ParserOptionsSchema = z.object({
  pick: z.string().regex(/^(first|last|largest|nth:\d+)$/).default('first'),
  thousands: z.string().max(1).default(','),
  decimal: z.string().max(1).default('.'),
  suffixes: z.boolean().default(true),
});

export const BundleSchema = z.object({
  version: z.literal(1).default(1),
  selectors: z.array(SelectorSchema).min(1),
  parser: ParserOptionsSchema.default({ pick: 'first', thousands: ',', decimal: '.', suffixes: true }),
  context_html: z.string().max(20000).optional(),
  captured_text: z.string().max(2000).optional(),
  captured_value: z.number().optional(),
  captured_at: z.string().optional(),
});

export type Selector = z.infer<typeof SelectorSchema>;
export type SelectorType = Selector['type'];
export type Bundle = z.infer<typeof BundleSchema>;
export type BundleInput = z.input<typeof BundleSchema>;

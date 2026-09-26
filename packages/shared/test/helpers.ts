import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

export const FIXTURES = fileURLToPath(new URL('../../../test-fixtures/', import.meta.url));
export const fixtureHtml = (name: string) => readFileSync(FIXTURES + name, 'utf8');
export const fixtureMeta = JSON.parse(readFileSync(FIXTURES + 'fixtures.json', 'utf8')) as Record<string, { value: number; url: string }>;
export const dom = (html: string) => parseHTML(html).document as any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Remove ids, classes and test hooks everywhere: simulates a site redesign that keeps the words. */
export function mangle(html: string): string {
  return html.replace(/\s(id|class|data-gut-target|data-testid)(="[^"]*")?/g, '');
}

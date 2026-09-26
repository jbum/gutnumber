import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Browser, Page } from 'puppeteer';
import { loadConfig, openDb, listGutnumbers, type DB } from '@gut/db';
import { credentialLookup } from '@gut/fetch';
import { buildServer } from '@gut/server';
import { startFixtureSite, type FixtureSite } from '../scripts/fixture-site';

let site: FixtureSite;
let app: FastifyInstance;
let db: DB;
let browser: Browser;
let page: Page;
let api: string;

beforeAll(async () => {
  site = await startFixtureSite();
  const dir = mkdtempSync(join(tmpdir(), 'gut-pick-'));
  const config = loadConfig({ dataDir: dir, dbPath: join(dir, 'gutnumber.sqlite'), privateDir: null, tz: 'UTC' });
  db = openDb(config.dbPath);
  app = await buildServer({ config, db, credentialsFor: credentialLookup({}), clientDir: null, extensionDir: resolve('dist/extension') });
  api = await app.listen({ port: 0, host: '127.0.0.1' });
  const { default: puppeteer } = await import('puppeteer');
  browser = await puppeteer.launch({ headless: true });
  page = await browser.newPage();
});
afterAll(async () => {
  await browser?.close();
  await app?.close();
  await site?.close();
});

const shadow = <T>(fn: string) => page.evaluate(`(() => { const r = document.querySelector('gutnumber-picker')?.shadowRoot; return (${fn})(r); })()`) as Promise<T>;

describe('picker (bookmarklet build) in a real browser', () => {
  it('hover → badge, click → dialog with server preview, Create → number saved', async () => {
    await page.goto(`${site.url}/page/blog-stats.html`);
    await page.addScriptTag({ url: `${api}/bookmarklet/picker.js` });
    await page.waitForSelector('gutnumber-picker');
    const box = (await (await page.$('td.num'))!.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    expect(await shadow<string>('(r) => r.querySelector(".badge").textContent')).toBe('4,812');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => document.querySelector('gutnumber-picker')?.shadowRoot?.querySelector('.dlg'));
    expect(await shadow<string>('(r) => r.querySelector("[data-f=value]").textContent')).toBe('4,812');
    await page.waitForFunction(() => /✓/.test(document.querySelector('gutnumber-picker')?.shadowRoot?.querySelector('[data-f=preview]')?.textContent ?? ''), { timeout: 20000 });
    expect(await shadow<string>('(r) => r.querySelector("[data-f=fetcher]").value')).toBe('http');
    await shadow('(r) => { const i = r.querySelector("[data-f=label]"); i.value = "Blog visitors (picked)"; }');
    await shadow('(r) => r.querySelector("[data-x=create]").click()');
    await page.waitForFunction(() => /Tracking/.test(document.querySelector('gutnumber-picker')?.shadowRoot?.querySelector('.dlg h2')?.textContent ?? ''), { timeout: 10000 });
    const [g] = listGutnumbers(db);
    expect(g).toMatchObject({ label: 'Blog visitors (picked)', fetcher: 'http', frequency: 'daily' });
    expect(g.bundle!.selectors[0].type).toBe('CssSelector');
    expect(g.bundle!.captured_value).toBe(4812);
  });

  it('Esc removes the picker and restores page clicks', async () => {
    await page.goto(`${site.url}/page/amazon-bullets.html`);
    await page.addScriptTag({ url: `${api}/bookmarklet/picker.js` });
    await page.waitForSelector('gutnumber-picker');
    await page.keyboard.press('Escape');
    expect(await page.$('gutnumber-picker')).toBeNull();
  });
});

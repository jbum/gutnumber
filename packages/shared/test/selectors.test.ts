import { describe, expect, it } from 'vitest';
import { captureBundle, resolveBundle, textQuoteCandidates, evaluateXPath, generateCss, collectText, BundleSchema } from '@gut/shared';
import { dom, fixtureHtml, fixtureMeta, mangle } from './helpers.js';

const DOM_FIXTURES = ['amazon-bullets.html', 'amazon-table.html', 'blog-stats.html', 'hashed-classes.html'];

describe('capture → resolve round trip', () => {
  it.each(DOM_FIXTURES)('%s resolves via its first selector', (name) => {
    const html = fixtureHtml(name);
    const doc = dom(html);
    const el = doc.querySelector('[data-gut-target]');
    expect(el).toBeTruthy();
    const cap = captureBundle(el, doc, { html });
    expect(cap.value).toBe(fixtureMeta[name].value);
    expect(BundleSchema.safeParse(cap.bundle).success).toBe(true);

    // Resolve against a fresh parse, as the daemon would (without the test hook).
    const clean = html.replace(/\sdata-gut-target/g, '');
    const r = resolveBundle(cap.bundle, { doc: dom(clean), html: clean });
    expect(r.ok && r.value).toBe(fixtureMeta[name].value);
    expect(r.ok && r.index).toBe(0);
  });

  it.each(DOM_FIXTURES)('%s survives a redesign (ids/classes stripped, number changed)', (name) => {
    const html = fixtureHtml(name);
    const doc = dom(html);
    const cap = captureBundle(doc.querySelector('[data-gut-target]'), doc, { html });
    const old = fixtureMeta[name].value;
    const oldText = cap.bundle.captured_text!.match(/[\d.,]+K?/)![0];
    const newText = oldText.includes('K') ? '31.9K' : oldText.includes(',') ? '9,876' : '777';
    const changed = mangle(html).replace(oldText, newText);
    const r = resolveBundle(cap.bundle, { doc: dom(changed), html: changed });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).not.toBe(old);
      expect(r.value).toBe(newText === '31.9K' ? 31900 : newText === '9,876' ? 9876 : 777);
    }
  });

  it('never puts CSS-in-JS classes in selectors', () => {
    const html = fixtureHtml('hashed-classes.html');
    const doc = dom(html);
    const css = generateCss(doc.querySelector('[data-gut-target]'), doc)!;
    expect(css).not.toMatch(/css-|sc-|r-1b43r93|kXzLtr/);
  });

  it('YouTube: number only in inline JSON → RegexSource', () => {
    const html = fixtureHtml('youtube-watch.html');
    const r = resolveBundle({ selectors: [{ type: 'RegexSource', pattern: '"viewCount":"(\\d+)"', group: 1 }] }, { doc: dom(html), html });
    expect(r).toMatchObject({ ok: true, value: 233368, strategy: 'RegexSource' });
  });

  it('YouTube: capture from a rendered element proposes a RegexSource', () => {
    // Simulate the rendered page: the picker sees "233,368 views" in the DOM.
    const html = fixtureHtml('youtube-watch.html').replace('<span class="bold style-scope yt-formatted-string" dir="auto"> </span>', '<span class="bold" data-gut-target>233,368 views</span>');
    const doc = dom(html);
    const cap = captureBundle(doc.querySelector('[data-gut-target]'), doc, { html });
    const rs = cap.bundle.selectors.find((s) => s.type === 'RegexSource');
    expect(rs).toBeTruthy();
    // Static page (no rendered number): only the regex resolves.
    const staticHtml = fixtureHtml('youtube-watch.html');
    const r = resolveBundle(cap.bundle, { doc: dom(staticHtml), html: staticHtml });
    expect(r).toMatchObject({ ok: true, value: 233368, strategy: 'RegexSource' });
  });

  it('reports selector_miss vs parse_fail', () => {
    const doc = dom('<html><body><p id="a">hello</p></body></html>');
    expect(resolveBundle({ selectors: [{ type: 'CssSelector', value: '#nope' }] }, { doc })).toMatchObject({ ok: false, error: 'selector_miss' });
    expect(resolveBundle({ selectors: [{ type: 'CssSelector', value: '#a' }] }, { doc })).toMatchObject({ ok: false, error: 'parse_fail' });
  });
});

describe('TextQuote matching', () => {
  it('tolerates numbers changing inside the prefix', () => {
    const text = 'Customer Reviews: 4.7 out of 5 stars 1,299 ratings Best Sellers Rank: #9,001 in Books (See Top 100)';
    const c = textQuoteCandidates(text, { exact: '#12,345 in Books', prefix: '4.6 out of 5 stars 1,234 ratings Best Sellers Rank: ', suffix: ' (See Top 100)' });
    expect(c[0]).toBe('#9,001 in Books');
  });
  it('falls back to a shorter prefix tail', () => {
    const text = 'Totally new header text. Best Sellers Rank: #5 in Books (See Top 100)';
    const c = textQuoteCandidates(text, { exact: '#1 in Books', prefix: 'Some old words that vanished. Best Sellers Rank: ' });
    expect(c[0]).toMatch(/^#5 in Books/);
  });
});

describe('collectText', () => {
  it('skips scripts and separates blocks', () => {
    const doc = dom('<html><body><div>a<b>b</b></div><div>c</div><script>var x=1</script></body></html>');
    expect(collectText(doc.body).text).toBe('ab c');
  });
  it('reports target offsets', () => {
    const doc = dom('<html><body><p>Visitors: <span id="t">4,812</span> this week</p></body></html>');
    const r = collectText(doc.body, doc.getElementById('t'));
    expect(r.text.slice(r.start, r.end)).toBe('4,812');
  });
});

describe('xpath subset', () => {
  const doc = dom('<html><body><div id="x"><ul><li>a</li><li>b</li><li>c</li></ul></div><div><span>s</span></div></body></html>');
  it('id anchored', () => expect(evaluateXPath(doc, "//*[@id='x']/ul/li[3]")?.textContent).toBe('c'));
  it('absolute', () => expect(evaluateXPath(doc, '/html/body/div[2]/span')?.textContent).toBe('s'));
  it('descendant', () => expect(evaluateXPath(doc, '//li[2]')?.textContent).toBe('b'));
  it('miss', () => expect(evaluateXPath(doc, '/html/body/table')).toBeNull());
});

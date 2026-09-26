/**
 * A local site for end-to-end tests (PLAN Phase 2). Serves test-fixtures/ with knobs:
 *   /page/<name>?value=N      replace the fixture's number with N
 *   /page/<name>?drift=1      strip ids/classes (a redesign)
 *   /page/<name>?fail=captcha|500|401
 *   /js-rendered?value=N      number inserted by JavaScript after load (browser fetcher only)
 *   /json/stats               JSON for json_api; needs basic auth test:secret
 *   /hn/api/v1/search         stub Algolia front page
 *   /typesafe/v1/systemone    stub Jev: yes when the item title contains the topic's first word
 * Run standalone: npm run fixture-site (port 3199).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../test-fixtures/', import.meta.url));
const META = JSON.parse(readFileSync(DIR + 'fixtures.json', 'utf8')) as Record<string, { value: number }>;

export const HN_TITLES = [
  'Anthropic releases a new Claude model',
  'Show HN: A tiny AI agent in 200 lines',
  'The history of the slide rule',
  'Major security breach at a password manager',
  'Why SQLite is enough',
  'AI chips are getting cheaper',
];

const CAPTCHA = `<html><head><title>Robot Check</title></head><body><p>Type the characters you see in this image</p><form action="/errors/validateCaptcha"></form><p>api-services-support@amazon.com</p></body></html>`;

export interface FixtureSite {
  url: string;
  app: FastifyInstance;
  hits: Record<string, number>;
  close(): Promise<void>;
}

export async function startFixtureSite(port = 0): Promise<FixtureSite> {
  const app = Fastify({ logger: false });
  const hits: Record<string, number> = {};
  const count = (k: string) => (hits[k] = (hits[k] ?? 0) + 1);

  app.get<{ Params: { name: string }; Querystring: { value?: string; drift?: string; fail?: string } }>('/page/:name', async (req, reply) => {
    const { name } = req.params;
    count(`page:${name}`);
    const meta = META[name];
    if (!meta) return reply.code(404).send('no such fixture');
    if (req.query.fail === 'captcha') return reply.type('text/html').send(CAPTCHA);
    if (req.query.fail === '500') return reply.code(500).send('boom');
    if (req.query.fail === '401') return reply.code(401).header('www-authenticate', 'Basic realm="x"').send('auth');
    let html = readFileSync(DIR + name, 'utf8').replace(/\sdata-gut-target/g, '');
    if (req.query.value) {
      const n = Number(req.query.value);
      const oldPlain = String(meta.value);
      const oldComma = meta.value.toLocaleString('en-US');
      html = html.split(oldComma).join(n.toLocaleString('en-US')).split(`"${oldPlain}"`).join(`"${n}"`);
    }
    if (req.query.drift) html = html.replace(/\s(id|class)="[^"]*"/g, '');
    return reply.type('text/html').send(html);
  });

  app.get<{ Querystring: { value?: string } }>('/js-rendered', async (req, reply) => {
    count('js-rendered');
    const v = Number(req.query.value ?? 4242).toLocaleString('en-US');
    return reply.type('text/html').send(`<!DOCTYPE html><html><head><title>JS stats</title></head><body><h1>Stats</h1><p>Downloads: <span id="dl">loading…</span></p>
<script>setTimeout(function(){ document.getElementById('dl').textContent = '${v}'; }, 150);</script></body></html>`);
  });

  app.get('/json/stats', async (req, reply) => {
    count('json');
    const want = 'Basic ' + Buffer.from('test:secret').toString('base64');
    if (req.headers.authorization !== want) return reply.code(401).header('www-authenticate', 'Basic realm="stats"').send({ error: 'auth' });
    return { series: [{ hits: { human: 10 } }, { hits: { human: 20 } }, { hits: { human: 12 } }] };
  });

  app.get<{ Querystring: { hitsPerPage?: string } }>('/hn/api/v1/search', async (req) => {
    count('hn');
    return { hits: HN_TITLES.map((title, i) => ({ objectID: String(1000 + i), title, url: `https://example.com/${i}`, points: 100 - i })) };
  });

  app.post('/typesafe/v1/systemone', async (req, reply) => {
    count('jev');
    const body = req.body as { state: { topic: string }; questions: Record<string, { instructions?: { story_title?: string } }> };
    if (req.headers.authorization !== 'Bearer test-key' && req.headers['x-api-key'] !== 'test-key') return reply.code(401).send({ error: { message: 'bad key' } });
    const word = body.state.topic.split(/[\s(]/)[0].toLowerCase();
    const answers: Record<string, { type: 'noul'; noul: number }> = {};
    for (const [k, q] of Object.entries(body.questions)) {
      const title = q.instructions?.story_title?.toLowerCase() ?? '';
      answers[k] = { type: 'noul', noul: title.includes(word) ? 0.92 : 0.08 };
    }
    return { model: 'jev-stub', answers, usage: { input_tokens: 1, output_tokens: 1 } };
  });

  const addr = await app.listen({ port, host: '127.0.0.1' });
  return { url: addr, app, hits, close: () => app.close() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startFixtureSite(3199);
  console.log(`fixture site on ${s.url}`);
}

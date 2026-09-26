import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { NotFound, Conflict, type Config, type DB } from '@gut/db';
import { BrowserPool, FetchError, loadCredentials, type CredentialLookup } from '@gut/fetch';
import { gutnumberRoutes } from './routes/gutnumbers.js';
import { vizRoutes } from './routes/visualizations.js';
import { boardRoutes } from './routes/boards.js';
import { viewRoutes } from './routes/view.js';
import { miscRoutes } from './routes/misc.js';

export interface ServerDeps {
  config: Config;
  db: DB;
  credentialsFor?: CredentialLookup;
  browser?: BrowserPool;
  /** Directory of the built client (index.html + assets). */
  clientDir?: string | null;
  /** Directory holding the built bookmarklet picker. */
  extensionDir?: string | null;
  logger?: boolean;
}

export interface AppContext {
  config: Config;
  db: DB;
  credentialsFor: CredentialLookup;
  browser: BrowserPool;
}

declare module 'fastify' {
  interface FastifyInstance {
    gut: AppContext;
  }
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

function sendError(reply: FastifyReply, status: number, code: string, message: string, details?: unknown) {
  return reply.code(status).send({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ? { level: 'info', serializers: { req: (r) => ({ method: r.method, url: r.url, user: r.headers['x-forwarded-user'] }) } } : false,
    trustProxy: '127.0.0.1',
    bodyLimit: 2 * 1024 * 1024,
  });
  app.decorate('gut', {
    config: deps.config,
    db: deps.db,
    credentialsFor: deps.credentialsFor ?? loadCredentials(deps.config.privateDir),
    browser: deps.browser ?? new BrowserPool(),
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ZodError) return sendError(reply, 422, 'validation', err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), err.issues);
    if (err instanceof NotFound) return sendError(reply, 404, 'not_found', err.message);
    if (err instanceof Conflict) {
      const d = err.details as { code?: string } | undefined;
      return sendError(reply, 409, d?.code ?? 'conflict', err.message, err.details);
    }
    if (err instanceof HttpError) return sendError(reply, err.status, err.code, err.message, err.details);
    if (err instanceof FetchError) return sendError(reply, 502, err.errorClass, err.message);
    const e = err as { statusCode?: number; message?: string; code?: string };
    if (e.statusCode && e.statusCode < 500) return sendError(reply, e.statusCode, e.code ?? 'bad_request', e.message ?? 'bad request');
    app.log.error(err);
    return sendError(reply, 500, 'internal', (err as Error).message ?? 'internal error');
  });

  // CORS for the bookmarklet (runs on arbitrary pages); the extension does not need it.
  const CORS_PATHS = new Set(['/api/v1/gutnumbers', '/api/v1/preview']);
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = req.headers.origin;
    if (origin && CORS_PATHS.has(req.url.split('?')[0])) {
      reply.header('access-control-allow-origin', origin);
      reply.header('access-control-allow-credentials', 'true');
      reply.header('vary', 'origin');
      if (req.method === 'OPTIONS') {
        reply.header('access-control-allow-methods', 'POST, OPTIONS');
        reply.header('access-control-allow-headers', 'content-type, authorization');
        reply.header('access-control-max-age', '600');
        return reply.code(204).send();
      }
    }
  });

  await app.register(
    async (api) => {
      await api.register(gutnumberRoutes);
      await api.register(vizRoutes);
      await api.register(boardRoutes);
      await api.register(viewRoutes);
      await api.register(miscRoutes);
    },
    { prefix: '/api/v1' },
  );

  // Bookmarklet picker (built by the extension build).
  const pickerPath = deps.extensionDir ? join(deps.extensionDir, 'picker.iife.js') : null;
  app.get('/bookmarklet/picker.js', async (_req, reply) => {
    if (!pickerPath || !existsSync(pickerPath)) throw new HttpError(404, 'not_built', 'bookmarklet not built (npm run build)');
    return reply.type('application/javascript; charset=utf-8').header('cache-control', 'no-cache').send(readFileSync(pickerPath, 'utf8'));
  });

  // Client SPA: editors at /, viewers at /view/*.
  const clientDir = deps.clientDir;
  if (clientDir && existsSync(join(clientDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: clientDir, prefix: '/', index: false, wildcard: false });
    const index = () => readFileSync(join(clientDir, 'index.html'), 'utf8');
    const spa = async (_req: FastifyRequest, reply: FastifyReply) => reply.type('text/html').header('cache-control', 'no-cache').send(index());
    app.get('/', spa);
    app.get('/view/*', spa);
    app.get('/bookmarklet', spa);
    app.get('/assets/*', async (req, reply) => reply.sendFile((req.params as { '*': string })['*'], join(clientDir, 'assets')));
  } else {
    app.get('/', async () => ({ gutnumber: 'api only', hint: 'build the client with npm run build, or use npm run dev' }));
  }

  app.setNotFoundHandler((req, reply) => sendError(reply, 404, 'not_found', `no route for ${req.method} ${req.url.split('?')[0]}`));
  return app;
}

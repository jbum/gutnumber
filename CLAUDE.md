# Gutnumber: notes for working in this repo

- **This repo will be public.** Never commit secrets, hostnames, IPs, SSH users,
  API keys or personal ids. Per-install files (`.env`, `deploy/local.*`,
  `packages/extension/config.json`) are gitignored and each has a tracked
  `.example`; update the example when the shape changes. Personal material goes
  in the sibling private repo (`gutnumber_pvt`, see ARCHITECTURE.md §13).
- **Docs are part of the change.** `ARCHITECTURE.md` describes the system as
  built; `DATA_MODEL.md`, `API.md`, `SELECTORS.md`, `DEPLOY.md` are the contracts.
  A change to schema, routes, selector behaviour, env keys or deploy steps updates
  the matching doc in the same commit. `PLAN.md` is the design record: append
  decisions to its log rather than rewriting history; tick phase checklists as
  work lands.
- **Shared code runs in two worlds.** `packages/shared` must import nothing
  Node-only or browser-only. Selector generation/resolution, text normalisation
  and number parsing live there and are exercised by both the extension and the
  daemon; add a fixture in `test-fixtures/` and a test whenever a real page trips
  the resolver.
- **Tests:** `npm test` (vitest, seconds). `npm run typecheck`. `npm run e2e`
  spins the fixture site + a temp SQLite DB and runs a daemon cycle end to end
  (~20 s); run it before touching the scheduler or fetchers. No test may hit the
  real internet or the proxy.
- **Style:** TypeScript strict, ESM, zod schemas as the single source of shape
  truth (types inferred). Small modules, explicit error classes
  (`FetchError{class}`), no silent catches. Server routes are thin: validate,
  call a function in `db/` or `fetch/`, serialise.
- **Deploy:** `deploy/deploy.sh` (runs typecheck + tests first). Both services
  restart; migrations apply on start. Take a `gut backup` before schema changes.
- **Politeness:** fetchers respect per-host gaps and block media in the browser
  fetcher. Never loosen these for a one-off; add a helper instead.
- **Auth is Apache basic auth (D11).** The app has no login code; do not add
  sessions or tokens. The `htpasswd` username and password are never written
  anywhere in this repo, including docs and examples.

# Gutnumber — Deployment

Generic instructions for the public repo, then a reference section for the
author's install. Host-specific notes for a particular install belong in the private repo.

## Requirements

- Linux host with Node ≥ 22, systemd, and a reverse proxy (Apache or nginx)
  terminating TLS. ~1 GB RAM free if the `browser` fetcher is used (headless
  Chromium), else ~150 MB.
- Chromium system libraries for Puppeteer on Ubuntu 24.04, plus `unzip` (Puppeteer
  cannot extract Chrome without it):
  `apt install unzip libnss3 libatk-bridge2.0-0t64 libgtk-3-0t64 libgbm1 libasound2t64 libxss1 libxshmfence1 fonts-liberation libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libcups2t64`
  Then, once: `PUPPETEER_CACHE_DIR=~/gutnumber-data/chromium ./node_modules/.bin/puppeteer browsers install chrome` (~400 MB).
  (Or set `PUPPETEER_EXECUTABLE_PATH` to a distro Chromium and skip the download.)
- Outbound HTTPS. Optional residential proxy account for hostile sites.

## Layout on the host

```
~/gutnumber/            public repo checkout (built in place)
~/gutnumber_pvt/        private repo checkout: .env, credentials.json, deploy/, helpers/, seed/
~/gutnumber-data/       gutnumber.sqlite (+ -wal/-shm), backups/, chromium profile cache
```

`GUTNUMBER_PRIVATE_DIR=~/gutnumber_pvt` and `GUTNUMBER_DATA_DIR=~/gutnumber-data`
are the two env vars every entrypoint reads first; `.env` is loaded from the
private dir (falling back to `~/gutnumber/.env` for single-repo installs).

## `.env` keys (tracked as `.env.example`)

```
GUTNUMBER_DATA_DIR=/home/you/gutnumber-data
GUTNUMBER_PRIVATE_DIR=/home/you/gutnumber_pvt
PORT=3100                        # web process, bound to 127.0.0.1
PUBLIC_URL=https://gut.example.com
TZ=America/Los_Angeles
DAILY_HOUR=6                     # daily/weekly polls fire at this local hour
WEEKLY_DAY=1                     # 0=Sun … 6=Sat
PROXY_URL_TEMPLATE=              # e.g. http://USER:PASS_session-{session}@host:port  ({session} → random 8 chars per request)
PROXY_COUNTRIES=us               # optional rotation list
BROWSER_CONCURRENCY=1
HTTP_CONCURRENCY=4
YOUTUBE_API_KEY=                 # for the youtube_* helpers
TYPESAFE_API_KEY=                # for judgment helpers (hn_topic_count)
CLICKY_SITE_ID= CLICKY_SITEKEY=  # for clicky_stats
PUSHOVER_USER= PUSHOVER_TOKEN=   # optional failure alerts
```

Per-host site logins go in `credentials.json` beside `.env` (ARCHITECTURE §6.5);
a tracked `credentials.example.json` shows the shape.

## Install

The build happens on your own machine; the server only receives `dist/` and runtime
dependencies.

```sh
# on the server, once
mkdir -p ~/gutnumber ~/gutnumber-data ~/gutnumber_pvt
# copy deploy/local.env.example to ~/gutnumber_pvt/.env and fill it in; add credentials.json if needed
sudo htpasswd -cB /etc/apache2/gut.htpasswd <username>     # basic auth for the whole site (D11)

# from your machine, every time
deploy/deploy.sh <ssh-host>     # typecheck + tests, build, rsync dist/, npm ci --omit=dev, restart
```

Systemd (templates in `deploy/`, placeholders `{{USER}}`, `{{HOME}}`; `deploy/deploy.sh` fills them):

- `gutnumber-web.service`: `node packages/server/dist/index.js`, `Restart=always`,
  `After=network-online.target`.
- `gutnumber-daemon.service`: `node packages/daemon/dist/index.js`,
  `Restart=always`, `RestartSec=5`, `MemoryMax=1500M` (Chromium leaks are
  contained by a restart, not a debugging session).

Both: `NoNewPrivileges=true`, `PrivateTmp=true`, `EnvironmentFile=<private>/.env`.

Reverse proxy (Apache): `deploy/apache-gut.conf` is the template (port 80; certbot
copies it into the TLS vhost and adds the redirect). It puts the whole site behind
basic auth with a `<RequireAny>` that lets CORS preflights through, and exempts
`/api/v1/health` and `/.well-known/acme-challenge/`. Do not use `<If>/<Else>` for
the OPTIONS exemption: those merge after `<Location>` blocks and override the
exemptions, which makes certbot's challenge fail with 401 (D19).

`a2enmod proxy proxy_http headers`, `a2ensite`, `apache2ctl configtest` before every
reload, then `certbot --apache -d gut.example.com --redirect`. Create the log dir first (Apache will not
start otherwise).

`deploy/deploy.sh`: typecheck + unit tests locally, `rsync` to the host
(excluding node_modules, data), `npm ci --omit=dev && npm run build` remotely,
`systemctl restart gutnumber-web gutnumber-daemon`, tail the journal for 10 s.

## Operations

- `journalctl -u gutnumber-daemon -f` for the poll stream (JSON lines).
- `gut backup` nightly via cron or a systemd timer → `data/backups/`, keeps 14.
- `gut export > ~/gutnumber_pvt/seed/gutnumbers.json` after editing numbers, and
  commit the private repo: the definitions become versioned config.
- Upgrading: `deploy.sh`; migrations run on start. Back up first (`gut backup`).
- Chromium: `PUPPETEER_CACHE_DIR=$GUTNUMBER_DATA_DIR/chromium` keeps the download
  out of the repo tree so redeploys do not re-fetch it.
- Kiosk / Pi: open `https://gut.example.com/view/dashboard/1` in a browser that
  has the basic-auth credentials saved, or fetch with an `Authorization` header
  from a script; a future PNG render endpoint would take the same header.

## Extension install (Chrome)

`chrome://extensions` → Developer mode → Load unpacked → `packages/extension/dist`.
Options: API URL + the site's basic-auth username and password → Save (Chrome asks to
allow the server's origin) → Test connection. Pin the icon. See `packages/extension/TESTING.md`. Re-load after each extension build.

---

## Reference install

The author's host-specific notes live in the private repo (`gutnumber_pvt/notes/reference-install.md`).

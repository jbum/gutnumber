# gutnumber

Track "interesting numbers" that live on public web pages (Amazon sales rank,
YouTube views, your site's traffic, how many Hacker News front-page stories are
about a topic today) and show them on dashboards and slideshows, eventually on
eInk displays driven by a Raspberry Pi.

Named after the original "Gutnumber" system built at Digisynd, after David Guttman.

## Pieces

- **Chrome extension**: click a number on any page, name it, pick a polling
  frequency. A bookmarklet build of the same picker is included.
- **Daemon**: polls every tracked number on schedule (plain HTTP, headless
  Chromium, or a helper plugin) and records the values.
- **Web app**: editors for numbers, visualizations, dashboards and playlists,
  plus chrome-less viewer pages for kiosks.

## Quick start (development)

```sh
npm install
npm test
npm run dev          # server :3100, daemon, client with hot reload (Vite :5173)
npm run gut -- help  # CLI
```

Data goes to `./data` in development (`GUTNUMBER_DATA_DIR` overrides).

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md): how it fits together
- [PLAN.md](PLAN.md): phases, decision log
- [DATA_MODEL.md](DATA_MODEL.md), [API.md](API.md), [SELECTORS.md](SELECTORS.md)
- [DEPLOY.md](DEPLOY.md): running it on a Linux host behind Apache
- [TEST_TARGETS.md](TEST_TARGETS.md): real pages used for manual testing

## License

MIT

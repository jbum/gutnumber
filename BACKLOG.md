# Gutnumber — Backlog

The working list of things to do next. `PLAN.md` stays the design record and
decision log; this file is what to pick up. Newest ideas at the bottom of each
section; move an item into `PLAN.md`'s decision log when it lands.

## Open from the first build (2026-09-26)

- [ ] Watch a week of unattended polling; review the Log tab; tune per-host gaps.
- [ ] Load the Chrome extension (`dist/extension`, Load unpacked) and point it at the site.
- [ ] Track the author's own books' Amazon sales ranks (helper + proxy tested live; no ASINs entered yet).
- [ ] Configure Clicky (site id + key in the server `.env`) or drop the helper.

## News-headline sources for Jev topic counts

**Goal.** More cheap headline feeds for the `hn_topic_count` pattern (D15, D18): fetch a
list of headlines once per tick, ask one Jev Noul per headline per topic, count the
yeses. Compare coverage of a topic across outlets and over time.

**Proposed shape.** Generalise the helper into `headline_topic_count` with a `source`
param, keeping `hn_topic_count` as an alias:

- `hn:top` / `hn:new` (exists)
- `rss:<url>`: any RSS/Atom feed; titles (and optionally descriptions) from `<item>`/`<entry>`
- `rss_bundle:<name>`: a named set of feeds, deduplicated by normalised title, e.g. "US
  front pages" = NYT + WaPo + CNN + Fox + CBS + ABC + NPR
- `google_news:<query>` and `google_news:top`
- `reddit:<subreddit>` (Atom feed; top/new)

Each source is fetched once per tick and shared by every topic number (the tick cache
already does this). A Jev call per topic per source costs well under a second for 100
headlines. Store the matched headlines and their source in the sample's raw text, as now.

**Feeds checked 2026-09-26** (desktop Chrome UA, no key, no proxy):

| Source | Feed | Items | Status |
|---|---|---|---|
| BBC News top | `https://feeds.bbci.co.uk/news/rss.xml` | 30 | ok |
| BBC Technology | `https://feeds.bbci.co.uk/news/technology/rss.xml` | 21 | ok |
| NYT home page | `https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml` | 17 | ok |
| NYT Technology | `https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml` | 28 | ok |
| Guardian world | `https://www.theguardian.com/world/rss` | 45 | ok |
| Guardian tech | `https://www.theguardian.com/uk/technology/rss` | 32 | ok |
| NPR news | `https://feeds.npr.org/1001/rss.xml` | 10 | ok |
| Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | 25 | ok |
| Washington Post world | `https://feeds.washingtonpost.com/rss/world` | 13 | ok |
| CNN top stories | `http://rss.cnn.com/rss/cnn_topstories.rss` | 69 | ok (some items stale) |
| WSJ world | `https://feeds.a.dj.com/rss/RSSWorldNews.xml` | 20 | ok |
| Fox News latest | `https://moxie.foxnews.com/google-publisher/latest.xml` | 25 | ok |
| CBS News | `https://www.cbsnews.com/latest/rss/main` | 30 | ok |
| ABC News | `https://abcnews.go.com/abcnews/topstories` | 25 | ok |
| Politico | `https://rss.politico.com/politics-news.xml` | 30 | ok |
| The Verge | `https://www.theverge.com/rss/index.xml` | 10 | ok (Atom) |
| Ars Technica | `https://feeds.arstechnica.com/arstechnica/index` | 20 | ok |
| TechCrunch | `https://techcrunch.com/feed/` | 20 | ok |
| Wired | `https://www.wired.com/feed/rss` | 50 | ok |
| Techmeme | `https://www.techmeme.com/feed.xml` | 15 | ok |
| Lobsters | `https://lobste.rs/rss` | 25 | ok |
| Reddit r/worldnews | `https://www.reddit.com/r/worldnews/.rss` | 25 | ok from a home IP; watch for blocks from the server |
| Google News top | `https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en` | 38 | ok; aggregates many outlets |
| Google News search | `https://news.google.com/rss/search?q=Anthropic&hl=en-US&gl=US&ceid=US:en` | ~100 | ok; a keyword pre-filter, then Jev to confirm |
| Reuters | `reuters.com/arc/outboundfeeds/rss/` | – | 404; no public RSS |
| AP | `apnews.com/index.rss` | – | 403; no public RSS (Google News covers AP stories) |

**Ground News.** No public API or RSS (checked 2026-09-26). Subscribers can build custom
feeds in the app, but those are behind a login. Options, in order of preference:
1. Skip it; Google News plus a bundle of outlet feeds covers the same stories.
2. If its bias labels (left/centre/right coverage, "blindspot") are the draw, read a
   logged-in custom-feed page with the headless browser. That needs the "cookie jar
   per host" item below, and a check of Ground News's terms of use first.

**Ideas this enables.**
- Same topic across outlets: "AI stories on the NYT home page vs. Fox latest vs. BBC top".
- Tech vs. general press: Techmeme/Verge/Ars vs. BBC/NYT home pages.
- Submitted vs. promoted, as with HN top vs. new: Google News search volume vs. front-page counts.
- A Score variant: average sentiment of matched headlines, per outlet.

**Open questions.** Deduplication across a bundle (normalised title vs. URL); whether to
include the description in the Noul (better recall, more tokens); how many feeds before
per-tick politeness matters (all are cheap, one request each).

## Roadmap (from PLAN Phase 9 and the proposal review)

- [ ] Events / annotations: dated notes drawn as markers on charts.
- [ ] Derived numbers: a `formula` fetcher over other numbers' latest samples (sums, ratios).
- [ ] Value alert rules over Pushover (threshold crossed, no change in N days).
- [ ] Time-of-day playlist scheduling for the eInk panel.
- [ ] `/render/dashboard/:id.png` via Puppeteer, for Pis without a browser; tune `theme=eink` on a real panel.
- [ ] Cookie jar per host exported from the extension, for logged-in pages (also unlocks Ground News custom feeds).
- [ ] API-backed daemon store so the poller can run on another machine or Lambda (D6).
- [ ] Per-dashboard signed share link that bypasses basic auth for one read-only view.
- [ ] Text tracking (prices, "in stock", headlines) with a diff view.
- [ ] CSV export from the Numbers tab.
- [ ] Import history from an existing scraper's JSON as seed samples (`gut import-samples` exists).
- [ ] Mobile layout for viewers.

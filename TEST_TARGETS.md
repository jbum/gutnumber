# Gutnumber — Test Targets and Starter Numbers

Real pages to develop and test against (2026-09-26). Values observed that day are
listed so tests of live fetches can assert "≥ observed" rather than an exact
number. Nothing in the automated test suite hits these live; they are for manual
verification and for refreshing fixtures in `test-fixtures/`.

## Starter number

| Field | Value |
|---|---|
| Video | **The Worst Idea YouTube's Ever Had...** by WVFRM Podcast (Waveform), published 2026-09-25 |
| URL | `https://www.youtube.com/watch?v=UD9X5WxZ5nE` (the share link `https://youtu.be/UD9X5WxZ5nE?is=…` canonicalises to this; strip tracking params at capture) |
| Views observed | 233,368 at 2026-09-26 06:02 PDT |
| Frequency | hourly (a fresh video moves fast; daily after a month) |

## What a plain HTTP fetch of a watch page contains (verified)

Fetched with a desktop Chrome UA and `Accept-Language: en-US`, no proxy, from a
residential Mac. The page is ~1.7 MB. The rendered `#info` view count is **not**
in the static DOM (client-rendered), but the number appears in inline JSON three
ways, any of which works as a `RegexSource` selector:

```
"viewCount":"233368"                                                    # ytInitialPlayerResponse.videoDetails
"viewCount":{"videoViewCountRenderer":{"viewCount":{"simpleText":"233,368 views"   # ytInitialData
"publishDate":"2026-09-25T06:31:05-07:00"
"ownerChannelName":"WVFRM Podcast"
```

Default `RegexSource` for YouTube watch pages: `"viewCount":"(\d+)"`, group 1.
Also useful: `"likeCount"` is not in the static page; likes need the Data API.

## Channel RSS feeds carry view counts (no API key)

`https://www.youtube.com/feeds/videos.xml?channel_id=<UC…>` lists the channel's
latest 15 uploads with `<media:statistics views="…"/>` per entry. This is the
cheapest possible YouTube source and the basis of the `youtube_channel_feed`
helper (params: channel id, and either a video id or "latest"). Limitation: a
video drops out of the feed after 15 newer uploads; the helper should then fall
back to the watch-page regex or the Data API, and the editor should warn when a
tracked video is no longer in the feed.

## Test videos from popular channels (latest uploads as of 2026-09-26)

| Channel | Channel id | Video id | Published | Views observed | Title |
|---|---|---|---|---|---|
| MrBeast | UCX6OQ3DkcsbYNE6H8uQQuVA | v9QtM6qnG50 | 2026-09-19 | 70,094,195 | I Built A City To Save Kids From Illegal Labor |
| MrBeast | UCX6OQ3DkcsbYNE6H8uQQuVA | T_SMf9j50uc | 2026-09-18 | 19,506,831 | Can We Build an Entire Village? |
| Veritasium | UCHnyfMqiRRG1u-2MsSQLbXA | VKlulHwMxgU | 2026-09-24 | 938,165 | What happens when you open the valve? |
| Veritasium | UCHnyfMqiRRG1u-2MsSQLbXA | JsBZOcqZerk | 2026-09-21 | 7,366,580 | The Insane Real Engineering of the Nazi Enigma Machine |
| Kurzgesagt | UCsXVk37bltHxD1rDPwtNM8Q | RQprZZJIb6Y | 2026-09-24 | 313,634 | Your Skeleton Is Electric |
| Kurzgesagt | UCsXVk37bltHxD1rDPwtNM8Q | QW_jlUn4gA8 | 2026-09-22 | 5,381,441 | This Is What a Godlike Civilization Would Look Like |
| Mark Rober | UCY1kMZp36IQSyNx_9h4mpCg | _L1Rim7-IPo | 2026-09-19 | 18,271,497 | Last Cheater Standing Wins $10,000! |
| Mark Rober | UCY1kMZp36IQSyNx_9h4mpCg | NUVkpWAD548 | 2026-09-18 | 2,896,956 | Chivalry or Engineering? |
| 3Blue1Brown | UCYO_jab_esuFRV4b17AJtAw | ausLKMojXaY | 2026-09-25 | 394,901 | The Phone Number puzzle |
| 3Blue1Brown | UCYO_jab_esuFRV4b17AJtAw | bRQEWPA832A | 2026-09-18 | 642,623 | The last IMO problem AI could not solve |
| Tom Scott | UCBa659QWEk1AI4Tg--mrJ2A | AQqVcdTH5bQ | 2026-09-21 | 861,396 | Can I get into the Top 100 of tiddlywinks in one day? |
| Tom Scott | UCBa659QWEk1AI4Tg--mrJ2A | Dr4lseoF82c | 2026-09-14 | 1,868,004 | Thomas, a tank engine, is not Thomas the Tank Engine. |

Why this mix: view counts spanning 3e5 to 7e7 (exercise K/M formatting, log
scale, axis choices), ages from 1 to 12 days (fast-moving vs settling curves for
the `delta` transform), and channels that upload often (MrBeast) vs rarely (Tom
Scott) for the RSS drop-out case.

## Refreshing fixtures

`scripts/fetch-fixture.ts <url> <name>` saves a page into `test-fixtures/` with
scripts stripped except inline JSON blobs, capped at 400 KB, plus a `.json`
sidecar recording the expected value and the date. Re-run when a site changes
shape; commit the new fixture with the resolver fix.

## Hacker News front page × topic (judgment helper, daily)

Source: one request, `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30`,
returns the current homepage stories (`title`, `url`, `points`, `author`,
`objectID`, `created_at`). No key. `hitsPerPage=60` for two pages.

Helper `hn_topic_count` (ARCHITECTURE §6.4, D15): state
`{ topic, items: [{ i, title, domain, points }] }`, one Noul per item
("Is `items[i]` about `topic`?"), value = count with p ≥ `threshold`, raw = the
matched titles with probabilities. Suggested first numbers, all `daily`:

| Label | topic | threshold |
|---|---|---|
| HN front page: AI stories | AI (artificial intelligence, machine learning, LLMs) | 0.5 |
| HN front page: Anthropic | Anthropic or its Claude models | 0.5 |
| HN front page: security breaches | a security breach, data leak or compromise | 0.5 |

Put the topic's expansion in the topic string; it is the model's only definition.
Expect 0–8 per topic per day; `bar` charts with `bucket: day, agg: last` read best.

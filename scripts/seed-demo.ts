/**
 * Demo data for trying the UI: real numbers from TEST_TARGETS.md (the daemon will poll them)
 * plus synthetic back-history so charts have shape. Run against a scratch data dir:
 *   GUTNUMBER_DATA_DIR=/tmp/gutdemo npx tsx scripts/seed-demo.ts
 */
import { loadConfig, openDb, createGutnumber, insertSamples, createVisualization, createDashboard, createPlaylist, updatePlaylist, listGutnumbers } from '@gut/db';

const config = loadConfig();
const db = openDb(config.dbPath);
if (listGutnumbers(db).length) {
  console.error('database is not empty; refusing to seed');
  process.exit(1);
}
const now = Math.floor(Date.now() / 1000);

const yt = (label: string, channel: string, video: string) => createGutnumber(db, { label, fetcher: 'helper', helper_name: 'youtube_channel_feed', helper_params: { channel, video, metric: 'views' }, frequency: 'hourly', unit: 'views' });
const starter = yt('Waveform: The Worst Idea YouTube’s Ever Had', '@Waveform', 'UD9X5WxZ5nE');
const beast = yt('MrBeast: I Built A City', 'UCX6OQ3DkcsbYNE6H8uQQuVA', 'v9QtM6qnG50');
const veri = yt('Veritasium: open the valve', 'UCHnyfMqiRRG1u-2MsSQLbXA', 'VKlulHwMxgU');
const kurz = yt('Kurzgesagt: Your Skeleton Is Electric', 'UCsXVk37bltHxD1rDPwtNM8Q', 'RQprZZJIb6Y');
const b3 = yt('3Blue1Brown: The Phone Number puzzle', 'UCYO_jab_esuFRV4b17AJtAw', 'ausLKMojXaY');
const hn = (label: string, topic: string, list: 'top' | 'new') => createGutnumber(db, { label, fetcher: 'helper', helper_name: 'hn_topic_count', helper_params: { topic, list, stories: '100' }, frequency: 'daily', unit: 'stories' });
const hnAiTop = hn('HN top 100: AI stories', 'AI (artificial intelligence, machine learning, LLMs)', 'top');
const hnAiNew = hn('HN new 100: AI stories', 'AI (artificial intelligence, machine learning, LLMs)', 'new');
const hnSec = hn('HN top 100: security breaches', 'a security breach, data leak or compromise', 'top');
const rank = createGutnumber(db, { label: 'Example book: Amazon sales rank (synthetic)', url: 'https://www.amazon.com/dp/B0EXAMPLE1', fetcher: 'http', proxy: 'residential', enabled: false, frequency: 'daily', unit: '#', bundle: { version: 1, selectors: [{ type: 'TextQuoteSelector', exact: '', prefix: 'Best Sellers Rank: ' }] } });

// Synthetic history (hourly for 7 days; daily for 60 days).
const growth = (id: number, start: number, end: number, hours = 168) => {
  const rows = [];
  for (let h = hours; h >= 1; h--) {
    const f = 1 - h / hours;
    rows.push({ ts: now - h * 3600, value: Math.max(0, Math.round(start + (end - start) * Math.sqrt(f) + Math.sin(h / 5) * (end - start) * 0.004)), raw: 'synthetic', strategy: 'demo' });
  }
  insertSamples(db, id, rows);
};
growth(starter.id, 0, 233000, 24);
growth(beast.id, 38_000_000, 70_000_000);
growth(veri.id, 0, 930_000, 60);
growth(kurz.id, 0, 310_000, 60);
growth(b3.id, 0, 390_000, 24);
const daily = (id: number, f: (d: number) => number, days = 60) => insertSamples(db, id, Array.from({ length: days }, (_, i) => ({ ts: now - (days - i) * 86400, value: f(i), raw: 'synthetic', strategy: 'demo' })));
daily(hnAiTop.id, (d) => Math.round(20 + 5 * Math.sin(d / 4) + (d % 7 === 3 ? 6 : 0)));
daily(hnAiNew.id, (d) => Math.round(29 + 6 * Math.sin(d / 3 + 1)));
daily(hnSec.id, (d) => Math.round(2 + 2 * Math.abs(Math.sin(d / 6)) + (d === 41 ? 7 : 0)));
daily(rank.id, (d) => Math.round(40000 - d * 450 + 9000 * Math.sin(d / 5)));

const cfg = (series: object[], extra: object = {}) => ({ range: { preset: '7d' }, series, ...extra }) as never;
const vBeast = createVisualization(db, { title: 'MrBeast: views this week', config: cfg([{ gutnumber_id: beast.id }], { type: 'area' }), carousel_seconds: 15 });
const vFresh = createVisualization(db, { title: 'Fresh uploads, first days', config: cfg([{ gutnumber_id: starter.id }, { gutnumber_id: veri.id }, { gutnumber_id: kurz.id }, { gutnumber_id: b3.id }]), carousel_seconds: 20 });
const vHn = createVisualization(db, { title: 'AI on Hacker News: submitted vs. scoring', config: cfg([{ gutnumber_id: hnAiNew.id, label: 'new 100' }, { gutnumber_id: hnAiTop.id, label: 'top 100' }], { type: 'line', range: { preset: '90d' } }), carousel_seconds: 20 });
const vSec = createVisualization(db, { title: 'Security breaches on HN', config: cfg([{ gutnumber_id: hnSec.id }], { type: 'bar', range: { preset: '90d' } }), carousel_seconds: 15 });
const vRank = createVisualization(db, { title: 'Sales rank (lower is better)', config: cfg([{ gutnumber_id: rank.id, invert: true, transform: { kind: 'running_avg', window: 7 } }], { range: { preset: '90d' } }), carousel_seconds: 15 });
const vStat = createVisualization(db, { title: 'Starter video', config: cfg([{ gutnumber_id: starter.id }], { type: 'stat' }), carousel_seconds: 10 });
const pl = createPlaylist(db, { title: 'Rotation', items: [{ kind: 'viz', viz_id: vSec.id }, { kind: 'viz', viz_id: vRank.id }, { kind: 'viz', viz_id: vBeast.id }] });
const dash = createDashboard(db, {
  title: 'The morning numbers',
  layout: {
    items: [
      { id: 'clock', kind: 'clock', x: 0, y: 0, w: 3, h: 3, format: '12h', show_date: true },
      { id: 'stat', kind: 'viz', viz_id: vStat.id, x: 3, y: 0, w: 3, h: 3 },
      { id: 'hn', kind: 'viz', viz_id: vHn.id, x: 6, y: 0, w: 6, h: 5 },
      { id: 'fresh', kind: 'viz', viz_id: vFresh.id, x: 0, y: 3, w: 6, h: 5 },
      { id: 'car', kind: 'carousel', playlist_id: pl.id, x: 6, y: 5, w: 6, h: 3 },
    ],
  } as never,
});
createDashboard(db, { title: 'eInk panel', options: { theme: 'eink', show_title: true, refresh_seconds: 900 }, layout: { items: [{ id: 'a', kind: 'viz', viz_id: vHn.id, x: 0, y: 0, w: 12, h: 4 }, { id: 'b', kind: 'viz', viz_id: vStat.id, x: 0, y: 4, w: 6, h: 2 }, { id: 'c', kind: 'clock', x: 6, y: 4, w: 6, h: 2, format: '12h', show_date: true }] } as never });
updatePlaylist(db, pl.id, { title: 'Rotation', items: [{ kind: 'viz', viz_id: vSec.id }, { kind: 'viz', viz_id: vRank.id }, { kind: 'viz', viz_id: vBeast.id }] });
createPlaylist(db, { title: 'Wall display', items: [{ kind: 'dashboard', dashboard_id: dash.id, seconds: 30 }, { kind: 'viz', viz_id: vHn.id }, { kind: 'viz', viz_id: vFresh.id }] });
console.log(`seeded ${listGutnumbers(db).length} numbers into ${config.dbPath}`);

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStats, upcomingSales } from '../scripts/site-stats.mjs';
import { mergeNews, parseRss } from '../scripts/fetch-news.mjs';
import { formatShareText } from '../extension/shared/lib.js';

const evs = [
  { category: '演唱會', platform: 'kktix', dateStart: '2026-11-07', venues: ['小巨蛋'], cities: ['台北'], saleStarts: [2000], url: 'https://a.example/1', title: 'A' },
  { category: '演唱會', platform: 'tixcraft', dateStart: '2026-11-20', venues: ['小巨蛋', '南港展覽館'], cities: ['台北'], saleStarts: [1000], url: 'javascript:x', title: 'B' },
  { category: '音樂祭', platform: 'opentix', dateStart: '2026-12-01', venues: ['高雄巨蛋'], cities: ['高雄'], saleStarts: [], title: 'C' },
  { category: '課程講座', platform: 'kktix', dateStart: '2026-11-03', venues: ['教室'], cities: ['台中'], saleStarts: [], title: 'D' },
];

test('buildStats：演唱會範圍只統計音樂類', () => {
  const s = buildStats(evs, { scope: 'concert' });
  assert.equal(s.total, 3);
  assert.deepEqual(s.byVenue[0], ['小巨蛋', 2]);
  assert.deepEqual(s.byMonth, [['2026-11', 2], ['2026-12', 1]]);
  assert.deepEqual(s.byCity[0], ['台北', 2]);
});

test('buildStats：全部範圍含所有類型', () => {
  const s = buildStats(evs, { scope: 'all' });
  assert.equal(s.total, 4);
  assert.equal(s.byCategory.length, 3);
});

test('upcomingSales：依開賣時間排序並過濾不安全網址', () => {
  const u = upcomingSales(evs, 0);
  assert.deepEqual(u.map((x) => x.title), ['B', 'A']);
  assert.equal(u[0].url, '');
});

test('parseRss／mergeNews', () => {
  const xml = `<rss><channel><item><title>演唱會開賣 - 某報</title><link>https://n.example/1</link><pubDate>Thu, 15 Oct 2026 01:00:00 GMT</pubDate><source url="x">某報</source></item>
  <item><title>壞連結</title><link>javascript:1</link><pubDate>Thu, 15 Oct 2026 02:00:00 GMT</pubDate></item></channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '演唱會開賣');
  assert.equal(items[0].source, '某報');
  assert.equal(mergeNews([items, items]).length, 1);
});

test('formatShareText：包含重點且略過空欄位', () => {
  const t = formatShareText({ title: '測試演唱會', category: '演唱會', dateStart: '2026-11-07', dateEnd: '2026-11-07', venues: ['小巨蛋'], url: 'https://a.example' },
    { platform: 'KKTIX', price: 'NT$1,000', status: '尚未開賣', now: 0 });
  assert.match(t, /測試演唱會/);
  assert.match(t, /演出：2026-11-07$/m);
  assert.match(t, /地點：小巨蛋/);
  assert.match(t, /https:\/\/a\.example/);
  assert.doesNotMatch(t, /開賣：/);
});

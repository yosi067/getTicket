import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFilter, byMonth, byWeekday, cross, hotDates, insights, leadDays, medianPrice, priceBands, quality, saleHours, tally, toRows, upcomingSales,
} from '../scripts/site-stats.mjs';
import { classifyTopic, isTaiwan, mergeNews, parseRss } from '../scripts/fetch-news.mjs';
import { formatShareText } from '../extension/shared/lib.js';

const H = 3600e3;
const sale = Date.parse('2026-10-20T12:00:00+08:00'); // 台灣 12:00
const evs = [
  { category: '演唱會', platform: 'kktix', dateStart: '2026-11-07', venues: ['臺北小巨蛋'], cities: ['台北'], saleStarts: [sale], priceMin: 800, priceMax: 4800, url: 'https://a.example/1' },
  { category: '演唱會', platform: 'tixcraft', dateStart: '2026-11-07', venues: ['台北小巨蛋', '南港展覽館'], cities: ['台北'], saleStarts: [sale + 2 * H], priceMax: 2800, url: 'javascript:x' },
  { category: '音樂祭', platform: 'opentix', dateStart: '2026-12-01', venues: ['高雄巨蛋'], cities: ['高雄'], saleStarts: [] },
  { category: '課程講座', platform: 'kktix', dateStart: '2026-11-03', venues: ['教室'], cities: ['台中'], saleStarts: [], categoryInferred: true },
];
const rows = toRows(evs);

test('toRows：場館正規化（臺→台）、星期、最低價補齊', () => {
  assert.equal(rows[0].v, '台北小巨蛋');
  assert.equal(rows[0].w, 5); // 2026-11-07 為週六
  assert.equal(rows[1].lo, 2800);
  assert.equal(rows[3].i, 1);
});

test('applyFilter：範圍與維度篩選', () => {
  assert.equal(applyFilter(rows, { scope: 'all' }).length, 4);
  assert.equal(applyFilter(rows, { scope: 'music' }).length, 3);
  assert.equal(applyFilter(rows, { scope: 'show', y: '台北' }).length, 2);
  assert.equal(applyFilter(rows, { scope: 'all', c: '音樂祭', m: '2026-12' }).length, 1);
});

test('tally／byMonth／byWeekday', () => {
  assert.deepEqual(tally(rows, 'v')[0], ['台北小巨蛋', 2]);
  assert.deepEqual(byMonth(rows), [['2026-11', 3], ['2026-12', 1]]);
  assert.equal(byWeekday(rows)[5][1], 2);
});

test('cross：類型×月份交叉表', () => {
  const t = cross(rows, 'c', 'm');
  assert.deepEqual(t.cols, ['2026-11', '2026-12']);
  assert.equal(t.cells[t.rows.indexOf('演唱會')][0], 2);
  assert.equal(t.max, 2);
});

test('priceBands／medianPrice／leadDays／saleHours／hotDates', () => {
  const b = Object.fromEntries(priceBands(rows));
  assert.equal(b['2,000–3,499'], 1);
  assert.equal(b['3,500–4,999'], 1);
  assert.equal(b['未公布'], 2);
  assert.deepEqual(medianPrice(rows, 'c', 1).find(([k]) => k === '演唱會').slice(0, 2), ['演唱會', 3800]);
  assert.equal(leadDays(rows, 'c')[0][1], 17);
  assert.equal(saleHours(rows)[12][1], 1);
  assert.deepEqual(hotDates(rows), [['2026-11-07', 2]]);
});

test('quality／insights', () => {
  assert.equal(quality(rows).price, 50);
  assert.equal(quality(rows).category, 75);
  assert.ok(insights(rows).length >= 4);
  assert.ok(insights(rows).some((t) => t.includes('場館以「台北小巨蛋」最多，共 2 場')));
  assert.deepEqual(insights([]), []);
});

test('upcomingSales：只留表演類、排序並過濾不安全網址', () => {
  const u = upcomingSales(evs, 0);
  assert.deepEqual(u.map((x) => x.saleStart), [sale, sale + 2 * H]);
  assert.equal(u[1].url, '');
});

test('新聞：排除香港與海外，保留台灣', () => {
  assert.equal(isTaiwan({ title: '容祖兒演唱會2027｜啟德主場館加場', source: '香港01' }), false);
  assert.equal(isTaiwan({ title: 'Kep1er演唱會2026澳門｜門票攻略', source: 'ETtoday' }), false);
  assert.equal(isTaiwan({ title: '告五人小巨蛋連唱3晚全完售', source: 'Yahoo新聞' }), true);
  assert.equal(isTaiwan({ title: '某歌手首辦演唱會', source: '星島頭條', sourceUrl: 'https://std.stheadline.com' }), false);
  assert.equal(isTaiwan({ title: '某歌手首辦演唱會', source: '自由時報', sourceUrl: 'https://news.ltn.com.tw' }), true);
  assert.equal(isTaiwan({ title: '某歌手首辦演唱會', source: '某不明網站', sourceUrl: 'https://x.example' }), false);
});

test('新聞：解析、去重、分類', () => {
  const xml = `<rss><channel><item><title>小巨蛋演唱會開賣 - 某報</title><link>https://n.example/1</link><pubDate>Thu, 15 Oct 2026 01:00:00 GMT</pubDate><source url="https://news.ltn.com.tw">某報</source></item>
  <item><title>壞連結小巨蛋</title><link>javascript:1</link><pubDate>Thu, 15 Oct 2026 02:00:00 GMT</pubDate></item></channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '小巨蛋演唱會開賣');
  assert.equal(mergeNews([items, items]).length, 1);
  assert.equal(classifyTopic('黃牛票飆天價'), '黃牛與詐騙');
  assert.equal(classifyTopic('演唱會加開一場'), '加場');
  assert.equal(classifyTopic('某劇團新作'), '演出消息');
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

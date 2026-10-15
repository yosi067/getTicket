import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntities, parseKktixAtom, parseOpentixEvent, parseOpentixSitemap, parseTixcraftList } from '../demo/sources.mjs';

const NOW = Date.parse('2026-10-14T00:00:00+08:00');

test('decodeEntities 處理具名與數字實體，未知實體保持原樣', () => {
  assert.equal(decodeEntities('A &amp; B &#39;x&#x41;&quot; &foo;'), "A & B 'xA\" &foo;");
});

const ATOM = `<feed><entry>
<id>tag:kktix.com,2005:Event/122893</id>
<link rel="alternate" type="text/html" href="https://ctctaiwan.kktix.cc/events/forum2026"/>
<title>2026 福音更新論壇 &amp; 聚會</title>
<content type="html">時間：2026/10/12 09:00(+0800) ~ 2026/10/15 17:50(+0800)
地點：台中忠孝路長老教會 / 台中市東區建成路738號</content>
<author><name>City To City Taiwan</name></author>
</entry>
<entry>
<id>tag:kktix.com,2005:Event/1</id>
<link rel="alternate" href="https://a.kktix.cc/events/old"/>
<title>已結束</title>
<content type="html">時間：2025/01/01 09:00(+0800) ~ 2025/01/01 10:00(+0800)</content>
</entry>
<entry>
<id>tag:kktix.com,2005:Event/2</id>
<link rel="alternate" href="http://evil.example.com/x"/>
<title>非 KKTIX 網址</title>
<content type="html">時間：2026/11/01 09:00(+0800)</content>
</entry>
<entry>
<id>tag:kktix.com,2005:Event/3</id>
<link rel="alternate" href="https://a.kktix.cc/events/notime"/>
<title>沒有時間</title>
<content type="html">地點：某處</content>
</entry></feed>`;

test('parseKktixAtom 解析時間、地點，並排除已結束、非 KKTIX 網址、無時間的項目', () => {
  const list = parseKktixAtom(ATOM, NOW);
  assert.equal(list.length, 1);
  const e = list[0];
  assert.equal(e.eventId, 'kktix-122893');
  assert.equal(e.platform, 'kktix');
  assert.equal(e.title, '2026 福音更新論壇 & 聚會');
  assert.equal(e.startsAt, Date.parse('2026-10-12T09:00:00+08:00'));
  assert.equal(e.endsOnMs, Date.parse('2026-10-15T17:50:00+08:00'));
  assert.deepEqual(e.venues, ['台中忠孝路長老教會']);
  assert.deepEqual(e.cities, ['台中']);
  assert.deepEqual(e.organizers, ['City To City Taiwan']);
  assert.equal(e.url, 'https://ctctaiwan.kktix.cc/events/forum2026');
  assert.equal(e.saleStart, null);
});

const TIX = `<div class="eventbl col-12"><div class="row">
<a href="/activity/detail/27_brunomars"><img class="img-fluid" src="https://static.tixcraft.com/images/activity/a.jpg" alt=""></a>
<div class="text-small date">2027/05/01(Sat.)  ~ 2027/05/02 (Sun.) </div>
<div class="text-bold pt-1 pb-1"><a href="/activity/detail/27_brunomars">Bruno Mars - The Romantic Tour</a></div>
<div class="text-small text-med-light">
高雄國家體育場(世運主場館)   </div></div></div>
<div class="eventbl"><a href="/activity/detail/old1"><img src="https://evil.example.com/x.jpg"></a>
<div class="text-small date">2020/01/01(Wed.)</div>
<div class="text-bold pt-1 pb-1"><a href="/activity/detail/old1">舊活動</a></div>
<div class="text-small text-med-light">某處</div></div>
<div class="eventbl"><a href="/activity/detail/27_brunomars">dup</a><div class="text-small date">2027/05/01</div>
<div class="text-bold pt-1 pb-1"><a href="/activity/detail/27_brunomars">重複</a></div></div>`;

test('parseTixcraftList 解析列表、略過過期與重複，並只接受官方圖片網域', () => {
  const list = parseTixcraftList(TIX, NOW);
  assert.equal(list.length, 1);
  const e = list[0];
  assert.equal(e.eventId, 'tixcraft-27_brunomars');
  assert.equal(e.title, 'Bruno Mars - The Romantic Tour');
  assert.equal(e.dateStart, '2027-05-01');
  assert.equal(e.dateEnd, '2027-05-02');
  assert.equal(e.dateOnly, true);
  assert.deepEqual(e.venues, ['高雄國家體育場(世運主場館)']);
  assert.deepEqual(e.cities, ['高雄']);
  assert.equal(e.image, 'https://static.tixcraft.com/images/activity/a.jpg');
  assert.equal(e.url, 'https://tixcraft.com/activity/detail/27_brunomars');
});

test('parseTixcraftList 對非官方圖片網域不採用', () => {
  const html = TIX.replace('2020/01/01(Wed.)', '2027/06/01(Tue.)');
  const old = parseTixcraftList(html, NOW).find((e) => e.eventId === 'tixcraft-old1');
  assert.equal(old.image, null);
});

test('parseOpentixSitemap 依 lastmod 由新到舊排序，只取 event 網址', () => {
  const xml = '<urlset><url><loc>https://www.opentix.life/product/9</loc><lastmod>2026-10-01T00:00:00Z</lastmod></url>'
    + '<url><loc>https://www.opentix.life/event/1</loc><lastmod>2026-09-01T00:00:00Z</lastmod></url>'
    + '<url><loc>https://www.opentix.life/event/2</loc><lastmod>2026-10-10T00:00:00Z</lastmod></url></urlset>';
  assert.deepEqual(parseOpentixSitemap(xml).map((x) => x.id), ['2', '1']);
});

const LD = (o) => `<html><script type="application/ld+json">{"@context":"http://schema.org","@type":"BreadcrumbList"}</script><script type="application/ld+json">${JSON.stringify(o)}</script></html>`;

test('parseOpentixEvent 讀取 schema.org Event，無時區時視為 +08:00', () => {
  const html = LD({
    '@type': 'Event', name: '傳統表演 &amp; 劇場', image: 'https://s3.resource.opentix.life/a.jpg',
    organizer: [{ name: '某基金會' }], startDate: '2026-10-14T20:00:00', endDate: '2026-10-14T23:30:00',
    location: { name: '台泥大樓士敏廳', address: { addressLocality: '臺北市', streetAddress: '中山區中山北路二段113號' } },
    offers: { '@type': 'AggregateOffer', highPrice: 800, lowPrice: 600 },
  });
  const e = parseOpentixEvent(html, '186', NOW);
  assert.equal(e.eventId, 'opentix-186');
  assert.equal(e.title, '傳統表演 & 劇場');
  assert.equal(e.startsAt, Date.parse('2026-10-14T20:00:00+08:00'));
  assert.equal(e.timeStart ?? e.sessions[0].timeStart, '20:00');
  assert.deepEqual(e.cities, ['台北']);
  assert.equal(e.priceMin, 600);
  assert.equal(e.priceMax, 800);
  assert.equal(e.url, 'https://www.opentix.life/event/186');
});

test('parseOpentixEvent 對已結束、缺少 Event 或日期不合法的頁面回傳 null', () => {
  assert.equal(parseOpentixEvent(LD({ '@type': 'Event', name: 'x', startDate: '2020-01-01T10:00:00' }), '1', NOW), null);
  assert.equal(parseOpentixEvent('<html></html>', '1', NOW), null);
  assert.equal(parseOpentixEvent(LD({ '@type': 'Event', name: 'x', startDate: 'bad' }), '1', NOW), null);
});

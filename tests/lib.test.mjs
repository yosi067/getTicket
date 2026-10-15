import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildIcs, cityOf, classify, clockSample, dateFromText, diffEvents, eventIdFromUrl, findConsecutive, foldLine, formatCountdown, median,
  nextSaleStart, normalizeEvent, parseAlarmName, pickArea, pickSession, planAlarms, routeOf, saleStatus, toEpoch,
} from '../extension/shared/lib.js';

const fx = (id, name) => JSON.parse(readFileSync(new URL(`./fixtures/${id}.${name}.json`, import.meta.url), 'utf8'));
const WITH_AREA = 'f48ffe293f97e29747fe9f9d384efbf6';
const NO_AREA = '5a9402cb808f6c52fcfaf4ee2a9b46bb';
const load = (id) => normalizeEvent({
  eventId: id, event: fx(id, 'event'), sessions: fx(id, 'sessions').sessions, products: fx(id, 'products').products, areas: fx(id, 'ticketAreas').ticketAreas ?? [], fetchedAt: 0,
});

test('normalizeEvent：有選位的真實活動', () => {
  const ev = load(WITH_AREA);
  assert.equal(ev.title, '誰說我不在乎　高明駿2026演唱會-台北站');
  assert.deepEqual(ev.organizers, ['宇禾數位股份有限公司']);
  assert.equal(ev.hasSeatMap, true);
  assert.equal(ev.dateStart, '2026-10-23');
  assert.equal(ev.sessions[0].timeStart, '19:00');
  assert.equal(ev.startsAt, Date.parse('2026-10-23T19:00:00+08:00'));
  assert.equal(ev.saleStart, Date.parse('2026-04-10T15:40:00+08:00'));
  assert.equal(ev.priceMin, Math.min(...ev.products.map((p) => p.price)));
  assert.ok(ev.areas.some((a) => a.name === '一樓A區'));
  assert.equal(ev.cities[0], '新北');
  assert.equal(ev.url, `https://ticketplus.com.tw/activity/${WITH_AREA}`);
});

test('normalizeEvent：無選位活動', () => {
  const ev = load(NO_AREA);
  assert.equal(ev.hasSeatMap, false);
  assert.deepEqual(ev.areas, []);
  assert.equal(ev.cities[0], '台北');
});

test('classify / cityOf', () => {
  assert.equal(classify('桑心男孩俱樂部 發片專場'), '演唱會');
  assert.equal(classify('Tickets in Japan'), '其他');
  assert.equal(cityOf('臺北市中正區八德路一段1號'), '台北');
  assert.equal(cityOf('高雄市前鎮區'), '高雄');
  assert.equal(cityOf('', ''), '其他');
});

test('saleStatus / nextSaleStart', () => {
  const ev = load(WITH_AREA);
  const s = ev.saleStart;
  assert.equal(saleStatus(ev, s - 1000), 'upcoming');
  assert.equal(saleStatus(ev, s + 1000), 'onsale');
  assert.equal(saleStatus(ev, ev.endsOnMs + 1000), 'past');
  assert.equal(nextSaleStart(ev, s - 1), s);
  assert.equal(nextSaleStart(ev, s), null);
});

test('時鐘校正', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
  // 伺服器 12:00:00.000（秒級截斷），請求往返 200ms → 取中點補 500ms
  const off = clockSample({ dateMs: 1_000_000, ageSec: 0, t0: 1_000_100, t1: 1_000_300 });
  assert.ok(Math.abs(off - (1_000_000 + 500 - 1_000_200)) < 1);
});

test('planAlarms 套用時鐘偏差並略過已過時間', () => {
  const T = 10_000_000;
  const now = 9_000_000;
  const offsetMs = 2000; // 伺服器比本機快 2 秒
  const plans = planAlarms({
    items: { a: { saleStarts: [T, now - 5] } },
    favorites: { a: { reminders: [{ id: 'r1', type: 'beforeSale', minutes: 5 }, { id: 'r2', type: 'beforeSale', minutes: 100000 }, { id: 'r3', type: 'at', at: now + 1000 }, { id: 'r4', type: 'at', at: now - 1000 }], autoOpen: true } },
    now, offsetMs, openLeadSec: 30,
  });
  const byName = Object.fromEntries(plans.map((p) => [p.name, p.when]));
  assert.equal(byName[`rem|a|r1|${T}`], T - 300_000 - offsetMs);
  assert.equal(byName[`open|a|${T}`], T - 30_000 - offsetMs);
  assert.equal(byName[`rem|a|r3|${now + 1000}`], now + 1000);
  assert.equal(plans.length, 3);
  assert.deepEqual(parseAlarmName(`rem|a|r1|${T}`), { kind: 'rem', id: 'a', reminderId: 'r1', target: T });
  assert.deepEqual(parseAlarmName(`open|a|${T}`), { kind: 'open', id: 'a', target: T });
});

test('diffEvents', () => {
  const d = diffEvents({ a: { saleStarts: [1] }, b: { saleStarts: [2] } }, { a: { saleStarts: [1] }, b: { saleStarts: [3] }, c: { saleStarts: [] } });
  assert.deepEqual(d.added, ['c']);
  assert.equal(d.saleChanged.length, 1);
  assert.equal(d.saleChanged[0].id, 'b');
});

test('ICS：折行不切斷多位元組字元、含提醒', () => {
  const long = foldLine(`SUMMARY:${'演'.repeat(60)}`);
  for (const l of long.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75);
  assert.equal(long.replace(/\r\n /g, ''), `SUMMARY:${'演'.repeat(60)}`);
  const ics = buildIcs([{ uid: 'x@y', summary: '【開賣】測試,活動', startMs: Date.UTC(2026, 3, 10, 7, 40), alarmsMin: [60] }], { now: Date.UTC(2026, 0, 1) });
  assert.match(ics, /DTSTART:20260410T074000Z/);
  assert.match(ics, /TRIGGER:-PT60M/);
  assert.match(ics, /測試\\,活動/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('pickSession / pickArea / findConsecutive', () => {
  const rows = [{ date: '2026-10-23', soldOut: true }, { date: '2026-10-24', soldOut: false }, { date: '2026-10-25', soldOut: false }];
  assert.equal(pickSession(rows, { sessionDates: [] }).date, '2026-10-24');
  assert.equal(pickSession(rows, { sessionDates: ['2026-10-23', '2026-10-25'] }).date, '2026-10-25');
  assert.equal(pickSession(rows, { sessionDates: ['2026-10-23'] }), null);

  const areas = [{ name: '一樓A區 NT$4580', soldOut: true }, { name: '一樓B區 NT$3980', soldOut: false }, { name: '二樓A區', soldOut: false }];
  assert.equal(pickArea(areas, { areaOrder: ['一樓A區', '一樓B區'] }).area.name, '一樓B區 NT$3980');
  assert.equal(pickArea(areas, { areaOrder: ['看台'], areaFallback: 'none' }), null);
  assert.equal(pickArea(areas, { areaOrder: ['看台'], areaFallback: 'any' }).rank, -1);

  const T = true;
  const F = false;
  assert.deepEqual(findConsecutive([[T, F, T, T], [T, T, T, T]], 2), { row: 0, start: 2 });
  assert.deepEqual(findConsecutive([[T, F, T, F], [T, T, T, T]], 3), { row: 1, start: 0 });
  assert.equal(findConsecutive([[T, F, T]], 2), null);
});

test('路由、連結、日期文字、倒數', () => {
  assert.deepEqual(routeOf('/order/abc/def'), { step: 'order', id: 'abc', sessionId: 'def' });
  assert.equal(routeOf('/'), null);
  assert.equal(eventIdFromUrl(`https://ticketplus.com.tw/activity/${WITH_AREA}`), WITH_AREA);
  assert.equal(eventIdFromUrl('https://example.com/activity/x'), null);
  assert.equal(dateFromText('2026-10-23(五) 19:00'), '2026-10-23');
  assert.equal(toEpoch('2026-10-23', '19:00'), Date.parse('2026-10-23T11:00:00Z'));
  assert.match(formatCountdown(90_061_000), /1/);
  assert.equal(formatCountdown(-5), '00:00:00');
});

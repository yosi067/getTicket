// 其他中文售票平台的「公開列表資料」來源（唯讀、低頻率）。
// 只讀取各平台公開提供的頁面／資料（KKTIX Atom、拓元活動列表、OPENTIX 網站地圖與活動頁的結構化資料）。
// 不登入、不繞過驗證；遇到驗證關卡（例如拓元活動詳情頁）一律不抓取，缺少的欄位顯示「未提供」。
import { classify, cityOf, mapLimit, TZ } from '../extension/shared/lib.js';

export const PLATFORMS = {
  ticketplus: 'Ticket Plus',
  tixcraft: '拓元 Tixcraft',
  kktix: 'KKTIX',
  opentix: 'OPENTIX 兩廳院',
};

const UA = 'TicketWarDemo/0.1 (personal non-commercial demo; low-frequency read-only)';
const HOSTS = new Set(['tixcraft.com', 'kktix.com', 'www.opentix.life']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, { timeoutMs = 25000 } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) throw new Error(`不允許的來源：${u.hostname}`);
  const res = await fetch(u, { headers: { 'user-agent': UA, accept: 'text/html,application/xml,application/atom+xml' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---------- 共用 ----------

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const n = g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENT[g.toLowerCase()] ?? m;
  });
}
const text = (s) => decodeEntities(String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const httpsUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; } };
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function makeEvent({ platform, id, title, url, image, venue, address, startsAt, endsOnMs, dateStart, dateEnd, timeStart = null, organizers = [], priceMin = null, priceMax = null, dateOnly = false }) {
  const city = cityOf(venue, address);
  return {
    eventId: `${platform}-${id}`,
    platform,
    title,
    category: classify(title),
    categoryInferred: true,
    organizers,
    sessions: [{ dateStart, dateEnd, timeStart, startsAt, endsOnMs, venue: venue || '', city, saleStart: null, saleEnd: null }],
    areas: [],
    priceMin, priceMax,
    saleStarts: [], saleStart: null, saleEnds: [], saleEnd: null,
    startsAt, endsOnMs, dateStart, dateEnd, dateOnly,
    cities: [city], venues: venue ? [venue] : [],
    image: httpsUrl(image), url: httpsUrl(url),
  };
}

const upcoming = (e, now) => e.title && e.startsAt != null && (e.endsOnMs ?? e.startsAt) >= now;

// ---------- KKTIX（公開 Atom） ----------

export function parseKktixAtom(xml, now = Date.now()) {
  const out = [];
  for (const m of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = e.match(/Event\/(\d+)/)?.[1];
    const url = decodeEntities(e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1] ?? '');
    const title = text(e.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]);
    const content = decodeEntities(String(e.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
    const author = text(e.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/)?.[1]);
    if (!id || !title || !/^https:\/\/[a-z0-9.-]*kktix\.(cc|com)\//i.test(url)) continue;

    const timeLine = content.match(/時間[：:]\s*([^\n]+)/)?.[1] ?? '';
    const parts = [...timeLine.matchAll(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/g)];
    if (!parts.length) continue;
    const off = timeLine.match(/\(([+-])(\d{2})(\d{2})\)/);
    const tz = off ? `${off[1]}${off[2]}:${off[3]}` : TZ;
    const toMs = (p) => Date.parse(`${ymd(p[1], p[2], p[3])}T${p[4].padStart(2, '0')}:${p[5]}:00${tz}`);
    const a = parts[0];
    const b = parts[1] ?? parts[0];
    const startsAt = toMs(a);
    const endsOnMs = toMs(b);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsOnMs)) continue;
    const place = content.match(/地點[：:]\s*([^\n]+)/)?.[1]?.trim() ?? '';
    const [venue, ...rest] = place.split(/\s+\/\s+/);
    const ev = makeEvent({
      platform: 'kktix', id, title, url, venue: venue?.trim(), address: rest.join(' '),
      startsAt, endsOnMs,
      dateStart: ymd(a[1], a[2], a[3]), dateEnd: ymd(b[1], b[2], b[3]),
      timeStart: `${a[4].padStart(2, '0')}:${a[5]}`,
      organizers: author ? [author] : [],
    });
    if (upcoming(ev, now)) out.push(ev);
  }
  return out;
}

async function fetchKktix() {
  return parseKktixAtom(await fetchText('https://kktix.com/events.atom'));
}

// ---------- 拓元（公開活動列表；詳情頁有驗證關卡，不抓） ----------

export function parseTixcraftList(html, now = Date.now()) {
  const out = [];
  const seen = new Set();
  const chunks = String(html).split('class="eventbl').slice(1);
  for (const c of chunks) {
    const id = c.match(/\/activity\/detail\/([A-Za-z0-9_-]+)/)?.[1];
    if (!id || seen.has(id)) continue;
    const dates = [...(c.match(/class="text-small date">([^<]*)</)?.[1] ?? '').matchAll(/(\d{4})\/(\d{2})\/(\d{2})/g)];
    const title = text(c.match(/class="text-bold[^"]*">\s*<a[^>]*>([\s\S]*?)<\/a>/)?.[1]);
    if (!dates.length || !title) continue;
    const venue = text(c.match(/class="text-small text-med-light">([\s\S]*?)<\/div>/)?.[1]);
    const image = decodeEntities(c.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? '');
    const a = dates[0];
    const b = dates[dates.length - 1];
    const dateStart = ymd(a[1], a[2], a[3]);
    const dateEnd = ymd(b[1], b[2], b[3]);
    const ev = makeEvent({
      platform: 'tixcraft', id, title, url: `https://tixcraft.com/activity/detail/${id}`, image: /^https:\/\/static\.tixcraft\.com\//.test(image) ? image : null,
      venue, address: '',
      startsAt: Date.parse(`${dateStart}T00:00:00${TZ}`), endsOnMs: Date.parse(`${dateEnd}T23:59:59${TZ}`),
      dateStart, dateEnd, dateOnly: true,
    });
    seen.add(id);
    if (upcoming(ev, now)) out.push(ev);
  }
  return out;
}

async function fetchTixcraft() {
  return parseTixcraftList(await fetchText('https://tixcraft.com/activity'));
}

// ---------- OPENTIX（網站地圖 + 活動頁 JSON-LD） ----------

export function parseOpentixSitemap(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<loc>https:\/\/www\.opentix\.life\/event\/(\d+)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?/g)) {
    items.push({ id: m[1], lastmod: Date.parse(m[2] ?? '') || 0 });
  }
  return items.sort((x, y) => y.lastmod - x.lastmod);
}

const localMs = (s) => {
  if (!s) return NaN;
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}${TZ}`);
};

export function parseOpentixEvent(html, id, now = Date.now()) {
  let ld = null;
  for (const m of String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]);
      const hit = (Array.isArray(d) ? d : [d]).find((x) => x && x['@type'] === 'Event');
      if (hit) { ld = hit; break; }
    } catch { /* 略過無法解析的區塊 */ }
  }
  if (!ld) return null;
  const startsAt = localMs(ld.startDate);
  let endsOnMs = localMs(ld.endDate);
  if (!Number.isFinite(startsAt)) return null;
  if (!Number.isFinite(endsOnMs)) endsOnMs = startsAt;
  const loc = ld.location ?? {};
  const addr = loc.address ?? {};
  const orgs = (Array.isArray(ld.organizer) ? ld.organizer : ld.organizer ? [ld.organizer] : []).map((o) => decodeEntities(o?.name ?? '')).filter(Boolean);
  const offers = ld.offers ?? {};
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const dStart = String(ld.startDate).slice(0, 10);
  const dEnd = Number.isFinite(localMs(ld.endDate)) ? String(ld.endDate).slice(0, 10) : dStart;
  const ev = makeEvent({
    platform: 'opentix', id, title: text(ld.name), url: `https://www.opentix.life/event/${id}`,
    image: Array.isArray(ld.image) ? ld.image[0] : ld.image,
    venue: text(loc.name), address: `${addr.addressLocality ?? ''}${addr.streetAddress ?? ''}`,
    startsAt, endsOnMs, dateStart: dStart, dateEnd: dEnd, timeStart: String(ld.startDate).slice(11, 16) || null,
    organizers: orgs, priceMin: num(offers.lowPrice), priceMax: num(offers.highPrice),
  });
  return upcoming(ev, now) ? ev : null;
}

async function fetchOpentix({ limit = 60 } = {}) {
  const items = parseOpentixSitemap(await fetchText('https://www.opentix.life/otWebSitemap.xml')).slice(0, limit);
  const list = await mapLimit(items, 2, async ({ id }) => {
    await sleep(300);
    try { return parseOpentixEvent(await fetchText(`https://www.opentix.life/event/${id}`), id); } catch { return null; }
  });
  return list.filter(Boolean);
}

// ---------- 彙整 ----------

export const ADAPTERS = { kktix: fetchKktix, tixcraft: fetchTixcraft, opentix: fetchOpentix };

// 各來源獨立：任一來源失敗不影響其他來源。
export async function fetchAllSources(only = Object.keys(ADAPTERS)) {
  const fetchedAt = Date.now();
  const sources = {};
  const events = [];
  for (const key of only) {
    try {
      const list = await ADAPTERS[key]();
      sources[key] = { ok: true, count: list.length, fetchedAt };
      events.push(...list);
    } catch (e) {
      sources[key] = { ok: false, count: 0, error: String(e.message ?? e), fetchedAt };
    }
  }
  return { fetchedAt, sources, events };
}

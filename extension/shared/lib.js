// 純函式：解析、正規化、狀態計算、提醒規劃、ICS、偏好比對。
// 不依賴 chrome.* 或 DOM，方便單元測試。

export const SITE = 'https://ticketplus.com.tw';
export const TZ = '+08:00';
export const eventUrl = (id) => `${SITE}/activity/${id}`;

export const DEFAULT_SETTINGS = {
  refreshMinutes: 30,
  notifyNewEvents: true,
  watchKeywords: [],
  openLeadSec: 60,
  defaultReminders: [1440, 60, 10, 1],
};

export const DEFAULT_ASSIST = {
  enabled: false,
  sessionDates: [], // ['2026-10-23', ...] 依優先順序；空 = 第一個可購買場次
  areaOrder: [], // ['一樓A區', ...] 依優先順序（名稱需包含比對）
  areaFallback: 'none', // 'none' 不自動選；'any' 偏好都不可用時選第一個可購買票區
  ticketNames: [], // 票種偏好，例如 ['全票']；空 = 第一個票種
  qty: 2,
  autoNext: true,
  autoRefresh: true,
  autoSeat: true,
};

// ---------- 時間 ----------

export function parseDateRange(str) {
  const m = String(str ?? '').match(/\d{4}-\d{2}-\d{2}/g);
  return m ? { start: m[0], end: m[m.length - 1] } : null;
}

export function parseTimeRange(str) {
  const m = String(str ?? '').match(/\d{1,2}:\d{2}/g);
  if (!m) return null;
  const pad = (t) => (t.length === 4 ? `0${t}` : t);
  return { start: pad(m[0]), end: pad(m[m.length - 1]) };
}

export function toEpoch(dateStr, timeStr) {
  if (!dateStr) return null;
  const ms = Date.parse(`${dateStr}T${timeStr ?? '00:00'}:00${TZ}`);
  return Number.isNaN(ms) ? null : ms;
}

export function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

export function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${d > 0 ? `${d}天 ` : ''}${hh}:${mm}:${ss}`;
}

export function formatDateTime(ms) {
  if (ms == null) return '未提供';
  const d = new Date(ms + 8 * 3600e3); // 以台灣時間顯示
  const p = (n) => String(n).padStart(2, '0');
  const wd = '日一二三四五六'[d.getUTCDay()];
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}(${wd}) ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function formatMinutes(min) {
  if (min % 1440 === 0) return `${min / 1440} 天`;
  if (min % 60 === 0) return `${min / 60} 小時`;
  return `${min} 分鐘`;
}

export function median(nums) {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

// 伺服器時間偏差樣本（毫秒）：server - local。Date 標頭解析度為 1 秒，取中點。
export function clockSample({ dateMs, ageSec = 0, t0, t1 }) {
  if (dateMs == null || Number.isNaN(dateMs)) return null;
  const server = dateMs + ageSec * 1000 + 500;
  const sample = server - (t0 + t1) / 2;
  return Math.abs(sample) > 10 * 60e3 ? null : Math.round(sample);
}

// ---------- 地點與分類 ----------

const CITY_RE = /(台北|新北|桃園|台中|台南|高雄|基隆|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|澎湖|金門|連江)(市|縣)?/;

export function cityOf(...texts) {
  for (const t of texts) {
    const a = String(t ?? '').replace(/臺/g, '台').replace(/\s/g, '');
    const m = a.match(CITY_RE);
    if (m) return m[1];
  }
  return '其他';
}

const CATEGORY_RULES = [
  ['音樂祭', /音樂祭|音樂節|音樂季|festival|\bfest\b/i],
  ['見面會', /見面會|fan\s?-?meeting|fanmeet|粉絲|簽名會|握手會|fan\s?con/i],
  ['舞台劇', /舞台劇|音樂劇|musical|歌劇|劇場|相聲|脫口秀|stand-?up|舞蹈|芭蕾|ballet|戲劇/i],
  ['演唱會', /演唱會|concert|world\s?tour|\btour\b|巡迴|巡演|one-?man|\blive\b|solo|發片|專場|演奏會|音樂會|showcase/i],
  ['課程講座', /課程|講座|工作坊|workshop|研習|培訓|大師班/i],
  ['展覽', /展覽|特展|\bexpo\b|exhibition|博覽會|市集/i],
];

// 票務平台沒有分類欄位；以標題關鍵字推測，UI 會標示「推測」。
export function classify(title) {
  const t = String(title ?? '');
  for (const [name, re] of CATEGORY_RULES) if (re.test(t)) return name;
  return '其他';
}

export const CATEGORIES = [...CATEGORY_RULES.map(([n]) => n), '其他'];

// ---------- 正規化 ----------

const uniq = (arr) => [...new Set(arr)];
const nums = (arr) => arr.filter((n) => typeof n === 'number' && Number.isFinite(n));
const minOf = (arr) => (arr.length ? Math.min(...arr) : null);
const maxOf = (arr) => (arr.length ? Math.max(...arr) : null);

export function normalizeSession(s) {
  const dr = parseDateRange(s.date);
  const tr = parseTimeRange(s.time);
  return {
    sessionId: s.sessionId,
    name: s.name ?? '',
    dateStart: dr?.start ?? null,
    dateEnd: dr?.end ?? null,
    timeStart: tr?.start ?? null,
    timeEnd: tr?.end ?? null,
    startsAt: dr ? toEpoch(dr.start, tr?.start) : null,
    endsOnMs: dr ? toEpoch(dr.end, '23:59') : null,
    venue: s.location ?? '',
    address: s.address ?? '',
    city: cityOf(s.address, s.location),
    hasSeatMap: !!s.ticketArea,
    saleStart: toMs(s.exposeStart),
    saleEnd: toMs(s.exposeEnd),
    hidden: !!s.hidden,
  };
}

export function normalizeProduct(p) {
  return {
    productId: p.productId,
    sessionId: p.sessionId ?? null,
    ticketAreaId: p.ticketAreaId ?? null,
    name: p.name ?? '',
    price: typeof p.price === 'number' ? p.price : null,
    hidden: !!p.hidden,
    saleStart: toMs(p.exposeStart),
    saleEnd: toMs(p.exposeEnd),
  };
}

export function normalizeArea(a) {
  return {
    ticketAreaId: a.ticketAreaId,
    sessionId: a.sessionId ?? null,
    name: a.name ?? '',
    price: typeof a.price === 'number' ? a.price : null,
    color: a.color ?? null,
    hidden: !!a.hidden,
    saleStart: toMs(a.exposeStart),
    saleEnd: toMs(a.exposeEnd),
  };
}

export function normalizeEvent({ eventId, main = {}, event = {}, sessions = [], products = [], areas = [], fetchedAt }) {
  const title = String(event.title || main.title || '').trim();
  const sess = sessions.filter((s) => s && !s.hidden).map(normalizeSession);
  const prods = products.filter((p) => p && !p.hidden).map(normalizeProduct);
  const ars = areas.filter((a) => a && !a.hidden).map(normalizeArea);

  const prices = nums([...prods.map((p) => p.price), ...(prods.length ? [] : ars.map((a) => a.price))]);
  const saleStarts = uniq(nums([...sess.map((s) => s.saleStart), ...prods.map((p) => p.saleStart), ...ars.map((a) => a.saleStart)])).sort((a, b) => a - b);
  const saleEnds = uniq(nums([...sess.map((s) => s.saleEnd), ...prods.map((p) => p.saleEnd), ...ars.map((a) => a.saleEnd)])).sort((a, b) => a - b);
  if (!saleStarts.length && toMs(main.exposeStart) != null) saleStarts.push(toMs(main.exposeStart));
  if (!saleEnds.length && toMs(main.exposeEnd) != null) saleEnds.push(toMs(main.exposeEnd));

  const organizers = Array.isArray(event.hosts) && event.hosts.length ? event.hosts : sessions.find((s) => s?.hosts?.length)?.hosts ?? [];

  return {
    eventId,
    title,
    category: classify(title),
    categoryInferred: true,
    organizers,
    sessions: sess,
    products: prods,
    areas: ars,
    dateStart: sess.map((s) => s.dateStart).filter(Boolean).sort()[0] ?? main.start_date ?? null,
    dateEnd: sess.map((s) => s.dateEnd).filter(Boolean).sort().pop() ?? main.end_date ?? null,
    startsAt: minOf(nums(sess.map((s) => s.startsAt))),
    endsOnMs: maxOf(nums(sess.map((s) => s.endsOnMs))),
    cities: uniq(sess.map((s) => s.city)),
    venues: uniq(sess.map((s) => s.venue).filter(Boolean)),
    hasSeatMap: sess.some((s) => s.hasSeatMap),
    priceMin: minOf(prices),
    priceMax: maxOf(prices),
    saleStarts,
    saleEnds,
    saleStart: saleStarts[0] ?? null,
    saleEnd: saleEnds.length ? saleEnds[saleEnds.length - 1] : null,
    image: pickImage(main, event),
    url: eventUrl(eventId),
    fetchedAt: fetchedAt ?? Date.now(),
  };
}

function pickImage(main, event) {
  const c = [main.picSmallHomeThumbnail, main.picBigHomeThumbnail, event.picSmallActiveThumbnail, event.picBigActiveThumbnail];
  return c.find((u) => typeof u === 'string' && u.startsWith('https://static.ticketplus.com.tw/')) ?? null;
}

// ---------- 售票狀態 ----------
// 注意：僅依「開賣／結束時間」判斷，公開資料沒有庫存，因此 onsale 不代表一定有票。

export function saleStatus(ev, now) {
  if (ev.endsOnMs != null && ev.endsOnMs < now) return 'past';
  const wins = ev.sessions?.length ? ev.sessions.map((s) => [s.saleStart, s.saleEnd]) : [[ev.saleStart, ev.saleEnd]];
  let onsale = false;
  let upcoming = false;
  let ended = false;
  for (const [st, en] of wins) {
    if (st == null) continue;
    if (now < st) upcoming = true;
    else if (en == null || now < en) onsale = true;
    else ended = true;
  }
  // 票種／票區可能分階段開賣（預售、一般）
  if (!onsale && !upcoming && !ended) return 'unknown';
  if (onsale) return 'onsale';
  if (upcoming) return 'upcoming';
  return 'ended';
}

export const STATUS_LABEL = {
  onsale: '販售期間內',
  upcoming: '尚未開賣',
  ended: '販售已結束',
  past: '演出已結束',
  unknown: '未提供',
};

// 產生可貼給別人的活動重點文字。opts：platform（平台名稱）、price（價格文字）、status（售票狀態文字）、now。
export function formatShareText(ev, { platform = '', price = '', status = '', now = Date.now() } = {}) {
  const venues = (ev.venues ?? []).slice(0, 2).join('、');
  const date = ev.dateStart ? (ev.dateStart === ev.dateEnd || !ev.dateEnd ? ev.dateStart : `${ev.dateStart} ~ ${ev.dateEnd}`) : '';
  const sale = nextSaleStart(ev, now) ?? ev.saleStart ?? null;
  const lines = [
    `🎫 ${ev.title}`,
    ev.category ? `🏷️ 類型：${ev.category}` : '',
    date ? `📅 演出：${date}` : '',
    venues ? `📍 地點：${venues}` : '',
    price ? `💰 票價：${price}` : '',
    sale != null ? `⏰ 開賣：${formatDateTime(sale)}` : '',
    status ? `📌 狀態：${status}` : '',
    platform ? `🛒 售票：${platform}` : '',
    ev.url ? `🔗 ${ev.url}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export function nextSaleStart(ev, now) {
  return (ev.saleStarts ?? []).find((t) => t > now) ?? null;
}

// ---------- 差異偵測 ----------

export function diffEvents(oldMap, newMap) {
  const added = [];
  const saleChanged = [];
  for (const [id, ev] of Object.entries(newMap)) {
    const prev = oldMap[id];
    if (!prev) {
      added.push(id);
      continue;
    }
    if (JSON.stringify(prev.saleStarts) !== JSON.stringify(ev.saleStarts)) {
      saleChanged.push({ id, from: prev.saleStarts, to: ev.saleStarts });
    }
  }
  return { added, saleChanged };
}

export function matchesKeywords(title, keywords) {
  const t = String(title ?? '').toLowerCase();
  return (keywords ?? []).some((k) => k && t.includes(String(k).trim().toLowerCase()));
}

// ---------- 提醒規劃 ----------
// items: { [id]: { title, saleStarts:number[] } }（含手動追蹤）
// favorites: { [id]: { reminders:[{id,type:'beforeSale',minutes}|{id,type:'at',at}], autoOpen } }
// now / offsetMs：offsetMs = 伺服器時間 - 本機時間；排程使用本機時間，所以 when = serverTime - offset。

export function planAlarms({ items, favorites, now, offsetMs = 0, openLeadSec = 60 }) {
  const out = [];
  const serverNow = now + offsetMs;
  for (const [id, fav] of Object.entries(favorites)) {
    const item = items[id];
    const starts = (item?.saleStarts ?? []).filter((t) => t > serverNow);
    for (const r of fav.reminders ?? []) {
      if (r.type === 'beforeSale') {
        for (const T of starts) {
          const fireAt = T - r.minutes * 60e3;
          if (fireAt > serverNow) out.push({ name: `rem|${id}|${r.id}|${T}`, when: fireAt - offsetMs });
        }
      } else if (r.type === 'at' && r.at > now) {
        out.push({ name: `rem|${id}|${r.id}|${r.at}`, when: r.at });
      }
    }
    if (fav.autoOpen) {
      for (const T of starts) {
        const fireAt = T - openLeadSec * 1000;
        if (fireAt > serverNow) out.push({ name: `open|${id}|${T}`, when: fireAt - offsetMs });
      }
    }
  }
  return out;
}

export function parseAlarmName(name) {
  const [kind, id, a, b] = String(name).split('|');
  if (kind === 'rem') return { kind, id, reminderId: a, target: Number(b) };
  if (kind === 'open') return { kind, id, target: Number(a) };
  return { kind };
}

// ---------- ICS ----------

const icsDate = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsEscape = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export function foldLine(line) {
  const enc = new TextEncoder();
  let out = '';
  let cur = '';
  let bytes = 0;
  let first = true;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (first ? 75 : 74)) {
      out += `${cur}\r\n `;
      cur = '';
      bytes = 0;
      first = false;
    }
    cur += ch;
    bytes += b;
  }
  return out + cur;
}

export function buildIcs(items, { now = Date.now() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ticketplus-assist//TW//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const it of items) {
    lines.push('BEGIN:VEVENT', `UID:${it.uid}`, `DTSTAMP:${icsDate(now)}`, `DTSTART:${icsDate(it.startMs)}`, `DTEND:${icsDate(it.startMs + (it.durationMin ?? 30) * 60e3)}`, `SUMMARY:${icsEscape(it.summary)}`);
    if (it.description) lines.push(`DESCRIPTION:${icsEscape(it.description)}`);
    if (it.url) lines.push(`URL:${it.url}`);
    for (const m of it.alarmsMin ?? []) {
      lines.push('BEGIN:VALARM', `TRIGGER:-PT${m}M`, 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(it.summary)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

// ---------- 購票輔助：偏好比對（純函式） ----------

export const SOLD_OUT_RE = /售完|已售完|完售|sold\s?out|無法購買|暫無|已結束|已截止|無票|額滿/i;
export const isSoldOutText = (t) => SOLD_OUT_RE.test(String(t ?? ''));

export function dateFromText(text) {
  const m = String(text ?? '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// rows: [{ date:'YYYY-MM-DD', soldOut:boolean, ... }]
export function pickSession(rows, prefs) {
  const ok = rows.filter((r) => !r.soldOut);
  const dates = prefs?.sessionDates ?? [];
  if (!dates.length) return ok[0] ?? null;
  for (const d of dates) {
    const hit = ok.find((r) => r.date === d);
    if (hit) return hit;
  }
  return null;
}

// areas: [{ name, soldOut }]；回傳 { area, rank } 或 null
export function pickArea(areas, prefs) {
  const ok = areas.filter((a) => !a.soldOut);
  const order = prefs?.areaOrder ?? [];
  for (let i = 0; i < order.length; i++) {
    const want = order[i].trim();
    if (!want) continue;
    const hit = ok.find((a) => a.name.trim() === want) ?? ok.find((a) => a.name.includes(want));
    if (hit) return { area: hit, rank: i };
  }
  if (prefs?.areaFallback === 'any' && ok.length) return { area: ok[0], rank: -1 };
  return null;
}

// rows: boolean[][]（true = 可選），回傳 { row, start } 或 null；依列順序優先。
export function findConsecutive(rows, qty) {
  if (!(qty >= 1)) return null;
  for (let r = 0; r < rows.length; r++) {
    let run = 0;
    for (let c = 0; c < rows[r].length; c++) {
      run = rows[r][c] ? run + 1 : 0;
      if (run >= qty) return { row: r, start: c - qty + 1 };
    }
  }
  return null;
}

// ---------- 其他 ----------

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function eventIdFromUrl(url) {
  const m = String(url ?? '').match(/ticketplus\.com\.tw\/(?:activity|seat|order|confirmSeat|confirm|checkout)\/([0-9a-f]{32})/i);
  return m ? m[1].toLowerCase() : null;
}

export function routeOf(pathname) {
  const m = String(pathname).match(/^\/(activity|seat|confirmSeat|order|confirm|checkout|done)\/([^/]+)(?:\/([^/]+))?/);
  return m ? { step: m[1], id: m[2], sessionId: m[3] ?? null } : null;
}

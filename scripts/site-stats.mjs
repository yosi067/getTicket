// 由活動快照統計「現況分析」：類型、月份、場館、地區、平台，以及各種交叉比對。
// 純函式、無 I/O、無 import；建置時會把 export 去掉後內嵌到首頁，所以 Node 與瀏覽器共用同一份。
const PLATFORM_NAMES = { ticketplus: 'Ticket Plus', tixcraft: '拓元', kktix: 'KKTIX', opentix: 'OPENTIX' };
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const SCOPES = {
  all: null,
  show: new Set(['演唱會', '音樂祭', '舞台劇', '見面會']),
  music: new Set(['演唱會', '音樂祭']),
};
const TW = 8 * 3600e3;

const normVenue = (v) => String(v ?? '').replace(/臺/g, '台').replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, ' ').trim();
const isHttp = (u) => /^https?:\/\//i.test(u ?? '');

// 把完整活動縮成統計用的精簡列（也是首頁內嵌的資料格式）
export function toRows(events) {
  return events.map((e) => {
    const d = e.dateStart || '';
    const s = (e.saleStarts ?? [])[0] ?? e.saleStart ?? null;
    const hi = e.priceMax > 0 ? e.priceMax : null;
    const lo = e.priceMin > 0 ? e.priceMin : hi;
    const venue = normVenue((e.venues ?? [])[0]);
    return {
      c: e.category || '其他',
      p: e.platform ?? 'ticketplus',
      m: /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null,
      d: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null,
      w: /^\d{4}-\d{2}-\d{2}$/.test(d) ? (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7 : null,
      v: venue || null,
      y: (e.cities ?? [])[0] || '其他',
      lo, hi,
      s: s ?? null,
      i: e.categoryInferred ? 1 : 0,
    };
  });
}

export const platformName = (k) => PLATFORM_NAMES[k] ?? k;
export const WEEKDAY_LABELS = WEEKDAYS;

// f：{ scope, c, y, p, m, v }
export function applyFilter(rows, f = {}) {
  const set = SCOPES[f.scope ?? 'all'];
  return rows.filter((r) => (!set || set.has(r.c))
    && (!f.c || r.c === f.c) && (!f.y || r.y === f.y) && (!f.p || r.p === f.p)
    && (!f.m || r.m === f.m) && (!f.v || r.v === f.v));
}

export function tally(rows, key, { limit = Infinity, skipNull = true } = {}) {
  const m = new Map();
  for (const r of rows) {
    const v = typeof key === 'function' ? key(r) : r[key];
    if (v == null && skipNull) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'zh-Hant')).slice(0, limit);
}

export const byMonth = (rows) => tally(rows, 'm').sort((a, b) => a[0].localeCompare(b[0]));
export const byWeekday = (rows) => {
  const n = Array(7).fill(0);
  for (const r of rows) if (r.w != null) n[r.w]++;
  return WEEKDAYS.map((l, i) => [l, n[i]]);
};

// 交叉表：rk 為列、ck 為欄；各取數量最多的前幾名（月份固定依時間排序）
export function cross(rows, rk, ck, { rowLimit = 8, colLimit = 8 } = {}) {
  const order = (key, limit) => {
    const t = tally(rows, key);
    const top = t.slice(0, limit).map((x) => x[0]);
    return key === 'm' || key === 'w' ? top.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : top;
  };
  const rl = order(rk, rowLimit);
  const cl = order(ck, colLimit);
  const ri = new Map(rl.map((x, i) => [x, i]));
  const ci = new Map(cl.map((x, i) => [x, i]));
  const cells = rl.map(() => cl.map(() => 0));
  for (const r of rows) {
    const i = ri.get(r[rk]);
    const j = ci.get(r[ck]);
    if (i != null && j != null) cells[i][j]++;
  }
  return { rows: rl, cols: cl, cells, max: Math.max(1, ...cells.flat()) };
}

export const PRICE_BANDS = [
  ['< 1,000', 0, 1000], ['1,000–1,999', 1000, 2000], ['2,000–3,499', 2000, 3500], ['3,500–4,999', 3500, 5000], ['5,000 以上', 5000, Infinity],
];
export function priceBands(rows) {
  const out = PRICE_BANDS.map(([label]) => [label, 0]);
  let none = 0;
  for (const r of rows) {
    if (r.hi == null) { none++; continue; }
    const i = PRICE_BANDS.findIndex(([, lo, hi]) => r.hi >= lo && r.hi < hi);
    if (i >= 0) out[i][1]++;
  }
  out.push(['未公布', none]);
  return out;
}

// 開賣時段（台灣時間的整點）
export function saleHours(rows) {
  const n = Array(24).fill(0);
  for (const r of rows) if (r.s != null) n[new Date(r.s + TW).getUTCHours()]++;
  return n.map((v, h) => [h, v]);
}

export const median = (a) => {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

// 開賣到演出的提前天數中位數（依分組欄位）
export function leadDays(rows, key) {
  const g = new Map();
  for (const r of rows) {
    if (r.s == null || !r.d) continue;
    const days = (Date.parse(`${r.d}T00:00:00+08:00`) - r.s) / 86400e3;
    if (days < 0 || days > 730) continue;
    const k = r[key];
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(days);
  }
  return [...g].map(([k, a]) => [k, Math.round(median(a)), a.length]).sort((a, b) => b[2] - a[2]);
}

// 票價中位數（以最高票價計，依分組欄位）
export function medianPrice(rows, key, minCount = 3) {
  const g = new Map();
  for (const r of rows) {
    if (r.hi == null) continue;
    if (!g.has(r[key])) g.set(r[key], []);
    g.get(r[key]).push(r.hi);
  }
  return [...g].filter(([, a]) => a.length >= minCount).map(([k, a]) => [k, Math.round(median(a)), a.length]).sort((a, b) => b[1] - a[1]);
}

// 同一天演出最多的日期（撞期）
export function hotDates(rows, limit = 6) {
  return tally(rows, 'd').filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

// 資料完整度（對應課程 Day 2 的資料品質檢核）；回傳 0–100
export function quality(rows) {
  const n = rows.length || 1;
  const pct = (f) => Math.round((rows.filter(f).length / n) * 100);
  return {
    n: rows.length,
    price: pct((r) => r.hi != null),
    venue: pct((r) => r.v != null),
    sale: pct((r) => r.s != null),
    date: pct((r) => r.d != null),
    category: pct((r) => !r.i),
  };
}
export const qualityByPlatform = (rows) => tally(rows, 'p').map(([p]) => [p, quality(rows.filter((r) => r.p === p))]);

const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// 自動產生幾句白話結論
export function insights(rows) {
  const out = [];
  if (!rows.length) return out;
  const cat = tally(rows, 'c');
  const city = tally(rows, 'y').filter(([k]) => k !== '其他');
  const venue = tally(rows, 'v', { limit: 1 });
  const months = tally(rows, 'm');
  const wk = byWeekday(rows);
  const wkTotal = wk.reduce((s, x) => s + x[1], 0);
  const weekend = wk[4][1] + wk[5][1] + wk[6][1];
  const hours = saleHours(rows).sort((a, b) => b[1] - a[1]);
  const hot = hotDates(rows, 1);
  const price = priceBands(rows).filter(([l]) => l !== '未公布').sort((a, b) => b[1] - a[1]);
  if (cat[0]) out.push(`最多的類型是「${cat[0][0]}」，占 ${pctOf(cat[0][1], rows.length)}%（${cat[0][1]} 場）。`);
  if (city[0]) out.push(`${city[0][0]}最集中，占有地區資料活動的 ${pctOf(city[0][1], city.reduce((s, x) => s + x[1], 0))}%。`);
  if (venue[0]) out.push(`場館以「${venue[0][0]}」最多，共 ${venue[0][1]} 場。`);
  if (months[0]) out.push(`演出最密集的月份是 ${months[0][0]}，有 ${months[0][1]} 場。`);
  if (wkTotal) out.push(`週五到週日合計占 ${pctOf(weekend, wkTotal)}% 的演出日。`);
  if (hours[0] && hours[0][1] > 0) out.push(`最常見的開賣時間是 ${String(hours[0][0]).padStart(2, '0')}:00（${hours[0][1]} 場），要搶票先把鬧鐘設好。`);
  if (hot[0]) out.push(`${hot[0][0]} 同一天有 ${hot[0][1]} 場演出，是最容易撞期的日子。`);
  if (price[0] && price[0][1] > 0) out.push(`最高票價落在「${price[0][0]}」的活動最多（${price[0][1]} 場）。`);
  return out;
}

// 即將開賣的表演類活動（伺服端使用，輸出給首頁跑馬燈與倒數）
export function upcomingSales(events, now, limit = 10) {
  return events
    .filter((e) => SCOPES.show.has(e.category))
    .map((e) => ({ e, t: (e.saleStarts ?? []).filter((x) => x > now).sort((a, b) => a - b)[0] }))
    .filter((x) => x.t != null)
    .sort((a, b) => a.t - b.t)
    .slice(0, limit)
    .map(({ e, t }) => ({
      title: e.title,
      platform: platformName(e.platform ?? 'ticketplus'),
      venue: (e.venues ?? [])[0] ?? '',
      saleStart: t,
      url: isHttp(e.url) ? e.url : '',
    }));
}

// 最近已開賣的表演類活動（沒有未來開賣時，首頁當備援顯示）
export function recentSales(events, now, limit = 10) {
  return events
    .filter((e) => SCOPES.show.has(e.category))
    .map((e) => ({ e, t: (e.saleStarts ?? []).filter((x) => x <= now).sort((a, b) => b - a)[0] }))
    .filter((x) => x.t != null)
    .sort((a, b) => b.t - a.t)
    .slice(0, limit)
    .map(({ e, t }) => ({
      title: e.title,
      platform: platformName(e.platform ?? 'ticketplus'),
      venue: (e.venues ?? [])[0] ?? '',
      saleStart: t,
      url: isHttp(e.url) ? e.url : '',
    }));
}

// 讀取 ticketplus 公開的靜態 JSON（與其網站前端使用的相同來源）。
import { clockSample, mapLimit, normalizeEvent } from './lib.js';

const BASE = 'https://apis.ticketplus.com.tw/config/api/v1/getS3?path=';

export class ApiError extends Error {
  constructor(message, path, code) {
    super(`${path}: ${message}`);
    this.path = path;
    this.code = code;
  }
}

export async function fetchStatic(path, { signal } = {}) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, { signal, cache: 'no-store' });
  const t1 = Date.now();
  if (!res.ok) throw new ApiError(`HTTP ${res.status}`, path, res.status);
  const data = await res.json();
  if (data && typeof data === 'object' && data.errCode && data.errCode !== '00') {
    throw new ApiError(`${data.errCode} ${data.errMsg ?? ''}`.trim(), path, data.errCode);
  }
  const clock = clockSample({
    dateMs: Date.parse(res.headers.get('date') ?? ''),
    ageSec: Number(res.headers.get('age') ?? 0) || 0,
    t0,
    t1,
  });
  return { data, clock };
}

// 選用檔案不存在（errCode 102）時回傳 null
async function optional(path) {
  try {
    return (await fetchStatic(path)).data;
  } catch (e) {
    if (e instanceof ApiError && (e.code === '102' || e.code === 404)) return null;
    throw e;
  }
}

export async function fetchMainEvents() {
  const { data, clock } = await fetchStatic('main/mainEvents.json');
  const info = data?.allEventMainPageInfo;
  if (!info || typeof info !== 'object') throw new ApiError('回應缺少 allEventMainPageInfo（網站格式可能已變更）', 'main/mainEvents.json');
  const ids = [...new Set([...(data.allEventId ?? []), ...Object.keys(info)])];
  return { info, ids, clock };
}

export async function fetchEventDetail(eventId, main, fetchedAt = Date.now()) {
  const [event, sessions, products] = await Promise.all([
    fetchStatic(`event/${eventId}/event.json`).then((r) => r.data),
    optional(`event/${eventId}/sessions.json`),
    optional(`event/${eventId}/products.json`),
  ]);
  const sessionList = sessions?.sessions ?? [];
  const areas = sessionList.some((s) => s.ticketArea) ? ((await optional(`event/${eventId}/ticketAreas.json`))?.ticketAreas ?? []) : [];
  return normalizeEvent({ eventId, main, event, sessions: sessionList, products: products?.products ?? [], areas, fetchedAt });
}

export { mapLimit };

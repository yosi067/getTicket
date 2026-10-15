// 一次取得全部平台（Ticket Plus、KKTIX、拓元、OPENTIX）的正規化活動。
// snapshot.mjs（產生快照）與 serve.mjs（網頁「重新抓取」）共用，避免兩邊各寫一份。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchEventDetail, fetchMainEvents } from '../extension/shared/api.js';
import { mapLimit } from '../extension/shared/lib.js';
import { ADAPTERS, fetchAllSources } from './sources.mjs';

export const ALL_KEYS = ['ticketplus', ...Object.keys(ADAPTERS)];

async function fetchTicketplus(fetchedAt, log) {
  const { info, ids } = await fetchMainEvents();
  log?.(`Ticket Plus 活動數：${ids.length}`);
  let failed = 0;
  const events = (
    await mapLimit(ids, 4, async (id) => {
      try { return await fetchEventDetail(id, info[id], fetchedAt); } catch (e) { failed++; log?.(`略過 ${id}：${e.message}`); return null; }
    })
  ).filter(Boolean).map((e) => ({ ...e, platform: 'ticketplus' }));
  return { events, failed };
}

// only：要更新的平台鍵（預設全部）。各平台獨立，任一失敗不影響其他。
export async function collectAll({ only = ALL_KEYS, log } = {}) {
  const fetchedAt = Date.now();
  const sources = {};
  const events = [];
  if (only.includes('ticketplus')) {
    try {
      const r = await fetchTicketplus(fetchedAt, log);
      sources.ticketplus = { ok: true, count: r.events.length, failed: r.failed, fetchedAt };
      events.push(...r.events);
    } catch (e) {
      sources.ticketplus = { ok: false, count: 0, error: String(e.message ?? e), fetchedAt };
    }
  }
  const others = await fetchAllSources(only.filter((k) => k in ADAPTERS));
  Object.assign(sources, others.sources);
  events.push(...others.events);
  return { fetchedAt, sources, events };
}

// 抓取並寫入 demo/data/snapshot.json；沒更新成功的平台沿用舊資料。
// snapshot.mjs（指令）與 serve.mjs（網頁按鈕）共用。回傳完整合併後的快照內容。
export const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'data', 'snapshot.json');

export async function updateSnapshot({ only = ALL_KEYS, log } = {}) {
  let prev = null;
  try { prev = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8')); } catch { /* 第一次執行沒有舊快照 */ }
  const { fetchedAt, sources, events: fresh } = await collectAll({ only, log });
  for (const [k, v] of Object.entries(sources)) log?.(`${k}：${v.ok ? `${v.count} 筆` : `失敗（${v.error}）`}`);

  const updated = new Set(Object.entries(sources).filter(([, v]) => v.ok).map(([k]) => k));
  const carried = prev ? prev.events.filter((e) => !updated.has(e.platform ?? 'ticketplus')).map((e) => ({ ...e, platform: e.platform ?? 'ticketplus' })) : [];
  if (carried.length) log?.(`沿用舊資料 ${carried.length} 筆`);
  for (const [k, v] of Object.entries(prev?.sources ?? {})) if (!(k in sources)) sources[k] = v;

  const events = [...fresh, ...carried];
  if (!updated.size || !events.length) throw new Error('所有平台都抓取失敗，未覆寫快照');
  const snap = { fetchedAt, source: 'multi', sources, events };
  await mkdir(dirname(SNAPSHOT_PATH), { recursive: true });
  await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snap)}\n`);
  return { ...snap, updated: [...updated], carried: carried.length };
}

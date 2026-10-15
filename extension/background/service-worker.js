import { fetchEventDetail, fetchMainEvents } from '../shared/api.js';
import { allItems, load, save } from '../shared/store.js';
import { diffEvents, eventUrl, formatDateTime, formatMinutes, mapLimit, matchesKeywords, median, parseAlarmName, planAlarms } from '../shared/lib.js';

const DASHBOARD = 'dashboard/index.html';
const DETAIL_MAX_AGE_MS = 3 * 3600e3;
const ICON = 'icons/icon128.png';
let refreshing = null;

// ---------- 通知 ----------

function notify(kind, id, title, message) {
  chrome.notifications.create(`${kind}|${id}|${Date.now()}`, {
    type: 'basic',
    iconUrl: ICON,
    title,
    message,
    priority: 2,
    requireInteraction: true,
    buttons: [{ title: '前往購票頁' }],
  });
}

async function urlFor(id) {
  const st = await load();
  const m = st.manual[id];
  if (m?.url && /^https:\/\//.test(m.url)) return m.url;
  return /^[0-9a-f]{32}$/.test(id) ? eventUrl(id) : chrome.runtime.getURL(DASHBOARD);
}

async function openEvent(id) {
  const url = await urlFor(id);
  const tabs = await chrome.tabs.query({ url: `${url.split('?')[0]}*` });
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

function humanLeft(ms) {
  const sec = Math.round(ms / 1000);
  return sec < 90 ? `${Math.max(sec, 0)} 秒` : formatMinutes(Math.round(sec / 60));
}

// ---------- 抓取 ----------

async function refreshAll({ force = false } = {}) {
  if (refreshing) return refreshing;
  refreshing = doRefresh(force).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function doRefresh(force) {
  const st = await load();
  const startedAt = Date.now();
  let main;
  try {
    main = await fetchMainEvents();
  } catch (e) {
    await save({ meta: { ...st.meta, lastAttemptAt: startedAt, lastError: String(e.message ?? e) } });
    return { ok: false, error: String(e.message ?? e) };
  }

  const sigs = { ...(st.meta.sigs ?? {}) };
  const errors = [];
  const next = {};
  await mapLimit(main.ids, 4, async (id) => {
    const info = main.info[id] ?? {};
    const sig = JSON.stringify([info.title, info.exposeStart, info.exposeEnd, info.hidden]);
    const prev = st.events[id];
    const stale = !prev || force || sigs[id] !== sig || startedAt - (prev.fetchedAt ?? 0) > (st.favorites[id] ? 0 : DETAIL_MAX_AGE_MS);
    if (!stale) {
      next[id] = prev;
      return;
    }
    try {
      next[id] = await fetchEventDetail(id, info, startedAt);
      sigs[id] = sig;
    } catch (e) {
      errors.push(String(e.message ?? e));
      if (prev) next[id] = prev; // 保留舊資料，不顯示錯誤資料
    }
  });

  for (const id of Object.keys(sigs)) if (!main.ids.includes(id)) delete sigs[id];
  // 收藏中的活動若已下架，保留並標記
  for (const id of Object.keys(st.favorites)) if (!next[id] && st.events[id]) next[id] = { ...st.events[id], delisted: true };

  const samples = [...(st.meta.clockSamples ?? []), ...(main.clock != null ? [main.clock] : [])].slice(-5);
  const meta = {
    ...st.meta,
    sigs,
    lastAttemptAt: startedAt,
    lastSuccessAt: Date.now(),
    lastError: errors.length ? `${errors.length} 筆活動更新失敗（沿用舊資料）：${errors[0]}` : null,
    clockSamples: samples,
    clockOffsetMs: samples.length ? median(samples) : (st.meta.clockOffsetMs ?? 0),
    listedCount: main.ids.length,
  };
  await save({ events: next, meta });
  if (Object.keys(st.events).length) await notifyChanges(st, next);
  await reschedule();
  return { ok: true, count: Object.keys(next).length, errors: errors.length };
}

async function notifyChanges(st, next) {
  const { added, saleChanged } = diffEvents(st.events, next);
  const fresh = [];
  for (const id of added) {
    const ev = next[id];
    if (st.favorites[id]) notify('listed', id, '追蹤的活動已上架', `「${ev.title}」已出現在售票清單。`);
    else if (matchesKeywords(ev.title, st.settings.watchKeywords)) notify('keyword', id, '關鍵字符合的新活動', ev.title);
    else fresh.push(ev);
  }
  if (st.settings.notifyNewEvents && fresh.length) {
    const names = fresh.slice(0, 3).map((e) => `・${e.title}`).join('\n');
    notify('new', fresh[0].eventId, `新增 ${fresh.length} 場活動`, `${names}${fresh.length > 3 ? '\n…' : ''}`);
  }
  for (const c of saleChanged) {
    if (!st.favorites[c.id]) continue;
    const fmt = (a) => (a.length ? a.map(formatDateTime).join('、') : '未提供');
    notify('changed', c.id, '開賣時間變更', `「${next[c.id].title}」\n原：${fmt(c.from)}\n新：${fmt(c.to)}`);
  }
}

// ---------- 排程 ----------

async function reschedule() {
  const st = await load();
  const plan = planAlarms({
    items: allItems(st),
    favorites: st.favorites,
    now: Date.now(),
    offsetMs: st.meta.clockOffsetMs ?? 0,
    openLeadSec: st.settings.openLeadSec,
  });
  const wanted = new Map(plan.map((p) => [p.name, p.when]));
  const existing = await chrome.alarms.getAll();
  const have = new Map(existing.map((a) => [a.name, a.scheduledTime]));
  for (const a of existing) {
    if ((a.name.startsWith('rem|') || a.name.startsWith('open|')) && !wanted.has(a.name)) await chrome.alarms.clear(a.name);
  }
  for (const p of plan) {
    if (Math.abs((have.get(p.name) ?? 0) - p.when) > 1000) await chrome.alarms.create(p.name, { when: p.when });
  }
}

async function ensureRefreshAlarm() {
  const { settings } = await load();
  const period = Math.max(15, Number(settings.refreshMinutes) || 30);
  const cur = await chrome.alarms.get('refresh');
  if (!cur || cur.periodInMinutes !== period) await chrome.alarms.create('refresh', { delayInMinutes: 1, periodInMinutes: period });
}

async function onAlarm(name) {
  if (name === 'refresh') return void (await refreshAll());
  const a = parseAlarmName(name);
  if (!a.id) return;
  const st = await load();
  const item = allItems(st)[a.id];
  const title = item?.title ?? '追蹤的活動';
  const serverNow = Date.now() + (st.meta.clockOffsetMs ?? 0);
  if (a.kind === 'open') return void (await openEvent(a.id));
  if (a.kind === 'rem') {
    const fav = st.favorites[a.id];
    const r = fav?.reminders?.find((x) => x.id === a.reminderId);
    if (!fav || !r) return;
    const next = (item?.saleStarts ?? []).find((t) => t > serverNow - 5000);
    let msg;
    if (r.type === 'beforeSale') {
      const left = a.target - serverNow;
      msg = left > 5000 ? `「${title}」將於 ${formatDateTime(a.target)} 開賣，還有約 ${humanLeft(left)}。` : `「${title}」開賣了！`;
    } else {
      msg = next ? `「${title}」提醒時間到。下一次開賣：${formatDateTime(next)}（還有約 ${humanLeft(next - serverNow)}）。` : `「${title}」提醒時間到。`;
    }
    notify('rem', a.id, '購票提醒', msg);
  }
}

// ---------- 事件 ----------

chrome.alarms.onAlarm.addListener((alarm) => void onAlarm(alarm.name));

chrome.runtime.onInstalled.addListener(async () => {
  await ensureRefreshAlarm();
  await refreshAll();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureRefreshAlarm();
  const { meta, settings } = await load();
  if (Date.now() - (meta.lastSuccessAt ?? 0) > settings.refreshMinutes * 60e3) await refreshAll();
  await reschedule();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'refresh') {
    refreshAll({ force: !!msg.force }).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});

let debounce;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) void ensureRefreshAlarm();
  if (changes.favorites || changes.manual || changes.settings) {
    clearTimeout(debounce);
    debounce = setTimeout(() => void reschedule(), 300);
  }
});

chrome.notifications.onClicked.addListener((nid) => {
  const id = nid.split('|')[1];
  void openEvent(id);
  chrome.notifications.clear(nid);
});
chrome.notifications.onButtonClicked.addListener((nid) => {
  const id = nid.split('|')[1];
  void openEvent(id);
  chrome.notifications.clear(nid);
});

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL(DASHBOARD);
  const tabs = await chrome.tabs.query({ url });
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

import { DEFAULT_ASSIST, DEFAULT_SETTINGS } from './lib.js';

const area = chrome.storage.local;

export async function load() {
  const s = await area.get(['events', 'meta', 'settings', 'favorites', 'manual']);
  return {
    events: s.events ?? {},
    meta: s.meta ?? {},
    settings: { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) },
    favorites: s.favorites ?? {},
    manual: s.manual ?? {},
  };
}

export const save = (patch) => area.set(patch);

// 事件資料 + 手動追蹤合併：真實活動資料優先
export function allItems({ events, manual }) {
  const items = {};
  for (const [id, m] of Object.entries(manual)) items[id] = { eventId: id, title: m.title, saleStarts: m.saleStarts, url: m.url, manual: true };
  for (const [id, ev] of Object.entries(events)) items[id] = ev;
  return items;
}

export function newFavorite(settings = DEFAULT_SETTINGS) {
  return {
    addedAt: Date.now(),
    reminders: settings.defaultReminders.map((minutes) => ({ id: `d${minutes}`, type: 'beforeSale', minutes })),
    autoOpen: false,
    assist: { ...DEFAULT_ASSIST },
  };
}

export const uid = () => Math.random().toString(36).slice(2, 10);

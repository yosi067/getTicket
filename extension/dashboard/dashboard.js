import { allItems, load, newFavorite, save, uid } from '../shared/store.js';
import {
  CATEGORIES, DEFAULT_ASSIST, STATUS_LABEL, buildIcs, eventIdFromUrl, formatCountdown, formatDateTime, formatMinutes, nextSaleStart, saleStatus,
} from '../shared/lib.js';

let S = { events: {}, meta: {}, settings: {}, favorites: {}, manual: {} };
const defaultFilters = () => ({ q: '', cats: [], city: '', status: Object.keys(STATUS_LABEL).filter((k) => k !== 'past'), from: '', to: '', maxPrice: '', seat: 'any' });
const UI_KEY = 'ui.v2';
const saved = (() => { try { return JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') ?? {}; } catch { return {}; } })();
const ui = {
  tab: ['all', 'fav', 'settings'].includes(saved.tab) ? saved.tab : 'all',
  view: saved.view === 'list' ? 'list' : 'cards',
  sort: ['start', 'sale', 'recent', 'price'].includes(saved.sort) ? saved.sort : 'start',
  filters: { ...defaultFilters(), ...(saved.filters ?? {}) },
};
if (!Array.isArray(ui.filters.status)) ui.filters.status = defaultFilters().status;
if (!Array.isArray(ui.filters.cats)) ui.filters.cats = [];
localStorage.removeItem('ui');
const persistUi = () => localStorage.setItem(UI_KEY, JSON.stringify(ui));
const $ = (sel) => document.querySelector(sel);
const nowMs = () => Date.now() + (S.meta.clockOffsetMs ?? 0);
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'for' || k === 'list') el.setAttribute(k, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

// ---------- 資料 ----------

async function reload() {
  S = await load();
  render();
}

function items() {
  return allItems(S);
}

// ---------- 篩選 ----------

function matches(ev) {
  const f = ui.filters;
  const status = saleStatus(ev, nowMs());
  if (!f.status.includes(status)) return false;
  if (f.q) {
    const hay = `${ev.title} ${ev.organizers.join(' ')} ${ev.venues.join(' ')} ${ev.cities.join(' ')}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t))) return false;
  }
  if (f.cats.length && !f.cats.includes(ev.category)) return false;
  if (f.city && !ev.cities.includes(f.city)) return false;
  if (f.from && (ev.dateEnd ?? '9999') < f.from) return false;
  if (f.to && (ev.dateStart ?? '0000') > f.to) return false;
  if (f.maxPrice !== '' && !(ev.priceMin != null && ev.priceMin <= Number(f.maxPrice))) return false;
  if (f.seat === 'yes' && !ev.hasSeatMap) return false;
  if (f.seat === 'no' && ev.hasSeatMap) return false;
  return true;
}

const num = (v, d) => (v == null ? d : v);
const SORTS = {
  start: (a, b) => num(a.startsAt, Infinity) - num(b.startsAt, Infinity),
  sale: (a, b) => num(nextSaleStart(a, nowMs()), Infinity) - num(nextSaleStart(b, nowMs()), Infinity) || num(a.startsAt, Infinity) - num(b.startsAt, Infinity),
  recent: (a, b) => num(b.saleStart, 0) - num(a.saleStart, 0),
  price: (a, b) => num(a.priceMin, Infinity) - num(b.priceMin, Infinity),
};

// ---------- 畫面元件 ----------

function priceText(ev) {
  if (ev.priceMin == null) return '票價未提供';
  return ev.priceMin === ev.priceMax ? `NT$ ${ev.priceMin.toLocaleString()}` : `NT$ ${ev.priceMin.toLocaleString()} ~ ${ev.priceMax.toLocaleString()}`;
}

function saleLine(ev) {
  const t = nowMs();
  const next = nextSaleStart(ev, t);
  if (next) return h('div', { class: 'meta' }, '下次開賣：', formatDateTime(next), ' · ', h('span', { class: 'countdown', dataset: { countdown: next } }));
  return h('div', { class: 'meta' }, `開賣：${formatDateTime(ev.saleStart)}`, ` ／ 結束：${formatDateTime(ev.saleEnd)}`);
}

function detailsBlock(ev) {
  const sessions = ev.sessions.map((s) =>
    h('tr', {}, h('td', {}, s.dateStart === s.dateEnd || !s.dateEnd ? s.dateStart : `${s.dateStart} ~ ${s.dateEnd}`, ' ', s.timeStart ?? '時間未提供'),
      h('td', {}, s.venue, h('br'), h('span', { class: 'meta' }, s.address)),
      h('td', {}, formatDateTime(s.saleStart)),
      h('td', {}, formatDateTime(s.saleEnd)),
      h('td', {}, s.hasSeatMap ? '劃位' : '一般')));
  const prods = ev.products.slice(0, 30).map((p) => h('tr', {}, h('td', {}, p.name), h('td', {}, p.price == null ? '—' : `NT$ ${p.price.toLocaleString()}`), h('td', {}, formatDateTime(p.saleStart))));
  const areas = ev.areas.length ? h('div', { class: 'meta' }, '票區：', [...new Set(ev.areas.map((a) => `${a.name}${a.price != null ? `(${a.price})` : ''}`))].join('、')) : null;
  return h('details', {}, h('summary', {}, '場次與票價'),
    h('table', {}, h('tr', {}, h('th', {}, '場次'), h('th', {}, '場館'), h('th', {}, '開賣'), h('th', {}, '結束'), h('th', {}, '型態')), sessions),
    prods.length ? h('table', {}, h('tr', {}, h('th', {}, '票種'), h('th', {}, '價格'), h('th', {}, '開賣')), prods) : null,
    areas);
}

function eventCard(ev) {
  const status = saleStatus(ev, nowMs());
  const fav = !!S.favorites[ev.eventId];
  const img = ev.image ? h('img', { class: 'thumb', src: ev.image, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }) : h('div', { class: 'thumb' });
  return h('article', { class: 'card' }, img,
    h('div', { class: 'body' },
      h('div', { class: 'badges' },
        h('span', { class: `badge ${status}` }, STATUS_LABEL[status]),
        h('span', { class: 'badge', title: '依標題關鍵字推測' }, `${ev.category}（推測）`),
        ev.hasSeatMap ? h('span', { class: 'badge' }, '劃位') : null),
      h('h3', {}, ev.title),
      h('div', { class: 'meta' }, ev.sessions.length ? `演出：${ev.dateStart}${ev.dateEnd && ev.dateEnd !== ev.dateStart ? ` ~ ${ev.dateEnd}` : ''}${ev.sessions.length > 1 ? `（${ev.sessions.length} 場）` : ev.sessions[0].timeStart ? ` ${ev.sessions[0].timeStart}` : ''}` : '演出時間未提供'),
      h('div', { class: 'meta' }, `地點：${ev.venues.join('、') || '未提供'}${ev.cities.filter((c) => c !== '其他').length ? `（${ev.cities.filter((c) => c !== '其他').join('、')}）` : ''}`),
      h('div', { class: 'meta' }, `主辦：${ev.organizers.join('、') || '未提供'} ｜ ${priceText(ev)}`),
      saleLine(ev),
      detailsBlock(ev)),
    h('div', { class: 'btns' },
      h('button', { class: `star ${fav ? 'on' : ''}`, type: 'button', onclick: () => toggleFav(ev.eventId) }, fav ? '★ 已收藏' : '☆ 收藏'),
      fav ? h('button', { type: 'button', onclick: () => openFavDialog(ev.eventId) }, '提醒／輔助設定') : null,
      h('a', { href: ev.url, target: '_blank', rel: 'noopener' }, h('button', { class: 'primary', type: 'button' }, '前往購票頁'))));
}

// ---------- 全部活動 ----------

function renderFilters(all) {
  const f = ui.filters;
  const catCount = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const ev of all) catCount[ev.category]++;
  const cities = [...new Set(all.flatMap((e) => e.cities))].sort();
  const set = (patch) => {
    Object.assign(ui.filters, patch);
    persistUi();
    renderAll();
  };
  const toggle = (key, val) => set({ [key]: f[key].includes(val) ? f[key].filter((x) => x !== val) : [...f[key], val] });
  $('#filters').replaceChildren(
    h('fieldset', {}, h('legend', {}, '關鍵字（活動／主辦／場館）'), h('input', { type: 'text', value: f.q, placeholder: '例如：BABYMONSTER', oninput: (e) => { ui.filters.q = e.target.value; persistUi(); renderAll(true); } })),
    h('fieldset', {}, h('legend', {}, '分類（推測）'), CATEGORIES.map((c) => h('label', {}, h('input', { type: 'checkbox', checked: f.cats.includes(c), onchange: () => toggle('cats', c) }), `${c} (${catCount[c]})`))),
    h('fieldset', {}, h('legend', {}, '城市'), h('select', { onchange: (e) => set({ city: e.target.value }) }, h('option', { value: '' }, '全部'), cities.map((c) => h('option', { value: c, selected: c === f.city }, c)))),
    h('fieldset', {}, h('legend', {}, '售票狀態'), Object.entries(STATUS_LABEL).map(([k, v]) => h('label', {}, h('input', { type: 'checkbox', checked: f.status.includes(k), onchange: () => toggle('status', k) }), v))),
    h('fieldset', {}, h('legend', {}, '演出日期'), h('div', { class: 'row' }, h('input', { type: 'date', value: f.from, onchange: (e) => set({ from: e.target.value }) }), h('input', { type: 'date', value: f.to, onchange: (e) => set({ to: e.target.value }) }))),
    h('fieldset', {}, h('legend', {}, '最低票價上限 (NT$)'), h('input', { type: 'number', min: 0, step: 100, value: f.maxPrice, onchange: (e) => set({ maxPrice: e.target.value }) })),
    h('fieldset', {}, h('legend', {}, '劃位'), h('select', { onchange: (e) => set({ seat: e.target.value }) }, [['any', '不限'], ['yes', '僅劃位'], ['no', '僅自由入座／一般']].map(([v, t]) => h('option', { value: v, selected: v === f.seat }, t)))),
    h('button', { type: 'button', onclick: () => set(defaultFilters()) }, '清除篩選'),
  );
}

function renderAll(keepFilters = false) {
  const all = Object.values(S.events).filter((e) => !e.delisted);
  if (!keepFilters) renderFilters(all);
  const shown = all.filter(matches).sort(SORTS[ui.sort]);
  $('#resultCount').textContent = `顯示 ${shown.length} / ${all.length} 場`;
  $('#list').className = `list ${ui.view === 'cards' ? 'cards' : 'rows'}`;
  const safeCard = (ev) => {
    try { return eventCard(ev); } catch (err) {
      console.error('eventCard', ev.eventId, err);
      return h('article', { class: 'card' }, h('div', { class: 'body' }, h('h3', {}, ev.title ?? ev.eventId), h('div', { class: 'meta' }, `此活動顯示失敗：${err.message}`), ev.url ? h('a', { href: ev.url, target: '_blank', rel: 'noopener' }, '前往購票頁') : null));
    }
  };
  const empty = () => {
    if (!all.length) return h('div', { class: 'empty' }, '尚無資料，請按「重新整理」');
    const hiddenPast = all.filter((e) => saleStatus(e, nowMs()) === 'past').length;
    return h('div', { class: 'empty' },
      h('p', {}, '沒有符合條件的活動'),
      hiddenPast ? h('p', { class: 'hint' }, `另有 ${hiddenPast} 場「演出已結束」的活動，可在左側「售票狀態」勾選顯示。`) : null,
      h('button', { type: 'button', onclick: () => { ui.filters = defaultFilters(); persistUi(); renderAll(); } }, '清除所有篩選'));
  };
  $('#list').replaceChildren(...(shown.length ? shown.map(safeCard) : [empty()]));
  tick();
}

// ---------- 收藏 ----------

function favRow(id) {
  const it = items()[id];
  const fav = S.favorites[id];
  const t = nowMs();
  const status = it?.sessions ? saleStatus(it, t) : null;
  const next = it ? nextSaleStart(it, t) : null;
  const url = safeUrl(it?.url) ?? (it?.manual ? null : null);
  const chips = [...(fav.reminders ?? [])].map((r) =>
    h('span', { class: `chip ${r.type === 'at' && r.at < Date.now() ? 'past' : ''}` },
      r.type === 'beforeSale' ? `開賣前 ${formatMinutes(r.minutes)}` : `${formatDateTime(r.at)} 提醒`));
  return h('article', { class: 'card' },
    it?.image ? h('img', { class: 'thumb', src: it.image, alt: '', loading: 'lazy' }) : null,
    h('div', { class: 'body' },
      h('div', { class: 'badges' },
        status ? h('span', { class: `badge ${status}` }, STATUS_LABEL[status]) : h('span', { class: 'badge' }, '手動追蹤'),
        it?.delisted ? h('span', { class: 'badge ended' }, '已從清單下架') : null,
        fav.autoOpen ? h('span', { class: 'badge' }, '開賣前自動開啟') : null,
        fav.assist?.enabled ? h('span', { class: 'badge onsale' }, '購票輔助：啟用') : null),
      h('h3', {}, it?.title ?? `（資料已不存在）${id}`),
      next ? h('div', {}, '開賣倒數：', h('span', { class: 'countdown', dataset: { countdown: next } }), h('div', { class: 'meta' }, formatDateTime(next))) : h('div', { class: 'meta' }, it?.saleStarts?.length ? `開賣時間：${it.saleStarts.map(formatDateTime).join('、')}（已過）` : '尚未設定開賣時間'),
      h('div', { class: 'badges' }, chips.length ? chips : h('span', { class: 'meta' }, '尚未設定提醒'))),
    h('div', { class: 'btns' },
      h('button', { type: 'button', onclick: () => openFavDialog(id) }, '提醒／輔助設定'),
      url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, h('button', { class: 'primary', type: 'button' }, '前往購票頁')) : null,
      next ? h('button', { type: 'button', onclick: () => downloadIcs([id]) }, '匯出 .ics') : null,
      h('button', { class: 'danger', type: 'button', onclick: () => toggleFav(id) }, '取消收藏')));
}

function renderFav() {
  const t = nowMs();
  const ids = Object.keys(S.favorites);
  const key = (id) => nextSaleStart(items()[id] ?? {}, t) ?? Infinity;
  ids.sort((a, b) => key(a) - key(b));
  $('#favList').className = 'list cards';
  $('#favList').replaceChildren(...(ids.length ? ids.map(favRow) : [h('div', { class: 'empty' }, '尚未收藏任何活動')]));
  tick();
}

async function toggleFav(id) {
  if (S.favorites[id]) {
    if (S.manual[id] && !confirm('這是手動追蹤的項目，取消收藏會一併刪除，確定嗎？')) return;
    delete S.favorites[id];
    delete S.manual[id];
  } else {
    S.favorites[id] = newFavorite(S.settings);
  }
  await save({ favorites: S.favorites, manual: S.manual });
  render();
}

// ---------- 收藏設定對話框 ----------

const UNIT = { 分鐘: 1, 小時: 60, 天: 1440 };

function unitInput(defaultUnit = '分鐘') {
  const n = h('input', { type: 'number', min: 1, value: 10, style: 'width:80px' });
  const u = h('select', {}, Object.keys(UNIT).map((k) => h('option', { value: k, selected: k === defaultUnit }, k)));
  return { n, u, minutes: () => Math.round(Number(n.value) * UNIT[u.value]), el: [n, u] };
}

function openFavDialog(id) {
  const fav = structuredClone(S.favorites[id]);
  fav.assist = { ...DEFAULT_ASSIST, ...fav.assist };
  const it = items()[id];
  const dlg = $('#favDialog');
  const reminders = h('div', { class: 'badges' });
  const drawReminders = () =>
    reminders.replaceChildren(...(fav.reminders.length ? fav.reminders.map((r) =>
      h('span', { class: 'chip' }, r.type === 'beforeSale' ? `開賣前 ${formatMinutes(r.minutes)}` : `${formatDateTime(r.at)} 提醒`,
        h('button', { type: 'button', 'aria-label': '移除', onclick: () => { fav.reminders = fav.reminders.filter((x) => x !== r); drawReminders(); } }, '✕'))) : [h('span', { class: 'meta' }, '無')]));
  drawReminders();

  const before = unitInput('小時');
  const once = unitInput('分鐘');
  const dates = [...new Set((it?.sessions ?? []).map((s) => s.dateStart).filter(Boolean))];
  const areaNames = [...new Set((it?.areas ?? []).map((a) => a.name))];
  const prodNames = [...new Set((it?.products ?? []).map((p) => p.name))];

  const f = {
    enabled: h('input', { type: 'checkbox', checked: fav.assist.enabled }),
    areaOrder: h('textarea', { placeholder: '一行一個，依優先順序，例如：\n一樓A區\n一樓B區' }, fav.assist.areaOrder.join('\n')),
    ticketNames: h('textarea', { placeholder: '一行一個，例如：全票（留空 = 第一個票種）' }, fav.assist.ticketNames.join('\n')),
    qty: h('input', { type: 'number', min: 1, max: 8, value: fav.assist.qty, style: 'width:70px' }),
    fallback: h('select', {}, [['none', '不自動選，等我決定'], ['any', '改選第一個可購買票區']].map(([v, t]) => h('option', { value: v, selected: v === fav.assist.areaFallback }, t))),
    autoNext: h('input', { type: 'checkbox', checked: fav.assist.autoNext }),
    autoRefresh: h('input', { type: 'checkbox', checked: fav.assist.autoRefresh }),
    autoSeat: h('input', { type: 'checkbox', checked: fav.assist.autoSeat }),
    autoOpen: h('input', { type: 'checkbox', checked: fav.autoOpen }),
  };
  const dateBoxes = dates.map((d) => h('label', {}, h('input', { type: 'checkbox', value: d, checked: fav.assist.sessionDates.includes(d) }), ` ${d}`));
  const lines = (ta) => ta.value.split('\n').map((x) => x.trim()).filter(Boolean);

  const form = h('form', { method: 'dialog' },
    h('h2', {}, `提醒與輔助設定：${it?.title ?? id}`),
    h('fieldset', {}, h('legend', {}, '開賣提醒'),
      reminders,
      h('div', { class: 'row' }, '開賣前', before.el, h('button', { type: 'button', onclick: () => { const m = before.minutes(); if (m > 0 && !fav.reminders.some((r) => r.type === 'beforeSale' && r.minutes === m)) { fav.reminders.push({ id: `b${uid()}`, type: 'beforeSale', minutes: m }); drawReminders(); } } }, '新增')),
      h('div', { class: 'row' }, '從現在起', once.el, '後提醒我', h('button', { type: 'button', onclick: () => { const m = once.minutes(); if (m > 0) { fav.reminders.push({ id: `a${uid()}`, type: 'at', at: Date.now() + m * 60e3 }); drawReminders(); } } }, '設定一次性提醒')),
      h('label', {}, f.autoOpen, ` 開賣前 ${S.settings.openLeadSec} 秒自動開啟購票頁（在設定頁調整秒數）`),
      h('div', { class: 'hint' }, '提醒由瀏覽器背景執行，關閉分頁仍會響；但 Chrome 必須保持執行中，電腦睡眠時會延遲到喚醒後。')),
    h('fieldset', {}, h('legend', {}, '購票輔助（在 Ticket Plus 頁面套用）'),
      h('label', {}, f.enabled, ' 啟用輔助（未啟用時只顯示倒數與檢查清單，不會自動點擊）'),
      dates.length ? h('div', {}, '偏好場次日期（都不勾 = 第一個可購買場次）', h('div', {}, dateBoxes)) : null,
      h('div', {}, '票區偏好順序', f.areaOrder, areaNames.length ? h('div', { class: 'hint' }, `可用票區：${areaNames.join('、')}`) : null),
      h('div', {}, '偏好票種', f.ticketNames, prodNames.length ? h('div', { class: 'hint' }, `可用票種：${prodNames.join('、')}`) : null),
      h('div', { class: 'row' }, '張數', f.qty, '偏好票區都沒票時：', f.fallback),
      h('label', {}, f.autoRefresh, ' 開賣瞬間自動重新整理一次'),
      h('label', {}, f.autoNext, ' 條件符合時自動按「下一步」（付款頁永遠由你手動確認）'),
      h('label', {}, f.autoSeat, ' 選位頁自動挑選連續座位'),
      h('div', { class: 'hint' }, '遇到驗證碼、排隊或錯誤，輔助會暫停並提示你處理；不會儲存或填寫帳號密碼。')),
    h('div', { class: 'foot' },
      h('button', { type: 'button', onclick: () => dlg.close() }, '取消'),
      h('button', { class: 'primary', type: 'button', onclick: async () => {
        fav.autoOpen = f.autoOpen.checked;
        fav.assist = {
          ...fav.assist,
          enabled: f.enabled.checked,
          sessionDates: dateBoxes.map((l) => l.firstChild).filter((c) => c.checked).map((c) => c.value),
          areaOrder: lines(f.areaOrder),
          ticketNames: lines(f.ticketNames),
          qty: Math.min(8, Math.max(1, Number(f.qty.value) || 1)),
          areaFallback: f.fallback.value,
          autoNext: f.autoNext.checked,
          autoRefresh: f.autoRefresh.checked,
          autoSeat: f.autoSeat.checked,
        };
        S.favorites[id] = fav;
        await save({ favorites: S.favorites });
        dlg.close();
        render();
      } }, '儲存')));
  dlg.replaceChildren(form);
  dlg.showModal();
}

// ---------- 手動追蹤 ----------

function openManualDialog() {
  const dlg = $('#manualDialog');
  const title = h('input', { type: 'text', placeholder: '活動名稱', required: true, style: 'width:100%' });
  const when = h('input', { type: 'datetime-local', required: true });
  const url = h('input', { type: 'text', placeholder: 'https://ticketplus.com.tw/activity/…（選填）', style: 'width:100%' });
  const err = h('div', { class: 'hint', style: 'color:#b42318' });
  dlg.replaceChildren(h('form', { method: 'dialog', onsubmit: (e) => e.preventDefault() },
    h('h2', {}, '手動追蹤尚未上架的活動'),
    h('div', { class: 'hint' }, '公開清單不含尚未開賣的活動。輸入官方公告的開賣時間（台灣時間），到時間會提醒你。若填入 Ticket Plus 活動連結，活動上架後可直接使用購票輔助。'),
    h('label', {}, '名稱', title), h('label', {}, '開賣時間（台灣時間）', when), h('label', {}, '連結', url), err,
    h('div', { class: 'foot' },
      h('button', { type: 'button', onclick: () => dlg.close() }, '取消'),
      h('button', { class: 'primary', type: 'button', onclick: async () => {
        const ms = Date.parse(`${when.value}:00+08:00`);
        if (!title.value.trim() || Number.isNaN(ms)) { err.textContent = '請輸入名稱與開賣時間'; return; }
        const link = url.value.trim();
        if (link && !safeUrl(link)) { err.textContent = '連結必須以 https:// 開頭'; return; }
        const eid = eventIdFromUrl(link);
        const id = eid ?? `m_${uid()}`;
        if (S.events[id]) { err.textContent = '這個活動已在清單中，請直接在「全部活動」收藏。'; return; }
        S.manual[id] = { title: title.value.trim(), saleStarts: [ms], url: link || null, createdAt: Date.now() };
        S.favorites[id] ??= newFavorite(S.settings);
        await save({ manual: S.manual, favorites: S.favorites });
        dlg.close();
        ui.tab = 'fav';
        render();
      } }, '新增'))));
  dlg.showModal();
}

// ---------- ICS / 匯出入 ----------

function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function downloadIcs(ids) {
  const t = nowMs();
  const list = [];
  for (const id of ids) {
    const it = items()[id];
    const fav = S.favorites[id];
    if (!it || !fav) continue;
    const alarms = (fav.reminders ?? []).filter((r) => r.type === 'beforeSale').map((r) => r.minutes);
    for (const T of (it.saleStarts ?? []).filter((x) => x > t)) {
      list.push({ uid: `${id}-${T}@ticketplus-assist`, summary: `【開賣】${it.title}`, startMs: T, durationMin: 30, url: safeUrl(it.url), description: `開賣時間：${formatDateTime(T)}（台灣時間）`, alarmsMin: alarms });
    }
  }
  if (!list.length) return alert('沒有尚未開賣的時間可匯出');
  download('ticket-reminders.ics', buildIcs(list), 'text/calendar');
}

// ---------- 設定 ----------

function renderSettings() {
  const s = S.settings;
  const refresh = h('input', { type: 'number', min: 15, max: 720, value: s.refreshMinutes });
  const lead = h('input', { type: 'number', min: 0, max: 600, value: s.openLeadSec });
  const kw = h('input', { type: 'text', value: (s.watchKeywords ?? []).join(', '), placeholder: '例如：BABYMONSTER, 五月天' });
  const notifyNew = h('input', { type: 'checkbox', checked: s.notifyNewEvents });
  const file = h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: async (e) => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (typeof data !== 'object' || !data) throw new Error('格式錯誤');
      S.favorites = { ...S.favorites, ...(data.favorites ?? {}) };
      S.manual = { ...S.manual, ...(data.manual ?? {}) };
      S.settings = { ...S.settings, ...(data.settings ?? {}) };
      await save({ favorites: S.favorites, manual: S.manual, settings: S.settings });
      alert('匯入完成');
      render();
    } catch (er) { alert(`匯入失敗：${er.message}`); }
  } });
  $('#settingsForm').replaceChildren(
    h('label', {}, '資料更新頻率（分鐘，最少 15）', refresh),
    h('label', {}, '自動開啟購票頁：開賣前幾秒', lead),
    h('label', {}, '關注關鍵字（逗號分隔；有符合的新上架活動會通知）', kw),
    h('label', { class: 'row' }, notifyNew, ' 有新活動上架時通知（彙整成一則）'),
    h('div', { class: 'row' },
      h('button', { class: 'primary', type: 'button', onclick: async () => {
        S.settings = { ...S.settings, refreshMinutes: Math.max(15, Number(refresh.value) || 30), openLeadSec: Math.max(0, Number(lead.value) || 0), watchKeywords: kw.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean), notifyNewEvents: notifyNew.checked };
        await save({ settings: S.settings });
        alert('已儲存');
      } }, '儲存設定'),
      h('button', { type: 'button', onclick: () => chrome.notifications.create({ type: 'basic', iconUrl: '../icons/icon128.png', title: '測試通知', message: '看到這則通知代表提醒可正常運作。' }) }, '傳送測試通知')),
    h('hr'),
    h('div', { class: 'row' },
      h('button', { type: 'button', onclick: () => download('ticket-backup.json', JSON.stringify({ favorites: S.favorites, manual: S.manual, settings: S.settings }, null, 2), 'application/json') }, '匯出收藏與設定'),
      h('button', { type: 'button', onclick: () => file.click() }, '匯入'), file,
      h('button', { class: 'danger', type: 'button', onclick: async () => { if (confirm('清除快取的活動資料？（收藏與設定保留）')) { await save({ events: {}, meta: {} }); await refreshNow(true); } } }, '清除活動快取')),
    h('div', { class: 'hint' }, '所有資料只存在本機瀏覽器，不會傳送到任何第三方。本工具非 Ticket Plus 官方產品。'));
}

// ---------- 其他 ----------

function renderStatus() {
  const m = S.meta;
  const off = m.clockOffsetMs;
  $('#status').textContent = `最後更新：${m.lastSuccessAt ? new Date(m.lastSuccessAt).toLocaleString() : '尚未成功'}　` +
    `時鐘偏差：${off == null ? '未測量' : `${off >= 0 ? '+' : ''}${(off / 1000).toFixed(1)} 秒（伺服器 − 本機，精度約 ±1 秒）`}`;
  const b = $('#banner');
  b.hidden = !m.lastError;
  b.textContent = m.lastError ? `更新發生問題：${m.lastError}。目前顯示的是上次成功取得的資料。` : '';
}

function tick() {
  const t = nowMs();
  for (const el of document.querySelectorAll('[data-countdown]')) {
    const left = Number(el.dataset.countdown) - t;
    el.textContent = left > 0 ? formatCountdown(left) : '已開賣';
  }
}

function render() {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab));
  for (const s of document.querySelectorAll('section.tab')) s.hidden = s.id !== `tab-${ui.tab}`;
  $('#cntAll').textContent = `(${Object.values(S.events).filter((e) => !e.delisted).length})`;
  $('#cntFav').textContent = `(${Object.keys(S.favorites).length})`;
  $('#sort').value = ui.sort;
  $('#view').value = ui.view;
  renderStatus();
  if (ui.tab === 'all') renderAll();
  if (ui.tab === 'fav') renderFav();
  if (ui.tab === 'settings') renderSettings();
  persistUi();
}

async function refreshNow(force = false) {
  const btn = $('#btnRefresh');
  btn.disabled = true;
  btn.textContent = '更新中…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'refresh', force });
    if (res && res.ok === false) $('#banner').textContent = `更新失敗：${res.error}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '重新整理';
    await reload();
  }
}

const showFatal = (msg) => { const b = $('#banner'); b.hidden = false; b.textContent = `畫面錯誤：${msg}`; };
window.addEventListener('error', (e) => showFatal(e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason?.message ?? String(e.reason)));

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; render(); }));
$('#sort').addEventListener('change', (e) => { ui.sort = e.target.value; render(); });
$('#view').addEventListener('change', (e) => { ui.view = e.target.value; render(); });
$('#btnRefresh').addEventListener('click', () => refreshNow(false));
$('#btnManual').addEventListener('click', openManualDialog);
$('#btnIcsAll').addEventListener('click', () => downloadIcs(Object.keys(S.favorites)));
chrome.storage.onChanged.addListener((_c, area) => { if (area === 'local' && !document.querySelector('dialog[open]')) void reload(); });
setInterval(tick, 1000);

await reload();
if (!Object.keys(S.events).length) await refreshNow(false);

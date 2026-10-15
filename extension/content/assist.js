// Ticket Plus 頁面輔助（content script，classic script）。
// 原則：不儲存／填寫帳密；遇到登入、驗證碼就暫停；永遠不按付款頁的送出鈕；只有 favorites[id].assist.enabled 才會自動點擊。
// 注意：/activity 頁的選擇器已實測；/order、/seat 的選擇器來自前端程式碼推測，未經實際購票驗證，請在面板記錄中確認每一步。
(async () => {
  if (window.__tpAssist) return;
  window.__tpAssist = true;

  const lib = await import(chrome.runtime.getURL('shared/lib.js'));
  const { DEFAULT_ASSIST, dateFromText, isSoldOutText, pickSession, pickArea, findConsecutive, routeOf, formatCountdown, formatDateTime } = lib;

  let S = { events: {}, favorites: {}, manual: {}, meta: {}, settings: {} };
  const loadState = async () => { S = { ...S, ...(await chrome.storage.local.get(['events', 'favorites', 'manual', 'meta', 'settings'])) }; };
  await loadState();
  chrome.storage.onChanged.addListener(() => { void loadState(); });

  const serverNow = () => Date.now() + (S.meta?.clockOffsetMs ?? 0);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const isDisabled = (el) => !el || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('v-btn--disabled') || el.classList.contains('disabled');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- 面板 ----------
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .p{font:13px/1.45 -apple-system,"PingFang TC",sans-serif;width:290px;background:#fff;color:#1d2330;border:1px solid #d0d5dd;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.2);overflow:hidden}
    .h{display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#e63946;color:#fff;font-weight:600;cursor:pointer}
    .b{padding:8px 10px;display:grid;gap:6px}.b[hidden]{display:none}
    .t{font-weight:600}.cd{font:600 18px ui-monospace,monospace;color:#e63946}
    .m{color:#667085;font-size:12px}ul{margin:0;padding-left:16px}
    .log{max-height:110px;overflow:auto;background:#f5f6f8;border-radius:6px;padding:4px 6px;font-size:12px}
    button{font:inherit;padding:4px 8px;border:1px solid #d0d5dd;border-radius:6px;background:#fff;cursor:pointer}
    button.on{background:#138a4b;color:#fff;border-color:#138a4b}
  `;
  const panel = document.createElement('div');
  panel.className = 'p';
  const head = document.createElement('div');
  head.className = 'h';
  const headText = document.createElement('span');
  headText.textContent = '購票輔助';
  const caret = document.createElement('span');
  caret.textContent = '–';
  head.append(headText, caret);
  const body = document.createElement('div');
  body.className = 'b';
  const titleEl = Object.assign(document.createElement('div'), { className: 't' });
  const cdEl = Object.assign(document.createElement('div'), { className: 'cd' });
  const infoEl = Object.assign(document.createElement('div'), { className: 'm' });
  const checkEl = document.createElement('ul');
  const armBtn = document.createElement('button');
  const logEl = Object.assign(document.createElement('div'), { className: 'log' });
  body.append(titleEl, cdEl, infoEl, checkEl, armBtn, logEl);
  panel.append(head, body);
  root.append(style, panel);
  head.addEventListener('click', () => { body.hidden = !body.hidden; caret.textContent = body.hidden ? '+' : '–'; });
  document.documentElement.append(host);

  const logs = [];
  const log = (msg) => {
    if (logs[logs.length - 1]?.msg === msg) return;
    logs.push({ msg, t: new Date() });
    if (logs.length > 6) logs.shift();
    logEl.replaceChildren(...logs.map((l) => Object.assign(document.createElement('div'), { textContent: `${l.t.toLocaleTimeString()} ${l.msg}` })));
  };

  // ---------- 狀態 ----------
  let route = null;
  let acted = {};
  let busy = false;
  const once = (key, ms = 4000) => {
    const last = acted[key] ?? 0;
    if (Date.now() - last < ms) return false;
    acted[key] = Date.now();
    return true;
  };

  const loginHeuristic = () => {
    try { return Object.keys(localStorage).some((k) => /user|token|auth|member/i.test(k)); } catch { return false; }
  };
  const loginDialogOpen = () => !!document.querySelector('.v-dialog--active input[type=password]');
  const captchaPresent = () =>
    !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, [class*=captcha i]') ||
    /驗證碼|請輸入.{0,6}序號|圖形驗證/.test(document.body.innerText.slice(0, 5000));

  const getAssist = () => {
    const fav = route ? S.favorites?.[route.id] : null;
    return { fav, a: fav ? { ...DEFAULT_ASSIST, ...fav.assist } : null };
  };

  armBtn.addEventListener('click', async () => {
    if (!route) return;
    const favs = { ...(S.favorites ?? {}) };
    const fav = favs[route.id] ?? { addedAt: Date.now(), reminders: [], autoOpen: false, assist: { ...DEFAULT_ASSIST } };
    fav.assist = { ...DEFAULT_ASSIST, ...fav.assist, enabled: !fav.assist?.enabled };
    favs[route.id] = fav;
    S.favorites = favs;
    await chrome.storage.local.set({ favorites: favs });
    log(fav.assist.enabled ? '已啟用輔助' : '已停止輔助');
  });

  // ---------- 各頁面動作 ----------
  async function onActivity(a) {
    if (loginDialogOpen()) { log('請先登入（本工具不會填寫帳密）'); acted.loginSeen = true; return; }
    const item = S.events?.[route.id] ?? S.manual?.[route.id];
    const now = serverNow();
    const target = (item?.saleStarts ?? []).find((t) => t > now);

    if (target && a.autoRefresh) {
      const key = `tp_reload_${route.id}_${target}`;
      const remain = target - now;
      if (remain <= 2000 && !sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        log('開賣瞬間重新整理…');
        setTimeout(() => location.reload(), Math.max(0, remain));
        return;
      }
    }
    if (target) { log('尚未到開賣時間，等待中'); return; }

    const rows = $$('#buyTicket .sesstion-item').map((el) => {
      const btn = el.querySelector('.nextBtn');
      return { el, btn, date: dateFromText(el.textContent), soldOut: isSoldOutText(el.textContent) || isDisabled(btn) || !btn };
    });
    if (!rows.length) { log('尚未偵測到場次列表'); return; }
    const pick = pickSession(rows, a);
    if (!pick) { log('沒有符合偏好且可購買的場次'); return; }
    if (!a.autoNext) { log(`已找到場次 ${pick.date}，請自行按「立即購買」`); return; }
    if (once(`sess_${pick.date}`, 3000)) {
      log(`選擇場次 ${pick.date}`);
      pick.btn.click();
      await sleep(600);
      if (loginDialogOpen()) log('請先登入（本工具不會填寫帳密），登入後會自動繼續');
    }
  }

  async function onOrder(a) {
    if (captchaPresent()) { log('偵測到驗證碼／序號欄位：請手動完成，輔助已暫停'); return; }
    const panels = $$('.v-expansion-panel');
    if (!panels.length) { log('尚未偵測到票區列表'); return; }
    const areas = panels.map((p) => {
      const header = p.querySelector('.v-expansion-panel-header') ?? p;
      const name = (header.textContent ?? '').replace(/\s+/g, ' ').trim();
      return { name, soldOut: isSoldOutText(name), panel: p, header };
    });
    const pick = pickArea(areas, a);
    if (!pick) { log('沒有符合偏好且可購買的票區（可在設定放寬「改選第一個可購買票區」）'); return; }
    const { area } = pick;
    if (!area.panel.classList.contains('v-expansion-panel--active')) {
      if (once(`open_${area.name}`)) { log(`展開票區：${area.name.slice(0, 20)}`); area.header.click(); }
      return;
    }
    const groups = $$('.count-button', area.panel);
    let group = groups[0];
    if (a.ticketNames.length) {
      group = groups.find((g) => {
        let el = g;
        for (let i = 0; i < 4 && el; i++, el = el.parentElement) if (a.ticketNames.some((n) => el.textContent.includes(n))) return true;
        return false;
      }) ?? groups[0];
    }
    if (!group) { log('找不到張數按鈕（頁面結構可能已變），請手動選擇'); return; }
    if (once(`qty_${area.name}`, 60000)) {
      const plus = group.querySelector('.mdi-plus')?.closest('button') ?? [...group.querySelectorAll('button')].pop();
      if (!plus) { log('找不到「＋」按鈕，請手動選擇張數'); return; }
      for (let i = 0; i < a.qty; i++) { plus.click(); await sleep(150); }
      log(`已點「＋」${a.qty} 次，請確認張數`);
    }
    if (a.autoNext) {
      const next = $$('.nextBtn')[0];
      if (next && !isDisabled(next) && once('order_next', 5000)) { log('按「下一步」'); await sleep(300); next.click(); }
    }
  }

  async function onSeat(a) {
    if (!a.autoSeat) { log('請自行選位（未啟用自動選位）'); return; }
    const rowEls = $$('.seat-row');
    if (!rowEls.length) { log('尚未偵測到座位圖'); return; }
    const matrix = rowEls.map((r) => $$('.seat', r).map((s) => s.classList.contains('is-avaliable')));
    const hit = findConsecutive(matrix, a.qty);
    if (!hit) { log(`找不到 ${a.qty} 個連續空位，請手動選位`); return; }
    if (!once('seat_pick', 10000)) return;
    const seats = $$('.seat', rowEls[hit.row]).slice(hit.start, hit.start + a.qty);
    for (const s of seats) { s.click(); await sleep(150); }
    log(`已選第 ${hit.row + 1} 排連續 ${a.qty} 位，請確認`);
    if (a.autoNext) {
      await sleep(400);
      const next = $$('.nextBtn')[0];
      if (next && !isDisabled(next)) next.click();
    }
  }

  async function onConfirm(a) {
    log('請核對場次、座位與金額');
    if (route.step === 'confirmSeat' && a.autoNext) {
      const next = $$('.nextBtn')[0];
      if (next && !isDisabled(next) && once('confirmSeat_next', 5000)) next.click();
    }
  }

  // ---------- 主迴圈 ----------
  const STEP_LABEL = { activity: '活動頁', order: '選票區／張數', seat: '選位', confirmSeat: '確認座位', confirm: '確認訂單', checkout: '付款', done: '完成' };

  async function tick() {
    const r = routeOf(location.pathname);
    if (JSON.stringify(r) !== JSON.stringify(route)) {
      route = r;
      acted = {};
      if (r) log(`進入：${STEP_LABEL[r.step]}`);
    }
    host.style.display = route ? 'block' : 'none';
    if (!route) return;

    const { fav, a } = getAssist();
    const item = S.events?.[route.id] ?? S.manual?.[route.id];
    titleEl.textContent = item?.title ?? `活動 ${route.id.slice(0, 8)}…`;
    const target = (item?.saleStarts ?? []).find((t) => t > serverNow());
    cdEl.textContent = target ? formatCountdown(target - serverNow()) : '';
    infoEl.textContent = target ? `開賣：${formatDateTime(target)}（已用伺服器時間校正，誤差約 ±1 秒）` : STEP_LABEL[route.step];

    const off = S.meta?.clockOffsetMs;
    const checks = [
      [loginHeuristic() ? '登入：疑似已登入（僅推測）' : '登入：未偵測到，請先登入', loginHeuristic()],
      [fav ? '已收藏此活動' : '尚未收藏（按下方按鈕會一併收藏）', !!fav],
      [`偏好：${a ? `場次 ${a.sessionDates.join('/') || '不限'}、票區 ${a.areaOrder.join('>') || '不限'}、${a.qty} 張` : '未設定'}`, !!a],
      [off == null ? '時鐘：尚未校正' : '時鐘：已校正', off != null],
    ];
    checkEl.replaceChildren(...checks.map(([t, ok]) => Object.assign(document.createElement('li'), { textContent: `${ok ? '✔' : '✖'} ${t}` })));
    armBtn.textContent = a?.enabled ? '■ 停止輔助' : '▶ 啟用輔助';
    armBtn.className = a?.enabled ? 'on' : '';

    if (route.step === 'checkout') { log('付款頁：請自行確認內容並付款（本工具不會代為送出）'); return; }
    if (route.step === 'done') { log('訂單流程已完成，請到會員中心確認'); return; }
    if (!a?.enabled || busy) return;

    busy = true;
    try {
      if (route.step === 'activity') await onActivity(a);
      else if (route.step === 'order') await onOrder(a);
      else if (route.step === 'seat') await onSeat(a);
      else await onConfirm(a);
    } catch (e) {
      log(`輔助發生錯誤：${e.message}`);
    } finally {
      busy = false;
    }
  }

  setInterval(() => { void tick(); }, 500);
})();

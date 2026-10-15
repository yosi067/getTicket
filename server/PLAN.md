# Ticketplus Assist v2（本機後端版）規劃

## 1. 目標

在現有 Chrome 擴充（v1，純前端、輕量）之外，新增一個可自行部署的後端版本：

- 後端 24 小時定時抓取，不依賴 Chrome 是否開啟。
- 保存歷史資料（場次、票價、狀態變化），可查詢與統計。
- 多通道通知（Telegram／LINE／Email／Web Push），不只靠瀏覽器通知。
- 提供 Web 儀表板與 REST API；擴充功能降級為「購票頁輔助」並可選擇連到後端取得資料。
- 一鍵啟動（Docker Compose），方便他人自架。

不做：儲存帳密、繞過驗證碼、送出付款、高頻請求（維持低頻、禮貌抓取）。

## 2. 與 v1 的分工

| 項目 | v1 擴充（保留） | v2 後端（新增） |
|---|---|---|
| 抓資料 | service worker + alarms | 伺服器排程 |
| 儲存 | chrome.storage.local | SQLite（可換 PostgreSQL） |
| 通知 | Chrome 通知 | Telegram／LINE／Email／Web Push |
| 歷史 | 無 | 有（快照與差異） |
| 購票輔助 | content script | 沿用，不搬到後端 |
| 多人使用 | 各自安裝 | 帳號或 token 區分訂閱 |

共用邏輯（`saleStatus`、分類推測、API 解析）從 `extension/shared/lib.js` 與 `api.js` 抽成可被兩邊 import 的純 ES module（放 `packages/core/`），避免兩套規則分歧。

## 3. 技術選型

- 執行環境：Node.js 20+，TypeScript。
- Web 框架：Fastify（輕量、內建 schema 驗證）。
- 資料庫：SQLite（better-sqlite3）+ Drizzle ORM，之後可切 PostgreSQL。
- 排程：node-cron 或 croner，含抖動（jitter）與併發 1。
- HTTP 抓取：內建 fetch，附 ETag／If-Modified-Since、逾時、指數退避。
- 通知：Telegram Bot API、LINE Messaging API（Notify 已終止，需用 Messaging API）、SMTP、Web Push（VAPID）。
- 前端：先重用現有 dashboard HTML/JS，改成呼叫 REST；後續再評估 Vite + 輕量框架。
- 部署：Dockerfile + docker-compose；設定用 `.env`。
- 測試：node:test／Vitest；API 回應以錄製檔（fixtures）做離線測試。

## 4. 目錄結構（規劃）

```
ticket/
  extension/            # v1，保留
  packages/core/        # 共用：saleStatus、分類、API 解析、型別
  server/
    PLAN.md
    src/
      index.ts          # 啟動
      config.ts         # 環境變數驗證
      db/               # schema、migration
      fetcher/          # ticketplus 客戶端（限速、退避、快取）
      jobs/             # sync、reminder、cleanup
      notify/           # telegram、line、email、webpush
      routes/           # /api/events、/favorites、/reminders、/health
      services/         # diff、提醒計算
    test/
    Dockerfile
    docker-compose.yml
```

## 5. 資料模型

- `events`：id、title、category、organizer、venue、banner、first_seen_at、last_seen_at。
- `sessions`：event_id、session_id、start_at、sale_start_at、sale_end_at、venue。
- `products`／`areas`：票種、票價、區域（僅記錄公開欄位）。
- `snapshots`：event_id、fetched_at、hash、raw_json（保留近 N 筆，供差異比對）。
- `changes`：event_id、type（new／time_changed／price_changed／sale_open／removed）、before、after、at。
- `users`：id、token_hash、display_name（單人自用可只有一筆）。
- `favorites`、`reminders`（offset 分鐘、通道、已送出標記）、`channels`（通道設定，敏感資訊加密存放）。

## 6. 核心流程

1. 同步任務（預設每 15–30 分鐘，加抖動）：取 `mainEvents.json` → 對每個活動以 ETag／hash 判斷是否變動 → 變動才抓 `event/{id}/*.json` → 寫入快照並產生 `changes`。
2. 提醒任務（每分鐘）：計算「開賣時間 − 偏移」落在本分鐘的收藏，依通道送出，並記錄已送避免重複。
3. 開賣前加密排程：開賣前 10 分鐘到開賣後 5 分鐘縮短輪詢間隔，但維持上限（例如不低於 30 秒，且僅針對被收藏活動）。
4. 通知失敗重試與死信記錄。
5. 清理任務：移除過舊快照與已結束活動的明細。

## 7. API（草案）

- `GET /api/events?category=&status=&q=&from=&to=`
- `GET /api/events/:id`、`GET /api/events/:id/changes`
- `PUT/DELETE /api/favorites/:eventId`
- `GET/POST/DELETE /api/reminders`
- `POST /api/channels/test`
- `GET /api/export.ics`（訂閱用行事曆）
- `GET /health`

認證：單人自用先用長隨機 token（Bearer）；多人再加註冊流程。所有輸入以 schema 驗證；預設只綁 `127.0.0.1`，對外需明確設定並加反向代理與 HTTPS。

## 8. 安全與合規

- 不儲存 Ticket Plus 帳號密碼或 cookie。
- 低頻抓取、固定 User-Agent、遵守 429／5xx 退避；可設定全域速率上限。
- 通道金鑰（Bot token 等）只放環境變數或加密欄位，不進版控、不寫入日誌。
- 遠端文字一律當純文字輸出，防 XSS；URL 限 https 且網域白名單。
- 取得的資料僅供個人提醒使用；README 說明非官方、使用風險自負。

## 9. 里程碑

1. M0 抽共用核心：建立 `packages/core`，v1 改為引用並維持測試全過。
2. M1 後端骨架：Fastify、設定驗證、SQLite、`/health`、Dockerfile。
3. M2 抓取與儲存：fetcher、同步任務、快照與 changes、離線測試。
4. M3 API 與儀表板：events 查詢、收藏、重用現有 UI。
5. M4 提醒與通知：提醒任務、Telegram 優先，再加 LINE／Email／Web Push。
6. M5 擴充整合：擴充可設定後端網址與 token，同步收藏與提醒。
7. M6 打包與文件：docker-compose、備份說明、使用手冊補充「自架版」。

## 10. 風險與待決定事項

- 官方 API 為非公開介面，欄位或路徑可能變動：以 schema 驗證與監控告警因應。
- 沒有庫存資料：「有票／售完」無法判斷，維持時間型狀態。
- 無表演者欄位：分類與關鍵字比對仍是推測。
- 待決定：自用或多人、部署位置（本機／NAS／VPS）、主要通知通道、是否需要使用者登入。

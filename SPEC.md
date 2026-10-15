# TicketPlus 演唱會追蹤與購票輔助工具 — SPEC v0.2

## 0. 實測後修訂（以此節為準，優先於下方原始調查）

- 活動清單改用 `getS3?path=main/mainEvents.json`（`allEventMainPageInfo`），**只含已開賣的活動**（約 79 筆）；沒有公開的「預售／即將開賣」清單 → 以「手動追蹤」輸入開賣時間補足。`sitemap.txt` 不再使用。
- `event.json` 的 `hosts` 是**主辦單位**，沒有表演者欄位；沒有分類欄位 → 分類依標題關鍵字推測並標示「推測」。
- 沒有庫存資料 → 售票狀態僅依開賣／結束時間計算（販售期間內 ≠ 一定有票）。
- 錯誤回應為 `{errCode:"101"|"102"}`；成功回應無 errCode；`ticketAreas.json` 僅劃位場次存在。
- 購票流程：`/activity/:id → /order/:e/:s → /seat/:e/:s → /confirmSeat → /confirm → /checkout → /done/:orderId`。
- 已實測 DOM：`#buyTicket .sesstion-item`（日期、時間、`.nextBtn`「立即購買」）；未登入點擊會出現 `.v-dialog--active` 登入視窗（行動電話＋密碼）。
- 未實測（需登入，僅由前端程式碼推測）：`.v-expansion-panel(-header)`、`.count-button`、`.seat-row`、`.seat.is-avaliable`；訂單頁可能有驗證碼／序號／問答。
- 時鐘校正：以 `Date`（＋`Age`）標頭估算伺服器偏差（取最近 5 次中位數，精度約 ±1 秒）；提醒時間 = 伺服器時間 − 偏差。
- 安全邊界：不儲存／填寫帳密；遇登入、驗證碼暫停；永不按付款頁送出；僅 `assist.enabled` 才自動操作；遠端文字一律 `textContent`；圖片與連結僅接受 https。

## 1. 資料來源調查結果（初版，部分已被上節修訂）

站點為 SPA，但資料來自公開、無需登入的 JSON，可直接取得：

| 用途 | 來源 | 狀態 |
|---|---|---|
| 活動清單 | `https://ticketplus.com.tw/sitemap.txt`（目前約 75 筆 `/activity/{eventId}`） | 已驗證 |
| 活動資訊（標題、表演者 `hosts`、地點、地址、時間、圖片、須知） | `https://apis.ticketplus.com.tw/config/api/v1/getS3?path=event/{eventId}/event.json` | 已驗證 |
| 場次（日期、時間、場館、`exposeStart/End`、是否劃位 `ticketArea`） | `.../getS3?path=event/{eventId}/sessions.json` | 已驗證 |
| 票種與價格、開賣時間 `exposeStart` | `.../getS3?path=event/{eventId}/products.json` | 已驗證 |
| 活動頁 | `https://ticketplus.com.tw/activity/{eventId}` | 已驗證 |
| robots.txt | 允許 `/`、`/activity/` | 已確認 |

待驗證（開發第 1 階段）：
- 分類欄位（演唱會/舞台劇等）：event.json 未見分類欄位，需確認首頁「熱門／即將開始」使用的另一支清單 API，否則以關鍵字規則分類。
- 即時售票狀態（售完、剩餘）：需用 DevTools 觀察 `get?productId=...` 等請求的正確參數。
- 選位頁（`ticketArea: true` 的場次）的 DOM 與 API 結構。
- `sitemap.txt` 是否涵蓋全部活動，是否有時間上的延遲。

正確性策略：以官方 JSON 為唯一資料來源，所有欄位附原始值；時間統一以 `+08:00` 解析；每次顯示「資料更新時間」與「來源連結」；欄位缺漏顯示「未提供」，不推測。

## 2. 架構決策

結論：做成單一 Chrome 擴充功能（Manifest V3），不需要本機代理。

理由：
- 擴充功能以 `host_permissions` 可直接請求 `apis.ticketplus.com.tw`，不受 CORS 限制。
- 背景 Service Worker 加 `chrome.alarms`，分頁關閉後提醒仍會觸發，解決純 HTML 的最大限制。
- 同一套程式可同時完成「儀表板 HTML」與「購票頁輔助（Content Script）」。
- 分享方便：打包成資料夾或 zip，使用者在 `chrome://extensions` 載入；日後可上架 Chrome Web Store。無需安裝 Node。

```
extension/
  manifest.json
  background/        service worker：抓取、快取、alarms、通知
  dashboard/         儀表板 HTML/CSS/JS（列表、篩選、收藏、提醒設定）
  content/           ticketplus 頁面輔助（倒數浮層、偏好套用）
  shared/            資料正規化、時間工具、儲存封裝
  options/           設定頁
```

## 3. 功能需求

### 3.1 資料與更新
- 抓取：sitemap 取得 eventId，再抓 event/sessions/products，合併成統一模型。
- 頻率：預設 30 分鐘一次（最小 15 分鐘），限制併發（例如 3），帶快取（ETag/Last-Modified 若支援）。
- 增量更新：新活動、開賣時間變更時標記並通知。
- 失敗時使用快取並提示。

統一資料模型：
`eventId, title, performers[], category, sessions[{sessionId, date, time, venue, address, ticketArea, saleStart, saleEnd}], products[{name, price, sessionId, exposeStart, exposeEnd}], priceMin/Max, images, url, fetchedAt`

### 3.2 瀏覽、篩選、分類
- 卡片／列表切換。
- 篩選：關鍵字（表演者、活動名）、日期範圍、城市／場館（由地址解析）、分類、票價範圍、售票狀態（未開賣／售票中／已結束，依 exposeStart/End 計算）、是否劃位。
- 排序：演出日、開賣時間、最近新增。
- 分類：優先使用官方欄位；若無，則以關鍵字規則並標示「推測分類」。

### 3.3 收藏
- 星號收藏、「我的收藏」分頁。
- 資料存 `chrome.storage.local`，支援匯出／匯入 JSON。

### 3.4 提醒
- 每個收藏活動可設多組提醒：開賣前 1 天、1 小時、10 分鐘、1 分鐘，以及自訂「X 分鐘／小時後」。
- 以 `chrome.alarms` 與 `chrome.notifications` 實作，分頁關閉仍有效。
- 提醒內容含活動名稱、開賣時間、一鍵開啟購票頁。
- 匯出 `.ics`。
- 使用者本機時間與網路時間偏差檢查，作為倒數校正。

### 3.5 前往購票
- 每個活動、場次提供「前往購票頁」連結（新分頁開啟 `https://ticketplus.com.tw/activity/{eventId}`）。
- 開賣時間到達時，可選擇自動開啟該頁（預設關閉）。

### 3.6 購票輔助（Content Script）

範圍（輔助自動化，最後確認由人完成）：
- 開賣前：頁面浮層倒數、校正時間、開賣前數秒自動重新整理一次。
- 登入：偵測是否已登入；未登入時提示並導向登入頁。帳密由使用者自行輸入或瀏覽器密碼管理員填入，擴充功能不儲存、不讀取密碼。
- 偏好套用：依使用者預設自動選擇場次、票種、張數、票區優先順序；無票時依備選順序自動嘗試。
- 選位：在座位圖上高亮符合偏好的區域，並可自動點選優先區域。
- 結帳：自動帶到確認頁，但「送出訂單、付款」由使用者手動操作。
- 異常處理：遇到驗證碼、排隊、錯誤訊息時，暫停並提示使用者處理。
- 可隨時一鍵停止輔助。

明確不做：
- 繞過或自動辨識驗證碼、排隊機制、風控。
- 儲存或傳送帳號密碼、付款資料。
- 多帳號、多分頁大量並行搶票。
- 偽造請求或直接呼叫非公開下單 API。
原因：違反平台條款，可能導致帳號被停權，也無法保證正確性。

## 4. 非功能需求
- 隱私：資料只存本機，不傳送到任何第三方；權限最小化（僅 `ticketplus.com.tw`、`apis.ticketplus.com.tw`、`storage`、`alarms`、`notifications`）。
- 正確性：資料模型單元測試（以實測 JSON 作為 fixture）；時間處理測試；變更偵測測試。
- 穩定性：網站改版時，欄位解析失敗要明確報錯並降級，不顯示錯誤資料。
- 易用：繁體中文 UI，響應式。
- 合規：遵守 robots.txt，低頻抓取，附上免責聲明（非官方工具）。

## 5. 畫面
1. 儀表板：搜尋列、篩選側欄、活動卡片。
2. 活動詳情：場次、票價、開賣時間、收藏、提醒、前往購票。
3. 我的收藏：依開賣時間排序，附倒數。
4. 購票輔助設定：每個活動的偏好（場次、票種、張數、票區順序）。
5. 設定：更新頻率、通知、匯出匯入。

## 6. 開發階段
1. 資料層：完成上述待驗證項（分類、售票狀態、選位頁結構），建立資料模型與測試。
2. 儀表板：列表、篩選、排序、收藏。
3. 提醒：alarms、通知、倒數、`.ics`。
4. 購票輔助：倒數浮層、偏好套用、選位高亮；實測於低風險活動頁驗證。
5. 打包與分享：README、zip 打包、選配 Chrome Web Store 上架。

## 7. 風險
- 非官方 API 隨時可能變動；以資料層隔離與測試降低影響。
- 選位頁需實際開賣活動才能完整驗證，第 4 階段先以非熱門場次測試。
- 自動化程度受平台反濫用機制限制，將以「半自動、人工確認」為原則。

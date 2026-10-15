# TicketPlus 演唱會追蹤與購票輔助（非官方）

Chrome 擴充功能：彙整 [Ticket Plus](https://ticketplus.com.tw/) 公開售票資訊，提供篩選、收藏、開賣提醒與購票頁輔助。

一般使用者請看 [使用手冊](使用手冊.md)；技術架構請看 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 安裝

1. 取得資料夾 `extension/`，或執行 `npm run pack` 產生 `dist/ticketplus-assist-<版本>.zip` 並解壓縮。
2. Chrome 開啟 `chrome://extensions`，打開右上角「開發人員模式」。
3. 按「載入未封裝項目」，選擇 `extension/`（或解壓後的資料夾）。
4. 點工具列圖示開啟儀表板。

不需要安裝 Node、也不需要本機伺服器。

## 功能

- **全部活動**：標題、日期、場館／城市、主辦、票價、售票狀態；可依關鍵字、分類、城市、狀態、日期、票價、是否劃位篩選與排序。
- **收藏與提醒**：開賣前 N 分鐘／小時／天提醒、「X 後提醒我」、開賣前自動開啟購票頁、匯出 `.ics`。提醒由背景執行，關閉分頁仍會響；Chrome 需保持開啟。
- **手動追蹤**：公開清單不含尚未開賣的活動，可自行輸入名稱、開賣時間（台灣時間）與連結。
- **關注關鍵字**：新活動上架符合關鍵字時通知。
- **購票輔助**（Ticket Plus 頁面右下角面板）：開賣倒數（伺服器時間校正，約 ±1 秒）、檢查清單、依偏好選場次／票區／張數／連續座位。

## 網頁 Demo：TicketWar Pro

`demo/` 內為獨立的單頁 Demo（看板、票夾、各平台購票演練），與擴充功能互不相依。資料含內建快照與模擬情境，僅供展示與練習。

| 檔案 | 說明 |
| --- | --- |
| `demo/ticketwar.html` | 完整版（295 筆活動、即時抓取、演練場、題庫） |
| `demo/ticketwar-lite.html` | 精簡版，可直接上傳（保留看板、票夾、演練場；無即時抓取與題庫編輯，約 119 筆活動）；需連網載入 CDN |

```
npm run demo:update     # 一次完成：抓取四個平台 → 寫入快照 → 重建兩個 HTML（更新資料只需要這一行）
npm run demo            # 本機伺服器；頁面「重新抓取」一次更新全部平台（僅在頁面內），「更新並存檔」則同時寫入快照並重建 HTML
npm run demo:snapshot   # 只抓取（可加 --skip-ticketplus 或 --only=kktix,opentix）
npm run demo:build      # 只重建 HTML
```

直接雙擊開啟 HTML 時，「重新抓取」只能更新 Ticket Plus；想一次更新全部平台，請用 `npm run demo` 開啟。

## 限制（請先閱讀）

- 公開資料**只含已開賣活動**；**沒有表演者欄位**（顯示的是主辦單位）；分類為依標題推測；售票狀態僅依販售時間，**不含庫存**。
- 購票輔助中，場次頁的選擇器已實測；**票區／張數／選位頁的選擇器來自前端程式碼推測，尚未在實際購票流程驗證**。第一次請在不急的活動上試跑，並看面板記錄確認每一步。網站改版可能失效。
- 輔助**不會**繞過驗證碼、排隊或登入；**不會**儲存或填寫帳號密碼；**永遠不會**在付款頁送出。遇到這些狀況會暫停並提示。
- 輔助預設關閉，需在收藏設定或面板中啟用。
- 時鐘校正精度約 ±1 秒，無法保證搶到票。

## 隱私

資料只存在本機瀏覽器（`chrome.storage.local`），僅向 `apis.ticketplus.com.tw` 與 `ticketplus.com.tw` 發出請求，無任何第三方傳輸。

## 開發

```
npm test        # 單元測試（node:test，使用真實 API 資料裁切的 fixtures）
npm run icons   # 重新產生圖示
npm run pack    # 打包 zip
```

## 免責

非 Ticket Plus 官方產品。請遵守其服務條款；使用自動化輔助的風險由使用者自行承擔。

## 入口網站與 GitHub Pages

線上網址：https://yosi067.github.io/getTicket/　（售票統整平台：`/app/`，內有「返回入口」按鈕）

### 內容
- `site/index.html`：入口頁，風格與平台一致（淺色橘調）並帶動態效果：打字標題、開賣倒數、跑馬燈、數字滾動、捲動顯示。
  - 開賣倒數：有未來的開賣時間時顯示「下一場開賣倒數」；沒有時改顯示「最近一場開賣」與已過多久。
  - 現況分析：可點選交叉篩選，含總覽、交叉比對（類型×月份、地區×類型、平台×類型、場館×月份、類型×星期等熱力圖）、開賣與票價、資料品質。
  - 台灣演唱會新聞：只收台灣媒體白名單內的來源（名單在 `scripts/fetch-news.mjs` 的 `TW_SOURCE`／`TW_HOST`），並依主題分類。
  - 客服小幫手（Gemini）：右下角聊天視窗，只回答活動資訊與網站用法，回答精簡並附追問按鈕。設定方式見下方「客服小幫手」。
- `app/`：售票統整平台（`demo/ticketwar-web.html`，完整活動資料，移除本機專用的「重新抓取」）。
- 活動卡片的複製按鈕會產生可直接貼給朋友的重點文字（`formatShareText`）。

### 資料更新頻率與方式

| 資料 | 自動更新 | 來源 |
| --- | --- | --- |
| 活動快照（`demo/data/snapshot.json`，約 300 筆） | 每天台灣時間 06:00，另外每次推送 `main` 也會更新 | Ticket Plus、KKTIX、拓元、OPENTIX 公開頁面 |
| 新聞（`demo/data/news.json`，約 30 則） | 同上 | Google News RSS，經台灣媒體白名單過濾 |
| 客服知識庫（`chat-context.json`） | 隨每次建置重新產生 | 快照 + `server/site-guide.md` + `使用手冊.md` 節錄 |

- 自動更新由 `.github/workflows/pages.yml` 執行：測試 → 更新快照 → 抓新聞 → 建置 → 部署到 Pages。快照或新聞抓取失敗時沿用 repo 內舊檔，建置不會中斷（看 Actions 日誌的警告）。
- 自動更新只重新部署網站，不會把新資料提交回 repo；repo 內的快照停留在你上次手動提交的版本。
- 立即更新：GitHub repo → Actions → Deploy to GitHub Pages → Run workflow。
- 本機更新：

```
npm run news          # 只抓新聞
npm run demo:update   # 抓四個平台快照並重建 demo 的 HTML
npm run site          # 抓新聞 + 重建 demo + 組出 dist-site/（完整網站）
npm run site:build    # 不抓資料，只用現有快照與新聞重建 dist-site/
```

- 本機預覽：`npm run site` 後開啟 `dist-site/index.html`。要在本機看到聊天按鈕，需帶環境變數：`CHAT_API_URL=https://<你的函式網址>/api/chat npm run site:build`。
- 首次使用 Pages：GitHub repo 的 Settings → Pages，把 Source 設為「GitHub Actions」。

### 客服小幫手（Gemini）

架構：瀏覽器 → 自己部署的小型後端（Vercel 或 Cloudflare Worker）→ Gemini API。金鑰只放在後端的環境變數／Secret，不會出現在前端或 repo。

快速步驟（以 Vercel 為例，完整說明與疑難排解見 [server/README.md](server/README.md)）：
1. 到 [Google AI Studio](https://aistudio.google.com/apikey) 建立 API 金鑰。
2. 在 vercel.com 用 GitHub 登入，匯入本 repo（專案名稱需為小寫）。
3. 專案 Settings → Environment Variables 新增 `GEMINI_API_KEY`，Redeploy。
4. 專案 Settings → Deployment Protection 關閉 Vercel Authentication，否則公開網站會被 401 擋住。
5. GitHub repo → Settings → Secrets and variables → Actions → Variables 新增 `CHAT_API_URL` = `https://<專案網址>/api/chat`。
6. 重跑 Pages 部署，首頁右下角就會出現聊天按鈕。沒設定 `CHAT_API_URL` 時完全不顯示。

模型預設 `gemini-3.5-flash-lite`，可用環境變數 `GEMINI_MODEL` 覆寫。

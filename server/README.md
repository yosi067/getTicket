# 客服小幫手（Gemini）建置與維運

首頁右下角的聊天視窗會呼叫一個小型後端，由後端帶著金鑰去呼叫 Gemini。金鑰只存在後端的環境變數／Secret，不在前端、不在 repo。後端有兩種寫法，共用同一份核心邏輯 [chat-core.mjs](chat-core.mjs)：

| 方案 | 檔案 | 說明 |
| --- | --- | --- |
| Vercel（目前使用） | [api/chat.js](../api/chat.js)、[vercel.json](../vercel.json) | 免費，可用 GitHub 登入，不必綁卡 |
| Cloudflare Worker | [worker.js](worker.js)、[wrangler.toml](wrangler.toml) | 免費，需 Cloudflare 帳號 |

## 運作方式
1. 網站每次建置輸出 `chat-context.json`：精簡活動清單 + [site-guide.md](site-guide.md)（網站說明）+ 擴充功能手冊節錄。
2. 後端收到問題後讀取該檔（快取 10 分鐘），連同系統提示一起送給 Gemini。
3. 系統提示限制只能回答「活動資訊」與「網站怎麼用」，資料裡沒有就說不知道；回答要直接給結論、一般 120 字內；問題太籠統先反問；離題只回一句；每次回答最後附 1～2 個追問，格式為 `[[Q]] 問題一 | 問題二`，後端拆出後以 `followups` 回傳，前端顯示成按鈕。
4. 防濫用：只允許指定網域（CORS）、單則 300 字、只保留最近 6 則、回覆上限 500 tokens、每 IP 每分鐘 8 次。
5. 客服資料更新頻率與網站相同（每天 06:00 與每次推送後重建；後端最多快取 10 分鐘）。

## 建置：Vercel
1. 到 [Google AI Studio](https://aistudio.google.com/apikey) 建立 API 金鑰。
2. vercel.com 用 GitHub 登入 → Add New → Project → 匯入 `yosi067/getTicket`。專案名稱需全小寫，只能用英數與 `.` `_` `-`。其他保持預設（已有 `vercel.json`）。
3. Settings → Environment Variables 新增：
   - `GEMINI_API_KEY`（必填，貼上金鑰；請直接貼在 Vercel 網頁，不要貼到對話或 repo）
   - `ALLOWED_ORIGIN`（選填，預設 `https://yosi067.github.io`，多個以逗號分隔）
   - `GEMINI_MODEL`（選填，預設 `gemini-3.5-flash-lite`）
   - `SITE_URL`（選填，預設 `https://yosi067.github.io/getTicket`，用來讀 `chat-context.json`）
4. 改環境變數後要 Deployments → Redeploy 才會生效。
5. Settings → Deployment Protection：關閉 Vercel Authentication，否則公開請求會回 401。
6. 取得正式網址（Settings → Domains，形如 `https://xxx.vercel.app`）。
7. GitHub repo → Settings → Secrets and variables → Actions → Variables 新增 `CHAT_API_URL` = `https://xxx.vercel.app/api/chat`，再到 Actions 重跑 Pages 部署。

之後每次推送 `main`，Vercel 會自動重新部署函式。

## 建置：Cloudflare Worker（替代方案）
```bash
cd server
npx wrangler login
npx wrangler secret put GEMINI_API_KEY   # 貼上金鑰
npx wrangler deploy
```
取得 `https://ticketwar-chat.<帳號>.workers.dev` 後，`CHAT_API_URL` 設為該網址加 `/chat`。設定值在 [wrangler.toml](wrangler.toml)。

## 調整客服行為
- 回答風格、範圍、追問規則：改 [chat-core.mjs](chat-core.mjs) 的 `buildSystemPrompt`。
- 網站說明內容（客服依此回答「怎麼用」）：改 [site-guide.md](site-guide.md)。
- 預設模型：`api/chat.js`、`worker.js`、`wrangler.toml` 的 `GEMINI_MODEL`；可用模型見 [Gemini 模型清單](https://ai.google.dev/gemini-api/docs/models)。
- 快速提問按鈕：`site/index.html` 內 `chat()` 的 `quick` 清單。
- 改完請跑 `npm test`，推送後重建即生效。

## 本機測試
```bash
npm test                                  # 客服核心與後端測試（不會呼叫真正的 Gemini）
cd server && npx wrangler dev             # Worker 本機啟動；金鑰寫在 server/.dev.vars（已被 .gitignore 排除）
```
實際呼叫：
```bash
curl -s -X POST https://<你的網址>/api/chat \
  -H 'Origin: https://yosi067.github.io' -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","text":"這個網站怎麼用？"}]}'
```
成功回傳 `{"reply": "...", "followups": [...]}`。

## 疑難排解
失敗時回應會帶 `upstream`（Gemini 狀態碼）與 `detail`（簡短原因），不含金鑰。

| 現象 | 原因與處理 |
| --- | --- |
| 回 401 | Vercel Deployment Protection 擋住，關閉 Vercel Authentication |
| 回 403「不允許的來源」 | 請求的 Origin 不在 `ALLOWED_ORIGIN`；本機測試要自己帶 `Origin` 標頭 |
| 回 503「服務尚未設定」 | 沒有 `GEMINI_API_KEY`，或設定後沒 Redeploy |
| 回 400「訊息不可為空」 | 請求欄位要用 `text`，不是 `content` |
| `upstream` 404 | 模型名稱不可用（舊模型已限縮），改 `GEMINI_MODEL` |
| `upstream` 400 | 請求參數無效；3.x 系列不接受 `thinkingBudget`，已移除 |
| `upstream` 403 / 429 | 金鑰無效或已撤銷 / 超過免費額度或速率，稍後再試或換金鑰 |
| 首頁沒有聊天按鈕 | 建置時沒有 `CHAT_API_URL`（需 https），設好 Variable 後重跑部署 |
| 回答內容過舊 | 觸發一次 Pages 部署重建 `chat-context.json`（後端最多再快取 10 分鐘） |

## 安全與成本
- 金鑰外洩（貼到對話、截圖、commit）要立刻到 Google AI Studio 刪除並重建，再更新環境變數。
- 在 Google 端設定每日用量上限與預算警示；Cloudflare 可另加每 IP 速率限制規則。
- 後端內的限流只是基本防護（各實例獨立計算）。
- 每次提問都會帶整份 `chat-context.json`（約 76 KB），請求量大時 token 用量會比較高；要省可只放近期活動。

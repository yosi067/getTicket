# 客服機器人（Gemini）部署說明

首頁右下角的聊天視窗會呼叫這個 Cloudflare Worker，由 Worker 帶著金鑰去呼叫 Gemini。金鑰只存在 Worker 的 Secret，不在前端、不在 repo。

## 運作方式
1. 網站每次建置會輸出 `chat-context.json`（精簡活動清單 + 網站說明 + 擴充功能手冊節錄）。
2. Worker 收到問題後讀取該檔（快取 10 分鐘），連同系統指令一起送給 Gemini。
3. 系統指令限制只能回答「活動資訊」與「網站怎麼用」，資料裡沒有就說不知道，不得編造。
4. 防濫用：只允許指定網域、單則 300 字、只保留最近 6 則、回覆上限 600 tokens、每 IP 每分鐘 8 次。

## 部署步驟
```bash
cd server
npx wrangler login
npx wrangler secret put GEMINI_API_KEY   # 貼上在 Google AI Studio 新產生的金鑰
npx wrangler deploy
```
部署完會得到網址，例如 `https://ticketwar-chat.<帳號>.workers.dev`。

把該網址設成 GitHub repo 的 Actions Variable：Settings → Secrets and variables → Actions → Variables → 新增 `CHAT_API_URL`，值為 `https://ticketwar-chat.<帳號>.workers.dev/chat`。
下次部署後，首頁就會出現聊天按鈕（沒設定這個變數時不會顯示）。

## 改用 Vercel（免 Cloudflare，可用 GitHub 登入）
repo 內的 [api/chat.js](../api/chat.js) 是 Vercel 版函式，與 Worker 共用同一份核心邏輯。
1. 到 vercel.com 用 GitHub 登入，Add New → Project → 匯入 `yosi067/getTicket`，其他設定保持預設（已有 `vercel.json`）。
2. 專案 Settings → Environment Variables 新增 `GEMINI_API_KEY`（貼上新產生的金鑰，勾 Production），可選 `ALLOWED_ORIGIN`（預設 `https://yosi067.github.io`）。
3. 重新部署（Deployments → Redeploy）。網址形如 `https://<專案>.vercel.app`。
4. GitHub Actions Variable `CHAT_API_URL` 設為 `https://<專案>.vercel.app/api/chat`，重跑 Pages 部署。

## 建議再加的保護
- Google AI Studio / Cloud 端設定每日用量上限與預算警示。
- Cloudflare 儀表板 → Security → WAF → Rate limiting rules，對該 Worker 網址設定每 IP 速率限制（Worker 內的限流只是基本防護）。
- 金鑰若外洩立刻刪除重建，再執行一次 `wrangler secret put`。

## 本機測試
```bash
npm test                       # 含客服核心邏輯與 Worker 的測試（不會呼叫真正的 Gemini）
cd server && npx wrangler dev  # 本機啟動；先在 server/.dev.vars 寫入 GEMINI_API_KEY=...（此檔已被 .gitignore 排除）
```

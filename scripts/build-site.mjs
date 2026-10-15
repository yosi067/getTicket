// 組出 GitHub Pages 靜態網站到 dist-site/：首頁（入口 + 現況分析 + 新聞 + 課程精華）與 app/（售票統整平台）。
// 用法：node scripts/build-site.mjs（需先執行 demo:build 與 news）
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recentSales, toRows, upcomingSales } from './site-stats.mjs';
import { compactEvents } from '../server/chat-core.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-site');
const snap = JSON.parse(await readFile(join(root, 'demo/data/snapshot.json'), 'utf8'));
let news = { fetchedAt: Date.now(), items: [] };
try { news = JSON.parse(await readFile(join(root, 'demo/data/news.json'), 'utf8')); } catch { console.warn('找不到 news.json，首頁將顯示無新聞'); }

const now = Date.now();
const data = {
  fetchedAt: snap.fetchedAt,
  builtAt: now,
  sources: snap.sources ?? {},
  rows: toRows(snap.events),
  upcoming: upcomingSales(snap.events, now),
  recent: recentSales(snap.events, now),
  news,
};
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// 統計函式與 Node 測試共用同一份：去掉 export 後內嵌成頁面全域函式
const statsSrc = (await readFile(join(root, 'scripts/site-stats.mjs'), 'utf8')).replace(/^export\s+/gm, '').replace(/<\/script/gi, '<\\/script');
if (/^import\s/m.test(statsSrc)) throw new Error('site-stats.mjs 不可含 import');

const chatUrl = process.env.CHAT_API_URL ?? '';
if (chatUrl && !/^https:\/\/[^\s'"<>]+$/.test(chatUrl)) throw new Error('CHAT_API_URL 必須是 https 網址');
const tpl = await readFile(join(root, 'site/index.html'), 'utf8');
if (!tpl.includes('/*__DATA__*/null') || !tpl.includes('/*__STATS__*/')) throw new Error('site/index.html 缺少佔位符');

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'app'), { recursive: true });
await writeFile(join(out, 'index.html'), tpl.replace('/*__DATA__*/null', () => safeJson(data)).replace('/*__STATS__*/', () => statsSrc).replace('/*__CHAT_URL__*/\'\'', () => JSON.stringify(chatUrl)));
await copyFile(join(root, 'demo/ticketwar-web.html'), join(out, 'app/index.html'));
await mkdir(join(out, 'report'), { recursive: true });
await copyFile(join(root, 'site/report.html'), join(out, 'report/index.html'));
await writeFile(join(out, '.nojekyll'), '');

// 客服機器人的知識庫：網站說明 + 擴充功能手冊節錄 + 精簡活動清單
const guide = await readFile(join(root, 'server/site-guide.md'), 'utf8');
const manual = (await readFile(join(root, '使用手冊.md'), 'utf8')).slice(0, 6000);
const chatCtx = { builtAt: now, guide: `${guide}\n\n## Chrome 擴充功能手冊（節錄）\n${manual}`, events: compactEvents(snap.events, now) };
await writeFile(join(out, 'chat-context.json'), JSON.stringify(chatCtx));
console.log(`已輸出 ${out}（活動 ${snap.events.length} 筆、新聞 ${news.items.length} 則）`);

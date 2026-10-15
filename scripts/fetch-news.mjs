// 抓取演唱會相關新聞（Google 新聞 RSS，只取標題、來源、時間與連結），寫入 demo/data/news.json。
// 用法：node scripts/fetch-news.mjs
// 失敗時保留舊檔，不會讓建置中斷。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NEWS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'data', 'news.json');
const QUERIES = ['演唱會 開賣', '演唱會 售票', '音樂祭 售票', '演唱會 加場'];
const MAX_ITEMS = 24;

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
  .trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
};

// 只接受 http(s) 連結，避免 javascript: 之類的網址進入頁面
const safeHttp = (u) => (/^https?:\/\//i.test(u) ? u : '');

export function parseRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    let title = tag(block, 'title');
    const source = tag(block, 'source');
    const link = safeHttp(tag(block, 'link'));
    const ts = Date.parse(tag(block, 'pubDate'));
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    if (!title || !link || !Number.isFinite(ts)) continue;
    out.push({ title, source, link, ts });
  }
  return out;
}

export function mergeNews(lists, max = MAX_ITEMS) {
  const seen = new Set();
  return lists.flat()
    .sort((a, b) => b.ts - a.ts)
    .filter((n) => { const k = n.title.replace(/\s+/g, ''); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max);
}

async function fetchQuery(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (getTicket news fetcher)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRss(await res.text());
}

async function main() {
  const lists = [];
  for (const q of QUERIES) {
    try { lists.push(await fetchQuery(q)); } catch (e) { console.warn(`新聞「${q}」抓取失敗：${e.message}`); }
  }
  const items = mergeNews(lists);
  if (!items.length) {
    console.warn('沒有取得任何新聞，沿用舊檔');
    try { await readFile(NEWS_PATH); } catch {
      await mkdir(dirname(NEWS_PATH), { recursive: true });
      await writeFile(NEWS_PATH, `${JSON.stringify({ fetchedAt: Date.now(), items: [] })}\n`);
    }
    return;
  }
  await mkdir(dirname(NEWS_PATH), { recursive: true });
  await writeFile(NEWS_PATH, `${JSON.stringify({ fetchedAt: Date.now(), items })}\n`);
  console.log(`已寫入 ${items.length} 則新聞 → ${NEWS_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

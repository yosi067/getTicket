// 抓取「台灣」演唱會／表演新聞（Google 新聞 RSS，只取標題、來源、時間與連結），寫入 demo/data/news.json。
// 用法：node scripts/fetch-news.mjs
// 過濾原則：排除香港、澳門、中國大陸與其他海外場次，只留台灣媒體或明確的台灣場館／城市／售票平台。
// 失敗時保留舊檔，不會讓建置中斷。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NEWS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'data', 'news.json');
const QUERIES = [
  '台灣 演唱會 售票',
  '小巨蛋 演唱會',
  '高雄 演唱會 開賣',
  '拓元 售票 演唱會',
  'KKTIX 演唱會',
  '台北 音樂祭',
  '演唱會 加場 台北',
  '寬宏 演唱會 售票',
  'OPENTIX 兩廳院 演出',
  '黃牛 演唱會 票 台灣',
].map((q) => `${q} when:30d`);
const MAX_ITEMS = 30;

// 非台灣：標題或來源出現這些字眼就排除
const FOREIGN_TITLE = /香港|紅館|啟德|亞博|九展|港站|港場|港開唱|來港|赴港|在港|抵港|港樂迷|港星|粵語|澳門|大麥|淘票票|微博|大陸|內地|中國大陸|北京|上海|廣州|深圳|成都|杭州|新加坡|馬來西亞|吉隆坡|曼谷|首爾|東京|大阪|橫濱|名古屋|巴黎|倫敦|紐約|洛杉磯/;
const FOREIGN_HOST = /(^|\.)(hk|cn|mo|sg|my|jp|kr)$|hk01|mingpao|singtao|stheadline|hkej|on\.cc|now\.com|rthk|bastillepost|inmediahk|wenweipo|takungpao|thestandard|scmp|sina\.com|163\.com|sohu|qq\.com|ifeng|chinadaily|xinhua|people\.com\.cn|bbc\.com|cnn\.com|nikkei|yahoo\.co\.jp|dotdotnews|eastweek/i;
const FOREIGN_SOURCE = /香港|明報|星島|信報|東方日報|頭條日報|大公|文匯|巴士的報|am730|澳門|新浪|網易|搜狐|騰訊|鳳凰|新華|人民網|南華早報|SCMP|Singtao|Sing Tao|dotdotnews|Eastweek|加拿大|美國|馬來西亞|新加坡/i;

// 台灣訊號：標題出現台灣城市、場館、售票平台，或來源是台灣媒體
const TW_TITLE = /台灣|臺灣|台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄|新竹|基隆|宜蘭|花蓮|台東|屏東|彰化|嘉義|苗栗|雲林|南投|小巨蛋|大巨蛋|南港|大佳河濱|北流|高流|TICC|Legacy|Zepp New Taipei|台北流行音樂中心|高雄流行音樂中心|國家音樂廳|國家戲劇院|兩廳院|拓元|tixCraft|KKTIX|寬宏|年代售票|Ticket ?Plus|遠大|OPENTIX|ibon|FamiPort|大港開唱|火球祭|簡單生活節|海洋音樂祭|貢寮/i;
const TW_HOST = /\.tw$|(^|\.)(udn|ettoday|storm|nownews|thenewslens|mirrormedia|upmedia|setn|ftvnews|chinatimes|ltn|cna|tvbs|pts|cts|ttv|ebc|eranews|ctee|cw|businessweekly|gq|vogue|elle|marieclaire|harpersbazaar|bnext|techbang|mobile01|newtalk|ctwant|pchome|vecos|mtv)\.(com|net|org|mg|tw|com\.tw|tw)$/i;
const TW_SOURCE = /自由時報|聯合新聞網|聯合報|中央社|ETtoday|三立|民視|中時|中國時報|TVBS|風傳媒|鏡報|鏡週刊|公視|華視|台視|東森|蘋果|新頭殼|上報|關鍵評論|天下|遠見|數位時代|噓!?星聞|CTWANT|NOWnews|Newtalk|PChome|緯來|FTNN|蕃新聞|MTV音樂頻道|台灣好新聞|信傳媒|太報|Hit FM|KKBOX|Vogue Taiwan|GQ Taiwan|Elle Taiwan/i;

const TOPICS = [
  ['黃牛與詐騙', /黃牛|詐騙|假票|退票|轉賣|轉售|票務糾紛|防詐/],
  ['加場', /加場|加開|追加/],
  ['音樂祭', /音樂祭|音樂節|大港開唱|火球祭|簡單生活節|草地音樂會|跨年演唱會/],
  ['開賣搶票', /開賣|搶票|售票|預售|票價|門票|開搶|登記|抽選|座位圖|售罄|完售|全完售/],
];
export const classifyTopic = (title) => TOPICS.find(([, re]) => re.test(title))?.[0] ?? '演出消息';

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
  .trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : '';
};
const attr = (block, name, a) => {
  const m = block.match(new RegExp(`<${name}\\s[^>]*${a}="([^"]*)"`));
  return m ? decode(m[1]) : '';
};

// 只接受 http(s) 連結，避免 javascript: 之類的網址進入頁面
const safeHttp = (u) => (/^https?:\/\//i.test(u) ? u : '');
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

// 是否為台灣相關新聞：先排除海外，再要求有台灣訊號
export function isTaiwan({ title, source = '', sourceUrl = '' }) {
  const host = hostOf(sourceUrl);
  if (FOREIGN_TITLE.test(title) || FOREIGN_SOURCE.test(source) || (host && FOREIGN_HOST.test(host))) return false;
  return TW_TITLE.test(title) || TW_SOURCE.test(source) || (host !== '' && TW_HOST.test(host));
}

export function parseRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    let title = tag(block, 'title');
    const source = tag(block, 'source');
    const sourceUrl = attr(block, 'source', 'url');
    const link = safeHttp(tag(block, 'link'));
    const ts = Date.parse(tag(block, 'pubDate'));
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    if (!title || !link || !Number.isFinite(ts)) continue;
    out.push({ title, source, sourceUrl, link, ts });
  }
  return out;
}

export function mergeNews(lists, max = MAX_ITEMS) {
  const seen = new Set();
  return lists.flat()
    .filter(isTaiwan)
    .sort((a, b) => b.ts - a.ts)
    .filter((n) => { const k = n.title.replace(/\s+/g, '').slice(0, 20); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max)
    .map(({ title, source, link, ts }) => ({ title, source, link, ts, topic: classifyTopic(title) }));
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
  console.log(`已寫入 ${items.length} 則台灣新聞 → ${NEWS_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

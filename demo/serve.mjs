// 本機小伺服器：提供 ticketwar.html，並以 /proxy 轉送 Ticket Plus 公開資料（只允許唯讀、白名單路徑），
// 讓頁面的「重新抓取」不受瀏覽器跨網域限制。只綁定 127.0.0.1。
// 用法：node demo/serve.mjs [port]
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAll, updateSnapshot } from './collect.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2]) || 8787;
const API = 'https://apis.ticketplus.com.tw/config/api/v1/getS3?path=';
const ALLOWED = /^(main\/mainEvents|event\/[0-9a-f]{8,40}\/(event|sessions|products|ticketAreas))\.json$/;

// /sources：由本機伺服器一次讀取 Ticket Plus、KKTIX、拓元、OPENTIX 的公開資料（部分網站不提供跨網域存取）。
// 10 分鐘快取並合併同時請求，避免對各平台造成負擔。
const CACHE_MS = 10 * 60e3;
let cache = null;
let inflight = null;
async function getSources() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  inflight ??= collectAll().then((data) => { cache = { at: Date.now(), data }; return data; }).finally(() => { inflight = null; });
  return inflight;
}

// POST /update：抓取全部平台 → 寫入 snapshot.json → 重建兩個 HTML（等同 npm run demo:update）。
// 會改寫本機檔案，所以只接受本機頁面發出的請求（Host/Origin 檢查 + 自訂標頭），並且同時只跑一個。
let updating = null;
const runBuild = () => new Promise((ok, fail) => execFile(process.execPath, [join(dir, 'build.mjs')], (err, out) => (err ? fail(err) : ok(out.trim()))));
async function doUpdate() {
  const snap = await updateSnapshot({ log: (m) => console.log(m) });
  const buildLog = await runBuild();
  cache = { at: Date.now(), data: { fetchedAt: snap.fetchedAt, sources: snap.sources, events: snap.events } };
  console.log(buildLog);
  return { ...cache.data, saved: true, carried: snap.carried };
}
const localHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
function isLocalRequest(req) {
  if (!localHosts.has(req.headers.host ?? '')) return false;
  const origin = req.headers.origin;
  if (origin && !localHosts.has(origin.replace(/^https?:\/\//, ''))) return false;
  return req.headers['x-ticketwar'] === '1';
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/update') {
      if (!isLocalRequest(req)) { res.writeHead(403).end('forbidden'); return; }
      updating ??= doUpdate().finally(() => { updating = null; });
      const data = await updating;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(data));
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (url.pathname === '/' || url.pathname === '/ticketwar.html') {
      const html = await readFile(join(dir, 'ticketwar.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
      return;
    }
    if (url.pathname === '/ping') { res.writeHead(200, { 'content-type': 'text/plain' }).end('ticketwar'); return; }
    if (url.pathname === '/sources') {
      const data = await getSources();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(data));
      return;
    }
    if (url.pathname === '/proxy') {
      const path = url.searchParams.get('path') ?? '';
      if (!ALLOWED.test(path)) { res.writeHead(400).end('bad path'); return; }
      const up = await fetch(API + path, { headers: { accept: 'application/json' } });
      res.writeHead(up.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(Buffer.from(await up.arrayBuffer()));
      return;
    }
    res.writeHead(404).end('not found');
  } catch (e) {
    res.writeHead(502).end(String(e.message ?? e));
  }
}).listen(port, '127.0.0.1', () => console.log(`TicketWar Pro：http://127.0.0.1:${port}/`));

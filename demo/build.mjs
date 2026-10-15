// 把 demo/template.html + extension/shared/lib.js + demo/data/snapshot.json 合併成單一檔案 demo/ticketwar.html。
// 用法：node demo/build.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tpl = await readFile(join(root, 'demo/template.html'), 'utf8');
const libSrc = await readFile(join(root, 'extension/shared/lib.js'), 'utf8');
const snap = JSON.parse(await readFile(join(root, 'demo/data/snapshot.json'), 'utf8'));

if (/^import\s/m.test(libSrc) || /^export\s*\{/m.test(libSrc) || /^export default/m.test(libSrc)) {
  throw new Error('lib.js 含有 import 或 export {…}，build.mjs 的簡易轉換不適用');
}
// 去掉 export 關鍵字，讓純函式成為頁面全域函式
const lib = libSrc.replace(/^export\s+/gm, '').replace(/<\/script/gi, '<\\/script');

// 與頁面 slim() 相同的精簡規則，縮小檔案大小
const slim = (e) => {
  const seen = new Map();
  for (const a of e.areas ?? []) if (!seen.has(a.name)) seen.set(a.name, { name: a.name, price: a.price });
  return {
    eventId: e.eventId, platform: e.platform ?? 'ticketplus', dateOnly: e.dateOnly || undefined, title: e.title, category: e.category, organizers: e.organizers,
    sessions: (e.sessions ?? []).map((s) => ({ dateStart: s.dateStart, dateEnd: s.dateEnd, timeStart: s.timeStart, startsAt: s.startsAt, endsOnMs: s.endsOnMs, venue: s.venue, city: s.city, saleStart: s.saleStart, saleEnd: s.saleEnd })),
    areas: [...seen.values()].slice(0, 40),
    priceMin: e.priceMin, priceMax: e.priceMax, saleStarts: e.saleStarts, saleStart: e.saleStart, saleEnds: e.saleEnds, saleEnd: e.saleEnd,
    startsAt: e.startsAt, endsOnMs: e.endsOnMs, dateStart: e.dateStart, dateEnd: e.dateEnd,
    cities: e.cities, venues: e.venues, image: e.image, url: e.url,
  };
};
const data = { fetchedAt: snap.fetchedAt, source: 'snapshot', sources: snap.sources, events: snap.events.map(slim) };
const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

if (!tpl.includes('/*__LIB__*/') || !tpl.includes('/*__SNAPSHOT__*/null')) throw new Error('template.html 缺少佔位符');
const html = tpl.replace('/*__LIB__*/', () => lib).replace('/*__SNAPSHOT__*/null', () => json);

const markers = /<!--\/?LITE:OFF-->/g;
const full = html.replace(markers, '').replace(/<!--WEB:ON-->[\s\S]*?<!--\/WEB:ON-->/g, '');
const out = join(root, 'demo/ticketwar.html');
await writeFile(out, full);
console.log(`已輸出 ${out}（${(full.length / 1024).toFixed(0)} KB，${data.events.length} 筆活動）`);

// ---- 精簡版：不含即時抓取與題庫編輯、活動只留有開賣日期者加少量其他，適合上傳當作業／Demo ----
const hasSale = (e) => (e.saleStarts ?? []).length > 0 || e.saleStart != null;
const rest = snap.events.filter((e) => !hasSale(e));
const keep = [...snap.events.filter(hasSale), ...rest.slice(0, 40)].map((e) => {
  const s = slim(e);
  s.areas = s.areas.slice(0, 12);
  return s;
});
const liteData = { fetchedAt: snap.fetchedAt, source: 'snapshot', sources: snap.sources, events: keep };
const liteJson = JSON.stringify(liteData).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const liteHtml = tpl
  .replace(/<!--WEB:ON-->[\s\S]*?<!--\/WEB:ON-->/g, '')
  .replace(/<!--LITE:OFF-->[\s\S]*?<!--\/LITE:OFF-->/g, '')
  .replace('TicketWar Pro｜', 'TicketWar Pro Lite｜')
  .replace('/*__LIB__*/', () => lib)
  .replace('/*__SNAPSHOT__*/null', () => liteJson);
const liteOut = join(root, 'demo/ticketwar-lite.html');
await writeFile(liteOut, liteHtml);
console.log(`已輸出 ${liteOut}（${(liteHtml.length / 1024).toFixed(0)} KB，${keep.length} 筆活動）`);

// ---- 網頁版（GitHub Pages）：完整活動資料，但移除需要本機伺服器的「重新抓取」與題庫編輯 ----
const webHtml = tpl
  .replace(/<!--\/?WEB:ON-->/g, '')
  .replace(/<!--LITE:OFF-->[\s\S]*?<!--\/LITE:OFF-->/g, '')
  .replace('/*__LIB__*/', () => lib)
  .replace('/*__SNAPSHOT__*/null', () => json);
const webOut = join(root, 'demo/ticketwar-web.html');
await writeFile(webOut, webHtml);
console.log(`已輸出 ${webOut}（${(webHtml.length / 1024).toFixed(0)} KB，${data.events.length} 筆活動）`);

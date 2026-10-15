// 抓取全部平台公開活動資料，輸出 demo/data/snapshot.json（正規化後）。
// 用法：node demo/snapshot.mjs [--skip-ticketplus] [--only=ticketplus,kktix,tixcraft,opentix]
// 一次更新並重建 HTML：npm run demo:update（也可在 npm run demo 開啟的頁面按「更新並存檔」）
import { ALL_KEYS, SNAPSHOT_PATH, updateSnapshot } from './collect.mjs';

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='))?.slice(7);
let only = onlyArg ? onlyArg.split(',').filter((k) => ALL_KEYS.includes(k)) : [...ALL_KEYS];
if (args.includes('--skip-ticketplus')) only = only.filter((k) => k !== 'ticketplus');

try {
  const snap = await updateSnapshot({ only, log: (m) => console.log(m) });
  console.log(`已寫入 ${snap.events.length} 筆 → ${SNAPSHOT_PATH}`);
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(1);
}

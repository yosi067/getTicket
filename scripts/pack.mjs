// 將 extension/ 打包成 dist/ticketplus-assist-<version>.zip，供他人解壓後「載入未封裝項目」。
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'extension/manifest.json'), 'utf8'));
const out = resolve(root, 'dist', `ticketplus-assist-${version}.zip`);
mkdirSync(resolve(root, 'dist'), { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-q', out, '.', '-x', '*.DS_Store'], { cwd: resolve(root, 'extension'), stdio: 'inherit' });
console.log(`已建立 ${out}`);

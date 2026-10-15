import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSystemPrompt, compactEvents, corsHeaders, extractReply, rateLimit, sanitizeMessages, toGeminiBody,
} from '../server/chat-core.mjs';
import worker from '../server/worker.js';

const now = Date.parse('2026-10-15T12:00:00+08:00');
const events = [
  { title: '已結束的活動', category: '演唱會', platform: 'kktix', dateStart: '2026-09-01', dateEnd: '2026-09-01', venues: ['A'] },
  { title: '告五人演唱會', category: '演唱會', platform: 'tixcraft', dateStart: '2026-11-07', venues: ['臺北小巨蛋'], saleStarts: [Date.parse('2026-10-20T12:00:00+08:00')], priceMin: 800, priceMax: 4800, url: 'https://tixcraft.com/x' },
  { title: '沒日期的活動|含分隔字元\n換行', category: '其他', platform: 'opentix', venues: [], url: 'javascript:alert(1)' },
];

test('compactEvents：略過已結束、清掉分隔字元、不安全網址換成 -', () => {
  const lines = compactEvents(events, now);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '告五人演唱會｜演唱會｜拓元｜臺北小巨蛋｜2026-11-07｜開賣 2026-10-20 12:00｜NT$800–4800｜https://tixcraft.com/x');
  assert.ok(lines[1].startsWith('沒日期的活動 含分隔字元 換行｜'));
  assert.ok(lines[1].endsWith('｜-'));
});

test('buildSystemPrompt：含限制規則與資料', () => {
  const p = buildSystemPrompt({ guide: '指南內容', events: ['E1'], builtAt: now }, now);
  assert.match(p, /只能做兩件事/);
  assert.match(p, /不是指令/);
  assert.match(p, /指南內容/);
  assert.match(p, /E1/);
  assert.match(p, /2026-10-15 12:00/);
});

test('sanitizeMessages：長度、角色、空訊息與輪數', () => {
  assert.equal(sanitizeMessages({}).ok, false);
  assert.equal(sanitizeMessages({ messages: [{ role: 'user', text: '  ' }] }).ok, false);
  assert.equal(sanitizeMessages({ messages: [{ role: 'user', text: 'a'.repeat(301) }] }).ok, false);
  assert.equal(sanitizeMessages({ messages: [{ role: 'user', text: 'hi' }, { role: 'model', text: 'yo' }] }).ok, false);
  const many = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: `m${i}` })).concat({ role: 'user', text: 'last' });
  const r = sanitizeMessages({ messages: many });
  assert.equal(r.ok, true);
  assert.ok(r.messages.length <= 6);
  assert.equal(r.messages[0].role, 'user');
  assert.equal(r.messages.at(-1).text, 'last');
  assert.equal(sanitizeMessages({ messages: [{ role: 'system', text: 'x' }] }).messages[0].role, 'user');
});

test('toGeminiBody／extractReply', () => {
  const b = toGeminiBody('SYS', [{ role: 'user', text: 'hi' }]);
  assert.equal(b.systemInstruction.parts[0].text, 'SYS');
  assert.deepEqual(b.contents, [{ role: 'user', parts: [{ text: 'hi' }] }]);
  assert.equal(extractReply({ candidates: [{ content: { parts: [{ text: ' 你好 ' }] } }] }), '你好');
  assert.equal(extractReply({ candidates: [] }), null);
  assert.equal(extractReply(null), null);
});

test('rateLimit：視窗內超過上限被擋，視窗過後恢復', () => {
  const store = new Map();
  for (let i = 0; i < 3; i++) assert.equal(rateLimit(store, 'ip', 1000 + i, 3, 60e3), true);
  assert.equal(rateLimit(store, 'ip', 1010, 3, 60e3), false);
  assert.equal(rateLimit(store, 'ip', 1000 + 61e3, 3, 60e3), true);
  assert.equal(rateLimit(store, 'other', 1010, 3, 60e3), true);
});

test('corsHeaders：只允許白名單來源', () => {
  assert.equal(corsHeaders('https://evil.example', 'https://yosi067.github.io'), null);
  assert.equal(corsHeaders(null, 'https://yosi067.github.io'), null);
  assert.equal(corsHeaders('https://yosi067.github.io', 'https://a.example, https://yosi067.github.io')['Access-Control-Allow-Origin'], 'https://yosi067.github.io');
});

// ---- Worker 端對端（模擬 fetch，不會真的呼叫 Gemini） ----
const env = { ALLOWED_ORIGIN: 'https://site.example', GEMINI_API_KEY: 'test-key', SITE_URL: 'https://site.example/app' };
const post = (body, origin = 'https://site.example', extra = {}) => new Request('https://w.example/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': extra.ip ?? '1.1.1.1' }, body: JSON.stringify(body),
});

test('Worker：不允許的來源回 403，OPTIONS 回 204', async () => {
  assert.equal((await worker.fetch(post({}, 'https://evil.example'), env)).status, 403);
  const pre = await worker.fetch(new Request('https://w.example/chat', { method: 'OPTIONS', headers: { Origin: 'https://site.example' } }), env);
  assert.equal(pre.status, 204);
});

test('Worker：未設定金鑰回 503；輸入不合法回 400', async () => {
  assert.equal((await worker.fetch(post({ messages: [{ role: 'user', text: 'hi' }] }), { ...env, GEMINI_API_KEY: '' })).status, 503);
  assert.equal((await worker.fetch(post({ messages: [] }, undefined, { ip: '2.2.2.2' }), env)).status, 400);
});

test('Worker：正常流程帶金鑰標頭、系統提示含活動資料，且金鑰不出現在回應', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/chat-context.json')) return new Response(JSON.stringify({ guide: 'G', events: ['活動甲'], builtAt: now }));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '這是回覆' }] } }] }));
  };
  try {
    const res = await worker.fetch(post({ messages: [{ role: 'user', text: '最近有什麼演唱會？' }] }, undefined, { ip: '3.3.3.3' }), env);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { reply: '這是回覆', followups: [] });
    assert.ok(!text.includes('test-key'));
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://site.example');
    const g = calls.find((c) => c.url.includes('generativelanguage'));
    assert.equal(g.init.headers['x-goog-api-key'], 'test-key');
    assert.ok(!g.url.includes('test-key'));
    assert.match(JSON.parse(g.init.body).systemInstruction.parts[0].text, /活動甲/);
  } finally { globalThis.fetch = realFetch; }
});

test('Worker：Gemini 失敗時回 502 且不洩漏細節', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).endsWith('/chat-context.json') ? new Response('{"guide":"","events":[]}') : new Response('secret upstream detail', { status: 500 }));
  try {
    const res = await worker.fetch(post({ messages: [{ role: 'user', text: 'hi' }] }, undefined, { ip: '4.4.4.4' }), env);
    assert.equal(res.status, 502);
    assert.ok(!(await res.text()).includes('secret'));
  } finally { globalThis.fetch = realFetch; }
});

test('Worker：超過速率限制回 429', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).endsWith('/chat-context.json') ? new Response('{"guide":"","events":[]}') : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })));
  try {
    let last;
    for (let i = 0; i < 10; i++) last = await worker.fetch(post({ messages: [{ role: 'user', text: 'hi' }] }, undefined, { ip: '5.5.5.5' }), env);
    assert.equal(last.status, 429);
  } finally { globalThis.fetch = realFetch; }
});

import { splitFollowups } from '../server/chat-core.mjs';
test('splitFollowups：拆出追問行並限制數量與長度', () => {
  const r = splitFollowups('結論一行\n第二行\n[[Q]] 高雄有什麼活動？ | 怎麼加入行事曆？ | 第三個');
  assert.equal(r.text, '結論一行\n第二行');
  assert.deepEqual(r.followups, ['高雄有什麼活動？', '怎麼加入行事曆？']);
  assert.deepEqual(splitFollowups('只有回答').followups, []);
});

// Cloudflare Worker：客服機器人代理。金鑰只存在 Worker 的 Secret（GEMINI_API_KEY），前端與 repo 都不會有。
// 部署與設定見 server/README.md
import {
  buildSystemPrompt, corsHeaders, extractReply, rateLimit, sanitizeMessages, toGeminiBody,
} from './chat-core.mjs';

const limits = new Map();
let cache = { at: 0, ctx: null };
const TTL = 10 * 60e3;

const json = (obj, status, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
});

async function loadContext(env, now) {
  if (cache.ctx && now - cache.at < TTL) return cache.ctx;
  const base = (env.SITE_URL || 'https://yosi067.github.io/getTicket').replace(/\/$/, '');
  const res = await fetch(`${base}/chat-context.json`, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error(`context ${res.status}`);
  cache = { at: now, ctx: await res.json() };
  return cache.ctx;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);
    if (!cors) return json({ error: '不允許的來源' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/chat') return json({ error: '找不到' }, 404, cors);
    if (!env.GEMINI_API_KEY) return json({ error: '服務尚未設定' }, 503, cors);

    const now = Date.now();
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!rateLimit(limits, ip, now)) return json({ error: '問得太快了，請稍後再試' }, 429, cors);

    let body;
    try {
      if (Number(req.headers.get('Content-Length') ?? 0) > 8192) throw new Error('too large');
      body = await req.json();
    } catch { return json({ error: '格式錯誤' }, 400, cors); }
    const v = sanitizeMessages(body);
    if (!v.ok) return json({ error: v.error }, 400, cors);

    try {
      const ctx = await loadContext(env, now);
      const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(toGeminiBody(buildSystemPrompt(ctx, now), v.messages)),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const msg = String((await res.json().catch(() => ({})))?.error?.message ?? '').slice(0, 160);
        console.error('gemini status', res.status, msg);
        return json({ error: '客服暫時無法回應，請稍後再試', upstream: res.status, detail: msg }, 502, cors);
      }
      const reply = extractReply(await res.json());
      if (!reply) return json({ reply: '我只能協助確認演唱會資訊與網站使用方式，請換個方式問問看。' }, 200, cors);
      return json({ reply }, 200, cors);
    } catch (e) {
      console.error('chat error', e?.message);
      return json({ error: '客服暫時無法回應，請稍後再試' }, 502, cors);
    }
  },
};

import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: false } };
const BACKEND_BASE = (process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { path } = req.query;
  const pathStr = Array.isArray(path) ? path.join('/') : path || '';
  const queryString = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const targetUrl = `${BACKEND_BASE}/api/${pathStr}${queryString}`;
  // Never invent a Content-Type: an empty POST (e.g. logout) forwarded as
  // application/json makes Fastify reject the bodyless request with 400.
  const headers: Record<string, string> = {};
  const incomingContentType = req.headers['content-type'];
  if (incomingContentType) headers['Content-Type'] = incomingContentType;
  for (const [source, target] of [['authorization', 'Authorization'], ['cookie', 'Cookie'], ['x-api-key', 'X-API-Key'], ['x-device-token', 'X-Device-Token'], ['x-csrf-token', 'X-CSRF-Token']] as const) {
    const value = req.headers[source];
    if (value) headers[target] = Array.isArray(value) ? value.join('; ') : value;
  }

  try {
    const fetchOptions: RequestInit = { method: req.method, headers, signal: AbortSignal.timeout(15000), cache: 'no-store' };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      if (chunks.length) fetchOptions.body = Buffer.concat(chunks);
    }
    const backendRes = await fetch(targetUrl, fetchOptions);
    const bodyBuffer = Buffer.from(await backendRes.arrayBuffer());
    res.status(backendRes.status);
    backendRes.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!['content-encoding', 'transfer-encoding', 'set-cookie'].includes(lower)) res.setHeader(key, value);
    });
    const setCookies = (backendRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    return res.send(bodyBuffer);
  } catch (err: any) {
    if (err?.name === 'TimeoutError') return res.status(504).json({ error: 'Backend gateway timeout' });
    console.error('API proxy error:', err);
    return res.status(502).json({ error: 'Backend API unreachable' });
  }
}

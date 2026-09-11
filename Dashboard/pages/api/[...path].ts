import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: false } };
const BACKEND_BASE = (process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const AUTH_BODY_MAX_BYTES = 64 * 1024;
const GENERAL_BODY_MAX_BYTES = 1024 * 1024;

class PayloadTooLargeError extends Error {
  code = 'PAYLOAD_TOO_LARGE';
}

/** Read a request body without ever retaining more than maxBytes. */
export async function readLimited(req: NextApiRequest, maxBytes: number): Promise<Buffer | undefined> {
  const contentLengthHeader = req.headers['content-length'];
  const contentLength = Number(Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    req.pause();
    throw new PayloadTooLargeError('Payload too large');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      req.pause();
      throw new PayloadTooLargeError('Payload too large');
    }
    chunks.push(buffer);
  }

  return chunks.length ? Buffer.concat(chunks, totalBytes) : undefined;
}

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
      const isAuthRoute = pathStr === 'auth' || pathStr.startsWith('auth/');
      const body = await readLimited(req, isAuthRoute ? AUTH_BODY_MAX_BYTES : GENERAL_BODY_MAX_BYTES);
      if (body) fetchOptions.body = body;
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
    if (err?.code === 'PAYLOAD_TOO_LARGE') return res.status(413).json({ error: 'Payload too large' });
    if (err?.name === 'TimeoutError') return res.status(504).json({ error: 'Backend gateway timeout' });
    console.error('API proxy error:', err);
    return res.status(502).json({ error: 'Backend API unreachable' });
  }
}

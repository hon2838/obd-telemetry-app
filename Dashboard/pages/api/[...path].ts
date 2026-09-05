import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: {
    bodyParser: false,
  },
};

const BACKEND_BASE = (
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://127.0.0.1:3000'
).replace(/\/$/, '');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { path } = req.query;
  const pathStr = Array.isArray(path) ? path.join('/') : path || '';
  const queryString = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const targetUrl = `${BACKEND_BASE}/api/${pathStr}${queryString}`;

  const headers: Record<string, string> = {
    'Content-Type': req.headers['content-type'] || 'application/json',
  };

  if (req.headers['authorization']) {
    headers['Authorization'] = req.headers['authorization'] as string;
  }
  if (req.headers['x-api-key']) {
    headers['X-API-Key'] = req.headers['x-api-key'] as string;
  }
  if (req.headers['x-device-token']) {
    headers['X-Device-Token'] = req.headers['x-device-token'] as string;
  }

  try {
    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(15000),
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      if (chunks.length > 0) {
        fetchOptions.body = Buffer.concat(chunks);
      }
    }

    const backendRes = await fetch(targetUrl, fetchOptions);
    const bodyBuffer = Buffer.from(await backendRes.arrayBuffer());

    res.status(backendRes.status);
    backendRes.headers.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (lower !== 'content-encoding' && lower !== 'transfer-encoding') {
        res.setHeader(key, val);
      }
    });
    return res.send(bodyBuffer);
  } catch (err: any) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'Backend gateway timeout' });
    }
    console.error('API proxy error:', err);
    return res.status(502).json({ error: 'Backend API unreachable' });
  }
}

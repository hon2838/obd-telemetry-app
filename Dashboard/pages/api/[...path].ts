import type { NextApiRequest, NextApiResponse } from 'next';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { path } = req.query;
  const pathStr = Array.isArray(path) ? path.join('/') : path || '';
  const queryString = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  
  const backendBase = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://server:3000';
  const backendUrl = `${backendBase.replace(/\/$/, '')}/api/${pathStr}${queryString}`;

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

    const backendRes = await fetch(backendUrl, fetchOptions);
    const data = await backendRes.text();

    res.status(backendRes.status);
    backendRes.headers.forEach((val, key) => {
      const lower = key.toLowerCase();
      if (lower !== 'content-encoding' && lower !== 'transfer-encoding') {
        res.setHeader(key, val);
      }
    });
    return res.send(data);
  } catch (err: any) {
    console.error('API proxy error:', err);
    return res.status(502).json({ error: 'Backend API unreachable' });
  }
}

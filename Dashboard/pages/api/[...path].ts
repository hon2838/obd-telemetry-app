import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: false } };
const BACKEND_BASE = (process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const AUTH_BODY_MAX_BYTES = 64 * 1024;
const GENERAL_BODY_MAX_BYTES = 1024 * 1024;
const PROXY_TIMEOUT_MS = 15000;

export class PayloadTooLargeError extends Error {
  code = 'PAYLOAD_TOO_LARGE';
}

/** Read a request body without ever retaining more than maxBytes, bounded by signal. */
export async function readLimited(
  req: NextApiRequest,
  maxBytes: number,
  signal?: AbortSignal
): Promise<Buffer | undefined> {
  if (signal?.aborted) {
    throw signal.reason || new DOMException('Request aborted', 'AbortError');
  }

  const contentLengthHeader = req.headers['content-length'];
  const contentLength = Number(Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    req.pause();
    throw new PayloadTooLargeError('Payload too large');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  return new Promise<Buffer | undefined>((resolve, reject) => {
    let settled = false;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      req.pause();
      reject(signal?.reason || new DOMException('Request aborted', 'AbortError'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const onData = (chunk: any) => {
      if (settled) return;
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        settled = true;
        cleanup();
        req.pause();
        reject(new PayloadTooLargeError('Payload too large'));
        return;
      }
      chunks.push(buffer);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(chunks.length ? Buffer.concat(chunks, totalBytes) : undefined);
    };

    const onError = (err: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);

    if (req.readableEnded && chunks.length === 0) {
      settled = true;
      cleanup();
      resolve(undefined);
      return;
    }

    req.resume();
  });
}

function waitForDrain(res: NextApiResponse, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (res.destroyed) return Promise.reject(new DOMException('Client disconnected', 'AbortError'));

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      res.off('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new DOMException('Client disconnected', 'AbortError')); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onAbort = () => { cleanup(); reject(signal.reason); };

    res.once('drain', onDrain);
    res.once('close', onClose);
    res.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function streamBackendBody(
  body: ReadableStream<Uint8Array>,
  res: NextApiResponse,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (done) break;
      if (res.destroyed || res.writableEnded) {
        throw new DOMException('Client disconnected', 'AbortError');
      }
      if (value && !res.write(Buffer.from(value))) {
        await waitForDrain(res, signal);
      }
    }
    if (!res.writableEnded) res.end();
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
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
  headers['Accept-Encoding'] = 'identity';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException('Gateway timeout', 'TimeoutError'));
  }, PROXY_TIMEOUT_MS);

  const onClientDisconnect = () => {
    if (!res.writableEnded) {
      controller.abort(new DOMException('Client disconnected', 'AbortError'));
    }
  };

  req.on('aborted', onClientDisconnect);
  res.on('close', onClientDisconnect);

  try {
    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
      signal: controller.signal,
      cache: 'no-store'
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const isAuthRoute = pathStr === 'auth' || pathStr.startsWith('auth/');
      const body = await readLimited(req, isAuthRoute ? AUTH_BODY_MAX_BYTES : GENERAL_BODY_MAX_BYTES, controller.signal);
      if (body) fetchOptions.body = body;
    }

    const backendRes = await fetch(targetUrl, fetchOptions);

    res.status(backendRes.status);
    backendRes.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!['content-encoding', 'transfer-encoding', 'set-cookie'].includes(lower)) {
        res.setHeader(key, value);
      }
    });
    const setCookies = (backendRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    if (!res.hasHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'no-store');
    }

    if (!backendRes.body || req.method === 'HEAD' || backendRes.status === 204 || backendRes.status === 304) {
      res.end();
      return;
    }

    await streamBackendBody(backendRes.body, res, controller.signal);
  } catch (err: any) {
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.destroy(err instanceof Error ? err : undefined);
      }
      return;
    }

    if (err?.code === 'PAYLOAD_TOO_LARGE') {
      return res.status(413).json({ error: 'Payload too large' });
    }

    const isTimeout = err?.name === 'TimeoutError' || controller.signal.reason?.name === 'TimeoutError';
    if (isTimeout) {
      return res.status(504).json({ error: 'Backend gateway timeout' });
    }

    const isClientAbort =
      (err?.name === 'AbortError' || controller.signal.reason?.name === 'AbortError') &&
      (req.destroyed || res.destroyed || controller.signal.reason?.message === 'Client disconnected');
    if (isClientAbort) {
      if (!res.writableEnded) res.end();
      return;
    }

    console.error('API proxy error:', err);
    return res.status(502).json({ error: 'Backend API unreachable' });
  } finally {
    clearTimeout(timeoutId);
    req.off('aborted', onClientDisconnect);
    res.off('close', onClientDisconnect);
  }
}

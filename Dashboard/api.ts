export function getApiHost(): string {
  if (typeof window !== 'undefined') return '';
  return (process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
}

export const API_HOST = getApiHost();

let csrfToken: string | null = null;

export interface ApiErrorBody {
  error?: string;
  code?: string;
  [key: string]: unknown;
}

export class ApiResponseError extends Error {
  status: number;
  body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error || `HTTP ${status}`);
    this.name = 'ApiResponseError';
    this.status = status;
    this.body = body;
  }
}

export function setCsrfToken(token?: string | null) {
  csrfToken = token || null;
}

export function getCsrfToken() {
  return csrfToken;
}

async function responseBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    const value = await response.json();
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** Same-origin API helper. Cookies are the primary browser session transport. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const method = (init.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && csrfToken && !headers.has('x-csrf-token')) {
    headers.set('x-csrf-token', csrfToken);
  }
  const response = await fetch(input, {
    ...init,
    headers,
    credentials: 'include',
  });

  // Login, me, and password-change responses can rotate the CSRF token.
  const token = response.headers.get('x-csrf-token');
  if (token) setCsrfToken(token);
  return response;
}

export async function apiJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(input, init);
  const body = await responseBody(response);
  if (!response.ok) throw new ApiResponseError(response.status, body);
  return body as T;
}

export function applyAuthResponse(body: { csrfToken?: string | null }) {
  setCsrfToken(body?.csrfToken);
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError' || (error as { name?: string })?.name === 'AbortError';
}

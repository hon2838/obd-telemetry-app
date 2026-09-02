export function getApiHost(): string {
  if (typeof window !== 'undefined') {
    return '';
  }

  if (process.env.INTERNAL_API_URL) {
    return process.env.INTERNAL_API_URL;
  }

  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  return 'http://127.0.0.1:3000';
}

export const API_HOST = getApiHost();

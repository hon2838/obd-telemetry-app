export function getApiHost(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  if (typeof window === 'undefined') {
    return 'http://localhost:3000';
  }

  if (window.location.hostname === 'obd.hon2838.name.my') {
    return `${window.location.protocol}//obd-api.hon2838.name.my`;
  }

  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

export const API_HOST = getApiHost();

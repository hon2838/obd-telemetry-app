// Liveness + readiness probe for the dashboard. Returns 200
// with a tiny JSON body when the Next.js process is alive and
// able to serve requests. Used by the container HEALTHCHECK
// and external uptime monitors.
//
// This page is excluded from the auth middleware via the
// `matcher` negative-lookahead in middleware.ts, so a probe
// can call it without credentials.
import type { GetServerSideProps } from 'next';

const PACKAGE_VERSION = require('../package.json').version;
const BUILD_COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT || 'unknown';
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || 'unknown';

export default function HealthzPage() {
  // The page itself is never rendered (we return JSON via
  // getServerSideProps), but Next.js requires a default export.
  return null;
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  res.end(JSON.stringify({
    status: 'ok',
    service: 'obd-telemetry-dashboard',
    version: PACKAGE_VERSION,
    build_commit: BUILD_COMMIT,
    build_time: BUILD_TIME,
  }));
  return { props: {} };
};

import React, { useState, useEffect } from 'react';
import { WifiOff, Radio, Clock, Info } from 'lucide-react';

export const STALE_THRESHOLD_MS = 90 * 1000;

export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ago`;
}

interface DataFreshnessProps {
  connectionOk: boolean;
  timestamp: number | null;
  receivedAt?: number | null;
  vehicleName?: string;
}

export default function DataFreshness({ connectionOk, timestamp, receivedAt, vehicleName }: DataFreshnessProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const isValidTimestamp = typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0;
  const age = isValidTimestamp ? now - timestamp : null;
  const isFresh = connectionOk && age !== null && age >= 0 && age <= STALE_THRESHOLD_MS;
  const isOutage = !connectionOk;

  const isValidReceivedAt = typeof receivedAt === 'number' && Number.isFinite(receivedAt) && receivedAt > 0;

  let stateTitle = 'Recent sample';
  let stateSubtext = '';
  let stateExplanation = '';
  let statusTone: 'fresh' | 'stale' | 'outage' = 'fresh';

  if (isOutage) {
    stateTitle = 'Cannot reach server';
    stateSubtext = 'Showing last loaded readings';
    stateExplanation = 'The dashboard cannot reach the telemetry API server. The readings shown below are from its last successful response.';
    statusTone = 'outage';
  } else if (isFresh) {
    stateTitle = 'Recent sample';
    stateSubtext = `Recorded ${new Date(timestamp!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${formatAge(age!)})`;
    stateExplanation = 'A recent measurement is available. Values reflect the latest uploaded sample, rather than a guaranteed continuous link to the vehicle.';
    statusTone = 'fresh';
  } else {
    stateTitle = 'No recent vehicle data';
    if (isValidTimestamp && age !== null && age < 0) {
      stateSubtext = `Future timestamp recorded · ${new Date(timestamp!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } else if (isValidTimestamp && age !== null) {
      stateSubtext = `Latest recorded sample · ${new Date(timestamp!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${formatAge(age)})`;
    } else {
      stateSubtext = 'Awaiting initial telemetry upload';
    }
    stateExplanation = 'The vehicle has not sent recent measurements. It may still be recording offline; uploads appear after it reconnects. Unsent records cannot be confirmed from the dashboard.';
    statusTone = 'stale';
  }

  return (
    <section className={`data-freshness-bar data-freshness-${statusTone}`} aria-label="Data freshness">
      <div className="data-freshness-main">
        <div className="data-freshness-indicator">
          <span className={`status-dot status-dot-${statusTone}`} aria-hidden="true" />
          <strong className="data-freshness-title">{stateTitle}</strong>
        </div>
        <div className="data-freshness-subtext">
          <span>{stateSubtext}</span>
          {isValidReceivedAt && receivedAt !== timestamp && (
            <span className="data-freshness-received">
              · Received by server {new Date(receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      <details className="data-freshness-details">
        <summary className="data-freshness-summary">
          <Info size={13} aria-hidden="true" />
          <span>Data status</span>
        </summary>
        <p className="data-freshness-explanation">{stateExplanation}</p>
      </details>
    </section>
  );
}

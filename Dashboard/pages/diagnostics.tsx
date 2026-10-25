import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import Head from 'next/head';
import Pagination from '../components/Pagination';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Dialog from '../components/Dialog';
import { apiFetch } from '../api';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { useVehicle } from '../context/VehicleContext';
import {
  AlertTriangle, CheckCircle, RefreshCw, Trash2, ArrowLeft, Terminal, ShieldAlert, AlertCircle, Clock, Car, Shield
} from 'lucide-react';

interface DtcDetails {
  code: string;
  description: string;
  severity: 'info' | 'moderate' | 'severe';
  system: string;
}

interface HistoryItem {
  id: string;
  timestamp: number;
  type: 'read' | 'clear';
  codes: string[];
  success: boolean;
  error?: string;
}

interface DiagnosticsData {
  latest: {
    latestDtc: { code: string; timestamp: number | null };
    latestReadStatus?: { success: boolean | null; timestamp: number | null; error?: string };
    latestClearStatus: { success: boolean | null; timestamp: number | null };
  };
  history: HistoryItem[];
}

interface DiagnosticCommand {
  id: string;
  command: 'read_dtc' | 'clear_dtc';
  status: 'pending' | 'completed' | 'failed' | 'unknown' | 'expired';
  createdAt: number;
  updatedAt: number;
}

export default function DiagnosticsDashboard() {
  const { vehicles, activeVehicleId, activeVehicle, buildUrl } = useVehicle();
  const selectedVehicle = vehicles.find(vehicle => vehicle.id === activeVehicleId) || null;
  const activeScopeRef = useRef(activeVehicleId);
  activeScopeRef.current = activeVehicleId;
  const [data, setData] = useState<DiagnosticsData>({
    latest: {
      latestDtc: { code: "", timestamp: null },
      latestClearStatus: { success: null, timestamp: null }
    },
    history: []
  });

  const [activeDtcDetails, setActiveDtcDetails] = useState<DtcDetails[]>([]);
  const [commandLoading, setCommandLoading] = useState<string | null>(null);
  const [commandPolling, setCommandPolling] = useState(false);
  const [recentCommands, setRecentCommands] = useState<DiagnosticCommand[]>([]);
  const [error, setError] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastDtcCodesRef = useRef('');

  useEffect(() => {
    setHistoryPage(1);
  }, [activeVehicleId]);

  const reversedHistory = useMemo(() => {
    return data.history.slice().reverse();
  }, [data.history]);

  const paginatedHistory = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize;
    return reversedHistory.slice(start, start + historyPageSize);
  }, [reversedHistory, historyPage, historyPageSize]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const fetchDtcDetails = async (codes: string[], signal?: AbortSignal) => {
    const codeKey = [...codes].sort().join(',');
    if (codeKey === lastDtcCodesRef.current) return;
    if (codes.length === 0) {
      lastDtcCodesRef.current = '';
      setActiveDtcDetails([]);
      return;
    }
    const res = await apiFetch('/api/dtc/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes }),
      signal,
    });
    if (!res.ok) throw new Error(`DTC lookup HTTP ${res.status}`);
    const details = await res.json();
    if (signal?.aborted) return;
    setActiveDtcDetails(details);
    lastDtcCodesRef.current = codeKey;
  };

  const fetchData = async (signal: AbortSignal) => {
    const [res, commandRes] = await Promise.all([
      apiFetch(buildUrl('/api/telemetry/dtc'), { signal }),
      apiFetch(buildUrl('/api/commands/status'), { signal }),
    ]);
    if (!res.ok) throw new Error(`Diagnostics HTTP ${res.status}`);
    if (commandRes.ok) {
      const commandData = await commandRes.json();
      if (signal.aborted) return;
      setRecentCommands(Array.isArray(commandData.commands) ? commandData.commands : []);
    }
    const d = await res.json();
    if (signal.aborted) return;
    setData(d || { latest: { latestDtc: { code: "", timestamp: null }, latestClearStatus: { success: null, timestamp: null } }, history: [] });
    const currentCodeStr = d.latest?.latestDtc?.code || "";
    const codes = currentCodeStr && currentCodeStr !== 'No trouble codes found' && currentCodeStr !== 'No DTCs'
      ? currentCodeStr.split(/[,\s]+/).map((c: string) => c.trim().toUpperCase()).filter((c: string) => /^[PBCU][0-3][0-9A-F]{3}$/.test(c))
      : [];
    await fetchDtcDetails(codes, signal);
  };

  const pollingInterval = useCallback(() => commandPolling ? 3000 : 30000, [commandPolling]);

  useEffect(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
    lastDtcCodesRef.current = '';
    setActiveDtcDetails([]);
    setRecentCommands([]);
    setCommandPolling(false);
    setData({ latest: { latestDtc: { code: '', timestamp: null }, latestClearStatus: { success: null, timestamp: null } }, history: [] });
    setShowClearConfirm(false);
    setCommandLoading(null);
    setError('');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, [activeVehicleId]);

  useVisibilityPolling(fetchData, pollingInterval, [activeVehicleId, buildUrl, commandPolling, pollingInterval]);

  const queueCommand = async (command: 'read_dtc' | 'clear_dtc') => {
    if (!selectedVehicle) {
      setError('Select a specific vehicle before requesting diagnostic commands.');
      return;
    }
    const targetVehicleId = selectedVehicle.id;
    setError('');
    setCommandLoading(command);
    try {
      const payload = { command, vehicleId: targetVehicleId };

      const res = await apiFetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (activeScopeRef.current !== targetVehicleId) return;
      if (res.ok) {
        setCommandPolling(true);
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(() => {
          setCommandPolling(false);
        }, 60000);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setCommandLoading(null);
        }, 3000);
      } else {
        try {
          const errData = await res.json();
          setError(errData.error || 'Failed to queue command.');
        } catch (e) {
          setError('Failed to queue command (Server Error).');
        }
        setCommandLoading(null);
      }
    } catch (err) {
      if (activeScopeRef.current === targetVehicleId) {
        setError('Network error, could not reach API server.');
        setCommandLoading(null);
      }
    }
  };

  const getSeverityBadge = (sev: DtcDetails['severity']) => {
    switch (sev) {
      case 'info':
        return <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'var(--surface-control)', color: 'var(--accent-blue)', border: '1px solid var(--border)', fontSize: '0.75rem', fontWeight: 600 }}>Info</span>;
      case 'moderate':
        return <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)', border: '1px solid var(--accent-amber)', fontSize: '0.75rem', fontWeight: 600 }}>Moderate</span>;
      case 'severe':
        return <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'var(--accent-red-bg)', color: 'var(--accent-red)', border: '1px solid var(--accent-red)', fontSize: '0.75rem', fontWeight: 600 }}>Severe</span>;
    }
  };

  const currentCodeStr = data.latest.latestDtc?.code || "";
  const latestRead = data.latest.latestReadStatus;
  const lastReadEvent = [...data.history].filter(event => event.type === 'read').sort((a, b) => b.timestamp - a.timestamp)[0];
  const readFailed = latestRead?.success === false || (!latestRead && lastReadEvent?.success === false);
  const confirmedEmpty = !readFailed && !!data.latest.latestDtc?.timestamp &&
    (/^(no trouble codes found|no dtcs)$/i.test(currentCodeStr.trim()) || currentCodeStr.trim() === '') &&
    activeDtcDetails.length === 0;
  const hasActiveDtc = activeDtcDetails.length > 0;

  const currentVehicleName = selectedVehicle?.name || 'Select a vehicle';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Head>
        <title>Diagnostics & Codes | OBD Telemetry</title>
        <meta name="description" content="Read and clear engine diagnostic trouble codes" />
      </Head>

      <PageHeader
        title="Diagnostics & Codes"
        subtitle="Read fault codes, review trouble descriptions, and issue ECU diagnostic commands."
      />

      {/* Main Grid: Commands on left, Active Codes on right */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))',
        gap: '1rem'
      }}>
        {/* Command Panel */}
        <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }} aria-label="Diagnostic commands">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Terminal size={18} color="var(--accent-cyan)" />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Diagnostic Commands
            </h2>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => queueCommand('read_dtc')}
              disabled={!selectedVehicle || commandLoading !== null}
              className="btn-primary"
              style={{ flex: 1, minWidth: '160px', padding: '0.65rem 0.85rem' }}
            >
              <RefreshCw size={15} className={commandLoading === 'read_dtc' ? 'spin' : ''} />
              <span>{commandLoading === 'read_dtc' ? 'Querying...' : 'Read fault codes (Mode 03)'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              disabled={!selectedVehicle || commandLoading !== null}
              className="btn-danger"
              style={{ flex: 1, minWidth: '160px', padding: '0.65rem 0.85rem' }}
            >
              <Trash2 size={15} className={commandLoading === 'clear_dtc' ? 'spin' : ''} />
              <span>{commandLoading === 'clear_dtc' ? 'Queueing Clear...' : 'Clear fault codes (Mode 04)'}</span>
            </button>
          </div>

          {!selectedVehicle && <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Choose a specific vehicle from the header to read or clear its fault codes.</p>}
          {error && <div className="form-error">{error}</div>}

          <div style={{
            background: 'var(--surface-inset)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.85rem',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
            fontSize: '0.8rem'
          }}>
            {recentCommands.length > 0 && (
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Recent command status:
                </div>
                {recentCommands.slice(0, 4).map(item => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {item.command === 'clear_dtc' ? 'Clear codes' : 'Read codes'} · {new Date(item.createdAt).toLocaleTimeString()}
                    </span>
                    <span style={{
                      fontWeight: 600,
                      color: item.status === 'completed' ? 'var(--accent-green)' : item.status === 'failed' || item.status === 'unknown' ? 'var(--accent-amber)' : 'var(--text-muted)'
                    }}>
                      {item.status === 'unknown' ? 'Outcome unknown — check vehicle before retrying'
                        : item.status === 'expired' ? 'Expired — device outcome unconfirmed'
                        : item.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.35rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Latest Scan Attempt:</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                {(latestRead?.timestamp || data.latest.latestDtc?.timestamp)
                  ? `${new Date((latestRead?.timestamp || data.latest.latestDtc.timestamp)!).toLocaleTimeString()}${readFailed ? ' (Failed)' : ''}`
                  : 'Never polled'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-muted)' }}>Last Clear Request:</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                {data.latest.latestClearStatus?.timestamp
                  ? `${new Date(data.latest.latestClearStatus.timestamp).toLocaleTimeString()} (${data.latest.latestClearStatus.success ? 'Success' : 'Failed'})`
                  : 'None'}
              </span>
            </div>
          </div>
        </section>

        {/* Current Trouble Codes Panel */}
        <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }} aria-label="Active trouble codes">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {hasActiveDtc || !confirmedEmpty ? (
              <AlertTriangle size={18} color="var(--accent-amber)" />
            ) : (
              <CheckCircle size={18} color="var(--accent-green)" />
            )}
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Diagnostic status
            </h2>
          </div>

          {readFailed && (
            <div className="form-error" role="status">
              <strong>Latest DTC scan failed.</strong>
              <p>{data.latest.latestReadStatus?.error || 'The vehicle could not complete the scan. Check the adapter connection.'}</p>
              <p>{hasActiveDtc ? 'Previous confirmed fault codes (historical).' : 'Fault status unknown'}</p>
            </div>
          )}
          {hasActiveDtc ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {activeDtcDetails.map(dtc => (
                <div
                  key={dtc.code}
                  style={{
                    padding: '0.85rem',
                    background: 'var(--surface-inset)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.35rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <strong style={{ fontSize: '1.05rem', color: 'var(--accent-red)', fontFamily: 'monospace' }}>
                        {dtc.code}
                      </strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{dtc.system}</span>
                    </div>
                    {getSeverityBadge(dtc.severity)}
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                    {dtc.description}
                  </p>
                </div>
              ))}
            </div>
          ) : confirmedEmpty ? (
            <div style={{
              padding: '2rem 1.5rem',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <CheckCircle size={32} color="var(--accent-green)" />
              <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                No Fault Codes Detected
              </strong>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', maxWidth: '40ch' }}>
                The ECU reported no trouble codes during its last scan.
              </span>
            </div>
          ) : readFailed ? (
            <div style={{
              padding: '1.5rem',
              background: 'var(--accent-amber-bg)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--accent-amber)',
              color: 'var(--accent-amber)',
              fontSize: '0.85rem'
            }}>
              <strong>Check the adapter connection before retrying.</strong>
              <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', color: 'var(--accent-amber)' }}>
                The vehicle could not complete the diagnostic scan. Ensure adapter connection and ignition status.
              </p>
            </div>
          ) : (
            <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              <strong style={{ display: 'block' }}>Fault status unknown</strong>
              No diagnostic scan data received yet. Click "Read fault codes" above to query the ECU.
            </div>
          )}
        </section>
      </div>

      {/* History Log Section */}
      <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }} aria-label="Diagnostics history log">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Clock size={18} color="var(--accent-cyan)" />
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Diagnostics Event History
          </h2>
        </div>

        {reversedHistory.length === 0 ? (
          <EmptyState
            icon={<Clock size={28} />}
            title="No diagnostic history"
            description="Diagnostic scan attempts and clear commands will be logged here chronologically."
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.6rem 0.5rem', fontWeight: 500 }}>Timestamp</th>
                  <th style={{ padding: '0.6rem 0.5rem', fontWeight: 500 }}>Action</th>
                  <th style={{ padding: '0.6rem 0.5rem', fontWeight: 500 }}>Outcome</th>
                  <th style={{ padding: '0.6rem 0.5rem', fontWeight: 500 }}>Codes / Details</th>
                </tr>
              </thead>
              <tbody>
                {paginatedHistory.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.65rem 0.5rem', color: 'var(--text-secondary)' }}>
                      {new Date(item.timestamp).toLocaleString()}
                    </td>
                    <td style={{ padding: '0.65rem 0.5rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                      {item.type === 'clear' ? 'Clear DTC (Mode 04)' : 'Read DTC (Mode 03)'}
                    </td>
                    <td style={{ padding: '0.65rem 0.5rem' }}>
                      <span style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        background: item.success ? 'var(--accent-green-bg)' : 'var(--accent-red-bg)',
                        color: item.success ? 'var(--accent-green)' : 'var(--accent-red)'
                      }}>
                        {item.success ? 'Success' : 'Failed'}
                      </span>
                    </td>
                    <td style={{ padding: '0.65rem 0.5rem' }}>
                      {item.codes && item.codes.length > 0
                        ? item.codes.join(', ')
                        : item.error
                        ? `Scan failed: ${item.error}`
                        : 'No codes'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: '0.75rem' }}>
              <Pagination
                currentPage={historyPage}
                totalItems={reversedHistory.length}
                pageSize={historyPageSize}
                onPageChange={setHistoryPage}
                onPageSizeChange={setHistoryPageSize}
                itemLabel="records"
              />
            </div>
          </div>
        )}
      </section>

      {/* Explicit Confirmation Dialog for Clearing Codes */}
      <Dialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        title={`Clear fault codes for ${currentVehicleName}?`}
        description="Mode 04 Diagnostic Command Confirmation"
        maxWidth="500px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            This queues a request to erase stored diagnostic trouble codes and reset emissions readiness monitors in <strong>{currentVehicleName}</strong>. The head unit can process it after reconnecting. Requests can expire or have an unknown outcome; check the command status before retrying.
          </p>
          <div style={{
            padding: '0.75rem',
            background: 'var(--accent-amber-bg)',
            border: '1px solid var(--accent-amber)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--accent-amber)',
            fontSize: '0.8rem'
          }}>
            <strong>Important notice:</strong> Clearing codes does not fix mechanical or sensor problems. If the underlying fault remains, the Check Engine Light will illuminate again upon subsequent driving cycles.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowClearConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                setShowClearConfirm(false);
                queueCommand('clear_dtc');
              }}
            >
              Confirm Clear Codes
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

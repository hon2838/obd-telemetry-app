import React, { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import { API_HOST } from '../api';
import {
  AlertTriangle, CheckCircle, RefreshCw, Trash2, ArrowLeft, Terminal, ShieldAlert, AlertCircle, Clock
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
}

interface DiagnosticsData {
  latest: {
    latestDtc: { code: string; timestamp: number | null };
    latestClearStatus: { success: boolean | null; timestamp: number | null };
  };
  history: HistoryItem[];
}

export default function DiagnosticsDashboard() {
  const [data, setData] = useState<DiagnosticsData>({
    latest: {
      latestDtc: { code: "", timestamp: null },
      latestClearStatus: { success: null, timestamp: null }
    },
    history: []
  });
  
  const [activeDtcDetails, setActiveDtcDetails] = useState<DtcDetails[]>([]);
  const [commandLoading, setCommandLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const fetchDtcDetails = async (codes: string[]) => {
    try {
      if (codes.length === 0) {
        setActiveDtcDetails([]);
        return;
      }
      const res = await fetch(`${API_HOST}/api/dtc/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes })
      });
      if (res.ok) {
        const details = await res.json();
        setActiveDtcDetails(details);
      }
    } catch (err) {
      console.error('Error looking up DTCs:', err);
    }
  };

  const fetchData = async () => {
    try {
      const res = await fetch(`${API_HOST}/api/telemetry/dtc`);
      if (res.ok) {
        const d = await res.json();
        setData(d);

        // Parse and resolve details for currently active code string
        const currentCodeStr = d.latest.latestDtc?.code || "";
        if (currentCodeStr && currentCodeStr !== "No trouble codes found" && currentCodeStr !== "No DTCs") {
          // Parse codes
          const codes = currentCodeStr
            .split(/[,\s]+/)
            .map((c: string) => c.trim().toUpperCase())
            .filter((c: string) => /^[PBUC]\d{4}$/.test(c));
          
          if (codes.length > 0) {
            fetchDtcDetails(codes);
          } else {
            setActiveDtcDetails([]);
          }
        } else {
          setActiveDtcDetails([]);
        }
      }
    } catch (err) {
      console.error('Error fetching diagnostics data:', err);
    }
  };

  useEffect(() => {
    fetchData();
    // Poll diagnostics status every 3 seconds
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  const queueCommand = async (command: 'read_dtc' | 'clear_dtc') => {
    setError('');
    setCommandLoading(command);
    try {
      const res = await fetch(`${API_HOST}/api/commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ command })
      });
      if (res.ok) {
        // Show command was queued. It will poll and update when app returns result
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setCommandLoading(null);
          fetchData();
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
      setError('Network error, could not reach API server.');
      setCommandLoading(null);
    }
  };

  const getSeverityColor = (sev: DtcDetails['severity']) => {
    switch (sev) {
      case 'info': return 'var(--accent-blue)';
      case 'moderate': return 'var(--accent-amber)';
      case 'severe': return 'var(--accent-red)';
    }
  };

  const currentCodeStr = data.latest.latestDtc?.code || "";
  const hasActiveDtc = currentCodeStr && 
                       currentCodeStr !== "No trouble codes found" && 
                       currentCodeStr !== "No DTCs" &&
                       activeDtcDetails.length > 0;

  return (
    <div style={styles.container}>
      <Head>
        <title>Axia OS | OBD-II Diagnostics</title>
      </Head>

      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div>
            <h1 style={styles.title}>OBD-II Diagnostics</h1>
            <p style={styles.subtitle}>Read, clear, and analyze Engine Trouble Codes</p>
          </div>
        </div>
      </div>

      {/* Commands / Active Status section */}
      <div style={styles.grid}>
        
        {/* Status Card */}
        <div className="glass-panel-static" style={styles.card}>
          <div style={styles.cardHeader}>
            <Terminal size={20} style={{ color: 'var(--accent-cyan)' }} />
            <h2 style={styles.cardTitle}>OBD Ingest Commands</h2>
          </div>
          
          <div style={styles.btnRow}>
            <button 
              onClick={() => queueCommand('read_dtc')} 
              disabled={commandLoading !== null}
              style={{ ...styles.actionBtn, backgroundColor: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)', color: 'var(--accent-blue)' }}
            >
              <RefreshCw size={16} className={commandLoading === 'read_dtc' ? 'spin' : ''} />
              {commandLoading === 'read_dtc' ? 'Queueing Read...' : 'Queue Read DTC (Mode 03)'}
            </button>

            <button 
              onClick={() => queueCommand('clear_dtc')} 
              disabled={commandLoading !== null}
              style={{ ...styles.actionBtn, backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--accent-red)' }}
            >
              <Trash2 size={16} className={commandLoading === 'clear_dtc' ? 'spin' : ''} />
              {commandLoading === 'clear_dtc' ? 'Queueing Clear...' : 'Queue Clear DTC (Mode 04)'}
            </button>
          </div>

          {error && <div style={styles.errorAlert}>{error}</div>}

          <div style={styles.statusSection}>
            <div style={styles.statusRow}>
              <span style={styles.statusLabel}>Latest Poll Result:</span>
              <span style={styles.statusValue}>
                {data.latest.latestDtc?.timestamp 
                  ? new Date(data.latest.latestDtc.timestamp).toLocaleTimeString() 
                  : 'Never polled'}
              </span>
            </div>
            <div style={styles.statusRow}>
              <span style={styles.statusLabel}>Last Clear Request:</span>
              <span style={styles.statusValue}>
                {data.latest.latestClearStatus?.timestamp 
                  ? `${new Date(data.latest.latestClearStatus.timestamp).toLocaleTimeString()} (${data.latest.latestClearStatus.success ? 'Success' : 'Failed'})` 
                  : 'None'}
              </span>
            </div>
          </div>
        </div>

        {/* Current Trouble Codes Panel */}
        <div className="glass-panel-static" style={styles.card}>
          <div style={styles.cardHeader}>
            {hasActiveDtc ? (
              <AlertTriangle size={20} style={{ color: 'var(--accent-red)' }} />
            ) : (
              <CheckCircle size={20} style={{ color: 'var(--accent-green)' }} />
            )}
            <h2 style={styles.cardTitle}>System Diagnostics Status</h2>
          </div>

          {hasActiveDtc ? (
            <div style={styles.dtcList}>
              <div style={styles.warningBox}>
                <ShieldAlert size={18} />
                <span>The Engine Control Unit (ECU) has reported active faults.</span>
              </div>
              
              {activeDtcDetails.map(dtc => (
                <div key={dtc.code} className="glass-panel-static" style={styles.dtcItem}>
                  <div style={styles.dtcItemHeader}>
                    <span style={{ ...styles.dtcBadge, backgroundColor: getSeverityColor(dtc.severity) + '22', color: getSeverityColor(dtc.severity), borderColor: getSeverityColor(dtc.severity) + '44' }}>
                      {dtc.code}
                    </span>
                    <span style={styles.dtcSystem}>{dtc.system}</span>
                    <span style={{ ...styles.dtcSeverity, color: getSeverityColor(dtc.severity) }}>
                      {dtc.severity.toUpperCase()}
                    </span>
                  </div>
                  <p style={styles.dtcDesc}>{dtc.description}</p>
                </div>
              ))}
            </div>
          ) : (
            <div style={styles.noDtcBox}>
              <CheckCircle size={48} style={{ color: 'var(--accent-green)', opacity: 0.8 }} />
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>No Fault Codes Detected</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                All engine and powertrain systems are reporting a healthy status.
              </p>
              {currentCodeStr && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', padding: '4px 8px', backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: '4px' }}>ECU Raw Response: "{currentCodeStr}"</span>}
            </div>
          )}
        </div>
      </div>

      {/* Diagnostics Logs History */}
      <div className="glass-panel-static" style={{ ...styles.card, marginTop: '32px' }}>
        <div style={styles.cardHeader}>
          <Clock size={20} style={{ color: 'var(--accent-purple)' }} />
          <h2 style={styles.cardTitle}>Diagnostics History Logs</h2>
        </div>

        {data.history.length === 0 ? (
          <div style={styles.noHistory}>No historical diagnostic events recorded.</div>
        ) : (
          <div style={styles.historyTimeline}>
            {data.history.slice().reverse().map(event => {
              const timeStr = new Date(event.timestamp).toLocaleString();
              const isRead = event.type === 'read';
              return (
                <div key={event.id} style={styles.timelineItem}>
                  <div style={styles.timelinePoint(isRead ? 'read' : 'clear')}></div>
                  <div style={styles.timelineContent}>
                    <div style={styles.timelineHeader}>
                      <span style={styles.timelineType(isRead ? 'read' : 'clear')}>
                        {isRead ? 'DTC READ SCAN' : 'DTC CLEAR COMMAND'}
                      </span>
                      <span style={styles.timelineTime}>{timeStr}</span>
                    </div>
                    <div style={styles.timelineDetails}>
                      {isRead ? (
                        event.codes.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ color: 'var(--text-primary)' }}>Codes Found:</span>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              {event.codes.map(c => (
                                <span key={c} style={styles.miniBadge}>{c}</span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--accent-green)' }}>No codes found. System Healthy.</span>
                        )
                      ) : (
                        <span>
                          Status: {event.success ? (
                            <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>SUCCESSFULLY CLEARED</span>
                          ) : (
                            <span style={{ color: 'var(--accent-red)', fontWeight: 700 }}>CLEAR COMMAND FAILED / EXECUTING</span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* Dynamic CSS animations */}
      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1.5s linear infinite;
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, any> = {
  container: {
    padding: '32px',
    maxWidth: '1400px',
    margin: '0 auto',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  header: {
    marginBottom: '8px'
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  title: {
    fontSize: '24px',
    fontWeight: 800,
    color: 'var(--text-primary)'
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--text-secondary)'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))',
    gap: '32px',
    marginTop: '16px'
  },
  card: {
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--text-primary)'
  },
  btnRow: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap'
  },
  actionBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 20px',
    borderRadius: '10px',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  errorAlert: {
    padding: '12px',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '8px',
    color: 'var(--accent-red)',
    fontSize: '13px'
  },
  statusSection: {
    borderTop: '1px solid var(--border)',
    paddingTop: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px'
  },
  statusLabel: {
    color: 'var(--text-secondary)'
  },
  statusValue: {
    color: 'var(--text-primary)',
    fontWeight: 600
  },
  warningBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    color: 'var(--accent-red)',
    fontSize: '13px',
    fontWeight: 600
  },
  noDtcBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: '12px',
    padding: '40px 0'
  },
  dtcList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  dtcItem: {
    padding: '16px',
    backgroundColor: 'rgba(255,255,255,0.01)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  dtcItemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  dtcBadge: {
    fontSize: '14px',
    fontWeight: 800,
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid'
  },
  dtcSystem: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    fontWeight: 600
  },
  dtcSeverity: {
    marginLeft: 'auto',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.05em'
  },
  dtcDesc: {
    fontSize: '13px',
    color: 'var(--text-primary)',
    lineHeight: '1.4'
  },
  noHistory: {
    padding: '40px 0',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '14px'
  },
  historyTimeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    paddingLeft: '12px',
    borderLeft: '1px solid var(--border)',
    marginLeft: '12px',
    maxHeight: '400px',
    overflowY: 'auto'
  },
  timelineItem: {
    position: 'relative',
    display: 'flex',
    gap: '16px'
  },
  timelinePoint: (type: 'read' | 'clear') => ({
    position: 'absolute',
    left: '-17px',
    top: '4px',
    width: '9px',
    height: '9px',
    borderRadius: '50%',
    backgroundColor: type === 'read' ? 'var(--accent-red)' : 'var(--accent-green)',
    border: '2px solid #060608',
    boxShadow: `0 0 8px ${type === 'read' ? 'var(--accent-red)' : 'var(--accent-green)'}`
  }),
  timelineContent: {
    flex: 1,
    padding: '12px 16px',
    backgroundColor: 'rgba(255,255,255,0.01)',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.02)'
  },
  timelineHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px',
    alignItems: 'center'
  },
  timelineType: (type: 'read' | 'clear') => ({
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.05em',
    color: type === 'read' ? 'var(--accent-red)' : 'var(--accent-green)'
  }),
  timelineTime: {
    fontSize: '11px',
    color: 'var(--text-muted)'
  },
  timelineDetails: {
    fontSize: '12px',
    color: 'var(--text-secondary)'
  },
  miniBadge: {
    fontSize: '11px',
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: '4px',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    color: 'var(--accent-red)'
  }
};

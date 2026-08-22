import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { API_HOST } from '../api';
import {
  Wrench, CheckCircle, AlertTriangle, AlertOctagon, PlusCircle, Trash2, ArrowLeft, Calendar, Gauge, FileText
} from 'lucide-react';

interface MaintenanceItem {
  id: string;
  name: string;
  intervalKm: number | null;
  intervalDays: number | null;
  lastServiceOdo: number | null;
  lastServiceDate: number | null;
  notes: string;
  createdAt: number;
  updatedAt: number;
  // Computed fields
  currentOdometer: number;
  kmSinceService: number;
  daysSinceService: number;
  kmUntilDue: number | null;
  daysUntilDue: number | null;
  status: 'ok' | 'due_soon' | 'overdue';
}

interface MaintenanceStatus {
  okCount: number;
  dueSoonCount: number;
  overdueCount: number;
  nextUpcoming: {
    name: string;
    kmRemaining: number;
    daysRemaining: number | null;
  } | null;
}

const PRESETS = [
  "Engine Oil & Filter Change",
  "Tire Rotation & Balancing",
  "Brake Pad Replacement",
  "Engine Air Filter Change",
  "Cabin Air Filter Change",
  "Spark Plugs Replacement",
  "Coolant Flush & Replace",
  "Transmission Fluid Change",
  "Battery Replacement"
];

export default function MaintenanceDashboard() {
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [status, setStatus] = useState<MaintenanceStatus>({
    okCount: 0,
    dueSoonCount: 0,
    overdueCount: 0,
    nextUpcoming: null
  });

  const [name, setName] = useState('');
  const [intervalKm, setIntervalKm] = useState('10000');
  const [intervalDays, setIntervalDays] = useState('180');
  const [lastServiceOdo, setLastServiceOdo] = useState('');
  const [lastServiceDate, setLastServiceDate] = useState('');
  const [notes, setNotes] = useState('');
  const [currentOdoVal, setCurrentOdoVal] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const fetchData = async () => {
    try {
      const itemsRes = await fetch(`${API_HOST}/api/maintenance`);
      const itemsData = await itemsRes.json();
      setItems(itemsData);

      const statusRes = await fetch(`${API_HOST}/api/maintenance/status`);
      const statusData = await statusRes.json();
      setStatus(statusData);

      // Extract current odo from first item's computed field
      if (itemsData.length > 0) {
        setCurrentOdoVal(itemsData[0].currentOdometer);
      } else {
        // Fallback: fetch fuel logs to get current odo
        const logsRes = await fetch(`${API_HOST}/api/fuel-logs`);
        if (logsRes.ok) {
          const logsData = await logsRes.json();
          if (logsData.length > 0) {
            setCurrentOdoVal(logsData[0].odometer);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching maintenance data:', err);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!name) {
      setError('Please provide a name for the maintenance item.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_HOST}/api/maintenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          intervalKm: intervalKm ? parseFloat(intervalKm) : null,
          intervalDays: intervalDays ? parseInt(intervalDays) : null,
          lastServiceOdo: lastServiceOdo ? parseFloat(lastServiceOdo) : null,
          lastServiceDate: lastServiceDate ? new Date(lastServiceDate).getTime() : null,
          notes
        })
      });

      if (res.ok) {
        setSuccessMsg('Maintenance item created successfully!');
        setName('');
        setIntervalKm('10000');
        setIntervalDays('180');
        setLastServiceOdo('');
        setLastServiceDate('');
        setNotes('');
        fetchData();
      } else {
        try {
          const errData = await res.json();
          setError(errData.error || 'Failed to submit maintenance item.');
        } catch (e) {
          setError('Failed to submit maintenance item (Server Error).');
        }
      }
    } catch (err) {
      setError('Network error, could not reach API server.');
    } finally {
      setLoading(false);
    }
  };

  const handleMarkServiced = async (id: string) => {
    if (!confirm('Mark this item as completed and reset the counters to current mileage/date?')) return;
    try {
      const res = await fetch(`${API_HOST}/api/maintenance/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markServiced: true })
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Error marking serviced:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this maintenance schedule?')) return;
    try {
      const res = await fetch(`${API_HOST}/api/maintenance/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Error deleting maintenance item:', err);
    }
  };

  const getProgressPercentage = (item: MaintenanceItem) => {
    let kmPercent = 0;
    if (item.intervalKm && item.kmSinceService) {
      kmPercent = (item.kmSinceService / item.intervalKm) * 100;
    }
    
    let daysPercent = 0;
    if (item.intervalDays && item.daysSinceService) {
      daysPercent = (item.daysSinceService / item.intervalDays) * 100;
    }
    
    return Math.min(100, Math.max(kmPercent, daysPercent));
  };

  const getProgressColor = (status: MaintenanceItem['status']) => {
    switch (status) {
      case 'ok': return 'var(--accent-green)';
      case 'due_soon': return 'var(--accent-amber)';
      case 'overdue': return 'var(--accent-red)';
    }
  };

  return (
    <div style={styles.container}>
      <Head>
        <title>Axia OS | Maintenance Hub</title>
      </Head>

      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div>
            <h1 style={styles.title}>Maintenance Hub</h1>
            <p style={styles.subtitle}>Log schedules, track service wear, and get replacement alerts</p>
          </div>
        </div>
      </div>

      {/* Status Cards */}
      <div style={styles.statsRow}>
        <div className="glass-panel-static" style={{ ...styles.statsCard, borderLeft: '4px solid var(--accent-green)' }}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Schedules OK</span>
            <CheckCircle size={20} style={{ color: 'var(--accent-green)' }} />
          </div>
          <span style={styles.statsCardValue}>{status.okCount}</span>
          <span style={styles.statsCardSubtext}>Maintenance intervals healthy</span>
        </div>

        <div className="glass-panel-static" style={{ ...styles.statsCard, borderLeft: '4px solid var(--accent-amber)' }}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Due Soon</span>
            <AlertTriangle size={20} style={{ color: 'var(--accent-amber)' }} />
          </div>
          <span style={styles.statsCardValue}>{status.dueSoonCount}</span>
          <span style={styles.statsCardSubtext}>Within 10% of replacement schedule</span>
        </div>

        <div className="glass-panel-static" style={{ ...styles.statsCard, borderLeft: '4px solid var(--accent-red)' }}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Overdue Items</span>
            <AlertOctagon size={20} style={{ color: 'var(--accent-red)' }} />
          </div>
          <span style={{ ...styles.statsCardValue, color: status.overdueCount > 0 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{status.overdueCount}</span>
          <span style={styles.statsCardSubtext}>Requires immediate service logging</span>
        </div>
      </div>

      {/* Main Grid */}
      <div style={styles.grid}>
        
        {/* Left Column: Create Maintenance Schedule */}
        <div className="glass-panel-static" style={styles.card}>
          <div style={styles.cardHeader}>
            <PlusCircle size={20} style={{ color: 'var(--accent-cyan)' }} />
            <h2 style={styles.cardTitle}>Add Maintenance Schedule</h2>
          </div>

          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.inputGroup}>
              <label htmlFor="maint-name-input" style={styles.label}>Schedule Name</label>
              <input
                id="maint-name-input"
                type="text"
                placeholder="e.g. Engine Oil Change"
                value={name}
                onChange={e => setName(e.target.value)}
                style={styles.input}
                list="presets-list"
              />
              <datalist id="presets-list">
                {PRESETS.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>

            <div style={styles.inputRow}>
              <div style={styles.inputGroup}>
                <label htmlFor="maint-interval-km-input" style={styles.label}>Interval (KM)</label>
                <input
                  id="maint-interval-km-input"
                  type="number"
                  placeholder="e.g. 10000"
                  value={intervalKm}
                  onChange={e => setIntervalKm(e.target.value)}
                  style={styles.input}
                />
              </div>
              <div style={styles.inputGroup}>
                <label htmlFor="maint-interval-days-input" style={styles.label}>Interval (Days)</label>
                <input
                  id="maint-interval-days-input"
                  type="number"
                  placeholder="e.g. 180"
                  value={intervalDays}
                  onChange={e => setIntervalDays(e.target.value)}
                  style={styles.input}
                />
              </div>
            </div>

            <div style={styles.inputRow}>
              <div style={styles.inputGroup}>
                <label htmlFor="maint-last-odo-input" style={styles.label}>Last Service Odometer (KM)</label>
                <input
                  id="maint-last-odo-input"
                  type="number"
                  placeholder={`Default: ${currentOdoVal}`}
                  value={lastServiceOdo}
                  onChange={e => setLastServiceOdo(e.target.value)}
                  style={styles.input}
                />
              </div>
              <div style={styles.inputGroup}>
                <label htmlFor="maint-last-date-input" style={styles.label}>Last Service Date</label>
                <input
                  id="maint-last-date-input"
                  type="date"
                  value={lastServiceDate}
                  onChange={e => setLastServiceDate(e.target.value)}
                  style={styles.input}
                />
              </div>
            </div>

            <div style={styles.inputGroup}>
              <label htmlFor="maint-notes-input" style={styles.label}>Service Notes</label>
              <textarea
                id="maint-notes-input"
                placeholder="Write specific parts/brands used..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                style={{ ...styles.input, height: '80px', resize: 'none' }}
              />
            </div>

            <button type="submit" disabled={loading} style={styles.submitBtn}>
              <Wrench size={16} />
              {loading ? 'Creating...' : 'Create Schedule'}
            </button>

            {error && <div style={styles.errorAlert}>{error}</div>}
            {successMsg && <div style={styles.successAlert}>{successMsg}</div>}
          </form>
        </div>

        {/* Right Column: Maintenance status list */}
        <div className="glass-panel-static" style={styles.card}>
          <div style={styles.cardHeader}>
            <Wrench size={20} style={{ color: 'var(--accent-purple)' }} />
            <h2 style={styles.cardTitle}>Current Schedules ({items.length})</h2>
          </div>

          <div style={styles.listContainer}>
            {items.length === 0 ? (
              <div style={styles.noData}>Create a schedule to begin tracking engine parts degradation.</div>
            ) : (
              items.map(item => {
                const pct = getProgressPercentage(item);
                const color = getProgressColor(item.status);
                return (
                  <div key={item.id} className="glass-panel-static" style={{ ...styles.itemCard, borderLeft: `4px solid ${color}` }}>
                    <div style={styles.itemHeader}>
                      <div>
                        <h3 style={styles.itemName}>{item.name}</h3>
                        <span style={styles.itemMeta}>
                          Last: {item.lastServiceOdo ? `${item.lastServiceOdo.toFixed(2)} km` : '0.00 km'} | {item.lastServiceDate ? new Date(item.lastServiceDate).toLocaleDateString() : 'Never'}
                        </span>
                      </div>
                      <div style={styles.itemActions}>
                        <button 
                          onClick={() => handleMarkServiced(item.id)}
                          style={{ ...styles.itemActionBtn, color: 'var(--accent-green)', backgroundColor: 'rgba(16, 185, 129, 0.1)' }}
                        >
                          Mark Completed
                        </button>
                        <button 
                          onClick={() => handleDelete(item.id)}
                          style={{ ...styles.itemActionBtn, color: 'var(--accent-red)', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '6px' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div style={styles.progressTrack}>
                      <div style={{ ...styles.progressBar, width: `${pct}%`, backgroundColor: color }}></div>
                    </div>

                    <div style={styles.itemDetails}>
                      {item.intervalKm && (
                        <div style={styles.detailText}>
                          <Gauge size={12} />
                          <span>
                            {item.kmSinceService.toFixed(2)} / {item.intervalKm.toFixed(2)} km ({item.kmUntilDue !== null && item.kmUntilDue <= 0 ? 'Overdue!' : `${item.kmUntilDue?.toFixed(2)} km left`})
                          </span>
                        </div>
                      )}
                      {item.intervalDays && (
                        <div style={styles.detailText}>
                          <Calendar size={12} />
                          <span>
                            {item.daysSinceService} / {item.intervalDays} days ({item.daysUntilDue !== null && item.daysUntilDue <= 0 ? 'Overdue!' : `${item.daysUntilDue} days left`})
                          </span>
                        </div>
                      )}
                      {item.notes && (
                        <div style={styles.notesText}>
                          <FileText size={12} />
                          <span>Notes: "{item.notes}"</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
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
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
    gap: '20px'
  },
  statsCard: {
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  statsCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  statsCardTitle: {
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  statsCardValue: {
    fontSize: '36px',
    fontWeight: 800,
    color: 'var(--text-primary)',
    lineHeight: '1'
  },
  statsCardSubtext: {
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))',
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
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  inputRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
    gap: '16px'
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  label: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  input: {
    padding: '12px 16px',
    backgroundColor: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    color: 'var(--text-primary)',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.2s'
  },
  submitBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '14px',
    backgroundColor: 'var(--accent-cyan)',
    border: 'none',
    borderRadius: '10px',
    color: '#060608',
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: '8px',
    transition: 'opacity 0.2s'
  },
  errorAlert: {
    padding: '12px',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '8px',
    color: 'var(--accent-red)',
    fontSize: '13px'
  },
  successAlert: {
    padding: '12px',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    borderRadius: '8px',
    color: 'var(--accent-green)',
    fontSize: '13px'
  },
  listContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxHeight: '520px',
    overflowY: 'auto',
    paddingRight: '4px'
  },
  noData: {
    padding: '60px 0',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '14px'
  },
  itemCard: {
    padding: '16px',
    backgroundColor: 'rgba(255,255,255,0.01)',
    borderRadius: '10px',
    border: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  itemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: '8px 12px'
  },
  itemName: {
    fontSize: '15px',
    fontWeight: 700,
    color: 'var(--text-primary)'
  },
  itemMeta: {
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  itemActions: {
    display: 'flex',
    gap: '8px',
    flexShrink: 0
  },
  itemActionBtn: {
    fontSize: '11px',
    fontWeight: 700,
    padding: '6px 12px',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '4px'
  },
  progressTrack: {
    height: '6px',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: '3px',
    overflow: 'hidden'
  },
  progressBar: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.4s ease'
  },
  itemDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    borderTop: '1px solid rgba(255,255,255,0.02)',
    paddingTop: '8px'
  },
  detailText: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: 'var(--text-secondary)'
  },
  notesText: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '11px',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
    marginTop: '4px'
  }
};

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { API_HOST } from '../api';
import {
  Fuel, Gauge, Clock, ArrowLeft, Trash2, PlusCircle, ActivitySquare, TrendingUp
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area
} from 'recharts';

interface FuelLog {
  id: string | number;
  timestamp: number;
  litres: number;
  odometer: number;
  source: string;
  economy?: number | null; // calculated on the fly
}

interface FuelStats {
  averageKmPerLitre: number;
  bestKmPerLitre: number;
  worstKmPerLitre: number;
  totalLitres: number;
  totalDistance: number;
  logCount: number;
}

export default function FuelTracker() {
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [stats, setStats] = useState<FuelStats>({
    averageKmPerLitre: 0,
    bestKmPerLitre: 0,
    worstKmPerLitre: 0,
    totalLitres: 0,
    totalDistance: 0,
    logCount: 0
  });

  const [litresInput, setLitresInput] = useState('');
  const [odoInput, setOdoInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const fetchData = async () => {
    try {
      // Fetch Logs
      const logsRes = await fetch(`${API_HOST}/api/fuel-logs`);
      const logsData = await logsRes.json();
      
      // Calculate economy for each log on the fly (sorted by odo ascending first)
      const sortedAsc = [...logsData].sort((a: FuelLog, b: FuelLog) => a.odometer - b.odometer);
      const computedLogs = sortedAsc.map((log: FuelLog, index: number) => {
        if (index === 0) {
          return { ...log, economy: null };
        }
        const prev = sortedAsc[index - 1];
        const dist = log.odometer - prev.odometer;
        const litres = log.litres;
        const economy = dist > 0 && litres > 0 ? parseFloat((dist / litres).toFixed(2)) : null;
        return { ...log, economy };
      });

      // Keep logs descending by odometer for table listing
      const sortedDesc = [...computedLogs].sort((a, b) => b.odometer - a.odometer);
      setLogs(sortedDesc);

      // Fetch Stats
      const statsRes = await fetch(`${API_HOST}/api/fuel-stats`);
      const statsData = await statsRes.json();
      setStats(statsData);
    } catch (err) {
      console.error('Error fetching fuel data:', err);
    }
  };

  useEffect(() => {
    fetchData();
    // Poll stats/logs every 10 seconds to keep in sync with Android uploads
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const litres = parseFloat(litresInput);
    const odometer = parseFloat(odoInput);

    if (isNaN(litres) || litres <= 0) {
      setError('Please enter a valid positive number for litres.');
      return;
    }
    if (isNaN(odometer) || odometer <= 0) {
      setError('Please enter a valid positive number for odometer.');
      return;
    }

    // Odometer verification against latest log
    if (logs.length > 0) {
      const highestOdo = Math.max(...logs.map(l => l.odometer));
      if (odometer <= highestOdo) {
        setError(`New odometer reading (${odometer} km) must be higher than the previous record (${highestOdo} km).`);
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_HOST}/api/fuel-logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          timestamp: Date.now(),
          litres,
          odometer,
          source: 'web'
        })
      });

      if (res.ok) {
        setSuccessMsg('Refuel logged successfully!');
        setLitresInput('');
        setOdoInput('');
        fetchData();
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to submit refuel log.');
      }
    } catch (err) {
      setError('Network error, could not reach API server.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string | number) => {
    if (!confirm('Are you sure you want to delete this log entry?')) return;
    try {
      const res = await fetch(`${API_HOST}/api/fuel-logs/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchData();
      } else {
        alert('Failed to delete log entry.');
      }
    } catch (err) {
      alert('Network error, could not delete log.');
    }
  };

  // Format data for Recharts line chart (sorted chronologically)
  const chartData = [...logs]
    .filter(log => log.economy !== null && log.economy !== undefined)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(log => ({
      date: new Date(log.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      'Economy (km/L)': log.economy,
      litres: log.litres,
      odometer: log.odometer
    }));

  return (
    <div style={{ minHeight: '100vh', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
      <Head>
        <title>Axia OS | Fuel Economy Tracker</title>
        <meta name="description" content="Fuel consumption and efficiency logs for Perodua Axia" />
      </Head>

      <div style={styles.mainContainer}>
        {/* HEADER */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={styles.logoBadge}>
              <Fuel size={28} color="var(--accent-blue)" />
            </div>
            <div>
              <h1 style={styles.title}>Axia OS</h1>
              <p style={styles.subtitle}>Fuel Economy Tracker</p>
            </div>
          </div>


        </div>

        {/* STATS CARDS ROW */}
        <div style={styles.statsRow}>
          <div className="glass-panel-static" style={styles.statsCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={styles.cardLabel}>Average Economy</span>
              <TrendingUp size={20} color="var(--accent-green)" />
            </div>
            <div style={styles.cardValContainer}>
              <span style={styles.cardValue}>{stats.averageKmPerLitre !== null && stats.averageKmPerLitre !== undefined ? stats.averageKmPerLitre.toFixed(2) : 'N/A'}</span>
              {stats.averageKmPerLitre > 0 && <span style={styles.cardUnit}>km/L</span>}
            </div>
            <div style={styles.cardSubtext}>
              {stats.logCount >= 2 
                ? `Range: ${stats.worstKmPerLitre.toFixed(2)} - ${stats.bestKmPerLitre.toFixed(2)} km/L`
                : 'Need at least 2 logs to calculate economy'}
            </div>
          </div>

          <div className="glass-panel-static" style={styles.statsCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={styles.cardLabel}>Total Fuel Filled</span>
              <Fuel size={20} color="var(--accent-blue)" />
            </div>
            <div style={styles.cardValContainer}>
              <span style={styles.cardValue}>{stats.totalLitres !== null && stats.totalLitres !== undefined ? stats.totalLitres.toFixed(2) : '0.00'}</span>
              <span style={styles.cardUnit}>L</span>
            </div>
            <div style={styles.cardSubtext}>
              Across {stats.logCount} total logs
            </div>
          </div>

          <div className="glass-panel-static" style={styles.statsCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={styles.cardLabel}>Tracked Odo Distance</span>
              <Gauge size={20} color="var(--accent-cyan)" />
            </div>
            <div style={styles.cardValContainer}>
              <span style={styles.cardValue}>{stats.totalDistance !== null && stats.totalDistance !== undefined ? stats.totalDistance.toFixed(2) : '0.00'}</span>
              <span style={styles.cardUnit}>km</span>
            </div>
            <div style={styles.cardSubtext}>
              {logs.length > 0 
                ? `Current Odo: ${Math.max(...logs.map(l => l.odometer)).toFixed(2)} km`
                : 'No odometer reading logged'}
            </div>
          </div>
        </div>

        {/* MAIN WORKSPACE GRID */}
        <div style={styles.grid}>
          {/* LEFT: FORM AND CHART */}
          <div style={styles.leftColumn}>
            {/* ADD REFUEL FORM */}
            <div className="glass-panel-static" style={styles.card}>
              <h2 style={styles.cardTitle}>Log Refuel Entry</h2>
              <form onSubmit={handleSubmit} style={styles.form}>
                <div style={styles.formRow}>
                  <div style={styles.inputGroup}>
                    <label htmlFor="fuel-litres-input" style={styles.label}>Litres refueled (L)</label>
                    <input
                      id="fuel-litres-input"
                      type="number"
                      step="0.01"
                      placeholder="e.g. 28.5"
                      value={litresInput}
                      onChange={e => setLitresInput(e.target.value)}
                      style={styles.input}
                      required
                    />
                  </div>
                  <div style={styles.inputGroup}>
                    <label htmlFor="fuel-odo-input" style={styles.label}>Current Odometer (km)</label>
                    <input
                      id="fuel-odo-input"
                      type="number"
                      step="0.1"
                      placeholder="e.g. 45890.3"
                      value={odoInput}
                      onChange={e => setOdoInput(e.target.value)}
                      style={styles.input}
                      required
                    />
                  </div>
                </div>

                {error && <div style={styles.errorAlert}>{error}</div>}
                {successMsg && <div style={styles.successAlert}>{successMsg}</div>}

                <button
                  type="submit"
                  disabled={loading}
                  style={styles.submitBtn}
                  className="glass-panel"
                >
                  <PlusCircle size={18} /> {loading ? 'Logging refuel...' : 'Add Refuel Entry'}
                </button>
              </form>
            </div>

            {/* CHART */}
            <div className="glass-panel-static" style={styles.card}>
              <h2 style={styles.cardTitle}>Efficiency Trend</h2>
              <div style={styles.chartContainer}>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorEconomy" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} />
                      <YAxis stroke="var(--text-muted)" fontSize={11} domain={['auto', 'auto']} unit=" km/L" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(15, 15, 20, 0.95)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          color: '#fff'
                        }}
                      />
                      <Area type="monotone" dataKey="Economy (km/L)" stroke="var(--accent-blue)" strokeWidth={2} fillOpacity={1} fill="url(#colorEconomy)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={styles.noDataPlaceholder}>
                    No trend data available. Log at least two entries to start tracking economy.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT: HISTORY TABLE */}
          <div>
            <div className="glass-panel-static" style={{ ...styles.card, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <h2 style={styles.cardTitle}>Refuel Log History</h2>
              <div style={styles.tableContainer}>
                {logs.length > 0 ? (
                  <table style={styles.table}>
                    <thead>
                      <tr style={styles.trHead}>
                        <th style={styles.th}>Date</th>
                        <th style={styles.th}>Litres</th>
                        <th style={styles.th}>Odometer</th>
                        <th style={styles.th}>Economy</th>
                        <th style={styles.th}>Source</th>
                        <th style={styles.th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log.id} style={styles.trRow}>
                          <td style={styles.td}>
                            {new Date(log.timestamp).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </td>
                          <td style={styles.td}>{log.litres.toFixed(2)} L</td>
                           <td style={styles.td}>{log.odometer.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km</td>
                          <td style={styles.td}>
                            {log.economy ? (
                              <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>
                                 {log.economy.toFixed(2)} km/L
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>Initial fill</span>
                            )}
                          </td>
                          <td style={styles.td}>
                            <span style={{
                              textTransform: 'uppercase',
                              fontSize: '10px',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              backgroundColor: log.source === 'app' ? 'rgba(52, 199, 89, 0.15)' : 'rgba(0, 122, 255, 0.15)',
                              color: log.source === 'app' ? '#34C759' : '#007AFF'
                            }}>
                              {log.source}
                            </span>
                          </td>
                          <td style={styles.td}>
                            <button
                              onClick={() => handleDelete(log.id)}
                              style={styles.deleteBtn}
                              title="Delete log"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={styles.noDataPlaceholder}>
                    No refuel records found.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  mainContainer: {
    flex: 1,
    maxWidth: '1400px',
    margin: '0 auto',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '16px',
    borderBottom: '1px solid var(--border)'
  },
  logoBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    width: '48px',
    height: '48px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: {
    fontSize: '24px',
    fontWeight: 800,
    letterSpacing: '-0.02em',
    color: 'var(--text-primary)',
    margin: 0
  },
  subtitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    margin: 0
  },
  backBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 18px',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    color: 'var(--text-primary)',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.2s ease-in-out'
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
    gap: '20px'
  },
  statsCard: {
    padding: '24px',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column'
  },
  cardLabel: {
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  cardValContainer: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    marginTop: '4px'
  },
  cardValue: {
    fontSize: '36px',
    fontWeight: 800,
    color: 'var(--text-primary)',
    letterSpacing: '-0.03em'
  },
  cardUnit: {
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--text-muted)'
  },
  cardSubtext: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    marginTop: '8px'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))',
    gap: '32px'
  },
  leftColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  card: {
    padding: '24px',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '16px'
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 800,
    color: 'var(--text-primary)',
    marginBottom: '20px',
    letterSpacing: '-0.01em'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
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
    padding: '12px',
    backgroundColor: 'var(--accent-blue)',
    border: 'none',
    borderRadius: '10px',
    color: '#ffffff',
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
  chartContainer: {
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: '12px',
    padding: '16px',
    border: '1px solid rgba(255,255,255,0.02)'
  },
  noDataPlaceholder: {
    height: '200px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    fontSize: '13px',
    textAlign: 'center',
    padding: '24px'
  },
  tableContainer: {
    flex: 1,
    overflowY: 'auto',
    maxHeight: '480px'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px'
  },
  trHead: {
    borderBottom: '1px solid var(--border)'
  },
  th: {
    textAlign: 'left',
    padding: '12px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  trRow: {
    borderBottom: '1px solid rgba(255,255,255,0.02)',
    transition: 'background-color 0.2s'
  },
  td: {
    padding: '12px',
    color: 'var(--text-primary)'
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    transition: 'all 0.2s'
  }
};

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { API_HOST } from '../api';
import { useVehicle } from '../context/VehicleContext';
import {
  Zap, Trophy, Clock, ArrowLeft, TrendingUp, Gauge, Calendar, Activity, Car
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

interface PerformanceRecords {
  best0to100: { time: number; timestamp: number; driveId: string | number | null } | null;
  topSpeed: { speed: number; timestamp: number; driveId: string | number | null } | null;
  highestRpm: { rpm: number; timestamp: number; driveId: string | number | null } | null;
  longestDrive: { durationMin: number; driveId: string | number; date: string } | null;
  totalDrivingTime: number;
  totalDrives: number;
}

interface AccelerationRun {
  id: string;
  timestamp: number;
  accelTime: number;
  driveId: string | number | null;
  maxSpeedReached: number;
}

const formatDuration = (mins: number): string => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h <= 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

export default function PerformanceDashboard() {
  const { activeVehicleId, buildUrl } = useVehicle();
  const [records, setRecords] = useState<PerformanceRecords>({
    best0to100: null,
    topSpeed: null,
    highestRpm: null,
    longestDrive: null,
    totalDrivingTime: 0,
    totalDrives: 0
  });
  const [runs, setRuns] = useState<AccelerationRun[]>([]);

  const fetchData = async () => {
    try {
      const recordsRes = await fetch(buildUrl('/api/performance/records'));
      const recordsData = await recordsRes.json();
      setRecords(recordsData || {
        best0to100: null,
        topSpeed: null,
        highestRpm: null,
        longestDrive: null,
        totalDrivingTime: 0,
        totalDrives: 0
      });

      const runsRes = await fetch(buildUrl('/api/performance/runs'));
      const runsData = await runsRes.json();
      setRuns(Array.isArray(runsData) ? runsData : []);
    } catch (err) {
      console.error('Error fetching performance data:', err);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [activeVehicleId, buildUrl]);

  // Format line chart data
  const chartData = [...runs]
    .reverse()
    .map(r => ({
      date: new Date(r.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      time: r.accelTime,
      runId: r.id
    }));

  return (
    <div style={styles.container}>
      <Head>
        <title>Axia OS | Performance Center</title>
      </Head>

      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div>
            <h1 style={styles.title}>Performance Center</h1>
            <p style={styles.subtitle}>Track acceleration runs and personal records</p>
          </div>
        </div>
      </div>

      {/* Records Cards Grid */}
      <div style={styles.statsRow}>
        <div className="glass-panel-static" style={styles.statsCard}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Best 0-100 km/h</span>
            <Zap size={20} style={{ color: 'var(--accent-amber)' }} />
          </div>
          <span style={{ ...styles.statsCardValue, color: 'var(--accent-amber)' }}>
            {records.best0to100 ? `${records.best0to100.time.toFixed(2)}s` : 'N/A'}
          </span>
          <span style={styles.statsCardSubtext}>
            {records.best0to100 
              ? `Drive #${records.best0to100.driveId} at ${new Date(records.best0to100.timestamp).toLocaleTimeString()}`
              : 'No runs recorded yet'}
          </span>
        </div>

        <div className="glass-panel-static" style={styles.statsCard}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Top Speed Ever</span>
            <Gauge size={20} style={{ color: 'var(--accent-cyan)' }} />
          </div>
          <span style={styles.statsCardValue}>
            {records.topSpeed && records.topSpeed.speed > 0 ? `${records.topSpeed.speed.toFixed(2)} km/h` : 'N/A'}
          </span>
          <span style={styles.statsCardSubtext}>
            {records.topSpeed && records.topSpeed.speed > 0
              ? `Drive #${records.topSpeed.driveId} on ${new Date(records.topSpeed.timestamp).toLocaleDateString()}`
              : 'No telemetry logged'}
          </span>
        </div>

        <div className="glass-panel-static" style={styles.statsCard}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Highest RPM</span>
            <Activity size={20} style={{ color: 'var(--accent-red)' }} />
          </div>
          <span style={styles.statsCardValue}>
            {records.highestRpm && records.highestRpm.rpm > 0 ? `${records.highestRpm.rpm.toFixed(2)} RPM` : 'N/A'}
          </span>
          <span style={styles.statsCardSubtext}>
            {records.highestRpm && records.highestRpm.rpm > 0
              ? `Drive #${records.highestRpm.driveId} on ${new Date(records.highestRpm.timestamp).toLocaleDateString()}`
              : 'No RPM data recorded'}
          </span>
        </div>

        <div className="glass-panel-static" style={styles.statsCard}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Longest Drive</span>
            <Clock size={20} style={{ color: 'var(--accent-purple)' }} />
          </div>
          <span style={styles.statsCardValue}>
            {records.longestDrive && records.longestDrive.durationMin > 0 ? formatDuration(records.longestDrive.durationMin) : 'N/A'}
          </span>
          <span style={styles.statsCardSubtext}>
            {records.longestDrive && records.longestDrive.durationMin > 0
              ? `Drive #${records.longestDrive.driveId} on ${records.longestDrive.date}`
              : 'No drive sessions'}
          </span>
        </div>
      </div>

      {/* Main Grid */}
      <div style={styles.grid}>
        
        {/* Left Column: 0-100 runs history */}
        <div className="glass-panel-static" style={styles.card}>
          <div style={styles.cardHeader}>
            <Trophy size={20} style={{ color: 'var(--accent-amber)' }} />
            <h2 style={styles.cardTitle}>0-100 km/h Acceleration Runs</h2>
          </div>
          
          {runs.length === 0 ? (
            <div style={styles.noData}>Perform a 0-100 km/h run in your car to log metrics.</div>
          ) : (
            <div style={styles.tableContainer}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.trHead}>
                    <th style={styles.th}>Date & Time</th>
                    <th style={styles.th}>Accel Time</th>
                    <th style={styles.th}>Max Speed</th>
                    <th style={styles.th}>Session ID</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map(run => {
                    const isPersonalBest = records.best0to100 && records.best0to100.timestamp === run.timestamp;
                    return (
                      <tr key={run.id} style={{ ...styles.trRow, backgroundColor: isPersonalBest ? 'rgba(245, 158, 11, 0.05)' : 'transparent' }}>
                        <td style={styles.td}>
                          {new Date(run.timestamp).toLocaleString()}
                          {isPersonalBest && <span style={styles.pbTag}>🏆 PB</span>}
                        </td>
                        <td style={{ ...styles.td, color: 'var(--accent-amber)', fontWeight: 700 }}>
                          {run.accelTime.toFixed(2)}s
                        </td>
                        <td style={styles.td}>{run.maxSpeedReached.toFixed(2)} km/h</td>
                        <td style={styles.td}>Drive #{run.driveId}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column: Performance Trend Chart */}
        <div className="glass-panel-static" style={styles.card}>
          <div style={styles.cardHeader}>
            <TrendingUp size={20} style={{ color: 'var(--accent-amber)' }} />
            <h2 style={styles.cardTitle}>0-100 km/h Acceleration Trend</h2>
          </div>
          
          {chartData.length === 0 ? (
            <div style={styles.noData}>Need acceleration run logs to display trend</div>
          ) : (
            <div style={{ height: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} />
                  <YAxis stroke="var(--accent-amber)" fontSize={11} unit=" s" reversed />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'rgba(20,20,25,0.9)', borderRadius: '8px', border: '1px solid var(--border)' }}
                    labelStyle={{ color: 'var(--text-primary)', fontWeight: 700 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="time" 
                    name="0-100 Time (s)" 
                    stroke="var(--accent-amber)" 
                    strokeWidth={3} 
                    dot={{ fill: 'var(--accent-amber)', r: 5 }} 
                    activeDot={{ r: 8 }} 
                  />
                </LineChart>
              </ResponsiveContainer>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '16px' }}>
                Note: Lower is better (y-axis is inverted to show progress upwards).
              </p>
            </div>
          )}
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
  noData: {
    padding: '60px 0',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '14px'
  },
  tableContainer: {
    overflowX: 'auto',
    maxHeight: '400px',
    overflowY: 'auto'
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
  pbTag: {
    marginLeft: '10px',
    padding: '2px 6px',
    fontSize: '10px',
    fontWeight: 800,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    color: 'var(--accent-amber)',
    borderRadius: '4px',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    textTransform: 'uppercase'
  }
};

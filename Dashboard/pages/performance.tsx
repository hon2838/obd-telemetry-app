import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Pagination from '../components/Pagination';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../api';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setPage(1);
  }, [activeVehicleId]);

  const fetchData = async (signal: AbortSignal) => {
    const [recordsRes, runsRes] = await Promise.all([
      apiFetch(buildUrl('/api/performance/records'), { signal }),
      apiFetch(buildUrl('/api/performance/runs'), { signal }),
    ]);
    if (!recordsRes.ok) throw new Error(`Performance records HTTP ${recordsRes.status}`);
    if (!runsRes.ok) throw new Error(`Performance runs HTTP ${runsRes.status}`);
    const [recordsData, runsData] = await Promise.all([recordsRes.json(), runsRes.json()]);
    setRecords(recordsData || {
      best0to100: null, topSpeed: null, highestRpm: null, longestDrive: null,
      totalDrivingTime: 0, totalDrives: 0
    });
    setRuns(Array.isArray(runsData) ? runsData : []);
  };

  useVisibilityPolling(fetchData, 10000, [activeVehicleId, buildUrl]);

  const paginatedRuns = useMemo(() => {
    const start = (page - 1) * pageSize;
    return runs.slice(start, start + pageSize);
  }, [runs, page, pageSize]);

  const chartData = useMemo(() => [...runs]
    .reverse()
    .map(r => ({
      date: new Date(r.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      time: r.accelTime,
      runId: r.id
    })), [runs]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Head>
        <title>Performance & Sprint Records | OBD Telemetry</title>
        <meta name="description" content="Vehicle performance tracking, 0-100 km/h acceleration logs, and records" />
      </Head>

      <PageHeader
        title="Performance & Records"
        subtitle="Track 0-100 km/h acceleration sprints, top speed records, and session milestones."
      />

      {/* Records Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
        gap: '0.85rem'
      }}>
        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Best 0-100 km/h</span>
            <Zap size={16} color="var(--accent-amber)" />
          </div>
          <div className="metric-summary-value" style={{ color: 'var(--accent-amber)' }}>
            {records.best0to100 && typeof records.best0to100.time === 'number' ? `${records.best0to100.time.toFixed(2)}s` : 'N/A'}
          </div>
          <div className="metric-summary-subtext">
            {records.best0to100
              ? `Drive #${records.best0to100.driveId} at ${new Date(records.best0to100.timestamp).toLocaleTimeString()}`
              : 'No sprint runs logged'}
          </div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Top Speed Ever</span>
            <Gauge size={16} color="var(--accent-cyan)" />
          </div>
          <div className="metric-summary-value">
            {records.topSpeed && typeof records.topSpeed.speed === 'number' && records.topSpeed.speed > 0
              ? `${Math.round(records.topSpeed.speed)} km/h`
              : 'N/A'}
          </div>
          <div className="metric-summary-subtext">
            {records.topSpeed && typeof records.topSpeed.speed === 'number' && records.topSpeed.speed > 0
              ? `Drive #${records.topSpeed.driveId} on ${new Date(records.topSpeed.timestamp).toLocaleDateString()}`
              : 'No telemetry logged'}
          </div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Highest RPM</span>
            <Activity size={16} color="var(--accent-purple)" />
          </div>
          <div className="metric-summary-value">
            {records.highestRpm && typeof records.highestRpm.rpm === 'number' && records.highestRpm.rpm > 0
              ? `${Math.round(records.highestRpm.rpm).toLocaleString()} RPM`
              : 'N/A'}
          </div>
          <div className="metric-summary-subtext">
            {records.highestRpm && typeof records.highestRpm.rpm === 'number' && records.highestRpm.rpm > 0
              ? `Drive #${records.highestRpm.driveId} on ${new Date(records.highestRpm.timestamp).toLocaleDateString()}`
              : 'No RPM logged'}
          </div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Longest Drive</span>
            <Clock size={16} color="var(--accent-cyan)" />
          </div>
          <div className="metric-summary-value">
            {records.longestDrive && records.longestDrive.durationMin > 0 ? formatDuration(records.longestDrive.durationMin) : 'N/A'}
          </div>
          <div className="metric-summary-subtext">
            {records.longestDrive && records.longestDrive.durationMin > 0
              ? `Drive #${records.longestDrive.driveId} on ${records.longestDrive.date}`
              : 'No drive sessions'}
          </div>
        </div>
      </div>

      {/* Main Grid: Runs History + Trend Chart */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))',
        gap: '1rem'
      }}>
        {/* Runs History */}
        <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }} aria-label="Acceleration runs history">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Trophy size={18} color="var(--accent-amber)" />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              0-100 km/h Acceleration Runs
            </h2>
          </div>

          {runs.length === 0 ? (
            <EmptyState
              icon={<Zap size={32} />}
              title="No sprint runs recorded"
              description="Perform a 0-100 km/h acceleration sprint in your vehicle with telemetry logging to record sprint times."
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.55rem 0.4rem', fontWeight: 500 }}>Date & Time</th>
                    <th style={{ padding: '0.55rem 0.4rem', fontWeight: 500 }}>Time (0-100)</th>
                    <th style={{ padding: '0.55rem 0.4rem', fontWeight: 500 }}>Max Speed</th>
                    <th style={{ padding: '0.55rem 0.4rem', fontWeight: 500 }}>Drive #</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRuns.map((run, i) => (
                    <tr key={run.id || i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.65rem 0.4rem', color: 'var(--text-secondary)' }}>
                        {new Date(run.timestamp).toLocaleString()}
                        {records.best0to100?.timestamp === run.timestamp && (
                          <span style={{ marginLeft: '0.5rem', color: 'var(--accent-amber)', fontSize: '0.75rem' }}>Personal best</span>
                        )}
                      </td>
                      <td style={{ padding: '0.65rem 0.4rem', fontWeight: 600, color: 'var(--accent-amber)', fontVariantNumeric: 'tabular-nums' }}>
                        {typeof run.accelTime === 'number' && Number.isFinite(run.accelTime) ? `${run.accelTime.toFixed(2)}s` : 'N/A'}
                      </td>
                      <td style={{ padding: '0.65rem 0.4rem', fontVariantNumeric: 'tabular-nums' }}>
                        {typeof run.maxSpeedReached === 'number' ? `${Math.round(run.maxSpeedReached)} km/h` : 'N/A'}
                      </td>
                      <td style={{ padding: '0.65rem 0.4rem', color: 'var(--text-muted)' }}>
                        {run.driveId ? `#${run.driveId}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: '0.75rem' }}>
                <Pagination
                  currentPage={page}
                  totalItems={runs.length}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  itemLabel="runs"
                />
              </div>
            </div>
          )}
        </section>

        {/* Sprint Times Trend Chart */}
        <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }} aria-label="Sprint trend chart">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingUp size={18} color="var(--accent-cyan)" />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Acceleration Trend (Seconds)
            </h2>
          </div>

          {chartData.length < 2 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              At least two acceleration runs are needed to plot trend progress.
            </div>
          ) : (
            <div style={{ height: '280px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} domain={['dataMin - 1', 'dataMax + 1']} unit="s" />
                  <Tooltip contentStyle={{ background: '#171f28', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }} />
                  <Line type="monotone" dataKey="time" name="0-100 Time (s)" stroke="var(--accent-amber)" strokeWidth={2} dot={{ r: 4, fill: 'var(--accent-amber)' }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

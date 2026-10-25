import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import {
  Fuel, TrendingUp, Gauge, Calendar, Trash2, ArrowLeft, PlusCircle, CheckCircle, Car, AlertCircle, Info
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Pagination from '../components/Pagination';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { apiFetch, isAbortError } from '../api';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { useVehicle } from '../context/VehicleContext';

interface FuelLog {
  id: string | number;
  timestamp: number;
  litres: number;
  odometer: number;
  fillState?: 'full' | 'partial' | 'unknown';
  economy?: number | null;
  cycleDistance?: number | null;
  cycleLitres?: number | null;
  economyStatus?: 'full-cycle' | 'partial-fill' | 'unknown-fill';
  source?: string;
  vehicleId?: string;
}

interface FuelStats {
  averageKmPerLitre: number | null;
  bestKmPerLitre: number | null;
  worstKmPerLitre: number | null;
  totalLitres: number | null;
  totalDistance: number | null;
  logCount: number;
  cycleCount?: number;
  unknownFillCount?: number;
}

export default function FuelEconomy() {
  const { vehicles, activeVehicleId, activeVehicle, buildUrl } = useVehicle();
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [stats, setStats] = useState<FuelStats>({
    averageKmPerLitre: null,
    bestKmPerLitre: null,
    worstKmPerLitre: null,
    totalLitres: 0,
    totalDistance: 0,
    logCount: 0,
    cycleCount: 0,
    unknownFillCount: 0
  });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [litresInput, setLitresInput] = useState('');
  const [odoInput, setOdoInput] = useState('');
  const [fillStateInput, setFillStateInput] = useState<'full' | 'partial' | 'unknown'>('unknown');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    setPage(1);
    setLogs([]);
    setStats({
      averageKmPerLitre: null,
      bestKmPerLitre: null,
      worstKmPerLitre: null,
      totalLitres: 0,
      totalDistance: 0,
      logCount: 0,
      cycleCount: 0,
      unknownFillCount: 0
    });
    setError('');
    setSuccessMsg('');
  }, [activeVehicleId]);

  const fetchData = async (signal?: AbortSignal) => {
    const [logsRes, statsRes] = await Promise.all([
      apiFetch(buildUrl('/api/fuel-logs'), { signal }),
      apiFetch(buildUrl('/api/fuel-stats'), { signal })
    ]);

    if (!logsRes.ok) throw new Error(`Fuel logs HTTP ${logsRes.status}`);
    if (!statsRes.ok) throw new Error(`Fuel stats HTTP ${statsRes.status}`);

    const [logsData, statsData] = await Promise.all([logsRes.json(), statsRes.json()]);
    setLogs(Array.isArray(logsData) ? logsData : []);
    setStats(statsData || {
      averageKmPerLitre: null,
      bestKmPerLitre: null,
      worstKmPerLitre: null,
      totalLitres: 0,
      totalDistance: 0,
      logCount: 0,
      cycleCount: 0,
      unknownFillCount: 0
    });
  };

  useVisibilityPolling(fetchData, 10000, [activeVehicleId, buildUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const explicitVehicle = vehicles.find(v => v.id === activeVehicleId) || null;
    if (!explicitVehicle) {
      setError(
        vehicles.length === 0
          ? 'No vehicles are assigned to your account yet. Ask an admin to assign one before logging fuel.'
          : 'Select a specific vehicle (not All Vehicles) before adding a refuel log.'
      );
      return;
    }

    const litres = parseFloat(litresInput);
    const odometer = parseFloat(odoInput);

    if (!Number.isFinite(litres) || litres <= 0) {
      setError('Please enter a valid positive number for litres.');
      return;
    }

    if (!Number.isFinite(odometer) || odometer < 0) {
      setError('Please enter a valid non-negative number for odometer.');
      return;
    }

    // Odometer verification against latest log for this vehicle
    const vehicleLogs = logs.filter(l => l.vehicleId === explicitVehicle.id);
    if (vehicleLogs.length > 0) {
      const highestOdo = Math.max(...vehicleLogs.map(l => l.odometer));
      if (Number.isFinite(highestOdo) && odometer <= highestOdo) {
        setError(`New odometer reading (${odometer} km) must be higher than the previous record (${highestOdo} km).`);
        return;
      }
    }

    setLoading(true);

    try {
      const res = await apiFetch('/api/fuel-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: Date.now(),
          litres,
          fillState: fillStateInput,
          odometer,
          source: 'web',
          vehicleId: explicitVehicle.id
        })
      });

      if (res.ok) {
        setSuccessMsg('Refuel logged successfully!');
        setLitresInput('');
        setOdoInput('');
        setFillStateInput('unknown');
        fetchData();
      } else {
        const errData = await res.json().catch(() => ({}));
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
      const res = await apiFetch(`/api/fuel-logs/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      } else {
        alert('Failed to delete log entry.');
      }
    } catch (err) {
      alert('Network error, could not delete log.');
    }
  };

  const paginatedLogs = useMemo(() => {
    const start = (page - 1) * pageSize;
    return logs.slice(start, start + pageSize);
  }, [logs, page, pageSize]);

  const chartData = useMemo(() => [...logs]
    .filter(log => log.economy !== null && log.economy !== undefined)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(log => ({
      date: new Date(log.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      'Economy (km/L)': log.economy,
      litres: log.litres,
      odometer: log.odometer
    })), [logs]);

  const explicitVehicleSelected = vehicles.some(v => v.id === activeVehicleId);
  const vehicleGuardMessage = vehicles.length === 0
    ? 'No vehicles are assigned to your account yet.'
    : 'Select a specific vehicle (not All Vehicles) to enable saving.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Head>
        <title>Fuel Economy & Logs | OBD Telemetry</title>
        <meta name="description" content="Calculated refuel economy and full-tank cycle history" />
      </Head>

      <PageHeader
        title="Fuel & Refuel Economy"
        subtitle="Track pump refills, calculate full-tank cycle economy, and review consumption trends."
      />

      {/* Model Distinction Note */}
      <div className="glass-panel" style={{ padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
        <Info size={18} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
        <span>
          <strong>Calculated refuel economy</strong> below uses odometer intervals between full-tank fills. It is distinct from <strong>instantaneous driving estimates</strong> shown on the Readings page, which derive from sensor airflow.
        </span>
      </div>

      {/* Stats Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
        gap: '0.85rem'
      }}>
        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Average Economy</span>
            <TrendingUp size={16} color="var(--accent-green)" />
          </div>
          <div className="metric-summary-value">
            {(stats.cycleCount || 0) > 0 && typeof stats.averageKmPerLitre === 'number'
              ? stats.averageKmPerLitre.toFixed(2)
              : 'N/A'}
            {(stats.cycleCount || 0) > 0 && typeof stats.averageKmPerLitre === 'number' && stats.averageKmPerLitre > 0 && (
              <small className="metric-summary-unit">km/L</small>
            )}
          </div>
          <div className="metric-summary-subtext">
            {(stats.cycleCount || 0) > 0 && typeof stats.worstKmPerLitre === 'number' && typeof stats.bestKmPerLitre === 'number'
              ? `${stats.cycleCount} full-tank cycles • Range: ${stats.worstKmPerLitre.toFixed(2)} - ${stats.bestKmPerLitre.toFixed(2)} km/L`
              : 'Need two confirmed full fills for one vehicle'}
          </div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Total Fuel Filled</span>
            <Fuel size={16} color="var(--accent-cyan)" />
          </div>
          <div className="metric-summary-value">
            {stats.totalLitres !== null && stats.totalLitres !== undefined ? stats.totalLitres.toFixed(2) : '0.00'}
            <small className="metric-summary-unit">L</small>
          </div>
          <div className="metric-summary-subtext">
            Across {stats.logCount} total logs
          </div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Tracked Odo Distance</span>
            <Gauge size={16} color="var(--accent-cyan)" />
          </div>
          <div className="metric-summary-value">
            {stats.totalDistance !== null && stats.totalDistance !== undefined ? stats.totalDistance.toFixed(2) : '0.00'}
            <small className="metric-summary-unit">km</small>
          </div>
          <div className="metric-summary-subtext">
            {activeVehicle
              ? (logs.length > 0 && Number.isFinite(Math.max(...logs.map(l => l.odometer)))
                ? `Current Odo: ${Math.max(...logs.map(l => l.odometer)).toFixed(2)} km`
                : 'No odometer reading logged')
              : 'Sum of each vehicle’s recorded odometer span'}
          </div>
        </div>
      </div>

      {/* Main Grid: Refuel History (Prioritized) + Log Form */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))',
        gap: '1rem'
      }}>
        {/* Left / Primary: Refuel History Table */}
        <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }} aria-label="Refuel log history">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={18} color="var(--accent-cyan)" />
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Refuel History
              </h2>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {logs.length} entries
            </span>
          </div>

          {logs.length === 0 ? (
            <EmptyState
              icon={<Fuel size={32} />}
              title="No refuel entries logged"
              description="Record your fuel pump receipts to track full-tank cycle economy and distance."
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.55rem 0.4rem', fontWeight: 500 }}>Vehicle / Date</th>
                    <th style={{ padding: '0.55rem 0.4rem', fontWeight: 500 }}>Litres</th>
                    <th style={{ padding: '0.55rem 0.4rem', fontWeight: 500 }}>Odometer</th>
                    <th style={{ padding: '0.55rem 0.4rem', fontWeight: 500 }}>Tank State</th>
                    <th style={{ padding: '0.55rem 0.4rem', fontWeight: 500 }}>Cycle Economy</th>
                    <th style={{ padding: '0.55rem 0.4rem', fontWeight: 500, textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedLogs.map((log) => {
                    const vehicleName = vehicles.find(v => v.id === log.vehicleId)?.name || log.vehicleId || 'Vehicle';
                    const dateStr = new Date(log.timestamp).toLocaleDateString([], {
                      month: 'short', day: 'numeric', year: 'numeric'
                    });
                    const isFull = log.fillState === 'full';
                    const isPartial = log.fillState === 'partial';

                    return (
                      <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.65rem 0.4rem' }}>
                          <strong style={{ color: 'var(--text-primary)', display: 'block' }}>{vehicleName}</strong>
                          <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>{dateStr}</span>
                        </td>
                        <td style={{ padding: '0.65rem 0.4rem', fontVariantNumeric: 'tabular-nums' }}>
                          {log.litres.toFixed(2)} L
                        </td>
                        <td style={{ padding: '0.65rem 0.4rem', fontVariantNumeric: 'tabular-nums' }}>
                          {log.odometer.toFixed(1)} km
                        </td>
                        <td style={{ padding: '0.65rem 0.4rem' }}>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.725rem',
                            fontWeight: 600,
                            background: isFull ? 'var(--accent-green-bg)' : isPartial ? 'var(--accent-amber-bg)' : 'var(--surface-control)',
                            border: '1px solid var(--border)',
                            color: isFull ? 'var(--accent-green)' : isPartial ? 'var(--accent-amber)' : 'var(--text-muted)'
                          }}>
                            {isFull ? 'Full tank' : isPartial ? 'Partial fill' : 'Unknown'}
                          </span>
                        </td>
                        <td style={{ padding: '0.65rem 0.4rem' }}>
                          {log.economyStatus === 'full-cycle' && log.economy !== null && log.economy !== undefined ? (
                            <div>
                              <strong style={{ color: 'var(--accent-green)', fontVariantNumeric: 'tabular-nums' }}>
                                {log.economy.toFixed(2)} km/L
                              </strong>
                              {log.cycleDistance && log.cycleLitres && (
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  {Math.round(log.cycleDistance)} km / {Number(log.cycleLitres.toFixed(1))} L in cycle
                                </div>
                              )}
                            </div>
                          ) : log.economyStatus === 'partial-fill' ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--accent-amber)' }}>Awaiting full fill</span>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Unknown fill — ineligible</span>
                          )}
                        </td>
                        <td style={{ padding: '0.65rem 0.4rem', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => handleDelete(log.id)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                            aria-label={`Delete refuel log from ${dateStr}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: '0.75rem' }}>
                <Pagination
                  currentPage={page}
                  totalItems={logs.length}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  itemLabel="logs"
                />
              </div>
            </div>
          )}
        </section>

        {/* Right: Add Refuel Form & Chart */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Form */}
          <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }} aria-label="Add refuel entry form">
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Add Refuel Entry
            </h2>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label htmlFor="fuel-litres-input" className="form-label">
                    Litres refueled (L)
                  </label>
                  <input
                    id="fuel-litres-input"
                    type="number"
                    step="0.01"
                    placeholder="e.g. 28.5"
                    value={litresInput}
                    onChange={e => setLitresInput(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="fuel-odo-input" className="form-label">
                    Current Odometer (km)
                  </label>
                  <input
                    id="fuel-odo-input"
                    type="number"
                    step="0.1"
                    placeholder="e.g. 45890.3"
                    value={odoInput}
                    onChange={e => setOdoInput(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="fuel-fill-state" className="form-label">
                  Tank state after refueling
                </label>
                <select
                  id="fuel-fill-state"
                  value={fillStateInput}
                  onChange={e => setFillStateInput(e.target.value as 'full' | 'partial' | 'unknown')}
                  className="form-select"
                >
                  <option value="unknown">Unknown</option>
                  <option value="full">Full tank</option>
                  <option value="partial">Partial fill</option>
                </select>
                <p style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '0.35rem', lineHeight: 1.4 }}>
                  Economy uses two confirmed full fills and includes partial fills between them. Unknown fills do not establish a cycle.
                </p>
              </div>

              {error && <div className="form-error">{error}</div>}
              {successMsg && (
                <div style={{ padding: '0.55rem 0.75rem', background: 'var(--accent-green-bg)', border: '1px solid var(--accent-green)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-green)', fontSize: '0.825rem' }}>
                  {successMsg}
                </div>
              )}
              {!explicitVehicleSelected && (
                <div style={{ padding: '0.55rem 0.75rem', background: 'var(--accent-amber-bg)', border: '1px solid var(--accent-amber)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-amber)', fontSize: '0.8rem' }}>
                  {vehicleGuardMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !explicitVehicleSelected}
                className="btn-primary"
                style={{ width: '100%', marginTop: '0.25rem' }}
              >
                <PlusCircle size={16} />
                <span>{loading ? 'Logging refuel...' : 'Add Refuel Entry'}</span>
              </button>
            </form>
          </section>

          {/* Chart */}
          {chartData.length > 0 && (
            <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }} aria-label="Economy trend chart">
              <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Cycle Efficiency Trend
              </h2>
              <div style={{ height: '200px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorEconomy" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-3)" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="var(--chart-3)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} />
                    <YAxis stroke="var(--text-muted)" fontSize={11} domain={['auto', 'auto']} unit=" km/L" />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', color: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', fontSize: '12px' }} />
                    <Area type="monotone" dataKey="Economy (km/L)" stroke="var(--chart-3)" strokeWidth={2} fillOpacity={1} fill="url(#colorEconomy)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

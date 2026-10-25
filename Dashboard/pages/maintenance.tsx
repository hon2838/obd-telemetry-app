import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Pagination from '../components/Pagination';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { apiFetch } from '../api';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { useVehicle } from '../context/VehicleContext';
import {
  Wrench, CheckCircle, AlertTriangle, AlertOctagon, PlusCircle, Trash2, ArrowLeft, Clock, FileText, Gauge, Calendar, Car
} from 'lucide-react';

interface MaintenanceItem {
  id: string;
  vehicleId: string;
  name: string;
  intervalKm: number | null;
  intervalDays: number | null;
  lastServiceOdo: number | null;
  lastServiceDate: number | null;
  notes: string;
  currentOdometer: number;
  kmSinceService: number | null;
  daysSinceService: number | null;
  kmUntilDue: number | null;
  daysUntilDue: number | null;
  status: 'ok' | 'due_soon' | 'overdue';
}

interface MaintenanceStatus {
  okCount: number;
  dueSoonCount: number;
  overdueCount: number;
  nextUpcoming?: { name: string; kmRemaining: number | null; daysRemaining: number | null } | null;
}

const PRESETS = [
  'Engine Oil & Filter Change',
  'Tire Rotation & Balancing',
  'Brake Pad Replacement',
  'Engine Air Filter Change',
  'Cabin Air Filter Change',
  'Spark Plugs Replacement',
  'Coolant Flush & Replace',
  'Transmission Fluid Change',
  'Battery Replacement'
];

export default function Maintenance() {
  const { vehicles, activeVehicleId, activeVehicle, buildUrl } = useVehicle();
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

  const fetchData = async (signal?: AbortSignal) => {
    const [itemsRes, statusRes] = await Promise.all([
      apiFetch(buildUrl('/api/maintenance'), { signal }),
      apiFetch(buildUrl('/api/maintenance/status'), { signal }),
    ]);
    if (!itemsRes.ok) throw new Error(`Maintenance HTTP ${itemsRes.status}`);
    if (!statusRes.ok) throw new Error(`Maintenance status HTTP ${statusRes.status}`);
    const [itemsData, statusData] = await Promise.all([itemsRes.json(), statusRes.json()]);
    const nextItems = Array.isArray(itemsData) ? itemsData : [];
    setItems(nextItems);
    setStatus(statusData || { okCount: 0, dueSoonCount: 0, overdueCount: 0, nextUpcoming: null });
    if (nextItems.length > 0) {
      setCurrentOdoVal(nextItems[0].currentOdometer);
      return;
    }
    const logsRes = await apiFetch(buildUrl('/api/fuel-logs'), { signal });
    if (logsRes.ok) {
      const logsData = await logsRes.json();
      if (Array.isArray(logsData) && logsData.length > 0) setCurrentOdoVal(logsData[0].odometer);
    }
  };

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setPage(1);
  }, [activeVehicleId]);

  useVisibilityPolling(fetchData, 10000, [activeVehicleId, buildUrl]);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const explicitVehicle = vehicles.find(v => v.id === activeVehicleId) || null;
    if (!explicitVehicle) {
      setError(
        vehicles.length === 0
          ? 'No vehicles are assigned to your account yet. Ask an admin to assign one before creating a schedule.'
          : 'Select a specific vehicle (not All Vehicles) before creating a schedule.'
      );
      return;
    }

    if (!name.trim()) {
      setError('Please provide a name for the maintenance item.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          intervalKm: intervalKm ? parseFloat(intervalKm) : null,
          intervalDays: intervalDays ? parseInt(intervalDays) : null,
          lastServiceOdo: lastServiceOdo ? parseFloat(lastServiceOdo) : null,
          lastServiceDate: lastServiceDate ? new Date(lastServiceDate).getTime() : null,
          notes: notes.trim(),
          vehicleId: explicitVehicle.id
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
      const res = await apiFetch(`/api/maintenance/${id}`, {
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
      const res = await apiFetch(`/api/maintenance/${id}`, { method: 'DELETE' });
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

  const getProgressColor = (itemStatus: MaintenanceItem['status']) => {
    switch (itemStatus) {
      case 'ok': return 'var(--accent-green)';
      case 'due_soon': return 'var(--accent-amber)';
      case 'overdue': return 'var(--accent-red)';
    }
  };

  const explicitVehicleSelected = vehicles.some(v => v.id === activeVehicleId);
  const vehicleGuardMessage = vehicles.length === 0
    ? 'No vehicles are assigned to your account yet.'
    : 'Select a specific vehicle (not All Vehicles) to enable saving.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Head>
        <title>Maintenance & Schedules | OBD Telemetry</title>
        <meta name="description" content="Vehicle maintenance schedules, parts wear tracking, and service intervals" />
      </Head>

      <PageHeader
        title="Maintenance & Schedules"
        subtitle="Track component service wear, manage service schedules, and receive inspection alerts."
      />

      {/* Status Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
        gap: '0.85rem'
      }}>
        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Schedules OK</span>
            <CheckCircle size={16} color="var(--accent-green)" />
          </div>
          <div className="metric-summary-value">{status.okCount}</div>
          <div className="metric-summary-subtext">Maintenance intervals healthy</div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Due Soon</span>
            <AlertTriangle size={16} color="var(--accent-amber)" />
          </div>
          <div className="metric-summary-value">{status.dueSoonCount}</div>
          <div className="metric-summary-subtext">Within 10% of replacement schedule</div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Overdue Items</span>
            <AlertOctagon size={16} color="var(--accent-red)" />
          </div>
          <div className="metric-summary-value" style={{ color: status.overdueCount > 0 ? 'var(--accent-red)' : 'var(--text-primary)' }}>
            {status.overdueCount}
          </div>
          <div className="metric-summary-subtext">Requires immediate service attention</div>
        </div>
      </div>

      {/* Main Grid: Current Schedules (Prioritized) + Add Schedule Form */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
        gap: '1rem'
      }}>
        {/* Left / Primary: Active Schedules List */}
        <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }} aria-label="Maintenance schedule list">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Wrench size={18} color="var(--accent-cyan)" />
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Active Schedules ({items.length})
              </h2>
            </div>
            {status.nextUpcoming && (
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-amber)' }}>
                Next: {status.nextUpcoming.name}
              </span>
            )}
          </div>

          {items.length === 0 ? (
            <EmptyState
              icon={<Wrench size={32} />}
              title="No maintenance schedules created"
              description="Create a schedule using the form on the right to track oil changes, brake pads, filters, and other wear items."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {paginatedItems.map(item => {
                const pct = getProgressPercentage(item);
                const color = getProgressColor(item.status);
                return (
                  <div
                    key={item.id}
                    className="glass-panel"
                    style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <div>
                        <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                          {item.name}
                        </h3>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Last: {typeof item.lastServiceOdo === 'number' ? `${item.lastServiceOdo.toFixed(1)} km` : '0.0 km'} · {item.lastServiceDate ? new Date(item.lastServiceDate).toLocaleDateString() : 'Never'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          type="button"
                          onClick={() => handleMarkServiced(item.id)}
                          className="btn-secondary"
                          style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem', color: 'var(--accent-green)', borderColor: 'var(--accent-green)' }}
                        >
                          Mark Completed
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                          aria-label={`Delete schedule ${item.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Progress track */}
                    <div style={{ width: '100%', height: '5px', background: 'var(--surface-inset)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color }} />
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', fontSize: '0.775rem', color: 'var(--text-secondary)' }}>
                      {item.intervalKm && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Gauge size={13} color="var(--text-muted)" />
                          <span>
                            {typeof item.kmSinceService === 'number' ? item.kmSinceService.toFixed(0) : '0'} / {typeof item.intervalKm === 'number' ? item.intervalKm.toFixed(0) : '0'} km
                            {' '}({item.kmUntilDue !== null && item.kmUntilDue <= 0 ? <strong style={{ color: 'var(--accent-red)' }}>Overdue!</strong> : `${typeof item.kmUntilDue === 'number' ? item.kmUntilDue.toFixed(0) : '0'} km left`})
                          </span>
                        </div>
                      )}
                      {item.intervalDays && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Calendar size={13} color="var(--text-muted)" />
                          <span>
                            {item.daysSinceService} / {item.intervalDays} days
                            {' '}({item.daysUntilDue !== null && item.daysUntilDue <= 0 ? <strong style={{ color: 'var(--accent-red)' }}>Overdue!</strong> : `${item.daysUntilDue} days left`})
                          </span>
                        </div>
                      )}
                      {item.notes && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%', color: 'var(--text-muted)' }}>
                          <FileText size={12} />
                          <span>"{item.notes}"</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div style={{ marginTop: '0.5rem' }}>
                <Pagination
                  currentPage={page}
                  totalItems={items.length}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  itemLabel="schedules"
                />
              </div>
            </div>
          )}
        </section>

        {/* Right: Add Maintenance Schedule Form */}
        <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }} aria-label="Add maintenance schedule">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <PlusCircle size={18} color="var(--accent-cyan)" />
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Add Schedule
            </h2>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label htmlFor="maint-name-input" className="form-label">
                Schedule Name
              </label>
              <input
                id="maint-name-input"
                type="text"
                placeholder="e.g. Engine Oil Change"
                value={name}
                onChange={e => setName(e.target.value)}
                className="form-input"
                list="presets-list"
                required
              />
              <datalist id="presets-list">
                {PRESETS.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label htmlFor="maint-interval-km-input" className="form-label">
                  Interval (km)
                </label>
                <input
                  id="maint-interval-km-input"
                  type="number"
                  placeholder="e.g. 10000"
                  value={intervalKm}
                  onChange={e => setIntervalKm(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label htmlFor="maint-interval-days-input" className="form-label">
                  Interval (Days)
                </label>
                <input
                  id="maint-interval-days-input"
                  type="number"
                  placeholder="e.g. 180"
                  value={intervalDays}
                  onChange={e => setIntervalDays(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label htmlFor="maint-last-odo-input" className="form-label">
                  Last Service Odometer (km)
                </label>
                <input
                  id="maint-last-odo-input"
                  type="number"
                  placeholder={`Default: ${currentOdoVal}`}
                  value={lastServiceOdo}
                  onChange={e => setLastServiceOdo(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label htmlFor="maint-last-date-input" className="form-label">
                  Last Service Date
                </label>
                <input
                  id="maint-last-date-input"
                  type="date"
                  value={lastServiceDate}
                  onChange={e => setLastServiceDate(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            <div>
              <label htmlFor="maint-notes-input" className="form-label">
                Service Notes
              </label>
              <textarea
                id="maint-notes-input"
                placeholder="Specific fluids, oil viscosity, filter part numbers..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="form-input"
                style={{ height: '70px', resize: 'none' }}
              />
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
              <Wrench size={16} />
              <span>{loading ? 'Creating...' : `Create Schedule${activeVehicle ? ` — ${activeVehicle.name}` : ''}`}</span>
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

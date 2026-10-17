import React, { useState } from 'react';
import Head from 'next/head';
import { Car, Plus, Trash2, Edit3, Check, ShieldAlert, Activity, Fuel, Wrench, X } from 'lucide-react';
import { useVehicle, Vehicle } from '../context/VehicleContext';
import { apiFetch } from '../api';
import PageHeader from '../components/PageHeader';
import MetricSummary from '../components/MetricSummary';
import Dialog from '../components/Dialog';

export default function Garage() {
  const { vehicles, activeVehicleId, selectVehicle, refreshVehicles } = useVehicle();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [deletingVehicle, setDeletingVehicle] = useState<Vehicle | null>(null);

  // Form states
  const [formName, setFormName] = useState('');
  const [formTank, setFormTank] = useState('36');
  const [formId, setFormId] = useState('');
  const [reassignTarget, setReassignTarget] = useState('default');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleOpenAdd = () => {
    setFormName('');
    setFormTank('36');
    setFormId('');
    setErrorMsg(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (v: Vehicle) => {
    setEditingVehicle(v);
    setFormName(v.name);
    setFormTank(v.tankLitres ? String(v.tankLitres) : '36');
    setErrorMsg(null);
  };

  const handleCreateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setErrorMsg('Vehicle name is required');
      return;
    }
    setLoading(true);
    setErrorMsg(null);

    try {
      const payload: any = {
        name: formName.trim(),
        tankLitres: Number(formTank) || 36,
      };
      if (formId.trim()) {
        payload.vehicleId = formId.trim();
      }

      const res = await apiFetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errData.error || `Failed to create vehicle: HTTP ${res.status}`);
      }

      const created = await res.json();
      await refreshVehicles();
      selectVehicle(created.id);
      setIsAddModalOpen(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error creating vehicle');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVehicle) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      const payload = {
        name: formName.trim(),
        tankLitres: Number(formTank) || 36,
      };

      const res = await apiFetch(`/api/vehicles/${editingVehicle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errData.error || `Failed to update: HTTP ${res.status}`);
      }

      await refreshVehicles();
      setEditingVehicle(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error updating vehicle');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteVehicle = async () => {
    if (!deletingVehicle) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      const query = reassignTarget ? `?reassign=${encodeURIComponent(reassignTarget)}` : '';
      const res = await apiFetch(`/api/vehicles/${deletingVehicle.id}${query}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errData.error || `Failed to delete: HTTP ${res.status}`);
      }

      if (activeVehicleId === deletingVehicle.id) {
        selectVehicle('all');
      }
      await refreshVehicles();
      setDeletingVehicle(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error deleting vehicle');
    } finally {
      setLoading(false);
    }
  };

  const totalTelemetry = vehicles.reduce((acc, v) => acc + (v.recordCount?.telemetry || 0), 0);
  const totalFuelLogs = vehicles.reduce((acc, v) => acc + (v.recordCount?.fuelLogs || 0), 0);
  const totalMaint = vehicles.reduce((acc, v) => acc + (v.recordCount?.maintenance || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Head>
        <title>Garage & Fleet Hub | OBD Telemetry</title>
        <meta name="description" content="Manage multi-vehicle profiles, tank capacities, and fleet assignments" />
      </Head>

      <PageHeader
        title="Garage & Fleet Hub"
        subtitle="Manage multi-vehicle profiles, tank capacities, and fleet assignments."
        action={
          <button
            type="button"
            onClick={handleOpenAdd}
            className="btn-primary"
          >
            <Plus size={16} />
            <span>Add Vehicle</span>
          </button>
        }
      />

      {/* Fleet KPI Banner */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: '0.85rem' }}>
        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Registered Vehicles</span>
            <Car size={16} color="var(--accent-cyan)" />
          </div>
          <div className="metric-summary-value">{vehicles.length}</div>
          <div className="metric-summary-subtext">Active vehicle profiles</div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Fleet Telemetry Points</span>
            <Activity size={16} color="var(--accent-cyan)" />
          </div>
          <div className="metric-summary-value">{totalTelemetry.toLocaleString()}</div>
          <div className="metric-summary-subtext">Aggregated across fleet</div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Fuel Fill-Ups</span>
            <Fuel size={16} color="var(--accent-green)" />
          </div>
          <div className="metric-summary-value">{totalFuelLogs.toLocaleString()}</div>
          <div className="metric-summary-subtext">Logged fuel receipts</div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Maintenance Schedules</span>
            <Wrench size={16} color="var(--accent-purple)" />
          </div>
          <div className="metric-summary-value">{totalMaint.toLocaleString()}</div>
          <div className="metric-summary-subtext">Tracked service schedules</div>
        </div>
      </div>

      {/* Vehicles Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '1rem' }}>
        {vehicles.map((v) => {
          const isActive = activeVehicleId === v.id;
          const isDefault = v.id === 'default';

          return (
            <div
              key={v.id}
              className="glass-panel"
              style={{
                padding: '1.25rem',
                border: isActive ? '1px solid var(--accent-cyan)' : '1px solid var(--border)',
                background: isActive ? 'rgba(72, 197, 179, 0.05)' : 'var(--surface)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '1rem'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                      {v.name}
                    </h3>
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '4px', background: 'var(--surface-inset)', color: 'var(--text-muted)' }}>
                        ID: {v.id}
                      </span>
                      {isDefault && (
                        <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem', borderRadius: '4px', background: 'var(--od-tint)', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                          Primary / Default
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(v)}
                      title="Edit Vehicle"
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem' }}
                      aria-label={`Edit ${v.name}`}
                    >
                      <Edit3 size={15} />
                    </button>
                    {!isDefault && (
                      <button
                        type="button"
                        onClick={() => { setDeletingVehicle(v); setErrorMsg(null); }}
                        title="Delete Vehicle"
                        style={{ background: 'transparent', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: '0.25rem' }}
                        aria-label={`Delete ${v.name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Specs */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', margin: '0.85rem 0', padding: '0.75rem', background: 'var(--surface-inset)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Fuel Capacity</span>
                    <p style={{ fontWeight: 600, color: 'var(--text-primary)', margin: '0.15rem 0 0' }}>
                      {v.tankLitres ? `${v.tankLitres} L` : '36 L (Default)'}
                    </p>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Telemetry Logged</span>
                    <p style={{ fontWeight: 600, color: 'var(--accent-cyan)', margin: '0.15rem 0 0' }}>
                      {(v.recordCount?.telemetry || 0).toLocaleString()} pts
                    </p>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Fuel Records</span>
                    <p style={{ fontWeight: 600, color: 'var(--text-primary)', margin: '0.15rem 0 0' }}>
                      {v.recordCount?.fuelLogs || 0} fill-ups
                    </p>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Maintenance Tasks</span>
                    <p style={{ fontWeight: 600, color: 'var(--text-primary)', margin: '0.15rem 0 0' }}>
                      {v.recordCount?.maintenance || 0} items
                    </p>
                  </div>
                </div>
              </div>

              {/* Select Button */}
              <button
                type="button"
                onClick={() => selectVehicle(isActive ? 'all' : v.id)}
                className={isActive ? 'btn-primary' : 'btn-secondary'}
                style={{ width: '100%' }}
              >
                {isActive ? (
                  <>
                    <Check size={15} />
                    <span>Selected Active Vehicle</span>
                  </>
                ) : (
                  <span>Select Vehicle</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Add Vehicle Modal */}
      <Dialog
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add New Vehicle"
        description="Register a new car profile in your personal fleet"
        maxWidth="460px"
      >
        <form onSubmit={handleCreateVehicle} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="form-label">Vehicle Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Perodua Bezza 1.3"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="form-input"
            />
          </div>

          <div>
            <label className="form-label">Tank Capacity (Litres)</label>
            <input
              type="number"
              step="0.1"
              min="1"
              max="500"
              required
              value={formTank}
              onChange={(e) => setFormTank(e.target.value)}
              className="form-input"
            />
          </div>

          <div>
            <label className="form-label">Custom Vehicle ID (Optional)</label>
            <input
              type="text"
              placeholder="e.g. bezza-2022 (leave blank to auto-generate)"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              className="form-input"
            />
          </div>

          {errorMsg && <div className="form-error">{errorMsg}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsAddModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
            >
              {loading ? 'Creating...' : 'Create Vehicle'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Edit Vehicle Modal */}
      <Dialog
        isOpen={!!editingVehicle}
        onClose={() => setEditingVehicle(null)}
        title={`Edit ${editingVehicle?.name || 'Vehicle'}`}
        maxWidth="460px"
      >
        <form onSubmit={handleUpdateVehicle} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="form-label">Vehicle Name</label>
            <input
              type="text"
              required
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="form-input"
            />
          </div>

          <div>
            <label className="form-label">Tank Capacity (Litres)</label>
            <input
              type="number"
              step="0.1"
              min="1"
              max="500"
              required
              value={formTank}
              onChange={(e) => setFormTank(e.target.value)}
              className="form-input"
            />
          </div>

          {errorMsg && <div className="form-error">{errorMsg}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setEditingVehicle(null)}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Delete Vehicle Modal */}
      <Dialog
        isOpen={!!deletingVehicle}
        onClose={() => setDeletingVehicle(null)}
        title={`Delete "${deletingVehicle?.name}"?`}
        maxWidth="480px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            Are you sure you want to delete this vehicle? Its recorded telemetry, fuel receipts, and maintenance tasks can be safely reassigned to another vehicle profile.
          </p>

          <div>
            <label className="form-label">Reassign Data To:</label>
            <select
              value={reassignTarget}
              onChange={(e) => setReassignTarget(e.target.value)}
              className="form-select"
            >
              {vehicles.filter(v => v.id !== deletingVehicle?.id).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.id})
                </option>
              ))}
            </select>
          </div>

          {errorMsg && <div className="form-error">{errorMsg}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setDeletingVehicle(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={loading}
              onClick={handleDeleteVehicle}
            >
              {loading ? 'Deleting...' : 'Delete & Reassign Data'}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

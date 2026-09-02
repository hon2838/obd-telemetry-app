import React, { useState } from 'react';
import Head from 'next/head';
import { Car, Plus, Trash2, Edit3, Check, ShieldAlert, Activity, Fuel, Wrench } from 'lucide-react';
import { useVehicle, Vehicle } from '../context/VehicleContext';
import { API_HOST } from '../api';

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

      const res = await fetch(`${API_HOST}/api/vehicles`, {
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

      const res = await fetch(`${API_HOST}/api/vehicles/${editingVehicle.id}`, {
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
      const res = await fetch(`${API_HOST}/api/vehicles/${deletingVehicle.id}${query}`, {
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
    <>
      <Head>
        <title>Garage & Fleet Management | OBD Telemetry</title>
      </Head>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1rem' }}>
        {/* Header Title */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Car color="var(--accent-cyan)" size={28} />
              Garage & Fleet Hub
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
              Manage multi-vehicle profiles, tank capacities, and fleet assignments.
            </p>
          </div>

          <button
            onClick={handleOpenAdd}
            className="glass-panel"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, rgba(94, 215, 208, 0.2), rgba(141, 156, 255, 0.2))',
              border: '1px solid var(--border-glow)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
            }}
          >
            <Plus size={18} color="var(--accent-cyan)" />
            <span>Add Vehicle</span>
          </button>
        </div>

        {/* Fleet KPI Banner */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              <Car size={16} color="var(--accent-cyan)" />
              <span>Registered Vehicles</span>
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--accent-cyan)', marginTop: '0.5rem' }}>
              {vehicles.length}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              <Activity size={16} color="var(--accent-blue)" />
              <span>Fleet Telemetry Points</span>
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--accent-blue)', marginTop: '0.5rem' }}>
              {totalTelemetry.toLocaleString()}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              <Fuel size={16} color="var(--accent-khaki)" />
              <span>Fuel Fill-Ups</span>
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--accent-khaki)', marginTop: '0.5rem' }}>
              {totalFuelLogs.toLocaleString()}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              <Wrench size={16} color="var(--accent-purple)" />
              <span>Maintenance Schedules</span>
            </div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--accent-purple)', marginTop: '0.5rem' }}>
              {totalMaint.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Vehicles Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
          {vehicles.map((v) => {
            const isActive = activeVehicleId === v.id;
            const isDefault = v.id === 'default';

            return (
              <div
                key={v.id}
                className="glass-panel"
                style={{
                  padding: '1.5rem',
                  borderRadius: 'var(--radius-lg)',
                  border: isActive ? '2px solid var(--accent-cyan)' : '1px solid var(--border)',
                  background: isActive ? 'rgba(20, 25, 31, 0.95)' : 'var(--surface)',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: isActive ? '0 0 20px rgba(94, 215, 208, 0.15)' : 'none',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <div>
                      <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {v.name}
                      </h3>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.725rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'var(--surface-inset)', color: 'var(--text-muted)' }}>
                          ID: {v.id}
                        </span>
                        {isDefault && (
                          <span style={{ fontSize: '0.725rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'rgba(141, 156, 255, 0.2)', color: 'var(--accent-blue)', fontWeight: 600 }}>
                            Primary / Default
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button
                        onClick={() => handleOpenEdit(v)}
                        title="Edit Vehicle"
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.35rem' }}
                      >
                        <Edit3 size={16} />
                      </button>
                      {!isDefault && (
                        <button
                          onClick={() => { setDeletingVehicle(v); setErrorMsg(null); }}
                          title="Delete Vehicle"
                          style={{ background: 'transparent', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: '0.35rem' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Vehicle Specs */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', margin: '1rem 0', padding: '0.75rem', background: 'var(--surface-inset)', borderRadius: 'var(--radius-sm)' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Fuel Capacity</span>
                      <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--accent-khaki)' }}>
                        {v.tankLitres ? `${v.tankLitres} L` : '36 L (Default)'}
                      </p>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Telemetry Logged</span>
                      <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                        {(v.recordCount?.telemetry || 0).toLocaleString()} pts
                      </p>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Fuel Records</span>
                      <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {v.recordCount?.fuelLogs || 0} fill-ups
                      </p>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Maintenance Tasks</span>
                      <p style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {v.recordCount?.maintenance || 0} items
                      </p>
                    </div>
                  </div>
                </div>

                {/* Switcher Button */}
                <button
                  onClick={() => selectVehicle(isActive ? 'all' : v.id)}
                  style={{
                    width: '100%',
                    padding: '0.65rem',
                    borderRadius: 'var(--radius-md)',
                    border: isActive ? '1px solid var(--accent-cyan)' : '1px solid var(--border)',
                    background: isActive ? 'rgba(94, 215, 208, 0.15)' : 'var(--surface-hover)',
                    color: isActive ? 'var(--accent-cyan)' : 'var(--text-primary)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    marginTop: '0.5rem',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {isActive ? (
                    <>
                      <Check size={16} color="var(--accent-cyan)" />
                      <span>Active Dashboard Car</span>
                    </>
                  ) : (
                    <span>Switch to this Car</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal: Add Vehicle */}
      {isAddModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '440px', padding: '1.75rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-glow)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Plus size={20} color="var(--accent-cyan)" />
              Add New Vehicle
            </h3>

            {errorMsg && (
              <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--accent-red)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-red)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateVehicle} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Vehicle Name (e.g. Proton X50, Perodua Myvi) *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Proton X50"
                  style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Fuel Tank Capacity (Litres)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="500"
                  value={formTank}
                  onChange={(e) => setFormTank(e.target.value)}
                  placeholder="36"
                  style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Custom Vehicle ID (Optional)
                </label>
                <input
                  type="text"
                  value={formId}
                  onChange={(e) => setFormId(e.target.value)}
                  placeholder="Auto-generated if blank"
                  style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  style={{ flex: 1, padding: '0.65rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{ flex: 1, padding: '0.65rem', background: 'var(--accent-cyan)', border: 'none', borderRadius: 'var(--radius-md)', color: '#0b0d11', fontWeight: 600, cursor: 'pointer' }}
                >
                  {loading ? 'Creating...' : 'Create Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Vehicle */}
      {editingVehicle && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '440px', padding: '1.75rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-glow)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Edit3 size={20} color="var(--accent-cyan)" />
              Edit {editingVehicle.name}
            </h3>

            {errorMsg && (
              <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--accent-red)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-red)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleUpdateVehicle} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Vehicle Name
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Fuel Tank Capacity (Litres)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  max="500"
                  value={formTank}
                  onChange={(e) => setFormTank(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setEditingVehicle(null)}
                  style={{ flex: 1, padding: '0.65rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{ flex: 1, padding: '0.65rem', background: 'var(--accent-cyan)', border: 'none', borderRadius: 'var(--radius-md)', color: '#0b0d11', fontWeight: 600, cursor: 'pointer' }}
                >
                  {loading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Vehicle Confirmation */}
      {deletingVehicle && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '440px', padding: '1.75rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--accent-red)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldAlert size={22} color="var(--accent-red)" />
              Delete Vehicle Profile
            </h3>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Are you sure you want to delete <strong>{deletingVehicle.name}</strong>?
            </p>

            {errorMsg && (
              <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--accent-red)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-red)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {errorMsg}
              </div>
            )}

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                Reassign existing records to:
              </label>
              <select
                value={reassignTarget}
                onChange={(e) => setReassignTarget(e.target.value)}
                style={{ width: '100%', padding: '0.65rem', background: 'var(--surface-inset)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}
              >
                <option value="default">Default Vehicle</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setDeletingVehicle(null)}
                style={{ flex: 1, padding: '0.65rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteVehicle}
                disabled={loading}
                style={{ flex: 1, padding: '0.65rem', background: 'var(--accent-red)', border: 'none', borderRadius: 'var(--radius-md)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
              >
                {loading ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

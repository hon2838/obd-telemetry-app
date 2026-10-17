import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { apiFetch } from '../api';
import { useVehicle } from '../context/VehicleContext';
import PageHeader from '../components/PageHeader';
import {
  Car, ShieldCheck, CheckCircle2, AlertCircle, KeyRound, Radio, Smartphone, Info, ArrowRight
} from 'lucide-react';

export default function PairVehiclePage() {
  const router = useRouter();
  const { vehicles, refreshVehicles } = useVehicle();

  const [pinCode, setPinCode] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('default');
  const [isNewVehicle, setIsNewVehicle] = useState(false);
  const [newVehicleName, setNewVehicleName] = useState('');
  const [newTankLitres, setNewTankLitres] = useState(36);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (router.query.code && typeof router.query.code === 'string') {
      setPinCode(router.query.code);
    }
  }, [router.query.code]);

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const payload: any = {
        pairingCode: pinCode.trim(),
      };

      if (isNewVehicle && newVehicleName.trim()) {
        payload.newVehicleName = newVehicleName.trim();
        payload.tankLitres = Number(newTankLitres) || 36;
      } else {
        payload.vehicleId = selectedVehicleId;
      }

      const res = await apiFetch('/api/auth/device/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to claim and pair vehicle device');
      }

      setSuccess(
        `Head unit successfully authorized for "${data.vehicleName || 'Vehicle'}"! Next steps: Plug your OBD-II adapter into the vehicle OBD port and start driving. Live telemetry will upload automatically once connected.`
      );
      await refreshVehicles();
      setTimeout(() => {
        router.push('/garage');
      }, 3500);
    } catch (err: any) {
      setError(err.message || 'Error pairing device');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Head>
        <title>Pair Car Head Unit | OBD Telemetry</title>
        <meta name="description" content="Authorize and pair vehicle head unit device to sync telemetry" />
      </Head>

      <PageHeader
        title="Pair Car Head Unit"
        subtitle="Authorize your vehicle dashboard or Android head unit to securely sync telemetry."
      />

      {/* Step Guide */}
      <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
          Pairing Process
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', fontSize: '0.78rem' }}>
          <div style={{ padding: '0.5rem', background: 'var(--surface-inset)', borderRadius: 'var(--radius-sm)' }}>
            <strong style={{ color: 'var(--accent-cyan)', display: 'block' }}>1. Display PIN</strong>
            <span style={{ color: 'var(--text-muted)' }}>On car head unit app</span>
          </div>
          <div style={{ padding: '0.5rem', background: 'var(--surface-inset)', borderRadius: 'var(--radius-sm)' }}>
            <strong style={{ color: 'var(--accent-cyan)', display: 'block' }}>2. Enter Code</strong>
            <span style={{ color: 'var(--text-muted)' }}>Match PIN in form below</span>
          </div>
          <div style={{ padding: '0.5rem', background: 'var(--surface-inset)', borderRadius: 'var(--radius-sm)' }}>
            <strong style={{ color: 'var(--accent-cyan)', display: 'block' }}>3. Authorize</strong>
            <span style={{ color: 'var(--text-muted)' }}>Authorize this device</span>
          </div>
          <div style={{ padding: '0.5rem', background: 'var(--surface-inset)', borderRadius: 'var(--radius-sm)' }}>
            <strong style={{ color: 'var(--accent-cyan)', display: 'block' }}>4. Verify Upload</strong>
            <span style={{ color: 'var(--text-muted)' }}>Plug OBD & test read</span>
          </div>
        </div>
      </div>

      {/* Form Card */}
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {error && (
          <div className="form-error">
            {error}
          </div>
        )}

        {success && (
          <div style={{
            padding: '0.85rem 1rem',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent-green-bg)',
            border: '1px solid var(--accent-green)',
            color: 'var(--accent-green)',
            fontSize: '0.85rem',
            lineHeight: 1.45,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.6rem'
          }}>
            <CheckCircle2 size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handlePair} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* PIN Code Field */}
          <div>
            <label htmlFor="pin-input" className="form-label" style={{ fontWeight: 600 }}>
              6-Digit Pairing PIN
            </label>
            <div style={{ position: 'relative' }}>
              <KeyRound size={18} color="var(--accent-cyan)" style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                id="pin-input"
                type="text"
                required
                maxLength={10}
                placeholder="e.g. 842-195"
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
                className="form-input"
                style={{
                  paddingLeft: '2.5rem',
                  fontSize: '1.25rem',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  textAlign: 'center'
                }}
              />
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem', textAlign: 'center' }}>
              Pairing PIN expires after 10 minutes. A fresh PIN can be requested in the car app.
            </p>
          </div>

          {/* Vehicle Assignment */}
          <div>
            <label className="form-label" style={{ fontWeight: 600 }}>
              Assign to Vehicle Profile
            </label>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setIsNewVehicle(false)}
                className={!isNewVehicle ? 'btn-primary' : 'btn-secondary'}
                style={{ flex: 1, padding: '0.45rem' }}
              >
                Existing Vehicle
              </button>
              <button
                type="button"
                onClick={() => setIsNewVehicle(true)}
                className={isNewVehicle ? 'btn-primary' : 'btn-secondary'}
                style={{ flex: 1, padding: '0.45rem' }}
              >
                + Add New Vehicle
              </button>
            </div>

            {!isNewVehicle ? (
              <select
                value={selectedVehicleId}
                onChange={(e) => setSelectedVehicleId(e.target.value)}
                className="form-select"
              >
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.id}) {v.tankLitres ? `— ${v.tankLitres}L` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{
                padding: '0.85rem',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-inset)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
              }}>
                <div>
                  <label className="form-label">
                    Vehicle Name / Model
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Perodua Axia SE"
                    value={newVehicleName}
                    onChange={(e) => setNewVehicleName(e.target.value)}
                    className="form-input"
                    required={isNewVehicle}
                  />
                </div>
                <div>
                  <label className="form-label">
                    Fuel Tank Capacity (Litres)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder="36"
                    value={newTankLitres}
                    onChange={(e) => setNewTankLitres(Number(e.target.value))}
                    className="form-input"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !pinCode.trim()}
            className="btn-primary"
            style={{ width: '100%', padding: '0.75rem', marginTop: '0.5rem' }}
          >
            <ShieldCheck size={18} />
            <span>{loading ? 'Authorizing & Pairing...' : 'Authorize & Link Car Head Unit'}</span>
          </button>
        </form>
      </div>

      <div className="glass-panel" style={{ padding: '1rem', display: 'flex', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        <Info size={18} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
        <span>
          Authorizing links this vehicle device to your account. Note that pairing alone does not confirm a successful OBD reading or upload until the adapter connects with vehicle ignition on.
        </span>
      </div>
    </div>
  );
}

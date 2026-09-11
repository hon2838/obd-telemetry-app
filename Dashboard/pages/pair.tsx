import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { apiFetch } from '../api';
import { useVehicle } from '../context/VehicleContext';
import {
  Car, ShieldCheck, CheckCircle2, AlertCircle, KeyRound, Radio, Smartphone, QrCode, ArrowRight
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

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to claim and pair vehicle device');
      }

      setSuccess(`Vehicle successfully paired and linked to "${data.vehicleName || 'Vehicle'}"! Your car head unit is now authorized.`);
      await refreshVehicles();
      setTimeout(() => {
        router.push('/garage');
      }, 2500);
    } catch (err: any) {
      setError(err.message || 'Error pairing device');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Pair Car Device | OBD Telemetry</title>
      </Head>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '1.5rem 1rem' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0.75rem',
            background: 'rgba(94, 215, 208, 0.12)',
            borderRadius: '50%',
            color: 'var(--accent-cyan)',
            marginBottom: '0.75rem'
          }}>
            <Radio size={32} />
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            Pair Car Head Unit
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.35rem' }}>
            Enter the pairing PIN displayed on your car's screen or scanned via QR code.
          </p>
        </div>

        {/* Form Card */}
        <div className="glass-panel" style={{ padding: '2rem', borderRadius: 'var(--radius-lg)' }}>
          {error && (
            <div style={{
              padding: '0.85rem 1rem',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ff8080',
              fontSize: '0.85rem',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem'
            }}>
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div style={{
              padding: '0.85rem 1rem',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: 'var(--accent-green)',
              fontSize: '0.85rem',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem'
            }}>
              <CheckCircle2 size={18} />
              <span>{success}</span>
            </div>
          )}

          <form onSubmit={handlePair} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* PIN Code Field */}
            <div>
              <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                6-Digit Pairing PIN
              </label>
              <div style={{ position: 'relative' }}>
                <KeyRound size={20} color="var(--accent-cyan)" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="text"
                  required
                  maxLength={10}
                  placeholder="e.g. 842-195"
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.85rem 1rem 0.85rem 3rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--surface-inset)',
                    border: '1px solid var(--border-glow)',
                    color: 'var(--accent-cyan)',
                    fontSize: '1.4rem',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    letterSpacing: '0.2em',
                    textAlign: 'center',
                    outline: 'none',
                    boxShadow: '0 0 16px rgba(94, 215, 208, 0.1) inset',
                  }}
                />
              </div>
              <p style={{ fontSize: '0.775rem', color: 'var(--text-muted)', marginTop: '0.4rem', textAlign: 'center' }}>
                PIN expires after 10 minutes. A new code can be generated in the car app.
              </p>
            </div>

            {/* Vehicle Assignment */}
            <div>
              <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                Assign to Vehicle Profile
              </label>

              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setIsNewVehicle(false)}
                  style={{
                    flex: 1,
                    padding: '0.65rem',
                    borderRadius: 'var(--radius-sm)',
                    background: !isNewVehicle ? 'rgba(94, 215, 208, 0.15)' : 'var(--surface-inset)',
                    border: !isNewVehicle ? '1px solid var(--accent-cyan)' : '1px solid var(--border)',
                    color: !isNewVehicle ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  Existing Vehicle
                </button>
                <button
                  type="button"
                  onClick={() => setIsNewVehicle(true)}
                  style={{
                    flex: 1,
                    padding: '0.65rem',
                    borderRadius: 'var(--radius-sm)',
                    background: isNewVehicle ? 'rgba(94, 215, 208, 0.15)' : 'var(--surface-inset)',
                    border: isNewVehicle ? '1px solid var(--accent-cyan)' : '1px solid var(--border)',
                    color: isNewVehicle ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  + Add New Vehicle
                </button>
              </div>

              {!isNewVehicle ? (
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface-inset)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id} style={{ background: '#121820', color: '#fff' }}>
                      {v.name} ({v.id}) {v.tankLitres ? `— ${v.tankLitres}L` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{
                  padding: '1rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface-inset)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.85rem'
                }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.775rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                      Vehicle Name / Model
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Perodua Axia SE 2024"
                      value={newVehicleName}
                      onChange={(e) => setNewVehicleName(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem',
                        borderRadius: 'var(--radius-sm)',
                        background: 'rgba(11, 15, 20, 0.8)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        fontSize: '0.875rem',
                        outline: 'none',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.775rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                      Fuel Tank Capacity (Litres)
                    </label>
                    <input
                      type="number"
                      value={newTankLitres}
                      onChange={(e) => setNewTankLitres(Number(e.target.value))}
                      style={{
                        width: '100%',
                        padding: '0.6rem 0.75rem',
                        borderRadius: 'var(--radius-sm)',
                        background: 'rgba(11, 15, 20, 0.8)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        fontSize: '0.875rem',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !pinCode.trim()}
              style={{
                padding: '0.9rem',
                borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, var(--accent-cyan), #3b82f6)',
                color: '#000',
                fontWeight: 700,
                fontSize: '0.95rem',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: '0 4px 16px rgba(94, 215, 208, 0.3)',
                opacity: loading || !pinCode.trim() ? 0.5 : 1,
                transition: 'all 0.2s',
              }}
            >
              {loading ? (
                <span>Authorizing & Pairing...</span>
              ) : (
                <>
                  <ShieldCheck size={20} />
                  <span>Authorize & Link Car Head Unit</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Help Info Box */}
        <div style={{
          marginTop: '1.5rem',
          padding: '1.25rem',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-inset)',
          border: '1px solid var(--border)',
          display: 'flex',
          gap: '1rem',
          alignItems: 'flex-start'
        }}>
          <Smartphone size={22} color="var(--accent-blue)" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--text-primary)' }}>How Pairing Works:</strong>
            <ol style={{ paddingLeft: '1.2rem', marginTop: '0.35rem' }}>
              <li>The Android OBD App generates a secure hardware fingerprint (Bluetooth MAC / VIN).</li>
              <li>Once you approve the PIN above, a cryptographic token is issued to the car.</li>
              <li>All subsequent telemetry uploads are verified and securely mapped to your vehicle profile.</li>
            </ol>
          </div>
        </div>
      </div>
    </>
  );
}

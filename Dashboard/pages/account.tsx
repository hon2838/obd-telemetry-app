import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { apiFetch, applyAuthResponse } from '../api';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/PageHeader';
import {
  Shield, KeyRound, Smartphone, Trash2, CheckCircle2, AlertCircle, RefreshCw, Radio, Lock, Car, Plus
} from 'lucide-react';

interface PairedDevice {
  id: string;
  name: string;
  vehicleId: string;
  vehicleName: string;
  fingerprint?: {
    vin?: string;
    btMac?: string;
    androidId?: string;
    deviceModel?: string;
  };
  createdAt: number;
  lastSeenAt: number;
  tokenMasked: string;
}

export default function AccountSecurityPage() {
  const { profile, refreshProfile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);
  const [pwdError, setPwdError] = useState<string | null>(null);

  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [username, setUsername] = useState('admin');

  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);

  const fetchProfileAndDevices = async () => {
    try {
      setDevicesLoading(true);
      const currentProfile = profile || await refreshProfile();
      if (currentProfile) {
        setMustChangePassword(!!currentProfile.mustChangePassword);
        if (currentProfile.username) setUsername(currentProfile.username);
      }
      const devRes = await apiFetch('/api/devices').catch(() => null);
      if (devRes && devRes.ok) {
        const devData = await devRes.json();
        setDevices(Array.isArray(devData) ? devData : []);
      }
    } catch (err) {
      console.error('Error loading account data:', err);
    } finally {
      setDevicesLoading(false);
    }
  };

  useEffect(() => {
    fetchProfileAndDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(null);

    if (newPassword.length < 8) {
      setPwdError('New password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwdError('New passwords do not match');
      return;
    }

    setPwdLoading(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          currentPassword,
          newPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update password');
      }

      applyAuthResponse(data);
      await refreshProfile();
      setPwdSuccess('Password changed successfully! Default setup password deactivated.');
      setMustChangePassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPwdError(err.message || 'Error updating password');
    } finally {
      setPwdLoading(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    if (!confirm('Are you sure you want to revoke this car device? It will need to be re-paired to upload telemetry.')) {
      return;
    }

    try {
      const res = await apiFetch(`/api/devices/${deviceId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
      }
    } catch (err) {
      console.error('Error revoking device:', err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Head>
        <title>Account & Security | OBD Telemetry</title>
        <meta name="description" content="Manage administrative credentials and authorized head unit devices" />
      </Head>

      <PageHeader
        title="Account & Device Security"
        subtitle="Manage administrative credentials, security policy, and authorized car head units."
        action={
          <Link href="/pair" className="btn-primary">
            <Radio size={16} />
            <span>Pair Car Head Unit</span>
          </Link>
        }
      />

      {/* Security Status Banners */}
      {mustChangePassword && (
        <div style={{
          padding: '1rem',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--accent-amber-bg)',
          border: '1px solid var(--accent-amber)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.85rem'
        }}>
          <AlertCircle size={22} color="var(--accent-amber)" style={{ flexShrink: 0 }} />
          <div>
            <strong style={{ color: 'var(--accent-amber)', fontSize: '0.9rem', display: 'block' }}>
              Default Password Active
            </strong>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              Your account is using the default initial password. Please update it below to protect your vehicle telemetry.
            </span>
          </div>
        </div>
      )}

      {/* Main Grid: Change Password & Devices */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))',
        gap: '1rem'
      }}>
        {/* Card: Change Password */}
        <section className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }} aria-label="Change password">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <KeyRound size={18} color="var(--accent-cyan)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Change Password
            </h2>
          </div>

          {pwdError && <div className="form-error">{pwdError}</div>}
          {pwdSuccess && (
            <div style={{ padding: '0.55rem 0.75rem', background: 'var(--accent-green-bg)', border: '1px solid var(--accent-green)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-green)', fontSize: '0.825rem' }}>
              {pwdSuccess}
            </div>
          )}

          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div>
              <label className="form-label">
                Current / Setup Password
              </label>
              <input
                type="password"
                placeholder="e.g. admin12345"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="form-input"
                required
              />
            </div>

            <div>
              <label className="form-label">
                New Strong Password (min 8 chars)
              </label>
              <input
                type="password"
                placeholder="Enter new strong password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="form-input"
                required
              />
            </div>

            <div>
              <label className="form-label">
                Confirm New Password
              </label>
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="form-input"
                required
              />
            </div>

            <button
              type="submit"
              disabled={pwdLoading}
              className="btn-primary"
              style={{ marginTop: '0.5rem' }}
            >
              <Lock size={15} />
              <span>{pwdLoading ? 'Updating Password...' : 'Update Password'}</span>
            </button>
          </form>
        </section>

        {/* Card: Paired Car Head Units */}
        <section className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }} aria-label="Paired devices">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <Smartphone size={18} color="var(--accent-cyan)" />
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Paired Car Head Units
              </h2>
            </div>
            <button
              type="button"
              onClick={fetchProfileAndDevices}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' }}
              title="Refresh Devices"
              aria-label="Refresh devices list"
            >
              <RefreshCw size={15} />
            </button>
          </div>

          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
            Devices authorized with cryptographic bearer tokens to upload driving telemetry.
          </p>

          {devicesLoading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Loading authorized devices...
            </div>
          ) : devices.length === 0 ? (
            <div style={{
              padding: '1.75rem 1rem',
              textAlign: 'center',
              background: 'var(--surface-inset)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.65rem'
            }}>
              <Radio size={24} color="var(--text-muted)" />
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
                No vehicle head units have been paired yet.
              </p>
              <Link href="/pair" className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}>
                Pair First Head Unit →
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {devices.map((dev) => (
                <div
                  key={dev.id}
                  style={{
                    padding: '0.85rem',
                    background: 'var(--surface-inset)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.45rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {dev.name || 'Head Unit'}
                      </strong>
                      <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', display: 'block' }}>
                        Vehicle: {dev.vehicleName || dev.vehicleId}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRevokeDevice(dev.id)}
                      className="btn-danger"
                      style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem' }}
                      title="Revoke Token"
                    >
                      <Trash2 size={13} />
                      <span>Revoke</span>
                    </button>
                  </div>

                  <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span>Token: <code>{dev.tokenMasked}</code></span>
                    <span>Last active: {dev.lastSeenAt ? new Date(dev.lastSeenAt).toLocaleString() : 'Never'}</span>
                    {dev.fingerprint?.btMac && <span>Adapter MAC: {dev.fingerprint.btMac}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

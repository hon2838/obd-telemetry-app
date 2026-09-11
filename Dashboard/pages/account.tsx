import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { apiFetch, applyAuthResponse } from '../api';
import { useAuth } from '../context/AuthContext';
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
    // AuthContext owns the shared /me request; this page only loads devices.
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

      const data = await res.json();
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
    <>
      <Head>
        <title>Account & Security | OBD Telemetry</title>
      </Head>

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '1.25rem 1rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Shield color="var(--accent-cyan)" size={28} />
              Account & Device Security
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
              Manage administrative credentials, security policy, and authorized car head units.
            </p>
          </div>

          <Link
            href="/pair"
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
              textDecoration: 'none',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
            }}
          >
            <Radio size={18} color="var(--accent-cyan)" />
            <span>Pair Car Head Unit (QR/PIN)</span>
          </Link>
        </div>

        {/* Security Status Banners */}
        {mustChangePassword && (
          <div className="glass-panel" style={{
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap'
          }}>
            <div style={{ padding: '0.5rem', background: 'rgba(245, 158, 11, 0.2)', borderRadius: '50%', color: 'var(--accent-amber)' }}>
              <AlertCircle size={24} />
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--accent-amber)', margin: 0 }}>
                Initial Default Password Active
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
                Your account is currently using the initial setup password (<code style={{ color: '#fff' }}>admin12345</code>). Please change it below to protect your vehicle telemetry and gateway control.
              </p>
            </div>
          </div>
        )}

        {/* Main Grid: Change Password & Devices */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
          {/* Card: Change Password */}
          <div className="glass-panel" style={{ padding: '1.75rem', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div style={{ padding: '0.5rem', background: 'rgba(94, 215, 208, 0.12)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-cyan)' }}>
                <KeyRound size={20} />
              </div>
              <div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Change Password
                </h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                  Update your account credentials
                </p>
              </div>
            </div>

            {pwdError && (
              <div style={{
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ff8080',
                fontSize: '0.85rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <AlertCircle size={16} />
                <span>{pwdError}</span>
              </div>
            )}

            {pwdSuccess && (
              <div style={{
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: 'var(--accent-green)',
                fontSize: '0.85rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <CheckCircle2 size={16} />
                <span>{pwdSuccess}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Current / Setup Password
                </label>
                <input
                  type="password"
                  placeholder="e.g. admin12345"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface-inset)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  New Password (min 8 characters)
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter new strong password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface-inset)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface-inset)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem',
                    outline: 'none',
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={pwdLoading || !newPassword}
                style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'linear-gradient(135deg, var(--accent-cyan), #3b82f6)',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  border: 'none',
                  cursor: 'pointer',
                  opacity: pwdLoading || !newPassword ? 0.6 : 1,
                  transition: 'opacity 0.2s',
                }}
              >
                {pwdLoading ? 'Updating Password...' : 'Save New Password'}
              </button>
            </form>
          </div>

          {/* Card: Paired Devices */}
          <div className="glass-panel" style={{ padding: '1.75rem', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ padding: '0.5rem', background: 'rgba(141, 156, 255, 0.12)', borderRadius: 'var(--radius-sm)', color: 'var(--accent-blue)' }}>
                  <Smartphone size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    Paired Car Head Units
                  </h2>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                    Authorized gateway devices syncing vehicle telemetry
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={fetchProfileAndDevices}
                style={{
                  background: 'var(--surface-inset)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  padding: '0.4rem',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer'
                }}
                title="Refresh paired devices"
              >
                <RefreshCw size={15} className={devicesLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {devices.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '2.5rem 1rem',
                border: '1px dashed var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-muted)',
                fontSize: '0.875rem'
              }}>
                <Radio size={32} style={{ margin: '0 auto 0.75rem auto', opacity: 0.4 }} />
                <p>No car head units paired yet.</p>
                <p style={{ fontSize: '0.775rem', marginTop: '0.25rem' }}>
                  Open the OBD App on your Android head unit and scan the pairing QR code.
                </p>
                <Link
                  href="/pair"
                  style={{
                    display: 'inline-block',
                    marginTop: '1rem',
                    padding: '0.5rem 1rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--surface-inset)',
                    border: '1px solid var(--border-glow)',
                    color: 'var(--accent-cyan)',
                    fontSize: '0.8rem',
                    textDecoration: 'none',
                    fontWeight: 600
                  }}
                >
                  Go to QR / PIN Pairing Page →
                </Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {devices.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      padding: '1rem',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--surface-inset)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '1rem'
                    }}
                  >
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                          {d.name || 'Car Head Unit'}
                        </span>
                        <span style={{
                          fontSize: '0.7rem',
                          padding: '0.15rem 0.45rem',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(94, 215, 208, 0.15)',
                          color: 'var(--accent-cyan)',
                          border: '1px solid rgba(94, 215, 208, 0.3)',
                          fontWeight: 500
                        }}>
                          {d.vehicleName} ({d.vehicleId})
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                        <span>Device ID: <code style={{ color: 'var(--accent-khaki)' }}>{d.id}</code></span>
                        <span>Token: <code style={{ color: 'var(--text-muted)' }}>{d.tokenMasked}</code></span>
                        <span>Last Active: {new Date(d.lastSeenAt).toLocaleString()}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRevokeDevice(d.id)}
                      style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: 'var(--accent-red)',
                        padding: '0.5rem',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      title="Revoke and unlink device"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

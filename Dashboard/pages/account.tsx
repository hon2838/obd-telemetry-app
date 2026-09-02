import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { API_HOST } from '../api';
import Navigation from '../components/Navigation';
import {
  Shield, KeyRound, Smartphone, Trash2, CheckCircle2, AlertCircle, RefreshCw, Radio, Lock, ArrowLeft
} from 'lucide-react';

interface PairedDevice {
  id: string;
  name: string;
  vehicleId: string;
  vehicleName: string;
  fingerprint: {
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
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);
  const [pwdError, setPwdError] = useState<string | null>(null);

  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);

  const fetchDevices = async () => {
    try {
      setDevicesLoading(true);
      const res = await fetch(`${API_HOST}/api/devices`);
      if (res.ok) {
        const data = await res.json();
        setDevices(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Error loading devices:', err);
    } finally {
      setDevicesLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

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
      const res = await fetch(`${API_HOST}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          username: 'admin',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update password');
      }

      setPwdSuccess('Password changed successfully! Default password is now deactivated.');
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
      const res = await fetch(`${API_HOST}/api/devices/${deviceId}`, {
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
    <div className="flex h-screen bg-slate-950 text-slate-100 antialiased font-sans overflow-hidden">
      <Head>
        <title>Account & Security — OBD Telemetry</title>
      </Head>

      <Navigation />

      <main className="flex-1 flex flex-col h-full overflow-y-auto">
        <header className="px-8 py-6 border-b border-slate-800/80 bg-slate-900/40 backdrop-blur-md flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Account & Device Security
              </h1>
              <p className="text-xs text-slate-400">Manage account password, paired cars, and access tokens</p>
            </div>
          </div>
          <Link
            href="/pair"
            className="flex items-center space-x-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20 transition duration-200"
          >
            <Radio className="w-4 h-4 animate-pulse" />
            <span>+ Pair New Car</span>
          </Link>
        </header>

        <div className="p-8 max-w-5xl space-y-8">
          {/* Password Change Card */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
            <div className="flex items-center space-x-3 mb-6">
              <KeyRound className="w-5 h-5 text-cyan-400" />
              <div>
                <h2 className="text-base font-semibold text-white">Change Account Password</h2>
                <p className="text-xs text-slate-400">Update from the initial setup password to your personal secure password</p>
              </div>
            </div>

            {pwdError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center space-x-3 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{pwdError}</span>
              </div>
            )}

            {pwdSuccess && (
              <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center space-x-3 text-emerald-400 text-xs">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{pwdSuccess}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Current Password (or initial setup password)
                </label>
                <input
                  type="password"
                  placeholder="e.g. admin12345"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-3 py-2 text-sm text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  New Password (min 8 characters)
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter new strong password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-3 py-2 text-sm text-slate-200 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Re-type new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-3 py-2 text-sm text-slate-200 outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={pwdLoading || !newPassword}
                className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold py-2.5 px-5 rounded-xl transition duration-200 disabled:opacity-50"
              >
                {pwdLoading ? 'Updating Password...' : 'Save New Password'}
              </button>
            </form>
          </div>

          {/* Paired Head Units & Devices Card */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <Smartphone className="w-5 h-5 text-blue-400" />
                <div>
                  <h2 className="text-base font-semibold text-white">Paired Car Head Units & Devices</h2>
                  <p className="text-xs text-slate-400">Authorized hardware running telemetry gateway</p>
                </div>
              </div>
              <button
                onClick={fetchDevices}
                className="p-2 text-slate-400 hover:text-white bg-slate-800/60 rounded-lg transition"
              >
                <RefreshCw className={`w-4 h-4 ${devicesLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {devices.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-slate-800 rounded-xl text-slate-500 text-sm">
                No car head units paired via QR code yet. Use the "+ Pair New Car" button above.
              </div>
            ) : (
              <div className="space-y-3">
                {devices.map((d) => (
                  <div
                    key={d.id}
                    className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-white">{d.name}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                          {d.vehicleName} ({d.vehicleId})
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1 flex gap-4">
                        <span>Device ID: <code className="font-mono text-slate-300">{d.id}</code></span>
                        <span>Token: <code className="font-mono text-slate-300">{d.tokenMasked}</code></span>
                        <span>Last Seen: {new Date(d.lastSeenAt).toLocaleString()}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRevokeDevice(d.id)}
                      className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition"
                      title="Revoke access"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

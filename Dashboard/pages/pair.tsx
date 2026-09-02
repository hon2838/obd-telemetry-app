import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { API_HOST } from '../api';
import { useVehicle } from '../context/VehicleContext';
import {
  Car, ShieldCheck, CheckCircle2, AlertCircle, QrCode, ArrowRight, Lock, KeyRound, Radio
} from 'lucide-react';

export default function PairVehiclePage() {
  const router = useRouter();
  const { vehicles, refreshVehicles } = useVehicle();

  const [pinCode, setPinCode] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('default');
  const [isNewVehicle, setIsNewVehicle] = useState(false);
  const [newVehicleName, setNewVehicleName] = useState('');
  const [newTankLitres, setNewTankLitres] = useState(40);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // User auth state
  const [apiKey, setApiKey] = useState('');

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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }

      const payload: any = {
        pairingCode: pinCode.trim(),
      };

      if (isNewVehicle && newVehicleName.trim()) {
        payload.newVehicleName = newVehicleName.trim();
        payload.tankLitres = Number(newTankLitres) || 40;
      } else {
        payload.vehicleId = selectedVehicleId;
      }

      const res = await fetch(`${API_HOST}/api/auth/device/claim`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to claim and pair vehicle device');
      }

      setSuccess(`Vehicle successfully paired and linked to "${data.vehicleName || 'Default Vehicle'}"! Your car's head unit is now connected.`);
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4">
      <Head>
        <title>Pair Car Device — OBD Telemetry</title>
      </Head>

      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400">
            <Radio className="w-7 h-7 animate-pulse" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Pair Car Device
            </h1>
            <p className="text-xs text-slate-400">Link your Android head unit to your garage profile</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center space-x-3 text-red-400 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center space-x-3 text-emerald-400 text-sm">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handlePair} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Pairing PIN Code
            </label>
            <div className="relative">
              <input
                type="text"
                required
                maxLength={10}
                placeholder="e.g. 842-195"
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 rounded-xl px-4 py-3 text-center text-xl font-mono tracking-widest text-cyan-300 uppercase placeholder-slate-600 outline-none transition"
              />
              <KeyRound className="w-5 h-5 text-slate-500 absolute left-3 top-3.5" />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Enter the 6-digit PIN displayed on your car's Android head unit.
            </p>
          </div>

          <div className="pt-2">
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Assign to Vehicle Profile
            </label>
            <div className="space-y-3">
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setIsNewVehicle(false)}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium border transition ${
                    !isNewVehicle
                      ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  Existing Vehicle
                </button>
                <button
                  type="button"
                  onClick={() => setIsNewVehicle(true)}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium border transition ${
                    isNewVehicle
                      ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  + Add New Car
                </button>
              </div>

              {!isNewVehicle ? (
                <select
                  value={selectedVehicleId}
                  onChange={(e) => setSelectedVehicleId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none"
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.id})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-3 p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Car Model / Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Perodua Axia SE 2024"
                      value={newVehicleName}
                      onChange={(e) => setNewVehicleName(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Fuel Tank Capacity (Litres)</label>
                    <input
                      type="number"
                      value={newTankLitres}
                      onChange={(e) => setNewTankLitres(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !pinCode.trim()}
            className="w-full mt-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium py-3 px-4 rounded-xl flex items-center justify-center space-x-2 shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition duration-200"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <ShieldCheck className="w-5 h-5" />
                <span>Authorize & Pair Head Unit</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

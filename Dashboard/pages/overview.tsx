import React, { useEffect, useState, useMemo, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  Activity, Route, Calendar, Fuel, Wrench, ChevronRight, Car
} from 'lucide-react';
import { apiFetch, isAbortError } from '../api';
import { useVehicle } from '../context/VehicleContext';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import PageHeader from '../components/PageHeader';
import DataFreshness from '../components/DataFreshness';
import MetricSummary from '../components/MetricSummary';
import EmptyState from '../components/EmptyState';

interface DriveSummary {
  id: string | number;
  vehicleId?: string;
  startTime: number;
  endTime: number;
  label?: string;
  summary: {
    durationMin: number;
    distanceKm: number | null;
    avgSpeed: number | null;
    fuelEfficiencyKmL: number | null;
    estimatedFuelUsedLitres?: number | null;
    estimatedFuelEconomyKmL?: number | null;
    quality?: {
      coverageRatio: number | null;
      fuelCoverageRatio: number | null;
      economyCoverageRatio: number | null;
    };
  };
}

interface LatestTelemetry {
  timestamp: number;
  receivedAt?: number | null;
  speed?: number | null;
  rpm?: number | null;
  coolantTemp?: number | null;
  voltage?: number | null;
  fuelLevel?: number | null;
}

interface MaintenanceStatus {
  okCount: number;
  dueSoonCount: number;
  overdueCount: number;
  nextUpcoming?: {
    name: string;
    kmRemaining: number | null;
    daysRemaining: number | null;
  } | null;
}

export function getTripEconomyDisplay(summary?: DriveSummary['summary'] | null): {
  value: string;
  unit?: string;
  label: string;
  isLegacy: boolean;
  numericValue: number | null;
} {
  if (!summary) {
    return { value: 'N/A', label: 'Estimate unavailable', isLegacy: false, numericValue: null };
  }

  // Modern estimate exists (number)
  if (typeof summary.estimatedFuelEconomyKmL === 'number' && Number.isFinite(summary.estimatedFuelEconomyKmL) && summary.estimatedFuelEconomyKmL >= 0) {
    const coverage = summary.quality?.fuelCoverageRatio;
    const covStr = typeof coverage === 'number' && Number.isFinite(coverage)
      ? `${Math.round(coverage * 100)}% fuel coverage`
      : 'Petrol estimate';
    return {
      value: summary.estimatedFuelEconomyKmL.toFixed(1),
      unit: 'km/L',
      label: covStr === 'Petrol estimate' ? covStr : `Petrol estimate · ${covStr}`,
      isLegacy: false,
      numericValue: summary.estimatedFuelEconomyKmL
    };
  }

  // Explicit null: modern estimation evaluated but data was missing or unavailable
  // DO NOT fall back to legacy tank drop!
  if (summary.estimatedFuelEconomyKmL !== undefined) {
    return { value: 'N/A', label: 'Estimate unavailable', isLegacy: false, numericValue: null };
  }

  // Legacy record (estimatedFuelEconomyKmL === undefined): fallback to tank-drop formula with unvalidated label
  if (typeof summary.fuelEfficiencyKmL === 'number' && Number.isFinite(summary.fuelEfficiencyKmL) && summary.fuelEfficiencyKmL >= 0) {
    return {
      value: summary.fuelEfficiencyKmL.toFixed(1),
      unit: 'km/L',
      label: 'Legacy tank-level estimate (unvalidated)',
      isLegacy: true,
      numericValue: summary.fuelEfficiencyKmL
    };
  }

  return { value: 'N/A', label: 'Estimate unavailable', isLegacy: false, numericValue: null };
}

export default function OverviewPage() {
  const { vehicles, activeVehicleId, activeVehicle, buildUrl, selectVehicle } = useVehicle();
  const [drives, setDrives] = useState<DriveSummary[]>([]);
  const [latest, setLatest] = useState<LatestTelemetry | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceStatus | null>(null);
  const [connectionOk, setConnectionOk] = useState(true);
  const [loading, setLoading] = useState(true);

  const activeVehicleIdRef = useRef(activeVehicleId);
  useEffect(() => {
    activeVehicleIdRef.current = activeVehicleId;
  }, [activeVehicleId]);

  // Reset scope state when vehicle context changes to prevent showing obsolete vehicle data
  useEffect(() => {
    setDrives([]);
    setLatest(null);
    setMaintenance(null);
    setLoading(true);
  }, [activeVehicleId]);

  const isFleetView = activeVehicleId === 'all';

  const fetchOverviewData = async (signal?: AbortSignal) => {
    const reqVehicle = activeVehicleId;
    const isFleet = reqVehicle === 'all';

    try {
      const drivesPromise = apiFetch(buildUrl('/api/drives'), { signal });
      const latestPromise = isFleet
        ? Promise.resolve(null)
        : apiFetch(buildUrl('/api/telemetry/latest'), { signal });
      const maintPromise = isFleet
        ? Promise.resolve(null)
        : apiFetch(buildUrl('/api/maintenance/status'), { signal });

      const [drivesRes, latestRes, maintRes] = await Promise.all([
        drivesPromise,
        latestPromise,
        maintPromise
      ]);

      if (signal?.aborted || reqVehicle !== activeVehicleIdRef.current) return;
      if (!drivesRes.ok) {
        throw new Error(`Drives HTTP ${drivesRes.status}`);
      }
      if (latestRes && !latestRes.ok) {
        throw new Error(`Telemetry latest HTTP ${latestRes.status}`);
      }

      const drivesData = await drivesRes.json();
      const latestData = latestRes ? await latestRes.json() : null;
      const maintData = maintRes && maintRes.ok ? await maintRes.json() : null;

      if (signal?.aborted || reqVehicle !== activeVehicleIdRef.current) return;
      setDrives(Array.isArray(drivesData) ? drivesData : []);
      setLatest(latestData);
      setMaintenance(maintData);
      setConnectionOk(true);
    } catch (err) {
      if (!signal?.aborted && reqVehicle === activeVehicleIdRef.current && !isAbortError(err)) {
        setConnectionOk(false);
        throw err;
      }
    } finally {
      if (!signal?.aborted && reqVehicle === activeVehicleIdRef.current) {
        setLoading(false);
      }
    }
  };

  useVisibilityPolling(fetchOverviewData, 15000, [activeVehicleId, buildUrl]);

  // Derive today's statistics
  const todayStats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayTs = startOfToday.getTime();

    const todayDrives = drives.filter(d => d.startTime >= todayTs);
    let totalKm = 0;
    let hasValidDistance = false;

    for (const d of todayDrives) {
      if (typeof d.summary?.distanceKm === 'number' && Number.isFinite(d.summary.distanceKm)) {
        totalKm += d.summary.distanceKm;
        hasValidDistance = true;
      }
    }

    let todayDistanceDisplay: string;
    if (todayDrives.length === 0) {
      todayDistanceDisplay = loading ? '—' : connectionOk ? '0.0' : '—';
    } else if (hasValidDistance) {
      todayDistanceDisplay = totalKm.toFixed(1);
    } else {
      // Missing distance with trips present must stay N/A, not 0.0
      todayDistanceDisplay = 'N/A';
    }

    const lastTrip = drives.length > 0 ? drives[0] : null;
    const lastTripEco = getTripEconomyDisplay(lastTrip?.summary);

    return {
      todayCount: todayDrives.length,
      todayDistanceDisplay,
      lastTripEco
    };
  }, [drives, loading, connectionOk]);

  const recentDrives = useMemo(() => drives.slice(0, 5), [drives]);
  const currentVehicleName = activeVehicle?.name || (vehicles.length > 0 ? vehicles[0].name : 'Vehicle');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Head>
        <title>{`${isFleetView ? 'Fleet Overview' : `${currentVehicleName} Overview`} | OBD Telemetry`}</title>
        <meta name="description" content="Vehicle activity overview, trip history, and recorded snapshot." />
      </Head>

      <PageHeader
        title={isFleetView ? 'Fleet Overview' : `${currentVehicleName} Overview`}
        subtitle={
          isFleetView
            ? 'Aggregated trip records across all registered vehicles. Select a specific vehicle to view its live telemetry readings.'
            : 'Operational snapshot, recorded distance today, and recent journey summaries.'
        }
      />

      {/* Freshness Status Banner (Only for single vehicle - fleet does not present one car as fleet state) */}
      {!isFleetView && (
        <DataFreshness
          connectionOk={connectionOk}
          timestamp={latest?.timestamp ?? null}
          receivedAt={latest?.receivedAt}
          vehicleName={currentVehicleName}
        />
      )}

      {/* Period Summaries (Clearly marked recorded/estimated coverage; no fake scores) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
        gap: '0.85rem'
      }}>
        <MetricSummary
          label="Recorded distance today"
          value={todayStats.todayDistanceDisplay}
          unit={todayStats.todayDistanceDisplay !== 'N/A' && todayStats.todayDistanceDisplay !== '—' ? 'km' : undefined}
          icon={<Route size={16} />}
          subtext="Across uploaded trip intervals"
        />

        <MetricSummary
          label="Trips recorded today"
          value={loading ? '—' : todayStats.todayCount}
          icon={<Calendar size={16} />}
          subtext="View trips for detailed route"
        />

        <MetricSummary
          label="Last trip economy"
          value={todayStats.lastTripEco.value}
          unit={todayStats.lastTripEco.unit}
          icon={<Fuel size={16} />}
          subtext={todayStats.lastTripEco.label}
        />

        {/* Real maintenance reminders only - no invented green Nominal/active DTC metrics */}
        {!isFleetView && maintenance && (maintenance.okCount + maintenance.dueSoonCount + maintenance.overdueCount > 0) && (
        <MetricSummary
          label="Maintenance reminders"
          value={
            maintenance?.overdueCount && maintenance.overdueCount > 0
              ? `${maintenance.overdueCount} Overdue`
              : maintenance?.dueSoonCount && maintenance.dueSoonCount > 0
              ? `${maintenance.dueSoonCount} Due soon`
              : maintenance?.nextUpcoming
              ? 'Upcoming'
              : 'Up to date'
          }
          icon={<Wrench size={16} color={
            maintenance?.overdueCount && maintenance.overdueCount > 0
              ? 'var(--accent-red)'
              : maintenance?.dueSoonCount && maintenance.dueSoonCount > 0
              ? 'var(--accent-amber)'
              : 'var(--accent-cyan)'
          } />}
          valueColor={
            maintenance?.overdueCount && maintenance.overdueCount > 0
              ? 'var(--accent-red)'
              : maintenance?.dueSoonCount && maintenance.dueSoonCount > 0
              ? 'var(--accent-amber)'
              : undefined
          }
          subtext={
            maintenance?.nextUpcoming
              ? `Next: ${maintenance.nextUpcoming.name}${
                  typeof maintenance.nextUpcoming.kmRemaining === 'number'
                    ? ` (${maintenance.nextUpcoming.kmRemaining.toLocaleString()} km)`
                    : typeof maintenance.nextUpcoming.daysRemaining === 'number'
                    ? ` (${maintenance.nextUpcoming.daysRemaining} days)`
                    : ''
                }`
              : maintenance?.okCount && maintenance.okCount > 0
              ? `${maintenance.okCount} schedules tracked`
              : 'No maintenance schedules configured'
          }
        />
        )}
      </div>

      {/* Main Panels Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
        gap: '1rem'
      }}>
        {/* Recent Journeys Panel */}
        <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }} aria-label="Recent journeys">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Recent Journeys
            </h2>
            <Link href="/trips" className="btn-secondary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}>
              All trips →
            </Link>
          </div>

          {recentDrives.length === 0 ? (
            <EmptyState
              icon={<Route size={28} />}
              title="No journeys recorded yet"
              description="When you drive with OBD recording active, uploaded trips will appear here with route and fuel estimates."
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.5rem 0.35rem', fontWeight: 500 }}>Journey</th>
                    <th style={{ padding: '0.5rem 0.35rem', fontWeight: 500 }}>Distance</th>
                    <th style={{ padding: '0.5rem 0.35rem', fontWeight: 500 }}>Duration</th>
                    <th style={{ padding: '0.5rem 0.35rem', fontWeight: 500 }}>Est. km/L</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDrives.map((d) => {
                    const timeStr = new Date(d.startTime).toLocaleDateString([], {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    });
                    const dist = typeof d.summary?.distanceKm === 'number' && Number.isFinite(d.summary.distanceKm)
                      ? `${d.summary.distanceKm.toFixed(1)} km`
                      : '—';
                    const dur = typeof d.summary?.durationMin === 'number' && Number.isFinite(d.summary.durationMin)
                      ? `${Math.round(d.summary.durationMin)} min`
                      : '—';
                    const eco = getTripEconomyDisplay(d.summary);

                    return (
                      <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.65rem 0.35rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                          <Link href="/trips" style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}>
                            {timeStr}
                          </Link>
                        </td>
                        <td style={{ padding: '0.65rem 0.35rem', fontVariantNumeric: 'tabular-nums' }}>{dist}</td>
                        <td style={{ padding: '0.65rem 0.35rem', fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>{dur}</td>
                        <td style={{ padding: '0.65rem 0.35rem', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                          <div>{eco.value}{eco.unit ? ` ${eco.unit}` : ''}</div>
                          {eco.isLegacy && (
                            <div style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>
                              unvalidated
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
            Trip summaries exclude offline gaps and reflect uploaded session intervals only.
          </p>
        </section>

        {/* Right Panel: Vehicle Fleet Choices (if fleet) OR Last Recorded Readings (if single vehicle) */}
        {isFleetView ? (
          <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }} aria-label="Vehicle fleet choices">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Fleet Vehicles ({vehicles.length})
              </h2>
              <Link href="/garage" className="btn-secondary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}>
                Garage & Fleet →
              </Link>
            </div>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              Live telemetry is vehicle-specific. Select a vehicle to inspect its latest signals and freshness:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))', gap: '0.65rem' }}>
              {vehicles.map(v => (
                <div
                  key={v.id}
                  onClick={() => selectVehicle(v.id)}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--surface-inset)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <Car size={15} color="var(--accent-cyan)" />
                    <strong style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{v.name}</strong>
                  </div>
                  <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                    {v.tankLitres ? `${v.tankLitres}L Tank` : 'Standard Tank'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }} aria-label="Latest recorded readings">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Last Recorded Readings
              </h2>
              <Link href="/" className="btn-secondary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}>
                Explore signals →
              </Link>
            </div>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              {latest?.timestamp
                ? `Snapshot from ${new Date(latest.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                : 'Awaiting initial telemetry readings'}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.55rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Speed</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                  {typeof latest?.speed === 'number' ? `${Math.round(latest.speed)} km/h` : 'N/A'}
                </strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.55rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Engine Speed</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                  {typeof latest?.rpm === 'number' ? `${Math.round(latest.rpm).toLocaleString()} RPM` : 'N/A'}
                </strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.55rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Coolant Temperature</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                  {typeof latest?.coolantTemp === 'number' ? `${Math.round(latest.coolantTemp)}°C` : 'N/A'}
                </strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.55rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Battery Voltage</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                  {typeof latest?.voltage === 'number' ? `${latest.voltage.toFixed(1)} V` : 'N/A'}
                </strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.55rem 0', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Fuel Level</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                  {typeof latest?.fuelLevel === 'number' ? `${Math.round(latest.fuelLevel)}%` : 'Unavailable'}
                </strong>
              </div>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '0.5rem' }}>
              <Link href="/" style={{ color: 'var(--accent-cyan)', textDecoration: 'none', fontSize: '0.825rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span>Live telemetry workspace</span>
                <ChevronRight size={14} />
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

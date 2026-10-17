import React, { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { apiFetch, isAbortError } from '../api';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { useVehicle } from '../context/VehicleContext';
import TripRouteMap from '../components/TripRouteMap';
import type { GpsPoint } from '../components/TripRouteMap';
import Pagination from '../components/Pagination';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Dialog from '../components/Dialog';
import {
  Navigation, Gauge, Clock, Fuel, TrendingUp, Trophy, Calendar, X, Search, Route
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, Brush
} from 'recharts';

export interface DriveSession {
  id: string | number;
  vehicleId?: string;
  startTime: number;
  endTime: number;
  label: string;
  summary: {
    durationMin: number;
    maxRpm: number;
    maxSpeed: number;
    fuelUsedPercent: number;
    pointCount: number;
    distanceKm: number | null;
    avgSpeed: number | null;
    startLocation: { lat: number; lon: number } | null;
    endLocation: { lat: number; lon: number } | null;
    fuelEfficiencyKmL: number | null;
    estimatedFuelUsedLitres?: number | null;
    estimatedFuelEconomyKmL?: number | null;
    estimatedIdleFuelLitres?: number | null;
    idleSeconds?: number | null;
    distanceSource?: string;
    quality?: {
      coverageRatio: number | null;
      fuelCoverageRatio: number | null;
      economyCoverageRatio: number | null;
      distanceCoverageRatio: number | null;
      idleStateCoverageRatio: number | null;
      idleFuelCoverageRatio: number | null;
      gapCount: number;
      maxIntervalSeconds: number;
      efficiencyLeaderboardEligible: boolean;
    };
    driverScore?: number;
    harshEvents?: { accel: number; brake: number };
  };
}

interface LeaderboardData {
  best_efficiency: DriveSession[];
  longest_distance: DriveSession[];
  highest_speed: DriveSession[];
  longest_duration: DriveSession[];
}

export const MAX_DETAIL_CHART_POINTS = 750;
const MAX_DETAIL_MAP_POINTS = 2000;

export function decimateChartPoints<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  const result = [points[0]];
  const interiorCount = maxPoints - 2;
  const interiorLength = points.length - 2;
  for (let i = 0; i < interiorCount; i++) {
    const index = 1 + Math.floor((i * interiorLength) / interiorCount);
    result.push(points[index]);
  }
  result.push(points[points.length - 1]);
  return result;
}

export function formatTripMetric(value: number | null | undefined, digits = 2, unit = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}` : 'N/A';
}

const coverageLabel = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'N/A';

const distanceLabel = (source?: string) => ({
  gps: 'Recorded GPS',
  'obd-speed': 'OBD speed estimate',
  'gps-with-obd-speed-fallback': 'GPS + OBD speed estimate',
  unavailable: 'No covered distance'
}[source || ''] || 'Legacy GPS distance');

const economyValue = (summary: DriveSession['summary']) =>
  summary.estimatedFuelEconomyKmL === undefined ? summary.fuelEfficiencyKmL : summary.estimatedFuelEconomyKmL;

const economyLabel = (summary: DriveSession['summary']) =>
  summary.estimatedFuelEconomyKmL === undefined ? 'Legacy tank-level estimate' : 'Petrol estimate';

export default function TripsDashboard() {
  const { activeVehicleId, buildUrl } = useVehicle();
  const [drives, setDrives] = useState<DriveSession[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData>({
    best_efficiency: [],
    longest_distance: [],
    highest_speed: [],
    longest_duration: []
  });
  const [activeLeaderboardTab, setActiveLeaderboardTab] = useState<'efficiency' | 'distance' | 'speed' | 'duration'>('distance');
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [selectedDrive, setSelectedDrive] = useState<DriveSession | null>(null);
  const [selectedDrivePoints, setSelectedDrivePoints] = useState<any[]>([]);
  const [selectedDriveRoutePoints, setSelectedDriveRoutePoints] = useState<GpsPoint[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [detailSection, setDetailSection] = useState<'summary' | 'route' | 'signals'>('summary');
  const driveAbortRef = useRef<AbortController | null>(null);

  // Restore vehicle-change abort, close old detail, clear detail samples, reset page, and clear trip/leaderboard
  useEffect(() => {
    driveAbortRef.current?.abort();
    setSelectedDrive(null);
    setSelectedDrivePoints([]);
    setSelectedDriveRoutePoints([]);
    setDetailLoading(false);
    setDetailError(false);
    setLoaded(false);
    setPage(1);
    setDrives([]);
    setLeaderboard({ best_efficiency: [], longest_distance: [], highest_speed: [], longest_duration: [] });
  }, [activeVehicleId]);

  // Restore unmount abort
  useEffect(() => {
    return () => {
      driveAbortRef.current?.abort();
    };
  }, []);

  const handleDriveClick = async (drive: DriveSession) => {
    driveAbortRef.current?.abort();
    const controller = new AbortController();
    driveAbortRef.current = controller;

    setSelectedDrive(drive);
    setSelectedDrivePoints([]);
    setSelectedDriveRoutePoints([]);
    setDetailLoading(true);
    setDetailError(false);
    setDetailSection('summary');

    try {
      let res = await apiFetch(buildUrl('/api/telemetry/series', {
        start: drive.startTime,
        end: drive.endTime,
        points: MAX_DETAIL_CHART_POINTS,
        vehicle: drive.vehicleId
      }), { signal: controller.signal });

      if (res.status === 404 || res.status === 501) {
        res = await apiFetch(buildUrl('/api/telemetry/history', {
          start: drive.startTime,
          end: drive.endTime,
          vehicle: drive.vehicleId
        }), { signal: controller.signal });
      }

      if (!res.ok) throw new Error(`Trip telemetry HTTP ${res.status}`);
      const data = await res.json();
      if (controller.signal.aborted) return;

      const records: any[] = Array.isArray(data) ? data : (Array.isArray(data?.records) ? data.records : []);
      const rawPoints = [...records].sort((left, right) => Number(left.timestamp) - Number(right.timestamp));
      const transformed = rawPoints.map((d: any) => ({
        time: new Date(d.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        speed: typeof d.speed === 'number' && Number.isFinite(d.speed) ? d.speed : typeof d.gpsSpeed === 'number' && Number.isFinite(d.gpsSpeed) && typeof d.latitude === 'number' && Math.abs(d.latitude) <= 90 && typeof d.longitude === 'number' && Math.abs(d.longitude) <= 180 && !(d.latitude === 0 && d.longitude === 0) ? d.gpsSpeed : null,
        rpm: typeof d.rpm === 'number' && Number.isFinite(d.rpm) ? d.rpm : null
      }));
      setSelectedDrivePoints(decimateChartPoints(transformed, MAX_DETAIL_CHART_POINTS));
      setSelectedDriveRoutePoints(decimateChartPoints(rawPoints, MAX_DETAIL_MAP_POINTS).map((point: any) => ({
        latitude: point.latitude,
        longitude: point.longitude
      })));
    } catch (err) {
      if (!isAbortError(err)) {
        console.error('Failed to load trip telemetry details:', err);
        setDetailError(true);
      }
    } finally {
      if (!controller.signal.aborted) {
        setDetailLoading(false);
      }
    }
  };

  // Preserve error propagation and backoff
  const fetchTripsData = async (signal?: AbortSignal) => {
    const [drivesRes, lbRes] = await Promise.all([
      apiFetch(buildUrl('/api/drives'), { signal }),
      apiFetch(buildUrl('/api/trips/leaderboard'), { signal })
    ]);

    if (!drivesRes.ok) throw new Error(`Drives HTTP ${drivesRes.status}`);
    if (!lbRes.ok) throw new Error(`Leaderboard HTTP ${lbRes.status}`);

    const [drivesData, lbData] = await Promise.all([drivesRes.json(), lbRes.json()]);
    if (signal?.aborted) return;
    setDrives(Array.isArray(drivesData) ? drivesData : []);
    setLeaderboard(lbData || { best_efficiency: [], longest_distance: [], highest_speed: [], longest_duration: [] });
    setLoaded(true);
  };

  // Original 10s poll interval
  useVisibilityPolling(fetchTripsData, 10000, [activeVehicleId, buildUrl]);

  // Filter drives by search and accessible date range
  const filteredDrives = useMemo(() => {
    let result = drives;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(d => {
        const idMatch = String(d.id).includes(q);
        const labelMatch = (d.label || '').toLowerCase().includes(q);
        const dateStr = new Date(d.startTime).toLocaleDateString().toLowerCase();
        const distStr = String(d.summary?.distanceKm || '');
        return idMatch || labelMatch || dateStr.includes(q) || distStr.includes(q);
      });
    }
    if (startDate) {
      const startMs = new Date(`${startDate}T00:00:00`).getTime();
      result = result.filter(d => d.startTime >= startMs);
    }
    if (endDate) {
      const endMs = new Date(`${endDate}T23:59:59.999`).getTime();
      result = result.filter(d => d.startTime <= endMs);
    }
    return result;
  }, [drives, searchQuery, startDate, endDate]);

  // Prevent filters from leaving pagination on an empty obsolete page
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredDrives.length / pageSize));
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [filteredDrives.length, page, pageSize]);

  // Paginated drives
  const paginatedDrives = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredDrives.slice(start, start + pageSize);
  }, [filteredDrives, page, pageSize]);

  // Server-qualified leaderboard and valid zero distance preservation
  const totalTrips = drives.length;
  const distances = drives.map(d => d.summary.distanceKm).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const totalDistance = distances.length > 0 ? distances.reduce((acc, value) => acc + value, 0) : null;
  const efficiencies = leaderboard.best_efficiency.map(d => d.summary.estimatedFuelEconomyKmL).filter((e): e is number => typeof e === 'number' && e > 0);
  const bestEfficiency = efficiencies.length > 0 ? Math.max(...efficiencies) : 0;
  const longestTrip = distances.length > 0 ? Math.max(...distances) : null;

  // Trend chart data (chronological) - NO legacy fallback when modern estimate is explicitly null
  const chartData = useMemo(() => {
    return [...drives]
      .sort((a, b) => a.startTime - b.startTime)
      .slice(-15)
      .map(d => {
        let efficiency: number | null = null;
        if (d.summary.estimatedFuelEconomyKmL !== undefined) {
          efficiency = typeof d.summary.estimatedFuelEconomyKmL === 'number' && Number.isFinite(d.summary.estimatedFuelEconomyKmL)
            ? d.summary.estimatedFuelEconomyKmL
            : null;
        } else if (typeof d.summary?.fuelEfficiencyKmL === 'number' && Number.isFinite(d.summary.fuelEfficiencyKmL)) {
          efficiency = d.summary.fuelEfficiencyKmL;
        }

        return {
          date: new Date(d.startTime).toLocaleDateString([], { month: 'short', day: 'numeric' }),
          distance: typeof d.summary?.distanceKm === 'number' && Number.isFinite(d.summary.distanceKm) ? d.summary.distanceKm : null,
          efficiency
        };
      });
  }, [drives]);

  const getLeaderboardList = (): DriveSession[] => {
    switch (activeLeaderboardTab) {
      case 'efficiency': return leaderboard.best_efficiency || [];
      case 'distance': return leaderboard.longest_distance || [];
      case 'speed': return leaderboard.highest_speed || [];
      case 'duration': return leaderboard.longest_duration || [];
      default: return [];
    }
  };

  const getLeaderboardValue = (drive: DriveSession): string => {
    switch (activeLeaderboardTab) {
      case 'efficiency':
        return formatTripMetric(economyValue(drive.summary), 2, 'km/L');
      case 'distance':
        return formatTripMetric(drive.summary.distanceKm, 2, 'km');
      case 'speed':
        return `${drive.summary.maxSpeed ? drive.summary.maxSpeed.toFixed(1) : '0'} km/h`;
      case 'duration':
        return `${drive.summary.durationMin}m`;
      default:
        return '';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <Head>
        <title>Trips & Journeys | OBD Telemetry</title>
        <meta name="description" content="Recorded trip intervals, fuel estimates, and journey route explorer." />
      </Head>

      <PageHeader
        title="Trips & Journeys"
        subtitle="Recorded drive intervals, distance coverage, fuel estimates, and route tracking."
      />

      {/* Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
        gap: '0.85rem'
      }}>
        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Total Trips</span>
            <Calendar size={16} color="var(--accent-cyan)" />
          </div>
          <div className="metric-summary-value">{loaded ? totalTrips : '—'}</div>
          <div className="metric-summary-subtext">Segmented drive sessions</div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Total Distance</span>
            <Navigation size={16} color="var(--accent-cyan)" />
          </div>
          <div className="metric-summary-value">{loaded ? formatTripMetric(totalDistance, 2, 'km') : '—'}</div>
          <div className="metric-summary-subtext">Across covered intervals; gaps excluded</div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Best Estimated Trip Economy</span>
            <Fuel size={16} color="var(--accent-green)" />
          </div>
          <div className="metric-summary-value">
            {loaded ? <>{bestEfficiency > 0 ? bestEfficiency.toFixed(2) : 'N/A'} {bestEfficiency > 0 && <small className="metric-summary-unit">km/L</small>}</> : '—'}
          </div>
          <div className="metric-summary-subtext">Server-qualified efficiency leaderboard</div>
        </div>

        <div className="glass-panel-static metric-summary-card">
          <div className="metric-summary-header">
            <span className="metric-summary-label">Longest Trip</span>
            <TrendingUp size={16} color="var(--accent-purple)" />
          </div>
          <div className="metric-summary-value">{loaded ? formatTripMetric(longestTrip, 2, 'km') : '—'}</div>
          <div className="metric-summary-subtext">Single longest recorded journey</div>
        </div>
      </div>

      {/* Main Grid: History Table & Leaderboard */}
      <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }} aria-label="Trip history">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Clock size={18} color="var(--accent-cyan)" />
            <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Journey History
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              ({filteredDrives.length} {filteredDrives.length === 1 ? 'trip' : 'trips'})
            </span>
          </div>

          {/* Search & Date Range Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: 'min(100%, 220px)' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search trip ID, date, distance..."
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                className="form-input"
                style={{ paddingLeft: '30px', fontSize: '0.8rem' }}
                aria-label="Search trip history"
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <label htmlFor="trip-start-date" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                From:
              </label>
              <input
                id="trip-start-date"
                type="date"
                value={startDate}
                onChange={e => { setStartDate(e.target.value); setPage(1); }}
                className="form-input"
                style={{ width: 'auto', padding: '0.35rem 0.5rem', fontSize: '0.775rem' }}
                aria-label="Filter trips by start date"
              />
              <label htmlFor="trip-end-date" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                To:
              </label>
              <input
                id="trip-end-date"
                type="date"
                value={endDate}
                onChange={e => { setEndDate(e.target.value); setPage(1); }}
                className="form-input"
                style={{ width: 'auto', padding: '0.35rem 0.5rem', fontSize: '0.775rem' }}
                aria-label="Filter trips by end date"
              />
              {(startDate || endDate) && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.725rem' }}
                  onClick={() => { setStartDate(''); setEndDate(''); setPage(1); }}
                >
                  Clear dates
                </button>
              )}
            </div>
          </div>
        </div>

        {drives.length === 0 ? (
          <EmptyState
            icon={<Route size={32} />}
            title="No trip sessions recorded yet"
            description="When your vehicle completes drives with telemetry logging active, segmented journeys will appear here."
          />
        ) : filteredDrives.length === 0 ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No trips matching {searchQuery ? `"${searchQuery}"` : 'the selected date range'}.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 500 }}>Trip ID</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 500 }}>Date & Time</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 500 }}>Duration</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 500 }}>Distance</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 500 }}>Est. Fuel</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 500 }}>Est. Economy</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 500 }}>Coverage</th>
                  <th style={{ padding: '0.65rem 0.5rem', fontWeight: 500, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedDrives.map(drive => {
                  const startStr = new Date(drive.startTime).toLocaleDateString([], {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  });
                  return (
                    <tr
                      key={drive.id}
                      onClick={() => handleDriveClick(drive)}
                      style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '0.75rem 0.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        <strong>Drive #{drive.id}</strong>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>
                        {startStr}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontVariantNumeric: 'tabular-nums' }}>
                        {drive.summary.durationMin} mins
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontVariantNumeric: 'tabular-nums' }}>
                        <div>{formatTripMetric(drive.summary.distanceKm, 2, 'km')}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {distanceLabel(drive.summary.distanceSource)}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontVariantNumeric: 'tabular-nums' }}>
                        {formatTripMetric(drive.summary.estimatedFuelUsedLitres, 3, 'L')}
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        <div>{formatTripMetric(economyValue(drive.summary), 2, 'km/L')}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {economyLabel(drive.summary)}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', fontSize: '0.75rem' }}>
                        <div>Fuel {coverageLabel(drive.summary.quality?.fuelCoverageRatio)}</div>
                        <div style={{ color: 'var(--text-muted)' }}>
                          Economy {coverageLabel(drive.summary.quality?.economyCoverageRatio)}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                          aria-label={`View details for drive #${drive.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDriveClick(drive);
                          }}
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination Controls */}
            <div style={{ marginTop: '0.85rem' }}>
              <Pagination
                currentPage={page}
                totalItems={filteredDrives.length}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                itemLabel="trips"
              />
            </div>
          </div>
        )}
      </section>

      {/* Visual Analytics & Leaderboard Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
        gap: '1rem'
      }}>
        {/* Trend Chart */}
        <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }} aria-label="Trip distance and economy trend">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingUp size={18} color="var(--accent-cyan)" />
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Recent Trip Trends (Distance & Economy)
            </h2>
          </div>

          {chartData.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No recorded trips to plot yet.
            </div>
          ) : (
            <div style={{ height: '240px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorDist" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#48c5b3" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#48c5b3" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorEff" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} />
                  <YAxis yAxisId="left" stroke="var(--text-muted)" fontSize={11} unit=" km" />
                  <YAxis yAxisId="right" orientation="right" stroke="var(--text-muted)" fontSize={11} unit=" km/L" />
                  <Tooltip contentStyle={{ background: '#171f28', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Area yAxisId="left" type="monotone" dataKey="distance" name="Distance (km)" stroke="#48c5b3" fillOpacity={1} fill="url(#colorDist)" />
                  <Area yAxisId="right" type="monotone" dataKey="efficiency" name="Estimated economy (km/L)" connectNulls={false} stroke="#34d399" fillOpacity={1} fill="url(#colorEff)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Leaderboard */}
        <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }} aria-label="Trip leaderboard">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Trophy size={18} color="var(--accent-amber)" />
              <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                Trip Leaderboard
              </h2>
            </div>
            <div style={{ display: 'flex', gap: '3px', background: 'var(--surface-inset)', padding: '2px', borderRadius: 'var(--radius-sm)' }}>
              <button
                type="button"
                className={`nav-link ${activeLeaderboardTab === 'distance' ? 'active' : ''}`}
                onClick={() => setActiveLeaderboardTab('distance')}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              >
                Distance
              </button>
              <button
                type="button"
                className={`nav-link ${activeLeaderboardTab === 'efficiency' ? 'active' : ''}`}
                onClick={() => setActiveLeaderboardTab('efficiency')}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              >
                Economy
              </button>
              <button
                type="button"
                className={`nav-link ${activeLeaderboardTab === 'speed' ? 'active' : ''}`}
                onClick={() => setActiveLeaderboardTab('speed')}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              >
                Speed
              </button>
              <button
                type="button"
                className={`nav-link ${activeLeaderboardTab === 'duration' ? 'active' : ''}`}
                onClick={() => setActiveLeaderboardTab('duration')}
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              >
                Duration
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {getLeaderboardList().length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No qualified drives found for this metric.
              </div>
            ) : (
              getLeaderboardList().slice(0, 5).map((drive, idx) => {
                const medals = ['🥇', '🥈', '🥉', '4th', '5th'];
                const dateStr = new Date(drive.startTime).toLocaleDateString([], {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                });
                return (
                  <div
                    key={drive.id}
                    onClick={() => handleDriveClick(drive)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.5rem 0.65rem',
                      background: 'var(--surface-inset)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <span style={{ fontSize: idx < 3 ? '1.1rem' : '0.8rem', width: '22px', textAlign: 'center' }}>
                        {medals[idx]}
                      </span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.825rem', color: 'var(--text-primary)' }}>
                          Drive #{drive.id}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {dateStr}
                        </div>
                      </div>
                    </div>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--accent-amber)', fontVariantNumeric: 'tabular-nums' }}>
                      {getLeaderboardValue(drive)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Accessible Drive Details Modal (using shared Dialog) */}
      <Dialog
        isOpen={selectedDrive !== null}
        onClose={() => {
          driveAbortRef.current?.abort();
          setSelectedDrive(null);
        }}
        title={selectedDrive ? `Trip Details - Drive #${selectedDrive.id}` : ''}
        description={selectedDrive ? new Date(selectedDrive.startTime).toLocaleString() : undefined}
        maxWidth="820px"
      >
        {selectedDrive && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Modal Detail Sections Tab Navigation */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', background: 'var(--surface-inset)', padding: '3px', borderRadius: 'var(--radius-sm)' }}>
              <button
                type="button"
                className={`nav-link ${detailSection === 'summary' ? 'active' : ''}`}
                aria-pressed={detailSection === 'summary'}
                onClick={() => setDetailSection('summary')}
                style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
              >
                Summary & Estimates
              </button>
              <button
                type="button"
                className={`nav-link ${detailSection === 'route' ? 'active' : ''}`}
                aria-pressed={detailSection === 'route'}
                onClick={() => setDetailSection('route')}
                style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
              >
                Route Map
              </button>
              <button
                type="button"
                className={`nav-link ${detailSection === 'signals' ? 'active' : ''}`}
                aria-pressed={detailSection === 'signals'}
                onClick={() => setDetailSection('signals')}
                style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
              >
                Speed & RPM Profile
              </button>
            </div>

            {/* Metrics Content (Retains all exact strings required by tests) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px 36px', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
              <div>
                <strong style={{ color: 'var(--text-secondary)' }}>Duration:</strong> {selectedDrive.summary.durationMin} mins<br/>
                <strong style={{ color: 'var(--text-secondary)' }}>Distance:</strong> {formatTripMetric(selectedDrive.summary.distanceKm, 2, 'km')} ({distanceLabel(selectedDrive.summary.distanceSource)})<br/>
                <strong style={{ color: 'var(--text-secondary)' }}>Safety Score:</strong> {selectedDrive.summary.driverScore ?? 'N/A'}/100
              </div>
              <div>
                <strong style={{ color: 'var(--text-secondary)' }}>Avg Speed:</strong> {formatTripMetric(selectedDrive.summary.avgSpeed, 2, 'km/h')}<br/>
                <strong style={{ color: 'var(--text-secondary)' }}>Max Speed:</strong> {typeof selectedDrive.summary?.maxSpeed === 'number' ? `${selectedDrive.summary.maxSpeed.toFixed(2)} km/h` : 'N/A'}<br/>
                <strong style={{ color: 'var(--text-secondary)' }}>Estimated Fuel Used:</strong> {formatTripMetric(selectedDrive.summary.estimatedFuelUsedLitres, 3, 'L')}<br/>
                <strong style={{ color: 'var(--text-secondary)' }}>Estimated Economy:</strong> {formatTripMetric(economyValue(selectedDrive.summary), 2, 'km/L')} ({economyLabel(selectedDrive.summary)})<br/>
                <strong style={{ color: 'var(--text-secondary)' }}>Recorded Idling:</strong> {formatTripMetric(selectedDrive.summary.idleSeconds, 0, 'seconds')}<br/>
                <strong style={{ color: 'var(--text-secondary)' }}>Estimated Idle Fuel:</strong> {formatTripMetric(selectedDrive.summary.estimatedIdleFuelLitres, 3, 'L')}
              </div>
              <div>
                <strong style={{ color: 'var(--text-secondary)' }}>Data Coverage:</strong><br/>
                Fuel {coverageLabel(selectedDrive.summary.quality?.fuelCoverageRatio)} · Economy {coverageLabel(selectedDrive.summary.quality?.economyCoverageRatio)}<br/>
                Distance {coverageLabel(selectedDrive.summary.quality?.distanceCoverageRatio)} · Idle state {coverageLabel(selectedDrive.summary.quality?.idleStateCoverageRatio)}<br/>
                Idle fuel {coverageLabel(selectedDrive.summary.quality?.idleFuelCoverageRatio)} · Long gaps {selectedDrive.summary.quality?.gapCount ?? 'N/A'}<br/>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                  Legacy tank estimate: {formatTripMetric(selectedDrive.summary.fuelEfficiencyKmL, 2, 'km/L')} · {formatTripMetric(selectedDrive.summary.fuelUsedPercent, 1, '%')} level drop (unvalidated)
                </span>
              </div>
            </div>

            <p style={{ fontSize: '0.775rem', color: 'var(--text-muted)', lineHeight: 1.45, margin: 0 }}>
              Petrol fuel use is estimated from recorded airflow. Totals cover usable recorded periods and exclude long gaps. Economy compares distance and fuel from the same recorded periods. Idling counts while the engine runs and the car is nearly stationary. Missing data stays unavailable.
            </p>

            {/* Route Map Section */}
            <div style={{ display: detailSection === 'route' || detailSection === 'summary' ? 'block' : 'none' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Trip Route</h3>
              {detailLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading trip route...</div>
              ) : (
                <TripRouteMap
                  points={selectedDriveRoutePoints}
                  startLocation={selectedDrive.summary.startLocation}
                  endLocation={selectedDrive.summary.endLocation}
                />
              )}
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
                Route follows recorded GPS samples and may be approximate on long trips.
              </p>
            </div>

            {/* Keep the profile mounted so switching detail sections retains its selected time window. */}
            <div style={{ display: detailSection === 'signals' || detailSection === 'summary' ? 'block' : 'none' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Speed & RPM Profile</h3>
              {detailLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading telemetry points...</div>
              ) : detailError ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--accent-red)', fontSize: '0.85rem' }}>Trip telemetry could not be loaded.</div>
              ) : selectedDrivePoints.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No telemetry points available for this trip.</div>
              ) : (
                <div style={{ height: '280px', width: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={selectedDrivePoints}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={11} minTickGap={30} />
                      <YAxis yAxisId="left" stroke="#48c5b3" fontSize={11} unit=" km/h" />
                      <YAxis yAxisId="right" orientation="right" stroke="#b395f5" fontSize={11} />
                      <Tooltip contentStyle={{ background: '#171f28', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }} />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Brush dataKey="time" height={24} stroke="#48c5b3" fill="rgba(0,0,0,0.2)" />
                      <Line yAxisId="left" type="monotone" dataKey="speed" name="Speed (km/h)" connectNulls={false} stroke="#48c5b3" dot={false} strokeWidth={2} isAnimationActive={false} />
                      <Line yAxisId="right" type="monotone" dataKey="rpm" name="RPM" connectNulls={false} stroke="#b395f5" dot={false} strokeWidth={2} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

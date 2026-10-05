import React, { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { apiFetch, isAbortError } from '../api';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { useVehicle } from '../context/VehicleContext';
import TripRouteMap from '../components/TripRouteMap';
import type { GpsPoint } from '../components/TripRouteMap';
import {
  Navigation, Gauge, Clock, ArrowLeft, Fuel, TrendingUp, Trophy, Calendar, Zap, X, Car
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, LineChart, Line, Brush
} from 'recharts';

interface DriveSession {
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

// Keep the first and last samples, then select evenly spaced samples from the
// interior. This bounds Recharts' SVG work while preserving the full trip
// time range and its overall shape for long sessions.
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

const coverageLabel = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'N/A';
const distanceLabel = (source?: string) => ({
  gps: 'Recorded GPS', 'obd-speed': 'OBD speed estimate',
  'gps-with-obd-speed-fallback': 'GPS + OBD speed estimate', unavailable: 'No covered distance'
}[source || ''] || 'Legacy GPS distance');
const economyValue = (summary: DriveSession['summary']) => summary.estimatedFuelEconomyKmL === undefined ? summary.fuelEfficiencyKmL : summary.estimatedFuelEconomyKmL;
const economyLabel = (summary: DriveSession['summary']) => summary.estimatedFuelEconomyKmL === undefined ? 'Legacy tank-level estimate' : 'Petrol estimate';

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
  const [selectedDrive, setSelectedDrive] = useState<DriveSession | null>(null);
  const [selectedDrivePoints, setSelectedDrivePoints] = useState<any[]>([]);
  const [selectedDriveRoutePoints, setSelectedDriveRoutePoints] = useState<GpsPoint[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const driveAbortRef = useRef<AbortController | null>(null);

  const handleDriveClick = async (drive: DriveSession) => {
    driveAbortRef.current?.abort();
    const controller = new AbortController();
    driveAbortRef.current = controller;

    setSelectedDrive(drive);
    setSelectedDrivePoints([]);
    setSelectedDriveRoutePoints([]);
    setDetailLoading(true);
    setDetailError(false);
    try {
      // First try /api/telemetry/series with points=750 so downsampling happens before transfer and transformation
      let res = await apiFetch(buildUrl('/api/telemetry/series', {
        start: drive.startTime,
        end: drive.endTime,
        points: MAX_DETAIL_CHART_POINTS,
        vehicle: drive.vehicleId
      }), { signal: controller.signal });

      if (res.status === 404 || res.status === 501) {
        // Safe fallback for an older server lacking /api/telemetry/series
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
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  };

  const fetchData = async (signal: AbortSignal) => {
    const [drivesRes, lbRes] = await Promise.all([
      apiFetch(buildUrl('/api/drives'), { signal }),
      apiFetch(buildUrl('/api/trips/leaderboard'), { signal }),
    ]);
    if (!drivesRes.ok) throw new Error(`Drives HTTP ${drivesRes.status}`);
    if (!lbRes.ok) throw new Error(`Leaderboard HTTP ${lbRes.status}`);
    const [drivesData, lbData] = await Promise.all([drivesRes.json(), lbRes.json()]);
    setDrives(Array.isArray(drivesData) ? drivesData : []);
    setLeaderboard(lbData || { best_efficiency: [], longest_distance: [], highest_speed: [], longest_duration: [] });
    setLoaded(true);
  };

  useEffect(() => {
    driveAbortRef.current?.abort();
    setSelectedDrive(null);
    setSelectedDrivePoints([]);
    setSelectedDriveRoutePoints([]);
    setDetailLoading(false);
    setDetailError(false);
  }, [activeVehicleId]);

  useEffect(() => {
    return () => {
      driveAbortRef.current?.abort();
    };
  }, []);

  useVisibilityPolling(fetchData, 10000, [activeVehicleId, buildUrl]);

  // Compute overall stats
  const totalTrips = drives.length;
  const distances = drives.map(d => d.summary.distanceKm).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const totalDistance = distances.length > 0 ? distances.reduce((acc, value) => acc + value, 0) : null;
  const efficiencies = leaderboard.best_efficiency.map(d => d.summary.estimatedFuelEconomyKmL).filter((e): e is number => typeof e === 'number' && e > 0);
  const bestEfficiency = efficiencies.length > 0 ? Math.max(...efficiencies) : 0;
  const longestTrip = distances.length > 0 ? Math.max(...distances) : null;

  // Chart data sorted chronologically
  const chartData = useMemo(() => [...drives]
    .reverse()
    .map(d => ({
      date: new Date(d.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      distance: d.summary.distanceKm,
      efficiency: d.summary.estimatedFuelEconomyKmL ?? null,
      id: d.id
    })), [drives]);

  const getLeaderboardList = () => {
    switch (activeLeaderboardTab) {
      case 'efficiency': return leaderboard.best_efficiency;
      case 'distance': return leaderboard.longest_distance;
      case 'speed': return leaderboard.highest_speed;
      case 'duration': return leaderboard.longest_duration;
    }
  };

  const getLeaderboardValue = (d: DriveSession) => {
    switch (activeLeaderboardTab) {
      case 'efficiency': return formatTripMetric(d.summary.estimatedFuelEconomyKmL, 2, 'km/L');
      case 'distance': return formatTripMetric(d.summary.distanceKm, 2, 'km');
      case 'speed': return `${d.summary.maxSpeed.toFixed(2)} km/h`;
      case 'duration': return `${d.summary.durationMin} mins`;
    }
  };

  return (
    <div style={styles.container}>
      <Head>
        <title>Axia OS | Trips & Drives</title>
      </Head>

      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div>
            <h1 style={styles.title}>Trips & Drives Log</h1>
            <p style={styles.subtitle}>Recorded trip intervals, estimated fuel use and data coverage</p>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={styles.statsRow}>
        <div className="glass-panel-static" style={styles.statsCard}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Total Trips</span>
            <Calendar size={20} style={{ color: 'var(--accent-blue)' }} />
          </div>
          <span style={styles.statsCardValue}>{loaded ? totalTrips : '—'}</span>
          <span style={styles.statsCardSubtext}>Segmented drive sessions</span>
        </div>

        <div className="glass-panel-static" style={styles.statsCard}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Total Distance</span>
            <Navigation size={20} style={{ color: 'var(--accent-cyan)' }} />
          </div>
          <span style={styles.statsCardValue}>{loaded ? formatTripMetric(totalDistance, 2, 'km') : '—'}</span>
          <span style={styles.statsCardSubtext}>Across covered intervals; gaps are excluded</span>
        </div>

        <div className="glass-panel-static" style={styles.statsCard}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Best Estimated Trip Economy</span>
            <Fuel size={20} style={{ color: 'var(--accent-green)' }} />
          </div>
          <span style={styles.statsCardValue}>{loaded ? <>{bestEfficiency > 0 ? bestEfficiency.toFixed(2) : 'N/A'} <span style={{ fontSize: '16px' }}>km/L</span></> : '—'}</span>
          <span style={styles.statsCardSubtext}>Petrol estimates with ≥80% coverage and ≥1 km</span>
        </div>

        <div className="glass-panel-static" style={styles.statsCard}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Longest Trip</span>
            <TrendingUp size={20} style={{ color: 'var(--accent-purple)' }} />
          </div>
          <span style={styles.statsCardValue}>{loaded ? formatTripMetric(longestTrip, 2, 'km') : '—'}</span>
          <span style={styles.statsCardSubtext}>Single longest drive session</span>
        </div>
      </div>

      {/* Main Grid */}
      <div style={styles.grid}>
        
        {/* Left Column: Leaderboard */}
        <div className="glass-panel-static" style={{ ...styles.card, display: 'flex', flexDirection: 'column' }}>
          <div style={styles.cardHeader}>
            <Trophy size={20} style={{ color: 'var(--accent-amber)' }} />
            <h2 style={styles.cardTitle}>Trip Leaderboard</h2>
          </div>
          
          {/* Leaderboard Tabs */}
          <div style={styles.lbTabs}>
            <button 
              onClick={() => setActiveLeaderboardTab('efficiency')}
              style={{ ...styles.lbTab, ...(activeLeaderboardTab === 'efficiency' ? styles.lbTabActive : {}) }}
            >
              Estimated Economy
            </button>
            <button 
              onClick={() => setActiveLeaderboardTab('distance')}
              style={{ ...styles.lbTab, ...(activeLeaderboardTab === 'distance' ? styles.lbTabActive : {}) }}
            >
              Distance
            </button>
            <button 
              onClick={() => setActiveLeaderboardTab('speed')}
              style={{ ...styles.lbTab, ...(activeLeaderboardTab === 'speed' ? styles.lbTabActive : {}) }}
            >
              Top Speed
            </button>
            <button 
              onClick={() => setActiveLeaderboardTab('duration')}
              style={{ ...styles.lbTab, ...(activeLeaderboardTab === 'duration' ? styles.lbTabActive : {}) }}
            >
              Duration
            </button>
          </div>

          {/* Leaderboard Entries */}
          <div style={styles.lbList}>
            {getLeaderboardList().length === 0 ? (
              <div style={styles.noData}>No drives with valid metrics found</div>
            ) : (
              getLeaderboardList().map((drive, index) => {
                const medals = ['🥇', '🥈', '🥉', '4th', '5th'];
                const startStr = new Date(drive.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={drive.id} style={styles.lbItem}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: index < 3 ? '20px' : '13px', fontWeight: 700, width: '28px', textAlign: 'center' }}>
                        {medals[index]}
                      </span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
                          Drive #{drive.id}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {startStr}
                        </div>
                      </div>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--accent-amber)' }}>
                      {getLeaderboardValue(drive)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Distance & Economy Trends */}
        <div className="glass-panel-static" style={styles.card}>
          <div style={styles.cardHeader}>
            <TrendingUp size={20} style={{ color: 'var(--accent-blue)' }} />
            <h2 style={styles.cardTitle}>Trip History Trend</h2>
          </div>
          {chartData.length === 0 ? (
            <div style={styles.noData}>Log telemetry data to view trip trends</div>
          ) : (
            <div style={{ height: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorDist" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0.0}/>
                    </linearGradient>
                    <linearGradient id="colorEff" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-green)" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="var(--accent-green)" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} />
                  <YAxis yAxisId="left" stroke="var(--accent-blue)" fontSize={11} unit=" km" />
                  <YAxis yAxisId="right" orientation="right" stroke="var(--accent-green)" fontSize={11} unit=" km/L" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'rgba(20,20,25,0.9)', borderRadius: '8px', border: '1px solid var(--border)' }}
                    labelStyle={{ color: 'var(--text-primary)', fontWeight: 700 }}
                  />
                  <Legend />
                  <Area yAxisId="left" type="monotone" dataKey="distance" name="Distance (km)" stroke="var(--accent-blue)" fillOpacity={1} fill="url(#colorDist)" />
                  <Area yAxisId="right" type="monotone" dataKey="efficiency" name="Estimated economy (km/L)" connectNulls={false} stroke="var(--accent-green)" fillOpacity={1} fill="url(#colorEff)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* History table */}
      <div className="glass-panel-static" style={{ ...styles.card, marginTop: '32px' }}>
        <div style={styles.cardHeader}>
          <Clock size={20} style={{ color: 'var(--accent-cyan)' }} />
          <h2 style={styles.cardTitle}>Complete Trip History</h2>
        </div>
        
        {drives.length === 0 ? (
          <div style={styles.noData}>No trip sessions recorded yet</div>
        ) : (
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.trHead}>
                  <th style={styles.th}>Trip ID</th>
                  <th style={styles.th}>Date & Time</th>
                  <th style={styles.th}>Duration</th>
                  <th style={styles.th}>Distance</th>
                  <th style={styles.th}>Avg Speed</th>
                  <th style={styles.th}>Max Speed</th>
                  <th style={styles.th}>Estimated Fuel Used</th>
                  <th style={styles.th}>Estimated Economy</th>
                  <th style={styles.th}>Data Coverage</th>
                  <th style={styles.th}>Safety Score</th>
                </tr>
              </thead>
              <tbody>
                {drives.map(drive => {
                  const startStr = new Date(drive.startTime).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  });
                  return (
                    <tr 
                      key={drive.id} 
                      style={{ ...styles.trRow, cursor: 'pointer' }} 
                      onClick={() => handleDriveClick(drive)}
                    >
                      <td style={styles.td}><strong>Drive #{drive.id}</strong></td>
                      <td style={styles.td}>{startStr}</td>
                      <td style={styles.td}>{drive.summary.durationMin} mins</td>
                      <td style={styles.td}>{formatTripMetric(drive.summary.distanceKm, 2, 'km')}<div style={styles.metricNote}>{distanceLabel(drive.summary.distanceSource)}</div></td>
                       <td style={styles.td}>{formatTripMetric(drive.summary.avgSpeed, 2, 'km/h')}</td>
                       <td style={styles.td}>{drive.summary.maxSpeed.toFixed(2)} km/h</td>
                       <td style={styles.td}>
                         {formatTripMetric(drive.summary.estimatedFuelUsedLitres, 3, 'L')}
                         <div style={styles.metricNote}>Covered intervals only · petrol estimate</div>
                       </td>
                      <td style={styles.td}>
                        <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>{formatTripMetric(economyValue(drive.summary), 2, 'km/L')}</span>
                        <div style={styles.metricNote}>{economyLabel(drive.summary)}</div>
                      </td>
                      <td style={styles.td}>
                        Fuel {coverageLabel(drive.summary.quality?.fuelCoverageRatio)}<br/>
                        Economy {coverageLabel(drive.summary.quality?.economyCoverageRatio)}<br/>
                        Distance {coverageLabel(drive.summary.quality?.distanceCoverageRatio)}
                      </td>
                      <td style={styles.td}>
                        {drive.summary.driverScore !== undefined ? (
                          <span style={{ 
                            color: drive.summary.driverScore >= 90 ? 'var(--accent-green)' : (drive.summary.driverScore >= 70 ? 'var(--accent-amber)' : '#ef4444'),
                            fontWeight: 700 
                          }}>
                            {drive.summary.driverScore}/100
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              ({drive.summary.harshEvents?.brake || 0} brake, {drive.summary.harshEvents?.accel || 0} accel)
                            </div>
                          </span>
                        ) : 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drive Details Modal */}
      {selectedDrive && (
        <div className="modal-overlay">
          <div className="glass-panel-static" style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Trip Details - Drive #{selectedDrive.id}</h2>
              <button style={styles.closeButton} onClick={() => {
                driveAbortRef.current?.abort();
                setSelectedDrive(null);
              }}>
                <X size={24} />
              </button>
            </div>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 48px', marginBottom: '24px', color: 'var(--text-primary)' }}>
              <div>
                <strong style={{color: 'var(--text-secondary)'}}>Duration:</strong> {selectedDrive.summary.durationMin} mins<br/>
                <strong style={{color: 'var(--text-secondary)'}}>Distance:</strong> {formatTripMetric(selectedDrive.summary.distanceKm, 2, 'km')} ({distanceLabel(selectedDrive.summary.distanceSource)})<br/>
                <strong style={{color: 'var(--text-secondary)'}}>Safety Score:</strong> {selectedDrive.summary.driverScore}/100
              </div>
              <div>
                <strong style={{color: 'var(--text-secondary)'}}>Avg Speed:</strong> {formatTripMetric(selectedDrive.summary.avgSpeed, 2, 'km/h')}<br/>
                <strong style={{color: 'var(--text-secondary)'}}>Max Speed:</strong> {selectedDrive.summary.maxSpeed.toFixed(2)} km/h<br/>
                <strong style={{color: 'var(--text-secondary)'}}>Estimated Fuel Used:</strong> {formatTripMetric(selectedDrive.summary.estimatedFuelUsedLitres, 3, 'L')}<br/>
                <strong style={{color: 'var(--text-secondary)'}}>Estimated Economy:</strong> {formatTripMetric(economyValue(selectedDrive.summary), 2, 'km/L')} ({economyLabel(selectedDrive.summary)})<br/>
                <strong style={{color: 'var(--text-secondary)'}}>Recorded Idling:</strong> {formatTripMetric(selectedDrive.summary.idleSeconds, 0, 'seconds')}<br/>
                <strong style={{color: 'var(--text-secondary)'}}>Estimated Idle Fuel:</strong> {formatTripMetric(selectedDrive.summary.estimatedIdleFuelLitres, 3, 'L')}
              </div>
              <div>
                <strong style={{color: 'var(--text-secondary)'}}>Data Coverage:</strong><br/>
                Fuel {coverageLabel(selectedDrive.summary.quality?.fuelCoverageRatio)} · Economy {coverageLabel(selectedDrive.summary.quality?.economyCoverageRatio)}<br/>
                Distance {coverageLabel(selectedDrive.summary.quality?.distanceCoverageRatio)} · Idle state {coverageLabel(selectedDrive.summary.quality?.idleStateCoverageRatio)}<br/>
                Idle fuel {coverageLabel(selectedDrive.summary.quality?.idleFuelCoverageRatio)} · Long gaps {selectedDrive.summary.quality?.gapCount ?? 'N/A'}<br/>
                <span style={styles.metricNote}>Legacy tank estimate: {formatTripMetric(selectedDrive.summary.fuelEfficiencyKmL, 2, 'km/L')} · {formatTripMetric(selectedDrive.summary.fuelUsedPercent, 1, '%')} level drop (unvalidated)</span>
              </div>
            </div>

            <p style={styles.metricNote}>
              Petrol fuel use is estimated from recorded airflow. Totals cover usable recorded periods and exclude long gaps. Economy compares distance and fuel from the same recorded periods. Idling counts while the engine runs and the car is nearly stationary. Missing data stays unavailable.
            </p>
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>Trip Route</h3>
            {detailLoading ? (
              <div style={styles.noData}>Loading trip route...</div>
            ) : (
              <TripRouteMap
                points={selectedDriveRoutePoints}
                startLocation={selectedDrive.summary.startLocation}
                endLocation={selectedDrive.summary.endLocation}
              />
            )}
            <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: '8px 0 24px' }}>
              Route follows recorded GPS samples and may be approximate on long trips.
            </p>

            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>Speed & RPM Profile</h3>
            {detailLoading ? (
              <div style={styles.noData}>Loading telemetry points...</div>
            ) : detailError ? (
              <div style={styles.noData}>Trip telemetry could not be loaded.</div>
            ) : selectedDrivePoints.length === 0 ? (
              <div style={styles.noData}>No telemetry points available for this trip.</div>
            ) : (
              <div style={{ height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={selectedDrivePoints}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={11} minTickGap={30} />
                    <YAxis yAxisId="left" stroke="var(--accent-blue)" fontSize={11} unit=" km/h" />
                    <YAxis yAxisId="right" orientation="right" stroke="var(--accent-purple)" fontSize={11} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'rgba(20,20,25,0.9)', borderRadius: '8px', border: '1px solid var(--border)' }}
                    />
                    <Legend />
                    <Brush dataKey="time" height={30} stroke="var(--accent-blue)" fill="rgba(0,0,0,0.2)" />
                    <Line yAxisId="left" type="monotone" dataKey="speed" name="Speed (km/h)" connectNulls={false} stroke="var(--accent-blue)" dot={false} strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="rpm" name="RPM" connectNulls={false} stroke="var(--accent-purple)" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  metricNote: { fontSize: '12px', lineHeight: 1.5, color: 'var(--text-muted)', marginTop: '4px' },
  container: {
    padding: '32px',
    maxWidth: '1400px',
    margin: '0 auto',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  header: {
    marginBottom: '8px'
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  title: {
    fontSize: '24px',
    fontWeight: 800,
    color: 'var(--text-primary)'
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--text-secondary)'
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
    gap: '20px'
  },
  statsCard: {
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  statsCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  statsCardTitle: {
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  statsCardValue: {
    fontSize: '36px',
    fontWeight: 800,
    color: 'var(--text-primary)',
    lineHeight: '1'
  },
  statsCardSubtext: {
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))',
    gap: '32px',
    marginTop: '16px'
  },
  card: {
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--text-primary)'
  },
  noData: {
    padding: '40px 0',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '14px'
  },
  lbTabs: {
    display: 'flex',
    gap: '8px',
    borderBottom: '1px solid var(--border)',
    paddingBottom: '12px'
  },
  lbTab: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  lbTabActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    color: 'var(--accent-amber)',
    border: '1px solid rgba(245, 158, 11, 0.3)'
  },
  lbList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    flex: 1,
    overflowY: 'auto',
    maxHeight: '300px'
  },
  lbItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.02)'
  },
  tableContainer: {
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px'
  },
  trHead: {
    borderBottom: '1px solid var(--border)'
  },
  th: {
    textAlign: 'left',
    padding: '12px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  trRow: {
    borderBottom: '1px solid rgba(255,255,255,0.02)',
    transition: 'background-color 0.2s'
  },
  td: {
    padding: '12px',
    color: 'var(--text-primary)'
  },
  modalContent: {
    width: '90%',
    maxWidth: '900px',
    padding: '32px',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '90vh',
    overflowY: 'auto'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px'
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: 800,
    color: 'var(--text-primary)'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: 'var(--text-primary)',
    cursor: 'pointer'
  }
};

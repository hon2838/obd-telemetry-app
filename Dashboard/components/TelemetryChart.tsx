import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, Brush
} from 'recharts';
import { Activity, Map as MapIcon, Thermometer, Battery, Flame, Fuel, Navigation, AlertCircle, Clock, Car, Gauge, Wind } from 'lucide-react';
import { apiFetch, isAbortError } from '../api';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { useVehicle } from '../context/VehicleContext';

// A record older than this means the vehicle is not currently reporting
const STALE_THRESHOLD_MS = 90 * 1000;

const formatAge = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ago`;
};

interface TelemetryData {
  timestamp: number;
  rpm: number;
  speed: number | null;
  coolantTemp: number;
  latitude: number;
  longitude: number;
  altitude: number;
  gpsSpeed: number;
  engineLoad: number;
  throttlePos: number;
  fuelLevel: number;
  ambientTemp: number;
  voltage: number;
  accelTime: number | null;
  alertCoolant: boolean;
  alertVoltage: boolean;
  // Optional instantaneous fuel-estimate fields (petrol MAF model).
  // Absent on older payloads; never derived from mismatched samples.
  mafGps?: number | null;
  fuelSystemStatus?: number | null;
  estimatedFuelRateLph?: number | null;
  estimatedFuelEconomyKmL?: number | null;
  iat?: number | null;
  map?: number | null;
  timeLabel?: string;
}

// Instantaneous petrol fuel-economy estimate in km/L, from the same sample.
// Returns null for missing/non-finite/negative values; legitimate zero
// (e.g. idle) is preserved. No L/100km or L/h derivation here.
export function formatFuelEconomyKmL(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value.toFixed(1);
}

const FuelEconomyCard = ({ value, rate, timestamp, connectionOk }: {
  value: unknown; rate: unknown; timestamp: number | null; connectionOk: boolean;
}) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);
  // Cloud telemetry normally syncs once per minute. Apply the dashboard's
  // reporting timeout, rather than retaining an old figure indefinitely.
  const age = timestamp === null ? null : now - timestamp;
  const fresh = connectionOk && age !== null && age >= 0 && age <= STALE_THRESHOLD_MS;
  const formatted = fresh ? formatFuelEconomyKmL(value) : null;
  const formattedRate = fresh ? formatFuelEconomyKmL(rate) : null;
  const state = !connectionOk ? 'Disconnected' : age !== null && age > STALE_THRESHOLD_MS ? 'Reading too old'
    : !fresh ? 'Awaiting fresh reading'
    : formatted === null || formattedRate === null ? 'Estimate unavailable or incomplete' : 'Latest synced reading';
  return <MetricCard
    title="Estimated fuel economy"
    value={formatted ?? 'N/A'}
    unit={formatted !== null ? 'km/L' : ''}
    icon={<Fuel size={20} color={formatted !== null ? 'var(--accent-green)' : 'var(--text-muted)'} />}
    progress={undefined}
    progressColor={formatted !== null ? 'var(--accent-green)' : 'var(--border)'}
    subtext={<><div data-testid="fuel-rate">Estimated fuel rate: {formattedRate !== null ? `${formattedRate} L/h` : 'N/A'}</div><div>Petrol estimate · {state}</div></>}
  />;
};

interface MapProps {
  latitude: number;
  longitude: number;
  routeData: TelemetryData[];
}

const FreshnessBadge = ({ connectionOk, timestamp }: { connectionOk: boolean; timestamp: number | null }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);
  const age = timestamp === null ? null : now - timestamp;
  const stale = age === null || age > STALE_THRESHOLD_MS;
  const label = !connectionOk ? 'SERVER OFFLINE' : stale ? (age === null ? 'AWAITING DATA' : `LAST SEEN ${formatAge(age).toUpperCase()}`) : 'LIVE';
  return <div className="glass-panel-static" style={styles.liveIndicatorWrapper}>
    <span className="live-indicator" style={connectionOk && !stale ? undefined : { animation: 'none', backgroundColor: !connectionOk ? 'var(--accent-red)' : 'var(--accent-amber)' }} />
    <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.05em', color: !connectionOk ? 'var(--accent-red)' : stale ? 'var(--accent-amber)' : 'var(--accent-green)' }}>{label}</span>
  </div>;
};

const StaleDataNotice = ({ connectionOk, timestamp }: { connectionOk: boolean; timestamp: number | null }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);
  if (!connectionOk) return null;
  const age = timestamp === null ? null : now - timestamp;
  if (age !== null && age <= STALE_THRESHOLD_MS) return null;
  return <div style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.5)', color: '#fbbf24', padding: '12px 18px', borderRadius: '12px', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', width: '100%' }}>
    <Clock size={18} />
    <span>Vehicle offline — engine off or head unit not reporting.{timestamp !== null && ` Last known data from ${new Date(timestamp).toLocaleString()}.`}</span>
  </div>;
};

const DynamicLeafletMap = ({ latitude, longitude, routeData }: MapProps) => {
  const routeCoords = React.useMemo(() => routeData.filter(p => p.latitude !== 0 && p.longitude !== 0).map(p => [p.latitude, p.longitude]), [routeData]);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // 1. Inject Leaflet CSS
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    // 2. Inject Leaflet JS
    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.onload = () => setLoaded(true);
      document.body.appendChild(script);
    } else {
      if ((window as any).L) {
        setLoaded(true);
      } else {
        const script = document.getElementById('leaflet-js');
        if (script) {
          const oldOnload = script.onload;
          script.onload = (ev) => {
            if (oldOnload) (oldOnload as any)(ev);
            setLoaded(true);
          };
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!loaded || latitude === 0 || longitude === 0) return;
    const L = (window as any).L;
    if (!L) return;

    if (!mapInstanceRef.current) {
      // Initialize map once
      mapInstanceRef.current = L.map('leaflet-map-div', {
        zoomControl: true,
        attributionControl: false
      }).setView([latitude, longitude], 15);

      // Dark theme tiles (ESRI World Dark Gray Base + Reference Labels)
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        maxNativeZoom: 16,
        attribution: 'Tiles &copy; Esri'
      }).addTo(mapInstanceRef.current);

      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        maxNativeZoom: 16
      }).addTo(mapInstanceRef.current);

      // Marker
      markerRef.current = L.marker([latitude, longitude]).addTo(mapInstanceRef.current);

      // Polyline route history
      polylineRef.current = L.polyline(routeCoords, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.8
      }).addTo(mapInstanceRef.current);

      if (routeCoords.length > 1) {
        mapInstanceRef.current.fitBounds(polylineRef.current.getBounds(), { padding: [30, 30] });
      }
    } else {
      // Update existing map layers dynamically (prevents reloading/flashing)
      const map = mapInstanceRef.current;
      const marker = markerRef.current;
      const polyline = polylineRef.current;

      if (marker) {
        marker.setLatLng([latitude, longitude]);
      }

      if (polyline) {
        polyline.setLatLngs(routeCoords);
      }

      map.panTo([latitude, longitude]);
    }
  }, [loaded, latitude, longitude, routeCoords]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div id="leaflet-map-div" style={{ width: '100%', height: '100%', borderRadius: '12px', minHeight: '450px', background: '#121214' }}>
      {!loaded && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
          Loading Map Layers...
        </div>
      )}
    </div>
  );
};
export default function TelemetryDashboard() {
  const { activeVehicleId, activeVehicle, buildUrl } = useVehicle();
  const [data, setData] = useState<TelemetryData[]>([]);
  const [activeTab, setActiveTab] = useState<'engine' | 'temperatures' | 'fuel_load'>('engine');
  const [connectionOk, setConnectionOk] = useState(true);

  const recordsRef = useRef<globalThis.Map<string, TelemetryData>>(new globalThis.Map());
  const cursorRef = useRef(0);
  const changesSupportedRef = useRef<boolean | null>(null);
  const generationRef = useRef(0);
  const initializedRef = useRef(false);
  const latestTimestampRef = useRef<number | null>(null);

  const withTimeLabel = useCallback((item: TelemetryData): TelemetryData => ({
    ...item,
    timeLabel: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }), []);

  // Bounded per-poll catch-up: at most CHANGE_PAGES_PER_POLL pages of
  // CHANGE_PAGE_LIMIT records per poll. A large backlog converges across
  // successive polls via the persisted cursor instead of accumulating up
  // to 500k rows in one poll; the cursor only advances past pages the
  // server actually returned, so late records are never skipped.
  const CHANGE_PAGE_LIMIT = 500;
  const CHANGE_PAGES_PER_POLL = 4;

  const recordKey = useCallback((record: TelemetryData & { eventId?: string | number; ingestSeq?: number; vehicleId?: string }) => {
    const vehicle = record.vehicleId || activeVehicleId || 'all';
    if (record.eventId !== undefined && record.eventId !== null) return `${vehicle}:event:${record.eventId}`;
    if (record.ingestSeq !== undefined && record.ingestSeq !== null) return `${vehicle}:seq:${record.ingestSeq}`;
    return `${vehicle}:legacy:${record.timestamp}:${record.rpm}:${record.speed}:${record.latitude}:${record.longitude}`;
  }, [activeVehicleId]);

  const mergeRecords = useCallback((records: TelemetryData[], generation: number) => {
    if (generation !== generationRef.current) return;
    for (const record of records) recordsRef.current.set(recordKey(record as TelemetryData & { eventId?: string | number; ingestSeq?: number; vehicleId?: string }), withTimeLabel(record));
    for (const record of records) {
      if (latestTimestampRef.current === null || record.timestamp > latestTimestampRef.current) {
        latestTimestampRef.current = record.timestamp;
      }
    }
    const bounded = [...recordsRef.current.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-2000);
    recordsRef.current = new globalThis.Map(bounded.map(record => [recordKey(record as TelemetryData & { eventId?: string | number; ingestSeq?: number; vehicleId?: string }), record]));
    setData(bounded);
  }, [recordKey, withTimeLabel]);

  const fetchChanges = useCallback(async (cursor: number, generation: number, signal: AbortSignal) => {
    const records: TelemetryData[] = [];
    let nextCursor = cursor;
    let hasMore = true;
    let pages = 0;
    while (hasMore && pages++ < CHANGE_PAGES_PER_POLL) {
      const response = await apiFetch(buildUrl('/api/telemetry/changes', { cursor: nextCursor, limit: CHANGE_PAGE_LIMIT }), { signal });
      if (response.status === 404 || response.status === 501) {
        changesSupportedRef.current = false;
        return null;
      }
      if (!response.ok) throw new Error(`Telemetry changes HTTP ${response.status}`);
      changesSupportedRef.current = true;
      const result = await response.json() as { records?: TelemetryData[]; nextCursor?: number; hasMore?: boolean };
      records.push(...(Array.isArray(result.records) ? result.records : []));
      const returnedCursor = typeof result.nextCursor === 'number' ? result.nextCursor : nextCursor;
      hasMore = !!result.hasMore && returnedCursor > nextCursor;
      nextCursor = returnedCursor;
    }
    if (generation === generationRef.current) cursorRef.current = nextCursor;
    return { records, hasMore };
  }, [buildUrl]);

  useEffect(() => {
    const generation = ++generationRef.current;
    recordsRef.current = new globalThis.Map();
    cursorRef.current = 0;
    changesSupportedRef.current = null;
    initializedRef.current = false;
    latestTimestampRef.current = null;
    setData([]);
    setConnectionOk(true);
  }, [activeVehicleId]);

  const pollTelemetry = useCallback(async (signal: AbortSignal) => {
    const generation = generationRef.current;
    try {
      if (!initializedRef.current) {
        // Bootstrap: fetch snapshot once from supported server.
        // Server contract: GET /api/telemetry/snapshot?vehicle=...&limit=2000
        // returns { records, snapshotCursor } with max limit 2000.
        const snapshotRes = await apiFetch(buildUrl('/api/telemetry/snapshot', { limit: 2000 }), { signal });
        if (snapshotRes.status === 404 || snapshotRes.status === 501) {
          // Compatibility fallback for older servers lacking /api/telemetry/snapshot.
          // Fetch bounded history without replaying full history from cursor zero.
          const historyRes = await apiFetch(buildUrl('/api/telemetry/history', { limit: 2000 }), { signal });
          if (!historyRes.ok) throw new Error(`Telemetry history HTTP ${historyRes.status}`);
          const history = await historyRes.json();
          if (generation !== generationRef.current) return;
          const historyRecords: Array<TelemetryData & { ingestSeq?: number }> = Array.isArray(history) ? history : [];
          if (historyRecords.length) mergeRecords(historyRecords, generation);

          // If records contain server-assigned ingestSeq, initialize the cursor to max ingestSeq.
          // This allows polling changes strictly after max ingestSeq without replaying from cursor zero.
          let maxSeq = 0;
          for (const r of historyRecords) {
            if (typeof r.ingestSeq === 'number' && r.ingestSeq > maxSeq) {
              maxSeq = r.ingestSeq;
            }
          }
          if (maxSeq > 0) {
            cursorRef.current = maxSeq;
            changesSupportedRef.current = true;
          } else if (historyRecords.length === 0) {
            // Server has no records yet; cursor 0 does not replay history.
            cursorRef.current = 0;
          } else {
            // Older server lacking ingestSeq cannot support cursor-based changes safely without replay.
            changesSupportedRef.current = false;
            const latestRes = await apiFetch(buildUrl('/api/telemetry/latest'), { signal });
            if (!latestRes.ok) throw new Error(`Telemetry latest HTTP ${latestRes.status}`);
            const latest = await latestRes.json();
            if (latest) mergeRecords([latest], generation);
          }
          initializedRef.current = true;
        } else {
          if (!snapshotRes.ok) throw new Error(`Telemetry snapshot HTTP ${snapshotRes.status}`);
          const snapshot = await snapshotRes.json() as { records?: TelemetryData[]; snapshotCursor?: number };
          if (generation !== generationRef.current) return;
          const records = Array.isArray(snapshot.records) ? snapshot.records : [];
          if (records.length) mergeRecords(records, generation);
          cursorRef.current = typeof snapshot.snapshotCursor === 'number' ? snapshot.snapshotCursor : 0;
          changesSupportedRef.current = true;
          initializedRef.current = true;
        }
      } else if (changesSupportedRef.current !== false) {
        // Poll changes strictly after the established cursor
        const changePage = await fetchChanges(cursorRef.current, generation, signal);
        if (changePage === null) {
          const response = await apiFetch(buildUrl('/api/telemetry/latest'), { signal });
          if (!response.ok) throw new Error(`Telemetry latest HTTP ${response.status}`);
          const record = await response.json();
          if (record) mergeRecords([record], generation);
        } else if (changePage.records.length) {
          mergeRecords(changePage.records, generation);
        }
      } else {
        const response = await apiFetch(buildUrl('/api/telemetry/latest'), { signal });
        if (!response.ok) throw new Error(`Telemetry latest HTTP ${response.status}`);
        const record = await response.json();
        if (record) mergeRecords([record], generation);
      }
      if (generation === generationRef.current) setConnectionOk(true);
    } catch (err) {
      if (generation === generationRef.current && !isAbortError(err)) {
        setConnectionOk(false);
      }
      throw err;
    }
  }, [buildUrl, fetchChanges, mergeRecords]);

  const pollingInterval = useCallback(() => {
    const timestamp = latestTimestampRef.current;
    return timestamp === null || Date.now() - timestamp > STALE_THRESHOLD_MS ? 15000 : 3000;
  }, []);

  useVisibilityPolling(pollTelemetry, pollingInterval, [activeVehicleId, buildUrl, pollTelemetry, pollingInterval]);

  const latestTimestamp = data.length > 0 ? data[data.length - 1].timestamp : null;

  const latest = data[data.length - 1] || {
    rpm: null, speed: null, coolantTemp: null, latitude: 0, longitude: 0, altitude: 0,
    gpsSpeed: 0, engineLoad: null, throttlePos: null, fuelLevel: null, ambientTemp: null, voltage: null,
    accelTime: null, alertCoolant: false, alertVoltage: false,
    estimatedFuelEconomyKmL: null, estimatedFuelRateLph: null,
    iat: null, map: null
  };

  const formatVal = (val: any, decimals = 2) => {
    if (val === null || val === undefined) return 'N/A';
    if (typeof val === 'number') {
      return decimals !== undefined ? val.toFixed(decimals) : val.toString();
    }
    return val.toString();
  };

  const getProgress = (val: any, max: number) => {
    if (val === null || val === undefined) return 0;
    return (Number(val) / max) * 100;
  };

  const getVoltageColor = (v: any) => {
    if (v === null || v === undefined) return 'var(--text-muted)';
    const num = Number(v);
    if (num < 11.5) return 'var(--accent-red)';
    if (num < 12.5) return 'var(--accent-amber)';
    return 'var(--accent-green)';
  };

  const getTempColor = (t: any) => {
    if (t === null || t === undefined) return 'var(--text-muted)';
    const num = Number(t);
    if (num > 105) return 'var(--accent-red)';
    if (num > 75) return 'var(--accent-green)';
    return 'var(--accent-cyan)';
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div style={styles.tooltipContainer} className="glass-panel-static">
          <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={`item-${index}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: entry.color }}></span>
              <span style={{ color: 'var(--text-primary)' }}>{entry.name}:</span>
              <span style={{ fontWeight: 700, color: entry.color }}>{entry.value !== null ? Number(entry.value).toFixed(2) : 'N/A'}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const renderTelemetryWorkspace = () => (
    <>
      <StaleDataNotice connectionOk={connectionOk} timestamp={latestTimestamp} />

      {/* WARNING BANNERS */}
      {(latest.alertCoolant || latest.alertVoltage) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px', width: '100%' }}>
          {latest.alertCoolant && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgb(239, 68, 68)',
              color: '#f87171',
              padding: '16px 20px',
              borderRadius: '12px',
              fontWeight: 600,
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              boxShadow: '0 0 20px rgba(239, 68, 68, 0.2)'
            }}>
              <AlertCircle size={20} />
              <span>ENGINE TEMPERATURE OVERHEATING DANGER: Coolant at {latest.coolantTemp?.toFixed(2)}°C! Pull over immediately!</span>
            </div>
          )}
          {latest.alertVoltage && (
            <div style={{
              background: 'rgba(245, 158, 11, 0.15)',
              border: '1px solid rgb(245, 158, 11)',
              color: '#fbbf24',
              padding: '16px 20px',
              borderRadius: '12px',
              fontWeight: 600,
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              boxShadow: '0 0 20px rgba(245, 158, 11, 0.2)'
            }}>
              <Battery size={20} />
              <span>BATTERY VOLTAGE CRITICAL: Battery is low ({latest.voltage?.toFixed(2)}V). Alternator charging failure or weak battery.</span>
            </div>
          )}
        </div>
      )}

      {/* MASSIVE MAP (Largest part of the UI) */}
      <div className="glass-panel-static" style={styles.massiveMapCard}>
        <div style={styles.cardHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MapIcon size={20} color="var(--accent-blue)" />
              <span style={styles.cardTitle}>Live Route Tracking Map</span>
            </div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
              <span>Altitude: {latest.altitude.toFixed(2)}m</span>
              <span>•</span>
              <span>GPS Speed: {latest.gpsSpeed.toFixed(2)} km/h</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '450px', position: 'relative' }}>
          {latest.latitude !== 0 && latest.longitude !== 0 ? (
            <div style={{ flex: 1, borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)', background: '#1c1c1e' }}>
              <DynamicLeafletMap latitude={latest.latitude} longitude={latest.longitude} routeData={data} />
            </div>
          ) : (
            <div style={{ flex: 1, borderRadius: '12px', border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>
              Awaiting GPS location signal...
            </div>
          )}
          
          {/* Floating HUD-like badge */}
          {latest.latitude !== 0 && latest.longitude !== 0 && (
            <div className="glass-panel-static" style={styles.mapFloatingBadge}>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${latest.latitude},${latest.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...styles.gpsLink, fontSize: '14px' }}
                title="Open in Maps App"
              >
                Coords: {latest.latitude.toFixed(6)}, {latest.longitude.toFixed(6)}
              </a>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                Click to launch Map App
              </span>
            </div>
          )}
        </div>
      </div>

      {/* METRICS GRID (Gauge cards below map) */}
      <div style={styles.grid}>
        <MetricCard
          title="Engine Speed"
          value={formatVal(latest.rpm)}
          unit="RPM"
          icon={<Activity size={20} color="var(--accent-purple)" />}
          progress={getProgress(latest.rpm, 8000)}
          progressColor="var(--accent-purple)"
          subtext={`Max 8000 RPM`}
        />
        <MetricCard
          title="Velocity"
          value={formatVal(latest.speed)}
          unit="km/h"
          icon={<Navigation size={20} color="var(--accent-cyan)" />}
          progress={getProgress(latest.speed, 180)}
          progressColor="var(--accent-cyan)"
           subtext={`GPS: ${latest.gpsSpeed.toFixed(2)} km/h`}
        />
        <MetricCard
          title="Coolant Temp"
          value={formatVal(latest.coolantTemp)}
          unit="°C"
          icon={<Thermometer size={20} color={getTempColor(latest.coolantTemp)} />}
          progress={getProgress(latest.coolantTemp, 120)}
          progressColor={getTempColor(latest.coolantTemp)}
          valueColor={getTempColor(latest.coolantTemp)}
          subtext={latest.ambientTemp !== null ? `Ambient: ${latest.ambientTemp}°C` : 'Ambient: N/A'}
        />
        <MetricCard
          title="Fuel Reserve"
          value={formatVal(latest.fuelLevel)}
          unit="%"
          icon={<Flame size={20} color={latest.fuelLevel !== null ? (latest.fuelLevel < 15 ? 'var(--accent-red)' : 'var(--accent-green)') : 'var(--text-muted)'} />}
          progress={getProgress(latest.fuelLevel, 100)}
          progressColor={latest.fuelLevel !== null ? (latest.fuelLevel < 15 ? 'var(--accent-red)' : 'var(--accent-green)') : 'var(--border)'}
          subtext={latest.fuelLevel !== null ? (latest.fuelLevel < 15 ? "Low Fuel Warning" : "Level Normal") : "N/A"}
        />
        <FuelEconomyCard value={latest.estimatedFuelEconomyKmL} rate={latest.estimatedFuelRateLph} timestamp={latestTimestamp} connectionOk={connectionOk} />
        <MetricCard
          title="System Voltage"
           value={formatVal(latest.voltage)}
          unit="V"
          icon={<Battery size={20} color={getVoltageColor(latest.voltage)} />}
          progress={getProgress(latest.voltage, 15)}
          progressColor={getVoltageColor(latest.voltage)}
          valueColor={getVoltageColor(latest.voltage)}
          subtext={latest.voltage !== null ? (latest.voltage > 13 ? "Alternator Charging" : "Discharging") : "N/A"}
        />
        <MetricCard
          title="0-100 km/h Accel"
          value={latest.accelTime !== null ? `${latest.accelTime.toFixed(2)}` : 'N/A'}
          unit={latest.accelTime !== null ? 's' : ''}
          icon={<Flame size={20} color="var(--accent-amber)" />}
          progress={latest.accelTime !== null ? Math.min(100, (12.0 / latest.accelTime) * 100) : 0}
          progressColor="var(--accent-amber)"
          subtext={latest.accelTime !== null ? "Sprint Completed!" : "Awaiting acceleration..."}
        />
        <MetricCard
          title="Intake Air (IAT)"
          value={formatVal(latest.iat)}
          unit="°C"
          icon={<Wind size={20} color="var(--accent-amber)" />}
          progress={getProgress(latest.iat, 100)}
          progressColor="var(--accent-amber)"
          valueColor="var(--accent-amber)"
          subtext={latest.iat !== null ? "Manifold Intake Temp" : "N/A"}
        />
        <MetricCard
          title="Manifold (MAP)"
          value={formatVal(latest.map)}
          unit="kPa"
          icon={<Gauge size={20} color="var(--accent-cyan)" />}
          progress={getProgress(latest.map, 255)}
          progressColor="var(--accent-cyan)"
          valueColor="var(--accent-cyan)"
          subtext={latest.map !== null ? (latest.map > 101 ? `${(latest.map - 101.3).toFixed(1)} kPa Boost` : `${(101.3 - latest.map).toFixed(1)} kPa Vacuum`) : "N/A"}
        />
      </div>

      {/* CHART AREA */}
      <div className="glass-panel-static" style={styles.chartSection}>
        <div style={styles.tabContainer}>
          <button
            onClick={() => setActiveTab('engine')}
            style={{ ...styles.tabBtn, ...(activeTab === 'engine' ? styles.tabBtnActive : {}) }}
          >
            Performance Metrics
          </button>
          <button
            onClick={() => setActiveTab('temperatures')}
            style={{ ...styles.tabBtn, ...(activeTab === 'temperatures' ? styles.tabBtnActive : {}) }}
          >
            Thermal Readings
          </button>
          <button
            onClick={() => setActiveTab('fuel_load')}
            style={{ ...styles.tabBtn, ...(activeTab === 'fuel_load' ? styles.tabBtnActive : {}) }}
          >
            Engine Load & Fuel
          </button>
        </div>

        <div style={{ height: '400px', width: '100%', marginTop: '20px' }}>
          {data.length === 0 ? (
            <div style={styles.emptyState}>
              <AlertCircle size={48} color="var(--text-muted)" style={{ marginBottom: '16px' }} />
              <p>Awaiting telemetry transmission...</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              {activeTab === 'engine' ? (
                <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="timeLabel" stroke="var(--text-muted)" tick={{ fontSize: 12 }} dy={10} />
                  <YAxis yAxisId="left" stroke="var(--text-muted)" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="right" orientation="right" stroke="var(--text-muted)" tick={{ fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Brush dataKey="timeLabel" height={30} stroke="var(--accent-purple)" fill="rgba(0,0,0,0.2)" />
                  <Line yAxisId="left" type="monotone" dataKey="rpm" stroke="var(--accent-purple)" strokeWidth={3} name="RPM" dot={false} activeDot={{ r: 6, fill: 'var(--accent-purple)', stroke: '#fff', strokeWidth: 2 }} />
                  <Line yAxisId="right" type="monotone" dataKey="speed" stroke="var(--accent-cyan)" strokeWidth={3} name="OBD Speed" dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="gpsSpeed" stroke="var(--accent-blue)" strokeWidth={2} strokeDasharray="5 5" name="GPS Speed" dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="map" stroke="var(--accent-amber)" strokeWidth={2} name="MAP (kPa)" dot={false} connectNulls />
                </LineChart>
              ) : activeTab === 'temperatures' ? (
                <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="timeLabel" stroke="var(--text-muted)" tick={{ fontSize: 12 }} dy={10} />
                  <YAxis stroke="var(--text-muted)" tick={{ fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Brush dataKey="timeLabel" height={30} stroke="var(--accent-red)" fill="rgba(0,0,0,0.2)" />
                  <Line type="monotone" dataKey="coolantTemp" stroke="var(--accent-red)" strokeWidth={3} name="Coolant" dot={false} />
                  <Line type="monotone" dataKey="ambientTemp" stroke="var(--accent-green)" strokeWidth={3} name="Ambient" dot={false} />
                  <Line type="monotone" dataKey="iat" stroke="var(--accent-amber)" strokeWidth={3} name="Intake Air (IAT)" dot={false} connectNulls />
                </LineChart>
              ) : (
                <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorLoad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-amber)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--accent-amber)" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorThrottle" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-red)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--accent-red)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="timeLabel" stroke="var(--text-muted)" tick={{ fontSize: 12 }} dy={10} />
                  <YAxis domain={[0, 100]} stroke="var(--text-muted)" tick={{ fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Brush dataKey="timeLabel" height={30} stroke="var(--accent-amber)" fill="rgba(0,0,0,0.2)" />
                  <Area type="monotone" dataKey="engineLoad" stroke="var(--accent-amber)" strokeWidth={2} fillOpacity={1} fill="url(#colorLoad)" name="Engine Load (%)" dot={false} />
                  <Area type="monotone" dataKey="throttlePos" stroke="var(--accent-red)" strokeWidth={2} fillOpacity={1} fill="url(#colorThrottle)" name="Throttle (%)" dot={false} />
                  <Line type="monotone" dataKey="fuelLevel" stroke="var(--accent-green)" strokeWidth={3} name="Fuel Level (%)" dot={false} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          )}
        </div>
      </div>

    </>
  );

  return (
    <div style={styles.container}>
      {/* HEADER */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={styles.logoBadge}>
            <Activity size={28} color="var(--accent-blue)" />
          </div>
          <div>
            <h1 style={styles.title}>Axia OS</h1>
            <p style={styles.subtitle}>Telemetry Core</p>
          </div>
        </div>

        <div style={styles.headerControls}>
          <FreshnessBadge connectionOk={connectionOk} timestamp={latestTimestamp} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {renderTelemetryWorkspace()}
      </div>
    </div>
  );
}

const MetricCard = ({ title, value, unit, icon, progress, progressColor, subtext, valueColor }: any) => {
  const isUnavailable = value === 'N/A' || value === null || value === undefined;
  return (
    <div className="glass-panel" style={{ ...styles.card, ...(isUnavailable ? { opacity: 0.55 } : {}) }}>
      <div style={styles.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {icon}
          <span style={styles.cardTitle}>{title}</span>
        </div>
      </div>
      <div style={styles.cardBody}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <span style={{ ...styles.cardValue, color: valueColor || 'var(--text-primary)' }}>{value}</span>
          <span style={styles.cardUnit}>{unit}</span>
        </div>
        {subtext && <div style={styles.cardSubtext}>{subtext}</div>}

        {progress !== undefined && (
          <div style={styles.progressBarBg}>
            <div
              style={{
                ...styles.progressBarFill,
                width: `${Math.min(Math.max(progress, 0), 100)}%`,
                backgroundColor: progressColor
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '32px',
    flexWrap: 'wrap',
    gap: '16px'
  },
  logoBadge: {
    width: '56px',
    height: '56px',
    borderRadius: '16px',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(59, 130, 246, 0.2)'
  },
  title: {
    fontSize: '28px',
    fontWeight: 800,
    margin: 0,
    background: 'linear-gradient(to right, #fff, #a1a1aa)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    letterSpacing: '-0.02em'
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--text-muted)',
    margin: '4px 0 0 0',
    fontWeight: 500
  },
  headerControls: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center'
  },
  toggleGroup: {
    display: 'flex',
    padding: '4px',
    gap: '4px'
  },
  toggleBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    padding: '8px 16px',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  toggleBtnActive: {
    background: 'var(--surface-hover)',
    color: 'var(--text-primary)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
  },
  liveIndicatorWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 16px',
  },
  
  // Two-column layout
  twoColumnWorkspace: {
    display: 'flex',
    gap: '32px',
    width: '100%',
    alignItems: 'flex-start'
  },
  sidebar: {
    flex: '0 0 320px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    alignSelf: 'stretch'
  },
  mainWorkspace: {
    flex: 1,
    minWidth: 0
  },
  drivesScrollList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxHeight: '400px',
    overflowY: 'auto',
    paddingRight: '4px'
  },
  driveListItem: {
    padding: '16px',
    borderRadius: '12px',
    cursor: 'pointer',
    border: '1px solid var(--border)',
    transition: 'all 0.2s ease'
  },
  driveListItemActive: {
    background: 'rgba(59, 130, 246, 0.15)',
    borderColor: 'var(--accent-blue)',
    boxShadow: '0 0 16px rgba(59, 130, 246, 0.2)'
  },
  miniStatsRow: {
    display: 'flex',
    gap: '8px',
    fontSize: '11px',
    marginTop: '10px',
    fontWeight: 500
  },
  sidebarFooter: {
    padding: '20px',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    border: '1px solid var(--border)'
  },
  sidebarInputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  sidebarLabel: {
    fontSize: '10px',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  sidebarInput: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    borderRadius: '10px',
    fontSize: '13px',
    outline: 'none'
  },
  sidebarApplyBtn: {
    background: 'transparent',
    border: '1px solid var(--accent-blue)',
    color: 'var(--accent-blue)',
    padding: '10px 16px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    marginTop: '4px'
  },

  // Main Workspace components
  driveHeaderSummary: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '24px',
    borderRadius: '16px',
    border: '1px solid var(--border)',
    flexWrap: 'wrap',
    gap: '24px'
  },
  headerSummaryCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  emptyWorkspaceState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px 24px',
    borderRadius: '16px',
    border: '1px dashed var(--border)',
    minHeight: '400px'
  },

  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  label: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  input: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    padding: '10px 16px',
    borderRadius: '12px',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  primaryBtn: {
    background: 'var(--accent-blue)',
    color: '#fff',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(59, 130, 246, 0.4)',
    transition: 'transform 0.2s, box-shadow 0.2s'
  },
  badgeText: {
    marginLeft: 'auto',
    fontSize: '13px',
    color: 'var(--text-muted)',
    fontWeight: 500,
    alignSelf: 'center'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '20px',
    marginBottom: '32px'
  },
  card: {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    minHeight: '140px'
  },
  cardHeader: {
    marginBottom: '16px'
  },
  cardTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.02em'
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  cardValue: {
    fontSize: '32px',
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: '-0.02em'
  },
  cardUnit: {
    fontSize: '16px',
    color: 'var(--text-muted)',
    fontWeight: 600
  },
  cardSubtext: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    marginTop: '4px'
  },
  progressBarBg: {
    height: '6px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '3px',
    marginTop: '12px',
    overflow: 'hidden'
  },
  progressBarFill: {
    height: '100%',
    borderRadius: '3px',
    transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
  },
  gpsLink: {
    fontSize: '18px',
    fontWeight: 600,
    color: 'var(--accent-blue)',
    textDecoration: 'none',
    transition: 'opacity 0.2s'
  },
  chartSection: {
    padding: '24px',
  },
  tabContainer: {
    display: 'flex',
    gap: '12px',
    borderBottom: '1px solid var(--border)',
    paddingBottom: '16px',
    overflowX: 'auto'
  },
  tabBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: '15px',
    fontWeight: 600,
    padding: '8px 16px',
    cursor: 'pointer',
    position: 'relative',
    transition: 'color 0.2s',
    whiteSpace: 'nowrap'
  },
  tabBtnActive: {
    color: 'var(--text-primary)',
  },
  emptyState: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)'
  },
  tooltipContainer: {
    padding: '16px',
    minWidth: '180px',
  },
  massiveMapCard: {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    minHeight: '520px',
    marginBottom: '32px'
  },
  mapFloatingBadge: {
    position: 'absolute',
    bottom: '20px',
    left: '20px',
    padding: '12px 18px',
    borderRadius: '12px',
    zIndex: 10,
    background: 'rgba(18, 18, 22, 0.85)',
    border: '1px solid var(--border)',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)'
  }
};

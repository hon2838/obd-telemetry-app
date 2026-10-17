import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Brush
} from 'recharts';
import {
  Activity, Map as MapIcon, Thermometer, Battery, Flame, Fuel, Navigation,
  AlertCircle, Clock, Car, Gauge, Wind, ChevronDown, ChevronUp, ExternalLink
} from 'lucide-react';
import Link from 'next/link';
import { apiFetch, isAbortError } from '../api';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { useVehicle } from '../context/VehicleContext';
import PageHeader from './PageHeader';
import DataFreshness, { STALE_THRESHOLD_MS } from './DataFreshness';
import MetricSummary from './MetricSummary';
import EmptyState from './EmptyState';

export interface TelemetryData {
  timestamp: number;
  receivedAt?: number | null;
  rpm?: number | null;
  speed?: number | null;
  coolantTemp?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  gpsSpeed?: number | null;
  engineLoad?: number | null;
  throttlePos?: number | null;
  fuelLevel?: number | null;
  ambientTemp?: number | null;
  voltage?: number | null;
  accelTime?: number | null;
  alertCoolant?: boolean;
  alertVoltage?: boolean;
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

  const age = timestamp === null ? null : now - timestamp;
  const fresh = connectionOk && age !== null && age >= 0 && age <= STALE_THRESHOLD_MS;
  const formatted = fresh ? formatFuelEconomyKmL(value) : null;
  const formattedRate = fresh ? formatFuelEconomyKmL(rate) : null;
  const state = !connectionOk
    ? 'Disconnected'
    : age !== null && age > STALE_THRESHOLD_MS
    ? 'Reading too old'
    : !fresh
    ? 'Awaiting fresh reading'
    : formatted === null || formattedRate === null
    ? 'Estimate unavailable or incomplete'
    : 'Latest synced reading';

  return (
    <div className="glass-panel metric-summary-card">
      <div className="metric-summary-header">
        <span className="metric-summary-label">Estimated fuel economy</span>
        <Fuel size={16} color={formatted !== null ? 'var(--accent-cyan)' : 'var(--text-muted)'} aria-hidden="true" />
      </div>
      <div className="metric-summary-value">
        {formatted ?? 'N/A'}
        {formatted !== null && <small className="metric-summary-unit">km/L</small>}
      </div>
      <div className="metric-summary-subtext">
        <div data-testid="fuel-rate">
          Estimated fuel rate: {formattedRate !== null ? `${formattedRate} L/h` : 'N/A'}
        </div>
        <div>Petrol estimate · {state}</div>
      </div>
    </div>
  );
};

interface MapProps {
  latitude: number;
  longitude: number;
  routeData: TelemetryData[];
}

const DynamicLeafletMap = ({ latitude, longitude, routeData }: MapProps) => {
  const routeCoords = useMemo(() => {
    return routeData
      .filter(p => typeof p.latitude === 'number' && typeof p.longitude === 'number' && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && p.latitude !== 0 && p.longitude !== 0)
      .map(p => [p.latitude!, p.longitude!]);
  }, [routeData]);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

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
    if (!loaded || !mapContainerRef.current) return;
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) return;

    const L = (window as any).L;
    if (!L) return;

    if (!mapInstanceRef.current) {
      try {
        const map = L.map(mapContainerRef.current, {
          zoomControl: true,
          attributionControl: false
        }).setView([latitude, longitude], 15);
        mapInstanceRef.current = map;

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
          maxNativeZoom: 16,
          attribution: 'Tiles &copy; Esri'
        }).addTo(map);

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19,
          maxNativeZoom: 16
        }).addTo(map);

        markerRef.current = L.marker([latitude, longitude]).addTo(map);

        polylineRef.current = L.polyline(routeCoords, {
          color: '#48c5b3',
          weight: 3.5,
          opacity: 0.85
        }).addTo(map);

        if (routeCoords.length > 1) {
          const bounds = polylineRef.current.getBounds();
          if (bounds && bounds.isValid && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [24, 24], animate: false });
          }
        }
      } catch (_) {}
    } else {
      const map = mapInstanceRef.current;
      const marker = markerRef.current;
      const polyline = polylineRef.current;

      try {
        if (marker) marker.setLatLng([latitude, longitude]);
        if (polyline) polyline.setLatLngs(routeCoords);
        map.panTo([latitude, longitude], { animate: false });
      } catch (_) {}
    }
  }, [loaded, latitude, longitude, routeCoords]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.stop();
          mapInstanceRef.current.remove();
        } catch (_) {}
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div ref={mapContainerRef} style={{ width: '100%', height: '100%', minHeight: '260px', borderRadius: 'var(--radius-sm)', background: '#12161c' }}>
      {!loaded && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Loading Map Layers...
        </div>
      )}
    </div>
  );
};

export default function TelemetryDashboard() {
  const { vehicles, activeVehicleId, activeVehicle, selectVehicle, buildUrl } = useVehicle();
  const [data, setData] = useState<TelemetryData[]>([]);
  const [activeChartTab, setActiveChartTab] = useState<'sync' | 'thermal' | 'load'>('sync');
  const [connectionOk, setConnectionOk] = useState(true);
  const [showSecondarySignals, setShowSecondarySignals] = useState(false);

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
    for (const record of records) {
      recordsRef.current.set(recordKey(record as TelemetryData & { eventId?: string | number; ingestSeq?: number; vehicleId?: string }), withTimeLabel(record));
    }
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
    // If All Vehicles is explicitly chosen and multiple vehicles exist, do not poll mixed engine data
    if (activeVehicleId === 'all' && vehicles.length > 1) {
      return;
    }

    const generation = generationRef.current;
    try {
      if (!initializedRef.current) {
        const snapshotRes = await apiFetch(buildUrl('/api/telemetry/snapshot', { limit: 2000 }), { signal });
        if (snapshotRes.status === 404 || snapshotRes.status === 501) {
          const historyRes = await apiFetch(buildUrl('/api/telemetry/history', { limit: 2000 }), { signal });
          if (!historyRes.ok) throw new Error(`Telemetry history HTTP ${historyRes.status}`);
          const history = await historyRes.json();
          if (generation !== generationRef.current) return;
          const historyRecords: Array<TelemetryData & { ingestSeq?: number }> = Array.isArray(history) ? history : [];
          if (historyRecords.length) mergeRecords(historyRecords, generation);

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
            cursorRef.current = 0;
          } else {
            changesSupportedRef.current = false;
            const latestRes = await apiFetch(buildUrl('/api/telemetry/latest'), { signal });
            if (!latestRes.ok) throw new Error(`Telemetry latest HTTP ${latestRes.status}`);
            const latestData = await latestRes.json();
            if (latestData) mergeRecords([latestData], generation);
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
  }, [activeVehicleId, vehicles.length, buildUrl, fetchChanges, mergeRecords]);

  const pollingInterval = useCallback(() => {
    const timestamp = latestTimestampRef.current;
    return timestamp === null || Date.now() - timestamp > STALE_THRESHOLD_MS ? 15000 : 3000;
  }, []);

  useVisibilityPolling(pollTelemetry, pollingInterval, [activeVehicleId, buildUrl, pollTelemetry, pollingInterval]);

  const latestTimestamp = data.length > 0 ? data[data.length - 1].timestamp : null;
  const rawLatest = data.length > 0 ? data[data.length - 1] : null;

  const latest: TelemetryData = {
    timestamp: rawLatest?.timestamp ?? 0,
    receivedAt: rawLatest?.receivedAt ?? null,
    rpm: rawLatest?.rpm ?? null,
    speed: rawLatest?.speed ?? null,
    coolantTemp: rawLatest?.coolantTemp ?? null,
    latitude: rawLatest?.latitude ?? 0,
    longitude: rawLatest?.longitude ?? 0,
    altitude: rawLatest?.altitude ?? null,
    gpsSpeed: rawLatest?.gpsSpeed ?? null,
    engineLoad: rawLatest?.engineLoad ?? null,
    throttlePos: rawLatest?.throttlePos ?? null,
    fuelLevel: rawLatest?.fuelLevel ?? null,
    ambientTemp: rawLatest?.ambientTemp ?? null,
    voltage: rawLatest?.voltage ?? null,
    accelTime: rawLatest?.accelTime ?? null,
    alertCoolant: !!rawLatest?.alertCoolant,
    alertVoltage: !!rawLatest?.alertVoltage,
    estimatedFuelEconomyKmL: rawLatest?.estimatedFuelEconomyKmL ?? null,
    estimatedFuelRateLph: rawLatest?.estimatedFuelRateLph ?? null,
    iat: rawLatest?.iat ?? null,
    map: rawLatest?.map ?? null,
  };

  const hasGps = typeof latest.latitude === 'number' && typeof latest.longitude === 'number' &&
    latest.latitude !== 0 && latest.longitude !== 0 &&
    Math.abs(latest.latitude) <= 90 && Math.abs(latest.longitude) <= 180;

  // Requirement 5: Multiple vehicles & All Vehicles selected -> vehicle-oriented summary
  if (activeVehicleId === 'all' && vehicles.length > 1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <PageHeader
          title="Vehicle Telemetry"
          subtitle="Telemetry readings are vehicle-specific. Select a vehicle below or from the header to inspect its live signals."
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: '1rem' }}>
          {vehicles.map(v => (
            <div key={v.id} className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Car size={18} color="var(--accent-cyan)" />
                  <strong style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>{v.name}</strong>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {v.tankLitres ? `${v.tankLitres}L Tank` : 'Standard Tank'}
                </span>
              </div>
              <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', margin: 0 }}>
                {v.recordCount?.telemetry ? `${v.recordCount.telemetry.toLocaleString()} telemetry points recorded` : 'Registered vehicle'}
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => selectVehicle(v.id)}
                style={{ marginTop: '0.25rem', alignSelf: 'flex-start' }}
              >
                Inspect Telemetry →
              </button>
            </div>
          ))}
        </div>

        <div style={{ padding: '1rem 0' }}>
          <Link href="/garage" className="btn-secondary">
            Manage Garage & Vehicles →
          </Link>
        </div>
      </div>
    );
  }

  const currentVehicleName = activeVehicle?.name || (vehicles.length > 0 ? vehicles[0].name : 'Vehicle');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PageHeader
        title={currentVehicleName}
        subtitle="Recorded vehicle signals, synchronized charts, and the latest location snapshot."
      />

      {/* Truthful Data Status Banner */}
      <DataFreshness
        connectionOk={connectionOk}
        timestamp={latestTimestamp}
        receivedAt={latest.receivedAt}
        vehicleName={currentVehicleName}
      />

      {/* Safety Warning Banners */}
      {(latest.alertCoolant || latest.alertVoltage) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {latest.alertCoolant && (
            <div style={{
              background: 'var(--accent-red-bg)',
              border: '1px solid var(--accent-red)',
              color: 'var(--accent-red)',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.875rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <AlertCircle size={18} />
              <span>
                Coolant temperature warning: {typeof latest.coolantTemp === 'number' ? `${Math.round(latest.coolantTemp)}°C` : 'N/A'}. Check cooling system.
              </span>
            </div>
          )}
          {latest.alertVoltage && (
            <div style={{
              background: 'var(--accent-amber-bg)',
              border: '1px solid var(--accent-amber)',
              color: 'var(--accent-amber)',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.875rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <Battery size={18} />
              <span>
                Battery voltage low ({typeof latest.voltage === 'number' ? `${latest.voltage.toFixed(1)}V` : 'N/A'}). Check alternator charging.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Primary Metrics Grid (Sensible precision, no arbitrary progress bars) */}
      <div className="telemetry-primary-grid">
        {/* Speed */}
        <MetricSummary
          label="Speed"
          value={typeof latest.speed === 'number' ? Math.round(latest.speed) : 'N/A'}
          unit={typeof latest.speed === 'number' ? 'km/h' : undefined}
          icon={<Navigation size={16} />}
          subtext={typeof latest.gpsSpeed === 'number' ? `GPS speed: ${Math.round(latest.gpsSpeed)} km/h` : 'GPS speed: N/A'}
        />

        {/* Engine Speed (RPM) */}
        <MetricSummary
          label="Engine Speed"
          value={typeof latest.rpm === 'number' ? Math.round(latest.rpm).toLocaleString() : 'N/A'}
          unit={typeof latest.rpm === 'number' ? 'RPM' : undefined}
          icon={<Activity size={16} />}
          subtext="Crankshaft rotational speed"
        />

        {/* Estimated Fuel Economy */}
        <FuelEconomyCard
          value={latest.estimatedFuelEconomyKmL}
          rate={latest.estimatedFuelRateLph}
          timestamp={latestTimestamp}
          connectionOk={connectionOk}
        />

        {/* Coolant Temperature */}
        <MetricSummary
          label="Coolant Temp"
          value={typeof latest.coolantTemp === 'number' ? Math.round(latest.coolantTemp) : 'N/A'}
          unit={typeof latest.coolantTemp === 'number' ? '°C' : undefined}
          icon={<Thermometer size={16} />}
          subtext={typeof latest.ambientTemp === 'number' ? `Ambient: ${Math.round(latest.ambientTemp)}°C` : 'Ambient: N/A'}
        />

        {/* System Voltage */}
        <MetricSummary
          label="System Voltage"
          value={typeof latest.voltage === 'number' ? latest.voltage.toFixed(1) : 'N/A'}
          unit={typeof latest.voltage === 'number' ? 'V' : undefined}
          icon={<Battery size={16} />}
          subtext={typeof latest.voltage === 'number' ? (latest.voltage >= 13.2 ? 'Alternator charging' : 'Battery discharging') : 'N/A'}
        />

        {/* Fuel Level */}
        <MetricSummary
          label="Fuel level"
          value={typeof latest.fuelLevel === 'number' ? Math.round(latest.fuelLevel) : 'Unavailable'}
          unit={typeof latest.fuelLevel === 'number' ? '%' : undefined}
          icon={<Fuel size={16} />}
          subtext={typeof latest.fuelLevel === 'number' ? (latest.fuelLevel < 15 ? 'Low fuel reserve' : 'Normal level') : 'No fuel-level reading received'}
        />
      </div>

      {/* Secondary Signals Disclosure Toggle */}
      <div className="glass-panel" style={{ padding: '0.65rem 1rem' }}>
        <button
          type="button"
          onClick={() => setShowSecondarySignals(prev => !prev)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: '0.825rem',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '0.2rem 0'
          }}
          aria-expanded={showSecondarySignals}
        >
          <span>More signals (Load, Throttle, IAT, MAP, Sprint time)</span>
          {showSecondarySignals ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showSecondarySignals && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
            gap: '0.75rem',
            marginTop: '0.85rem',
            paddingTop: '0.85rem',
            borderTop: '1px solid var(--border)'
          }}>
            <MetricSummary
              label="Engine Load"
              value={typeof latest.engineLoad === 'number' ? `${Math.round(latest.engineLoad)}%` : 'N/A'}
              subtext="Calculated load value"
            />
            <MetricSummary
              label="Throttle Position"
              value={typeof latest.throttlePos === 'number' ? `${Math.round(latest.throttlePos)}%` : 'N/A'}
              subtext="Absolute throttle"
            />
            <MetricSummary
              label="Intake Air (IAT)"
              value={typeof latest.iat === 'number' ? `${Math.round(latest.iat)}°C` : 'N/A'}
              icon={<Wind size={15} />}
              subtext="Manifold intake temp"
            />
            <MetricSummary
              label="Manifold (MAP)"
              value={typeof latest.map === 'number' ? `${Math.round(latest.map)} kPa` : 'N/A'}
              icon={<Gauge size={15} />}
              subtext={typeof latest.map === 'number' ? (latest.map > 101.3 ? 'Positive boost' : 'Atmospheric/vacuum') : 'N/A'}
            />
            <MetricSummary
              label="0-100 km/h Accel"
              value={typeof latest.accelTime === 'number' ? `${latest.accelTime.toFixed(1)}s` : 'N/A'}
              icon={<Flame size={15} />}
              subtext={typeof latest.accelTime === 'number' ? 'Sprint completed' : 'Awaiting sprint'}
            />
          </div>
        )}
      </div>

      {/* Synchronized Speed and RPM Charts */}
      <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }} aria-label="Telemetry charts">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Recorded Signal Window
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {data.length > 0 ? `${data.length} samples · up to 2,000 points bounded` : 'Awaiting samples'}
            </span>
          </div>

          {/* Chart views tab */}
          <div style={{ display: 'flex', flexWrap: 'wrap', maxWidth: '100%', gap: '4px', background: 'var(--surface-inset)', padding: '3px', borderRadius: 'var(--radius-sm)' }}>
            <button
              type="button"
              className={`nav-link ${activeChartTab === 'sync' ? 'active' : ''}`}
              aria-pressed={activeChartTab === 'sync'}
              onClick={() => setActiveChartTab('sync')}
              style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}
            >
              Speed & RPM
            </button>
            <button
              type="button"
              className={`nav-link ${activeChartTab === 'thermal' ? 'active' : ''}`}
              aria-pressed={activeChartTab === 'thermal'}
              onClick={() => setActiveChartTab('thermal')}
              style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}
            >
              Thermals
            </button>
            <button
              type="button"
              className={`nav-link ${activeChartTab === 'load' ? 'active' : ''}`}
              aria-pressed={activeChartTab === 'load'}
              onClick={() => setActiveChartTab('load')}
              style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}
            >
              Load & Pressure
            </button>
          </div>
        </div>

        {data.length === 0 ? (
          <EmptyState
            icon={<Activity size={32} />}
            title="Awaiting telemetry transmission"
            description="Pair your Android app, connect its OBD adapter, and verify the first upload. Recorded charts appear here once measurements arrive."
            action={<Link href="/pair" className="btn-primary">Pair head unit</Link>}
          />
        ) : activeChartTab === 'sync' ? (
          /* Stacked Synchronized Speed and RPM Charts */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Speed Chart */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                  Vehicle Speed (km/h)
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Current: {typeof latest.speed === 'number' ? `${Math.round(latest.speed)} km/h` : 'N/A'}
                </span>
              </div>
              <div style={{ height: '170px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} syncId="telemetry-readings" margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="timeLabel" stroke="var(--text-muted)" fontSize={11} minTickGap={40} hide />
                    <YAxis stroke="var(--text-muted)" fontSize={11} domain={[0, 'auto']} />
                    <Tooltip contentStyle={{ background: '#171f28', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }} />
                    <Line type="monotone" dataKey="speed" name="Speed (km/h)" stroke="var(--accent-cyan)" dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Engine Speed (RPM) Chart */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-purple)' }}>
                  Engine Speed (RPM)
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Current: {typeof latest.rpm === 'number' ? `${Math.round(latest.rpm)} RPM` : 'N/A'}
                </span>
              </div>
              <div style={{ height: '170px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} syncId="telemetry-readings" margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="timeLabel" stroke="var(--text-muted)" fontSize={11} minTickGap={40} />
                    <YAxis stroke="var(--text-muted)" fontSize={11} domain={[0, 'auto']} />
                    <Tooltip contentStyle={{ background: '#171f28', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }} />
                    <Line type="monotone" dataKey="rpm" name="Engine RPM" stroke="var(--accent-purple)" dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : activeChartTab === 'thermal' ? (
          /* Thermal Signals Chart */
          <div style={{ height: '320px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="timeLabel" stroke="var(--text-muted)" fontSize={11} minTickGap={40} />
                <YAxis stroke="var(--text-muted)" fontSize={11} unit="°C" />
                <Tooltip contentStyle={{ background: '#171f28', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line type="monotone" dataKey="coolantTemp" name="Coolant (°C)" stroke="#38bdf8" dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="ambientTemp" name="Ambient (°C)" stroke="#94a3b8" dot={false} strokeWidth={1.5} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="iat" name="Intake Air (°C)" stroke="#fbbf24" dot={false} strokeWidth={1.5} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          /* Load & Pressure Chart */
          <div style={{ height: '320px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="timeLabel" stroke="var(--text-muted)" fontSize={11} minTickGap={40} />
                <YAxis yAxisId="left" stroke="var(--text-muted)" fontSize={11} unit="%" />
                <YAxis yAxisId="right" orientation="right" stroke="var(--text-muted)" fontSize={11} unit=" kPa" />
                <Tooltip contentStyle={{ background: '#171f28', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px' }} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line yAxisId="left" type="monotone" dataKey="engineLoad" name="Engine Load (%)" stroke="#f472b6" dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
                <Line yAxisId="left" type="monotone" dataKey="throttlePos" name="Throttle (%)" stroke="#a78bfa" dot={false} strokeWidth={1.5} connectNulls={false} isAnimationActive={false} />
                <Line yAxisId="right" type="monotone" dataKey="map" name="Manifold Pressure (kPa)" stroke="#2dd4bf" dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Compact Location Tracking Map (Placed BELOW primary content) */}
      <section className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }} aria-label="Vehicle location">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MapIcon size={16} color="var(--accent-cyan)" />
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Location & Route Preview
            </h2>
          </div>
          {hasGps && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>Altitude: {typeof latest.altitude === 'number' ? `${Math.round(latest.altitude)}m` : 'N/A'}</span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${latest.latitude},${latest.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-cyan)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
              >
                <span>{latest.latitude!.toFixed(5)}, {latest.longitude!.toFixed(5)}</span>
                <ExternalLink size={12} />
              </a>
            </div>
          )}
        </div>

        {hasGps ? (
          <div style={{ height: '260px', width: '100%', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
            <DynamicLeafletMap latitude={latest.latitude!} longitude={latest.longitude!} routeData={data} />
          </div>
        ) : (
          <div style={{
            padding: '1.25rem',
            background: 'var(--surface-inset)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            color: 'var(--text-secondary)'
          }}>
            <Navigation size={20} color="var(--text-muted)" style={{ flexShrink: 0 }} />
            <div>
              <strong style={{ color: 'var(--text-primary)', display: 'block', fontSize: '0.85rem' }}>
                GPS location unavailable
              </strong>
              <span style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                No satellite coordinates received in recent sample. GPS position updates automatically when available.
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

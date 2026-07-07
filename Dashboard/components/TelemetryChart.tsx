import React, { useEffect, useState, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import {
  Activity, Map, Thermometer, Battery, Flame, Navigation, Clock, ActivitySquare, AlertCircle, Power, Fuel, Wrench
} from 'lucide-react';

interface TelemetryData {
  timestamp: number;
  rpm: number;
  speed: number;
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
  timeLabel?: string;
}

interface DriveSession {
  id: number;
  startTime: number;
  endTime: number;
  label: string;
  summary: {
    durationMin: number;
    maxRpm: number;
    maxSpeed: number;
    fuelUsedPercent: string;
    pointCount: number;
  };
}

const emptyDiagnostics = {
  latestDtc: { code: "", timestamp: null },
  latestClearStatus: { success: null, timestamp: null }
};

interface MapProps {
  latitude: number;
  longitude: number;
  routeData: TelemetryData[];
}

const DynamicLeafletMap = ({ latitude, longitude, routeData }: MapProps) => {
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

      // Dark theme tiles
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
      }).addTo(mapInstanceRef.current);

      // Marker
      markerRef.current = L.marker([latitude, longitude]).addTo(mapInstanceRef.current);

      // Polyline route history
      const coords = routeData
        .filter(p => p.latitude !== 0 && p.longitude !== 0)
        .map(p => [p.latitude, p.longitude]);

      polylineRef.current = L.polyline(coords, {
        color: '#3b82f6',
        weight: 4,
        opacity: 0.8
      }).addTo(mapInstanceRef.current);

      if (coords.length > 1) {
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
        const coords = routeData
          .filter(p => p.latitude !== 0 && p.longitude !== 0)
          .map(p => [p.latitude, p.longitude]);
        polyline.setLatLngs(coords);
      }

      map.panTo([latitude, longitude]);
    }
  }, [loaded, latitude, longitude, routeData]);

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
const getApiHost = () => {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === 'undefined') return 'http://localhost:3000';

  if (window.location.hostname === 'obd.hon2838.name.my') {
    return `${window.location.protocol}//obd-api.hon2838.name.my`;
  }

  return `${window.location.protocol}//${window.location.hostname}:3000`;
};

const API_HOST = getApiHost();

export default function TelemetryDashboard() {
  const [data, setData] = useState<TelemetryData[]>([]);
  const [activeTab, setActiveTab] = useState<'engine' | 'temperatures' | 'fuel_load'>('engine');
  
  const [mode, setMode] = useState<'live' | 'history'>('history');
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [drives, setDrives] = useState<DriveSession[]>([]);
  const [selectedDriveId, setSelectedDriveId] = useState<number | 'custom' | null>(null);

  const [diagnostics, setDiagnostics] = useState<{
    latestDtc: { code: string; timestamp: number | null };
    latestClearStatus: { success: boolean | null; timestamp: number | null };
  }>(emptyDiagnostics);
  const [commandLoading, setCommandLoading] = useState<string | null>(null);

  // Poll diagnostics status
  useEffect(() => {
    const fetchDiag = async () => {
      try {
        const response = await fetch(`${API_HOST}/api/telemetry/dtc`);
        if (response.ok) {
          const resJson = await response.json();
          setDiagnostics({
            ...emptyDiagnostics,
            ...(resJson.latest || resJson)
          });
        }
      } catch (err) {
        console.error("Error fetching diagnostics:", err);
      }
    };
    fetchDiag();
    const diagInterval = setInterval(fetchDiag, 3000);
    return () => clearInterval(diagInterval);
  }, []);

  const sendCommand = async (command: 'read_dtc' | 'clear_dtc') => {
    setCommandLoading(command);
    try {
      const response = await fetch(`${API_HOST}/api/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      if (response.ok) {
        alert(`Command '${command === 'read_dtc' ? 'Read DTC' : 'Clear DTC'}' has been queued. The vehicle's Head Unit will execute it on the next sync (within 3 seconds).`);
      } else {
        alert("Failed to queue command");
      }
    } catch (err) {
      console.error(err);
      alert("Error sending command");
    } finally {
      setCommandLoading(null);
    }
  };

  // Poll for Live data
  useEffect(() => {
    if (mode !== 'live') return;

    const fetchData = async () => {
      try {
        const response = await fetch(`${API_HOST}/api/telemetry/history`);
        if (response.ok) {
          const result = await response.json();
          const formattedData = result.map((item: TelemetryData) => ({
            ...item,
            timeLabel: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          }));
          setData(formattedData);
        }
      } catch (error) {
        console.error("Error fetching telemetry data:", error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [mode]);

  // Fetch drives list when entering history mode
  useEffect(() => {
    if (mode !== 'history') return;

    const fetchDrives = async () => {
      try {
        const response = await fetch(`${API_HOST}/api/drives`);
        if (response.ok) {
          const drivesList = await response.json();
          setDrives(drivesList);
        }
      } catch (err) {
        console.error("Error fetching drive sessions:", err);
      }
    };

    fetchDrives();
  }, [mode]);

  const fetchHistoryByTimestamps = async (startTs: number, endTs: number) => {
    try {
      const response = await fetch(`${API_HOST}/api/telemetry/history?start=${startTs}&end=${endTs}`);
      if (response.ok) {
        const result = await response.json();
        const formattedData = result.map((item: TelemetryData) => ({
          ...item,
          timeLabel: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }));
        setData(formattedData);
      }
    } catch (error) {
      console.error("Error fetching historical data:", error);
    }
  };

  const handleDriveChange = (driveIdStr: string) => {
    if (driveIdStr === 'custom') {
      setSelectedDriveId('custom');
      return;
    }

    const id = parseInt(driveIdStr);
    const drive = drives.find(d => d.id === id);
    if (drive) {
      setSelectedDriveId(id);
      
      const formatLocalTime = (ts: number) => {
        const d = new Date(ts);
        const offset = d.getTimezoneOffset();
        const localDate = new Date(d.getTime() - (offset * 60 * 1000));
        return localDate.toISOString().slice(0, 16);
      };
      
      setStartTime(formatLocalTime(drive.startTime));
      setEndTime(formatLocalTime(drive.endTime));
      fetchHistoryByTimestamps(drive.startTime, drive.endTime);
    }
  };

  const fetchHistory = async () => {
    if (!startTime || !endTime) {
      alert("Please select both start and end times.");
      return;
    }
    const startTs = new Date(startTime).getTime();
    const endTs = new Date(endTime).getTime();
    await fetchHistoryByTimestamps(startTs, endTs);
  };

  const latest = data[data.length - 1] || {
    rpm: null, speed: null, coolantTemp: null, latitude: 0, longitude: 0, altitude: 0,
    gpsSpeed: 0, engineLoad: null, throttlePos: null, fuelLevel: null, ambientTemp: null, voltage: null,
    accelTime: null, alertCoolant: false, alertVoltage: false
  };

  const formatVal = (val: any, decimals?: number) => {
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
              <span style={{ fontWeight: 700, color: entry.color }}>{entry.value !== null ? entry.value.toFixed(1) : 'N/A'}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const renderTelemetryWorkspace = () => (
    <>
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
              <span>ENGINE TEMPERATURE OVERHEATING DANGER: Coolant at {latest.coolantTemp}°C! Pull over immediately!</span>
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
              <Map size={20} color="var(--accent-blue)" />
              <span style={styles.cardTitle}>Live Route Tracking Map</span>
            </div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
              <span>Altitude: {latest.altitude.toFixed(0)}m</span>
              <span>•</span>
              <span>GPS Speed: {latest.gpsSpeed.toFixed(1)} km/h</span>
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
          subtext={`GPS: ${latest.gpsSpeed.toFixed(1)} km/h`}
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
        <MetricCard
          title="System Voltage"
          value={formatVal(latest.voltage, 1)}
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
                  <Line yAxisId="left" type="monotone" dataKey="rpm" stroke="var(--accent-purple)" strokeWidth={3} name="RPM" dot={false} activeDot={{ r: 6, fill: 'var(--accent-purple)', stroke: '#fff', strokeWidth: 2 }} />
                  <Line yAxisId="right" type="monotone" dataKey="speed" stroke="var(--accent-cyan)" strokeWidth={3} name="OBD Speed" dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="gpsSpeed" stroke="var(--accent-blue)" strokeWidth={2} strokeDasharray="5 5" name="GPS Speed" dot={false} />
                </LineChart>
              ) : activeTab === 'temperatures' ? (
                <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="timeLabel" stroke="var(--text-muted)" tick={{ fontSize: 12 }} dy={10} />
                  <YAxis stroke="var(--text-muted)" tick={{ fontSize: 12 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Line type="monotone" dataKey="coolantTemp" stroke="var(--accent-red)" strokeWidth={3} name="Coolant" dot={false} />
                  <Line type="monotone" dataKey="ambientTemp" stroke="var(--accent-green)" strokeWidth={3} name="Ambient" dot={false} />
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
                  <Area type="monotone" dataKey="engineLoad" stroke="var(--accent-amber)" strokeWidth={2} fillOpacity={1} fill="url(#colorLoad)" name="Engine Load (%)" dot={false} />
                  <Area type="monotone" dataKey="throttlePos" stroke="var(--accent-red)" strokeWidth={2} fillOpacity={1} fill="url(#colorThrottle)" name="Throttle (%)" dot={false} />
                  <Line type="monotone" dataKey="fuelLevel" stroke="var(--accent-green)" strokeWidth={3} name="Fuel Level (%)" dot={false} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* DIAGNOSTICS & SYSTEM CONTROLS CARD */}
      <div className="glass-panel-static" style={{ padding: '24px', marginTop: '32px', border: '1px solid var(--border)', borderRadius: '16px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
          <ActivitySquare size={20} color="var(--accent-cyan)" /> Vehicle Diagnostics (OBD-II Command Queue)
        </h3>

        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          
          <div style={{ flex: 1, minWidth: '280px' }}>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>LATEST DTC READ:</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: diagnostics.latestDtc.code.includes("P") ? 'var(--accent-red)' : '#fff', marginTop: '4px' }}>
                {diagnostics.latestDtc.code || "No DTC data requested yet"}
              </div>
              {diagnostics.latestDtc.timestamp && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Updated: {new Date(diagnostics.latestDtc.timestamp).toLocaleString()}
                </div>
              )}
            </div>
            
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>LATEST CLEAR STATUS:</div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: diagnostics.latestClearStatus.success === true ? 'var(--accent-green)' : diagnostics.latestClearStatus.success === false ? 'var(--accent-red)' : '#fff', marginTop: '4px' }}>
                {diagnostics.latestClearStatus.success === true ? "Successfully Cleared" : diagnostics.latestClearStatus.success === false ? "Failed to Clear" : "No clear executed"}
              </div>
              {diagnostics.latestClearStatus.timestamp && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Updated: {new Date(diagnostics.latestClearStatus.timestamp).toLocaleString()}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', width: '260px', flexDirection: 'column' }}>
            <button
              onClick={() => sendCommand('read_dtc')}
              disabled={commandLoading !== null}
              style={{
                width: '100%',
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid var(--accent-blue)',
                color: 'var(--accent-blue)',
                padding: '12px 18px',
                borderRadius: '12px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                opacity: commandLoading !== null ? 0.6 : 1
              }}
            >
              {commandLoading === 'read_dtc' ? "Queuing Command..." : "Queue Read DTC (Mode 03)"}
            </button>
            <button
              onClick={() => sendCommand('clear_dtc')}
              disabled={commandLoading !== null}
              style={{
                width: '100%',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid var(--accent-red)',
                color: 'var(--accent-red)',
                padding: '12px 18px',
                borderRadius: '12px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                opacity: commandLoading !== null ? 0.6 : 1
              }}
            >
              {commandLoading === 'clear_dtc' ? "Queuing Command..." : "Queue Clear DTC (Mode 04)"}
            </button>
          </div>

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
            <ActivitySquare size={28} color="var(--accent-blue)" />
          </div>
          <div>
            <h1 style={styles.title}>Axia OS</h1>
            <p style={styles.subtitle}>Telemetry Core</p>
          </div>
        </div>

        <div style={styles.headerControls}>
          <div className="glass-panel-static" style={styles.toggleGroup}>
            <button
              onClick={() => {
                setMode('live');
                setSelectedDriveId(null);
                setData([]);
              }}
              style={{ ...styles.toggleBtn, ...(mode === 'live' ? styles.toggleBtnActive : {}) }}
            >
              <Activity size={16} /> Live Stream
            </button>
            <button
              onClick={() => {
                setMode('history');
                setSelectedDriveId(null);
                setData([]);
              }}
              style={{ ...styles.toggleBtn, ...(mode === 'history' ? styles.toggleBtnActive : {}) }}
            >
              <Clock size={16} /> Drive History
            </button>
            <button
              onClick={() => {
                window.location.href = '/fuel';
              }}
              style={styles.toggleBtn}
            >
              <Fuel size={16} /> Fuel Economy
            </button>
            <button
              onClick={() => {
                window.location.href = '/trips';
              }}
              style={styles.toggleBtn}
            >
              <Navigation size={16} /> Trips
            </button>
            <button
              onClick={() => {
                window.location.href = '/performance';
              }}
              style={styles.toggleBtn}
            >
              <Activity size={16} /> Performance
            </button>
            <button
              onClick={() => {
                window.location.href = '/diagnostics';
              }}
              style={styles.toggleBtn}
            >
              <AlertCircle size={16} /> Diagnostics
            </button>
            <button
              onClick={() => {
                window.location.href = '/maintenance';
              }}
              style={styles.toggleBtn}
            >
              <Wrench size={16} /> Maintenance
            </button>
          </div>

          {mode === 'live' && (
            <div className="glass-panel-static" style={styles.liveIndicatorWrapper}>
              <span className="live-indicator"></span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-green)', letterSpacing: '0.05em' }}>CONNECTED</span>
            </div>
          )}
        </div>
      </div>

      {mode === 'live' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {renderTelemetryWorkspace()}
        </div>
      ) : (
        <div style={styles.twoColumnWorkspace}>
          
          {/* SIDEBAR: Drives History Selection */}
          <div style={styles.sidebar}>
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Select Drive Session
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {drives.length} drives detected
              </span>
            </div>

            <div style={styles.drivesScrollList}>
              {drives.map(drive => {
                const isSelected = selectedDriveId === drive.id;
                return (
                  <div
                    key={drive.id}
                    onClick={() => handleDriveChange(drive.id.toString())}
                    className="glass-panel"
                    style={{
                      ...styles.driveListItem,
                      ...(isSelected ? styles.driveListItemActive : {})
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '14px', color: isSelected ? '#fff' : 'var(--text-primary)' }}>Drive #{drive.id}</div>
                    <div style={{ fontSize: '12px', color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)', marginTop: '4px' }}>
                      {new Date(drive.startTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ ...styles.miniStatsRow, color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>
                      <span>{drive.summary.durationMin} min</span>
                      <span>•</span>
                      <span>{drive.summary.maxSpeed} km/h</span>
                      <span>•</span>
                      <span>{drive.summary.fuelUsedPercent}% fuel</span>
                    </div>
                  </div>
                );
              })}
              {drives.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '24px 0' }}>
                  No drive sessions logged yet.
                </div>
              )}
            </div>

            {/* Fine-grained Controls */}
            <div className="glass-panel-static" style={styles.sidebarFooter}>
              <span style={{ ...styles.label, fontSize: '11px', color: 'var(--text-primary)' }}>Fine-Grained Adjustments</span>
              <div style={styles.sidebarInputGroup}>
                <label style={styles.sidebarLabel}>Start Time</label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value);
                    setSelectedDriveId('custom');
                  }}
                  style={styles.sidebarInput}
                />
              </div>
              <div style={styles.sidebarInputGroup}>
                <label style={styles.sidebarLabel}>End Time</label>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                    setSelectedDriveId('custom');
                  }}
                  style={styles.sidebarInput}
                />
              </div>
              <button onClick={fetchHistory} style={styles.sidebarApplyBtn}>
                Apply Custom Range
              </button>
            </div>
          </div>

          {/* MAIN PANELS: Rendered only after selecting a drive */}
          <div style={styles.mainWorkspace}>
            {selectedDriveId !== null ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                
                {/* Header Info Banner */}
                {selectedDriveId !== 'custom' && (() => {
                  const currentDrive = drives.find(d => d.id === selectedDriveId);
                  if (!currentDrive) return null;
                  return (
                    <div className="glass-panel-static" style={styles.driveHeaderSummary}>
                      <div style={styles.headerSummaryCol}>
                        <span style={styles.summaryLabel}>Selected Session</span>
                        <span style={{ ...styles.summaryVal, fontSize: '18px', color: 'var(--accent-blue)' }}>Drive #{currentDrive.id}</span>
                      </div>
                      <div style={styles.headerSummaryCol}>
                        <span style={styles.summaryLabel}>Duration</span>
                        <span style={styles.summaryVal}>{currentDrive.summary.durationMin} mins</span>
                      </div>
                      <div style={styles.headerSummaryCol}>
                        <span style={styles.summaryLabel}>Max RPM</span>
                        <span style={styles.summaryVal}>{currentDrive.summary.maxRpm} RPM</span>
                      </div>
                      <div style={styles.headerSummaryCol}>
                        <span style={styles.summaryLabel}>Max Velocity</span>
                        <span style={styles.summaryVal}>{currentDrive.summary.maxSpeed} km/h</span>
                      </div>
                      <div style={styles.headerSummaryCol}>
                        <span style={styles.summaryLabel}>Estimated Fuel</span>
                        <span style={styles.summaryVal}>{currentDrive.summary.fuelUsedPercent}%</span>
                      </div>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginLeft: 'auto' }}>
                        <a
                          href={`${API_HOST}/api/drives/${currentDrive.id}/export/csv`}
                          download
                          style={{
                            background: 'rgba(59, 130, 246, 0.15)',
                            border: '1px solid var(--accent-blue)',
                            color: 'var(--accent-blue)',
                            padding: '8px 14px',
                            borderRadius: '10px',
                            fontSize: '12px',
                            fontWeight: 600,
                            textDecoration: 'none',
                            transition: 'opacity 0.2s',
                          }}
                          onMouseOver={(e) => (e.currentTarget.style.opacity = '0.8')}
                          onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
                        >
                          Export CSV
                        </a>
                        <a
                          href={`${API_HOST}/api/drives/${currentDrive.id}/export/gpx`}
                          download
                          style={{
                            background: 'rgba(16, 185, 129, 0.15)',
                            border: '1px solid var(--accent-green)',
                            color: 'var(--accent-green)',
                            padding: '8px 14px',
                            borderRadius: '10px',
                            fontSize: '12px',
                            fontWeight: 600,
                            textDecoration: 'none',
                            transition: 'opacity 0.2s',
                          }}
                          onMouseOver={(e) => (e.currentTarget.style.opacity = '0.8')}
                          onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
                        >
                          Export GPX
                        </a>
                      </div>
                    </div>
                  );
                })()}

                {renderTelemetryWorkspace()}
              </div>
            ) : (
              <div className="glass-panel-static" style={styles.emptyWorkspaceState}>
                <Power size={64} color="var(--text-muted)" style={{ marginBottom: '20px', opacity: 0.5 }} />
                <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Select a Session</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '360px', textAlign: 'center' }}>
                  Select a drive session from the list on the left to analyze its metrics, GPS tracking maps, and telemetry charts.
                </p>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

const MetricCard = ({ title, value, unit, icon, progress, progressColor, subtext, valueColor }: any) => (
  <div className="glass-panel" style={styles.card}>
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

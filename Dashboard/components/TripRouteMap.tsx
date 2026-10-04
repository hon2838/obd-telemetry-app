import { useEffect, useMemo, useRef, useState } from 'react';

export interface GpsPoint {
  latitude?: number | null;
  longitude?: number | null;
}

interface Location {
  lat: number;
  lon: number;
}

interface TripRouteMapProps {
  points: GpsPoint[];
  startLocation: Location | null;
  endLocation: Location | null;
}

const isValidCoordinate = (lat: unknown, lon: unknown): lat is number =>
  typeof lat === 'number' && typeof lon === 'number' &&
  Number.isFinite(lat) && Number.isFinite(lon) &&
  lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 &&
  (lat !== 0 || lon !== 0);

let leafletPromise: Promise<any> | null = null;

function loadLeaflet(): Promise<any> {
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
  if ((window as any).L) return Promise.resolve((window as any).L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    let script = document.getElementById('leaflet-js') as HTMLScriptElement | null;
    const onLoad = () => {
      cleanup();
      const leaflet = (window as any).L;
      if (leaflet) resolve(leaflet);
      else reject(new Error('Leaflet did not initialize'));
    };
    const onError = () => {
      cleanup();
      script?.remove();
      reject(new Error('Leaflet could not load'));
    };
    const timeout = window.setTimeout(onError, 15000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      script?.removeEventListener('load', onLoad);
      script?.removeEventListener('error', onError);
    };
    if (!script) {
      script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.addEventListener('load', onLoad);
      script.addEventListener('error', onError);
      document.body.appendChild(script);
    } else {
      script.addEventListener('load', onLoad);
      script.addEventListener('error', onError);
    }
  }).catch(error => {
    leafletPromise = null;
    throw error;
  });

  return leafletPromise;
}

export default function TripRouteMap({ points, startLocation, endLocation }: TripRouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mapError, setMapError] = useState(false);
  const coordinates = useMemo(() => points
    .filter(point => isValidCoordinate(point.latitude, point.longitude))
    .map(point => [point.latitude as number, point.longitude as number] as [number, number]), [points]);
  const start = (startLocation && isValidCoordinate(startLocation.lat, startLocation.lon)
    ? [startLocation.lat, startLocation.lon] as [number, number] : null) || coordinates[0] || null;
  const end = (endLocation && isValidCoordinate(endLocation.lat, endLocation.lon)
    ? [endLocation.lat, endLocation.lon] as [number, number] : null) || coordinates[coordinates.length - 1] || null;
  const routeCoordinates = useMemo(() => {
    if (coordinates.length < 2) return coordinates;
    const route = [...coordinates];
    if (start && (route[0][0] !== start[0] || route[0][1] !== start[1])) route.unshift(start);
    if (end && (route[route.length - 1][0] !== end[0] || route[route.length - 1][1] !== end[1])) route.push(end);
    return route;
  }, [coordinates, start?.[0], start?.[1], end?.[0], end?.[1]]);

  useEffect(() => {
    if (!containerRef.current || (!start && !end)) return;
    let disposed = false;
    let map: any = null;
    setMapError(false);

    loadLeaflet().then(L => {
      if (disposed || !containerRef.current) return;
      map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        maxNativeZoom: 16,
        attribution: 'Tiles &copy; Esri'
      }).addTo(map);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        maxNativeZoom: 16
      }).addTo(map);

      if (routeCoordinates.length > 1) {
        L.polyline(routeCoordinates, { color: '#38bdf8', weight: 4, opacity: 0.9 }).addTo(map);
      }
      if (start) L.circleMarker(start, { radius: 7, color: '#22c55e', fillOpacity: 1 }).addTo(map).bindTooltip('Start');
      if (end && (!start || start[0] !== end[0] || start[1] !== end[1])) {
        L.circleMarker(end, { radius: 7, color: '#f97316', fillOpacity: 1 }).addTo(map).bindTooltip('End');
      }

      const boundsPoints = routeCoordinates.length > 1 ? routeCoordinates : [start, end].filter(Boolean);
      if (boundsPoints.length > 1) {
        map.fitBounds(L.latLngBounds(boundsPoints), { padding: [30, 30], maxZoom: 15 });
      } else {
        map.setView(boundsPoints[0], 15);
      }
      requestAnimationFrame(() => { if (!disposed) map.invalidateSize(); });
    }).catch(() => {
      if (!disposed) setMapError(true);
    });

    return () => {
      disposed = true;
      if (map) map.remove();
    };
  }, [routeCoordinates, start?.[0], start?.[1], end?.[0], end?.[1]]);

  if (!start && !end) {
    return <div style={emptyStyle}>No GPS positions were recorded for this trip.</div>;
  }

  return <div style={mapWrapperStyle}>
    <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 320 }} aria-label="Trip route map" />
    {mapError && <div style={mapErrorStyle}>Map layers could not load. The trip chart remains available.</div>}
    {coordinates.length < 2 && <div style={routeNoticeStyle}>Only location markers are available; no GPS route was recorded.</div>}
  </div>;
}

const mapWrapperStyle: React.CSSProperties = { height: 320, borderRadius: 12, overflow: 'hidden', background: '#121214', position: 'relative' };
const emptyStyle: React.CSSProperties = { padding: 28, textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.03)', borderRadius: 12 };
const mapErrorStyle: React.CSSProperties = { ...emptyStyle, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 600 };
const routeNoticeStyle: React.CSSProperties = { position: 'absolute', top: 8, left: 8, right: 8, padding: '6px 10px', background: 'rgba(18,18,20,0.88)', color: '#fff', fontSize: 12, borderRadius: 6, zIndex: 500 };

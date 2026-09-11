import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API_HOST, apiFetch } from '../api';

export interface Vehicle {
  id: string;
  name: string;
  tankLitres?: number;
  createdAt?: number;
  recordCount?: {
    telemetry: number;
    fuelLogs: number;
    maintenance: number;
  };
}

interface VehicleContextType {
  vehicles: Vehicle[];
  activeVehicleId: string; // 'all' or specific id like 'default'
  activeVehicle: Vehicle | null;
  isLoading: boolean;
  error: string | null;
  selectVehicle: (id: string) => void;
  refreshVehicles: () => Promise<void>;
  buildUrl: (path: string, params?: Record<string, string | number | boolean | undefined | null>) => string;
}

const VehicleContext = createContext<VehicleContextType>({
  vehicles: [],
  activeVehicleId: 'all',
  activeVehicle: null,
  isLoading: false,
  error: null,
  selectVehicle: () => {},
  refreshVehicles: async () => {},
  buildUrl: (path) => `${API_HOST}${path}`,
});

const STORAGE_KEY = 'obd_active_vehicle_id';

export const VehicleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [activeVehicleId, setActiveVehicleId] = useState<string>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVehicles = useCallback(async () => {
    try {
      setError(null);
      const res = await apiFetch(`${API_HOST}/api/vehicles`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Vehicle[] = await res.json();
      setVehicles(data);

      // Restore saved vehicle preference if valid
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && (saved === 'all' || data.some(v => v.id === saved))) {
          setActiveVehicleId(saved);
        } else if (data.length > 0 && saved !== 'all') {
          // Default to first vehicle if saved ID is invalid
          setActiveVehicleId('all');
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch vehicles:', err);
      setError(err?.message || 'Failed to fetch vehicles');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  const selectVehicle = (id: string) => {
    setActiveVehicleId(id);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, id);
    }
  };

  const activeVehicle = vehicles.find(v => v.id === activeVehicleId) || null;

  const buildUrl = useCallback((path: string, params?: Record<string, string | number | boolean | undefined | null>) => {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    const url = new URL(`${API_HOST ? API_HOST : ''}${cleanPath}`, baseOrigin);
    if (activeVehicleId && activeVehicleId !== 'all') {
      url.searchParams.set('vehicle', activeVehicleId);
    }
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, String(v));
        }
      });
    }
    // Return relative path for same-origin browser calls
    if (!API_HOST) {
      return `${url.pathname}${url.search}`;
    }
    return url.toString();
  }, [activeVehicleId]);

  return (
    <VehicleContext.Provider
      value={{
        vehicles,
        activeVehicleId,
        activeVehicle,
        isLoading,
        error,
        selectVehicle,
        refreshVehicles: fetchVehicles,
        buildUrl,
      }}
    >
      {children}
    </VehicleContext.Provider>
  );
};

export const useVehicle = () => useContext(VehicleContext);

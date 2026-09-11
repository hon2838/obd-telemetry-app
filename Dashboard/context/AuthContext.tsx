import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, applyAuthResponse } from '../api';

export interface AuthProfile {
  id: string;
  username?: string;
  role?: string;
  mustChangePassword?: boolean;
  vehicles?: string[];
  deviceCount?: number;
}

interface AuthContextValue {
  profile: AuthProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<AuthProfile | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  profile: null,
  loading: true,
  refreshProfile: async () => null,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try {
      const response = await apiFetch('/api/auth/me');
      if (!response.ok) {
        setProfile(null);
        return null;
      }
      const body = await response.json();
      applyAuthResponse(body);
      setProfile(body);
      return body as AuthProfile;
    } catch {
      setProfile(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshProfile(); }, [refreshProfile]);

  const logout = useCallback(async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } finally {
      setProfile(null);
      if (typeof window !== 'undefined') window.location.assign('/login');
    }
  }, []);

  return <AuthContext.Provider value={{ profile, loading, refreshProfile, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

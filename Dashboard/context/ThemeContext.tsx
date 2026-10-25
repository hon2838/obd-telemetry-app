import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ColorScheme = 'light' | 'dark' | 'light dark';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  colorScheme: ColorScheme;
  resolvedTheme: ResolvedTheme;
  setColorScheme: (scheme: ColorScheme) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colorScheme: 'light dark',
  resolvedTheme: 'dark',
  setColorScheme: () => {},
  cycleTheme: () => {},
});

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolveTheme(scheme: ColorScheme): ResolvedTheme {
  if (scheme === 'dark') return 'dark';
  if (scheme === 'light') return 'light';
  return getSystemTheme();
}

function applyThemeToDOM(scheme: ColorScheme, resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;

  // 1. Synchronize <meta name="color-scheme">
  let meta = document.querySelector('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'color-scheme');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', scheme);

  // 2. Synchronize data-theme on <html>:
  // Explicit 'light' or 'dark' sets data-theme; 'light dark' removes it so CSS media query takes over.
  if (scheme === 'light' || scheme === 'dark') {
    document.documentElement.setAttribute('data-theme', scheme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>('light dark');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('dark');

  // Initialize on mount from localStorage or existing meta/attributes
  useEffect(() => {
    try {
      const saved = localStorage.getItem('color-scheme') as ColorScheme | null;
      const initialScheme: ColorScheme =
        saved === 'light' || saved === 'dark' || saved === 'light dark' ? saved : 'light dark';
      const initialResolved = resolveTheme(initialScheme);

      setColorSchemeState(initialScheme);
      setResolvedTheme(initialResolved);
      applyThemeToDOM(initialScheme, initialResolved);
    } catch {
      // Ignore storage access errors in restricted sandbox
    }
  }, []);

  const setColorScheme = useCallback((scheme: ColorScheme) => {
    const resolved = resolveTheme(scheme);
    setColorSchemeState(scheme);
    setResolvedTheme(resolved);

    try {
      localStorage.setItem('color-scheme', scheme);
    } catch {
      // Ignore storage access errors
    }

    applyThemeToDOM(scheme, resolved);
  }, []);

  const cycleTheme = useCallback(() => {
    setColorSchemeState(current => {
      let next: ColorScheme = 'dark';
      if (current === 'light dark') next = 'dark';
      else if (current === 'dark') next = 'light';
      else next = 'light dark';

      const resolved = resolveTheme(next);
      setResolvedTheme(resolved);
      try {
        localStorage.setItem('color-scheme', next);
      } catch {}
      applyThemeToDOM(next, resolved);
      return next;
    });
  }, []);

  // Sync across tabs via storage event
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        const val = e.newValue as ColorScheme | null;
        const newScheme: ColorScheme =
          val === 'light' || val === 'dark' || val === 'light dark' ? val : 'light dark';
        const resolved = resolveTheme(newScheme);
        setColorSchemeState(newScheme);
        setResolvedTheme(resolved);
        applyThemeToDOM(newScheme, resolved);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Sync when OS theme changes and user preference is System ('light dark')
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (colorScheme === 'light dark') {
        const resolved = mediaQuery.matches ? 'dark' : 'light';
        setResolvedTheme(resolved);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [colorScheme]);

  return (
    <ThemeContext.Provider value={{ colorScheme, resolvedTheme, setColorScheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

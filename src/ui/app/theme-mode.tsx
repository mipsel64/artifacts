import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ThemeMode } from './mode';

interface ThemeModeValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeModeContext = createContext<ThemeModeValue | null>(null);

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function themeMessage(mode: ThemeMode) {
  return {
    type: 'artifact-theme',
    theme: mode,
    font: stored('reading-font'),
    size: Number(stored('reading-size')) || null,
  };
}

export function ThemeModeProvider({ initialMode, children }: { initialMode: ThemeMode; children: ReactNode }) {
  const [mode, updateMode] = useState(initialMode);
  const setMode = useCallback((next: ThemeMode) => {
    updateMode(next);
    document.cookie = next === 'system'
      ? 'theme=; Path=/; Max-Age=0; SameSite=Lax; Secure'
      : `theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    const message = themeMessage(next);
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[data-artifact-preview]')) {
      frame.contentWindow?.postMessage(message, '*');
    }
  }, []);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode(): ThemeModeValue {
  const value = useContext(ThemeModeContext);
  if (!value) throw new Error('useThemeMode must be used inside ThemeModeProvider');
  return value;
}

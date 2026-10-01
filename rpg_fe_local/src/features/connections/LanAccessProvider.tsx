import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useResource } from '../../hooks/useResource';
import type { LanStatus } from '../../services/types';
import { LanContext } from './LanContext';
import { LanPairing } from './LanPairing';
export function LanAccessProvider({ children }: { children: ReactNode }) {
  const resource = useResource<LanStatus>('/lan/status'),
    [blocked, setBlocked] = useState(false),
    wasPaired = useRef<boolean | null>(null);
  const setData = resource.setData;
  const reload = resource.reload;
  const requirePairing = useCallback(() => {
      setBlocked(true);
      wasPaired.current = false;
      setData((current) => (current ? { ...current, paired: false } : current));
    }, [setData]),
    paired = useCallback(() => setBlocked(false), []);
  useEffect(() => {
    window.addEventListener('rpg-pairing-required', requirePairing);
    return () => window.removeEventListener('rpg-pairing-required', requirePairing);
  }, [requirePairing]);
  const required =
    blocked || !!(resource.data?.enabled && !resource.data.desktop && !resource.data.paired);
  useEffect(() => {
    if (resource.data?.paired) {
      setBlocked(false);
      if (wasPaired.current === false) {
        window.dispatchEvent(new Event('rpg-reconnected'));
      }
      wasPaired.current = true;
    } else if (resource.data) {
      wasPaired.current = false;
    }
  }, [resource.data]);
  useEffect(() => {
    const refresh = () => void reload();
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, [reload]);
  useEffect(() => {
    const expires = resource.data?.expiresAt;
    if (!expires || resource.data?.desktop) return;
    const timer = setTimeout(requirePairing, Math.max(0, new Date(expires).getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [resource.data, requirePairing]);
  return (
    <LanContext.Provider
      value={{
        status: resource.data,
        error: resource.error,
        refresh: resource.reload,
        requirePairing,
        paired,
      }}
    >
      <div inert={required ? true : undefined} aria-hidden={required ? true : undefined}>
        {children}
      </div>
      <LanPairing open={required} />
    </LanContext.Provider>
  );
}

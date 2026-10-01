import { useCallback, useEffect, useRef, useState } from 'react';
import { request, errorMessage } from '../services/client';
export function useResource<T>(path: string, loader: (path: string) => Promise<T> = request<T>) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    sequence = useRef(0);
  const reload = useCallback(
    async (requestPath = path) => {
      const id = ++sequence.current;
      try {
        const value = await loader(requestPath);
        if (id === sequence.current) {
          setData(value);
          setError('');
        }
      } catch (e) {
        if (id === sequence.current) setError(errorMessage(e));
      } finally {
        if (id === sequence.current) setLoading(false);
      }
    },
    [path, loader]
  );
  const invalidate = useCallback(() => {
    sequence.current++;
  }, []);
  useEffect(() => {
    setData(null);
    setLoading(true);
    void reload();
    return invalidate;
  }, [reload, invalidate]);
  useEffect(() => {
    if (path === '/lan/status') return;
    const reconnect = () => void reload();
    window.addEventListener('rpg-reconnected', reconnect);
    return () => window.removeEventListener('rpg-reconnected', reconnect);
  }, [path, reload]);
  return { data, error, loading, reload, setData };
}

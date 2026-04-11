import {useState, useEffect, useRef, useCallback} from 'react';
import * as api from '../api/client';

export function useApi<T>(path: string, interval?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  const load = useCallback(async () => {
    try {
      const d = await api.get(path);
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
    if (interval && interval > 0) {
      timer.current = setInterval(load, interval);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load, interval]);

  return {data, loading, error, reload: load};
}

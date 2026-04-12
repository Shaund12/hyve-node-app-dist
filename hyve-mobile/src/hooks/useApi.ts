import {useState, useEffect, useRef, useCallback} from 'react';
import {useIsFocused} from '@react-navigation/native';
import * as api from '../api/client';

export function useApi<T>(path: string, interval?: number, refreshOnFocus = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const isFocused = useIsFocused();
  const hasLoaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get(path);
      setData(d);
      setError(null);
    } catch (e: any) {
      if (e.message !== 'unauthorized') {
        setError(e.message || 'Request failed');
      }
    } finally {
      setLoading(false);
    }
  }, [path]);

  // Initial load + interval
  useEffect(() => {
    load();
    hasLoaded.current = true;
    if (interval && interval > 0) {
      timer.current = setInterval(load, interval);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load, interval]);

  // Refresh on screen focus (not on initial mount)
  useEffect(() => {
    if (refreshOnFocus && isFocused && hasLoaded.current) {
      load();
    }
  }, [isFocused, refreshOnFocus, load]);

  return {data, loading, error, reload: load};
}

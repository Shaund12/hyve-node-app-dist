import React, {createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode} from 'react';
import {AppState} from 'react-native';
import * as api from '../api/client';
import {setOnUnauthorized} from '../api/client';

type AuthState = 'loading' | 'unconfigured' | 'unauthenticated' | 'authenticated';

interface AuthCtx {
  state: AuthState;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setServer: (url: string) => Promise<void>;
  serverUrl: string;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({children}: {children: ReactNode}) {
  const [state, setState] = useState<AuthState>('loading');
  const [serverUrl, setServerUrl] = useState('');

  const refresh = useCallback(async () => {
    setState('loading');
    await api.loadConfig();
    const url = api.getBaseUrl();
    setServerUrl(url);
    if (!url) {
      setState('unconfigured');
      return;
    }
    const ok = await api.checkAuth();
    setState(ok ? 'authenticated' : 'unauthenticated');
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setOnUnauthorized(() => setState('unauthenticated'));
  }, []);

  // Re-validate auth when app returns from background
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        // App came to foreground — check session still valid
        if (state === 'authenticated') {
          api.checkAuth().then(ok => {
            if (!ok) setState('unauthenticated');
          });
        }
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [state]);

  const login = async (username: string, password: string) => {
    const data = await api.login(username, password);
    if (data?.ok) {
      setState('authenticated');
      return true;
    }
    return false;
  };

  const logout = async () => {
    await api.logout();
    setState('unauthenticated');
  };

  const setServer = async (url: string) => {
    await api.setBaseUrl(url);
    setServerUrl(url);
    setState('unauthenticated');
  };

  return (
    <AuthContext.Provider value={{state, login, logout, setServer, serverUrl, refresh}}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

import React, {createContext, useContext, useState, useEffect, useCallback, ReactNode} from 'react';
import * as api from '../api/client';

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

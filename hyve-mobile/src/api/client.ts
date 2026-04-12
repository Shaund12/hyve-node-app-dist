import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER_URL_KEY = 'hyve_server_url';
const SESSION_KEY = 'hyve_session';

let baseUrl = '';
let sessionCookie = '';
let _onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(cb: () => void) {
  _onUnauthorized = cb;
}

export async function loadConfig() {
  const url = await AsyncStorage.getItem(SERVER_URL_KEY);
  if (url) baseUrl = url.replace(/\/$/, '');
  const s = await AsyncStorage.getItem(SESSION_KEY);
  if (s) sessionCookie = s;
}

export function getBaseUrl(): string {
  return baseUrl;
}

export async function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/$/, '');
  await AsyncStorage.setItem(SERVER_URL_KEY, baseUrl);
}

export function isConfigured(): boolean {
  return baseUrl.length > 0;
}

export function isAuthenticated(): boolean {
  return sessionCookie.length > 0;
}

export function getSessionToken(): string {
  return sessionCookie;
}

async function request(
  method: string,
  path: string,
  body?: any,
  timeout = 15000,
): Promise<any> {
  if (!baseUrl) throw new Error('Server URL not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (sessionCookie) {
      headers['Authorization'] = `Bearer ${sessionCookie}`;
    }

    const opts: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${baseUrl}${path}`, opts);

    if (res.status === 401) {
      sessionCookie = '';
      await AsyncStorage.removeItem(SESSION_KEY);
      if (_onUnauthorized) _onUnauthorized();
      throw new Error('unauthorized');
    }

    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const err = await res.json();
        if (err?.detail) msg = String(err.detail);
        if (err?.error) msg = String(err.error);
      } catch {}
      throw new Error(msg);
    }

    const data = await res.json();

    // Capture token from login response
    if (data?.token) {
      sessionCookie = data.token;
      await AsyncStorage.setItem(SESSION_KEY, sessionCookie);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function get(path: string, timeout?: number) {
  return request('GET', path, undefined, timeout);
}

export async function post(path: string, body?: any, timeout?: number) {
  return request('POST', path, body, timeout);
}

export async function del(path: string) {
  return request('DELETE', path);
}

export async function patch(path: string, body?: any) {
  return request('PATCH', path, body);
}

// Auth
export async function login(username: string, password: string) {
  const data = await post('/api/auth/login', {username, password});
  return data;
}

export async function logout() {
  try {
    await post('/api/auth/logout');
  } catch {}
  sessionCookie = '';
  await AsyncStorage.removeItem(SESSION_KEY);
}

export async function checkAuth() {
  try {
    const data = await get('/api/auth/check');
    return data?.authenticated === true;
  } catch {
    return false;
  }
}

// WebSocket
export async function getWsUrl(path: string): Promise<string> {
  return baseUrl.replace(/^http/, 'ws') + path;
}

export function createWebSocket(path: string): WebSocket {
  const wsUrl = baseUrl.replace(/^http/, 'ws') + path;
  const sep = path.includes('?') ? '&' : '?';
  const authUrl = sessionCookie ? `${wsUrl}${sep}token=${sessionCookie}` : wsUrl;
  return new WebSocket(authUrl);
}

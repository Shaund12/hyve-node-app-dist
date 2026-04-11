import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER_URL_KEY = 'hyve_server_url';
const SESSION_KEY = 'hyve_session';

let baseUrl = '';
let sessionCookie = '';

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
    const opts: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(sessionCookie ? {Cookie: `session=${sessionCookie}`} : {}),
      },
      signal: controller.signal,
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${baseUrl}${path}`, opts);

    // Extract session cookie from Set-Cookie header
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/session=([^;]+)/);
      if (match) {
        sessionCookie = match[1];
        await AsyncStorage.setItem(SESSION_KEY, sessionCookie);
      }
    }

    if (res.status === 401) {
      sessionCookie = '';
      await AsyncStorage.removeItem(SESSION_KEY);
      throw new Error('unauthorized');
    }

    const data = await res.json();
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
  return new WebSocket(wsUrl, undefined, {
    headers: {Cookie: `session=${sessionCookie}`},
  });
}

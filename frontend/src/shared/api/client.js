import {
  backendApi,
  enableBackendAdapter,
  enableDemoSession,
  isDemoSessionEnabled,
  isBackendAdapterEnabled,
} from './backend-adapter.js';

let csrfToken = '';

export function setSession(session) {
  csrfToken = session.csrf_token || '';
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, signal, onProgress, keepalive } = {}) {
  if (isDemoSessionEnabled()) {
    enableBackendAdapter();
    return backendApi(path, { method, body, signal, onProgress, keepalive }, requestApi, ApiError);
  }
  if (isBackendAdapterEnabled()) {
    return backendApi(path, { method, body, signal, onProgress, keepalive }, requestApi, ApiError);
  }
  return requestApi(path, { method, body, signal, keepalive });
}

async function requestApi(
  path,
  { method = 'GET', body, signal, auth = true, keepalive } = {},
  retry = true,
) {
  const headers = { Accept: 'application/json' };
  if (!['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = csrfToken;
  if (auth && isBackendAdapterEnabled()) {
    const token = sessionStorage.getItem('careerlens.backend.access-token');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      signal,
      keepalive,
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(
      '서버에 연결할 수 없습니다. 실행 창이 열려 있는지 확인한 뒤 다시 시도해 주세요.',
      0,
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data.error;
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item) => item.msg || item.message || '').filter(Boolean).join(' ')
      : data.detail;
    if (
      response.status === 401 &&
      retry &&
      isBackendAdapterEnabled() &&
      auth &&
      sessionStorage.getItem('careerlens.backend.refresh-token')
    ) {
      const refreshed = await requestApi(
        '/auth/refresh',
        {
          method: 'POST',
          body: {
            refresh_token: sessionStorage.getItem('careerlens.backend.refresh-token'),
          },
          auth: false,
          signal,
        },
        false,
      );
      if (refreshed.access_token) {
        sessionStorage.setItem('careerlens.backend.access-token', refreshed.access_token);
        if (refreshed.refresh_token)
          sessionStorage.setItem('careerlens.backend.refresh-token', refreshed.refresh_token);
        return requestApi(path, { method, body, signal, auth }, false);
      }
    }
    throw new ApiError(
      typeof error === 'string'
        ? error
        : error?.message ||
            detail ||
            '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      response.status,
      error?.code,
    );
  }
  return data;
}

export async function getSession() {
  let session;
  try {
    session = await api('/auth/session');
  } catch (error) {
    if (error.status !== 404) throw error;
    enableBackendAdapter();
    session = await api('/auth/session');
  }

  setSession(session);
  return session;
}

export function startDemoSession() {
  enableDemoSession();
}

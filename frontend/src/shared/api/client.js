import {
  backendApi,
  enableBackendAdapter,
  enableDemoSession,
  isDemoSessionEnabled,
  isBackendAdapterEnabled,
  acceptBackendAuthCallback,
} from './backend-adapter.js';
import { publicErrorMessage, safeErrorCode, safeErrorStatus } from './error-messages.js';
import { beginFlowEvent, finishFlowEvent, classifyFlowRequest, recordFlowEvent } from '../../features/activity-flow/events.js';

let csrfToken = '';

export function setSession(session) {
  csrfToken = session.csrf_token || '';
}

export class ApiError extends Error {
  constructor(message, status, code, context) {
    super(publicErrorMessage({ message, status, code }, context));
    this.name = 'ApiError';
    this.status = safeErrorStatus(status);
    this.code = safeErrorCode(code, this.status);
  }
}

function safeApiError(error, path) {
  if (error?.name === 'AbortError') return error;
  return new ApiError(error?.message, error?.status, error?.code, { path });
}

export async function api(path, { method = 'GET', body, signal, onProgress, keepalive } = {}) {
  try {
    if (isDemoSessionEnabled()) enableBackendAdapter();
    if (isBackendAdapterEnabled()) {
      return await backendApi(path, { method, body, signal, onProgress, keepalive }, requestApi, ApiError);
    }
    return await requestApi(path, { method, body, signal, keepalive });
  } catch (error) {
    throw safeApiError(error, path);
  }
}

async function requestApi(
  path,
  { method = 'GET', body, signal, auth = true, keepalive, accessToken, idempotencyKey } = {},
  retry = true,
) {
  const headers = { Accept: 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (!['GET', 'HEAD'].includes(method)) headers['X-CSRF-Token'] = csrfToken;
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  } else if (auth && isBackendAdapterEnabled()) {
    const token = sessionStorage.getItem('careerlens.backend.access-token');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
  const observation = beginFlowEvent(classifyFlowRequest(path), { kind: 'request', method });
  let response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(/^\/admin\/evaluation-performance(?:[/?]|$)/.test(path) ? { cache: 'no-store' } : {}),
      signal,
      keepalive,
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
  } catch (error) {
    finishFlowEvent(observation, { state: error?.name === 'AbortError' ? 'cancelled' : 'failed' });
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('', 0, 'network_error');
  }
  let data;
  try {
    data = response.status === 204 ? {} : await response.json();
  } catch (error) {
    finishFlowEvent(observation, { state: error?.name === 'AbortError' ? 'cancelled' : 'failed' });
    if (error?.name === 'AbortError') throw error;
    if (response.ok) throw new ApiError('', 502, 'invalid_response');
  }
  if (!response.ok) {
    finishFlowEvent(observation, { state: 'failed' });
    if (
      response.status === 401 &&
      retry &&
      isBackendAdapterEnabled() &&
      auth &&
      sessionStorage.getItem('careerlens.backend.refresh-token')
    ) {
      let refreshed;
      try {
        refreshed = await requestApi(
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
      } catch (error) {
        if (error?.status === 400 || error?.status === 401 || error?.status === 403)
          throw new ApiError('', 401, 'unauthorized');
        throw error;
      }
      if (typeof refreshed.access_token === 'string' && refreshed.access_token) {
        sessionStorage.setItem('careerlens.backend.access-token', refreshed.access_token);
        if (refreshed.refresh_token)
          sessionStorage.setItem('careerlens.backend.refresh-token', refreshed.refresh_token);
        recordFlowEvent('local_data');
        return requestApi(path, { method, body, signal, auth, keepalive, idempotencyKey }, false);
      }
      throw new ApiError('', 401, 'unauthorized');
    }
    // Codes select application-owned text. Remote message/detail fields are never displayed.
    throw new ApiError('', response.status, data?.error?.code, { path });
  }
  if (!data || typeof data !== 'object') {
    finishFlowEvent(observation, { state: 'failed' });
    throw new ApiError('', 502, 'invalid_response');
  }
  finishFlowEvent(observation);
  if (method === 'POST' && ((path === '/auth/signup' && typeof data.user_id === 'string') || (path === '/resumes' && typeof data.id === 'string')))
    recordFlowEvent('storage_ack', { source: 'backend', method });
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

export async function completeAuthCallback(credentials) {
  try {
    const session = await acceptBackendAuthCallback(credentials, requestApi, ApiError);
    setSession(session);
    return session;
  } catch (error) {
    throw safeApiError(error, '/auth/callback');
  }
}

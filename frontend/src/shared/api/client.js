import {
  backendApi,
  enableBackendAdapter,
  enableDemoSession,
  isDemoSessionEnabled,
  isBackendAdapterEnabled,
  acceptBackendAuthCallback,
  captureBackendSession,
  assertBackendSession,
  storeBackendCredentials,
} from './backend-adapter.js';
import { publicErrorMessage, safeErrorCode, safeErrorStatus } from './error-messages.js';
import { beginFlowEvent, finishFlowEvent, classifyFlowRequest, recordFlowEvent } from '../../features/activity-flow/events.js';

let csrfToken = '';
let refreshInFlight = null;

async function refreshSession(session) {
  assertBackendSession(session);
  if (captureBackendSession().token !== session.token) return;
  if (!refreshInFlight || refreshInFlight.generation !== session.generation) {
    const pending = { generation: session.generation };
    pending.promise = (async () => {
      let refreshed;
      try {
        refreshed = await requestApi('/auth/refresh', {
          method: 'POST', auth: false,
          body: { refresh_token: sessionStorage.getItem('careerlens.backend.refresh-token') },
        }, false);
      } catch (error) {
        assertBackendSession(session);
        throw error;
      }
      assertBackendSession(session);
      if (typeof refreshed.access_token !== 'string' || !refreshed.access_token)
        throw new ApiError('', 401, 'unauthorized');
      storeBackendCredentials(refreshed, session);
    })().finally(() => { if (refreshInFlight === pending) refreshInFlight = null; });
    refreshInFlight = pending;
  }
  await refreshInFlight.promise;
  assertBackendSession(session);
}

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
  const activeSession = isBackendAdapterEnabled() && auth ? captureBackendSession() : null;
  // A callback's candidate token must never refresh or retry with an old login.
  const ownerSession = activeSession && (!accessToken || accessToken === activeSession.token) ? activeSession : null;
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
  // A 404 here selects the compatible backend contract in getSession; it is
  // not a rejected login. Defer this one discovery request until its outcome
  // is known, so no false pending/failure reaches another observer either.
  const sessionProbe = path === '/auth/session' && method === 'GET' && !isBackendAdapterEnabled();
  const observationStarted = Date.now();
  const observation = sessionProbe || /^\/flow(?:\/|$)/.test(path) ? null : beginFlowEvent(classifyFlowRequest(path), { kind: 'request', method });
  let response;
  let probeRecorded = false;
  function finishObservation({ state = 'complete' } = {}) {
    if (!sessionProbe) return finishFlowEvent(observation, { state });
    if (probeRecorded) return;
    probeRecorded = true;
    if (response?.status !== 404) recordFlowEvent('api_session', {
      kind: 'request', method, state, durationMs: Math.max(0, Date.now() - observationStarted),
    });
  }
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
    finishObservation({ state: error?.name === 'AbortError' ? 'cancelled' : 'failed' });
    if (ownerSession) assertBackendSession(ownerSession, signal);
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('', 0, 'network_error');
  }
  let data;
  try {
    data = response.status === 204 ? {} : await response.json();
  } catch (error) {
    finishObservation({ state: error?.name === 'AbortError' ? 'cancelled' : 'failed' });
    if (error?.name === 'AbortError') throw error;
    if (response.ok) throw new ApiError('', 502, 'invalid_response');
  }
  if (ownerSession) {
    try { assertBackendSession(ownerSession, signal); }
    catch (error) { finishObservation({ state: 'cancelled' }); throw error; }
  }
  if (!response.ok) {
    finishObservation({ state: 'failed' });
    if (
      response.status === 401 &&
      retry &&
      isBackendAdapterEnabled() &&
      ownerSession &&
      sessionStorage.getItem('careerlens.backend.refresh-token')
    ) {
      try {
        await refreshSession(ownerSession);
        assertBackendSession(ownerSession, signal);
      } catch (error) {
        if (error?.status === 400 || error?.status === 401 || error?.status === 403)
          throw new ApiError('', 401, 'unauthorized');
        throw error;
      }
      return requestApi(path, { method, body, signal, auth, keepalive, idempotencyKey }, false);
    }
    // Codes select application-owned text. Remote message/detail fields are never displayed.
    throw new ApiError('', response.status, data?.error?.code, { path });
  }
  if (!data || typeof data !== 'object') {
    finishObservation({ state: 'failed' });
    throw new ApiError('', 502, 'invalid_response');
  }
  finishObservation();
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

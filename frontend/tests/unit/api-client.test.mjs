import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, getSession, ApiError, completeAuthCallback } from '../../src/shared/api/client.js';
import { enableBackendAdapter } from '../../src/shared/api/backend-adapter.js';

beforeEach(() => {
  const values = new Map();
  globalThis.sessionStorage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
});

test('API discovery handles the new backend without replacing the existing session contract', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 });
  };
  try {
    const session = await getSession();
    assert.equal(session.user, null);
    assert.deepEqual(calls, ['/api/v1/auth/session', '/api/v1/local-guest/capabilities']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cancellation retains keepalive after a token refresh', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'expired-fixture');
  sessionStorage.setItem('careerlens.backend.refresh-token', 'refresh-fixture');
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/v1/auth/refresh') {
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({ access_token: 'renewed-fixture', refresh_token: 'next-fixture' });
    }
    if (calls.length === 1) return Response.json({ detail: 'Expired' }, { status: 401 });
    return Response.json({ status: 'cancelled' });
  };
  try {
    const result = await api('/evaluations/run-1/cancel', {
      method: 'POST',
      body: {},
      keepalive: true,
    });
    assert.equal(result.status, 'cancelled');
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.keepalive, true);
    assert.equal(calls[2].options.keepalive, true);
    assert.equal(calls[2].options.headers.Authorization, 'Bearer renewed-fixture');
    assert.equal(sessionStorage.getItem('careerlens.backend.refresh-token'), 'next-fixture');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const PRIVATE_DETAIL = 'Traceback: /srv/private/service.py postgres://user:secret@db ERROR sk-test-private-key';

async function withFetch(mock, check) {
  enableBackendAdapter();
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await check(); } finally { globalThis.fetch = original; }
}

function assertSafe(error, status) {
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, status);
  assert.doesNotMatch(error.message, /Traceback|private|postgres|secret|sk-test|실행 창/);
  assert.doesNotMatch(error.code, /private|secret|sk-test/);
  assert.match(error.message, /주세요|없습니다/);
  return true;
}

test('untrusted JSON details, validation arrays and HTML errors never reach the UI', async () => {
  for (const [status, body] of [
    [400, { error: PRIVATE_DETAIL }],
    [401, { detail: PRIVATE_DETAIL }],
    [403, { error: { code: PRIVATE_DETAIL, message: PRIVATE_DETAIL } }],
    [404, null],
    [409, { detail: { exception: PRIVATE_DETAIL } }],
    [413, { error: { message: PRIVATE_DETAIL } }],
    [422, { detail: [{ msg: PRIVATE_DETAIL, loc: ['private'], input: PRIVATE_DETAIL }] }],
    [429, { detail: PRIVATE_DETAIL }],
    [500, { error: { code: 'evaluation_failed', message: PRIVATE_DETAIL } }],
    [502, `<html>${PRIVATE_DETAIL}</html>`],
    [503, PRIVATE_DETAIL],
    [504, { detail: PRIVATE_DETAIL }],
  ]) {
    await withFetch(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
      () => assert.rejects(api('/evaluations/fixture/cancel', { method: 'POST' }), (error) => assertSafe(error, status)));
  }
});

test('malformed successful JSON is a safe invalid-response error while empty 204 succeeds', async () => {
  for (const body of ['<html>private stack</html>', 'null', '"private string"', 'false']) {
    await withFetch(async () => new Response(body),
      () => assert.rejects(api('/evaluations/fixture/cancel', { method: 'POST' }),
        (error) => assertSafe(error, 502) && error.code === 'invalid_response'));
  }
  await withFetch(async () => new Response(null, { status: 204 }), async () => {
    assert.deepEqual(await api('/evaluations/fixture/cancel', { method: 'POST' }), {});
  });
});

test('network errors are actionable on a deployed site and cancellation retains its identity', async () => {
  await withFetch(async () => { throw new TypeError(PRIVATE_DETAIL); },
    () => assert.rejects(api('/evaluations/fixture/cancel', { method: 'POST' }),
      (error) => assertSafe(error, 0) && /인터넷 연결/.test(error.message)));
  const abort = new DOMException('cancelled', 'AbortError');
  await withFetch(async () => { throw abort; },
    () => assert.rejects(api('/evaluations/fixture/cancel', { method: 'POST' }), (error) => error === abort));
  await withFetch(async () => ({ ok: true, status: 200, json: async () => { throw abort; } }),
    () => assert.rejects(api('/evaluations/fixture/cancel', { method: 'POST' }), (error) => error === abort));
});

test('failed token refresh stops retries and keeps an actionable 401', async () => {
  sessionStorage.setItem('careerlens.backend.refresh-token', 'synthetic-refresh');
  const calls = [];
  await withFetch(async (url) => {
    calls.push(url);
    return Response.json({ detail: PRIVATE_DETAIL }, { status: url.endsWith('/refresh') ? 400 : 401 });
  }, () => assert.rejects(api('/evaluations/fixture/cancel', { method: 'POST' }),
    (error) => assertSafe(error, 401) && /다시 로그인/.test(error.message)));
  assert.deepEqual(calls, ['/api/v1/evaluations/fixture/cancel', '/api/v1/auth/refresh']);
});

test('auth failures do not distinguish unknown accounts, duplicate signup or credentials', async () => {
  const messages = [];
  for (const [path, status] of [['/auth/login', 401], ['/auth/register', 409], ['/auth/register', 400]]) {
    await withFetch(async () => Response.json({ detail: PRIVATE_DETAIL }, { status }), async () => {
      await assert.rejects(api(path, { method: 'POST', body: { email: 'fixture@example.test', password: 'fixture' } }),
        (error) => { assertSafe(error, status); messages.push(error.message); return true; });
    });
  }
  assert.equal(new Set(messages).size, 1);
});

test('unknown callback and adapter exceptions are normalized without changing AbortError', async () => {
  await withFetch(async () => Response.json({ user_id: 'synthetic-member' }), async () => {
    sessionStorage.setItem = () => { throw new Error(PRIVATE_DETAIL); };
    await assert.rejects(completeAuthCallback({ accessToken: 'fixture', refreshToken: 'fixture' }),
      (error) => assertSafe(error, 0));
  });
  await assert.rejects(api('/account/reports/%E0%A4%A', { method: 'GET' }),
    (error) => assertSafe(error, error.status));
});

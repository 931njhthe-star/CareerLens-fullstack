import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getSession } from '../../src/shared/api/client.js';
import { flowSnapshot } from '../../src/features/activity-flow/events.js';

beforeEach(() => {
  const values = new Map();
  globalThis.sessionStorage = {
    get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key),
  };
});

const newSessionRows = (before) => flowSnapshot().events.filter((event) => event.node === 'api_session' && !before.has(event.id));
const eventIds = () => new Set(flowSnapshot().events.map(({ id }) => id));

test('native session discovery retains real success, HTTP failures, malformed responses, network errors and cancellation', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const scenario of [
      { response: () => Response.json({ user: null }), state: 'complete' },
      ...[401, 500, 503].map((status) => ({ response: () => Response.json({ detail: 'synthetic failure' }, { status }), state: 'failed' })),
      { response: () => new Response('<html>invalid session</html>'), state: 'failed' },
      { response: () => { throw new TypeError('synthetic offline'); }, state: 'failed' },
      { response: () => { throw new DOMException('synthetic cancellation', 'AbortError'); }, state: 'cancelled' },
    ]) {
      const before = eventIds();
      globalThis.fetch = async (path) => {
        assert.equal(path, '/api/v1/auth/session');
        assert.equal(newSessionRows(before).length, 0, 'a discovery probe does not emit a misleading pending session request');
        return scenario.response();
      };
      if (scenario.state === 'complete') assert.equal((await getSession()).user, null);
      else await assert.rejects(getSession());
      const rows = newSessionRows(before);
      assert.equal(rows.length, 1, 'malformed HTTP errors cannot create duplicate failure rows');
      assert.equal(rows[0].state, scenario.state);
      assert.equal(rows[0].kind, 'request');
      assert.equal(rows[0].method, 'GET');
      assert.ok(rows[0].durationMs >= 0);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('unsupported discovery 404 is excluded while the successful authenticated fallback is measured', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'synthetic-member');
  const originalFetch = globalThis.fetch;
  const calls = [], before = eventIds();
  globalThis.fetch = async (path) => {
    calls.push(path);
    if (path === '/api/v1/auth/session') return new Response('<html>not supported</html>', { status: 404 });
    if (path === '/api/v1/local-guest/capabilities') return Response.json({ available: false, storage_origin: 'frontend_guest' });
    if (path === '/api/v1/me') return Response.json({ user_id: 'synthetic-member', is_admin: false });
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    const session = await getSession();
    assert.equal(session.user.id, 'synthetic-member');
    assert.equal(session.user.is_admin, false);
    assert.ok(calls.includes('/api/v1/auth/session') && calls.includes('/api/v1/me'));
    assert.deepEqual(newSessionRows(before).map(({ state }) => state), ['complete']);
  } finally { globalThis.fetch = originalFetch; }
});

test('a genuine adapted member session 404 remains an observable failure', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'synthetic-member');
  const originalFetch = globalThis.fetch, before = eventIds();
  globalThis.fetch = async (path) => path === '/api/v1/local-guest/capabilities'
    ? Response.json({ available: false, storage_origin: 'frontend_guest' })
    : Response.json({ detail: 'Missing member endpoint' }, { status: 404 });
  try {
    await assert.rejects(getSession(), (error) => error.status === 404);
    const rows = newSessionRows(before);
    assert.ok(rows.length > 0);
    assert.ok(rows.every(({ state }) => state === 'failed'));
  } finally { globalThis.fetch = originalFetch; }
});

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../../src/shared/api/client.js';
import { enableBackendAdapter } from '../../src/shared/api/backend-adapter.js';
import { flowSnapshot } from '../../src/features/activity-flow/events.js';

beforeEach(() => {
  const values = new Map();
  globalThis.sessionStorage = {
    get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key),
  };
  enableBackendAdapter();
});

const latest = (node) => flowSnapshot().states.find((event) => event.node === node);
function observations() {
  const seen = new Set(flowSnapshot().events.map((event) => event.id));
  return () => flowSnapshot().events.filter((event) => !seen.has(event.id));
}
async function withFetch(mock, check) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await check(); } finally { globalThis.fetch = original; }
}

test('an actual API request is pending until its body is read, then finishes the same observation', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'ordinary-member');
  let releaseBody;
  const body = new Promise((resolve) => { releaseBody = resolve; });
  const observed = observations();
  await withFetch(async () => ({ ok: true, status: 200, json: () => body }), async () => {
    const request = api('/admin/evaluation-performance?days=1');
    await Promise.resolve();
    const pending = latest('api_dashboard');
    assert.equal(pending.state, 'pending');
    assert.equal(pending.method, 'GET');
    releaseBody({ runs: [] });
    await request;
    const complete = latest('api_dashboard');
    assert.equal(complete.id, pending.id);
    assert.equal(complete.state, 'complete');
    assert.ok(complete.durationMs >= 0);
    assert.deepEqual(observed().map(({ node }) => node), ['api_dashboard']);
  });
});

test('central telemetry transport does not recursively record its own requests', async () => {
  const observed = observations();
  await withFetch(async () => Response.json({ items: [] }), async () => {
    await api('/flow/events', { method: 'POST', body: { batch: [] } });
    sessionStorage.setItem('careerlens.backend.access-token', 'ordinary-member');
    await api('/flow/sources?limit=100');
    await api('/flow/events?cursor=0&limit=200');
  });
  assert.deepEqual(observed(), []);
});

for (const [label, transport, expected] of [
  ['HTTP rejection', async () => Response.json({ detail: 'PRIVATE_ERROR' }, { status: 503 }), 'failed'],
  ['network failure', async () => { throw new TypeError('PRIVATE_NETWORK'); }, 'failed'],
  ['invalid response', async () => new Response('<html>PRIVATE_BODY</html>'), 'failed'],
  ['aborted request', async () => { throw new DOMException('PRIVATE_ABORT', 'AbortError'); }, 'cancelled'],
  ['aborted body read', async () => ({ ok: true, status: 200, json: async () => { throw new DOMException('PRIVATE_ABORT', 'AbortError'); } }), 'cancelled'],
]) {
  test(`${label} closes the request observation without claiming successful cancellation`, async () => {
    const observed = observations();
    await withFetch(transport, async () => {
      await assert.rejects(api('/evaluations/PRIVATE_RUN/cancel', { method: 'POST', body: { private: 'PRIVATE_BODY' } }));
    });
    const events = observed();
    assert.equal(events.length, 1);
    assert.equal(events[0].node, 'api_cancel');
    assert.equal(events[0].state, expected);
    assert.ok(events[0].durationMs >= 0);
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE|detail|body|url/);
    assert.equal(events.some(({ node }) => node === 'analysis' || node === 'database'), false);
  });
}

test('expired-token retry records the failed request, session refresh, and successful retry separately', async () => {
  sessionStorage.setItem('careerlens.backend.access-token', 'expired-fixture');
  sessionStorage.setItem('careerlens.backend.refresh-token', 'refresh-fixture');
  const observed = observations();
  let cancellations = 0;
  await withFetch(async (url) => {
    if (url === '/api/v1/auth/refresh') return Response.json({ access_token: 'new-fixture' });
    assert.equal(url, '/api/v1/evaluations/PRIVATE_RUN/cancel');
    return ++cancellations === 1 ? Response.json({}, { status: 401 }) : Response.json({ cancelled: true });
  }, () => api('/evaluations/PRIVATE_RUN/cancel', { method: 'POST', keepalive: true }));
  assert.deepEqual(observed().filter(({ kind }) => kind === 'request').map(({ node, state }) => [node, state]), [
    ['api_cancel', 'failed'], ['api_session', 'complete'], ['api_cancel', 'complete'],
  ]);
  assert.equal(latest('api_cancel').state, 'complete');
  assert.doesNotMatch(JSON.stringify(observed()), /PRIVATE|fixture|token/);
});

test('receiving an HTTP response never invents a completed report or server persistence event', async () => {
  const observed = observations();
  await withFetch(async () => Response.json({ cancelled: true }),
    () => api('/evaluations/PRIVATE_RUN/cancel', { method: 'POST' }));
  assert.deepEqual(observed().map(({ node, state }) => [node, state]), [['api_cancel', 'complete']]);
});

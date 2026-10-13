import test from 'node:test';
import assert from 'node:assert/strict';
import { mountAdminDashboard } from '../../src/pages/admin-dashboard.js';
import { api } from '../../src/shared/api/client.js';
import { enableBackendAdapter } from '../../src/shared/api/backend-adapter.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const summary = (ids = ['run-a', 'run-b']) => ({
  summary: {}, stages: [], runs: ids.map((id) => ({
    id, status: 'completed', created_at: new Date(Date.now()).toISOString(),
  })),
  generated_at: '2026-10-12T10:00:00Z',
});
function harness() {
  const handlers = new Map(), windowHandlers = new Map(), documentHandlers = new Map();
  const content = { innerHTML: '', setAttribute() {} };
  const announcement = { textContent: '' };
  const refresh = {};
  let timer, cleared = false;
  const windowObject = {
    document: {
      visibilityState: 'visible',
      addEventListener: (name, fn) => documentHandlers.set(name, fn),
      removeEventListener: (name) => documentHandlers.delete(name),
    },
    addEventListener: (name, fn) => windowHandlers.set(name, fn),
    removeEventListener: (name) => windowHandlers.delete(name),
    setInterval: (fn) => { timer = fn; return 1; },
    clearInterval: () => { cleared = true; },
  };
  const root = {
    matches: () => true,
    querySelector: (selector) => ({
      '[data-admin-content]': content, '[data-admin-announcement]': announcement,
      '[data-admin-refresh]': refresh,
    })[selector],
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name) => handlers.delete(name),
  };
  const click = (selector, dataset = {}) => handlers.get('click')?.({ target: {
    closest: (query) => query === selector ? { dataset } : null,
  } });
  return { root, content, announcement, windowObject, windowHandlers, documentHandlers, click,
    poll: () => timer(), cleared: () => cleared };
}

test('selected detail responses cannot cross selections, close, or disposal', async () => {
  const h = harness(), pending = [];
  const cleanup = mountAdminDashboard(h.root, { window: h.windowObject, api: async (path, options) => {
    if (path.startsWith('/evaluations?')) return summary();
    return new Promise((resolve) => pending.push({ path, resolve, signal: options.signal }));
  } });
  await tick();
  h.click('[data-admin-row]', { adminRow: '0' });
  h.click('[data-admin-row]', { adminRow: '1' });
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ run: { id: 'run-b', status: 'completed', reproduction: { model: 'current-model' } } });
  await tick();
  pending[0].resolve({ run: { id: 'run-a', reproduction: { model: 'obsolete-model' } } });
  await tick();
  assert.match(h.content.innerHTML, /current-model/);
  assert.doesNotMatch(h.content.innerHTML, /obsolete-model/);
  h.click('[data-admin-row]', { adminRow: '0' });
  h.click('[data-admin-close]');
  pending[2].resolve({ run: { id: 'run-a', reproduction: { model: 'closed-model' } } });
  await tick();
  assert.doesNotMatch(h.content.innerHTML, /closed-model/);
  cleanup();
  assert.equal(h.cleared(), true);
  assert.equal(h.windowHandlers.size + h.documentHandlers.size, 0);
});

test('missing detail refreshes the summary so deleted executions disappear', async () => {
  const h = harness();
  let count = 0;
  const cleanup = mountAdminDashboard(h.root, { window: h.windowObject, api: async (path) => {
    if (path.startsWith('/evaluations?')) return ++count === 1 ? summary() : summary(['run-b']);
    throw { status: 404 };
  } });
  await tick();
  h.click('[data-admin-row]', { adminRow: '0' });
  await tick();
  assert.equal(count, 2);
  assert.doesNotMatch(h.content.innerHTML, />run-a</);
  assert.match(h.content.innerHTML, /run-b/);
  cleanup();
});

test('visible periodic/focus refresh updates totals and stops while hidden or disposed', async () => {
  const h = harness();
  const originalNow = Date.now;
  let now = 100000, count = 0;
  Date.now = () => now;
  try {
    const cleanup = mountAdminDashboard(h.root, { window: h.windowObject, api: async () => {
      count++;
      return count === 1 ? summary() : summary(['run-b']);
    } });
    await tick();
    now += 60000;
    h.windowObject.document.visibilityState = 'hidden';
    h.poll();
    assert.equal(count, 1);
    h.windowObject.document.visibilityState = 'visible';
    h.documentHandlers.get('visibilitychange')();
    await tick();
    assert.equal(count, 2);
    assert.doesNotMatch(h.content.innerHTML, />run-a</);
    h.windowHandlers.get('focus')();
    assert.equal(count, 2);
    cleanup();
    now += 60000;
    h.poll();
    assert.equal(count, 2);
  } finally { Date.now = originalNow; }
});

test('an older server without detail support does not make an existing run look deleted', async () => {
  const h = harness();
  const cleanup = mountAdminDashboard(h.root, { window: h.windowObject, api: async (path) => {
    if (path.startsWith('/evaluations?')) return summary();
    throw { status: 404 };
  } });
  await tick();
  h.click('[data-admin-row]', { adminRow: '0' });
  await tick();
  assert.match(h.content.innerHTML, />run-a</);
  assert.match(h.content.innerHTML, /서버가 최신 버전인지 확인/);
  assert.match(h.content.innerHTML, /data-admin-detail-retry/);
  cleanup();
});

test('dashboard summary and detail use existing authenticated database routes without browser cache', async () => {
  const originalFetch = globalThis.fetch, originalStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: (key) => key.endsWith('access-token') ? 'private-fixture' : null };
  enableBackendAdapter();
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({}); };
  try {
    await api('/evaluations?limit=100&offset=0');
    await api('/evaluations/11111111-1111-4111-8111-111111111111');
    assert.equal(calls.length, 2);
    for (const { options } of calls) {
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers.Authorization, 'Bearer private-fixture');
    }
  } finally { globalThis.fetch = originalFetch; globalThis.sessionStorage = originalStorage; }
});

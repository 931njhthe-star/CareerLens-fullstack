import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanFlowEnvelope, createFlowPublisher, createCentralFlowMonitor } from '../../src/features/activity-flow/central-transport.js';
import { createLiveFlowSources } from '../../src/features/activity-flow/live-sources.js';

const event = (id = 'event-1', state = 'pending', node = 'api_jobs') => ({ id, node, state, kind: 'request', source: 'observed', at: 100, durationMs: null, progress: null, method: 'GET' });
const envelope = (publisher, revision = 1, value = event()) => ({ kind: 'event', stream: publisher, publisher: `browser:${publisher}`, revision, event: value, active: true });
function clock() {
  const scheduled = new Map(); let id = 0;
  return { scheduled, schedule: (fn, delay) => { scheduled.set(++id, { fn, delay }); return id; }, unschedule: (key) => scheduled.delete(key) };
}

test('remote publication strips document, URL, tokens and arbitrary session values', () => {
  const clean = cleanFlowEnvelope({ kind: 'event', revision: 1, event: { ...event(), token: 'SECRET', text: 'PRIVATE', url: '/resume' }, bearer: 'SECRET', active: true });
  assert.deepEqual(clean, { kind: 'event', revision: 1, active: true, event: event() });
  assert.equal(cleanFlowEnvelope({ kind: 'active', revision: 2 }), null);
  const snapshot = cleanFlowEnvelope({ kind: 'snapshot', revision: 2, states: [event()], events: [event()], session: { mode: 'admin', email: 'private@sample.test' } });
  assert.deepEqual(snapshot.session, { mode: 'guest' });
  assert.doesNotMatch(JSON.stringify(snapshot), /email|private|admin/);
});

test('demo session snapshots and demo events are never uploaded as observed guest traffic', () => {
  assert.equal(cleanFlowEnvelope({ kind: 'event', revision: 1, event: { ...event(), source: 'demo' } }), null);
  assert.equal(cleanFlowEnvelope({ kind: 'snapshot', revision: 2, events: [event()], states: [event()], session: { mode: 'demo' } }), null);
  const real = cleanFlowEnvelope({ kind: 'snapshot', revision: 3, events: [{ ...event(), source: 'demo' }, event('event-2')], states: [], session: { mode: 'guest' } });
  assert.deepEqual(real.events.map((row) => row.id), ['event-2']);
});

test('healthy paginated initialization can exceed fifteen seconds overall while each request remains bounded', async () => {
  const scheduled = new Map(); let next = 0, elapsed = 0, requests = 0;
  const monitor = createCentralFlowMonitor({
    schedule(fn, delay) { scheduled.set(++next, { fn, delay, at: elapsed + delay }); return next; },
    unschedule(id) { scheduled.delete(id); },
    request: async (path, { signal }) => {
      elapsed += 10000; requests++;
      for (const [id, item] of [...scheduled]) if (item.delay === 15000 && item.at <= elapsed) { scheduled.delete(id); item.fn(); }
      if (signal.aborted) throw new DOMException('deadline', 'AbortError');
      if (path.startsWith('/flow/sources')) {
        const offset = Number(new URL(path, 'https://sample.test').searchParams.get('offset'));
        return { sources: [{ ...envelope(`source-${String(offset).padStart(8, '0')}`), kind: 'snapshot', events: [], states: [] }], has_more: offset < 2, total: 3, cursor: '10-0', scope: 'shared' };
      }
      return { events: [], cursor: '10-0', scope: 'shared' };
    },
  });
  monitor.start(); await monitor.poll();
  assert.equal(requests, 4); assert.equal(elapsed, 40000);
  assert.equal(monitor.status().state, 'connected');
  monitor.dispose(); assert.equal(scheduled.size, 0);
});

test('two independent browsers publish ordered simultaneous lifecycles without sharing credentials or source state', async () => {
  const posts = [], timing = clock();
  const request = async (path, options) => { posts.push({ path, body: options.body }); return { available: true, accepted: options.body.batch.length }; };
  const a = createFlowPublisher({ stream: 'stream-a-1234', publisher: 'publisher-a-1234', request, ...timing });
  const b = createFlowPublisher({ stream: 'stream-b-1234', publisher: 'publisher-b-1234', request, ...timing });
  a.enqueue({ kind: 'event', revision: 1, event: event() });
  b.enqueue({ kind: 'event', revision: 1, event: event('event-1', 'pending', 'api_resume') });
  await Promise.all([a.flush(), b.flush()]);
  a.enqueue({ kind: 'event', revision: 2, event: event('event-1', 'complete') });
  b.enqueue({ kind: 'event', revision: 2, event: event('event-1', 'failed', 'api_resume') });
  await Promise.all([a.flush(), b.flush()]);
  assert.equal(posts.length, 4);
  assert.deepEqual(posts.filter((row) => row.body.publisher === 'publisher-a-1234').flatMap((row) => row.body.batch.map((item) => item.event.state)), ['pending', 'complete']);
  assert.deepEqual(posts.filter((row) => row.body.publisher === 'publisher-b-1234').flatMap((row) => row.body.batch.map((item) => item.event.state)), ['pending', 'failed']);
  a.dispose(); b.dispose(); assert.equal(timing.scheduled.size, 0);
});

test('publisher retries an uncertain response with the same revision and bounds outage backlog', async () => {
  const timing = clock(), posts = []; let fail = true;
  const publisher = createFlowPublisher({ stream: 'stream-a-1234', publisher: 'publisher-a-1234', capacity: 25, ...timing,
    request: async (_path, options) => { posts.push(structuredClone(options.body)); if (fail) throw new Error('offline'); return { available: true }; } });
  for (let i = 0; i < 26; i++) publisher.enqueue({ kind: 'event', revision: i, event: event(`event-${i}`) });
  assert.deepEqual(publisher.status(), { queued: 25, dropped: 1 });
  await publisher.flush(); assert.equal(publisher.status().queued, 25);
  fail = false; await publisher.flush();
  assert.deepEqual(posts[0], posts[1]);
  assert.equal(publisher.status().queued, 0);
  publisher.dispose();
});

test('queued full snapshots are split below keepalive body limits instead of retrying oversized batches forever', async () => {
  const timing = clock(), sizes = [];
  const publisher = createFlowPublisher({ stream: 'stream-a-1234', publisher: 'publisher-a-1234', ...timing,
    request: async (_path, options) => { sizes.push(new TextEncoder().encode(JSON.stringify(options.body)).length); return { available: true }; } });
  for (let i = 1; i <= 25; i++) publisher.enqueue({ kind: 'snapshot', revision: i,
    events: Array.from({ length: 100 }, (_, n) => event(`event-${n}`)), states: [event()], session: { mode: 'member' } });
  while (publisher.status().queued) await publisher.flush({ keepalive: true });
  assert.ok(sizes.length > 1);
  assert.ok(sizes.every((size) => size < 65536));
  publisher.dispose();
});

test('a hanging collection request aborts on deadline and enters bounded reconnect backoff', async () => {
  const timing = clock(), states = [];
  const monitor = createCentralFlowMonitor({ ...timing, onStatus: (value) => states.push(value), request: (_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true });
  }) });
  monitor.start();
  const operation = monitor.poll();
  const deadline = [...timing.scheduled.values()].find((item) => item.delay === 15000);
  assert.ok(deadline); deadline.fn(); await operation;
  assert.equal(states.at(-1).state, 'retrying');
  monitor.dispose(); assert.equal(timing.scheduled.size, 0);
});

test('central cursor observes two other browsers while pinned cards stay isolated; initial records do not replay', async () => {
  const timing = clock(), ledger = createLiveFlowSources({ central: true, limit: 5000 }), incoming = [], statuses = [], paths = [];
  const a = envelope('source-a-1234'), b = envelope('source-b-1234', 1, event('event-1', 'pending', 'api_resume'));
  let page = 0;
  const monitor = createCentralFlowMonitor({ ...timing,
    request: async (path) => {
      paths.push(path);
      if (path.startsWith('/flow/sources')) return { sources: [{ ...a, kind: 'snapshot', events: [a.event], states: [a.event], session: { mode: 'member' } }], cursor: '10-0', total: 2, scope: 'shared' };
      page++;
      return { events: page === 1 ? [{ id: '11-0', envelope: b }] : [{ id: '12-0', envelope: { ...b, revision: 2, event: { ...b.event, state: 'complete', at: 101 } } }], cursor: page === 1 ? '11-0' : '12-0', scope: 'shared' };
    },
    onEnvelope(value, metadata) { incoming.push({ value, metadata }); ledger.receive(value); },
    onStatus: (status) => statuses.push(status),
  });
  monitor.start(); await monitor.poll();
  assert.equal(incoming[0].metadata.snapshot, true);
  assert.equal(incoming[1].metadata.snapshot, false);
  assert.equal(ledger.options().length, 2);
  ledger.select(a.publisher);
  await monitor.poll();
  assert.equal(ledger.snapshot().key, a.publisher);
  assert.equal(ledger.snapshot().states.find((item) => item.node === 'api_jobs').state, 'pending');
  assert.equal(incoming.at(-1).value.publisher, b.publisher, 'unselected source remains in global feed');
  assert.ok(paths.includes('/flow/events?cursor=11-0&limit=200'));
  assert.equal(statuses.at(-1).scope, 'shared');
  monitor.dispose(); assert.equal(timing.scheduled.size, 0);
});

test('snapshot pagination keeps more than sixteen sources and gap reinitialization is explicit', async () => {
  const timing = clock(), ledger = createLiveFlowSources({ central: true, limit: 5000 });
  let eventCalls = 0, resets = 0;
  const statuses = [];
  const monitor = createCentralFlowMonitor({ ...timing, request: async (path) => {
    if (path.startsWith('/flow/sources')) {
      const offset = Number(new URL(path, 'https://sample.test').searchParams.get('offset'));
      return { sources: Array.from({ length: offset === 0 ? 100 : 20 }, (_, index) => {
        const value = envelope(`source-${String(offset + index).padStart(8, '0')}`);
        return { ...value, kind: 'snapshot', events: [value.event], states: [value.event] };
      }), total: 120, has_more: offset === 0, cursor: '100-0', scope: 'shared' };
    }
    return { events: [], cursor: '101-0', gap: ++eventCalls === 1, scope: 'shared' };
  }, onEnvelope: (value) => ledger.receive(value), onReset() { resets++; ledger.clear(); }, onStatus: (value) => statuses.push(value) });
  monitor.start(); await monitor.poll();
  assert.equal(ledger.options().length, 120); assert.equal(ledger.evicted(), 0);
  assert.equal(statuses.at(-1).state, 'resyncing'); assert.equal(statuses.at(-1).gaps, 1);
  await monitor.poll(); assert.equal(resets, 2); assert.equal(statuses.at(-1).state, 'connected');
  monitor.dispose();
});

test('expired viewer authentication stops polling; dispose aborts in-flight work and suppresses late data', async () => {
  const timing = clock(), states = [];
  const monitor = createCentralFlowMonitor({ ...timing, request: async () => { throw Object.assign(new Error('expired'), { status: 401 }); }, onStatus: (status) => states.push(status.state) });
  monitor.start(); await monitor.poll(); assert.equal(states.at(-1), 'unauthorized');
  monitor.dispose(); assert.equal(timing.scheduled.size, 0);
  let resolve, signal, calls = 0;
  const pending = createCentralFlowMonitor({ ...clock(), request: (_path, options) => { signal = options.signal; return new Promise((done) => { resolve = done; }); }, onEnvelope: () => calls++ });
  pending.start(); const operation = pending.poll(); pending.dispose();
  assert.equal(signal.aborted, true);
  resolve({ sources: [envelope('source-a-1234')], cursor: '1-0', total: 1 }); await operation;
  assert.equal(calls, 0);
});

test('process-only service and connection errors cannot masquerade as shared monitoring', async () => {
  const states = [], timing = clock(); let fail = false;
  const monitor = createCentralFlowMonitor({ ...timing, onStatus: (value) => states.push(value), request: async (path) => {
    if (fail) throw new Error('network');
    return path.startsWith('/flow/sources') ? { sources: [], cursor: '0', total: 0, scope: 'process' } : { events: [], cursor: '0', scope: 'process' };
  } });
  monitor.start(); await monitor.poll(); assert.equal(states.at(-1).scope, 'process');
  fail = true; await monitor.poll(); assert.equal(states.at(-1).state, 'retrying');
  monitor.dispose();
});

test('live worker terminal events clear unfinished stages immediately and trusted source namespaces establish mode', () => {
  const ledger = createLiveFlowSources({ central: true, now: () => 2000 });
  const publisher = 'worker:worker-a-1234', stream = 'worker-a-1234';
  ledger.receive({ publisher, stream, kind: 'event', revision: 1, at: 1000,
    event: { ...event('server-1', 'running', 'parse_resume'), kind: 'progress', source: 'backend' } });
  assert.equal(ledger.snapshot().session.mode, 'member');
  ledger.receive({ publisher, stream, kind: 'event', revision: 2, at: 1001,
    event: { ...event('server-2', 'cancelled', 'analysis'), at: 101, kind: 'progress', source: 'backend' } });
  assert.deepEqual(ledger.snapshot().states.map((row) => [row.node, row.state]), [['analysis', 'cancelled']]);
  assert.equal(ledger.snapshot().events.find((row) => row.node === 'parse_resume').state, 'running', 'history remains last observed, not fabricated completion');
  ledger.receive({ publisher: 'guest:guest-a-1234', stream: 'guest-a-1234', kind: 'event', revision: 1, at: 1002,
    event: { ...event('server-1', 'running', 'analysis'), source: 'backend', execution: 'guest', kind: 'progress' } });
  ledger.select('guest:guest-a-1234');
  assert.equal(ledger.snapshot().session.mode, 'guest');
});

test('server receipt order prevents a future-clock browser from blocking other users or later lifecycle completion', () => {
  const ledger = createLiveFlowSources({ central: true, now: () => 5000 });
  ledger.receive({ ...envelope('source-a-1234', 1, { ...event(), kind: 'action', node: 'posting', at: 9000000 }), at: 1000 });
  ledger.receive({ ...envelope('source-b-1234', 1, { ...event(), kind: 'action', node: 'posting', at: 100 }), at: 1001 });
  assert.equal(ledger.snapshot().key, 'browser:source-b-1234');
  ledger.receive({ ...envelope('source-b-1234', 2, { ...event('event-2'), at: 9000000 }), at: 1002 });
  ledger.receive({ ...envelope('source-b-1234', 3, { ...event('event-2', 'complete'), at: 10 }), at: 1003 });
  assert.equal(ledger.snapshot().states.find((row) => row.node === 'api_jobs').state, 'complete');
});

test('heartbeat and disconnect synchronization never inflate the received event count', async () => {
  const timing = clock(), statuses = [], received = [];
  const source = envelope('source-a-1234');
  let count = 0;
  const monitor = createCentralFlowMonitor({ ...timing,
    request: async (path) => path.startsWith('/flow/sources') ? { sources: [], total: 0, cursor: '0', scope: 'shared' }
      : { events: ++count === 1 ? [{ id: '1', envelope: source }] : [
        { id: '2', envelope: { ...source, revision: 2, kind: 'snapshot', events: [source.event], states: [source.event] } },
        { id: '3', envelope: { ...source, revision: 3, kind: 'disconnected' } },
      ], cursor: String(count), scope: 'shared' },
    onEnvelope: (value) => received.push(value.kind), onStatus: (value) => statuses.push(value),
  });
  monitor.start(); await monitor.poll(); await monitor.poll();
  assert.deepEqual(received, ['event', 'snapshot', 'disconnected']);
  assert.equal(statuses.at(-1).received, 1);
  monitor.dispose();
});

test('hidden and offline catch-up pages update records without replaying lights, then fresh traffic resumes animation', async () => {
  const timing = clock(), records = [];
  let page = 0, offline = false;
  const monitor = createCentralFlowMonitor({ ...timing,
    request: async (path) => {
      if (path.startsWith('/flow/sources')) return { sources: [], total: 0, cursor: '0', scope: 'shared' };
      if (offline) throw new Error('offline');
      page++;
      return { events: [{ id: String(page), envelope: envelope('source-a-1234', page, event(`event-${page}`)) }], cursor: String(page), has_more: page === 2, scope: 'shared' };
    },
    onEnvelope: (value, metadata) => records.push({ value, metadata }),
  });
  monitor.start(); await monitor.poll();
  assert.equal(records.at(-1).metadata.snapshot, false, 'new initial live event may animate');
  monitor.pause(); monitor.start();
  await monitor.poll(); await monitor.poll();
  assert.deepEqual(records.slice(-2).map((row) => row.metadata.snapshot), [true, true], 'all resumed cursor pages are historical synchronization');
  await monitor.poll(); assert.equal(records.at(-1).metadata.snapshot, false);
  offline = true; await monitor.poll();
  offline = false; await monitor.poll(); assert.equal(records.at(-1).metadata.snapshot, true, 'reconnected backlog does not replay');
  await monitor.poll(); assert.equal(records.at(-1).metadata.snapshot, false);
  assert.equal(monitor.status().received, 6, 'catch-up records remain visible and counted');
  monitor.dispose();
});

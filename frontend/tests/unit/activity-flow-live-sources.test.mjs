import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveFlowSources } from '../../src/features/activity-flow/live-sources.js';

const first = { stream: 'stream-first', publisher: 'publisher-first' };
const second = { stream: 'stream-second', publisher: 'publisher-second' };
const event = (node, state, at, extras = {}) => ({ id: `event-${at}`, node, state, at,
  kind: 'action', source: 'observed', durationMs: null, progress: null, ...extras });
const message = (source, value, active = false) => ({ ...source, kind: 'event', event: value, active });
const snapshot = (source, events = [], mode = 'guest', states = events) => ({ ...source, kind: 'snapshot', events, states, session: { mode } });

test('three strict window pairs never follow or retain another pair, including overlapping login and analysis', () => {
  const sources = [first, second, { stream: 'stream-third', publisher: 'publisher-third' }];
  const viewers = sources.map((source) => createLiveFlowSources({ paired: true, initialStream: source.stream }));
  for (const source of sources) for (const viewer of viewers) viewer.receive(snapshot(source));
  sources.forEach((source, index) => {
    for (const viewer of viewers) viewer.receive(message(source, event(index === 1 ? 'auth' : 'analysis', 'running', index + 1,
      index === 1 ? { kind: 'session', sessionMode: 'member' } : { kind: 'progress', source: 'backend', progress: index + 10 }), true));
  });
  viewers.forEach((viewer, index) => {
    assert.equal(viewer.options().length, 1);
    assert.equal(viewer.snapshot().key, sources[index].publisher);
    assert.equal(viewer.snapshot().events.length, 1);
    assert.equal(viewer.snapshot().events[0].at, index + 1);
  });
});

test('a strict pair stops on close and resumes only its explicitly departed stream replacement', () => {
  const viewer = createLiveFlowSources({ paired: true, initialStream: first.stream });
  viewer.receive(snapshot(first, [event('report', 'complete', 1)], 'member'));
  const replacement = { ...first, publisher: 'publisher-reloaded' };
  assert.equal(viewer.receive(snapshot(replacement)), null, 'a simultaneous duplicate cannot take over a live document');
  viewer.receive({ ...first, kind: 'disconnected' });
  assert.equal(viewer.receive(snapshot(second)), null);
  assert.equal(viewer.snapshot().connected, false);
  viewer.receive(snapshot(replacement, [event('auth', 'complete', 2)], 'guest'));
  assert.equal(viewer.snapshot().key, replacement.publisher);
  assert.equal(viewer.snapshot().session.mode, 'guest');
  assert.equal(viewer.snapshot().events.some(({ node }) => node === 'report'), false);
  assert.equal(viewer.options().length, 1);
});

test('new-tab logout and login follow the active tab while the original analysis ledger remains separate', () => {
  const registry = createLiveFlowSources({ initialStream: first.stream, now: () => 1000 });
  const queue = event('queue', 'pending', 10, { source: 'backend', kind: 'progress' });
  registry.receive(snapshot(first, [queue], 'member'));
  registry.receive(snapshot(second, [], 'member'));
  assert.equal(registry.snapshot().key, first.publisher, 'background snapshots cannot select another tab');
  registry.receive(message(second, event('logout', 'complete', 30), true));
  registry.receive(message(second, event('auth', 'complete', 31, { kind: 'session', sessionMode: 'guest' }), true));
  assert.equal(registry.snapshot().key, second.publisher);
  assert.equal(registry.snapshot().session.mode, 'guest');
  assert.equal(registry.snapshot().states.some(({ node }) => node === 'queue'), false);
  registry.receive(message(first, event('api_evaluation', 'complete', 32, { kind: 'request' }), true));
  assert.equal(registry.snapshot().key, second.publisher, 'polling cannot steal selection even with a forged active flag');
  registry.receive(message(second, event('auth', 'complete', 33, { kind: 'session', sessionMode: 'member' }), true));
  assert.equal(registry.snapshot().session.mode, 'member');
  registry.receive({ ...first, kind: 'active', at: 40 });
  assert.equal(registry.snapshot().key, first.publisher);
  assert.equal(registry.snapshot().states.find(({ node }) => node === 'queue').state, 'pending');
});

test('pinning an analysis tab prevents automatic changes, then auto follows the next interaction', () => {
  const registry = createLiveFlowSources();
  registry.receive(snapshot(first)); registry.receive(snapshot(second));
  registry.select(first.publisher);
  registry.receive(message(second, event('signup', 'pending', 10), true));
  registry.receive({ ...second, kind: 'active', at: 11 });
  assert.equal(registry.snapshot().key, first.publisher);
  assert.equal(registry.select('unknown'), null);
  registry.select('auto');
  registry.receive({ ...second, kind: 'active', at: 12 });
  assert.equal(registry.snapshot().key, second.publisher);
  assert.equal(registry.snapshot().states[0].node, 'signup');
});

test('duplicate tab sessionStorage keys still have separate IDs, sessions, and reports', () => {
  const registry = createLiveFlowSources();
  const clone = { ...second, stream: first.stream };
  const saved = event('report', 'complete', 10, { id: 'event-1' });
  registry.receive(snapshot(first, [saved], 'member'));
  registry.receive(snapshot(clone, [event('auth', 'complete', 11, { id: 'event-1', kind: 'session', sessionMode: 'guest' })]));
  assert.equal(registry.options().length, 2);
  registry.select(clone.publisher);
  assert.equal(registry.snapshot().session.mode, 'guest');
  assert.equal(registry.snapshot().events[0].node, 'auth');
  assert.equal(registry.snapshot().states.some(({ node }) => node === 'report'), false);
  registry.select(first.publisher);
  assert.equal(registry.snapshot().events[0].node, 'report');
});

test('a pinned tab reload transfers to its sole replacement document without merging old account or run history', () => {
  const registry = createLiveFlowSources();
  const replacement = { ...first, publisher: 'replacement-publisher' };
  registry.receive(snapshot(first, [event('report', 'complete', 10)], 'member'));
  registry.select(first.publisher);
  registry.receive({ ...first, kind: 'disconnected' });
  const update = registry.receive(snapshot(replacement, [], 'guest'));
  assert.equal(update.selectedChanged, true);
  assert.equal(update.event, null, 'reconnection is not live traffic');
  assert.equal(registry.selection(), replacement.publisher);
  assert.equal(registry.snapshot().connected, true);
  assert.equal(registry.snapshot().session.mode, 'guest');
  assert.deepEqual(registry.snapshot().events, []);
  assert.deepEqual(registry.snapshot().states, []);
  registry.receive(message(replacement, event('auth', 'complete', 20, { kind: 'session', sessionMode: 'member' }), true));
  assert.equal(registry.snapshot().session.mode, 'member');
  registry.receive({ ...second, kind: 'active', at: 30 });
  assert.equal(registry.selection(), replacement.publisher, 'the reconnected tab remains pinned');
});

test('pin reload recovery never guesses from silence or takes a live duplicate tab', () => {
  for (const siblingConnected of [false, true]) {
    const registry = createLiveFlowSources();
    const clone = { ...first, publisher: 'cloned-publisher' };
    const replacement = { ...first, publisher: 'replacement-publisher' };
    registry.receive(snapshot(first)); registry.select(first.publisher);
    if (siblingConnected) {
      registry.receive(snapshot(clone));
      registry.receive({ ...first, kind: 'disconnected' });
    }
    registry.receive(snapshot(replacement));
    registry.receive({ ...replacement, kind: 'active', at: 20 });
    assert.equal(registry.selection(), first.publisher, siblingConnected ? 'known live duplicate makes handoff ambiguous' : 'an explicit departure is required');
    assert.equal(registry.snapshot().key, first.publisher);
  }
});

test('previously observed same-stream documents cannot inherit a departed pin', () => {
  const registry = createLiveFlowSources();
  const clone = { ...first, publisher: 'cloned-publisher' };
  registry.receive(snapshot(first)); registry.receive(snapshot(clone));
  registry.receive({ ...clone, kind: 'disconnected' });
  registry.select(first.publisher);
  registry.receive({ ...first, kind: 'disconnected' });
  registry.receive(snapshot(clone));
  assert.equal(registry.selection(), first.publisher);
  assert.equal(registry.snapshot().connected, false);
});

test('late and replayed envelopes cannot undo a completed request or reselect an older activity', () => {
  const registry = createLiveFlowSources();
  const start = event('api_jobs', 'pending', 10, { kind: 'request' });
  const completed = { ...start, at: 20, state: 'complete', durationMs: 10 };
  registry.receive({ ...snapshot(first, [start]), revision: 1 });
  registry.receive({ ...message(first, completed), revision: 3 });
  assert.equal(registry.receive({ ...snapshot(first, [start]), revision: 2 }), null);
  assert.equal(registry.receive({ ...message(first, start), revision: 3 }), null);
  registry.receive(message(first, start));
  assert.equal(registry.snapshot().states[0].state, 'complete');
  registry.receive({ ...second, kind: 'active', at: 50 });
  registry.receive({ ...first, kind: 'active', at: 40 });
  assert.equal(registry.snapshot().key, second.publisher);
});

test('account-reset snapshots clear one source and cannot restore old run states from historical rows', () => {
  const registry = createLiveFlowSources();
  const old = event('report', 'complete', 10);
  registry.receive(snapshot(first, [old], 'member'));
  registry.receive(snapshot(second, [old], 'member'));
  registry.receive(snapshot(first, [old], 'guest', []));
  assert.deepEqual(registry.snapshot().states, []);
  assert.equal(registry.snapshot().session.mode, 'guest');
  registry.select(second.publisher);
  assert.equal(registry.snapshot().states[0].node, 'report');
  assert.equal(registry.snapshot().session.mode, 'member');
});

test('late responses finish their own log row immediately without replacing a newer card', () => {
  const registry = createLiveFlowSources();
  const older = event('api_jobs', 'pending', 10, { kind: 'request', id: 'old-request' });
  const newer = event('api_jobs', 'pending', 30, { kind: 'request', id: 'new-request' });
  registry.receive(message(first, older)); registry.receive(message(first, newer));
  const change = registry.receive(message(first, { ...older, at: 20, state: 'complete', durationMs: 10 }));
  assert.equal(change.event.state, 'complete', 'deliver the real history update to the current viewer immediately');
  assert.equal(registry.snapshot().states[0].id, newer.id);
  assert.equal(registry.snapshot().states[0].state, 'pending');
  assert.equal(registry.snapshot().events.find(({ id }) => id === older.id).state, 'complete');
});

test('new evaluations clear only their source, preserving the other tab progress', () => {
  const registry = createLiveFlowSources();
  const running = event('analysis', 'running', 10, { source: 'backend', kind: 'progress', progress: 45 });
  registry.receive(snapshot(first, [running])); registry.receive(snapshot(second, [running]));
  registry.receive(message(second, event('evaluate', 'pending', 20), true));
  assert.equal(registry.snapshot().states.some(({ node }) => node === 'analysis'), false);
  registry.select(first.publisher);
  assert.equal(registry.snapshot().states[0].progress, 45);
});

test('disconnection and reconnection retain provenance without fabricating event traffic', () => {
  let clock = 100;
  const registry = createLiveFlowSources({ now: () => clock });
  registry.receive(snapshot(first, [event('auth', 'complete', 10)]));
  registry.receive(snapshot(second));
  const unrelated = registry.receive({ ...second, kind: 'disconnected' });
  assert.equal(unrelated.selectedUpdated, false);
  assert.equal(registry.snapshot().connected, true);
  registry.receive({ ...first, kind: 'disconnected' });
  assert.equal(registry.snapshot().connected, false);
  clock = 200;
  const restored = registry.receive(snapshot(first, [event('auth', 'complete', 10)]));
  assert.equal(restored.event, null, 'a snapshot never requests a pulse');
  assert.equal(registry.snapshot().connectedAt, 200);
});

test('allowlisting, source limits and copy isolation discard payloads and keep history bounded', () => {
  const registry = createLiveFlowSources({ limit: 2 });
  registry.receive(snapshot(first, Array.from({ length: 120 }, (_, index) => event('resume', 'complete', index,
    { text: 'PRIVATE_RESUME', token: 'PRIVATE_TOKEN', account: 'PRIVATE_ACCOUNT' }))));
  assert.equal(registry.snapshot().events.length, 100);
  assert.doesNotMatch(JSON.stringify(registry.snapshot()), /PRIVATE|text|token|account/);
  const copy = registry.snapshot(); copy.events[0].node = 'PRIVATE'; copy.session.mode = 'PRIVATE';
  assert.doesNotMatch(JSON.stringify(registry.snapshot()), /PRIVATE/);
  for (let index = 0; index < 20; index++) registry.receive(snapshot({ stream: `stream-${index}xx`, publisher: `publisher-${index}` }));
  assert.equal(registry.options().length, 2);
  assert.equal(registry.snapshot().key, first.publisher, 'eviction preserves the selected tab');
  const before = registry.options();
  for (const data of [null, {}, { ...first, kind: 'other' }, { ...snapshot(first), publisher: '<script>' },
    { ...snapshot(first), revision: -1 }, { ...message(first, event('private', 'complete', 1)) },
    { kind: 'disconnected', stream: 'unknown-stream' }]) assert.equal(registry.receive(data), null);
  assert.deepEqual(registry.options(), before);
  registry.clear(); assert.equal(registry.snapshot(), null); assert.equal(registry.options().length, 0);
});

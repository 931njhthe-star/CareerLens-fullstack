import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFlowStore, classifyFlowRequest, flowSnapshot, observeFlowProgress, mountFlowLauncher,
  beginFlowEvent, finishFlowEvent, getFlowViewerUrl, openFlowViewer, FLOW_NODES,
  FLOW_RUN_NODES, recordFlowEvent, setFlowSession, endFlowObservation,
} from '../../src/features/activity-flow/events.js';
import { api } from '../../src/shared/api/client.js';
import { flowEventLabel } from '../../src/features/activity-flow/catalog.js';

test('locked result separates waiting for authentication from a successful unlock', () => {
  assert.equal(flowEventLabel({ node: 'report_lock', state: 'waiting' }), '인증 대기');
  assert.equal(flowEventLabel({ node: 'report_lock', state: 'complete' }), '잠금 해제');
  assert.equal(flowEventLabel({ node: 'report_lock', state: 'cleared' }), '잠금 해제');
  assert.equal(flowEventLabel({ node: 'guest_cleanup', state: 'cleared' }), '비움');
  assert.equal(flowEventLabel({ node: 'queue', state: 'cleared' }), '대기 종료');
});


test('metadata is allowlisted, copied, and bounded without leaking payload fields', () => {
  const store = createFlowStore({ now: () => 123, limit: 3 });
  assert.equal(store.record('private-route'), null);
  store.record('resume', { body: 'SECRET', filename: 'private.pdf', kind: 'SECRET', source: 'SECRET', progress: '42' });
  assert.deepEqual(store.snapshot().events[0], {
    id: 'event-1', node: 'resume', kind: 'action', state: 'complete', source: 'observed',
    at: 123, durationMs: null, progress: null,
  });
  const copy = store.snapshot();
  copy.events[0].node = 'SECRET';
  copy.session.mode = 'SECRET';
  assert.equal(store.snapshot().events[0].node, 'resume');
  assert.equal(store.snapshot().session.mode, 'guest');
  for (let i = 0; i < 10; i++) store.record('visit');
  assert.equal(store.snapshot().events.length, 3);
  assert.doesNotMatch(JSON.stringify(store.snapshot()), /SECRET|private/);
});

test('request lifecycles upsert an id, measure actual elapsed time, and ignore late completions', () => {
  let clock = 100;
  const store = createFlowStore({ now: () => clock, inflightLimit: 2 });
  const updates = [];
  store.subscribe((change) => updates.push(change));
  store.subscribe(() => { throw new Error('observer failure'); });
  const first = store.begin('api_auth', { kind: 'request' });
  clock = 137;
  assert.equal(store.finish(first, { state: 'failed' }), true);
  assert.equal(store.finish(first), false);
  assert.equal(store.snapshot().events.length, 1);
  assert.equal(store.snapshot().events[0].durationMs, 37);
  assert.equal(updates[0].event.state, 'pending');
  assert.equal(updates[1].event.state, 'failed');
  const second = store.begin('api_resume');
  store.begin('api_jobs');
  store.begin('api_report');
  assert.equal(store.finish(second), false);
  assert.equal(store.snapshot().events.filter((item) => item.state === 'pending').length, 2);
  const backwards = store.begin('api_evaluation');
  clock = 0;
  store.finish(backwards);
  assert.equal(store.snapshot().events.at(-1).durationMs, 0);
});

test('latest node states survive log eviction, remain bounded, and are independent snapshot copies', () => {
  const store = createFlowStore({ now: () => 123, limit: 4 });
  store.record('parse_resume', { source: 'backend' });
  for (let index = 0; index < 150; index++) store.record('api_evaluation', { kind: 'request' });
  assert.equal(store.snapshot().events.length, 4);
  assert.equal(store.snapshot().events.some(({ node }) => node === 'parse_resume'), false);
  assert.equal(store.snapshot().states.find(({ node }) => node === 'parse_resume').state, 'complete');
  for (const node of FLOW_NODES) store.record(node);
  const snapshot = store.snapshot();
  assert.equal(snapshot.states.length, FLOW_NODES.length);
  assert.equal(new Set(snapshot.states.map(({ node }) => node)).size, snapshot.states.length);
  snapshot.states[0].node = 'SECRET_MUTATION';
  snapshot.states[0].state = 'failed';
  snapshot.states.push({ node: 'SECRET_EXTRA' });
  snapshot.events[0].node = 'SECRET_LOG';
  assert.equal(store.snapshot().states.length, FLOW_NODES.length);
  assert.doesNotMatch(JSON.stringify(store.snapshot()), /SECRET/);
  for (let index = 0; index < 150; index++) store.record(`unknown-${index}`);
  assert.equal(store.snapshot().states.length, FLOW_NODES.length);
});

test('a new evaluation clears stale worker states while preserving observed preparation and bounded history', () => {
  const store = createFlowStore();
  for (const node of ['visit', 'resume', 'role', 'storage_ack']) store.record(node);
  const worker = ['queue', 'analysis', 'parse_resume', 'parse_job', 'indexing', 'domain_a', 'domain_b', 'domain_c', 'domain_d', 'validation', 'scoring', 'database'];
  for (const node of worker) store.record(node, { source: 'backend' });
  const action = store.begin('evaluate');
  const snapshot = store.snapshot();
  assert.ok(worker.every((node) => !snapshot.states.some((state) => state.node === node)));
  assert.deepEqual(snapshot.states.map(({ node }) => node), ['visit', 'resume', 'role', 'storage_ack', 'evaluate']);
  assert.equal(snapshot.states.at(-1).state, 'pending');
  assert.ok(snapshot.events.some(({ node }) => node === 'database'), 'old activity remains historical evidence, not current run state');
  store.finish(action, { state: 'cancelled' });
  assert.equal(store.snapshot().states.at(-1).state, 'cancelled');
});

test('a new run heartbeat cannot restore a prior report or late request completion', () => {
  let now = 100;
  const store = createFlowStore({ now: () => now });
  store.record('resume');
  store.record('report');
  store.record('analysis', { source: 'backend', progress: 100 });
  store.record('guest_store', { source: 'backend', execution: 'guest' });
  const old = store.begin('api_report', { kind: 'request' });
  now = 200;
  store.begin('evaluate', { execution: 'guest' });
  store.record('analysis', { state: 'running', source: 'backend', execution: 'guest', progress: 52 });
  assert.equal(store.finish(old), false, 'the old response cannot repopulate a new execution');
  const heartbeat = store.snapshot();
  assert.equal(heartbeat.states.find(({ node }) => node === 'analysis').progress, 52);
  assert.equal(heartbeat.states.some(({ node }) => ['report', 'api_report', 'guest_store'].includes(node)), false);
  assert.equal(heartbeat.states.some(({ node }) => node === 'resume'), true);
  assert.ok(heartbeat.events.some(({ node, progress }) => node === 'analysis' && progress === 100), 'older completion is history only');
  assert.ok(FLOW_RUN_NODES.includes('report') && FLOW_RUN_NODES.includes('api_guest_claim'));
});

test('out-of-order API replies update history but preserve the newer current request', () => {
  let now = 0;
  const store = createFlowStore({ now: () => now });
  const changes = [];
  store.subscribe((change) => changes.push(change));
  const earlier = store.begin('api_jobs', { kind: 'request' });
  now = 10;
  const newer = store.begin('api_jobs', { kind: 'request' });
  now = 20;
  store.finish(earlier);
  assert.equal(store.snapshot().states.find(({ node }) => node === 'api_jobs').id, newer);
  assert.equal(store.snapshot().states.find(({ node }) => node === 'api_jobs').state, 'pending');
  assert.equal(changes.at(-1).kind, 'snapshot', 'do not broadcast an old completion as the live card');
  store.finish(newer);
  assert.equal(store.snapshot().states.find(({ node }) => node === 'api_jobs').state, 'complete');
});

test('guest authentication preserves its run while changing an existing account clears current report cards', () => {
  const store = createFlowStore();
  store.record('analysis', { source: 'backend', execution: 'guest', progress: 100 });
  store.record('report_lock', { execution: 'guest', state: 'waiting' });
  store.setSession('member');
  assert.equal(store.snapshot().states.find(({ node }) => node === 'report_lock').state, 'waiting');
  store.record('report');
  store.setSession('member', { resetRun: true });
  assert.equal(store.snapshot().states.some(({ node }) => FLOW_RUN_NODES.includes(node)), false);
  assert.equal(store.snapshot().session.mode, 'member');
});

test('evicting an unfinished request cannot leave an unfinishable pending node state', () => {
  const store = createFlowStore({ limit: 2, inflightLimit: 1 });
  const expired = store.begin('api_auth');
  const active = store.begin('api_report');
  assert.equal(store.finish(expired), false);
  assert.equal(store.snapshot().states.some(({ node }) => node === 'api_auth'), false);
  store.finish(active);
  for (let index = 0; index < 4; index++) store.record('visit');
  assert.equal(store.snapshot().states.find(({ node }) => node === 'api_report').state, 'complete');
});

test('pending eviction immediately replaces observer states for both in-flight and history limits', () => {
  for (const options of [{ limit: 4, inflightLimit: 1 }, { limit: 1, inflightLimit: 1 }]) {
    const store = createFlowStore(options);
    let observed = [];
    store.subscribe((change) => {
      if (change.kind === 'snapshot') observed = store.snapshot().states;
      else observed = [...observed.filter(({ node }) => node !== change.event.node), change.event];
    });
    const expired = store.begin('api_auth');
    if (options.limit === 1) store.record('visit');
    else store.begin('api_jobs');
    assert.equal(observed.some(({ node }) => node === 'api_auth'), false, 'no heartbeat is needed to remove an evicted pending card');
    assert.deepEqual(observed, store.snapshot().states);
    assert.equal(store.finish(expired), false);
    assert.equal(store.snapshot().events.some(({ node, state }) => node === 'api_auth' && state !== 'pending'), false);
  }
});

test('evicting a pending sibling immediately replaces its history even when the newer same-node request is complete', () => {
  const store = createFlowStore({ inflightLimit: 2 });
  let observed = [];
  store.subscribe((change) => {
    if (change.kind === 'snapshot') observed = store.snapshot().events;
    else observed = [...observed.filter(({ id }) => id !== change.event.id), change.event];
  });
  const older = store.begin('api_jobs', { kind: 'request' });
  const newer = store.begin('api_jobs', { kind: 'request' });
  store.finish(newer);
  store.begin('api_resume', { kind: 'request' });
  store.begin('api_auth', { kind: 'request' });
  assert.equal(store.finish(older), false);
  assert.equal(observed.some(({ id }) => id === older), false);
  assert.deepEqual(observed, store.snapshot().events);
  assert.equal(store.snapshot().states.find(({ node }) => node === 'api_jobs').state, 'complete');
});

test('eviction synchronization does not swallow the new user action used for live source selection', () => {
  const store = createFlowStore({ limit: 1 });
  store.begin('api_jobs', { kind: 'request' });
  const changes = [];
  store.subscribe((change) => changes.push(change));
  store.record('role');
  assert.deepEqual(changes.map(({ kind }) => kind), ['snapshot', 'event']);
  assert.equal(changes[1].event.node, 'role');
  assert.equal(changes[1].event.kind, 'action');
});

test('session state and unavailable progress preserve uncertainty', () => {
  const store = createFlowStore();
  store.setSession('member');
  assert.deepEqual(store.snapshot().session, { mode: 'member' });
  store.setSession('untrusted');
  assert.deepEqual(store.snapshot().session, { mode: 'guest' });
  for (const value of [undefined, null, -1, 101, NaN, Infinity, '0']) {
    store.record('analysis', { progress: value });
    assert.equal(store.snapshot().events.at(-1).progress, null);
  }
  store.record('analysis', { progress: 0 });
  assert.equal(store.snapshot().events.at(-1).progress, 0);
  store.record('analysis', { progress: 42.125 });
  assert.equal(store.snapshot().events.at(-1).progress, 42.125);
});

test('known endpoint classification never retains parameters or unknown paths', () => {
  const cases = [
    ['/auth/login?email=SECRET', 'api_auth'], ['/me', 'api_session'],
    ['/auth/signup', 'api_signup'], ['/auth/register', 'api_signup'], ['/auth/refresh', 'api_session'],
    ['/resumes/private-id', 'api_resume'], ['/local-data/convert-resume', 'api_convert'],
    ['/jobs/private-id?query=SECRET', 'api_jobs'],
    ['/companies/private-id?query=SECRET', 'api_jobs'], ['/companies/private-id/unknown', null],
    ['/evaluations/private-id/progress?after_id=999', 'api_evaluation'],
    ['/evaluations/private-id/cancel', 'api_cancel'], ['/reports/private-id', 'api_report'],
    ['/evaluations/private-id/result', 'api_report'], ['/admin/evaluation-performance?days=30', 'api_dashboard'],
    ['/admin/evaluation-performance/private-id?query=SECRET', 'api_dashboard'],
    ['/admin/evaluation-performance/private-id/unknown', null],
    ['/local-guest/capabilities', 'api_guest_service'], ['/local-guest/analyses', 'api_guest_analysis'],
    ['/local-guest/analyses/PRIVATE_RUN?secret=PRIVATE', 'api_guest_analysis'],
    ['/local-guest/analyses/PRIVATE_RUN/claim', 'api_guest_claim'],
    ['/local-guest/analyses/PRIVATE_RUN/cancel', 'api_cancel'], ['/local-guest/analyses/cancel-pending', 'api_cancel'],
    ['/local-guest/reports', 'api_guest_reports'], ['/local-guest/reports/PRIVATE_RUN', 'api_guest_reports'],
    ['/unknown/SECRET', null], ['https://example.com/auth/login', null], ['//auth/login', null],
  ];
  for (const [path, expected] of cases) assert.equal(classifyFlowRequest(path), expected);
});

test('backend progress excludes run identity and cannot fabricate final report completion', () => {
  const beforeInvalid = flowSnapshot().events.length;
  for (const status of [undefined, null, '', 'unknown', {}, 1])
    observeFlowProgress({ run: { status, progress_percent: 87 } });
  assert.equal(flowSnapshot().events.length, beforeInvalid, 'unknown status must not imply running');
  observeFlowProgress({ run: { status: 'queued', current_stage: 'queued', progress_percent: 0 } });
  assert.equal(flowSnapshot().events.at(-1).node, 'queue');
  assert.equal(flowSnapshot().events.at(-1).progress, null);
  observeFlowProgress({ run: { id: 'SECRET', status: 'running', current_stage: 'validation', progress_percent: 33.25, failure_reason: 'SECRET' }, events: [{ message: 'SECRET' }] });
  const running = flowSnapshot().events.at(-1);
  assert.equal(running.node, 'analysis');
  assert.equal(running.progress, 33.25);
  assert.equal(running.source, 'backend');
  const count = flowSnapshot().events.length;
  observeFlowProgress({ run: { status: 'running', current_stage: 'validation', progress_percent: 33.25 } });
  assert.equal(flowSnapshot().events.length, count);
  observeFlowProgress({ run: { status: 'completed', progress_percent: 100 } });
  assert.equal(flowSnapshot().events.at(-1).node, 'analysis');
  assert.equal(flowSnapshot().events.at(-1).state, 'complete');
  observeFlowProgress({ run: { status: 'running' } }, { demo: true });
  assert.equal(flowSnapshot().events.at(-1).progress, null);
  assert.equal(flowSnapshot().events.at(-1).source, 'demo');
  assert.doesNotMatch(JSON.stringify(flowSnapshot()), /SECRET|failure_reason|validation/);
});

test('leaving queued ends waiting without inventing a successful task or a queue duration', () => {
  for (const status of ['running', 'completed', 'partial', 'failed', 'cancelled']) {
    const action = beginFlowEvent('evaluate', { execution: 'guest' });
    observeFlowProgress({ execution: 'guest', run: { status: 'queued', current_stage: 'queued', progress_percent: 0 } });
    observeFlowProgress({ execution: 'guest', run: { status, current_stage: 'queued', progress_percent: 21 } });
    const states = flowSnapshot().states;
    const queue = states.find(({ node }) => node === 'queue');
    assert.equal(queue.state, 'cleared', status);
    assert.equal(queue.durationMs, null);
    assert.equal(queue.progress, null);
    assert.equal(queue.execution, 'guest');
    assert.equal(states.find(({ node }) => node === 'analysis').state,
      { running: 'running', completed: 'complete', partial: 'partial', failed: 'failed', cancelled: 'cancelled' }[status]);
    finishFlowEvent(action, { state: 'cancelled' });
  }
});

test('terminal runs stop uncompleted internal indicators without fabricating step outcomes', () => {
  for (const execution of [undefined, 'guest']) {
    for (const status of ['completed', 'partial', 'failed', 'cancelled']) {
      const action = beginFlowEvent('evaluate', { execution });
      observeFlowProgress({ execution, run: { status: 'running', progress_percent: 52 }, flowEvents: [
        { id: 1, node: 'parse_resume', state: 'complete', durationMs: 234 },
        { id: 2, node: 'domain_a', state: 'running', criterion: 'A2' },
        { id: 3, node: 'validation', state: 'failed' },
      ] });
      const lastStep = flowSnapshot().states.find(({ node }) => node === 'domain_a');
      observeFlowProgress({ execution, run: { status, progress_percent: 52 } });
      const snapshot = flowSnapshot();
      assert.equal(snapshot.states.some(({ node }) => node === 'domain_a'), false, status);
      assert.deepEqual(snapshot.events.find(({ id }) => id === lastStep.id), lastStep, 'retain the real last observation in history');
      assert.equal(snapshot.states.find(({ node }) => node === 'parse_resume').durationMs, 234);
      assert.equal(snapshot.states.find(({ node }) => node === 'validation').state, 'failed');
      assert.equal(snapshot.states.some(({ node }) => node === 'report'), false);
      // A later terminal poll can contain another historical running event. It
      // must be retained as history without reviving motion, even if status and
      // percentage are identical to the preceding poll.
      observeFlowProgress({ execution, run: { status, progress_percent: 52 }, flowEvents: [
        { id: 4, node: 'domain_b', state: 'running', criterion: 'B1' },
      ] });
      assert.equal(flowSnapshot().states.some(({ node }) => node === 'domain_b'), false);
      finishFlowEvent(action, { state: 'cancelled' });
    }
  }
});

test('clearing terminal progress broadcasts an authoritative snapshot and preserves measured history', () => {
  const store = createFlowStore({ now: () => 100 });
  const changes = [];
  store.subscribe((change) => changes.push(change));
  store.record('parse_resume', { kind: 'progress', source: 'backend', state: 'complete', durationMs: 50 });
  store.record('parse_job', { kind: 'progress', source: 'backend', state: 'running' });
  store.record('analysis', { kind: 'progress', source: 'backend', state: 'cancelled' });
  const history = store.snapshot().events;
  store.clearActiveProgress();
  assert.equal(changes.at(-1).kind, 'snapshot');
  assert.deepEqual(store.snapshot().events, history);
  assert.deepEqual(store.snapshot().states.map(({ node }) => node), ['parse_resume', 'analysis']);
  const count = changes.length;
  store.clearActiveProgress();
  assert.equal(changes.length, count, 'unchanged terminal snapshots do not cause unnecessary broadcasts');
});

test('worker metadata is deduplicated, strips private fields, and keeps overall progress separate', () => {
  const action = beginFlowEvent('evaluate');
  const start = flowSnapshot().events.length;
  const update = {
    run: { id: 'SECRET_RUN', status: 'running', current_stage: 'criterion', progress_percent: 41.5 },
    events: [{ id: 1, stage: 'parsing', message: 'SECRET_RAW_EVENT', progress_percent: 5 }],
    flowEvents: [
      { id: 1, node: 'parse_resume', state: 'complete', progress: 8, message: 'SECRET_MESSAGE' },
      { id: 2, node: 'domain_a', state: 'complete', criterion: 'A1', progress: 41.5, run_id: 'SECRET_RUN' },
      { id: 3, node: 'report', state: 'complete', payload: 'SECRET_REPORT' },
      { id: 4, node: 'archive', state: 'complete' },
      { id: 5, node: 'validation', state: 'invented' },
    ],
  };
  observeFlowProgress(update);
  const observed = flowSnapshot().events.slice(start);
  assert.deepEqual(observed.map(({ node, state, progress, criterion }) => ({ node, state, progress, criterion })), [
    { node: 'parse_resume', state: 'complete', progress: null, criterion: undefined },
    { node: 'domain_a', state: 'complete', progress: null, criterion: 'A1' },
    { node: 'analysis', state: 'running', progress: 41.5, criterion: undefined },
  ]);
  assert.ok(observed.every(({ source }) => source === 'backend'));
  assert.doesNotMatch(JSON.stringify(observed), /SECRET|run_id|message|payload/);
  const count = flowSnapshot().events.length;
  observeFlowProgress(update);
  assert.equal(flowSnapshot().events.length, count, 'replayed polling events must not duplicate activity');
  finishFlowEvent(action, { state: 'cancelled' });
  const next = beginFlowEvent('evaluate');
  const nextStart = flowSnapshot().events.length;
  observeFlowProgress(update);
  assert.equal(flowSnapshot().events.slice(nextStart).filter(({ node }) => node === 'domain_a').length, 1, 'a new evaluation resets source-event dedup');
  finishFlowEvent(next, { state: 'cancelled' });
});

test('unknown server stages never fabricate internal completion and partial remains partial', () => {
  const action = beginFlowEvent('evaluate');
  const start = flowSnapshot().events.length;
  for (const current_stage of ['parsing', 'validation', 'SECRET_STAGE'])
    observeFlowProgress({ run: { status: 'running', current_stage, progress_percent: 70 }, events: [{ stage: 'validation', message: 'SECRET_TEXT' }] });
  observeFlowProgress({ run: { status: 'partial', current_stage: 'completed', progress_percent: 100 } });
  const observed = flowSnapshot().events.slice(start);
  assert.ok(observed.every(({ node }) => node === 'analysis'));
  assert.equal(observed.at(-1).state, 'partial');
  assert.equal(observed.at(-1).progress, 100);
  assert.doesNotMatch(JSON.stringify(observed), /SECRET|report|database/);
  finishFlowEvent(action, { state: 'partial' });
  assert.equal(flowSnapshot().events.find(({ id }) => id === action).state, 'partial');
});

test('guest progress distinguishes frontend storage from member writes and preserves measured analysis duration', () => {
  beginFlowEvent('evaluate', { execution: 'guest' });
  const start = flowSnapshot().events.length;
  observeFlowProgress({ execution: 'guest', run: { status: 'completed', progress_percent: 100 }, durationMs: 54321,
    flowEvents: [
      { id: 1, node: 'parse_resume', state: 'complete', durationMs: 123 },
      { id: 2, node: 'guest_store', state: 'complete', report: 'PRIVATE_REPORT' },
      { id: 3, node: 'database', state: 'complete' },
    ] });
  const rows = flowSnapshot().events.slice(start);
  assert.deepEqual(rows.map(({ node }) => node), ['parse_resume', 'guest_store', 'analysis']);
  assert.ok(rows.every(({ execution }) => execution === 'guest'));
  assert.equal(rows[0].durationMs, 123);
  assert.equal(rows.at(-1).durationMs, 54321);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|database/);
  beginFlowEvent('evaluate');
  assert.equal(flowSnapshot().states.some(({ node }) => node === 'guest_store'), false);
});

test('method and criterion metadata are typed enums attached only to their real domain', () => {
  const store = createFlowStore();
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const id = store.begin('api_resume', { kind: 'request', method });
    store.finish(id);
    assert.equal(store.snapshot().events.at(-1).method, method);
  }
  store.record('domain_c', { source: 'backend', criterion: 'C2' });
  assert.equal(store.snapshot().events.at(-1).criterion, 'C2');
  for (const criterion of ['A1', 'C4', 'SECRET', ['C2'], { toString: () => 'C2' }, null]) {
    store.record('domain_c', { criterion, method: 'SECRET' });
    assert.equal(store.snapshot().events.at(-1).criterion, undefined);
    assert.equal(store.snapshot().events.at(-1).method, undefined);
  }
  store.record('resume', { criterion: 'C2' });
  assert.equal(store.snapshot().events.at(-1).criterion, undefined);
});

test('physical API success, failure and cancellation record only classified metadata', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: () => null };
  try {
    globalThis.fetch = async () => Response.json({ secret: 'SECRET_RESPONSE' });
    await api('/auth/login', { method: 'POST', body: { password: 'SECRET_PASSWORD' } });
    assert.equal(flowSnapshot().events.at(-1).node, 'api_auth');
    assert.equal(flowSnapshot().events.at(-1).state, 'complete');
    assert.equal(flowSnapshot().events.at(-1).kind, 'request');
    assert.equal(flowSnapshot().events.at(-1).method, 'POST');
    assert.ok(flowSnapshot().events.at(-1).durationMs >= 0);
    globalThis.fetch = async () => Response.json({ detail: 'SECRET_ERROR' }, { status: 500 });
    await assert.rejects(api('/jobs/SECRET_ID?query=SECRET_QUERY'));
    assert.equal(flowSnapshot().events.at(-1).state, 'failed');
    globalThis.fetch = async () => { throw new DOMException('SECRET_ABORT', 'AbortError'); };
    await assert.rejects(api('/reports/SECRET_ID'));
    assert.equal(flowSnapshot().events.at(-1).state, 'cancelled');
    assert.doesNotMatch(JSON.stringify(flowSnapshot()), /SECRET/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.sessionStorage = originalStorage;
  }
});

test('only successful signup and resume write responses acknowledge server storage', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: () => null };
  try {
    for (const [path, body] of [['/auth/signup', { user_id: 'SECRET_USER', email_confirmation_required: true }], ['/resumes', { id: 'SECRET_RESUME', parse_status: 'ready' }]]) {
      globalThis.fetch = async () => Response.json(body);
      await api(path, { method: 'POST', body: { password: 'SECRET_PASSWORD' } });
      assert.equal(flowSnapshot().events.at(-1).node, 'storage_ack');
      assert.equal(flowSnapshot().events.at(-1).source, 'backend');
    }
    const count = () => flowSnapshot().events.filter(({ node }) => node === 'storage_ack').length;
    const before = count();
    globalThis.fetch = async () => Response.json({ id: 'SECRET_READ' });
    await api('/resumes');
    assert.equal(count(), before, 'reading a resume never claims a write');
    globalThis.fetch = async () => Response.json({ detail: 'SECRET_FAILURE' }, { status: 500 });
    await assert.rejects(api('/resumes', { method: 'POST', body: {} }));
    assert.equal(count(), before, 'failed writes never claim storage success');
    assert.doesNotMatch(JSON.stringify(flowSnapshot()), /SECRET/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.sessionStorage = originalStorage;
  }
});

test('source transport uses a stable tab key, disconnects, and reconnects after restoration or remount', () => {
  const originals = Object.fromEntries(['document', 'window', 'BroadcastChannel', 'sessionStorage'].map((key) => [key, globalThis[key]]));
  const channels = [];
  const lifecycle = new Map();
  const stored = new Map();
  globalThis.document = {};
  globalThis.sessionStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  globalThis.window = {
    addEventListener: (type, handler) => lifecycle.set(type, handler),
    removeEventListener: (type) => lifecycle.delete(type),
  };
  globalThis.BroadcastChannel = class {
    constructor(name) { this.name = name; this.sent = []; channels.push(this); }
    addEventListener(_type, handler) { this.message = handler; }
    postMessage(value) { this.sent.push(value); }
    close() { this.closed = true; }
  };
  let dispose;
  try {
    dispose = mountFlowLauncher();
    assert.equal(channels.length, 1);
    assert.equal(channels[0].name, 'careerlens.flow.v1');
    const url = getFlowViewerUrl();
    const stream = new URL(url, 'http://localhost').searchParams.get('stream');
    assert.ok(stream);
    assert.equal(channels[0].sent[0].stream, stream);
    channels[0].message({ data: { kind: 'subscribe', stream: 'wrong' } });
    assert.equal(channels[0].sent.length, 1);
    channels[0].message({ data: { kind: 'subscribe', stream } });
    assert.equal(channels[0].sent.length, 2);
    assert.equal(channels[0].sent[1].kind, 'snapshot');
    assert.equal(mountFlowLauncher(), dispose);
    // Real source transport remains on the same tab channel through guest
    // processing, verification and result delivery. No application data travels.
    setFlowSession('guest', { resetRun: true });
    const analysis = beginFlowEvent('evaluate', { execution: 'guest' });
    observeFlowProgress({ execution: 'guest', run: { id: 'PRIVATE_RUN', status: 'running', progress_percent: 52 } });
    assert.equal(channels[0].sent.at(-1).event.progress, 52);
    observeFlowProgress({ execution: 'guest', run: { id: 'PRIVATE_RUN', status: 'completed', progress_percent: 100 },
      flowEvents: [{ id: 1, node: 'guest_store', state: 'complete', report: 'PRIVATE_REPORT' }] });
    finishFlowEvent(analysis);
    recordFlowEvent('report_lock', { state: 'waiting', execution: 'guest' });
    const signup = beginFlowEvent('signup');
    finishFlowEvent(signup);
    setFlowSession('member');
    assert.equal(channels.length, 1, 'authentication cannot disconnect the active source');
    assert.equal(channels[0].sent.at(-1).session.mode, 'member');
    assert.equal(channels[0].sent.at(-1).states.some(({ node }) => node === 'report'), false);
    const claim = beginFlowEvent('guest_claim', { execution: 'guest' });
    finishFlowEvent(claim);
    recordFlowEvent('report_lock', { state: 'complete', execution: 'guest' });
    recordFlowEvent('report');
    assert.ok(channels[0].sent.every((item) => item.stream === stream));
    assert.doesNotMatch(JSON.stringify(channels[0].sent), /PRIVATE_RUN|PRIVATE_REPORT/);
    beginFlowEvent('evaluate', { execution: 'guest' });
    observeFlowProgress({ execution: 'guest', run: { status: 'running', progress_percent: 52 } });
    channels[0].message({ data: { kind: 'subscribe', stream } });
    const heartbeat = channels[0].sent.at(-1);
    assert.equal(heartbeat.states.some(({ node }) => node === 'report'), false, 'snapshot cannot restore the old completed card');
    assert.equal(heartbeat.states.find(({ node }) => node === 'analysis').progress, 52);
    lifecycle.get('pagehide')({});
    assert.equal(channels[0].closed, true);
    assert.equal(channels[0].sent.at(-1).kind, 'disconnected');
    assert.equal(channels[0].sent.at(-1).stream, stream);
    assert.equal(channels[0].sent.at(-1).publisher, channels[0].sent[0].publisher);
    lifecycle.get('pageshow')({ persisted: true });
    assert.equal(channels.length, 2);
    assert.equal(channels[1].sent[0].stream, stream);
    assert.equal(getFlowViewerUrl(), url);
    dispose();
    assert.equal(getFlowViewerUrl(), null);
    assert.equal(lifecycle.size, 0);
    dispose = mountFlowLauncher();
    assert.equal(channels.length, 3);
    assert.equal(getFlowViewerUrl(), url, 'reload-equivalent remount reuses this tab key');
    assert.deepEqual([...stored.keys()], ['careerlens.flow.tab.v1']);
    assert.equal(stored.get('careerlens.flow.tab.v1'), stream, 'no event history is persisted');
  } finally {
    dispose?.();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('unsupported or failed channel returns no live link and denied storage stays harmless', () => {
  const originals = Object.fromEntries(['document', 'window', 'BroadcastChannel', 'sessionStorage'].map((key) => [key, globalThis[key]]));
  globalThis.document = {};
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.sessionStorage = { getItem() { throw new Error('storage denied'); } };
  let dispose;
  try {
    globalThis.BroadcastChannel = undefined;
    dispose = mountFlowLauncher();
    assert.equal(getFlowViewerUrl(), null);
    dispose();
    globalThis.BroadcastChannel = class { constructor() { throw new Error('unsupported'); } };
    dispose = mountFlowLauncher();
    assert.equal(getFlowViewerUrl(), null);
    dispose();
    globalThis.BroadcastChannel = class { addEventListener() {} postMessage() {} close() {} };
    dispose = mountFlowLauncher();
    assert.match(getFlowViewerUrl(), /^\/\?view=flow&stream=[a-zA-Z0-9_-]{8,100}$/);
  } finally {
    dispose?.();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('only matching pair subscriptions discover a source and background polling is not user activity', () => {
  const originals = Object.fromEntries(['document', 'window', 'BroadcastChannel', 'sessionStorage'].map((key) => [key, globalThis[key]]));
  const channels = [];
  const windowHandlers = new Map(), documentHandlers = new Map();
  let focused = true;
  globalThis.document = { hidden: false, visibilityState: 'visible', hasFocus: () => focused,
    addEventListener: (type, handler) => documentHandlers.set(type, handler), removeEventListener: (type) => documentHandlers.delete(type) };
  globalThis.window = { addEventListener: (type, handler) => windowHandlers.set(type, handler), removeEventListener: (type) => windowHandlers.delete(type) };
  globalThis.sessionStorage = { getItem: () => 'duplicated-tab-stream', setItem() {} };
  globalThis.BroadcastChannel = class {
    constructor() { this.sent = []; channels.push(this); }
    addEventListener(_type, handler) { this.message = handler; }
    postMessage(value) { this.sent.push(value); }
    close() {}
  };
  let dispose;
  try {
    dispose = mountFlowLauncher();
    const first = channels[0];
    assert.equal(first.sent[0].kind, 'snapshot');
    assert.equal(first.sent[1].kind, 'active');
    first.message({ data: { kind: 'subscribe', stream: 'some-other-tab', scope: 'browser' } });
    assert.equal(first.sent.at(-1).kind, 'active', 'browser-wide subscriptions cannot read another pair');
    first.message({ data: { kind: 'subscribe', stream: first.sent[0].stream } });
    assert.equal(first.sent.at(-1).kind, 'snapshot');
    const request = beginFlowEvent('api_jobs', { kind: 'request' });
    assert.equal(first.sent.at(-1).active, false);
    finishFlowEvent(request);
    assert.equal(first.sent.at(-1).active, false);
    recordFlowEvent('auth', { kind: 'session' });
    assert.equal(first.sent.at(-1).active, true);
    focused = false;
    recordFlowEvent('report', { kind: 'action' });
    assert.equal(first.sent.at(-1).active, false, 'background completion cannot select its source');
    const count = first.sent.length;
    windowHandlers.get('focus')();
    assert.equal(first.sent.length, count);
    focused = true;
    windowHandlers.get('focus')();
    assert.equal(first.sent.at(-1).kind, 'active');
    assert.ok(first.sent.every((value, index) => index === 0 || value.revision > first.sent[index - 1].revision));
    const publisher = first.sent[0].publisher;
    assert.match(publisher, /^[a-zA-Z0-9_-]{8,100}$/);
    dispose();
    assert.equal(windowHandlers.size, 0); assert.equal(documentHandlers.size, 0);
    dispose = mountFlowLauncher();
    assert.equal(channels[1].sent[0].stream, first.sent[0].stream);
    assert.notEqual(channels[1].sent[0].publisher, publisher, 'copied storage never merges document histories');
  } finally {
    dispose?.();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('ending observation neutralizes unavailable progress without claiming worker failure or clearing a newer run', () => {
  const first = beginFlowEvent('evaluate');
  observeFlowProgress({ run: { status: 'queued' } });
  assert.equal(endFlowObservation(first), true);
  assert.equal(flowSnapshot().states.some((row) => row.node === 'queue'), false);
  assert.equal(flowSnapshot().states.some((row) => row.node === 'analysis' && row.state === 'failed'), false);
  const second = beginFlowEvent('evaluate');
  observeFlowProgress({ run: { status: 'running', progress_percent: 40 }, flowEvents: [{ id: 1, node: 'parse_resume', state: 'running' }] });
  assert.equal(endFlowObservation(first, { confirmedCancelled: true }), false);
  assert.equal(flowSnapshot().states.find((row) => row.node === 'analysis').progress, 40);
  assert.equal(endFlowObservation(second, { confirmedCancelled: true }), true);
  assert.equal(flowSnapshot().states.find((row) => row.node === 'analysis').state, 'cancelled');
  assert.equal(flowSnapshot().states.some((row) => row.node === 'parse_resume'), false);
  finishFlowEvent(first, { state: 'cancelled' }); finishFlowEvent(second, { state: 'cancelled' });
});

test('pair observation never instantiates a server publisher or calls fetch in any session mode', () => {
  const originals = Object.fromEntries(['document', 'window', 'BroadcastChannel', 'sessionStorage'].map((key) => [key, globalThis[key]]));
  const sent = [];
  globalThis.document = { hidden: false, hasFocus: () => false, addEventListener() {}, removeEventListener() {} };
  globalThis.window = { fetch() {}, addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
  globalThis.BroadcastChannel = class { addEventListener() {} postMessage() {} close() {} };
  globalThis.sessionStorage = { getItem: () => 'source-demo-test', setItem() {} };
  let dispose;
  try {
    setFlowSession('guest');
    dispose = mountFlowLauncher({ publisherFactory: () => ({ enqueue: (value) => sent.push(value), flush() {}, dispose() {} }) });
    setFlowSession('demo');
    recordFlowEvent('posting', { source: 'demo' });
    recordFlowEvent('notice');
    setFlowSession('guest');
    assert.equal(sent.length, 0, 'no session sends anything to a central collector');
  } finally {
    dispose?.();
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('work-tab reload preserves its pair but copied storage in a fresh tab opens an independent observer window', () => {
  const originals = Object.fromEntries(['document', 'window', 'BroadcastChannel', 'sessionStorage', 'performance'].map((key) => [key, globalThis[key]]));
  let navigation = 'navigate';
  const storage = new Map([['careerlens.flow.tab.v1', 'copied-original-stream']]);
  const opened = [];
  globalThis.performance = { getEntriesByType: () => [{ type: navigation }] };
  globalThis.document = { hidden: false, hasFocus: () => false, addEventListener() {}, removeEventListener() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, open: (...args) => { opened.push(args); return { focus() {} }; } };
  globalThis.BroadcastChannel = class { addEventListener() {} postMessage() {} close() {} };
  globalThis.sessionStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  let dispose;
  try {
    setFlowSession('guest'); dispose = mountFlowLauncher();
    const firstUrl = getFlowViewerUrl();
    assert.ok(!firstUrl.includes('copied-original-stream'));
    assert.equal(openFlowViewer(), null, 'anonymous users cannot open an authenticated observer');
    setFlowSession('member'); openFlowViewer(); openFlowViewer();
    assert.equal(opened[0][1], opened[1][1], 'one work tab reuses only its own observer window');
    assert.match(opened[0][2], /popup=yes/);
    assert.doesNotMatch(opened[0][0], /token|auth|password/);
    dispose(); navigation = 'reload'; dispose = mountFlowLauncher();
    assert.equal(getFlowViewerUrl(), firstUrl);
    dispose(); navigation = 'navigate'; dispose = mountFlowLauncher();
    assert.notEqual(getFlowViewerUrl(), firstUrl);
    openFlowViewer();
    assert.notEqual(opened.at(-1)[1], opened[0][1]);
  } finally {
    dispose?.(); setFlowSession('guest');
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

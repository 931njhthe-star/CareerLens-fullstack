import assert from 'node:assert/strict';
import test from 'node:test';
import { DEMO_ACTIONS, DEMO_GROUPS, getDemoAction, createDemoPlayback } from '../../src/features/activity-flow/demo.js';
import { FLOW_NODES, normalizeFlowEvent } from '../../src/features/activity-flow/catalog.js';

function setup() {
  const events = [];
  const finished = [];
  const playback = createDemoPlayback({
    emit: (event) => events.push(event), onFinish: (action) => finished.push(action.id), now: () => 1000,
  });
  return { playback, events, finished };
}

function run(id) {
  const result = setup();
  assert.equal(result.playback.start(id), true);
  result.playback.tick(100_000);
  return result.events;
}
const hasNode = (events, node) => events.some((event) => event.node === node);
const atState = (events, node, state) => events.findIndex((event) => event.node === node && event.state === state);
const last = (events, node) => events.filter((event) => event.node === node).at(-1);

test('each case has a group, prerequisite and valid directed graph', () => {
  const groups = new Set(DEMO_GROUPS.map((group) => group.id));
  const outcomes = new Set(['success', 'failure', 'blocked', 'cancelled', 'partial', 'empty', 'waiting']);
  assert.equal(new Set(DEMO_ACTIONS.map((action) => action.id)).size, DEMO_ACTIONS.length);
  for (const action of [...DEMO_ACTIONS, getDemoAction('full')]) {
    assert.ok(groups.has(action.group) && outcomes.has(action.outcome), action.id);
    assert.ok(action.precondition && action.completeMessage && action.description, action.id);
    assert.deepEqual(action.nodes, [...new Set(action.steps.map((entry) => entry[1]))]);
    assert.equal(new Set(action.edges.map((edge) => JSON.stringify(edge))).size, action.edges.length);
    for (const [from, to] of action.edges) {
      assert.ok(FLOW_NODES.has(from) && FLOW_NODES.has(to));
      assert.ok(action.nodes.includes(from) && action.nodes.includes(to));
      assert.notEqual(from, to);
    }
  }
});

test('all cases independently emit synthetic metadata and finish without active leftovers', () => {
  for (const id of [...DEMO_ACTIONS.map((action) => action.id), 'full']) {
    const { playback, events, finished } = setup();
    playback.start(id);
    playback.tick(100_000);
    assert.deepEqual(finished, [id]);
    assert.ok(events.length > 1);
    for (const event of events) {
      assert.deepEqual(normalizeFlowEvent(event, { demo: true }), event);
      assert.equal(normalizeFlowEvent(event), null, 'live mode rejects every demo event');
      if (event.from) assert.ok(getDemoAction(id).edges.some(([from, to]) => from === event.from && to === event.node));
    }
    for (const event of new Map(events.map((entry) => [entry.node, entry])).values()) {
      assert.ok(!['pending', 'running', 'queued'].includes(event.state), `${id}: ${event.node} stays active`);
    }
    assert.equal(playback.snapshot().complete, true);
    assert.equal(playback.snapshot().playing, false);
  }
});

test('signup saves member data before success; email confirmation does not log in', () => {
  for (const id of ['signup', 'signup_confirmation']) {
    const events = run(id);
    assert.ok(atState(events, 'api_signup', 'pending') < atState(events, 'database', 'running'));
    assert.ok(atState(events, 'database', 'running') < atState(events, 'database', 'complete'));
    assert.ok(atState(events, 'database', 'complete') < atState(events, 'api_signup', 'complete'));
  }
  const awaiting = run('signup_confirmation');
  assert.equal(last(awaiting, 'signup').state, 'waiting');
  assert.equal(awaiting.some((event) => event.state === 'member'), false);
  for (const id of ['signup_invalid', 'signup_failed', 'login', 'login_failed', 'logout']) {
    assert.equal(hasNode(run(id), 'database'), false, id);
  }
  assert.equal(run('signup_invalid').some((event) => event.kind === 'request'), false);
});

test('session recovery retries the original request only after refreshing the session', () => {
  const events = run('session_refresh');
  assert.ok(atState(events, 'api_report', 'failed') < atState(events, 'api_session', 'pending'));
  assert.ok(atState(events, 'api_session', 'complete') < atState(events, 'api_report', 'complete'));
  assert.equal(last(events, 'session').state, 'member');
  assert.equal(last(run('session_expired'), 'session').state, 'expired');
});

test('email verification returns validate before storing a session and failure preserves browser state', () => {
  const success = run('email_confirmation_success');
  assert.ok(atState(success, 'api_auth', 'complete') < atState(success, 'local_data', 'complete'));
  assert.equal(last(success, 'auth').state, 'member');
  assert.equal(hasNode(success, 'database'), false);
  const failure = run('email_confirmation_failed');
  assert.equal(hasNode(failure, 'local_data') || hasNode(failure, 'database'), false);
  assert.equal(failure.some((event) => event.kind === 'request'), false, 'expired callback is rejected locally before an API request');
  assert.equal(last(failure, 'auth').state, 'blocked');
});

test('guest conversion is separate from member storage and local posting changes', () => {
  const guest = run('resume_guest');
  assert.ok(hasNode(guest, 'api_convert') && hasNode(guest, 'local_data'));
  assert.equal(hasNode(guest, 'database') || hasNode(guest, 'api_resume'), false);
  for (const id of ['resume_expired', 'resume_transfer_expired', 'bookmark', 'bookmark_remove', 'posting_create', 'posting_edit', 'posting_delete']) {
    const events = run(id);
    assert.ok(hasNode(events, 'local_data'));
    assert.equal(hasNode(events, 'database') || events.some((event) => event.kind === 'request'), false, id);
  }
  for (const id of ['resume', 'resume_edit', 'resume_transfer']) {
    assert.ok(atState(run(id), 'database', 'complete') >= 0, id);
  }
  const transfer = run('resume_transfer');
  assert.ok(atState(transfer, 'database', 'complete') < atState(transfer, 'local_data', 'cleared'));
  for (const id of ['resume_invalid', 'resume_failed', 'resume_conversion_failed']) {
    assert.equal(hasNode(run(id), 'database'), false);
  }
  assert.equal(hasNode(run('resume_conversion_failed'), 'local_data'), false);
});

test('blocked analysis cannot create an evaluation, save results or show a report', () => {
  for (const id of ['analysis_no_resume', 'analysis_no_posting', 'analysis_local_posting']) {
    const events = run(id);
    assert.equal(events.some((event) => event.kind === 'request'), false, id);
    assert.equal(events.some((event) => ['database', 'report', 'queue'].includes(event.node)), false, id);
    assert.equal(last(events, 'analysis').state, 'blocked');
  }
});

test('local posting mutations are explicitly demo-account-only and ordinary member restriction does not write', () => {
  for (const id of ['bookmark', 'bookmark_remove', 'posting_create', 'posting_edit', 'posting_delete']) {
    assert.match(getDemoAction(id).precondition, /시연 계정에서만/);
    assert.match(getDemoAction(id).precondition, /실제 회원 기능은 연동 준비 중/);
  }
  const events = run('posting_write_blocked');
  assert.equal(events.some((event) => event.kind === 'request' || ['local_data', 'database'].includes(event.node)), false);
  assert.equal(last(events, 'posting').state, 'blocked');
});

test('analysis failure, cancellation and timeout do not fabricate saved or displayed reports', () => {
  for (const id of ['analysis_start_failed', 'analysis_failed', 'analysis_cancelled', 'analysis_timeout']) {
    const events = run(id);
    assert.equal(events.some((event) => ['database', 'report', 'archive'].includes(event.node)), false, id);
    assert.equal(events.some((event) => event.node === 'analysis' && event.progress === 100), false, id);
  }
  const cancelled = run('analysis_cancelled');
  assert.ok(atState(cancelled, 'api_cancel', 'complete') < atState(cancelled, 'analysis', 'cancelled'));
  assert.equal(last(run('analysis_timeout'), 'analysis').state, 'waiting');
});

test('report display waits for analysis, storage and a successful report response', () => {
  for (const id of ['report', 'analysis_partial']) {
    const events = run(id);
    const completion = events.findIndex((event) => event.node === 'analysis' && event.progress === 100);
    const stored = events.findIndex((event, index) => index > completion && event.node === 'database' && event.state === 'complete');
    const response = atState(events, 'api_report', 'complete');
    const report = events.findIndex((event) => event.node === 'report');
    assert.ok(completion >= 0 && stored > completion && response > stored && report > response);
    assert.equal(last(events, 'queue').state, 'cleared');
    assert.equal(last(events, 'queue').durationMs, null, 'waiting ending does not imply a measured queue duration');
  }
  assert.equal(last(run('analysis_partial'), 'report').state, 'partial');
  const missingReport = run('report_fetch_failed');
  assert.ok(atState(missingReport, 'database', 'complete') >= 0);
  assert.ok(atState(missingReport, 'api_report', 'failed') >= 0);
  assert.equal(hasNode(missingReport, 'report'), false);
});

test('guest demos finish calculation and frontend storage before authentication without a second analysis', () => {
  for (const id of ['analysis_guest', 'guest_signup', 'guest_claim_slow', 'guest_posting_first', 'full']) {
    const events = run(id);
    const complete = atState(events, 'analysis', 'complete');
    const stored = atState(events, 'guest_store', 'complete');
    const locked = atState(events, 'report_lock', 'waiting');
    const auth = atState(events, 'auth', 'member');
    const claim = atState(events, 'api_guest_claim', 'complete');
    const shown = atState(events, 'report', 'complete');
    assert.ok(complete >= 0 && stored > complete && locked > stored && auth > locked && claim > auth && shown > claim, id);
    assert.equal(events.slice(auth).some((event) => ['analysis', 'api_evaluation', 'api_guest_analysis'].includes(event.node)), false, id);
    assert.equal(hasNode(events, 'database'), false, 'guest result is not a backend DB write');
    assert.equal(last(events, 'result_delivery').durationMs, id === 'guest_claim_slow' ? 3400 : 900);
    assert.ok(events.every((event) => event.execution === 'guest' && event.source === 'demo'));
  }
});

test('locked, failed claim, expired, and cancelled guest cases never fabricate a displayed report', () => {
  for (const id of ['guest_locked', 'guest_signup_waiting', 'guest_claim_failed', 'guest_expired', 'guest_cancelled']) {
    const events = run(id);
    assert.equal(hasNode(events, 'report'), false, id);
    assert.equal(events.some((event) => event.node === 'result_delivery' && event.state === 'complete'), false, id);
  }
  assert.equal(last(run('guest_locked'), 'report_lock').state, 'waiting');
  assert.equal(last(run('guest_signup_waiting'), 'signup').state, 'waiting');
  assert.equal(hasNode(run('guest_signup_waiting'), 'guest_claim'), false);
  assert.equal(last(run('guest_claim_failed'), 'guest_claim').state, 'failed');
  assert.equal(last(run('guest_expired'), 'guest_cleanup').state, 'expired');
  assert.equal(hasNode(run('guest_cancelled'), 'guest_store'), false);
  const recovery = run('guest_service_recovery');
  assert.ok(atState(recovery, 'api_guest_service', 'failed') < atState(recovery, 'api_guest_service', 'complete'));
  assert.ok(atState(recovery, 'api_guest_service', 'complete') < atState(recovery, 'guest_store', 'complete'));
});

test('saved report and public dashboard reads never create an evaluation or write data', () => {
  for (const id of ['report_history', 'report_saved', 'report_empty', 'report_inaccessible', 'report_not_ready', 'report_session_expired', 'dashboard', 'dashboard_empty', 'dashboard_failed', 'dashboard_filter']) {
    assert.equal(run(id).some((event) => ['database', 'api_evaluation', 'analysis'].includes(event.node)), false, id);
  }
  assert.ok(hasNode(run('report_saved'), 'database_read'));
  assert.equal(last(run('report_saved'), 'report').state, 'complete');
  for (const id of ['report_inaccessible', 'report_not_ready', 'report_session_expired']) assert.equal(hasNode(run(id), 'report'), false, id);
  for (const id of ['dashboard', 'dashboard_empty', 'dashboard_failed', 'dashboard_filter']) {
    assert.equal(run(id).some((event) => ['auth', 'api_auth', 'api_session'].includes(event.node)), false, id);
  }
  assert.equal(run('dashboard_filter').some((event) => event.kind === 'request'), false);
});

test('motion has only case edges, with explicit parallel joins and no repeated same-node incoming pulse', () => {
  const events = run('report');
  for (const [from, node] of [['queue', 'parse_resume'], ['queue', 'parse_job'], ['parse_resume', 'analysis'], ['parse_job', 'analysis']]) {
    assert.ok(events.some((event) => event.from === from && event.node === node));
  }
  assert.equal(Object.hasOwn(events.find((event) => event.node === 'analysis' && event.progress === 48), 'from'), false);
  assert.equal(Object.hasOwn(events[0], 'from'), false);
  assert.ok(getDemoAction('signup').edges.some(([from, to]) => from === 'api_signup' && to === 'database'));
  assert.equal(getDemoAction('login').nodes.includes('database'), false);
});

test('clock boundaries emit each step and completion once', () => {
  const { playback, events, finished } = setup();
  const action = getDemoAction('login');
  playback.start('login');
  assert.deepEqual(events.map((event) => event.node), ['auth']);
  playback.tick(299);
  assert.equal(events.length, 1);
  playback.tick(1);
  assert.equal(events.length, 2);
  assert.equal(events[1].at, 1300);
  playback.tick(0);
  assert.equal(events.length, 2);
  playback.tick(100_000);
  playback.tick(1000);
  assert.deepEqual(finished, ['login']);
  assert.equal(events.length, action.steps.length);
  assert.equal(playback.snapshot().elapsed, action.steps.at(-1)[0]);
});

test('a new button replaces the previous sequence while ids stay unique', () => {
  const { playback, events, finished } = setup();
  playback.start('report');
  playback.tick(3000);
  const previousCount = events.length;
  playback.start('login');
  playback.tick(100_000);
  assert.deepEqual(finished, ['login']);
  assert.deepEqual(events.slice(previousCount).map((event) => event.node), getDemoAction('login').steps.map((entry) => entry[1]));
  playback.start('login');
  playback.tick(100_000);
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
});

test('pause, resume, reset and invalid inputs cannot advance a stopped sequence', () => {
  const { playback, events, finished } = setup();
  assert.equal(playback.resume(), false);
  assert.equal(playback.start('not-a-scenario'), false);
  playback.start('login');
  playback.tick(300);
  const paused = playback.snapshot();
  assert.equal(playback.start('not-a-scenario'), false);
  assert.deepEqual(playback.snapshot(), paused);
  assert.equal(playback.pause(), true);
  playback.tick(100_000);
  assert.equal(events.length, 2);
  assert.equal(playback.resume(), true);
  for (const delta of [-1, NaN, Infinity, '1000']) playback.tick(delta);
  assert.equal(playback.snapshot().elapsed, 300);
  playback.tick(750);
  assert.equal(events.length, 3);
  playback.reset();
  playback.tick(100_000);
  assert.equal(playback.resume(), false);
  assert.deepEqual(playback.snapshot(), { actionId: null, index: 0, elapsed: 0, playing: false, complete: false });
  assert.deepEqual(finished, []);
});

test('runner uses no network or browser storage for any case', (context) => {
  const forbidden = () => { throw new Error('Demo attempted an external operation'); };
  context.mock.method(globalThis, 'fetch', forbidden);
  for (const name of ['WebSocket', 'BroadcastChannel']) {
    if (name in globalThis) context.mock.method(globalThis, name, forbidden);
  }
  for (const name of ['sessionStorage', 'localStorage']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, get: forbidden });
    context.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  for (const id of [...DEMO_ACTIONS.map((action) => action.id), 'full']) run(id);
});

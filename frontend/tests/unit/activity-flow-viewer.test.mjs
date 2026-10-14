import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as catalog from '../../src/features/activity-flow/catalog.js';
import * as demo from '../../src/features/activity-flow/demo.js';
import { createLiveFlowSources } from '../../src/features/activity-flow/live-sources.js';
import { normalizeFlowEvent, flowEventLabel, DEMO_SEQUENCE, FLOW_NODES, LIVE_FLOW_EDGES } from '../../src/features/activity-flow/catalog.js';
import { FLOW_NODES as OBSERVED_NODES, FLOW_RUN_NODES, createFlowStore, beginFlowEvent, observeFlowProgress, finishFlowEvent, flowSnapshot } from '../../src/features/activity-flow/events.js';

const event = { id: 'test-1', node: 'analysis', state: 'running', source: 'backend', kind: 'progress', at: 100, progress: 0, durationMs: null };

test('live rendering rejects synthetic events and uninstrumented internal stages', () => {
  assert.equal(normalizeFlowEvent({ ...event, source: 'demo' }), null);
  assert.equal(normalizeFlowEvent({ ...event, node: 'archive' }), null);
  assert.equal(normalizeFlowEvent({ ...event, node: 'database_read' }), null);
  for (const node of ['parse_resume', 'parse_job', 'indexing', 'domain_a', 'domain_b', 'domain_c', 'domain_d', 'validation', 'scoring', 'database']) {
    assert.equal(normalizeFlowEvent({ ...event, node, source: 'observed' }), null);
    assert.equal(normalizeFlowEvent({ ...event, node }).node, node, 'sanitized worker telemetry can prove an internal step');
  }
  assert.equal(normalizeFlowEvent({ ...event, node: 'storage_ack', source: 'observed' }), null);
  assert.equal(normalizeFlowEvent({ ...event, node: 'storage_ack' }).node, 'storage_ack');
  assert.equal(normalizeFlowEvent({ ...event, node: '<script>' }), null);
  assert.equal(normalizeFlowEvent({ ...event, state: 'invented-success' }), null);
});

test('only allowlisted metadata survives a received message', () => {
  const clean = normalizeFlowEvent({ ...event, token: 'private', email: 'someone@example.test', text: 'resume', url: '/private' });
  assert.deepEqual(clean, event);
  assert.equal(normalizeFlowEvent({ ...event, progress: '45', durationMs: NaN }).progress, null);
  assert.equal(normalizeFlowEvent({ ...event, progress: 101 }).progress, null);
  assert.equal(normalizeFlowEvent({ ...event, progress: null }).progress, null);
});

test('opening login or resume never labels it as successful login or upload', () => {
  for (const node of ['auth', 'resume']) {
    const navigation = normalizeFlowEvent({ ...event, node, state: 'complete', kind: 'navigation' });
    assert.equal(flowEventLabel(navigation), '화면 열림');
  }
  assert.equal(flowEventLabel({ ...event, kind: 'session', sessionMode: 'guest' }), '비회원 확인');
  assert.equal(flowEventLabel({ ...event, kind: 'session', sessionMode: 'member' }), '회원 확인');
  assert.equal(flowEventLabel({ ...event, kind: 'session' }), '세션 확인');
});

test('demo is explicit and final report occurs after 100 percent', () => {
  const full = DEMO_SEQUENCE.find(([at, node, state, progress]) => node === 'analysis' && progress === 100);
  const report = DEMO_SEQUENCE.find(([at, node]) => node === 'report');
  assert.ok(report[0] > full[0]);
  assert.equal(normalizeFlowEvent({ ...event, node: 'database', source: 'demo' }, { demo: true }).source, 'demo');
  const latest = new Map(DEMO_SEQUENCE.map((entry) => [entry[1], entry]));
  assert.equal(latest.get('queue')[2], 'cleared');
  assert.ok([...latest.values()].every((entry) => !['pending', 'running', 'queued'].includes(entry[2])));
});

test('session event labels retain the observed state after login and logout', () => {
  const store = createFlowStore({ now: () => 100 });
  store.record('auth', { kind: 'session' });
  store.setSession('member');
  store.record('auth', { kind: 'session' });
  store.setSession('guest');
  const labels = store.snapshot().events.map((value) => flowEventLabel(normalizeFlowEvent(value)));
  assert.deepEqual(labels, ['비회원 확인', '회원 확인']);
});

test('observed application actions are live while case-only reads and synthetic routes remain excluded', () => {
  for (const node of ['signup', 'logout', 'session', 'cancel', 'evaluate', 'history', 'dashboard', 'api_signup', 'api_session', 'api_cancel', 'api_dashboard', 'api_convert', 'input_check', 'local_data', 'notice']) {
    assert.equal(normalizeFlowEvent({ ...event, node, source: 'observed' }).node, node);
  }
  assert.equal(normalizeFlowEvent({ ...event, node: 'database_read', source: 'observed' }), null);
  assert.equal(normalizeFlowEvent({ ...event, node: 'database_read', source: 'demo' }, { demo: true }).node, 'database_read');
  assert.equal(normalizeFlowEvent({ ...event, from: 'api_evaluation' }).from, undefined);
  const synthetic = { ...event, source: 'demo', from: 'parse_job' };
  assert.equal(normalizeFlowEvent(synthetic, { demo: true }).from, 'parse_job');
  for (const from of ['unknown', 'analysis', '<script>', null]) {
    assert.equal(normalizeFlowEvent({ ...synthetic, from }, { demo: true }).from, undefined);
  }
});

test('criteria retain only their domain-matching typed code and do not imply whole-domain completion', () => {
  const a1 = normalizeFlowEvent({ ...event, node: 'domain_a', state: 'complete', criterion: 'A1', method: 'GET', token: 'SECRET' });
  assert.equal(a1.criterion, 'A1');
  assert.equal(a1.method, 'GET');
  assert.equal(flowEventLabel(a1), 'A1 · 완료');
  assert.equal(FLOW_NODES.get('domain_a').description, 'A1~A3 항목의 최근 처리 상태');
  for (const criterion of ['B1', 'A4', 'SECRET', ['A1'], { toString: () => 'A1' }, null])
    assert.equal(normalizeFlowEvent({ ...event, node: 'domain_a', criterion, method: 'SECRET' }).criterion, undefined);
  assert.equal(normalizeFlowEvent({ ...event, criterion: 'A1' }).criterion, undefined);
  assert.equal(normalizeFlowEvent({ ...event, method: 'SECRET' }).method, undefined);
  assert.doesNotMatch(JSON.stringify(a1), /SECRET|token/);
});

test('live dependencies follow sequential parsing, four parallel domains, then scoring and persistence', () => {
  const has = (from, to) => LIVE_FLOW_EDGES.some(([a, b]) => a === from && b === to);
  assert.ok(has('parse_resume', 'parse_job'));
  assert.ok(has('parse_job', 'indexing'));
  for (const domain of ['a', 'b', 'c', 'd']) {
    assert.ok(has('indexing', `domain_${domain}`));
    assert.ok(has(`domain_${domain}`, 'validation'));
  }
  for (const [from, to] of [['validation', 'scoring'], ['scoring', 'database'], ['database', 'api_report'], ['api_report', 'report']]) assert.ok(has(from, to));
  assert.ok(!has('api_auth', 'database'), 'login is not account creation');
  assert.ok(!has('report', 'archive'), 'showing a report does not prove a separate archive write');
  assert.deepEqual(['a', 'b', 'c', 'd'].map((domain) => FLOW_NODES.get(`domain_${domain}`).label), ['이력서 완성도', '직무 적합도', '지원 자격 충족도', '실무 경쟁력']);
});

async function viewerFixture({ central = false, paired = false, request } = {}) {
  const source = await readFile(new URL('../../src/features/activity-flow/viewer.js', import.meta.url), 'utf8');
  class Element {
    constructor(dataset = {}) {
      this.dataset = dataset;
      this.style = {};
      this.children = new Map();
      this.handlers = new Map();
      this.writes = 0;
      this.textWrites = 0;
      this.classList = { add() {}, toggle() {} };
    }
    set innerHTML(value) { this.markup = String(value); this.writes++; }
    get innerHTML() { return this.markup || ''; }
    set textContent(value) { this.text = String(value); this.textWrites++; }
    get textContent() { return this.text || ''; }
    querySelector(selector) {
      if (!this.children.has(selector)) this.children.set(selector, new Element());
      return this.children.get(selector);
    }
    querySelectorAll(selector) { return selector === '[data-flow-node]' ? [...cards.values()] : []; }
    setAttribute() {}
    addEventListener(name, handler) { this.handlers.set(name, handler); }
    removeEventListener(name) { this.handlers.delete(name); }
    contains() { return true; }
  }
  const cards = new Map([...catalog.FLOW_VIEW_NODES.keys()].map((id) => [id, new Element({ flowNode: id })]));
  const host = new Element();
  const frames = new Map();
  const timeouts = new Map();
  const windowLifecycle = new Map();
  const lifecycle = new Map();
  const pulses = [];
  const active = [];
  const edges = [];
  const intervals = [];
  let clockNow = 1_000_000;
  let resets = 0;
  let nextFrame = 0;
  let nextTimeout = 0;
  let message;
  let centralHooks, centralDisposed = false, centralMounts = 0, unauthorized = 0;
  let formatterCount = 0;
  const document = {
    hidden: false,
    body: new Element(),
    addEventListener: (name, handler) => lifecycle.set(name, handler),
    removeEventListener: (name) => lifecycle.delete(name),
  };
  const context = vm.createContext({
    ...catalog, ...demo, FLOW_RUN_NODES, createLiveFlowSources, URLSearchParams, document,
    createCentralFlowMonitor: (hooks) => {
      centralMounts++; centralDisposed = false;
      centralHooks = hooks;
      return { start() {}, pause() {}, restart() { hooks.onReset(); }, dispose() { centralDisposed = true; } };
    },
    Date: class extends Date { static now() { return clockNow; } },
    location: { search: '?view=flow&stream=test-stream' },
    localStorage: { getItem() { return null; } },
    matchMedia: () => ({ matches: false }),
    performance: { now: () => 1000 },
    Intl: { DateTimeFormat: class extends Intl.DateTimeFormat {
      constructor(...args) { super(...args); formatterCount++; }
    } },
    setInterval: (callback, ms) => { intervals.push({ callback, ms }); return intervals.length; }, clearInterval() {},
    window: {
      requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
      cancelAnimationFrame: (id) => frames.delete(id),
      setTimeout: (callback, delay) => { const id = ++nextTimeout; timeouts.set(id, { callback, at: clockNow + delay }); return id; },
      clearTimeout: (id) => timeouts.delete(id),
      addEventListener: (name, handler) => windowLifecycle.set(name, handler),
      removeEventListener: (name) => windowLifecycle.delete(name),
    },
    BroadcastChannel: class {
      addEventListener(_name, handler) { message = handler; }
      postMessage() {}
      close() {}
    },
    mountFlowMotion: () => ({
      pulse: (...args) => pulses.push(args), syncActive: (values) => active.push(JSON.parse(JSON.stringify(values))), reset() { resets++; }, setEdges: (values) => edges.push(JSON.parse(JSON.stringify(values))), setPaused() {}, setTheme() {}, destroy() {},
    }),
  });
  vm.runInContext(source.replace(/^import .*;\r?$/gm, '').replace('export function mountFlowViewer', 'function mountFlowViewer'), context);
  const dispose = context.mountFlowViewer(host, { central, paired, request, onUnauthorized: () => unauthorized++ });
  return {
    host, cards, frames, timeouts, pulses, active, edges, document, dispose,
    remote: (data, metadata = {}) => centralHooks.onEnvelope(data, metadata),
    connection: (value) => centralHooks.onStatus({ state: 'connected', scope: 'shared', sources: 2, received: 0, gaps: 0, ...value }),
    remoteDisposed: () => centralDisposed,
    centralMounts: () => centralMounts,
    centralRequest: () => centralHooks?.request,
    pagehide: (persisted = true) => windowLifecycle.get('pagehide')?.({ persisted }),
    pageshow() { const restore = windowLifecycle.get('pageshow'); windowLifecycle.delete('pageshow'); restore?.({ persisted: true }); },
    unauthorized: () => unauthorized,
    resets: () => resets,
    heartbeat: () => intervals.find((entry) => entry.ms === 4000).callback(),
    elapse: (ms) => {
      clockNow += ms;
      for (const [id, timer] of [...timeouts]) if (timer.at <= clockNow) { timeouts.delete(id); timer.callback(); }
    },
    blur: () => windowLifecycle.get('blur')?.(),
    element: (selector) => host.querySelector(selector),
    formatterCount: () => formatterCount,
    send: (value) => message({ data: { kind: 'event', stream: 'test-stream', event: value } }),
    snapshot: (value) => message({ data: { kind: 'snapshot', stream: 'test-stream', ...value } }),
    disconnect: () => message({ data: { kind: 'disconnected', stream: 'test-stream' } }),
    message: (data) => message({ data }),
    source: (value) => host.querySelector('[data-flow-source]').handlers.get('change')({ target: { value } }),
    frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(1000)); },
    visibility(hidden) { document.hidden = hidden; lifecycle.get('visibilitychange')(); },
    mode(value) { host.querySelector('[data-flow-mode]').handlers.get('change')({ target: { value } }); },
    select(id) { host.handlers.get('click')({ target: { closest: (selector) => selector === '[data-flow-node]' ? cards.get(id) : null } }); },
  };
}

test('flow viewer header links to the dashboard with a centered prominent button', async () => {
  const view = await viewerFixture();
  try {
    assert.match(view.host.innerHTML, /<a class="flow-dashboard-link" href="\/#\/admin">대시보드<\/a>/);
    const css = await readFile(new URL('../../src/shared/styles/activity-flow.css', import.meta.url), 'utf8');
    assert.match(css, /\.flow-dashboard-link\s*\{[^}]*left:\s*50%/);
    assert.match(css, /\.flow-dashboard-link\s*\{[^}]*position:\s*absolute/);
  } finally {
    view.dispose();
  }
});

const requestEvent = (id, state, at, durationMs = null) => ({
  id, node: 'api_jobs', kind: 'request', source: 'observed', state, at, durationMs, progress: null, method: 'GET',
});

test('BFCache restoration retains authentication callback and transport, and owner disposal stops the restored viewer', async () => {
  const request = async () => ({});
  const ui = await viewerFixture({ central: true, request });
  ui.pagehide();
  assert.equal(ui.remoteDisposed(), true);
  ui.pageshow();
  assert.equal(ui.centralMounts(), 2);
  assert.equal(ui.centralRequest(), request);
  ui.connection({ state: 'unauthorized' });
  assert.equal(ui.unauthorized(), 1, 'restored viewer must still show the member login gate');
  assert.equal(ui.remoteDisposed(), true);
  ui.dispose();

  const active = await viewerFixture({ central: true });
  active.pagehide(); active.pageshow();
  assert.equal(active.remoteDisposed(), false);
  active.dispose();
  assert.equal(active.remoteDisposed(), true, 'original owner controls the replacement instance');
});

test('disposing a cached viewer cancels pending restoration and local mode remains local after restore', async () => {
  const ui = await viewerFixture({ central: true });
  ui.pagehide(); ui.dispose(); ui.pageshow();
  assert.equal(ui.centralMounts(), 1, 'a disposed owner cannot remount after returning from cache');
  const local = await viewerFixture();
  local.pagehide(); local.pageshow();
  assert.equal(local.centralMounts(), 0);
  local.dispose();
});

test('paired viewer renders only its originating work tab and never mounts shared monitoring', async () => {
  const ui = await viewerFixture({ paired: true });
  const original = { stream: 'test-stream', publisher: 'publisher-original' };
  try {
    ui.message({ ...original, kind: 'snapshot', events: [], states: [], session: { mode: 'member' } });
    ui.message({ ...original, kind: 'event', event: requestEvent('own-request', 'pending', 100) });
    ui.message({ stream: 'different-stream', publisher: 'publisher-other', kind: 'event', active: true,
      event: { ...requestEvent('unrelated', 'complete', 200), node: 'api_resume' } });
    ui.frame();
    assert.equal(ui.centralMounts(), 0);
    assert.equal(ui.cards.size, 41);
    assert.equal(ui.cards.get('api_jobs').dataset.state, 'pending');
    assert.equal(ui.cards.get('api_resume').dataset.state, 'idle');
    assert.equal(ui.element('[data-flow-source-label]').hidden, true);
    ui.message({ ...original, kind: 'disconnected' }); ui.frame();
    assert.equal(ui.cards.get('api_jobs').dataset.activity, 'idle');
    ui.message({ ...original, publisher: 'publisher-reloaded', kind: 'snapshot', events: [], states: [], session: { mode: 'guest' } }); ui.frame();
    assert.equal(ui.cards.get('api_jobs').dataset.state, 'idle');
  } finally { ui.dispose(); }
});

test('central monitor keeps every source visible in aggregate while pinning one existing 41-card map', async () => {
  const ui = await viewerFixture({ central: true });
  const a = { stream: 'stream-a-1234', publisher: 'browser:publisher-a-1234' };
  const b = { stream: 'stream-b-1234', publisher: 'browser:publisher-b-1234' };
  ui.remote({ ...a, kind: 'snapshot', revision: 1, events: [requestEvent('event-1', 'complete', 999999, 42)], states: [requestEvent('event-1', 'complete', 999999, 42)] }, { snapshot: true });
  ui.connection({ received: 1 }); ui.frame();
  assert.equal(ui.pulses.length, 0, 'initial historic events do not replay');
  assert.equal(ui.cards.get('api_jobs').dataset.activity, 'idle');
  ui.source(a.publisher); ui.frame();
  ui.remote({ ...b, kind: 'event', revision: 1, event: { ...requestEvent('event-1', 'pending', 1000000), node: 'api_resume' } });
  ui.connection({ received: 2 }); ui.frame();
  assert.match(ui.element('[data-flow-global-feed]').innerHTML, /publisher-a-1234/);
  assert.match(ui.element('[data-flow-global-feed]').innerHTML, /publisher-b-1234/);
  assert.equal(ui.cards.get('api_jobs').dataset.state, 'complete');
  assert.notEqual(ui.cards.get('api_resume').dataset.state, 'pending', 'other source cannot contaminate pinned map');
  assert.equal(ui.cards.size, 41);
  ui.dispose();
});

test('central source association links browser to trusted server analysis without merging ledgers', async () => {
  const ui = await viewerFixture({ central: true });
  ui.remote({ stream: 'stream-a-1234', publisher: 'browser:publisher-a-1234', kind: 'snapshot', revision: 1, events: [], states: [] }, { snapshot: true });
  ui.remote({ stream: 'worker-a-1234', publisher: 'worker:worker-a-1234', related_publisher: 'browser:publisher-a-1234', kind: 'event', revision: 1,
    event: { ...event, at: 1000000, node: 'parse_resume' } });
  ui.connection(); ui.frame();
  assert.match(ui.element('[data-flow-related]').innerHTML, /worker:worker-a-1234/);
  assert.notEqual(ui.cards.get('parse_resume').dataset.state, 'running');
  ui.source('worker:worker-a-1234'); ui.frame();
  assert.equal(ui.cards.get('parse_resume').dataset.state, 'running');
  assert.match(ui.element('[data-flow-related]').innerHTML, /browser:publisher-a-1234/);
  ui.dispose();
});

test('central unavailable and process-only mode stay explicit and authentication expiry scrubs the view', async () => {
  const ui = await viewerFixture({ central: true });
  ui.connection({ scope: 'process' }); ui.frame();
  assert.match(ui.element('[data-flow-banner]').textContent, /단일 서버/);
  assert.match(ui.element('[data-flow-banner]').textContent, /공용 Redis/);
  ui.connection({ state: 'retrying' }); ui.frame();
  assert.match(ui.element('[data-flow-banner]').textContent, /관측되는 것으로 표시하지 않습니다/);
  ui.connection({ state: 'unauthorized' });
  assert.equal(ui.remoteDisposed(), true);
  assert.equal(ui.unauthorized(), 1);
  assert.equal(ui.host.innerHTML, '');
  assert.equal(ui.frames.size, 0);
});

test('a healthy central connection does not relight a stale pending worker snapshot', async () => {
  const ui = await viewerFixture({ central: true });
  ui.remote({ stream: 'worker-a-1234', publisher: 'worker:worker-a-1234', at: 1000, kind: 'snapshot', revision: 1,
    events: [{ ...event, node: 'parse_resume' }], states: [{ ...event, node: 'parse_resume' }] }, { snapshot: true });
  ui.connection(); ui.frame();
  assert.equal(ui.cards.get('parse_resume').dataset.state, 'running', 'retain last measured state as text');
  assert.equal(ui.cards.get('parse_resume').dataset.activity, 'idle', 'stale work cannot claim live activity');
  assert.match(ui.element('[data-flow-scope]').textContent, /마지막 기록 표시/);
  ui.dispose();
});

test('selected live worker cancellation immediately removes running internal highlights and retains known member mode', async () => {
  const ui = await viewerFixture({ central: true });
  const source = { stream: 'worker-a-1234', publisher: 'worker:worker-a-1234', at: 1000000, kind: 'event' };
  ui.remote({ ...source, revision: 1, event: { ...event, id: 'server-1', at: 1000000, node: 'parse_resume' } });
  ui.connection(); ui.frame();
  assert.equal(ui.cards.get('parse_resume').dataset.activity, 'running');
  assert.match(ui.element('[data-flow-source]').innerHTML, /회원/);
  ui.remote({ ...source, revision: 2, event: { ...event, id: 'server-2', at: 1000001, node: 'analysis', state: 'cancelled' } });
  ui.frame();
  assert.notEqual(ui.cards.get('parse_resume').dataset.activity, 'running');
  assert.notEqual(ui.cards.get('parse_resume').dataset.state, 'complete');
  assert.equal(ui.cards.get('analysis').dataset.state, 'cancelled');
  ui.dispose();
});

test('global feed uses server receipt order and snapshots do not move old traffic ahead of new users', async () => {
  const ui = await viewerFixture({ central: true });
  const a = { stream: 'stream-a-1234', publisher: 'browser:publisher-a-1234' };
  const b = { stream: 'stream-b-1234', publisher: 'browser:publisher-b-1234' };
  const first = { ...requestEvent('event-1', 'complete', 9000000), node: 'posting', kind: 'action' };
  ui.remote({ ...a, kind: 'event', at: 1000000, revision: 1, event: first, active: true });
  ui.remote({ ...b, kind: 'event', at: 1000001, revision: 1, event: { ...first, at: 500 }, active: true });
  ui.remote({ ...a, kind: 'snapshot', at: 1000002, revision: 2, events: [first], states: [first] }, { snapshot: true });
  ui.connection(); ui.frame();
  const feed = ui.element('[data-flow-global-feed]').innerHTML;
  assert.ok(feed.indexOf(b.publisher) < feed.indexOf(a.publisher));
  assert.equal(ui.element('[data-flow-source]').value, 'auto');
  assert.match(ui.element('[data-flow-scope]').textContent, /브라우저 2/);
  ui.dispose();
});

test('old global rows stay evicted when a source heartbeat repeats history while actual snapshot changes remain visible', async () => {
  const ui = await viewerFixture({ central: true });
  const a = { stream: 'stream-a-1234', publisher: 'browser:publisher-a-1234' };
  const b = { stream: 'stream-b-1234', publisher: 'browser:publisher-b-1234' };
  const first = requestEvent('event-1', 'pending', 500);
  try {
    ui.remote({ ...a, kind: 'event', at: 1000000, revision: 1, event: first });
    for (let i = 1; i <= 200; i++) ui.remote({ ...b, kind: 'event', at: 1000000 + i, revision: i,
      event: requestEvent(`event-${i}`, 'complete', 600 + i, 5) });
    ui.connection(); ui.frame();
    assert.ok(!ui.element('[data-flow-global-feed]').innerHTML.includes(a.publisher));
    ui.remote({ ...a, kind: 'snapshot', at: 1000201, revision: 2, events: [first], states: [first] }, { snapshot: true });
    ui.frame();
    assert.ok(!ui.element('[data-flow-global-feed]').innerHTML.includes(a.publisher), 'unchanged history is not new traffic');
    const completed = { ...first, state: 'complete', durationMs: 300, at: 800 };
    ui.remote({ ...a, kind: 'snapshot', at: 1000202, revision: 3, events: [completed], states: [completed] }, { snapshot: true });
    ui.frame();
    assert.ok(ui.element('[data-flow-global-feed]').innerHTML.includes(a.publisher), 'a recovered lifecycle change is recorded');
    assert.equal((ui.element('[data-flow-global-feed]').innerHTML.match(/class="flow-global-row"/g) || []).length, 200);
  } finally { ui.dispose(); }
});

test('122 request lifecycles retain the latest 100 records with one render and one node pulse per frame', async () => {
  const view = await viewerFixture();
  try {
    const log = view.element('[data-flow-log]');
    const writes = log.writes;
    const untouched = view.cards.get('resume').querySelector('[data-node-status]');
    const untouchedWrites = untouched.textWrites;
    for (let index = 0; index < 122; index++) {
      view.send(requestEvent(`request-${index}`, 'pending', 1000 + index * 2));
      view.send(requestEvent(`request-${index}`, 'complete', 1001 + index * 2, 25 + index));
    }
    assert.equal(view.frames.size, 1);
    assert.equal(log.writes, writes, 'receiving metadata does not synchronously rebuild the log');
    assert.equal(view.pulses.length, 0);
    view.frame();
    assert.equal(log.writes, writes + 1);
    assert.equal((log.innerHTML.match(/class="flow-log-row"/g) || []).length, 100);
    assert.equal(view.element('[data-flow-event-count]').textContent, '100');
    assert.equal(view.element('[data-flow-request-count]').textContent, '16개 요청');
    assert.equal(view.cards.get('api_jobs').dataset.state, 'complete');
    assert.equal(view.cards.get('api_jobs').querySelector('[data-node-value]').textContent, '146 ms');
    assert.deepEqual(view.pulses, [['api_jobs', 'complete']]);
    assert.equal(untouched.textWrites, untouchedWrites, 'unrelated card DOM is unchanged');
    assert.equal(view.formatterCount(), 1, 'all retained log timestamps share one formatter');
  } finally { view.dispose(); }
});

test('hidden viewers retain new states without repainting or replaying old pulses on return', async () => {
  const view = await viewerFixture();
  try {
    const log = view.element('[data-flow-log]');
    view.send(requestEvent('slow', 'pending', 100));
    view.visibility(true);
    assert.equal(view.frames.size, 0);
    const writes = log.writes;
    view.send(requestEvent('slow', 'complete', 235, 135));
    assert.equal(view.frames.size, 0);
    assert.equal(log.writes, writes);
    view.visibility(false);
    assert.equal(view.frames.size, 1);
    view.frame();
    assert.equal(log.writes, writes + 1);
    assert.equal(view.cards.get('api_jobs').dataset.state, 'complete');
    assert.equal(view.cards.get('api_jobs').querySelector('[data-node-value]').textContent, '135 ms');
    assert.equal(view.pulses.length, 0);
  } finally { view.dispose(); }
});

test('terminal source snapshots stop motion without turning unfinished steps into successes', async () => {
  const view = await viewerFixture();
  try {
    for (const status of ['failed', 'cancelled']) {
      const action = beginFlowEvent('evaluate', { execution: 'guest' });
      observeFlowProgress({ execution: 'guest', run: { status: 'queued' } });
      view.snapshot(flowSnapshot());
      view.frame();
      assert.ok(view.active.at(-1).length > 0);
      observeFlowProgress({ execution: 'guest', run: { status: 'running', current_stage: 'queued', progress_percent: 52 },
        flowEvents: [{ id: 1, node: 'parse_resume', state: 'running' }] });
      view.snapshot(flowSnapshot());
      view.frame();
      assert.ok(view.active.at(-1).length > 0);
      observeFlowProgress({ execution: 'guest', run: { status, progress_percent: 52 } });
      finishFlowEvent(action, { state: status });
      view.snapshot(flowSnapshot());
      view.frame();
      assert.deepEqual(view.active.at(-1), []);
      assert.equal(view.cards.get('analysis').dataset.state, status);
      assert.match(view.element('[data-flow-log]').innerHTML, /이력서 해석/, 'historical running observation remains available');
      assert.equal(flowSnapshot().events.some(({ node, state }) => node === 'parse_resume' && state === 'complete'), false);
    }
  } finally { view.dispose(); }
});

test('snapshot replacement, mode changes, and disposal do not leak queued live animation', async () => {
  const view = await viewerFixture();
  view.send(requestEvent('old', 'pending', 100));
  const final = requestEvent('old', 'failed', 270, 170);
  view.snapshot({ events: [final], states: [final], session: { mode: 'member' } });
  view.frame();
  assert.equal(view.cards.get('api_jobs').dataset.state, 'failed');
  assert.equal(view.pulses.length, 0, 'a snapshot supersedes queued transient pulses');
  view.send(requestEvent('switch', 'pending', 300));
  view.mode('demo');
  assert.equal(view.frames.size, 0);
  view.frame();
  assert.equal(view.pulses.length, 0);
  view.mode('live');
  view.send(requestEvent('dispose', 'pending', 400));
  assert.equal(view.frames.size, 1);
  const log = view.element('[data-flow-log]');
  const writes = log.writes;
  view.dispose();
  assert.equal(view.frames.size, 0);
  view.frame();
  assert.equal(log.writes, writes);
});

test('guest cards retain raw details and report timing only judges measured actual display', async () => {
  const view = await viewerFixture();
  let next = 0;
  const send = (node, state, extras = {}) => view.send({ id: `guest-${++next}`, node, state, source: 'observed', execution: 'guest', at: next * 100, kind: 'action', ...extras });
  try {
    send('analysis', 'complete', { source: 'backend', kind: 'progress', progress: 100, durationMs: 62000 });
    send('guest_store', 'complete', { source: 'backend' });
    send('report_lock', 'waiting');
    view.frame();
    assert.equal(view.cards.get('database').querySelector('.flow-node-description').textContent, '비회원 결과 임시 저장');
    assert.equal(view.cards.get('report_lock').querySelector('[data-node-status]').textContent, '인증 대기');
    view.select('analysis');
    assert.match(view.element('[data-flow-detail]').innerHTML, /62.00 s/);
    assert.equal(view.element('[data-flow-request-count]').textContent, '미측정', 'analysis runtime is not a network request');
    view.select('report');
    assert.match(view.element('[data-flow-detail]').innerHTML, /미측정/);
    assert.doesNotMatch(view.element('[data-flow-detail]').innerHTML, /3초 이내 표시 확인/);
    send('result_delivery', 'pending');
    view.frame();
    assert.match(view.element('[data-flow-detail]').innerHTML, /측정 중/);
    assert.ok(view.active.at(-1).some((value) => value.node === 'report' && value.state === 'pending'));
    assert.ok(!view.active.at(-1).some((value) => value.node === 'report_lock'), 'authentication waiting does not animate');
    send('report', 'complete');
    send('report_lock', 'complete');
    send('result_delivery', 'complete');
    view.frame();
    assert.equal(view.cards.get('report_lock').querySelector('[data-node-status]').textContent, '잠금 해제');
    assert.doesNotMatch(view.element('[data-flow-detail]').innerHTML, /3초 이내 표시 확인/);
    send('result_delivery', 'complete', { durationMs: 850 });
    view.frame();
    assert.match(view.element('[data-flow-detail]').innerHTML, /850 ms/);
    assert.match(view.element('[data-flow-detail]').innerHTML, /3초 이내 표시 확인/);
    assert.equal(view.element('[data-flow-request-count]').textContent, '미측정');
    send('result_delivery', 'complete', { durationMs: 3400 });
    view.frame();
    assert.match(view.element('[data-flow-detail]').innerHTML, /3초 목표 초과/);
    send('result_delivery', 'failed', { durationMs: 100 });
    view.frame();
    assert.match(view.element('[data-flow-detail]').innerHTML, /결과 표시 실패/);
    assert.doesNotMatch(view.element('[data-flow-detail]').innerHTML, /3초 이내 표시 확인/);
  } finally { view.dispose(); }
});

test('new analysis clears previous report states and distinguishes unobserved worker sources', async () => {
  const view = await viewerFixture();
  try {
    view.send({ ...event, id: 'guest-run', execution: 'guest', at: 100 });
    view.send({ ...event, id: 'old-report', node: 'report', source: 'observed', state: 'complete', at: 110 });
    view.frame();
    assert.equal(view.cards.get('parse_job').querySelector('[data-node-status]').textContent, '비회원 분석 기록 대기');
    assert.equal(view.cards.get('database').querySelector('[data-node-status]').textContent, '비회원 저장 기록 대기');
    assert.notEqual(view.cards.get('parse_job').dataset.state, 'failed');
    view.send({ ...event, id: 'member-start', node: 'evaluate', state: 'pending', source: 'observed', kind: 'action', at: 200 });
    view.frame();
    assert.equal(view.cards.get('report').dataset.state, 'idle');
  } finally { view.dispose(); }
});

test('41 projected live cards preserve the 40-card baseline, all raw events, and distinct non-self edges', async () => {
  assert.equal(catalog.FLOW_BASELINE_CARD_COUNT, 40);
  assert.equal(catalog.FLOW_VIEW_NODES.size, 41);
  assert.deepEqual(catalog.FLOW_VIEW_COLUMNS.map((column) => column.nodes.length), [12, 10, 12, 7]);
  for (const id of FLOW_NODES.keys()) assert.ok(catalog.FLOW_VIEW_NODES.has(catalog.projectFlowNode(id)), id);
  for (const action of [...demo.DEMO_ACTIONS, demo.getDemoAction('full')]) {
    const edges = catalog.projectFlowEdges(action.edges);
    assert.equal(new Set(edges.map((edge) => edge.join(':'))).size, edges.length);
    assert.ok(edges.every(([from, to]) => from !== to && catalog.FLOW_VIEW_NODES.has(from) && catalog.FLOW_VIEW_NODES.has(to)));
  }
  const view = await viewerFixture();
  try {
    assert.equal((view.host.innerHTML.match(/class="flow-node"/g) || []).length, 41);
    assert.equal([...view.cards.values()].filter((card) => !card.hidden).length, 41);
    const pending = { ...requestEvent('guest-analysis-request', 'pending', 10), node: 'api_guest_analysis' };
    view.snapshot({ events: [pending], states: [pending], session: { mode: 'guest' } });
    view.frame();
    assert.equal(view.cards.get('api_evaluation').dataset.state, 'pending');
    assert.deepEqual(view.active.at(-1), [{ node: 'api_evaluation', state: 'pending' }], 'snapshot restores ongoing motion at the projected card');
    view.select('api_evaluation');
    assert.match(view.element('[data-flow-detail]').innerHTML, /비회원 분석 요청/);
    assert.match(view.element('[data-flow-detail]').innerHTML, /회원 분석 요청/);
    assert.match(view.element('[data-flow-log]').innerHTML, /비회원 분석 요청/);
    view.send({ ...pending, state: 'complete', at: 20, durationMs: 10 });
    view.frame();
    assert.deepEqual(view.active.at(-1), []);
    assert.deepEqual(view.pulses.at(-1), ['api_evaluation', 'complete']);
  } finally { view.dispose(); }
});

test('viewer describes browser-wide observation with separate tab selection', async () => {
  const view = await viewerFixture();
  try {
    assert.equal(view.element('[data-flow-card-scope]').textContent, '전체 41개 · 통합 단계는 카드 선택');
    assert.doesNotMatch(view.host.innerHTML, /기존 40개|\+ 1/);
    assert.match(view.host.innerHTML, /새 앱 탭 열기/);
    assert.match(view.element('[data-flow-banner]').textContent, /같은 브라우저에서 CareerLens 앱을 열어 주세요/);
    assert.match(view.element('[data-flow-banner]').textContent, /새 탭의 로그인·로그아웃도 자동 추적/);
    assert.equal(view.element('[data-flow-scope]').textContent, '같은 브라우저의 앱 탭을 열어 주세요');
    assert.equal(view.cards.get('database').querySelector('[data-node-status]').textContent, '비회원 저장 기록 대기');
    view.snapshot({ events: [], states: [], session: { mode: 'member' } });
    view.frame();
    assert.match(view.element('[data-flow-banner]').textContent, /실시간 관찰/);
    assert.equal(view.element('[data-flow-scope]').textContent, '탭 1 · 회원 · 연결된 앱 탭 1개');
    assert.equal(view.cards.get('database').querySelector('[data-node-status]').textContent, '저장 기록 대기');
    view.disconnect();
    view.frame();
    assert.match(view.element('[data-flow-banner]').textContent, /같은 브라우저/);
  } finally { view.dispose(); }
});

test('new-tab authentication is live while original analysis polling never steals the selected cards', async () => {
  const view = await viewerFixture();
  const first = { stream: 'test-stream', publisher: 'first-publisher' };
  const second = { stream: 'second-stream', publisher: 'second-publisher' };
  try {
    const queue = { ...event, node: 'queue', state: 'pending', at: 10 };
    view.message({ ...first, kind: 'snapshot', events: [queue], states: [queue], session: { mode: 'member' } });
    view.frame();
    assert.equal(view.cards.get('queue').dataset.activity, 'pending');
    view.message({ ...second, kind: 'snapshot', events: [], states: [], session: { mode: 'member' } });
    view.frame();
    assert.match(view.element('[data-flow-scope]').textContent, /탭 1 · 회원 · 연결된 앱 탭 2개/);
    view.message({ ...second, kind: 'event', active: true, event: { ...event, node: 'logout', id: 'logout-newtab', source: 'observed', kind: 'action', state: 'complete', at: 20 } });
    view.message({ ...second, kind: 'event', active: true, event: { ...event, node: 'auth', id: 'guest-newtab', source: 'observed', kind: 'session', sessionMode: 'guest', state: 'complete', at: 21 } });
    view.frame();
    assert.equal(view.cards.get('queue').dataset.state, 'idle', 'the other tab does not inherit old analysis');
    assert.equal(view.cards.get('auth').querySelector('[data-node-status]').textContent, '비회원 확인');
    assert.equal(view.cards.get('logout').dataset.activity, 'complete');
    assert.match(view.element('[data-flow-scope]').textContent, /탭 2 · 비회원/);
    view.message({ ...first, kind: 'event', event: { ...requestEvent('poll', 'complete', 22), node: 'api_evaluation' } });
    view.frame();
    assert.match(view.element('[data-flow-scope]').textContent, /탭 2 · 비회원/);
    view.message({ ...second, kind: 'event', active: true, event: { ...event, node: 'auth', id: 'member-newtab', source: 'observed', kind: 'session', sessionMode: 'member', state: 'complete', at: 23 } });
    view.frame();
    assert.equal(view.cards.get('auth').querySelector('[data-node-status]').textContent, '회원 확인');
    view.elapse(1601);
    assert.equal(view.cards.get('auth').dataset.activity, 'idle');
    const pulses = view.pulses.length;
    view.source(first.publisher); view.frame();
    assert.equal(view.cards.get('queue').dataset.state, 'pending');
    assert.equal(view.pulses.length, pulses, 'pinning restores existing state without replaying traffic');
    view.message({ ...second, kind: 'active', at: 30 }); view.frame();
    assert.match(view.element('[data-flow-scope]').textContent, /탭 1/);
    view.source('auto');
    view.message({ ...second, kind: 'active', at: 31 }); view.frame();
    assert.match(view.element('[data-flow-scope]').textContent, /탭 2/);
    assert.equal(view.pulses.length, pulses, 'focus restores existing state without an artificial event');
    assert.equal(view.cards.get('auth').dataset.activity, 'idle');
  } finally { view.dispose(); }
});

test('pinned source reload reconnects its new document and subsequent login without replaying history', async () => {
  const view = await viewerFixture();
  const first = { stream: 'test-stream', publisher: 'first-publisher' };
  const reloaded = { ...first, publisher: 'reloaded-publisher' };
  try {
    const saved = { ...event, node: 'report', state: 'complete', source: 'observed', kind: 'action' };
    view.message({ ...first, kind: 'snapshot', events: [saved], states: [saved], session: { mode: 'member' } });
    view.source(first.publisher); view.frame();
    view.message({ ...first, kind: 'disconnected' }); view.frame();
    assert.match(view.element('[data-flow-banner]').textContent, /현재 앱 탭을 다시 선택하거나 자동 추적/);
    view.message({ ...reloaded, kind: 'snapshot', events: [], states: [], session: { mode: 'guest' } }); view.frame();
    assert.equal(view.element('[data-flow-source]').value, reloaded.publisher);
    assert.equal(view.element('[data-flow-connection]').textContent, '이용 탭 연결됨');
    assert.equal(view.cards.get('report').dataset.state, 'idle');
    assert.equal(view.cards.get('auth').dataset.activity, 'idle');
    assert.equal(view.pulses.length, 0);
    view.message({ ...reloaded, kind: 'event', active: true, event: { ...saved, id: 'reload-login', node: 'auth', kind: 'session', sessionMode: 'member', at: 200 } }); view.frame();
    assert.equal(view.cards.get('auth').querySelector('[data-node-status]').textContent, '회원 확인');
    assert.equal(view.pulses.length, 1);
    view.elapse(1601);
    assert.equal(view.cards.get('auth').dataset.activity, 'idle');
    assert.equal(view.element('[data-flow-source]').value, reloaded.publisher);
  } finally { view.dispose(); }
});

test('verified member state survives old guest records and subsequent authentication-page navigation', async () => {
  const view = await viewerFixture();
  const oldGuest = { ...event, id: 'old-guest', node: 'auth', state: 'complete', source: 'observed', kind: 'session', sessionMode: 'guest', at: 100 };
  try {
    view.snapshot({ events: [oldGuest], states: [oldGuest], session: { mode: 'member' } });
    view.frame();
    assert.equal(view.cards.get('auth').querySelector('[data-node-status]').textContent, '회원 확인');
    assert.equal(view.cards.get('auth').dataset.state, 'member');
    const navigation = { ...oldGuest, id: 'auth-navigation', kind: 'navigation', at: 200 };
    delete navigation.sessionMode;
    view.send(navigation);
    view.frame();
    assert.equal(view.cards.get('auth').querySelector('[data-node-status]').textContent, '회원 확인');
    assert.equal(view.cards.get('auth').querySelector('.flow-node-description').textContent, '최근 동작 · 화면 열림');
    assert.equal(view.element('[data-flow-scope]').textContent, '탭 1 · 회원 · 연결된 앱 탭 1개');
    view.select('auth');
    assert.match(view.element('[data-flow-detail]').innerHTML, /현재 인증 상태: 회원 확인/);
    assert.match(view.element('[data-flow-log]').innerHTML, /비회원 확인/);
    assert.match(view.element('[data-flow-log]').innerHTML, /화면 열림/);
  } finally { view.dispose(); }
});

test('a normalized session event immediately updates the header and authentication card without a heartbeat', async () => {
  const view = await viewerFixture();
  try {
    view.snapshot({ events: [], states: [], session: { mode: 'guest' } });
    view.frame();
    view.send({ ...event, id: 'member-session', node: 'auth', state: 'complete', kind: 'session', sessionMode: 'member', source: 'observed', at: 300 });
    view.frame();
    assert.equal(view.element('[data-flow-scope]').textContent, '탭 1 · 회원 · 연결된 앱 탭 1개');
    assert.equal(view.cards.get('auth').querySelector('[data-node-status]').textContent, '회원 확인');
  } finally { view.dispose(); }
});

test('duplicate events and snapshots do not pulse or reset current progress, while a real lifecycle change pulses', async () => {
  const view = await viewerFixture();
  const pending = requestEvent('single-request', 'pending', 100);
  try {
    view.send(pending); view.frame();
    assert.equal(view.pulses.length, 1);
    view.send(pending); view.frame();
    assert.equal(view.pulses.length, 1);
    view.snapshot({ events: [pending], states: [pending], session: { mode: 'guest' } }); view.frame();
    assert.equal(view.pulses.length, 1);
    const complete = { ...pending, state: 'complete', at: 200, durationMs: 100 };
    view.send(complete); view.frame();
    assert.deepEqual(view.pulses.at(-1), ['api_jobs', 'complete']);
    assert.equal(view.pulses.length, 2);
    view.send(complete); view.frame();
    assert.equal(view.pulses.length, 2);
    const start = { ...event, id: 'evaluation-start', node: 'evaluate', state: 'pending', kind: 'action', source: 'observed', at: 300 };
    view.send(start);
    view.send({ ...event, id: 'current-analysis', at: 400 });
    view.frame();
    view.send(start); view.frame();
    assert.equal(view.cards.get('analysis').dataset.state, 'running', 'an identical start must not clear newer progress');
  } finally { view.dispose(); }
});

test('delayed pending versions cannot undo completion or reset a more recent execution', async () => {
  const view = await viewerFixture();
  try {
    const complete = requestEvent('finished-request', 'complete', 200, 100);
    view.send(complete); view.frame();
    const pulses = view.pulses.length;
    for (const at of [100, 200]) {
      view.send({ ...complete, state: 'pending', at, durationMs: null }); view.frame();
      assert.equal(view.cards.get('api_jobs').dataset.state, 'complete');
      assert.equal(view.element('[data-flow-request-count]').textContent, '1개 요청');
      assert.equal(view.pulses.length, pulses, 'a delayed old version is not new traffic');
    }
    view.send({ ...event, id: 'new-start', node: 'evaluate', state: 'pending', kind: 'action', source: 'observed', at: 300 });
    view.send({ ...event, id: 'new-progress', at: 400 }); view.frame();
    const beforeOldStart = view.pulses.length;
    view.send({ ...event, id: 'unseen-old-start', node: 'evaluate', state: 'pending', kind: 'action', source: 'observed', at: 250 }); view.frame();
    assert.equal(view.cards.get('analysis').dataset.state, 'running');
    assert.equal(view.pulses.length, beforeOldStart);
  } finally { view.dispose(); }
});

test('every instrumented raw node updates its projected card and reconnects without replaying traffic', async () => {
  const view = await viewerFixture();
  try {
    const mapped = new Set();
    for (const node of OBSERVED_NODES) {
      const store = createFlowStore({ now: () => 100 });
      const projected = catalog.projectFlowNode(node);
      mapped.add(projected);
      view.snapshot(store.snapshot()); view.frame();
      store.subscribe((change) => change.kind === 'event' ? view.send(change.event) : view.snapshot(store.snapshot()));
      const options = { source: FLOW_NODES.get(node).telemetry || node === 'storage_ack' ? 'backend' : 'observed',
        kind: node.startsWith('api_') ? 'request' : 'action', ...(node === 'guest_store' ? { execution: 'guest' } : {}) };
      const handle = store.begin(node, options);
      view.frame();
      assert.equal(view.cards.get(projected).dataset.state, node === 'auth' ? 'guest' : 'pending', node);
      store.finish(handle); view.frame();
      assert.equal(view.cards.get(projected).dataset.state, node === 'auth' ? 'guest' : 'complete', node);
      view.select(projected);
      assert.ok(view.element('[data-flow-detail]').innerHTML.includes(FLOW_NODES.get(node).label), node);
      assert.ok(view.element('[data-flow-log]').innerHTML.includes(FLOW_NODES.get(node).label), node);
      const pulses = view.pulses.length;
      view.snapshot(store.snapshot()); view.frame();
      assert.equal(view.cards.get(projected).dataset.state, node === 'auth' ? 'guest' : 'complete', node);
      assert.equal(view.pulses.length, pulses, `${node}: a reconnect is state synchronization`);
    }
    assert.deepEqual([...catalog.FLOW_VIEW_NODES.keys()].filter((id) => !mapped.has(id)), ['archive'], 'archive remains explicitly uninstrumented');
    assert.equal(view.cards.get('archive').dataset.state, 'uncollected');
  } finally { view.dispose(); }
});

test('merged request cards keep genuinely concurrent requests active until every raw request finishes', async () => {
  const view = await viewerFixture();
  try {
    const analysis = { ...requestEvent('analysis-request', 'pending', 100), node: 'api_guest_analysis' };
    const service = { ...requestEvent('service-request', 'complete', 110, 5), node: 'api_guest_service' };
    view.send(analysis); view.send(service); view.frame();
    assert.equal(view.cards.get('api_evaluation').dataset.state, 'pending');
    view.send({ ...analysis, state: 'complete', at: 120, durationMs: 20 }); view.frame();
    assert.equal(view.cards.get('api_evaluation').dataset.state, 'complete');
    assert.deepEqual(view.active.at(-1), []);
    view.select('api_evaluation');
    assert.match(view.element('[data-flow-detail]').innerHTML, /비회원 서비스 확인/);
    assert.match(view.element('[data-flow-detail]').innerHTML, /비회원 분석 요청/);
  } finally { view.dispose(); }
});

test('parallel requests for the same raw node stay active until all retained requests finish or are reset', async () => {
  for (const central of [false, true]) {
    const view = await viewerFixture({ central });
    let clock = 100;
    const store = createFlowStore({ now: () => clock++ });
    let revision = 0;
    const sync = (overrides = {}) => {
      const snapshot = { ...store.snapshot(), ...overrides };
      if (central) view.remote({ ...snapshot, kind: 'snapshot', stream: 'same-node-stream', publisher: 'browser:same-node-publisher', at: 1000000, revision: ++revision }, { snapshot: true });
      else view.snapshot(snapshot);
      view.frame();
    };
    try {
      if (central) view.connection({ state: 'connected' });
      const older = store.begin('api_jobs', { kind: 'request' });
      const newer = store.begin('api_jobs', { kind: 'request' });
      store.finish(newer); sync();
      assert.equal(view.cards.get('api_jobs').dataset.state, 'pending');
      assert.deepEqual(view.active.at(-1), [{ node: 'api_jobs', state: 'pending' }]);
      view.select('api_jobs');
      assert.match(view.element('[data-flow-detail-state]').textContent, /요청 중/);

      store.finish(older); sync();
      assert.equal(view.cards.get('api_jobs').dataset.state, 'complete');
      assert.deepEqual(view.active.at(-1), []);

      store.begin('api_jobs', { kind: 'request' }); sync();
      assert.equal(view.cards.get('api_jobs').dataset.state, 'pending');
      sync({ states: [] });
      assert.equal(view.cards.get('api_jobs').dataset.state, 'idle');
      assert.deepEqual(view.active.at(-1), []);
    } finally { view.dispose(); }
  }
});

test('a replaced evaluation cannot revive a prior pending request after the new request finishes', async () => {
  for (const central of [false, true]) {
    const view = await viewerFixture({ central });
    const identity = { stream: 'new-run-stream', publisher: 'browser:new-run-publisher' };
    let revision = 0;
    const send = (event) => central ? view.remote({ ...identity, kind: 'event', at: 1000000, revision: ++revision, event }) : view.send(event);
    try {
      if (central) view.connection();
      send({ ...requestEvent('request-old', 'pending', 10), node: 'api_evaluation' });
      send({ ...requestEvent('evaluate-new', 'pending', 20), node: 'evaluate', kind: 'action' });
      send({ ...requestEvent('request-new', 'pending', 30), node: 'api_evaluation' });
      send({ ...requestEvent('request-new', 'complete', 40, 10), node: 'api_evaluation' });
      view.frame();
      assert.equal(view.cards.get('api_evaluation').dataset.state, 'complete');
      view.source(central ? identity.publisher : 'test-stream'); view.frame();
      assert.equal(view.cards.get('api_evaluation').dataset.state, 'complete', 'source reselection cannot restore the abandoned request');
    } finally { view.dispose(); }
  }
});

test('disconnect and stale heartbeat stop old motion until a fresh source snapshot restores current activity', async () => {
  const view = await viewerFixture();
  const running = { ...event, id: 'active-analysis' };
  try {
    view.snapshot({ events: [running], states: [running], session: { mode: 'guest' } }); view.frame();
    assert.deepEqual(view.active.at(-1), [{ node: 'analysis', state: 'running' }]);
    const beforeDisconnect = view.resets();
    view.disconnect();
    assert.equal(view.resets(), beforeDisconnect + 1, 'disconnect clears active motion immediately');
    view.frame();
    assert.deepEqual(view.active.at(-1), []);
    view.snapshot({ events: [running], states: [running], session: { mode: 'guest' } }); view.frame();
    assert.deepEqual(view.active.at(-1), [{ node: 'analysis', state: 'running' }]);
    const beforeStale = view.resets();
    view.elapse(12001); view.heartbeat();
    assert.equal(view.resets(), beforeStale + 1);
    assert.match(view.element('[data-flow-connection]').textContent, /연결 대기/);
    view.heartbeat();
    assert.equal(view.resets(), beforeStale + 1, 'an already-stopped stale source does not repeatedly reset');
    assert.equal(view.pulses.length, 0, 'snapshots restore ongoing state without replaying traffic');
  } finally { view.dispose(); }
});


test('new completion colours expire without changing outcome, duration, logs or selection details', async () => {
  const view = await viewerFixture();
  try {
    const done = requestEvent('fresh-completion', 'complete', 100, 120);
    view.send(done); view.frame();
    const card = view.cards.get('api_jobs');
    assert.equal(card.dataset.activity, 'complete');
    assert.equal(card.dataset.state, 'complete');
    view.select('api_jobs');
    const detail = view.element('[data-flow-detail]').innerHTML;
    const log = view.element('[data-flow-log]');
    const writes = log.writes;
    view.elapse(1500);
    assert.equal(card.dataset.activity, 'complete');
    view.elapse(101);
    assert.equal(card.dataset.activity, 'idle');
    assert.equal(card.dataset.state, 'complete');
    assert.equal(card.querySelector('[data-node-status]').textContent, '완료');
    assert.equal(card.querySelector('[data-node-value]').textContent, '120 ms');
    assert.equal(view.element('[data-flow-detail]').innerHTML, detail);
    assert.equal(log.writes, writes, 'expiry changes card appearance only');
    assert.equal(view.timeouts.size, 0);
    view.send(done); view.frame();
    assert.equal(card.dataset.activity, 'idle', 'duplicate completion must not relight a card');
    assert.equal(view.pulses.length, 1);
  } finally { view.dispose(); }
});

test('saved successful, failed and member states never light up from snapshots or heartbeats', async () => {
  const view = await viewerFixture();
  try {
    const values = [requestEvent('old-completion', 'complete', 100, 120),
      { ...requestEvent('old-failure', 'failed', 110, 20), node: 'api_auth' },
      { ...event, id: 'old-member', node: 'auth', state: 'complete', source: 'observed', kind: 'session', sessionMode: 'member' }];
    for (let iteration = 0; iteration < 3; iteration++) {
      view.snapshot({ events: values, states: values, session: { mode: 'member' } }); view.frame();
      view.heartbeat();
      for (const node of ['api_jobs', 'api_auth', 'auth']) assert.equal(view.cards.get(node).dataset.activity, 'idle', node);
    }
    assert.equal(view.cards.get('auth').dataset.state, 'member');
    assert.equal(view.cards.get('auth').querySelector('[data-node-status]').textContent, '회원 확인');
    assert.equal(view.cards.get('api_auth').dataset.state, 'failed');
    assert.equal(view.pulses.length, 0);
    assert.equal(view.timeouts.size, 0);
  } finally { view.dispose(); }
});

test('genuinely pending work stays coloured until completion while hidden and unfocused history never replays', async () => {
  const view = await viewerFixture();
  try {
    const pending = requestEvent('real-pending', 'pending', 100);
    view.send(pending); view.frame();
    const card = view.cards.get('api_jobs');
    assert.equal(card.dataset.activity, 'pending');
    view.elapse(5000);
    assert.equal(card.dataset.activity, 'pending');
    assert.equal(view.timeouts.size, 0, 'ongoing work requires no animation timer');
    view.visibility(true);
    assert.equal(card.dataset.activity, 'idle');
    view.visibility(false);
    assert.equal(card.dataset.activity, 'pending');
    assert.equal(view.pulses.length, 1, 'visibility does not invent another request');
    const done = { ...pending, state: 'complete', at: 200, durationMs: 100 };
    view.send(done); view.frame();
    assert.equal(card.dataset.activity, 'complete');
    view.blur();
    assert.equal(card.dataset.activity, 'idle');
    assert.equal(view.timeouts.size, 0);
    view.send({ ...done, id: 'new-visible-event', at: 300 }); view.frame();
    assert.equal(card.dataset.activity, 'complete', 'a visible side-by-side viewer still reacts to genuinely new traffic');
    view.visibility(true);
    assert.equal(card.dataset.activity, 'idle');
    assert.equal(view.timeouts.size, 0);
    view.visibility(false); view.frame();
    assert.equal(card.dataset.activity, 'idle');
  } finally { view.dispose(); }
});

test('snapshot replacement, disconnection and disposal cancel terminal card highlight timers', async () => {
  const view = await viewerFixture();
  const done = requestEvent('terminal-card', 'complete', 100, 120);
  view.send(done); view.frame();
  assert.equal(view.timeouts.size, 1);
  view.snapshot({ events: [done], states: [done], session: { mode: 'guest' } }); view.frame();
  assert.equal(view.timeouts.size, 0);
  assert.equal(view.cards.get('api_jobs').dataset.activity, 'idle');
  view.send({ ...done, id: 'another-terminal', at: 200 }); view.frame();
  view.disconnect();
  assert.equal(view.timeouts.size, 0);
  assert.equal(view.cards.get('api_jobs').dataset.activity, 'idle');
  view.send({ ...done, id: 'last-terminal', at: 300 }); view.frame();
  assert.equal(view.timeouts.size, 1);
  view.dispose();
  assert.equal(view.timeouts.size, 0);
});

test('card CSS colours follow activity rather than historical data-state in both themes', async () => {
  const css = await readFile(new URL('../../src/shared/styles/activity-flow.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.flow-node(?:\[|:is\(\[)data-state=/);
  assert.match(css, /\.flow-node\[data-activity=complete\]/);
  assert.match(css, /data-flow-theme=light[^\n]+data-activity=complete/);
  assert.match(css, /data-activity=idle[^\n]+\.flow-node-light/);
});

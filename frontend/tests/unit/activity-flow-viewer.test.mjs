import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as catalog from '../../src/features/activity-flow/catalog.js';
import * as demo from '../../src/features/activity-flow/demo.js';
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

async function viewerFixture() {
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
  const lifecycle = new Map();
  const pulses = [];
  const active = [];
  const edges = [];
  const intervals = [];
  let clockNow = 1_000_000;
  let resets = 0;
  let nextFrame = 0;
  let message;
  let formatterCount = 0;
  const document = {
    hidden: false,
    body: new Element(),
    addEventListener: (name, handler) => lifecycle.set(name, handler),
    removeEventListener: (name) => lifecycle.delete(name),
  };
  const context = vm.createContext({
    ...catalog, ...demo, FLOW_RUN_NODES, URLSearchParams, document,
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
      addEventListener() {}, removeEventListener() {},
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
  const dispose = context.mountFlowViewer(host);
  return {
    host, cards, frames, pulses, active, edges, document, dispose,
    resets: () => resets,
    heartbeat: () => intervals.find((entry) => entry.ms === 4000).callback(),
    elapse: (ms) => { clockNow += ms; },
    element: (selector) => host.querySelector(selector),
    formatterCount: () => formatterCount,
    send: (value) => message({ data: { kind: 'event', stream: 'test-stream', event: value } }),
    snapshot: (value) => message({ data: { kind: 'snapshot', stream: 'test-stream', ...value } }),
    disconnect: () => message({ data: { kind: 'disconnected', stream: 'test-stream' } }),
    frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(1000)); },
    visibility(hidden) { document.hidden = hidden; lifecycle.get('visibilitychange')(); },
    mode(value) { host.querySelector('[data-flow-mode]').handlers.get('change')({ target: { value } }); },
    select(id) { host.handlers.get('click')({ target: { closest: (selector) => selector === '[data-flow-node]' ? cards.get(id) : null } }); },
  };
}

const requestEvent = (id, state, at, durationMs = null) => ({
  id, node: 'api_jobs', kind: 'request', source: 'observed', state, at, durationMs, progress: null, method: 'GET',
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

test('viewer offers source-tab reconnection guidance without merging a newly opened app tab', async () => {
  const view = await viewerFixture();
  try {
    assert.equal(view.element('[data-flow-card-scope]').textContent, '전체 41개 · 통합 단계는 카드 선택');
    assert.doesNotMatch(view.host.innerHTML, /기존 40개|\+ 1/);
    assert.match(view.host.innerHTML, /새 앱 탭 열기/);
    assert.match(view.element('[data-flow-banner]').textContent, /원래 앱 탭에서 이용 흐름 링크를 다시 열어 주세요/);
    assert.match(view.element('[data-flow-banner]').textContent, /자동으로 연결되지 않습니다/);
    assert.equal(view.element('[data-flow-scope]').textContent, '원래 앱 탭을 확인해 주세요');
    assert.equal(view.cards.get('database').querySelector('[data-node-status]').textContent, '비회원 저장 기록 대기');
    view.snapshot({ events: [], states: [], session: { mode: 'member' } });
    view.frame();
    assert.match(view.element('[data-flow-banner]').textContent, /실시간 관찰/);
    assert.equal(view.element('[data-flow-scope]').textContent, '회원 · 연결된 브라우저 탭 1개');
    assert.equal(view.cards.get('database').querySelector('[data-node-status]').textContent, '저장 기록 대기');
    view.disconnect();
    view.frame();
    assert.match(view.element('[data-flow-banner]').textContent, /원래 앱 탭/);
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
    assert.equal(view.element('[data-flow-scope]').textContent, '회원 · 연결된 브라우저 탭 1개');
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
    assert.equal(view.element('[data-flow-scope]').textContent, '회원 · 연결된 브라우저 탭 1개');
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

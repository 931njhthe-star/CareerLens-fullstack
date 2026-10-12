// Browser-observed metadata only. Never pass application payloads into this store.
import { BACKEND_FLOW_NODES, GUEST_FLOW_NODES, stageForFlow } from './backend-progress.js';
export const FLOW_NODES = Object.freeze([
  'visit', 'auth', 'resume', 'role', 'posting', 'api_auth', 'api_resume',
  'api_jobs', 'api_evaluation', 'api_report', 'queue', 'analysis', 'report',
  'signup', 'logout', 'session', 'cancel', 'history', 'dashboard', 'evaluate',
  'api_signup', 'api_session', 'api_cancel', 'api_dashboard', 'api_convert',
  'input_check', 'local_data', 'notice', 'storage_ack', 'parse_resume', 'parse_job',
  'indexing', 'domain_a', 'domain_b', 'domain_c', 'domain_d', 'validation', 'scoring', 'database',
  'api_guest_service', 'api_guest_analysis', 'api_guest_claim', 'api_guest_reports',
  'guest_store', 'report_lock', 'guest_claim', 'result_delivery', 'guest_cleanup',
]);
export const FLOW_STATES = Object.freeze(['pending', 'running', 'complete', 'failed', 'cancelled', 'partial', 'blocked', 'waiting', 'expired', 'cleared', 'empty']);
export const FLOW_KINDS = Object.freeze(['action', 'request', 'navigation', 'progress', 'session']);
export const FLOW_SOURCES = Object.freeze(['observed', 'backend', 'demo']);
export const FLOW_CHANNEL = 'careerlens.flow.v1';
// Current-run cards are replaced together. Historical rows remain in the bounded
// log, but neither a heartbeat snapshot nor an old response may revive them.
export const FLOW_RUN_NODES = Object.freeze([...new Set([
  ...BACKEND_FLOW_NODES, ...GUEST_FLOW_NODES,
  'evaluate', 'report', 'report_lock', 'guest_claim', 'result_delivery', 'guest_cleanup',
  'api_evaluation', 'api_report', 'api_guest_analysis', 'api_guest_claim', 'api_guest_reports',
  'cancel', 'api_cancel',
])]);

const allowed = (values, value, fallback) => values.includes(value) ? value : fallback;
const progressValue = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;

/** A bounded metadata store. Its clock and listener are injectable; no browser APIs are needed. */
export function createFlowStore({ now = Date.now, limit = 100, inflightLimit = 24 } = {}) {
  const maximum = Math.min(100, Math.max(1, Number.isSafeInteger(limit) ? limit : 100));
  const maximumInflight = Math.min(maximum, Math.max(1, Number.isSafeInteger(inflightLimit) ? inflightLimit : 24));
  const events = [];
  const latest = new Map();
  const inflight = new Map();
  const listeners = new Set();
  let sequence = 0;
  let mode = 'guest';
  const timestamp = () => {
    const value = now();
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const snapshot = () => ({ events: events.map((event) => ({ ...event })), states: [...latest.values()].map((event) => ({ ...event })), session: { mode }, at: timestamp() });
  function emit(change) {
    for (const listener of listeners) {
      try { listener(change.kind === 'event' ? { kind: 'event', event: { ...change.event } } : { kind: 'snapshot' }); }
      catch { /* Observation must never interrupt the application. */ }
    }
  }
  function remove(id) {
    const pending = events.find((event) => event.id === id);
    const removedState = pending?.state === 'pending' && latest.get(pending.node)?.id === id;
    if (removedState) latest.delete(pending.node);
    inflight.delete(id);
    const index = events.findIndex((event) => event.id === id);
    if (index !== -1) events.splice(index, 1);
    return removedState;
  }
  function resetRun() {
    for (const id of FLOW_RUN_NODES) latest.delete(id);
    for (const id of inflight.keys()) {
      const previous = events.find((event) => event.id === id);
      if (previous && FLOW_RUN_NODES.includes(previous.node)) remove(id);
    }
  }
  function clearActiveProgress() {
    let changed = false;
    for (const [node, event] of latest) {
      if (node === 'analysis' || !(BACKEND_FLOW_NODES.includes(node) || GUEST_FLOW_NODES.includes(node))
        || event.kind !== 'progress' || !['pending', 'running'].includes(event.state)) continue;
      // A terminal run cannot still be executing a step. Its last observation
      // remains in history; an absent step result must not become a fake success
      // or identify this step as the cause of the run's failure.
      latest.delete(node);
      changed = true;
    }
    if (changed) emit({ kind: 'snapshot' });
  }
  function record(node, { state = 'complete', kind = 'action', source = 'observed', progress = null, method, criterion, execution, durationMs } = {}) {
    if (!FLOW_NODES.includes(node)) return null;
    if (node === 'evaluate' && state === 'pending') resetRun();
    const event = {
      id: `event-${++sequence}`, node,
      kind: allowed(FLOW_KINDS, kind, 'action'),
      state: allowed(FLOW_STATES, state, 'complete'),
      source: allowed(FLOW_SOURCES, source, 'observed'),
      at: timestamp(), durationMs: null, progress: progressValue(progress),
    };
    if (event.kind === 'session') event.sessionMode = mode;
    if (execution === 'guest') event.execution = 'guest';
    if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= 86400000) event.durationMs = durationMs;
    if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) event.method = method;
    if (typeof criterion === 'string' && /^domain_[a-d]$/.test(node) && new RegExp(`^${node.at(-1).toUpperCase()}[1-3]$`).test(criterion)) event.criterion = criterion;
    events.push(event);
    latest.set(node, event);
    let removedState = false;
    while (events.length > maximum) removedState = remove(events[0].id) || removedState;
    // Eviction can remove a pending card as well as a log row. Send its complete
    // replacement immediately, rather than leaving observers pending until the
    // next heartbeat. No fabricated success or cancellation is recorded.
    emit(removedState ? { kind: 'snapshot' } : { kind: 'event', event });
    return event.id;
  }
  function begin(node, options = {}) {
    if (!FLOW_NODES.includes(node)) return null;
    let removedState = false;
    while (inflight.size >= maximumInflight) removedState = remove(inflight.keys().next().value) || removedState;
    if (removedState) emit({ kind: 'snapshot' });
    const id = record(node, { kind: options.kind, source: options.source, method: options.method, execution: options.execution, state: 'pending' });
    inflight.set(id, events.find((event) => event.id === id).at);
    return id;
  }
  function finish(id, { state = 'complete', progress = null } = {}) {
    if (!inflight.has(id)) return false;
    const event = events.find((item) => item.id === id);
    const started = inflight.get(id);
    inflight.delete(id);
    if (!event) return false;
    event.at = timestamp();
    event.durationMs = Math.max(0, event.at - started);
    event.state = allowed(FLOW_STATES.filter((value) => !['pending', 'running'].includes(value)), state, 'complete');
    event.progress = progressValue(progress);
    // An older request can finish after a newer request of the same kind. Its
    // history may finish, but the current card belongs to the newer request.
    const current = !latest.has(event.node) || latest.get(event.node)?.id === id;
    if (current) latest.set(event.node, event);
    emit(current ? { kind: 'event', event } : { kind: 'snapshot' });
    return true;
  }
  function setSession(nextMode, { resetRun: reset = false } = {}) {
    const next = allowed(['guest', 'member', 'demo'], nextMode, 'guest');
    if (reset) resetRun();
    if (next === mode && !reset) return;
    mode = next;
    emit({ kind: 'snapshot' });
  }
  return {
    begin, finish, record, snapshot, setSession, clearActiveProgress,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/** Classification discards all path parameters and queries before anything is recorded. */
export function classifyFlowRequest(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null;
  const clean = path.split(/[?#]/, 1)[0];
  if (clean === '/local-guest/capabilities') return 'api_guest_service';
  if (/^\/local-guest\/analyses\/(?:cancel-pending|[^/]+\/cancel)$/.test(clean)) return 'api_cancel';
  if (/^\/local-guest\/analyses\/[^/]+\/claim$/.test(clean)) return 'api_guest_claim';
  if (/^\/local-guest\/analyses(?:\/[^/]+)?$/.test(clean)) return 'api_guest_analysis';
  if (/^\/local-guest\/reports(?:\/[^/]+)?$/.test(clean)) return 'api_guest_reports';
  if (/^\/auth\/(signup|register)$/.test(clean)) return 'api_signup';
  if (/^\/auth\/(session|refresh)$/.test(clean) || clean === '/me') return 'api_session';
  if (clean === '/local-data/convert-resume') return 'api_convert';
  if (/^\/evaluations\/[^/]+\/cancel$/.test(clean)) return 'api_cancel';
  if (/^\/admin\/evaluation-performance(?:\/[^/]+)?$/.test(clean)) return 'api_dashboard';
  if (/^\/evaluations\/[^/]+\/result$/.test(clean)) return 'api_report';
  if (/^\/auth\/(session|login|signup|register|logout|refresh|forgot-password|reset-password)$/.test(clean) || clean === '/me') return 'api_auth';
  if (/^\/(resumes(?:\/[^/]+)?|resume(?:\/upload)?|guest\/resume\/upload|local-data\/convert-resume)$/.test(clean)) return 'api_resume';
  if (/^\/(jobs(?:\/[^/]+)?|companies\/[^/]+|career-roles|career-target|job-postings(?:\/[^/]+(?:\/select)?)?|guest\/career-target|local-data\/career-markdown)$/.test(clean)) return 'api_jobs';
  if (/^\/(evaluations(?:\/[^/]+(?:\/(progress|result|cancel))?)?|analysis)$/.test(clean)) return 'api_evaluation';
  if (/^\/(reports(?:\/[^/]+)?|account\/reports(?:\/[^/]+)?)$/.test(clean)) return 'api_report';
  return null;
}

const store = createFlowStore();
export function beginFlowEvent(node, options) {
  if (node === 'analysis' || node === 'evaluate') { previousProgress = ''; previousBackendEvent = 0; backendStates.clear(); }
  return store.begin(node, options);
}
export const finishFlowEvent = (...args) => store.finish(...args);
export const recordFlowEvent = (...args) => store.record(...args);
export function setFlowSession(mode, options) {
  if (options?.resetRun) { previousProgress = ''; previousBackendEvent = 0; backendStates.clear(); }
  store.setSession(mode, options);
}
export const flowSnapshot = () => store.snapshot();

let previousProgress = '';
let previousBackendEvent = 0;
const backendStates = new Map();
export function observeFlowProgress(update, { demo = false } = {}) {
  const run = update?.run;
  if (!run || typeof run !== 'object') return;
  const status = allowed(['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'], run.status, null);
  if (!status) return;
  // A stale stage name must not override the server's current lifecycle status.
  const node = status === 'queued' ? 'queue' : 'analysis';
  const state = { queued: 'pending', running: 'running', completed: 'complete', partial: 'partial', failed: 'failed', cancelled: 'cancelled' }[status];
  // The adapter's initial queue notification uses a local zero placeholder.
  // Do not present that placeholder as a measured backend percentage.
  const progress = node === 'queue' ? null : progressValue(run.progress_percent);
  const source = demo ? 'demo' : 'backend';
  const execution = update.execution === 'guest' ? 'guest' : undefined;
  // The adapter supplies only sanitized worker metadata, never raw event messages.
  for (const event of (Array.isArray(update.flowEvents) ? update.flowEvents : []).slice(0, 100)) {
    if (!Number.isSafeInteger(event?.id) || event.id <= previousBackendEvent || !(execution === 'guest' ? GUEST_FLOW_NODES : BACKEND_FLOW_NODES).includes(event.node)
      || !['running', 'complete', 'failed', 'cancelled'].includes(event.state)) continue;
    previousBackendEvent = event.id;
    const key = `${event.node}:${typeof event.criterion === 'string' ? event.criterion : ''}`;
    if (backendStates.get(key) === event.state) continue;
    backendStates.set(key, event.state);
    recordFlowEvent(event.node, { state: event.state, kind: 'progress', source, execution, criterion: event.criterion, durationMs: event.durationMs });
  }
  const queue = store.snapshot().states.find((event) => event.node === 'queue');
  if (status !== 'queued' && queue?.kind === 'progress' && ['pending', 'running'].includes(queue.state)) {
    // Running or terminal status proves waiting has ended, not that a measured
    // queue task succeeded. Do not manufacture a queue duration or percentage.
    recordFlowEvent('queue', { state: 'cleared', kind: 'progress', source, execution });
  }
  // current_stage is broad (validation also includes saving). Only event metadata
  // can prove a specific internal step; the fallback updates overall progress only.
  const stage = status === 'running' ? stageForFlow(run.current_stage) : null;
  const signature = `${node}:${state}:${progress}:${source}:${stage || ''}:${execution || ''}`;
  if (signature !== previousProgress) {
    previousProgress = signature;
    recordFlowEvent(node, { state, kind: 'progress', source, progress, execution,
      ...(execution === 'guest' && ['complete', 'partial'].includes(state) ? { durationMs: update.durationMs } : {}) });
  }
  if (['completed', 'partial', 'failed', 'cancelled'].includes(status)) store.clearActiveProgress();
}

function randomStream() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }
  return null;
}

let launcherDisposer;
let sourceStream;
const STREAM_KEY = 'careerlens.flow.tab.v1';
function tabStream() {
  try {
    const saved = sessionStorage.getItem(STREAM_KEY);
    if (/^[a-zA-Z0-9_-]{8,100}$/.test(saved || '')) return saved;
    const created = randomStream();
    if (created) sessionStorage.setItem(STREAM_KEY, created);
    return created;
  } catch { return randomStream(); }
}

/** Opens observation for this application tab; no credentials or resource IDs in the URL. */
export function getFlowViewerUrl() {
  return sourceStream ? `/?view=flow&stream=${encodeURIComponent(sourceStream)}` : null;
}

/** Same-origin metadata channel. Only a random tab key survives a reload, never event data. */
export function mountFlowLauncher() {
  if (launcherDisposer) return launcherDisposer;
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  const stream = tabStream();
  if (!stream || typeof BroadcastChannel === 'undefined') return () => {};
  let channel;
  function send(message) {
    try { channel?.postMessage(message); } catch { /* A closed observer is harmless. */ }
  }
  const snapshot = () => send({ kind: 'snapshot', stream, ...store.snapshot() });
  function connect() {
    if (channel) return;
    try {
      channel = new BroadcastChannel(FLOW_CHANNEL);
      channel.addEventListener('message', ({ data }) => {
        if (data?.kind === 'subscribe' && data.stream === stream) snapshot();
      });
      snapshot();
    } catch { channel = undefined; }
  }
  function disconnect() {
    send({ kind: 'disconnected', stream });
    channel?.close(); channel = undefined;
  }
  const unsubscribe = store.subscribe((change) => {
    if (change.kind === 'event') send({ kind: 'event', stream, event: change.event });
    else snapshot();
  });
  function resume(event) { if (event.persisted) connect(); }
  window.addEventListener('pagehide', disconnect);
  window.addEventListener('pageshow', resume);
  connect();
  sourceStream = channel ? stream : null;
  launcherDisposer = () => {
    disconnect(); unsubscribe(); sourceStream = null;
    window.removeEventListener('pagehide', disconnect);
    window.removeEventListener('pageshow', resume);
    launcherDisposer = undefined;
  };
  return launcherDisposer;
}

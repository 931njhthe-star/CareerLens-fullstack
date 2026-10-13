import { normalizeFlowEvent } from './catalog.js';

// Observation is best effort and must never hold up a product request. Only
// allowlisted metadata enters this channel; credentials stay in the API client.
const requestApi = async (...args) => (await import('../../shared/api/client.js')).api(...args);
const key = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value);
const timer = (callback, delay) => { const handle = setTimeout(callback, delay); handle?.unref?.(); return handle; };

export function cleanFlowEnvelope(value) {
  if (!value || !['event', 'snapshot', 'disconnected'].includes(value.kind)
    || !Number.isSafeInteger(value.revision) || value.revision < 0) return null;
  if (value.kind === 'snapshot' && value.session?.mode === 'demo') return null;
  const clean = { kind: value.kind, revision: value.revision };
  if (Number.isFinite(value.at) && value.at >= 0) clean.at = value.at;
  if (value.kind === 'event') {
    const event = normalizeFlowEvent(value.event);
    if (!event) return null;
    clean.event = event;
    clean.active = value.active === true;
  }
  if (value.kind === 'snapshot') {
    clean.events = (Array.isArray(value.events) ? value.events : []).slice(-100).map((item) => normalizeFlowEvent(item)).filter(Boolean);
    clean.states = (Array.isArray(value.states) ? value.states : []).slice(0, 64).map((item) => normalizeFlowEvent(item)).filter(Boolean);
    clean.session = { mode: value.session?.mode === 'member' ? 'member' : 'guest' };
  }
  return clean;
}

/** Independent document queue, ordered batches and exponential retry. */
export function createFlowPublisher({ stream, publisher, request = requestApi, schedule = timer,
  unschedule = clearTimeout, onStatus = () => {}, capacity = 1000 } = {}) {
  const queue = [];
  let stopped = false, pending = null, controller = null, failures = 0, dropped = 0;
  const valid = key(stream) && key(publisher);
  const report = (state) => { try { onStatus({ state, queued: queue.length, dropped }); } catch {} };
  function plan(delay = 250) {
    if (!valid || stopped || pending !== null || controller || !queue.length) return;
    pending = schedule(() => { pending = null; void flush(); }, delay);
  }
  async function flush({ keepalive = false } = {}) {
    if (!valid || stopped || controller || !queue.length) return;
    controller = new AbortController();
    const current = controller;
    let timedOut = false;
    const deadline = schedule(() => { timedOut = true; current.abort(); }, 15000);
    const batch = [];
    let bytes = 0;
    for (const item of queue.slice(0, 25)) {
      const size = new TextEncoder().encode(JSON.stringify(item)).length;
      if (batch.length && bytes + size > 60000) break;
      batch.push(item); bytes += size;
    }
    try {
      const result = await request('/flow/events', { method: 'POST', body: { stream, publisher, batch, client_dropped: dropped }, signal: current.signal, keepalive });
      if (stopped) return;
      if (result?.available === false) throw new Error('flow_unavailable');
      queue.splice(0, batch.length);
      failures = 0;
      report('connected');
    } catch (error) {
      if (!stopped && (timedOut || error?.name !== 'AbortError')) { failures++; report('retrying'); }
    } finally {
      unschedule(deadline);
      if (controller === current) controller = null;
      plan(failures ? Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5)) : 50);
    }
  }
  return {
    enqueue(value) {
      if (stopped || !valid) return;
      const clean = cleanFlowEnvelope(value);
      if (!clean) return;
      // Never mutate the active batch while it is being acknowledged.
      if (queue.length >= Math.max(25, capacity)) { dropped++; report('overflow'); return; }
      queue.push(clean); plan();
    },
    flush,
    status: () => ({ queued: queue.length, dropped }),
    dispose() { stopped = true; if (pending !== null) unschedule(pending); pending = null; controller?.abort(); queue.length = 0; },
  };
}

/** Cursor polling works through ordinary proxies and across API/worker replicas.
 * Snapshots never replay historic animation. A gap is explicit and resynchronizes
 * current states instead of silently claiming a complete event history.
 */
export function createCentralFlowMonitor({ request = requestApi, schedule = timer, unschedule = clearTimeout,
  onEnvelope = () => {}, onReset = () => {}, onStatus = () => {}, interval = 1000 } = {}) {
  let disposed = false, paused = true, pending = null, controller = null, generation = 0;
  let cursor = null, initialized = false, failures = 0, received = 0, gaps = 0, catchingUp = false;
  let status = { state: 'connecting', scope: null, sources: 0, received: 0, gaps: 0 };
  const emit = (change) => { status = { ...status, ...change, received, gaps }; onStatus({ ...status }); };
  function plan(delay = interval) {
    if (disposed || paused || pending !== null || controller) return;
    pending = schedule(() => { pending = null; void poll(); }, delay);
  }
  async function poll() {
    if (disposed || paused || controller) return;
    const currentGeneration = generation;
    const current = new AbortController(); controller = current;
    let timedOut = false;
    async function pageRequest(path) {
      // A 5,000-source bootstrap may span many healthy requests. Bound each
      // response, not the entire paginated operation, or it can never finish.
      const deadline = schedule(() => { timedOut = true; current.abort(); }, 15000);
      try { return await request(path, { signal: current.signal }); }
      finally { unschedule(deadline); }
    }
    const alive = () => !disposed && !paused && generation === currentGeneration && !current.signal.aborted;
    let more = false;
    try {
      if (!initialized) {
        onReset();
        let offset = 0, firstCursor = null, total = 0;
        do {
          const page = await pageRequest(`/flow/sources?limit=100&offset=${offset}`);
          if (!alive()) return;
          if (page?.available === false || !Array.isArray(page?.sources)) throw new Error('flow_unavailable');
          if (offset === 0) firstCursor = page.cursor;
          total = Math.max(total, Number.isSafeInteger(page.total) ? page.total : 0);
          for (const envelope of page.sources) onEnvelope(envelope, { snapshot: true });
          offset += page.sources.length;
          emit({ state: 'connecting', scope: page.scope, sources: total });
          if (!page.has_more || !page.sources.length || offset >= 5000) break;
        } while (alive());
        if (!alive()) return;
        cursor = typeof firstCursor === 'string' || Number.isSafeInteger(firstCursor) ? String(firstCursor) : '0';
        initialized = true;
      }
      const page = await pageRequest(`/flow/events?cursor=${encodeURIComponent(cursor)}&limit=200`);
      if (!alive()) return;
      if (page?.available === false || !Array.isArray(page?.events)) throw new Error('flow_unavailable');
      if (page.gap) {
        gaps++; initialized = false;
        emit({ state: 'resyncing', scope: page.scope });
        more = true;
      } else {
        for (const row of page.events) {
          if (row?.envelope) {
            onEnvelope(row.envelope, { snapshot: catchingUp || row.envelope.kind !== 'event', id: row.id });
            if (row.envelope.kind === 'event') received++;
          }
        }
        if (typeof page.cursor === 'string' || Number.isSafeInteger(page.cursor)) cursor = String(page.cursor);
        more = page.has_more === true;
        catchingUp = catchingUp && more;
        emit({ state: 'connected', scope: page.scope, sources: Math.max(status.sources, Number.isSafeInteger(page.total_sources) ? page.total_sources : 0) });
      }
      failures = 0;
    } catch (error) {
      if (disposed || paused || generation !== currentGeneration || (!timedOut && error?.name === 'AbortError')) return;
      if (error?.status === 401 || error?.status === 403) { paused = true; emit({ state: 'unauthorized' }); }
      else { failures++; catchingUp = true; emit({ state: 'retrying' }); }
    } finally {
      if (controller === current) controller = null;
      plan(failures ? Math.min(30000, interval * 2 ** Math.min(failures, 5)) : more ? 0 : interval);
    }
  }
  return {
    start() { if (disposed) return; if (paused && initialized) catchingUp = true; paused = false; plan(0); },
    pause() { paused = true; generation++; if (pending !== null) unschedule(pending); pending = null; controller?.abort(); controller = null; },
    restart() { this.pause(); initialized = false; cursor = null; failures = 0; catchingUp = false; this.start(); },
    status: () => ({ ...status }),
    poll,
    dispose() { this.pause(); disposed = true; },
  };
}

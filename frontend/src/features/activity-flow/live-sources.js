import { normalizeFlowEvent } from './catalog.js';
import { FLOW_RUN_NODES, FLOW_NODES } from './events.js';

const validKey = (value) => typeof value === 'string' && /^(?:(?:browser|worker|guest):)?[a-zA-Z0-9_-]{8,100}$/.test(value);
const activeStates = new Set(['pending', 'running', 'queued']);
const sessionModes = new Set(['guest', 'member', 'demo']);
const sameEvent = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Same-browser observation only. Each document owns a separate bounded ledger.
 * Authentication and analysis are never copied into another application tab.
 */
export function createLiveFlowSources({ initialStream = null, now = Date.now, limit = 16, central = false, paired = false } = {}) {
  const sources = new Map();
  const maximum = Math.max(2, Math.min(central ? 5000 : 24, Number.isInteger(limit) ? limit : 16));
  let evicted = 0;
  let sequence = 0;
  let selected = null;
  let selection = 'auto';
  let lastActivityAt = -1;

  function view(source) {
    if (!source) return null;
    return {
      key: source.key, stream: source.stream, label: source.label,
      relatedPublisher: source.relatedPublisher,
      dropped: source.dropped || 0,
      updatedAt: source.updatedAt,
      events: source.events.map((event) => ({ ...event })),
      states: [...source.states.values()].map((event) => ({ ...event })),
      session: source.mode ? { mode: source.mode } : {},
      connectedAt: source.connectedAt, connected: source.connected,
    };
  }

  function updateEvent(source, value) {
    const event = normalizeFlowEvent(value);
    if (!event) return null;
    const index = source.events.findIndex((previous) => previous.id === event.id);
    const previous = source.events[index];
    if (previous && ((!central && event.at < previous.at)
      || ((central || event.at === previous.at) && !activeStates.has(previous.state) && activeStates.has(event.state))
      || sameEvent(previous, event))) return null;
    const current = source.states.get(event.node);
    const updatesCurrent = central || !current || event.at >= current.at;
    if (updatesCurrent && event.node === 'evaluate' && event.state === 'pending') {
      for (const node of FLOW_RUN_NODES) source.states.delete(node);
      source.events = source.events.filter((item) => !(FLOW_RUN_NODES.includes(item.node) && item.kind === 'request' && activeStates.has(item.state)));
    }
    if (updatesCurrent) source.states.set(event.node, event);
    if (updatesCurrent && event.node === 'analysis' && ['complete', 'partial', 'failed', 'cancelled'].includes(event.state)) {
      for (const [node, previous] of source.states) {
        if (node !== 'analysis' && FLOW_RUN_NODES.includes(node) && previous.kind === 'progress' && activeStates.has(previous.state)) source.states.delete(node);
      }
    }
    if (updatesCurrent && event.kind === 'session' && event.sessionMode) source.mode = event.sessionMode;
    const retainedIndex = source.events.findIndex((item) => item.id === event.id);
    if (retainedIndex !== -1) source.events.splice(retainedIndex, 1);
    source.events.push(event);
    if (!central) source.events.sort((a, b) => a.at - b.at);
    source.events = source.events.slice(-100);
    // Late replies still complete their own history row; the viewer retains the
    // newer card state and suppresses their pulse using the same time ordering.
    return event;
  }

  function receive(data) {
    if (!data || !validKey(data.stream) || !['snapshot', 'event', 'active', 'disconnected'].includes(data.kind)) return null;
    if (data.publisher !== undefined && !validKey(data.publisher)) return null;
    if (data.revision !== undefined && (!Number.isSafeInteger(data.revision) || data.revision < 0)) return null;
    if (data.kind === 'snapshot' && !Array.isArray(data.events)) return null;
    if (data.kind === 'event' && !normalizeFlowEvent(data.event)) return null;
    const key = data.publisher || data.stream;
    if (paired && (!initialStream || data.stream !== initialStream)) return null;
    if (paired && selected && selected !== key) {
      // A pair owns exactly one live document. Only an explicit departure can
      // hand its observer to the reloaded original document.
      if (sources.get(selected)?.connected || data.kind !== 'snapshot') return null;
      sources.clear(); selected = null; selection = 'auto'; lastActivityAt = -1;
    }
    let source = sources.get(key);
    if (source && source.stream !== data.stream) return null;
    if (!source) {
      // Unobserved disconnects cannot evict a useful live source.
      if (data.kind === 'disconnected') return null;
      while (sources.size >= maximum) {
        const oldest = [...sources.values()].filter((item) => item.key !== selected)
          .sort((a, b) => a.connectedAt - b.connectedAt)[0];
        if (!oldest) return null;
        sources.delete(oldest.key);
        evicted++;
      }
      source = { key, stream: data.stream, label: `${central ? key.startsWith('worker:') ? '회원 분석' : key.startsWith('guest:') ? '비회원 분석' : '브라우저' : '탭'} ${++sequence}`, created: sequence, events: [], states: new Map(),
        mode: null, connectedAt: 0, connected: false, revision: -1, replacementAfter: null };
      sources.set(key, source);
    }
    if (data.revision !== undefined) {
      if (!Number.isSafeInteger(data.revision) || data.revision < 0 || data.revision <= source.revision) return null;
      source.revision = data.revision;
    }
    const before = selected;
    source.updatedAt = central && Number.isFinite(data.at) && data.at >= 0 ? Math.min(data.at, now()) : now();
    if (central && Number.isSafeInteger(data.client_dropped) && data.client_dropped >= 0) source.dropped = data.client_dropped;
    if (central && /^(?:worker|guest):/.test(key) && typeof data.related_publisher === 'string'
      && /^browser:[a-zA-Z0-9_-]{8,100}$/.test(data.related_publisher)) source.relatedPublisher = data.related_publisher;
    if (!selected || (selection === 'auto' && lastActivityAt < 0 && source.stream === initialStream)) selected = key;
    if (data.kind === 'disconnected' && source.connected) {
      // A reload replaces its publisher, but a duplicate tab can share the
      // stream. Permit pin handoff only after an explicit departure with no
      // other known live document for that stream; never guess from staleness.
      const sibling = [...sources.values()].some((item) => item.key !== key && item.stream === source.stream && item.connected);
      source.replacementAfter = selection === key && !sibling ? sequence : null;
    }
    source.connected = data.kind !== 'disconnected' && data.connected !== false;
    if (source.connected) { source.connectedAt = now(); source.replacementAfter = null; }
    let event = null;
    let historyUpdates = [];
    if (data.kind === 'snapshot') {
      const previousEvents = new Map(source.events.map((value) => [value.id, value]));
      source.events = [];
      source.states.clear();
      for (const value of data.events.slice(-100)) updateEvent(source, value);
      historyUpdates = source.events.filter((value) => !sameEvent(previousEvents.get(value.id), value));
      if (Array.isArray(data.states)) {
        source.states.clear();
        for (const value of data.states.slice(0, FLOW_NODES.length)) {
          const clean = normalizeFlowEvent(value);
          if (clean) source.states.set(clean.node, clean);
        }
      }
      if (sessionModes.has(data.session?.mode)) source.mode = data.session.mode;
    } else if (data.kind === 'event') {
      event = updateEvent(source, data.event);
      if (event) historyUpdates = [event];
    }
    if (central && key.startsWith('worker:')) source.mode = 'member';
    if (central && key.startsWith('guest:')) source.mode = 'guest';

    const pinned = selection !== 'auto' ? sources.get(selection) : null;
    if (data.kind === 'snapshot' && pinned && !pinned.connected && pinned.stream === source.stream
      && pinned.replacementAfter !== null && source.created > pinned.replacementAfter
      && ![...sources.values()].some((item) => item.key !== key && item.stream === source.stream && item.connected)) {
      // Keep the new ledger/session intact. Transferring a pin must not merge
      // the previous account, run, event IDs or completed-card highlights.
      pinned.replacementAfter = null;
      selection = key;
      selected = key;
    }

    // Focus and foreground user actions may select a source. A completed API
    // request, background polling, snapshot or heartbeat never steals focus.
    const interactiveEvent = data.kind === 'event' && event && data.active === true
      && source.states.get(event.node)?.id === event.id
      && ['action', 'navigation', 'session'].includes(event.kind);
    const activityAt = central ? source.updatedAt : data.kind === 'active' ? data.at : event?.at;
    if (selection === 'auto' && (data.kind === 'active' || interactiveEvent)
      && Number.isFinite(activityAt) && activityAt >= 0 && activityAt >= lastActivityAt) {
      lastActivityAt = activityAt;
      selected = key;
    }
    return {
      selectedChanged: selected !== before,
      selectedUpdated: selected !== before || selected === key,
      kind: data.kind, key, historyUpdates,
      event: selected === key && data.kind === 'event' ? event : null,
      snapshot: view(sources.get(selected)),
    };
  }

  return {
    receive,
    evicted: () => evicted,
    dropped: () => [...sources.values()].reduce((total, source) => total + (source.dropped || 0), 0),
    snapshot: () => view(sources.get(selected)),
    options: () => [...sources.values()].map(({ key, label, mode, connectedAt, connected, relatedPublisher, updatedAt }) => ({ key, label, mode, connectedAt, connected, relatedPublisher, updatedAt })),
    selection: () => selection,
    select(key) {
      if (key !== 'auto' && !sources.has(key)) return null;
      selection = key;
      if (key !== 'auto') selected = key;
      // Auto resumes with the current tab, then follows the next real activity.
      return view(sources.get(selected));
    },
    clear() {
      sources.clear(); selected = null; selection = 'auto'; lastActivityAt = -1; sequence = 0; evicted = 0;
    },
  };
}

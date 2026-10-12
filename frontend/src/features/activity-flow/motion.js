import { LIVE_FLOW_EDGES as EDGES } from './catalog.js';
// Static fibres show relationships. Only a newly observed event emits moving
// light; snapshots and a still-pending request must never manufacture traffic.

const PALETTES = {
  dark: {
    cyan: [106, 224, 241],
    lime: [190, 238, 123],
    amber: [245, 196, 110],
    violet: [173, 155, 255],
    red: [255, 120, 139],
    core: [231, 253, 255],
  },
  light: {
    cyan: [0, 112, 137],
    lime: [66, 119, 42],
    amber: [156, 100, 19],
    violet: [103, 80, 172],
    red: [188, 52, 75],
    core: [13, 69, 89],
  },
};
const MAX_PACKETS = 50;
const MAX_RINGS = 16;
const ACTIVE_STATES = new Set(['pending', 'running', 'queued', 'processing', 'started']);
const rgba = (color, opacity) => `rgba(${color.join(',')},${opacity})`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function stateColor(node, state) {
  if (['error', 'failed', 'failure', 'cancelled', 'canceled'].includes(state)) return 'red';
  if (ACTIVE_STATES.has(state)) return node.startsWith('api_') ? 'violet' : 'cyan';
  if (['pending', 'running', 'queued', 'processing', 'started', 'waiting', 'blocked', 'empty', 'partial', 'expired'].includes(state)) return 'amber';
  return ['report', 'archive', 'database', 'validation'].includes(node) ? 'lime' : 'cyan';
}

function pointAt(path, t) {
  const v = 1 - t;
  return {
    x: v ** 3 * path.x0 + 3 * v ** 2 * t * path.x1 + 3 * v * t ** 2 * path.x2 + t ** 3 * path.x3,
    y: v ** 3 * path.y0 + 3 * v ** 2 * t * path.y1 + 3 * v * t ** 2 * path.y2 + t ** 3 * path.y3,
  };
}

function tracePath(ctx, path, offset = 0) {
  ctx.beginPath();
  ctx.moveTo(path.x0, path.y0 + offset * 0.2);
  ctx.bezierCurveTo(path.x1 + offset, path.y1 - offset, path.x2 - offset, path.y2 + offset, path.x3, path.y3 + offset * 0.2);
}

function roundedOutline(ctx, box, padding = 3) {
  const x = box.x - padding;
  const y = box.y - padding;
  const w = box.width + padding * 2;
  const h = box.height + padding * 2;
  const r = Math.min(13, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function mountFlowMotion(root, { reducedMotion = false, theme = 'dark' } = {}) {
  const canvas = root?.querySelector('[data-flow-canvas]');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return { pulse() {}, syncActive() {}, reset() {}, setEdges() {}, setPaused() {}, setTheme() {}, destroy() {} };

  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const base = doc.createElement('canvas');
  const baseCtx = base.getContext('2d');
  if (!baseCtx || !win) return { pulse() {}, syncActive() {}, reset() {}, setEdges() {}, setPaused() {}, setTheme() {}, destroy() {} };

  const cards = [...root.querySelectorAll('[data-flow-node]')];
  const nodes = new Map();
  const paths = new Map();
  const packets = [];
  const rings = [];
  const active = new Map();
  let activeEdges = EDGES;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let frame = 0;
  let paused = false;
  let destroyed = false;
  let inViewport = true;
  let lastPaint = -Infinity;
  let staticHighlight = null;
  let palette = PALETTES[theme === 'light' ? 'light' : 'dark'];

  canvas.setAttribute('aria-hidden', 'true');

  const canAnimate = () => !destroyed && !paused && !doc.hidden && inViewport && width > 0 && height > 0 && !reducedMotion;
  const pathKey = (from, to) => `${from}:${to}`;

  function makePath(from, to, index) {
    const sameColumn = Math.abs(from.x - to.x) < 30;
    if (sameColumn) {
      const outer = Math.min(width - 9, Math.max(from.x + from.width, to.x + to.width) + 17 + index % 3 * 5);
      return {
        x0: from.x + from.width, y0: from.y + from.height / 2,
        x1: outer, y1: from.y + from.height / 2,
        x2: outer, y2: to.y + to.height / 2,
        x3: to.x + to.width, y3: to.y + to.height / 2,
      };
    }
    const forward = to.x > from.x;
    const x0 = from.x + (forward ? from.width : 0);
    const x3 = to.x + (forward ? 0 : to.width);
    const bend = Math.max(24, Math.abs(x3 - x0) * 0.53);
    const direction = forward ? 1 : -1;
    return {
      x0, y0: from.y + from.height / 2,
      x1: x0 + bend * direction, y1: from.y + from.height / 2,
      x2: x3 - bend * direction, y2: to.y + to.height / 2,
      x3, y3: to.y + to.height / 2,
    };
  }

  function paintBase() {
    baseCtx.clearRect(0, 0, width, height);
    baseCtx.lineCap = 'round';
    let index = 0;
    paths.forEach(path => {
      const color = index++ % 4 === 0 ? palette.lime : palette.cyan;
      for (const offset of [-8, -3.5, 0, 4.5, 9]) {
        tracePath(baseCtx, path, offset);
        baseCtx.strokeStyle = rgba(color, offset === 0 ? 0.42 : 0.16);
        baseCtx.lineWidth = offset === 0 ? 0.85 : 0.55;
        baseCtx.stroke();
      }
      for (const [x, y] of [[path.x0, path.y0], [path.x3, path.y3]]) {
        baseCtx.beginPath();
        baseCtx.arc(x, y, 1.8, 0, Math.PI * 2);
        baseCtx.fillStyle = rgba(color, 0.52);
        baseCtx.fill();
      }
    });

    // Fine fixed rails tie each column's sockets together without implying traffic.
    const columns = [];
    nodes.forEach(box => {
      let column = columns.find(item => Math.abs(item.x - box.x) < 30);
      if (!column) {
        column = { x: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
        columns.push(column);
      } else {
        column.top = Math.min(column.top, box.y);
        column.bottom = Math.max(column.bottom, box.y + box.height);
        column.right = Math.max(column.right, box.x + box.width);
      }
    });
    columns.sort((a, b) => a.x - b.x).slice(0, -1).forEach((column, i) => {
      const next = columns[i + 1];
      const x = (column.right + next.x) / 2;
      const top = Math.min(column.top, next.top);
      const bottom = Math.max(column.bottom, next.bottom);
      for (const offset of [-6, -2, 2, 6]) {
        baseCtx.beginPath();
        baseCtx.moveTo(x + offset, top);
        baseCtx.bezierCurveTo(x - 5 + offset, top + (bottom - top) * 0.34, x + 6 + offset, top + (bottom - top) * 0.68, x + offset, bottom);
        baseCtx.strokeStyle = rgba(palette.cyan, 0.22);
        baseCtx.lineWidth = 0.65;
        baseCtx.stroke();
      }
    });
  }

  function paintNode(id, color, progress, stationary = false) {
    const box = nodes.get(id);
    if (!box) return;
    const fade = stationary ? 0.45 : (1 - progress) ** 1.3;
    const x = box.x - 1;
    const y = box.y + box.height / 2;
    const radius = stationary ? 22 : 19 + progress * 48;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, rgba(color, 0.22 * fade));
    glow.addColorStop(0.38, rgba(color, 0.085 * fade));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    roundedOutline(ctx, box);
    ctx.strokeStyle = rgba(color, 0.7 * fade);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (!stationary) {
      ctx.beginPath();
      ctx.arc(x, y, radius, -Math.PI * 0.68, Math.PI * 0.68);
      ctx.strokeStyle = rgba(color, 0.42 * fade);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }

  function paintPacket(packet, now) {
    const path = paths.get(packet.path);
    if (!path) return;
    const t = clamp((now - packet.start) / packet.duration, 0, 1);
    const fade = Math.min(1, t * 9, (1 - t) * 10);
    if (fade <= 0) return;
    const color = palette[packet.color];
    // A short tapered tail follows the same cubic, so resize never separates it.
    for (let segment = 7; segment >= 0; segment--) {
      const a = pointAt(path, Math.max(0, t - (segment + 1) * 0.014));
      const b = pointAt(path, Math.max(0, t - segment * 0.014));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = rgba(color, fade * (1 - segment / 8) * 0.85);
      ctx.lineWidth = 0.65 + (1 - segment / 8) * 0.85;
      ctx.stroke();
    }
    const p = pointAt(path, t);
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 10);
    glow.addColorStop(0, rgba(color, 0.65 * fade));
    glow.addColorStop(0.3, rgba(color, 0.18 * fade));
    glow.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(p.x - 10, p.y - 10, 20, 20);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = rgba(palette.core, fade);
    ctx.fill();
  }

  function emitPackets(id, color, now, route) {
    const incoming = route === undefined ? activeEdges.filter(([, to]) => to === id)
      : route.from && route.from !== id ? [[route.from, id]] : [];
    incoming.slice(0, 4).forEach(([from, to], index) => {
      const key = pathKey(from, to);
      if (!paths.has(key)) return;
      for (let filament = 0; filament < 3; filament++)
        packets.push({ path: key, start: now + index * 55 + filament * 160, duration: 1150 + index * 65, color });
    });
    packets.splice(0, Math.max(0, packets.length - MAX_PACKETS));
  }

  function ensureFrame() {
    if (!frame && canAnimate() && (packets.length || rings.length))
      frame = win.requestAnimationFrame(tick);
  }

  function draw(now = win.performance.now()) {
    if (destroyed || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(base, 0, 0, width, height);
    if (staticHighlight) paintNode(staticHighlight.node, palette[staticHighlight.color], 0, true);
    for (const [id, item] of active) paintNode(id, palette[item.color], 0, true);
    for (const ring of rings) {
      if (now >= ring.start) paintNode(ring.node, palette[ring.color], clamp((now - ring.start) / ring.duration, 0, 1));
    }
    for (const packet of packets) {
      if (now >= packet.start) paintPacket(packet, now);
    }
  }

  function tick(now) {
    frame = 0;
    if (!canAnimate()) return;
    // A large live map redraws at most 30fps, independently of a 120/144Hz display.
    if (now - lastPaint < 1000 / 30) { ensureFrame(); return; }
    lastPaint = now;
    for (let i = packets.length - 1; i >= 0; i--) {
      if (now >= packets[i].start + packets[i].duration) packets.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      if (now >= rings[i].start + rings[i].duration) rings.splice(i, 1);
    }
    draw(now);
    ensureFrame();
  }

  function measure() {
    if (destroyed) return;
    const bounds = canvas.getBoundingClientRect();
    width = Math.max(0, bounds.width);
    height = Math.max(0, bounds.height);
    if (!width || !height) { stop(); return; }
    dpr = Math.min(1.5, win.devicePixelRatio || 1, Math.sqrt(4200000 / (width * height)));
    const pixelWidth = Math.ceil(width * dpr);
    const pixelHeight = Math.ceil(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = base.width = pixelWidth;
      canvas.height = base.height = pixelHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nodes.clear();
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      nodes.set(card.dataset.flowNode, {
        x: rect.left - bounds.left, y: rect.top - bounds.top,
        width: rect.width, height: rect.height,
      });
    });
    for (const id of active.keys()) if (!nodes.has(id)) active.delete(id);
    paths.clear();
    activeEdges.forEach(([from, to], index) => {
      if (nodes.has(from) && nodes.has(to)) paths.set(pathKey(from, to), makePath(nodes.get(from), nodes.get(to), index));
    });
    paintBase();
    draw();
    ensureFrame();
  }

  function stop(clearActive = false) {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    packets.length = 0;
    rings.length = 0;
    staticHighlight = null;
    if (clearActive) active.clear();
    draw();
  }

  function syncActive(values = []) {
    if (destroyed) return;
    const next = new Map();
    for (const value of values) {
      if (!value || !nodes.has(value.node) || !ACTIVE_STATES.has(value.state) || next.size >= MAX_RINGS) continue;
      next.set(value.node, { color: stateColor(value.node, value.state) });
    }
    active.clear();
    for (const [id, value] of next) active.set(id, value);
    draw();
    ensureFrame();
  }

  function pulse(node, state = 'complete', route) {
    if (destroyed || paused || doc.hidden || !inViewport || !width || !height) return;
    const id = typeof node === 'string' ? node : node?.dataset?.flowNode;
    if (!nodes.has(id)) return;
    const color = stateColor(id, state);
    if (reducedMotion) {
      staticHighlight = { node: id, color };
      draw();
      return;
    }
    const now = win.performance.now();
    emitPackets(id, color, now, route);
    rings.push({ node: id, start: now, duration: 1400, color });
    rings.splice(0, Math.max(0, rings.length - MAX_RINGS));
    ensureFrame();
  }

  const onVisibility = () => {
    if (doc.hidden) stop();
    else measure();
  };
  const observer = win.ResizeObserver ? new win.ResizeObserver(measure) : null;
  const visibilityObserver = win.IntersectionObserver ? new win.IntersectionObserver(([entry]) => {
    inViewport = Boolean(entry?.isIntersecting);
    if (!inViewport) stop();
    else measure();
  }) : null;
  visibilityObserver?.observe(root);
  observer?.observe(root);
  cards.forEach(card => observer?.observe(card));
  win.addEventListener('resize', measure, { passive: true });
  root.addEventListener('scroll', measure, { passive: true });
  doc.addEventListener('visibilitychange', onVisibility);
  measure();

  return {
    pulse,
    syncActive,
    reset() { stop(true); },
    setEdges(edges) {
      if (destroyed) return;
      const next = edges ?? EDGES;
      if (next.length === activeEdges.length && next.every(([from, to], i) => from === activeEdges[i][0] && to === activeEdges[i][1])) return;
      stop();
      activeEdges = next;
      measure();
    },
    setPaused(value) {
      if (destroyed) return;
      reducedMotion = Boolean(value);
      paused = Boolean(value);
      if (paused) stop();
      else { lastPaint = -Infinity; ensureFrame(); }
    },
    setTheme(value) {
      if (destroyed) return;
      const nextPalette = PALETTES[value === 'light' ? 'light' : 'dark'];
      if (palette === nextPalette) return;
      palette = nextPalette;
      paintBase();
      draw();
    },
    destroy() {
      if (destroyed) return;
      stop(true);
      destroyed = true;
      observer?.disconnect();
      visibilityObserver?.disconnect();
      win.removeEventListener('resize', measure);
      root.removeEventListener('scroll', measure);
      doc.removeEventListener('visibilitychange', onVisibility);
      ctx.clearRect(0, 0, width, height);
      nodes.clear();
      paths.clear();
      base.width = base.height = 0;
    },
  };
}

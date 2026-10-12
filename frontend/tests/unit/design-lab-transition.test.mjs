import assert from 'node:assert/strict';
import test from 'node:test';
import { playReportTransition } from '../../src/features/design-lab/transition.js';

function harness({ hidden = false, canvasAvailable = true } = {}) {
  const frames = new Map();
  const measurements = [];
  const strokes = [];
  const gradients = [];
  const observers = [];
  let path = [];
  let nextFrame = 0;
  let now = 0;
  let revealCount = 0;
  const context = new Proxy(
    {
      createLinearGradient(...coordinates) {
        assert.ok(coordinates.every(Number.isFinite));
        const gradient = {
          coordinates,
          stops: [],
          addColorStop(offset, color) {
            this.stops.push({ offset, color });
          },
        };
        gradients.push(gradient);
        return gradient;
      },
    },
    {
      get: (target, key) =>
        target[key] ??
        ((...args) => {
          assert.ok(args.filter((value) => typeof value === 'number').every(Number.isFinite));
          if (key === 'arc') measurements.push(args);
          if (key === 'beginPath') path = [];
          if (key === 'moveTo' || key === 'lineTo') path.push({ x: args[0], y: args[1] });
          if (key === 'closePath') path.push({ closed: true });
          if (key === 'stroke') strokes.push({ points: path, style: target.strokeStyle });
        }),
    },
  );
  const win = Object.assign(new EventTarget(), {
    devicePixelRatio: 3,
    requestAnimationFrame(callback) {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  });
  const doc = Object.assign(new EventTarget(), { defaultView: win, hidden });
  const host = {
    ownerDocument: doc,
    children: [],
    clientWidth: 800,
    clientHeight: 700,
    append(node) {
      this.children.push(node);
    },
    getBoundingClientRect() {
      return { width: this.clientWidth, height: this.clientHeight };
    },
  };
  doc.createElement = () => ({
    style: {},
    attributes: new Map(),
    setAttribute(key, value) {
      this.attributes.set(key, value);
    },
    getContext() {
      return canvasAvailable ? context : null;
    },
    remove() {
      host.children = host.children.filter((child) => child !== this);
    },
  });
  const controller = new AbortController();
  const options = {
    host,
    fromRect: { x: 100, y: 10, width: 600, height: 400 },
    toRect: { x: 40, y: 40, width: 720, height: 620 },
    palette: { primary: '#3f84ff', secondary: '#b7e5ff', glow: '#ffffff', style: 'orbit' },
    signal: controller.signal,
    onReveal: () => {
      revealCount++;
    },
  };
  return {
    options,
    host,
    doc,
    win,
    frames,
    measurements,
    strokes,
    gradients,
    observers,
    controller,
    revealCount: () => revealCount,
    advance(elapsed) {
      now += elapsed;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    },
    assertClean() {
      assert.equal(host.children.length, 0);
      assert.equal(frames.size, 0);
      assert.ok(observers.every((observer) => observer.disconnected));
    },
  };
}

test('all five transitions reveal once, produce finite geometry, and release the canvas', async () => {
  for (const outline of ['frame', 'document']) {
    for (const style of ['orbit', 'ribbon', 'constellation', 'prism', 'comet']) {
      const h = harness();
      h.options.outline = outline;
      h.options.palette.style = style;
      const completion = playReportTransition(h.options);
      const canvas = h.host.children[0];
      assert.equal(canvas.width, 1200, 'DPR is capped at 1.5');
      assert.equal(canvas.height, 1050);
      assert.equal(canvas.attributes.get('aria-hidden'), 'true');
      assert.equal(canvas.style.pointerEvents, 'none');
      h.advance(0);
      for (let elapsed = 100; elapsed <= 1300; elapsed += 100) h.advance(100);
      assert.equal(h.revealCount(), 0);
      h.advance(80);
      assert.equal(h.revealCount(), 1);
      h.advance(460);
      h.advance(460);
      await completion;
      assert.equal(h.revealCount(), 1);
      h.assertClean();
    }
  }
});

test('document outlines are two open descending branches with fading ends, including tall reports', async () => {
  for (const height of [24, 620, 6000]) {
    const h = harness();
    h.options.toRect.height = height;
    const completion = playReportTransition({
      ...h.options,
      outline: 'document',
      reducedMotion: true,
    });
    assert.equal(h.host.children[0].height, 1050, 'The canvas stays viewport-sized');
    h.advance(0);
    h.advance(80);
    assert.equal(h.strokes.length, 2, 'Only the two open outline branches are drawn');
    const { x, y, width } = h.options.toRect;
    for (const [index, stroke] of h.strokes.entries()) {
      const points = stroke.points;
      assert.deepEqual(points[0], { x: x + width / 2, y: y + 1 });
      assert.ok(points.every((point) => !point.closed));
      assert.ok(Math.abs(points.at(-1).x - (index === 0 ? x + 1 : x + width - 1)) < 1e-8);
      assert.ok(Math.abs(points.at(-1).y - (y + height - 1)) < 1e-8);
      for (let i = 1; i < points.length; i++) {
        assert.ok(points[i].y >= points[i - 1].y, 'Edges never turn up or wrap');
        if (points[i].y > y + 21) {
          assert.equal(points[i].x, points.at(-1).x, 'Lower edges never turn across the bottom');
        }
      }
      assert.equal(stroke.style.stops.at(-1).offset, 1);
      assert.match(stroke.style.stops.at(-1).color, /00$/, 'The bottom end is transparent');
    }
    h.advance(80);
    await completion;
    assert.equal(h.revealCount(), 1);
    h.assertClean();
  }
});

test('document particles join and descend the same side edges rather than a closed perimeter', async () => {
  const h = harness();
  const completion = playReportTransition({ ...h.options, outline: 'document' });
  h.advance(0);
  h.measurements.length = 0;
  h.advance(1850);
  const earlier = h.measurements.map(([x, y]) => ({ x, y }));
  assert.ok(earlier.length > 100);
  h.measurements.length = 0;
  h.advance(230);
  const later = h.measurements.map(([x, y]) => ({ x, y }));
  assert.equal(later.length, earlier.length);
  for (let i = 0; i < later.length; i++) {
    assert.ok(later[i].y >= earlier[i].y, 'Every edge particle moves downwards');
    assert.ok(
      later[i].x === 41 || later[i].x === 759,
      'Arrived particles remain on their side instead of crossing a bottom border',
    );
  }
  h.advance(220);
  await completion;
  h.assertClean();
});

test('abort before and during flight rejects with AbortError without revealing the report', async () => {
  for (const outline of ['frame', 'document']) {
    for (const beforeStart of [true, false]) {
      const h = harness();
      h.options.outline = outline;
      if (beforeStart) h.controller.abort('route changed');
      const completion = playReportTransition(h.options);
      const rejection = assert.rejects(completion, { name: 'AbortError' });
      if (!beforeStart) {
        h.advance(0);
        h.advance(500);
        h.controller.abort('route changed');
      }
      await rejection;
      assert.equal(h.revealCount(), 0);
      h.assertClean();
    }
  }
});

test('hidden document, absent graphics context, and resize complete without a lingering loop', async () => {
  for (const mode of ['hidden', 'canvas', 'hide-during-flight', 'resize']) {
    const h = harness({ hidden: mode === 'hidden', canvasAvailable: mode !== 'canvas' });
    const completion = playReportTransition(h.options);
    if (mode === 'hide-during-flight') {
      h.advance(0);
      h.doc.hidden = true;
      h.doc.dispatchEvent(new Event('visibilitychange'));
    } else if (mode === 'resize') {
      h.advance(0);
      h.host.clientWidth = 420;
      h.observers[0].callback();
    }
    await completion;
    assert.equal(h.revealCount(), 1);
    h.assertClean();
    h.doc.dispatchEvent(new Event('visibilitychange'));
    h.win.dispatchEvent(new Event('resize'));
    assert.equal(h.revealCount(), 1);
  }
});

test('reduced motion uses a short edge fade with no moving particles', async () => {
  const h = harness();
  const completion = playReportTransition({ ...h.options, reducedMotion: true });
  h.advance(0);
  h.advance(50);
  assert.equal(h.revealCount(), 1);
  h.advance(110);
  await completion;
  assert.equal(h.measurements.length, 0, 'There should be no particle arcs');
  h.assertClean();
});

test('a failed reveal callback rejects and still disposes every animation resource', async () => {
  const h = harness();
  const completion = playReportTransition({
    ...h.options,
    onReveal() {
      throw new Error('Reveal failed');
    },
  });
  const rejection = assert.rejects(completion, /Reveal failed/);
  h.advance(0);
  h.advance(1400);
  await rejection;
  h.assertClean();
});

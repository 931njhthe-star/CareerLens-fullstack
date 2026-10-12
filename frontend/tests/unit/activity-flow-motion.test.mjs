import assert from 'node:assert/strict';
import test from 'node:test';
import { mountFlowMotion } from '../../src/features/activity-flow/motion.js';

function setup(options = {}) {
  let now = 0, next = 0, paints = 0, strokes = 0;
  const frames = new Map(), listeners = new Map(), observers = [];
  const context = () => new Proxy({
    clearRect() { paints++; }, stroke() { strokes++; },
    createRadialGradient() { return { addColorStop() {} }; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  const canvas = { width: 0, height: 0, getContext: () => context(), setAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 1600 }) };
  const cards = ['api_evaluation', 'analysis', 'report_lock'].map((id, index) => ({
    dataset: { flowNode: id },
    getBoundingClientRect: () => ({ left: index * 360, top: 100, width: 280, height: 92 }),
  }));
  const win = {
    devicePixelRatio: 2, performance: { now: () => now },
    requestAnimationFrame(fn) { const id = ++next; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener() {}, removeEventListener() {},
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    },
  };
  const doc = { defaultView: win, hidden: false, createElement: () => ({ getContext: context }),
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const root = { ownerDocument: doc, querySelector: () => canvas, querySelectorAll: () => cards,
    addEventListener() {}, removeEventListener() {} };
  const motion = mountFlowMotion(root, options);
  motion.setEdges([['api_evaluation', 'analysis']]);
  return { motion, frames, doc, observers, canvas, cards,
    get paints() { return paints; }, get strokes() { return strokes; },
    step(ms) { now += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now)); },
    visibility(hidden) { doc.hidden = hidden; listeners.get('visibilitychange')?.(); },
  };
}

test('pending and running snapshots remain static without a new event', () => {
  const s = setup();
  for (let i = 0; i < 5; i++) {
    s.motion.syncActive([{ node: 'api_evaluation', state: 'pending' }, { node: 'analysis', state: 'running' }]);
    s.step(4000);
    assert.equal(s.frames.size, 0, 'a heartbeat must not manufacture traffic');
  }
  assert.ok(s.strokes > 0, 'relationships and status highlights remain visible');
  s.motion.destroy();
});

test('a new request emits one bounded pulse even while its status stays pending', () => {
  const s = setup();
  s.motion.syncActive([{ node: 'analysis', state: 'pending' }]);
  s.motion.pulse('analysis', 'pending');
  assert.equal(s.frames.size, 1);
  s.step(3000);
  assert.equal(s.frames.size, 0);
  s.motion.syncActive([{ node: 'analysis', state: 'pending' }]);
  s.step(10000);
  assert.equal(s.frames.size, 0, 'pending does not repeat the request pulse');
  s.motion.syncActive([{ node: 'analysis', state: 'complete' }]);
  s.motion.pulse('analysis', 'complete');
  assert.equal(s.frames.size, 1, 'a newly received completion can pulse');
  s.step(3000);
  assert.equal(s.frames.size, 0);
  s.motion.destroy();
});

test('authentication waiting does not create continuous activity', () => {
  const s = setup();
  s.motion.syncActive([{ node: 'report_lock', state: 'waiting' }]);
  assert.equal(s.frames.size, 0);
  s.motion.pulse('report_lock', 'waiting');
  assert.equal(s.frames.size, 1, 'the arrival may have a bounded transition');
  s.step(3000);
  assert.equal(s.frames.size, 0);
  s.motion.destroy();
});

test('equivalent edge snapshots preserve a currently running animation', () => {
  const s = setup();
  s.motion.syncActive([{ node: 'analysis', state: 'running' }]);
  s.motion.pulse('analysis', 'running');
  const [frame] = s.frames.keys();
  assert.ok(frame);
  s.motion.setEdges([['api_evaluation', 'analysis']]);
  assert.equal([...s.frames.keys()][0], frame);
  s.motion.destroy();
});

test('visibility and motion controls discard old pulses instead of replaying them', () => {
  const s = setup();
  s.motion.syncActive([{ node: 'analysis', state: 'running' }]);
  s.motion.pulse('analysis', 'running');
  s.visibility(true);
  assert.equal(s.frames.size, 0);
  s.motion.pulse('analysis', 'running');
  s.visibility(false);
  assert.equal(s.frames.size, 0);
  s.motion.pulse('analysis', 'running');
  assert.equal(s.frames.size, 1, 'only a new visible event can restart motion');
  s.observers[0].callback([{ isIntersecting: false }]);
  assert.equal(s.frames.size, 0);
  s.motion.pulse('analysis', 'running');
  s.observers[0].callback([{ isIntersecting: true }]);
  assert.equal(s.frames.size, 0);
  s.motion.pulse('analysis', 'running');
  s.motion.setPaused(true);
  assert.equal(s.frames.size, 0);
  s.motion.pulse('analysis', 'running');
  s.motion.setPaused(false);
  assert.equal(s.frames.size, 0);
  s.motion.pulse('analysis', 'running');
  assert.equal(s.frames.size, 1);
  s.motion.reset();
  assert.equal(s.frames.size, 0);
  s.visibility(true); s.visibility(false);
  assert.equal(s.frames.size, 0, 'reset must not revive the previous run');
  s.motion.destroy();
  assert.equal(s.observers[0].disconnected, true);
});

test('reduced motion stays static and large maps have a bounded drawing resolution', () => {
  const s = setup({ reducedMotion: true });
  s.motion.syncActive([{ node: 'analysis', state: 'running' }]);
  s.motion.pulse('analysis', 'running');
  assert.equal(s.frames.size, 0);
  assert.ok(s.strokes > 0);
  assert.ok(s.canvas.width * s.canvas.height < 4205000);
  s.motion.destroy();
});

test('high refresh-rate frames do not redraw the map faster than 30fps', () => {
  const s = setup();
  s.motion.syncActive([{ node: 'analysis', state: 'running' }]);
  s.motion.pulse('analysis', 'running');
  s.step(40);
  const paints = s.paints;
  for (let i = 0; i < 4; i++) s.step(8);
  assert.equal(s.paints, paints);
  s.step(8);
  assert.ok(s.paints > paints);
  s.motion.destroy();
  assert.equal(s.frames.size, 0);
});

test('a hidden active card and a zero-sized map do not keep scheduling frames', () => {
  const s = setup();
  s.motion.syncActive([{ node: 'analysis', state: 'running' }]);
  s.motion.pulse('analysis', 'running');
  s.step(40);
  s.cards[1].getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
  s.motion.setEdges([]);
  s.step(3000);
  assert.equal(s.frames.size, 0);
  s.motion.syncActive([{ node: 'api_evaluation', state: 'pending' }]);
  s.motion.pulse('api_evaluation', 'pending');
  assert.equal(s.frames.size, 1);
  const measure = s.canvas.getBoundingClientRect;
  s.canvas.getBoundingClientRect = () => ({ width: 0, height: 0 });
  s.observers[0].callback([{ isIntersecting: true }]);
  assert.equal(s.frames.size, 0);
  s.canvas.getBoundingClientRect = measure;
  s.observers[0].callback([{ isIntersecting: true }]);
  assert.equal(s.frames.size, 0, 'visible map must not replay the previous request');
  s.motion.pulse('api_evaluation', 'complete');
  assert.equal(s.frames.size, 1);
  s.motion.destroy();
});

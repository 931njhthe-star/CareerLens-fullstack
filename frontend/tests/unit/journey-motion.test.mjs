import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JOURNEY_CRITERIA,
  journeyPhaseTime,
  mountJourneyMotion,
} from '../../src/features/analysis/journey-motion.js';
import { liveMotionViewport } from '../../src/features/analysis/live-eye-motion.js';
import { REPORT_CRITERIA } from '../../tools/matching-eye/src/analysis-criteria.ts';

function harness(t, { reduced = false, contextAvailable = true } = {}) {
  const frames = new Map();
  let frameId = 0;
  let now = 0;
  let headingTop = 190;
  const gradient = { addColorStop() {} };
  const context = new Proxy(
    { globalAlpha: 1 },
    {
      get(target, property) {
        if (property in target) return target[property];
        if (String(property).startsWith('create') && String(property).endsWith('Gradient'))
          return () => gradient;
        if (property === 'measureText') return () => ({ width: 50 });
        return () => {};
      },
    },
  );
  class Element {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.classes = new Set();
      this.classList = {
        add: (name) => this.classes.add(name),
        remove: (name) => this.classes.delete(name),
      };
    }
    append(child) {
      this.children.push(child);
      child.parent = this;
    }
    setAttribute() {}
    getContext() {
      return contextAvailable ? context : null;
    }
    matches() {
      return false;
    }
    querySelector() {
      return null;
    }
    closest() {
      return null;
    }
    getBoundingClientRect() {
      return { left: 90, top: headingTop, bottom: headingTop + 70, width: 620, height: 70 };
    }
    remove() {
      this.parent.children = this.parent.children.filter((child) => child !== this);
    }
  }
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    body: new Element(),
    createElement: () => new Element(),
  });
  const media = Object.assign(new EventTarget(), { matches: reduced });
  const window = Object.assign(new EventTarget(), {
    matchMedia: () => media,
    devicePixelRatio: 1,
    innerWidth: 1440,
    innerHeight: 900,
  });
  for (const [name, value] of Object.entries({
    document,
    window,
    requestAnimationFrame: (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() =>
      previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name],
    );
  }
  return {
    host: new Element(),
    newHost: () => new Element(),
    document,
    window,
    media,
    frames: () => frames.size,
    scrollHeading(top) {
      headingTop = top;
    },
    advance(count) {
      for (let index = 0; index < count; index++) {
        const pending = [...frames.values()];
        frames.clear();
        now += 50;
        pending.forEach((callback) => callback(now));
      }
    },
  };
}

test('journey selects five stable, score-free topics from the actual report catalog', (t) => {
  assert.deepEqual(
    JOURNEY_CRITERIA,
    REPORT_CRITERIA.map(({ id, axis, label }) => ({ id, axis, label })),
  );
  const h = harness(t);
  const motion = mountJourneyMotion(h.host, { snapshot: { seed: 824 } });
  const topics = motion.capture().topics;
  assert.equal(topics.length, 5);
  assert.equal(new Set(topics.map((topic) => topic.index)).size, 5);
  assert.ok(
    topics.every((topic) => JOURNEY_CRITERIA.some((criterion) => criterion.label === topic.label)),
  );
  motion.update({ phase: 'orbit' });
  h.advance(150);
  assert.deepEqual(motion.capture().topics, topics);
  assert.ok(topics.every((topic) => !('score' in topic)));
  motion.dispose();
});

test('upload holds at the curve, then posting formation survives page rerenders', (t) => {
  const h = harness(t);
  const motion = mountJourneyMotion(h.host);
  assert.equal(motion.capture().time, 0);
  motion.update({ phase: 'uploading' });
  h.advance(120);
  assert.equal(motion.capture().time, journeyPhaseTime('uploading'));
  h.advance(600);
  assert.equal(motion.capture().time, journeyPhaseTime('uploading'));
  motion.update({ phase: 'orbit' });
  h.advance(30);
  const snapshot = motion.capture();
  assert.ok(
    snapshot.time > 5.5 && snapshot.time < 9.2,
    'Branch gathering remains visible before the completed ring',
  );
  motion.dispose();
  const restored = mountJourneyMotion(h.host, { phase: 'orbit', snapshot });
  assert.equal(restored.capture().time, snapshot.time);
  assert.equal(restored.capture().rotation, snapshot.rotation);
  assert.equal(restored.capture().seed, snapshot.seed);
  assert.deepEqual(restored.capture().origin, snapshot.origin);
  h.advance(100);
  assert.equal(restored.capture().time, journeyPhaseTime('orbit'));
  const rotation = restored.capture().rotation;
  h.advance(30);
  assert.ok(
    restored.capture().rotation > rotation,
    'The completed ring keeps rotating while waiting',
  );
  restored.dispose();
  assert.equal(h.frames(), 0);
  assert.equal(h.document.body.children.length, 0);
  assert.equal(h.host.children.length, 0);
});

test('scrolling and heading replacement cannot alter the shared pupil position or size', (t) => {
  const h = harness(t);
  const motion = mountJourneyMotion(h.host, { phase: 'orbit' });
  const initial = motion.capture();
  h.scrollHeading(-920);
  const scrolled = motion.capture();
  for (const field of ['centerX', 'centerY', 'radius'])
    assert.equal(scrolled[field], initial[field]);
  assert.deepEqual(scrolled.origin, initial.origin);
  motion.dispose();
  const restored = mountJourneyMotion(h.host, { phase: 'orbit', snapshot: scrolled });
  const geometry = liveMotionViewport(h.window.innerWidth, h.window.innerHeight);
  for (const field of ['centerX', 'centerY', 'radius'])
    assert.equal(restored.capture()[field], geometry[field]);
  assert.equal(
    h.document.body.children.length,
    1,
    'Only one body-level fixed layer exists after rerender',
  );
  h.window.innerWidth = 390;
  h.window.innerHeight = 844;
  h.window.dispatchEvent(new Event('resize'));
  const phone = liveMotionViewport(390, 844);
  for (const field of ['centerX', 'centerY', 'radius'])
    assert.equal(restored.capture()[field], phone[field]);
  assert.equal(restored.capture().frame.width, 390);
  restored.dispose();
});

test('returning to resume preserves the current frame and unwinds to the original seed', (t) => {
  const h = harness(t);
  const posting = mountJourneyMotion(h.host, { phase: 'orbit' });
  h.advance(120);
  const snapshot = posting.capture();
  posting.dispose();
  h.scrollHeading(240);
  h.host.querySelector = (selector) =>
    selector === 'p' ? { getBoundingClientRect: () => ({ bottom: 365 }) } : null;
  const resume = mountJourneyMotion(h.host, { snapshot });
  const restored = resume.capture();
  assert.equal(restored.time, snapshot.time);
  assert.equal(restored.seed, snapshot.seed);
  assert.deepEqual(restored.origin, snapshot.origin);
  assert.deepEqual(restored.journeyGeometry, snapshot.journeyGeometry);
  assert.equal(restored.centerX, snapshot.centerX);
  assert.equal(restored.centerY, snapshot.centerY);
  const stages = new Set([h.document.body.children[0].children[0].dataset.stage]);
  let previous = restored;
  for (let index = 0; index < 100; index++) {
    h.advance(1);
    const current = resume.capture();
    assert.ok(current.time <= previous.time);
    if (current.time < previous.time) assert.ok(current.rotation < previous.rotation);
    stages.add(h.document.body.children[0].children[0].dataset.stage);
    previous = current;
  }
  assert.equal(resume.capture().time, 0);
  for (const stage of ['orbit', 'formation', 'branches', 'curve', 'light'])
    assert.ok(stages.has(stage), `reverse visits ${stage}`);
  assert.deepEqual(resume.capture().origin, snapshot.origin);
  resume.dispose();
});

test('resizing a scrolled page reanchors the seed inside the viewport without changing ordinary scroll or forward continuity', (t) => {
  const h = harness(t);
  const motion = mountJourneyMotion(h.host);
  const original = motion.capture();
  h.window.innerWidth = 390;
  h.window.innerHeight = 844;
  h.window.scrollY = 600;
  h.host.getBoundingClientRect = () => ({ left: 24, top: -320, bottom: -250 });
  h.host.querySelector = (selector) =>
    selector === 'p' ? { getBoundingClientRect: () => ({ bottom: -198 }) } : null;
  h.window.dispatchEvent(new Event('resize'));
  const resized = motion.capture();
  assert.notDeepEqual(resized.origin, original.origin);
  assert.equal(resized.origin.x * resized.frame.scale + resized.frame.offsetX, 28);
  assert.equal(resized.origin.y * resized.frame.scale + resized.frame.offsetY, 414);
  h.window.scrollY = 900;
  h.window.dispatchEvent(new Event('resize'));
  assert.deepEqual(motion.capture().origin, resized.origin, 'same-sized viewport remains fixed');
  motion.dispose();
  const next = mountJourneyMotion(h.host, { phase: 'elements', snapshot: resized });
  assert.deepEqual(next.capture().origin, resized.origin, 'forward navigation retains the start');
  assert.deepEqual(next.capture().journeyGeometry, resized.journeyGeometry);
  next.dispose();
});

test('the desired-role stage holds five branches indefinitely and never reveals a ring', (t) => {
  const h = harness(t);
  const motion = mountJourneyMotion(h.host, { phase: 'elements' });
  const before = motion.capture();
  assert.equal(before.time, 5.5);
  assert.equal(before.topics.length, 5);
  h.advance(1200);
  assert.equal(motion.capture().time, 5.5);
  assert.equal(h.document.body.children[0].children[0].dataset.stage, 'branches');
  motion.dispose();
});

test('direct posting entry forms the ring and back navigation retargets from the visible frame', (t) => {
  const h = harness(t);
  const posting = mountJourneyMotion(h.host, { phase: 'orbit' });
  assert.equal(posting.capture().time, 5.5, 'start with branch elements, not a complete ring');
  h.advance(30);
  const forming = posting.capture();
  assert.ok(forming.time > 5.5 && forming.time < 10.4);
  posting.dispose();
  const role = mountJourneyMotion(h.host, { phase: 'elements', snapshot: forming });
  assert.equal(role.capture().time, forming.time, 'back navigation retains the current frame');
  assert.equal(role.capture().seed, forming.seed);
  assert.deepEqual(role.capture().journeyGeometry, forming.journeyGeometry);
  h.advance(10);
  const rewinding = role.capture();
  assert.ok(rewinding.time < forming.time && rewinding.time > 5.5);
  role.update({ phase: 'idle' });
  assert.equal(role.capture().time, rewinding.time, 'skipping to resume also keeps the frame');
  h.advance(100);
  assert.equal(role.capture().time, 0);
  role.dispose();
});

test('rapid direction changes keep the same path, rotation phase and canvas', (t) => {
  const h = harness(t);
  const motion = mountJourneyMotion(h.host);
  const element = h.document.body.children[0];
  motion.update({ phase: 'orbit' });
  assert.equal(motion.capture().time, 0, 'forward skip must still draw the curve and branches');
  h.advance(100);
  const forward = motion.capture();
  motion.update({ phase: 'idle' });
  assert.equal(motion.capture().time, forward.time);
  assert.equal(motion.capture().rotation, forward.rotation);
  h.advance(10);
  const reverse = motion.capture();
  assert.ok(reverse.time < forward.time);
  motion.update({ phase: 'orbit' });
  assert.equal(motion.capture().time, reverse.time);
  assert.equal(motion.capture().rotation, reverse.rotation);
  h.advance(10);
  assert.ok(motion.capture().time > reverse.time);
  assert.ok(motion.capture().rotation > reverse.rotation);
  assert.deepEqual(motion.capture().journeyGeometry, forward.journeyGeometry);
  assert.equal(h.document.body.children[0], element);
  assert.equal(h.document.body.children.length, 1);
  motion.dispose();
});

test('rebinding replaced page headings preserves canvas identity and all visible geometry', (t) => {
  const h = harness(t);
  const motion = mountJourneyMotion(h.host, { phase: 'orbit' });
  h.advance(30);
  const snapshot = motion.capture();
  const element = h.document.body.children[0];
  const nextHost = h.newHost();
  h.scrollHeading(360);
  motion.update({ host: nextHost, phase: 'elements' });
  const rebound = motion.capture();
  assert.equal(rebound.time, snapshot.time);
  assert.equal(rebound.rotation, snapshot.rotation);
  assert.deepEqual(rebound.origin, snapshot.origin);
  assert.deepEqual(rebound.journeyGeometry, snapshot.journeyGeometry);
  assert.equal(h.document.body.children[0], element);
  assert.equal(h.host.classes.has('has-journey-motion'), false);
  assert.equal(nextHost.classes.has('has-journey-motion'), true);
  h.advance(100);
  assert.equal(motion.capture().time, 5.5);
  motion.dispose();
  assert.equal(nextHost.classes.has('has-journey-motion'), false);
});

test('hidden pages pause and reduced motion changes phases without a frame loop', (t) => {
  const h = harness(t);
  const motion = mountJourneyMotion(h.host, { phase: 'orbit' });
  h.advance(10);
  h.document.hidden = true;
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.frames(), 0);
  const snapshot = motion.capture();
  h.advance(100);
  assert.equal(motion.capture().rotation, snapshot.rotation);
  h.document.hidden = false;
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.frames(), 1);
  h.media.matches = true;
  h.media.dispatchEvent(new Event('change'));
  motion.update({ phase: 'elements' });
  assert.equal(motion.capture().time, journeyPhaseTime('elements'));
  assert.equal(h.frames(), 0);
  motion.dispose();
  h.media.matches = false;
  h.window.dispatchEvent(new Event('resize'));
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.frames(), 0);
});

test('unavailable canvas leaves a removable decoration and never starts animation', (t) => {
  const h = harness(t, { contextAvailable: false });
  const motion = mountJourneyMotion(h.host, { phase: 'orbit' });
  assert.equal(h.frames(), 0);
  assert.equal(motion.capture().phase, 'orbit');
  motion.dispose();
  assert.equal(h.document.body.children.length, 0);
});

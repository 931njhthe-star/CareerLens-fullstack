import assert from 'node:assert/strict';
import test from 'node:test';
import { setMaxListeners } from 'node:events';
import { mountStatusRadar } from '../../src/features/analysis/status-radar.js';
import { demoScoreModel } from '../../src/features/analysis/demo-score-data.js';
import { scorePyramidPalette } from '../../src/shared/design/selected-theme.js';

function mountHarness(t, { reducedMotion = true } = {}) {
  let measurements = 0;
  class Element extends EventTarget {
    constructor(tag) {
      super();
      this.tagName = tag;
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.style = {
        setProperty(name, value) {
          this[name] = value;
        },
      };
      this.classList = { toggle() {} };
      this.textContent = '';
    }
    append(...nodes) {
      for (const node of nodes) {
        this.children.push(node);
        node.parentElement = this;
      }
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
    remove() {
      if (this.parentElement)
        this.parentElement.children = this.parentElement.children.filter((node) => node !== this);
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    getBoundingClientRect() {
      measurements++;
      return { width: 10 + this.textContent.length * 12, height: 23, left: 0, top: 0 };
    }
    scrollIntoView() {}
  }
  const doc = new EventTarget();
  doc.hidden = false;
  doc.createElement = (tag) => new Element(tag);
  doc.createElementNS = (_, tag) => new Element(tag);
  doc.createTextNode = (text) => Object.assign(new Element('#text'), { textContent: text });
  const reduced = Object.assign(new EventTarget(), { matches: reducedMotion });
  const win = Object.assign(new EventTarget(), { matchMedia: () => reduced });
  const observers = [];
  class Observer {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  const NativeAbortController = globalThis.AbortController;
  const frames = new Map();
  let frameId = 0;
  let now = 0;
  class Controller extends NativeAbortController {
    constructor() {
      super();
      setMaxListeners(0, this.signal);
    }
  }
  for (const [name, value] of Object.entries({
    document: doc,
    window: win,
    ResizeObserver: Observer,
    IntersectionObserver: Observer,
    requestAnimationFrame: (callback) => {
      assert.equal(reducedMotion, false, 'Reduced-motion mount should settle immediately');
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    AbortController: Controller,
  })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => (old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]));
  }
  const container = new Element('div');
  const button = new Element('button');
  const note = new Element('aside');
  const surface = {
    querySelectorAll: () => [button],
    querySelector: () => note,
  };
  container.closest = () => surface;
  const all = (root, tag) =>
    root.children.flatMap((node) => [...(node.tagName === tag ? [node] : []), ...all(node, tag)]);
  const text = (node) => node.textContent + node.children.map(text).join('');
  return {
    container,
    button,
    observers,
    window: win,
    all,
    text,
    measurements: () => measurements,
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

test('explicit demo pyramid mount renders four readings, toggles both ways, and disposes cleanly', (t) => {
  const h = mountHarness(t);
  const report = { demo: true };
  const model = demoScoreModel(report);
  const dispose = mountStatusRadar(h.container, report);
  t.after(dispose);
  assert.equal(h.container.dataset.axisCount, '4');
  assert.equal(h.container.dataset.animationState, 'settled');
  assert.deepEqual(
    JSON.parse(h.container.dataset.displayScores),
    model.axes.map((axis) => axis.score),
  );
  assert.deepEqual(
    h.all(h.container, 'dt').map(h.text),
    model.axes.map((axis) => axis.label),
  );
  assert.deepEqual(
    h.all(h.container, 'dd').map(h.text),
    model.axes.map((axis) => String(axis.score)),
  );
  assert.ok(h.all(h.container, 'dd').every((node) => node.dataset.unavailable === 'false'));
  assert.equal(h.button.disabled, false);

  h.button.dispatchEvent(new Event('click'));
  assert.equal(h.container.dataset.previewMode, 'projected');
  assert.equal(h.button.getAttribute('aria-pressed'), 'true');
  assert.equal(h.button.textContent, '기본 도형으로 돌아가기');
  assert.equal(h.all(h.container, 'dl')[0].style.visibility, 'hidden');
  assert.equal(h.all(h.container, 'dl')[0].getAttribute('aria-hidden'), 'true');
  assert.deepEqual(
    h.all(h.container, 'dd').map(h.text),
    model.axes.map((axis) => String(axis.score)),
  );
  assert.deepEqual(
    JSON.parse(h.container.dataset.displayScores),
    model.preview.axes.map((axis) => axis.score),
  );
  h.button.dispatchEvent(new Event('click'));
  assert.equal(h.container.dataset.previewMode, 'current');
  assert.equal(h.all(h.container, 'dl')[0].style.visibility, '');
  assert.deepEqual(
    JSON.parse(h.container.dataset.displayScores),
    model.axes.map((axis) => axis.score),
  );

  dispose();
  assert.equal(h.container.children.length, 0);
  assert.deepEqual(h.container.dataset, {});
  assert.ok(h.observers.every((observer) => observer.disconnected));
  h.button.dispatchEvent(new Event('click'));
  assert.deepEqual(h.container.dataset, {});
});

test('preview readings stay hidden throughout the return morph and restore exact baseline values', (t) => {
  const h = mountHarness(t, { reducedMotion: false });
  const report = { demo: true };
  const baseline = demoScoreModel(report).axes.map((axis) => String(axis.score));
  const dispose = mountStatusRadar(h.container, report);
  t.after(dispose);
  const readings = h.all(h.container, 'dl')[0];
  h.advance(40);
  h.button.dispatchEvent(new Event('click'));
  h.advance(15);
  assert.equal(readings.style.visibility, 'hidden');
  h.button.dispatchEvent(new Event('click'));
  h.advance(15);
  assert.equal(h.container.dataset.animationState, 'morphing');
  assert.equal(readings.style.visibility, 'hidden');
  assert.deepEqual(h.all(h.container, 'dd').map(h.text), baseline);
  h.advance(25);
  assert.equal(h.container.dataset.animationState, 'settled');
  assert.equal(readings.style.visibility, '');
  assert.deepEqual(h.all(h.container, 'dd').map(h.text), baseline);
  dispose();
});

function actualReport(scores) {
  return {
    source: 'backend',
    score_components: Object.fromEntries(
      ['resume_completeness', 'job_fit', 'qualifications', 'practical_competitiveness'].map(
        (id, index) => [id, { score: scores[index] }],
      ),
    ),
  };
}

test('backend readings round only their display and preserve zero without random fallback', (t) => {
  const h = mountHarness(t);
  const random = Math.random;
  Math.random = () => {
    throw new Error('Backend scores must not use random demo data');
  };
  t.after(() => {
    Math.random = random;
  });
  const scores = [81.125, 62.375, 0, 99.9];
  const dispose = mountStatusRadar(h.container, actualReport(scores));
  t.after(dispose);
  assert.deepEqual(h.all(h.container, 'dd').map(h.text), ['81', '62', '0', '100']);
  assert.deepEqual(JSON.parse(h.container.dataset.radarScores), scores);
  assert.deepEqual(JSON.parse(h.container.dataset.displayScores), scores);
  assert.equal(h.container.children[0].dataset.complete, 'true');
  assert.ok(h.all(h.container, 'dd').every((value) => value.dataset.unavailable === 'false'));
  assert.equal(h.all(h.container, 'dd')[2].dataset.score, '0');
  assert.equal(h.button.disabled, true);
  h.button.dispatchEvent(new Event('click'));
  assert.equal(h.container.dataset.previewMode, 'current');
  const scene = h.all(h.container, 'div').find((node) => node.className === 'score-pyramid__scene');
  assert.match(scene.getAttribute('aria-label'), /백엔드에서 산출한 실제 평가 점수/);
  assert.doesNotMatch(scene.getAttribute('aria-label'), /시연용|실제 평가와 무관/);
  assert.match(h.text(h.container), /평가 점수 · 파랑/);
  dispose();
});

test('an incomplete backend chart preserves the full frame and only plots available rays and points', (t) => {
  const h = mountHarness(t);
  const scores = [81.125, 62.375, null, 0];
  const dispose = mountStatusRadar(h.container, actualReport(scores));
  t.after(dispose);
  const chart = h.container.children[0];
  assert.equal(chart.dataset.complete, 'false');
  assert.equal(chart.dataset.renderer, 'fallback');
  assert.deepEqual(JSON.parse(h.container.dataset.radarScores), scores);
  assert.deepEqual(JSON.parse(h.container.dataset.displayScores), scores);
  assert.deepEqual(h.all(h.container, 'dd').map(h.text), ['81', '62', '미산정', '0']);
  assert.deepEqual(
    h.all(h.container, 'dd').map((value) => value.dataset.score),
    ['81.125', '62.375', 'null', '0'],
  );
  assert.deepEqual(
    h.all(h.container, 'dd').map((value) => value.dataset.unavailable),
    ['false', 'false', 'true', 'false'],
  );
  const polygons = h.all(h.container, 'polygon');
  assert.equal(polygons.length, 8);
  assert.ok(
    polygons.slice(0, 4).every((face) => face.getAttribute('points').split(' ').length === 3),
  );
  assert.ok(polygons.slice(4).every((face) => face.style.display === 'none'));
  assert.equal((h.all(h.container, 'path')[0].getAttribute('d').match(/M/g) || []).length, 6);
  const rays = h
    .all(h.container, 'line')
    .filter((node) => node.getAttribute('class') === 'score-pyramid__fallback-ray');
  const points = h.all(h.container, 'circle');
  for (const nodes of [rays, points]) {
    assert.deepEqual(
      nodes
        .filter((node) => node.style.display !== 'none')
        .map((node) => node.getAttribute('data-axis-index')),
      ['0', '1', '3'],
    );
    assert.equal(nodes[2].getAttribute('data-score'), 'null');
    assert.equal(nodes[3].getAttribute('data-score'), '0');
  }
  assert.equal(
    rays[3].getAttribute('x1'),
    rays[3].getAttribute('x2'),
    'zero is a real center endpoint',
  );
  assert.equal(rays[3].getAttribute('y1'), rays[3].getAttribute('y2'));
  assert.equal(points[3].getAttribute('cx'), rays[3].getAttribute('x1'));
  assert.equal(points[3].getAttribute('cy'), rays[3].getAttribute('y1'));
  assert.match(h.text(h.container), /확인된 점수만 선과 점/);
  assert.equal(h.button.disabled, true);
  // A non-WebGL chart must not become a blank canvas after a spurious restore event.
  h.all(h.container, 'canvas')[0].dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(chart.dataset.renderer, 'fallback');
  const scene = h.all(h.container, 'div').find((node) => node.className === 'score-pyramid__scene');
  const key = new Event('keydown');
  key.key = 'ArrowRight';
  scene.dispatchEvent(key);
  h.window.dispatchEvent(new Event('beforeprint'));
  assert.deepEqual(JSON.parse(h.container.dataset.displayScores), scores);
  assert.ok(polygons.slice(4).every((face) => face.style.display === 'none'));
  h.window.dispatchEvent(new Event('afterprint'));
  assert.equal(chart.dataset.renderer, 'fallback');
  dispose();
  assert.deepEqual(h.container.dataset, {});
});

test('a backend report with no available axis renders no value geometry and never substitutes zero', (t) => {
  const h = mountHarness(t);
  const dispose = mountStatusRadar(h.container, actualReport([null, null, null, null]));
  t.after(dispose);
  assert.deepEqual(h.all(h.container, 'dd').map(h.text), ['미산정', '미산정', '미산정', '미산정']);
  assert.deepEqual(JSON.parse(h.container.dataset.displayScores), [null, null, null, null]);
  assert.ok(h.all(h.container, 'circle').every((node) => node.style.display === 'none'));
  assert.ok(
    h
      .all(h.container, 'polygon')
      .slice(4)
      .every((node) => node.style.display === 'none'),
  );
  assert.match(h.text(h.container), /100점 기준 프레임만 표시/);
  dispose();
});

test('crystal fallback and color transitions use the selected blue palette', (t) => {
  const h = mountHarness(t);
  const dispose = mountStatusRadar(h.container, { demo: true });
  t.after(dispose);
  const colors = (hex) =>
    `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ')})`;
  const polygons = h.all(h.container, 'polygon');
  assert.equal(h.all(h.container, 'svg')[0].style.background, scorePyramidPalette.background);
  assert.equal(polygons[0].getAttribute('fill'), scorePyramidPalette.glass);
  assert.equal(h.all(h.container, 'path')[0].getAttribute('stroke'), scorePyramidPalette.edge);
  assert.equal(polygons[4].getAttribute('fill'), colors(scorePyramidPalette.base));
  h.button.dispatchEvent(new Event('click'));
  assert.equal(polygons[4].getAttribute('fill'), colors(scorePyramidPalette.projected));
  assert.equal(
    h.container.children[0].style['--pyramid-value'],
    colors(scorePyramidPalette.projected),
  );
  assert.match(h.text(h.container), /변화 예시 · 하늘색/);
  assert.doesNotMatch(h.text(h.container), /금색|붉은색/);
  dispose();
});

test('full axis labels stay inside a narrow canvas without overlaps across a full rotation', (t) => {
  const h = mountHarness(t);
  const report = { demo: true };
  const dispose = mountStatusRadar(h.container, report);
  t.after(dispose);
  const labels = h
    .all(h.container, 'span')
    .filter((node) => node.className === 'score-pyramid__vertex');
  const scene = h.all(h.container, 'div').find((node) => node.className === 'score-pyramid__scene');
  assert.deepEqual(
    labels.map(h.text),
    demoScoreModel(report).axes.map((axis) => axis.label),
  );
  h.observers[0].callback([{ contentRect: { width: 264, height: 280 } }]);
  const measurements = h.measurements();
  for (let index = 0; index < 33; index++) {
    const key = new Event('keydown');
    key.key = 'ArrowRight';
    scene.dispatchEvent(key);
    const boxes = labels.map((label) => {
      const [, x, y] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(label.style.transform);
      return { x: +x, y: +y, width: 10 + label.textContent.length * 12, height: 23 };
    });
    boxes.forEach((box, a) => {
      assert.ok(box.x >= 8 && box.x + box.width <= 256);
      assert.ok(box.y >= 8 && box.y + box.height <= 272);
      boxes.slice(a + 1).forEach((other) => {
        assert.ok(
          box.x + box.width <= other.x ||
            other.x + other.width <= box.x ||
            box.y + box.height <= other.y ||
            other.y + other.height <= box.y,
        );
      });
    });
  }
  assert.equal(h.measurements(), measurements, 'Rotation must reuse cached label dimensions');
  dispose();
});

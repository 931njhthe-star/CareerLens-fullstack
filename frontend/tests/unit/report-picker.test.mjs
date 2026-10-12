import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentSavedReport,
  pickerItems,
  pickerRows,
  loadPickerPages,
  bindSavedReportPicker,
} from '../../src/features/analysis/saved-report-picker.js';
import {
  displayScore,
  displayReportMarkdown,
} from '../../src/features/analysis/report-presentation.js';
import { analysisReport } from '../../src/features/analysis/report.js';

test('integer display keeps unavailable and actual zero distinct', () => {
  assert.deepEqual(
    [78.85, 52.648, 65.077, 99.9, 0, null, undefined, NaN].map((n) => displayScore(n)),
    ['79', '53', '65', '100', '0', '제공되지 않음', '제공되지 않음', '제공되지 않음'],
  );
});

test('report metadata IDs disappear without modifying source, evidence, confidence or code', () => {
  const source =
    '- 평가 ID: secret-id\n- 종합 매칭 점수: **78.85**\n\n| 항목 | 점수 | 신뢰도 | 설명 |\n|---|---:|---:|---|\n| 기술 | 52.648 | 0.85 | 1.5년의 경험 \\| 비교 |\n\n```md\n- 평가 ID: quoted-id\n```';
  const output = displayReportMarkdown(source);
  assert.doesNotMatch(output, /secret-id/);
  assert.match(output, /\*\*79\*\*/);
  assert.ok(output.includes('| 53 | 0.85 | 1.5년의 경험 \\| 비교 |'));
  assert.match(output, /평가 ID: quoted-id/);
  assert.match(source, /secret-id/);
  const markup = analysisReport({
    report: { source: 'backend', run_id: 'secret-id', backend_report_text: source.split('```')[0] },
  });
  assert.doesNotMatch(markup, /평가 ID|secret-id/);
  assert.match(markup, /data-open-report-picker/);
});

test('current saved report stays in account order and is never inserted into an incomplete page', () => {
  const current = { id: 'old', job_context: { title: '이전 공고' } };
  const items = [{ id: 'new' }, { id: 'old' }, { id: 'new' }];
  assert.deepEqual(pickerItems(items, current), [items[0], { ...items[1], job_context: current.job_context }]);
  assert.deepEqual(pickerItems([items[0]], current), [items[0]]);
  assert.equal(currentSavedReport({ report: { demo: true, run_id: 'demo' } }), null);
  const selected = currentSavedReport({
    role: '다른 공고',
    report: {
      source: 'backend',
      run_id: 'old',
      job_context: { title: '원래 공고', company: '원래 기업' },
    },
  });
  assert.equal(selected.id, 'old');
  assert.equal(selected.job_context.title, '원래 공고');
  const markup = pickerRows(pickerItems(items, current), 'old');
  assert.equal((markup.match(/aria-current="page"/g) || []).length, 1);
  assert.match(markup, /report-picker__item--current/);
  assert.match(markup, /현재 보고서/);
  assert.doesNotMatch(markup, /평가 ID/);
});

test('sidebar report metadata and route identifiers are escaped', () => {
  const html = pickerRows(
    [{ id: '"><x>', job_context: { title: '<img onerror=alert(1)>', company: '<script>' } }],
    'none',
  );
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img'));
  assert.match(html, /href="#\/reports\/%22%3E%3Cx%3E"/);
});

test('current report lookup crosses sparse pages and preserves every returned position', async () => {
  const pages = [
    { items: [{ id: 'new' }, { id: 'second' }, { id: 'third' }, { id: 'fourth' }], next_offset: 20 },
    { items: [], next_offset: 40 },
    { items: [{ id: 'older' }, { id: 'current' }], next_offset: 60 },
  ];
  const state = { items: [], offset: 0 };
  const offsets = [];
  await loadPickerPages({ state, current: { id: 'current' }, signal: new AbortController().signal,
    api: async (path) => { offsets.push(path); return pages.shift(); } });
  assert.deepEqual(offsets, ['/account/reports?offset=0', '/account/reports?offset=20', '/account/reports?offset=40']);
  assert.deepEqual(state.items.map((item) => item.id), ['new', 'second', 'third', 'fourth', 'older', 'current']);
  assert.equal(state.offset, 60);
});

test('missing current is not fabricated when pages are exhausted', async () => {
  const state = { items: [], offset: 0 };
  await loadPickerPages({ state, current: { id: 'missing' }, signal: new AbortController().signal,
    api: async () => ({ items: [{ id: 'real' }], next_offset: null }) });
  assert.deepEqual(state.items, [{ id: 'real' }]);
  assert.equal(state.offset, null);
});

test('aborted stale list responses never update the account state', async () => {
  const controller = new AbortController();
  const state = { items: [], offset: 0 };
  let resolve;
  const pending = loadPickerPages({ state, signal: controller.signal,
    api: () => new Promise((done) => { resolve = done; }) });
  controller.abort();
  resolve({ items: [{ id: 'stale' }], next_offset: null });
  await pending;
  assert.deepEqual(state, { items: [], offset: 0 });
});

test('invalid repeated pagination cannot create an endless current-report search', async () => {
  const state = { items: [], offset: 0 };
  await assert.rejects(loadPickerPages({ state, current: { id: 'older' },
    signal: new AbortController().signal,
    api: async () => ({ items: [], next_offset: 0 }) }));
  assert.deepEqual(state, { items: [], offset: 0 });
});

function sidebarFixture({ mobile = false } = {}) {
  const nodes = [];
  class Element {
    constructor() {
      this.attrs = {}; this.dataset = {}; this.listeners = new Map(); this.children = [];
      this.scrollTop = 0; this.clientHeight = 384; this.isConnected = true;
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    set innerHTML(value) {
      this.html = value;
      if (value.includes('report-picker__header')) {
        this.controls = Object.fromEntries(['.report-picker__list', '.report-picker__feedback', '[data-picker-more]', '[data-picker-close]']
          .map((selector) => [selector, new Element()]));
        this.children = Object.values(this.controls);
      } else if (value.includes('data-picker-report')) {
        this.children = [...value.matchAll(/data-picker-report="([^"]+)"/g)].map((match) => {
          const element = new Element(); element.dataset.pickerReport = match[1]; return element;
        });
      } else this.children = [];
    }
    get innerHTML() { return this.html; }
    setAttribute(name, value) { this.attrs[name] = value; }
    removeAttribute(name) { delete this.attrs[name]; }
    querySelector(selector) { return this.controls?.[selector] || null; }
    querySelectorAll(selector) {
      if (selector === '[data-picker-report]') return this.children.filter((child) => child.dataset.pickerReport);
      return this.children;
    }
    append(...children) { this.children.push(...children); nodes.push(...children); }
    contains(element) { return this === element || this.children.some((child) => child.contains(element)); }
    focus() { document.activeElement = this; }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    removeEventListener(type) { this.listeners.delete(type); }
    remove() { this.isConnected = false; }
    click() { this.listeners.get('click')?.({ target: this, preventDefault() {} }); }
  }
  const body = new Element(), trigger = new Element(), app = new Element();
  const mediaListeners = new Map();
  const media = { matches: mobile, addEventListener: (type, listener) => mediaListeners.set(type, listener),
    removeEventListener: (type) => mediaListeners.delete(type) };
  const document = { body, activeElement: trigger, listeners: new Map(),
    createElement: () => new Element(), getElementById: () => app,
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    removeEventListener(type) { this.listeners.delete(type); } };
  const originals = Object.fromEntries(['document', 'window', 'getComputedStyle'].map((key) => [key, globalThis[key]]));
  globalThis.document = document;
  globalThis.window = { matchMedia: () => media };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '96' });
  return { trigger, nodes, app, document, mediaListeners,
    restore() { for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    } } };
}

test('sidebar keeps its original current position, scroll and expanded state across report navigation', () => {
  const fixture = sidebarFixture();
  let dispose;
  try {
    const state = { items: Array.from({ length: 100 }, (_, index) => ({ id: `report-${index}`, job_context: { title: `공고 ${index}` } })),
      offset: null, loaded: true, expanded: false, scrollTop: 0 };
    const options = { state, draft: { report: { source: 'backend', run_id: 'report-70' } }, api: () => { throw new Error('Unexpected request'); } };
    dispose = bindSavedReportPicker(fixture.trigger, options);
    fixture.trigger.click();
    const panel = fixture.nodes.find((node) => node.id === 'saved-report-sidebar');
    const list = panel.querySelector('.report-picker__list');
    assert.equal(state.expanded, true);
    assert.equal(state.items[70].id, 'report-70');
    assert.ok(list.scrollTop <= 70 * 96 && list.scrollTop + 384 >= 71 * 96);
    assert.ok(list.children.length <= 41);
    const currentScroll = list.scrollTop;
    fixture.trigger.click();
    assert.equal(state.scrollTop, currentScroll);
    fixture.trigger.click();
    assert.equal(list.scrollTop, currentScroll);
    dispose();
    assert.equal(state.expanded, true);
    assert.equal(fixture.document.listeners.size, 0);
    assert.equal(fixture.mediaListeners.size, 0);
    dispose = bindSavedReportPicker(fixture.trigger, { ...options, draft: { report: { source: 'backend', run_id: 'report-71' } } });
    assert.equal(fixture.trigger.attrs['aria-expanded'], 'true');
    assert.equal(state.items[71].id, 'report-71');
    assert.equal(state.scrollTop, currentScroll);
    assert.equal(state.offset, null);
  } finally { dispose?.(); fixture.restore(); }
});

test('mobile drawer closes on Escape, restores focus and releases inert content', () => {
  const fixture = sidebarFixture({ mobile: true });
  let dispose;
  try {
    const state = { items: [], offset: null, loaded: true };
    dispose = bindSavedReportPicker(fixture.trigger, { state, api: async () => ({ items: [], next_offset: null }) });
    fixture.trigger.click();
    const panel = fixture.nodes.find((node) => node.id === 'saved-report-sidebar');
    assert.equal(panel.attrs.role, 'dialog');
    assert.equal(panel.attrs['aria-modal'], 'true');
    assert.equal(fixture.app.inert, true);
    fixture.document.listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
    assert.equal(state.expanded, false);
    assert.equal(fixture.app.inert, false);
    assert.equal(fixture.document.activeElement, fixture.trigger);
  } finally { dispose?.(); fixture.restore(); }
});

test('closing aborts context hydration and a stale unauthorized response cannot close a reopened sidebar', async () => {
  const fixture = sidebarFixture();
  let dispose;
  try {
    const state = { items: [{ id: 'real' }], offset: null, loaded: true };
    const requests = [];
    let unauthorizedCalls = 0;
    dispose = bindSavedReportPicker(fixture.trigger, { state,
      onUnauthorized: () => unauthorizedCalls++,
      api: (_path, { signal }) => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })) });
    fixture.trigger.click();
    assert.equal(requests.length, 1);
    fixture.trigger.click();
    assert.equal(requests[0].signal.aborted, true);
    fixture.trigger.click();
    assert.equal(requests.length, 2);
    requests[0].reject(Object.assign(new Error('private backend detail'), { status: 401 }));
    await new Promise(setImmediate);
    assert.equal(unauthorizedCalls, 0);
    assert.equal(state.expanded, true);
    requests[1].resolve({ job_context: { title: '새 응답' } });
    await new Promise(setImmediate);
    assert.equal(state.items[0].job_context.title, '새 응답');
  } finally { dispose?.(); fixture.restore(); }
});

test('account list failure displays a safe retry message and retains returned rows', async () => {
  const fixture = sidebarFixture();
  let dispose;
  try {
    const state = { items: [{ id: 'real', job_context: { title: '기존 보고서' } }], offset: 20,
      loaded: true };
    dispose = bindSavedReportPicker(fixture.trigger, { state,
      draft: { report: { source: 'backend', run_id: 'missing' } },
      api: async () => { throw new Error('private.backend.example/trace'); } });
    fixture.trigger.click();
    await new Promise(setImmediate);
    const panel = fixture.nodes.find((node) => node.id === 'saved-report-sidebar');
    assert.match(panel.querySelector('.report-picker__feedback').textContent, /다시 불러오기/);
    assert.doesNotMatch(panel.querySelector('.report-picker__feedback').textContent, /private|trace/);
    assert.equal(panel.querySelector('[data-picker-more]').hidden, false);
    assert.deepEqual(state.items.map((item) => item.id), ['real']);
    assert.equal(state.offset, 0);
  } finally { dispose?.(); fixture.restore(); }
});

for (const cachedOffset of [null, 20]) {
  test(`uncached new current report refreshes the first page of a ${cachedOffset === null ? 'completed' : 'partial'} cache`, async () => {
    const fixture = sidebarFixture();
    let dispose;
    try {
      const oldRows = Array.from({ length: 5 }, (_, index) => ({
        id: `old-${index}`, job_context: { title: `이전 공고 ${index}` },
      }));
      const state = { items: oldRows, offset: cachedOffset, loaded: true,
        expanded: true, scrollTop: 96, currentId: 'old-3' };
      const firstPage = [
        { id: 'new-current', job_context: { title: '새 분석 공고' } },
        ...oldRows.slice(0, 3),
      ];
      const requests = [];
      dispose = bindSavedReportPicker(fixture.trigger, { state,
        draft: { report: { source: 'backend', run_id: 'new-current' } },
        api: async (path) => {
          requests.push(path);
          return { items: firstPage, next_offset: 20 };
        } });
      await new Promise(setImmediate);
      assert.deepEqual(requests, ['/account/reports?offset=0']);
      assert.deepEqual(state.items.map((item) => item.id), ['new-current', 'old-0', 'old-1', 'old-2']);
      assert.equal(state.offset, 20);
      assert.equal(state.currentId, 'new-current');
      assert.equal(state.scrollTop, 0);
      assert.equal(state.expanded, true);
      const panel = fixture.nodes.find((node) => node.id === 'saved-report-sidebar');
      assert.match(panel.querySelector('.report-picker__list').innerHTML, /aria-current="page"/);
    } finally { dispose?.(); fixture.restore(); }
  });
}

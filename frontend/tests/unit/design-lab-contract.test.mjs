import assert from 'node:assert/strict';
import test from 'node:test';
import { defaults, groups, selectionFromSearch } from '../../src/features/design-lab/presets.js';
import { renderPreview } from '../../src/features/design-lab/preview.js';

const categoryNames = ['theme', 'layout', 'eye', 'pyramid', 'effect'];
const axisNames = ['이력서 완성도', '직무 적합도', '지원 자격 충족도', '실무 경쟁력'];

test('shareable selections accept every published option and retain only five known categories', () => {
  assert.deepEqual(Object.keys(groups), categoryNames);
  assert.deepEqual(selectionFromSearch(''), defaults);
  for (const [category, options] of Object.entries(groups)) {
    for (const option of options) {
      const query = new URLSearchParams({
        ...defaults,
        [category]: option.id,
        backend: 'https://untrusted.example.invalid/api',
        resume: 'private-resume-must-not-be-retained',
        report: 'private-report-must-not-be-retained',
      });
      const selection = selectionFromSearch(`?${query}`);
      assert.deepEqual(selection, { ...defaults, [category]: option.id });
      assert.deepEqual(Object.keys(selection), categoryNames);
      assert.deepEqual(selectionFromSearch(new URLSearchParams(selection).toString()), selection);
    }
  }
});

test('invalid, encoded, and prototype-like query values fall back without becoming markup', () => {
  const invalidValues = [
    '',
    'unknown-option',
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    '<img src=x onerror="alert(1)">',
    'javascript:alert(1)',
    '../../.env',
    '\u0000',
    ' porcelain ',
    'FOCUS',
  ];
  for (const value of invalidValues) {
    const params = new URLSearchParams(categoryNames.map((key) => [key, value]));
    assert.deepEqual(selectionFromSearch(`?${params}`), defaults, value);
  }
  assert.deepEqual(selectionFromSearch('?theme=%E0%A4%A&effect=%'), defaults);
  assert.equal(selectionFromSearch('?theme=%63%6F%62%61%6C%74').theme, 'cobalt');
  // A duplicate cannot turn an invalid first selection into an unvalidated override.
  assert.equal(selectionFromSearch('?theme=unknown&theme=cobalt').theme, defaults.theme);
  assert.equal(selectionFromSearch('?theme=cobalt&theme=constructor').theme, 'cobalt');
});

test('defaults and coordinated theme choices reference unique, available presets', () => {
  assert.equal(groups.theme.length, 6);
  assert.equal(groups.layout.length, 6);
  for (const category of ['eye', 'pyramid', 'effect']) assert.equal(groups[category].length, 5);
  for (const [category, options] of Object.entries(groups)) {
    const ids = options.map((option) => option.id);
    assert.equal(new Set(ids).size, ids.length, `${category} contains a duplicate identifier`);
    assert.ok(ids.includes(defaults[category]), `${category} has an unavailable default`);
  }
  for (const theme of groups.theme) {
    for (const category of ['eye', 'pyramid', 'effect']) {
      assert.ok(
        groups[category].some((option) => option.id === theme[category]),
        `${theme.id} coordinates an unavailable ${category}`,
      );
    }
  }
  const theme = groups.theme.find((option) => option.id === defaults.theme);
  for (const category of ['eye', 'pyramid', 'effect']) {
    assert.equal(defaults[category], theme[category]);
  }
});

test('six distinct layouts retain one report, one pyramid, four named axes, and fiction labels', (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    assert.fail('A synthetic preview must render without contacting an API');
  });
  const rendered = new Set();
  for (const { id: layout } of groups.layout) {
    const markup = renderPreview({ layout });
    rendered.add(markup);
    assert.equal((markup.match(/\bdata-report-frame\b/g) || []).length, 1, layout);
    assert.equal((markup.match(/\bdata-pyramid-host\b/g) || []).length, 1, layout);
    assert.ok(markup.includes(`preview-site--${layout}`), layout);
    assert.deepEqual(
      [...markup.matchAll(/<h4>(.*?)<\/h4>/g)]
        .map((match) => match[1])
        .filter((name) => axisNames.includes(name)),
      axisNames,
      layout,
    );
    assert.ok(markup.includes('가상 인물'), layout);
    assert.ok(markup.includes('가상 공고'), layout);
    assert.ok(markup.includes('가상 이력서'), layout);
    assert.ok(markup.includes('실제 평가 결과가 아닙니다'), layout);
    assert.ok(markup.includes('디자인 비교용 가상 보고서'), layout);
    assert.doesNotMatch(markup, /\/api\/|<script\b|<form\b/i);
    // Passing unrelated account/workspace data cannot change the synthetic document.
    assert.equal(
      renderPreview({
        layout,
        user: { name: 'REAL_USER_MUST_NOT_APPEAR' },
        report: { summary: 'PRIVATE_REPORT_MUST_NOT_APPEAR' },
        resume_text: 'PRIVATE_RESUME_MUST_NOT_APPEAR',
      }),
      markup,
    );
  }
  assert.equal(rendered.size, 6);
});

test('unrecognized layout names render the safe default composition', () => {
  const fallback = renderPreview();
  for (const layout of ['unknown', '__proto__', 'constructor', 'toString', '" onclick="alert(1)']) {
    assert.equal(renderPreview({ layout }), fallback);
  }
});

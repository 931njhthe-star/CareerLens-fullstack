import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pyramidAxes,
  pyramidPreview,
  pyramidTransition,
} from '../../src/features/analysis/status-radar-data.js';
import {
  pyramidPoints,
  pyramidFraming,
  PYRAMID_VERTICES,
  PYRAMID_EDGES,
} from '../../tools/matching-eye/src/pyramid-geometry.ts';
import { analysisReport } from '../../src/features/analysis/report.js';

const criteria = [
  { label: '희망 직무 경험 연결', score: 35, max_score: 70 },
  { label: '수행 맥락', score: 10, max_score: 20 },
  { label: '수치로 표현한 결과·규모', score: 2, max_score: 10 },
];
const report = {
  demo: true,
  score: 47,
  criteria,
  matches: [{ status: 'missing', requirement: '화면과 사용자 경험을 설계한 경험' }],
  improvement_preview: {
    basis: 'conditional_rules',
    score: 94,
    criteria: criteria.map((item, i) => ({ ...item, score: [70, 20, 4][i] })),
    assumptions: [
      { requirement: '실제 설계 경험', detail: '본인의 역할과 사용한 방법이 확인된다는 가정' },
    ],
    notice: '실제 수정 후 다시 분석합니다.',
  },
};

test('real pyramid uses the four backend domains exactly and never generates random scores', () => {
  const savedRandom = Math.random;
  Math.random = () => {
    throw new Error('Random values must not enter actual scores');
  };
  try {
    const actual = {
      source: 'backend',
      demo: true,
      score: null,
      score_components: {
        resume_completeness: { score: 78.8 },
        job_fit: { score: 52.6 },
        qualifications: { score: null },
        practical_competitiveness: { score: 65.1 },
      },
      backend_result: { qualifications: 99 },
    };
    const before = structuredClone(actual);
    assert.deepEqual(
      pyramidAxes(actual).map((axis) => axis.score),
      [78.8, 52.6, null, 65.1],
    );
    assert.equal(pyramidAxes(actual)[2].id, 'eligibility');
    assert.equal(pyramidPreview(actual), null);
    assert.deepEqual(actual, before);
    actual.score_components.qualifications.score = 0;
    assert.equal(pyramidAxes(actual)[2].score, 0);
    for (const value of [undefined, NaN, Infinity, '42', -1, 101]) {
      actual.score_components.job_fit.score = value;
      assert.equal(pyramidAxes(actual)[1].score, null);
    }
    assert.deepEqual(
      pyramidAxes({ score: 80 }).map((axis) => axis.score),
      [null, null, null, null],
    );
    assert.equal(pyramidPreview({}), null);
  } finally {
    Math.random = savedRandom;
  }
});

test('four demonstration axes stay independent of original scores and stable on rerender', () => {
  const before = structuredClone(report);
  const axes = pyramidAxes(report);
  assert.deepEqual(
    axes.map((axis) => axis.label),
    ['이력서 완성도', '직무 적합도', '지원 자격 충족도', '실무 경쟁력'],
  );
  assert.ok(axes.every((axis) => axis.normalized >= 35 && axis.normalized <= 90));
  assert.equal(pyramidAxes(report), axes);
  assert.equal(pyramidPreview(report).basis, 'presentation_demo');
  assert.ok(pyramidPreview(report).axes.every((axis, index) => axis.score > axes[index].score));
  assert.deepEqual(report, before);
});

test('server preview values do not influence the presentation demonstration', () => {
  const copy = structuredClone(report);
  const axes = pyramidAxes(copy);
  const preview = pyramidPreview(copy);
  copy.score = 100;
  copy.criteria = [];
  copy.improvement_preview = { basis: 'gpt', score: 0, criteria: [] };
  assert.equal(pyramidAxes(copy), axes);
  assert.equal(pyramidPreview(copy), preview);
});

test('100-point vertices form a regular centred tetrahedron and fractions stay inside it', () => {
  assert.deepEqual(pyramidPoints([100, 100, 100, 100]), PYRAMID_VERTICES);
  for (let axis = 0; axis < 3; axis++)
    assert.ok(Math.abs(PYRAMID_VERTICES.reduce((sum, p) => sum + p[axis], 0)) < 1e-12);
  const lengths = [];
  for (let i = 0; i < PYRAMID_EDGES.length; i += 2) {
    const a = PYRAMID_VERTICES[PYRAMID_EDGES[i]],
      b = PYRAMID_VERTICES[PYRAMID_EDGES[i + 1]];
    lengths.push(Math.hypot(...a.map((value, axis) => value - b[axis])));
  }
  assert.ok(Math.max(...lengths) - Math.min(...lengths) < 1e-12);
  const scores = [0, 25, 50, 75];
  pyramidPoints(scores).forEach((point, i) =>
    point.forEach((value, axis) =>
      assert.ok(Math.abs(value - (PYRAMID_VERTICES[i][axis] * scores[i]) / 100) < 1e-12),
    ),
  );
  assert.ok(pyramidPoints([NaN, -10, 500, Infinity]).flat().every(Number.isFinite));
});

test('morph is continuous, has eased endpoints and can reverse from an intermediate shape', () => {
  const a = [47, 50, 50, 20],
    b = [94, 100, 100, 40];
  assert.deepEqual(pyramidTransition(a, b, 0), a);
  assert.deepEqual(pyramidTransition(a, b, 1), b);
  const midway = pyramidTransition(a, b, 0.5);
  assert.deepEqual(midway, [70.5, 75, 75, 30]);
  assert.deepEqual(pyramidTransition(midway, a, 0), midway);
  assert.deepEqual(pyramidTransition(midway, a, 1), a);
  assert.ok(pyramidTransition(a, b, 0.001)[0] - a[0] < 0.000001);
});

test('fixed rotation framing centers the silhouette and keeps maximum hover and zoom in bounds', () => {
  for (const [width, height] of [
    [264, 260],
    [360, 320],
    [520, 320],
    [800, 320],
  ]) {
    for (const pitch of [-0.32, 0.08, 0.48]) {
      const frame = pyramidFraming(width, height, pitch);
      const extent = [];
      for (let step = 0; step < 192; step++) {
        const yaw = (step / 192) * Math.PI * 2;
        for (const zoom of [0.85, 1, 1.16]) {
          const points = PYRAMID_VERTICES.map(([x, y, z]) => {
            const rx = x * Math.cos(yaw) + z * Math.sin(yaw);
            const rz = -x * Math.sin(yaw) + z * Math.cos(yaw);
            const ry = y * Math.cos(pitch) - rz * Math.sin(pitch);
            const depth = y * Math.sin(pitch) + rz * Math.cos(pitch);
            const perspective = 5.6 / (5.6 - depth);
            return {
              x: width / 2 + rx * perspective * frame.scale * zoom,
              y: height / 2 + (-ry * perspective - frame.centerY) * frame.scale * zoom,
            };
          });
          for (const point of points) {
            assert.ok(point.x > 22 && point.x < width - 22);
            assert.ok(point.y > 22 && point.y < height - 22);
          }
          if (zoom === 1) extent.push(...points.map((point) => point.y));
        }
      }
      assert.ok(Math.abs((Math.min(...extent) + Math.max(...extent)) / 2 - height / 2) < 0.2);
      if (width >= 520) assert.ok(Math.max(...extent) - Math.min(...extent) > height * 0.65);
    }
  }
});

test('report marks demo values clearly, preserves missing badges and omits legacy score claims', () => {
  const copy = structuredClone(report);
  copy.improvement_preview.assumptions[0].detail = '<img src=x onerror=alert(1)>';
  const markup = analysisReport({ analysis_mode: 'desired_role', role: '디자이너', report: copy });
  assert.ok(!markup.includes('준비도 47점'));
  assert.ok(markup.includes('badge missing'));
  assert.ok(markup.includes('근거 부족'));
  assert.ok(markup.includes('시연용 점수 · 실제 평가와 무관'));
  assert.ok(!markup.includes('배점과 평가 근거'));
  assert.ok(!markup.includes('<img src=x'));
  assert.ok(!markup.includes('onerror'));
});

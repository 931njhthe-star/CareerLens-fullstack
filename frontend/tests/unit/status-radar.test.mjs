import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRadarCriteria,
  radarDescription,
  radarDisplayLabel,
  radarPosition,
  radarProgress,
} from '../../src/features/analysis/status-radar-data.js';

test('radar normalizes actual 70/20/10 weights without changing original scores', () => {
  const criteria = [
    { label: '공고 요구사항 연결', score: 35, max_score: 70 },
    { label: '수행 맥락', score: 10, max_score: 20 },
    { label: '수치로 표현한 결과·규모', score: 5, max_score: 10 },
  ];
  const axes = normalizeRadarCriteria(criteria);
  assert.deepEqual(
    axes.map((axis) => axis.normalized),
    [50, 50, 50],
  );
  assert.deepEqual(
    axes.map((axis) => [axis.score, axis.maximum]),
    [
      [35, 70],
      [10, 20],
      [5, 10],
    ],
  );
  assert.ok(radarDescription(axes[0]).includes('35 / 70점'));
  assert.deepEqual(
    criteria.map((axis) => axis.score),
    [35, 10, 5],
  );
});

test('3, 5, 6, 7 and larger real criterion lists retain exactly their supplied axes', () => {
  for (const count of [3, 5, 6, 7, 8, 11]) {
    const criteria = Array.from({ length: count }, (_, index) => ({
      label: `실제 기준 ${index + 1}`,
      score: index + 1,
      max_score: count,
    }));
    const axes = normalizeRadarCriteria(criteria);
    assert.equal(axes.length, count);
    assert.deepEqual(
      axes.map((axis) => axis.label),
      criteria.map((axis) => axis.label),
    );
    const points = axes.map((axis) => radarPosition(axis.index, count, 100));
    assert.equal(new Set(points.map((point) => `${point.x},${point.y}`)).size, count);
    assert.ok(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
});

test('zero is a valid score while missing scores and invalid maxima stay unavailable', () => {
  const axes = normalizeRadarCriteria([
    { label: '영점', score: 0, max_score: 20 },
    { label: '누락', score: null, max_score: 20 },
    { label: '배점 없음', score: 10, max_score: 0 },
    { label: '음수 배점', score: 10, max_score: -5 },
    { label: '잘못된 수', score: NaN, max_score: 10 },
    { label: '상한', score: 30, max_score: 10 },
  ]);
  assert.deepEqual(
    axes.map((axis) => axis.normalized),
    [0, null, null, null, null, 100],
  );
  assert.ok(radarDescription(axes[1]).includes('미산정'));
  assert.deepEqual(normalizeRadarCriteria(undefined), []);
});

test('one animation clock moves all axes together and settles at their exact score', () => {
  const values = [25, 50, 90];
  assert.equal(radarProgress(0), 0);
  const progress = radarProgress(0.75);
  assert.ok(progress > 0 && progress < 1);
  assert.deepEqual(
    values.map((value) => value * radarProgress(2)),
    values,
  );
  assert.ok(values.every((value) => Math.abs((value * progress) / value - progress) < 1e-12));
});

test('known chart labels are concise while full criteria and future labels remain intact', () => {
  const full = ['공고 요구사항 연결', '수행 맥락', '수치로 표현한 결과·규모'];
  assert.deepEqual(full.map(radarDisplayLabel), ['요구사항 연결', '수행 맥락', '결과·규모']);
  const axis = normalizeRadarCriteria([{ label: full[2], score: 7, max_score: 10 }])[0];
  assert.equal(axis.label, full[2]);
  assert.ok(radarDescription(axis).startsWith(full[2]));
  assert.equal(radarDisplayLabel('새로운 실제 평가 기준'), '새로운 실제 평가 기준');
});

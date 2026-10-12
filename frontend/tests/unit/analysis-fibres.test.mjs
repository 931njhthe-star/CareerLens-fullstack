import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAnalysisFibres,
  fibreCountForWidth,
  fibreGrowth,
  fibrePoint,
  fibreSegment,
  groupFibreProgress,
} from '../../tools/matching-eye/src/analysis-fibres.ts';
import { AnalysisTimeline } from '../../tools/matching-eye/src/analysis-timing.ts';
import {
  REPORT_CRITERIA,
  CRITERION_CORNERS,
  assignCriterionFibres,
  fibreCorner,
} from '../../tools/matching-eye/src/analysis-criteria.ts';
import {
  analysisViewport,
  analysisFoldScale,
  projectFibreTip,
} from '../../tools/matching-eye/src/analysis-projection.ts';
import {
  OrthographicCamera,
  Vector3,
} from '../../tools/matching-eye/node_modules/three/build/three.module.js';

test('needle identities, tip lengths and timings are stable across renders', () => {
  const fibres = createAnalysisFibres(180);
  assert.deepEqual(fibres, createAnalysisFibres(180));
  assert.equal(fibres.length, 180);
  assert.equal(new Set(fibres.map((fibre) => fibre.id)).size, fibres.length);
  assert.ok(
    Math.max(...fibres.map((fibre) => fibre.length)) -
      Math.min(...fibres.map((fibre) => fibre.length)) >
      24,
  );
  assert.ok(new Set(fibres.map((fibre) => fibre.onset.toFixed(3))).size > 70);
  assert.ok(new Set(fibres.map((fibre) => fibre.easing.toFixed(2))).size > 70);
});

test('analysis groups are dispersed around the whole pupil, not angular sectors', () => {
  const fibres = createAnalysisFibres(120);
  for (let start = 0; start < fibres.length; start += 3) {
    assert.deepEqual(
      fibres.slice(start, start + 3).map((fibre) => fibre.group),
      ['resume', 'role', 'report'],
    );
  }
  assert.equal(fibres.filter((fibre) => fibre.group === 'resume').length, 40);
});

test('every needle grows out of the empty pupil edge without retracting or moving its root', () => {
  for (const fibre of createAnalysisFibres(120)) {
    const initial = fibreSegment(fibre, 0);
    assert.equal(initial.growth, 0);
    assert.deepEqual(initial.start, initial.tip);
    assert.ok(Math.abs(Math.hypot(...initial.start) - 62) < 1e-10);
    let previous = 0;
    for (let step = 0; step <= 100; step += 1) {
      const segment = fibreSegment(fibre, step / 100);
      assert.deepEqual(segment.start, initial.start);
      assert.ok(segment.growth >= previous);
      assert.ok(Math.hypot(...segment.tip) >= 62 - 1e-10);
      previous = segment.growth;
    }
    assert.equal(previous, 1);
    assert.ok(Math.abs(Math.hypot(...fibrePoint(fibre, 1)) - (62 + fibre.length)) < 1e-10);
  }
});

test('onset and endpoint are continuous while separate needles grow at visibly different rates', () => {
  const fibres = createAnalysisFibres(180);
  for (const fibre of fibres) {
    assert.equal(fibreGrowth(fibre, fibre.onset), 0);
    assert.ok(fibreGrowth(fibre, fibre.onset + 1e-6) < 1e-5);
    assert.ok(1 - fibreGrowth(fibre, 1 - 1e-6) < 1e-5);
  }
  for (const progress of [0.25, 0.5, 0.75]) {
    const growth = fibres.map((fibre) => fibreGrowth(fibre, progress));
    assert.ok(Math.max(...growth) - Math.min(...growth) > 0.15);
  }
});

test('an unresolved analysis can never fill all needles, even after a long wait', () => {
  const fibres = createAnalysisFibres(120);
  const timeline = new AnalysisTimeline(0);
  const pendingProgress = timeline.progress(600000);
  assert.ok(fibres.every((fibre) => fibreGrowth(fibre, pendingProgress) < 1));
  for (const group of ['resume', 'role', 'report'])
    assert.ok(groupFibreProgress(fibres, pendingProgress, group) < 1);
  timeline.setStatus(true, false, 600000);
  const completeProgress = timeline.progress(timeline.readyAt);
  assert.ok(fibres.every((fibre) => fibreGrowth(fibre, completeProgress) === 1));
});

test('each callout group measures its own needle growth and malformed values fail closed', () => {
  const fibres = createAnalysisFibres(180);
  const values = ['resume', 'role', 'report'].map((group) =>
    groupFibreProgress(fibres, 0.5, group),
  );
  assert.ok(values[0] > values[1] && values[1] > values[2]);
  assert.equal(groupFibreProgress([], 0.5, 'resume'), 0);
  assert.equal(fibreGrowth(fibres[0], NaN), 0);
  assert.equal(fibreGrowth(fibres[0], Infinity), 0);
  assert.equal(fibreGrowth(fibres[0], -1), 0);
  assert.equal(fibreGrowth(fibres[0], 2), 1);
  assert.equal(fibreCountForWidth(390), 120);
  assert.equal(fibreCountForWidth(1024), 180);
});

test('the twelve exact criteria remain independent of the three API transport stages', () => {
  assert.deepEqual(
    REPORT_CRITERIA.map(({ axis, label }) => [axis, label]),
    [
      ['이력서 완성도', '경험 설명의 구체성'],
      ['이력서 완성도', '성과 근거의 명확성'],
      ['이력서 완성도', '구성과 가독성'],
      ['직무 적합도', '핵심 기술 일치도'],
      ['직무 적합도', '담당 업무 연관성'],
      ['직무 적합도', '우대 역량 부합도'],
      ['지원 자격 충족도', '관련 경력 충족도'],
      ['지원 자격 충족도', '학력·전공 충족도'],
      ['지원 자격 충족도', '기타 필수조건 충족도'],
      ['실무 경쟁력', '업무 규모·난도 경쟁력'],
      ['실무 경쟁력', '운영·문제 해결 경쟁력'],
      ['실무 경쟁력', '역할·책임 수준 경쟁력'],
    ],
  );
});

test('a run seed creates twelve unique dispersed bindings that remain stable until the next run', () => {
  const ids = REPORT_CRITERIA.map(({ id }) => id);
  for (const count of [120, 180]) {
    const fibres = createAnalysisFibres(count);
    const original = structuredClone(fibres);
    for (const seed of [0, 1, 4, 71, 998, 4294967295]) {
      const bindings = assignCriterionFibres(ids, fibres, seed);
      assert.deepEqual(bindings, assignCriterionFibres(ids, fibres, seed));
      assert.notDeepEqual(bindings, assignCriterionFibres(ids, fibres, seed + 1));
      assert.equal(bindings.length, 12);
      assert.equal(new Set(bindings.map(({ fibre }) => fibre.id)).size, 12);
      assert.deepEqual(bindings.map(({ id }) => id).sort(), [...ids].sort());
      for (const corner of CRITERION_CORNERS)
        assert.equal(bindings.filter((binding) => binding.corner === corner).length, 3);
      assert.ok(
        bindings.every(
          ({ fibre, corner }) => fibres[fibre.id] === fibre && corner === fibreCorner(fibre),
        ),
      );
    }
    assert.deepEqual(fibres, original);
  }
  assert.deepEqual(assignCriterionFibres(ids, createAnalysisFibres(12).slice(1), 10), []);
  assert.deepEqual(
    assignCriterionFibres(['duplicate', 'duplicate'], createAnalysisFibres(120), 10),
    [],
  );
});

test('each gauge and leader endpoint uses its individual fibre growth in both rendering projections', () => {
  const bindings = assignCriterionFibres(
    REPORT_CRITERIA.map(({ id }) => id),
    createAnalysisFibres(180),
    217,
  );
  for (const [width, height] of [
    [1024, 510],
    [768, 440],
    [390, 250],
    [1800, 510],
  ]) {
    const view = analysisViewport(width, height);
    const camera = new OrthographicCamera(
      -view.halfWidth,
      view.halfWidth,
      view.halfHeight,
      -view.halfHeight,
      0.1,
      100,
    );
    camera.position.z = 10;
    camera.updateMatrixWorld();
    for (const { fibre } of bindings) {
      for (const progress of [0, 0.25, 0.6, 0.96, 1]) {
        for (const fold of [0, 0.4, 1]) {
          for (const reduced of [false, true]) {
            const { tip, growth } = fibreSegment(fibre, progress);
            const actual = projectFibreTip(fibre, progress, width, height, fold, reduced);
            assert.equal(actual.growth, growth);
            // The SVG viewBox applies the same y inversion and fold scale.
            const svgX = ((tip[0] + view.halfWidth) / (view.halfWidth * 2)) * width;
            const svgY =
              ((view.halfHeight - tip[1] * analysisFoldScale(fold, reduced)) /
                (view.halfHeight * 2)) *
              height;
            assert.ok(Math.abs(actual.x - svgX) < 1e-9);
            assert.ok(Math.abs(actual.y - svgY) < 1e-9);
            // Verify against Three's actual camera projection, not just the helper.
            const gpu = new Vector3(tip[0], tip[1] * analysisFoldScale(fold, reduced), 1).project(
              camera,
            );
            assert.ok(Math.abs(actual.x - ((gpu.x + 1) * width) / 2) < 1e-9);
            assert.ok(Math.abs(actual.y - ((1 - gpu.y) * height) / 2) < 1e-9);
          }
        }
      }
    }
  }
});

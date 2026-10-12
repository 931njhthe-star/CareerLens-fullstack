import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalysisFibres, fibreGrowth } from '../../tools/matching-eye/src/analysis-fibres.ts';
import {
  REPORT_CRITERIA,
  assignCriterionFibres,
  criterionAssignmentsForSlot,
} from '../../tools/matching-eye/src/analysis-criteria.ts';
import {
  analysisViewport,
  analysisFoldScale,
} from '../../tools/matching-eye/src/analysis-projection.ts';
import {
  AnalysisTimeline,
  MIN_ANALYSIS_PRESENTATION_MS,
  criterionCalloutFrame,
} from '../../tools/matching-eye/src/analysis-timing.ts';
import {
  createLiquidKnots,
  liquidFrontier,
  liquidPaths,
  projectLiquidTip,
  eyeEntranceFrame,
  LIQUID_INNER_RADIUS,
  LIQUID_OUTER_RADIUS,
} from '../../tools/matching-eye/src/analysis-liquid.ts';

const knots = createLiquidKnots(
  assignCriterionFibres(
    REPORT_CRITERIA.map(({ id }) => id),
    createAnalysisFibres(180),
    81,
  ),
);

test('filled water starts at the pupil and stays inside the outer iris at every angle', () => {
  for (const progress of [0, 0.15, 0.35, 0.6, 0.9, 0.96, 1]) {
    for (const clock of [0, 800, 1650, 5100]) {
      for (let index = 0; index < 720; index += 1) {
        const sample = liquidFrontier(knots, (index / 720) * Math.PI * 2, progress, clock);
        assert.ok(sample.radius >= LIQUID_INNER_RADIUS);
        assert.ok(sample.radius <= LIQUID_OUTER_RADIUS);
        if (progress === 0) assert.equal(sample.radius, LIQUID_INNER_RADIUS);
        if (progress === 1) assert.equal(sample.radius, LIQUID_OUTER_RADIUS);
        if (progress < 1) assert.ok(sample.growth < 1);
        assert.ok(Math.abs(Math.hypot(...sample.point) - sample.radius) < 1e-10);
      }
    }
  }
  for (const malformed of [NaN, Infinity, -1])
    assert.equal(liquidFrontier(knots, 0, malformed).radius, LIQUID_INNER_RADIUS);
});

test('all twelve local heights retain their assigned timing and join without angular seams', () => {
  assert.equal(knots.length, 12);
  const heights = knots.map((knot) => {
    const sample = liquidFrontier(knots, knot.angle, 0.5, 0, true);
    assert.ok(Math.abs(sample.growth - fibreGrowth(knot.assignment.fibre, 0.5)) < 1e-12);
    for (const delta of [-1e-7, 1e-7]) {
      assert.ok(
        Math.abs(sample.radius - liquidFrontier(knots, knot.angle + delta, 0.5, 0, true).radius) <
          1e-8,
      );
    }
    return sample.radius;
  });
  assert.ok(Math.max(...heights) - Math.min(...heights) > 15);
  for (const clock of [0, 200, 1900]) {
    const start = liquidFrontier(knots, 0, 0.5, clock);
    const end = liquidFrontier(knots, Math.PI * 2, 0.5, clock);
    assert.deepEqual(start, end);
    assert.ok(Math.abs(start.radius - liquidFrontier(knots, -1e-7, 0.5, clock).radius) < 1e-4);
  }
});

test('water forms one closed filled annulus with an empty pupil, and reduced motion stops ripples', () => {
  const area = liquidPaths(knots, 0.5, 700, false);
  assert.ok(area.frontier.startsWith('M'));
  assert.ok(area.frontier.endsWith('Z'));
  assert.equal((area.area.match(/M/g) || []).length, 2);
  assert.equal((area.area.match(/A62 62/g) || []).length, 2);
  assert.notEqual(area.frontier, liquidPaths(knots, 0.5, 2100, false).frontier);
  assert.deepEqual(liquidPaths(knots, 0.5, 0, true), liquidPaths(knots, 0.5, 99999, true));
  assert.deepEqual(liquidPaths(knots, 1, 0, false), liquidPaths(knots, 1, 99999, false));
});

test('callout gauges and anchors follow the same live local water boundary on all viewports', () => {
  for (const [width, height] of [
    [390, 250],
    [768, 440],
    [1024, 510],
    [1800, 510],
  ]) {
    const view = analysisViewport(width, height);
    for (const knot of knots) {
      for (const progress of [0.15, 0.5, 0.96, 1]) {
        for (const reduced of [false, true]) {
          const sample = liquidFrontier(knots, knot.angle, progress, 1900, reduced);
          const anchor = projectLiquidTip(
            knots,
            knot.angle,
            progress,
            1900,
            width,
            height,
            0.4,
            reduced,
          );
          assert.equal(anchor.growth, sample.growth);
          assert.ok(
            Math.abs(
              anchor.x - ((sample.point[0] + view.halfWidth) / (2 * view.halfWidth)) * width,
            ) < 1e-10,
          );
          assert.ok(
            Math.abs(
              anchor.y -
                ((view.halfHeight - sample.point[1] * analysisFoldScale(0.4, reduced)) /
                  (2 * view.halfHeight)) *
                  height,
            ) < 1e-10,
          );
        }
      }
    }
  }
});

test('unresolved APIs never fill the iris, and fast completion retains the four-second minimum', () => {
  const timing = new AnalysisTimeline(0);
  for (const clock of [1000, 3999, 10000, 900000]) {
    assert.ok(
      knots.every(
        ({ angle }) => liquidFrontier(knots, angle, timing.progress(clock), clock).growth < 1,
      ),
    );
    assert.equal(timing.finished(clock), false);
  }
  const fast = new AnalysisTimeline(0);
  fast.setStatus(true, false, 10);
  assert.equal(fast.readyAt, MIN_ANALYSIS_PRESENTATION_MS);
  assert.ok(liquidFrontier(knots, 0, fast.progress(3999), 3999).growth < 1);
  assert.equal(liquidFrontier(knots, 0, fast.progress(4000), 4000).growth, 1);
});

test('the accelerating entrance becomes the pupil before any eye drawing begins', () => {
  const options = { rotation: 1.7, durationMs: 720 };
  assert.equal(eyeEntranceFrame(0, options).rotation, 1.7);
  assert.equal(eyeEntranceFrame(0, options).radius, 126);
  const earlySpeed =
    eyeEntranceFrame(200, options).rotation - eyeEntranceFrame(100, options).rotation;
  const lateSpeed =
    eyeEntranceFrame(600, options).rotation - eyeEntranceFrame(500, options).rotation;
  assert.ok(lateSpeed > earlySpeed * 2);
  assert.equal(eyeEntranceFrame(719, options).eyeElapsed, 0);
  assert.equal(eyeEntranceFrame(719, options).synchronized, false);
  assert.equal(eyeEntranceFrame(720, options).radius, 61);
  assert.equal(eyeEntranceFrame(720, options).synchronized, true);
  assert.equal(eyeEntranceFrame(720, options).fillReveal, 0);
  assert.equal(eyeEntranceFrame(1080, options).fillReveal, 1);
  assert.equal(eyeEntranceFrame(820, options).eyeElapsed, 100);
  assert.equal(eyeEntranceFrame(920, options).opacity, 0);
  assert.equal(eyeEntranceFrame(100, options, true).duration, 0);
  assert.equal(eyeEntranceFrame(100, options, true).opacity, 0);
  assert.equal(eyeEntranceFrame(100).eyeElapsed, 100);
  assert.equal(eyeEntranceFrame(100, { durationMs: Infinity, rotation: NaN }).duration, 720);
});

test('handoff delay holds the initial ring until measured bridge arrival, then starts synchronization', () => {
  const options = { rotation: 2.8, durationMs: 720, delayMs: 650 };
  for (const clock of [0, 300, 649, 650]) {
    const frame = eyeEntranceFrame(clock, options);
    assert.equal(frame.radius, 126);
    assert.equal(frame.rotation, 2.8);
    assert.equal(frame.eyeElapsed, 0);
    assert.equal(frame.fillReveal, 0);
    assert.equal(frame.synchronized, false);
  }
  assert.ok(eyeEntranceFrame(800, options).rotation > 2.8);
  assert.equal(eyeEntranceFrame(1369, options).eyeElapsed, 0);
  assert.equal(eyeEntranceFrame(1370, options).radius, 61);
  assert.equal(eyeEntranceFrame(1370, options).synchronized, true);
  assert.equal(eyeEntranceFrame(1470, options).eyeElapsed, 100);
  assert.equal(eyeEntranceFrame(4000, options).fillReveal, 1);
  assert.equal(eyeEntranceFrame(0, { delayMs: 99999 }).delay, 1500);
  assert.equal(eyeEntranceFrame(0, { delayMs: -1 }).delay, 0);
  assert.equal(eyeEntranceFrame(0, { delayMs: NaN }).delay, 0);
  const reduced = eyeEntranceFrame(300, options, true);
  assert.equal(reduced.delay, 0);
  assert.equal(reduced.duration, 0);
  assert.equal(reduced.eyeElapsed, 300);
  assert.equal(reduced.fillReveal, 1);
  assert.equal(reduced.opacity, 0);
  assert.equal(reduced.synchronized, true);
});

test('the delayed eye still presents all twelve desktop callouts before the four-second minimum', () => {
  const assignments = knots.map(({ assignment }) => assignment);
  const shown = new Set();
  for (let clock = 0; clock < 4000; clock += 10) {
    const frame = eyeEntranceFrame(clock, { durationMs: 720, delayMs: 650 });
    if (frame.eyeElapsed < 180) continue;
    for (let slot = 0; slot < 4; slot += 1) {
      const cycle = criterionCalloutFrame(frame.calloutElapsed, slot);
      if (cycle.opacity !== 1) continue;
      const choices = criterionAssignmentsForSlot(assignments, slot, false);
      shown.add(choices[cycle.sequence % choices.length].id);
    }
  }
  assert.deepEqual([...shown].sort(), REPORT_CRITERIA.map(({ id }) => id).sort());
});

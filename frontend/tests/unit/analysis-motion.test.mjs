import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnalysisTimeline,
  ANALYSIS_FOLD_MS,
  calloutFrame,
  criterionCalloutFrame,
} from '../../tools/matching-eye/src/analysis-timing.ts';
import {
  REPORT_CRITERIA,
  assignCriterionFibres,
  criterionAssignmentsForSlot,
} from '../../tools/matching-eye/src/analysis-criteria.ts';
import { createAnalysisFibres } from '../../tools/matching-eye/src/analysis-fibres.ts';
import { analysisReadouts } from '../../tools/matching-eye/src/analysis-readouts.ts';
import { normalizeAnalysis } from '../../tools/matching-eye/src/analysis-state.ts';

test('a fast API fills continuously for four seconds, then folds before finishing', () => {
  const timing = new AnalysisTimeline(100);
  const before = timing.progress(300);
  timing.setStatus(true, false, 300);
  assert.equal(timing.progress(300), before);
  assert.equal(timing.readyAt, 4100);
  assert.ok(timing.progress(3100) < 1);
  assert.ok(timing.progress(4099) < 1);
  assert.equal(timing.progress(4100), 1);
  assert.equal(timing.fold(4100), 0);
  assert.ok(timing.fold(4300) > 0 && timing.fold(4300) < 1);
  assert.equal(timing.finished(4100 + ANALYSIS_FOLD_MS - 1), false);
  assert.equal(timing.finished(4100 + ANALYSIS_FOLD_MS), true);
});

test('a slow API never adds a second four-second wait or completes before success', () => {
  const timing = new AnalysisTimeline(0);
  for (const clock of [100, 3000, 3999, 4000, 4001, 10000, 600000]) {
    assert.ok(timing.progress(clock) < 1);
    assert.equal(timing.finished(clock), false);
  }
  const before = timing.progress(6000);
  timing.setStatus(true, false, 6000);
  assert.equal(timing.progress(6000), before);
  assert.equal(timing.readyAt, 6240);
  assert.equal(timing.progress(6240), 1);
  assert.equal(timing.finished(6240 + ANALYSIS_FOLD_MS), true);
});

test('API completion at the four-second boundary waits only the short smoothing interval', () => {
  for (const [completion, readyAt] of [
    [3740, 4000],
    [3760, 4000],
    [4000, 4240],
    [4001, 4241],
  ]) {
    const timing = new AnalysisTimeline(0);
    timing.setStatus(true, false, completion);
    assert.equal(timing.readyAt, readyAt);
    assert.ok(timing.progress(readyAt - 1) < 1);
    assert.equal(timing.progress(readyAt), 1);
    assert.equal(timing.fold(readyAt), 0);
    assert.equal(timing.finished(readyAt + ANALYSIS_FOLD_MS), true);
  }
});

test('running growth stays readable across four seconds without implying API completion', () => {
  const timing = new AnalysisTimeline(0);
  const early = timing.progress(1000);
  const middle = timing.progress(2000);
  const later = timing.progress(3000);
  assert.ok(early > 0.35 && early < 0.55);
  assert.ok(middle > early && later > middle);
  assert.ok(later < 0.9);
  assert.ok(timing.progress(4000) < 0.96);
  assert.equal(timing.readyAt, null);
  assert.equal(timing.finished(4000), false);
});

test('presentation is monotone and continuous across different API completion times', () => {
  for (const completion of [0, 20, 400, 1600, 2750, 3000, 3750, 4000, 4010, 20000]) {
    const timing = new AnalysisTimeline(0);
    let previous = 0;
    for (let clock = 0; clock <= completion + 5000; clock += 10) {
      if (clock === completion) timing.setStatus(true, false, clock);
      const progress = timing.progress(clock);
      assert.ok(progress >= previous - 1e-10, `completion=${completion}, time=${clock}`);
      assert.ok(progress >= 0 && progress <= 1);
      if (clock < 4000 || clock < completion) assert.ok(progress < 1);
      previous = progress;
    }
  }
});

test('errors stop progress and retries resume from the same visible fill', () => {
  const timing = new AnalysisTimeline(0);
  timing.setStatus(false, true, 700);
  const paused = timing.progress(700);
  assert.equal(timing.progress(9000), paused);
  assert.equal(timing.readyAt, null);
  timing.setStatus(false, false, 9000);
  assert.equal(timing.progress(9000), paused);
  assert.ok(timing.progress(9100) > paused);
  timing.setStatus(true, false, 9400);
  assert.equal(timing.readyAt, 9640);
});

test('revoking completion cannot leave the presentation complete', () => {
  const timing = new AnalysisTimeline(0);
  timing.setStatus(true, false, 300);
  timing.setStatus(false, true, 2900);
  assert.equal(timing.readyAt, null);
  assert.equal(timing.finished(20000), false);
  assert.ok(timing.progress(20000) < 1);
});

test('callout topics move to another corner only after fading fully out', () => {
  const first = calloutFrame(800, 0);
  const outgoing = calloutFrame(1660, 0);
  const next = calloutFrame(1710, 0);
  assert.equal(first.corner, 'top-left');
  assert.equal(first.opacity, 1);
  assert.equal(outgoing.opacity, 0);
  assert.equal(next.corner, 'bottom-left');
  assert.equal(next.opacity, 0);
  assert.equal(next.sequence, first.sequence + 1);
  assert.equal(calloutFrame(800, 1).corner, 'bottom-right');
});

test('readout findings require a verified stage and sanitize malformed input', () => {
  const snapshot = normalizeAnalysis({ stages: [{ id: 'resume', status: 'complete' }] });
  const readouts = analysisReadouts(
    {
      insights: [
        null,
        { id: 'ok', stageId: 'resume', label: '문장 확인', detail: '문장 3개 확인' },
        { stageId: 'role', label: '검증 전', detail: '표시하면 안 되는 근거' },
        { stageId: 'resume', label: ' ', detail: '없음' },
      ],
    },
    snapshot,
  );
  assert.deepEqual(readouts, [
    { id: 'ok', stageId: 'resume', label: '문장 확인', detail: '문장 3개 확인' },
  ]);
  assert.ok(
    analysisReadouts(null, normalizeAnalysis(null)).every((item) => !/\d/.test(item.detail)),
  );
});

test('report loading shows exactly 12 presentation topics without revealing returned findings', () => {
  const input = {
    insights: [
      { id: 'answers', stageId: 'resume', label: '보완 답변', detail: '답변 1개를 확인했습니다.' },
      {
        id: 'unknown',
        stageId: 'external',
        label: '검증되지 않은 정보',
        detail: '표시하지 않을 근거',
      },
    ],
  };
  const complete = normalizeAnalysis({
    stages: ['resume', 'role', 'report'].map((id) => ({ id, status: 'complete' })),
  });
  const readouts = analysisReadouts(input, complete, 'report');
  assert.equal(readouts.length, 12);
  assert.equal(new Set(readouts.map((item) => item.id)).size, 12);
  assert.deepEqual(readouts, REPORT_CRITERIA);
  assert.ok(readouts.every((item) => !('stageId' in item) && !('score' in item)));

  const running = normalizeAnalysis({
    stages: [
      { id: 'resume', status: 'complete' },
      { id: 'role', status: 'running' },
    ],
  });
  const pendingFinding = {
    id: 'not-ready',
    stageId: 'role',
    label: '직무 완료',
    detail: '서버가 아직 확인하지 않은 결과',
  };
  const whileRunning = analysisReadouts(
    { insights: [...input.insights, pendingFinding] },
    running,
    'report',
  );
  assert.ok(!whileRunning.some((item) => item.id === 'not-ready' || item.id === 'unknown'));
  assert.deepEqual(whileRunning, readouts);
});

test('the desktop cycle shows every mapped criterion within the four-second minimum', () => {
  const assignments = assignCriterionFibres(
    REPORT_CRITERIA.map(({ id }) => id),
    createAnalysisFibres(180),
    731,
  );
  const shown = new Set();
  for (let elapsed = 0; elapsed < 4000; elapsed += 25) {
    for (let slot = 0; slot < 4; slot += 1) {
      const { sequence, opacity } = criterionCalloutFrame(elapsed, slot);
      const choices = criterionAssignmentsForSlot(assignments, slot, false);
      if (opacity === 1) shown.add(choices[sequence % choices.length].id);
    }
  }
  assert.deepEqual([...shown].sort(), REPORT_CRITERIA.map(({ id }) => id).sort());
  // Topic switches have a fully transparent boundary, including slot staggering.
  for (let slot = 0; slot < 4; slot += 1) {
    const boundary = 100 + slot * 35 + 1200;
    assert.equal(criterionCalloutFrame(boundary - 1, slot).opacity, 0);
    assert.equal(criterionCalloutFrame(boundary, slot).opacity, 0);
    assert.equal(criterionCalloutFrame(boundary, slot).sequence, 1);
  }
});

test('mobile slots retain all twelve bindings in two readable column cycles', () => {
  const assignments = assignCriterionFibres(
    REPORT_CRITERIA.map(({ id }) => id),
    createAnalysisFibres(120),
    55,
  );
  const left = criterionAssignmentsForSlot(assignments, 0, true);
  const right = criterionAssignmentsForSlot(assignments, 1, true);
  assert.equal(left.length, 6);
  assert.equal(right.length, 6);
  assert.ok(left.every(({ corner }) => corner.endsWith('left')));
  assert.ok(right.every(({ corner }) => corner.endsWith('right')));
  assert.equal(new Set([...left, ...right].map(({ id }) => id)).size, 12);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAnalysis } from '../../tools/matching-eye/src/analysis-state.ts';

const stages = (statuses) =>
  ['resume', 'role', 'report'].map((id, index) => ({ id, status: statuses[index] }));

test('completion cannot be forged by a top-level flag, percentage or elapsed timer', () => {
  const result = normalizeAnalysis({
    complete: true,
    progress: 100,
    elapsed: 999999,
    stages: stages(['running', 'running', 'pending']),
  });
  assert.equal(result.complete, false);
  assert.equal(result.progress, 0);
  assert.equal(result.completedCount, 0);
});

test('only successful stages contribute to gold fill and all three are required', () => {
  assert.equal(
    normalizeAnalysis({ stages: stages(['complete', 'running', 'pending']) }).progress,
    33,
  );
  const two = normalizeAnalysis({ stages: stages(['complete', 'complete', 'running']) });
  assert.equal(two.progress, 67);
  assert.equal(two.complete, false);
  const all = normalizeAnalysis({ stages: stages(['complete', 'complete', 'complete']) });
  assert.equal(all.progress, 100);
  assert.equal(all.complete, true);
});

test('failures never masquerade as completed stages; a retry may later succeed', () => {
  const failed = normalizeAnalysis({ stages: stages(['complete', 'complete', 'error']) });
  assert.equal(failed.hasError, true);
  assert.equal(failed.complete, false);
  assert.equal(failed.completedCount, 2);
  const retry = normalizeAnalysis({ stages: stages(['complete', 'complete', 'running']) });
  assert.equal(retry.hasError, false);
  assert.equal(retry.complete, false);
});

test('missing, repeated and unknown stage IDs cannot produce a completed pupil', () => {
  const result = normalizeAnalysis({
    stages: [
      { id: 'resume', status: 'complete' },
      { id: 'resume', status: 'complete' },
      { id: 'role', status: 'complete' },
      { id: 'unexpected', status: 'complete' },
    ],
  });
  assert.deepEqual(
    result.stages.map(({ id, status }) => [id, status]),
    [
      ['resume', 'pending'],
      ['role', 'complete'],
      ['report', 'pending'],
    ],
  );
  assert.equal(result.complete, false);
});

test('malformed input resets previous progress and retains all readable stage labels', () => {
  for (const input of [
    null,
    undefined,
    'complete',
    { stages: null },
    { stages: [null, 1, 'complete'] },
  ]) {
    const result = normalizeAnalysis(input);
    assert.equal(result.progress, 0);
    assert.equal(result.stages.length, 3);
    assert.ok(result.stages.every(({ label, status }) => label.length > 0 && status === 'pending'));
  }
});

test('API order does not move progress sectors and excessive text is bounded', () => {
  const result = normalizeAnalysis({
    stages: [
      { id: 'report', status: 'running', label: 'x'.repeat(100), detail: 'y'.repeat(1000) },
      { id: 'role', status: 'complete' },
      { id: 'resume', status: 'complete' },
    ],
  });
  assert.deepEqual(
    result.stages.map(({ id }) => id),
    ['resume', 'role', 'report'],
  );
  assert.equal(result.stages[2].label.length, 80);
  assert.equal(result.stages[2].detail.length, 320);
});

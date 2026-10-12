import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONNECTION_START,
  CONNECTION_DURATION,
  connectionProgress,
  normalizeMatching,
} from '../../tools/matching-eye/src/data.ts';

test('only supplied unique job IDs create points; malformed entries do not invent jobs', () => {
  const result = normalizeMatching({
    items: [
      { id: 'job-a', score: 59 },
      { id: 'job-a', score: 98 },
      { id: 'job-b', score: 60 },
      { id: '', score: 99 },
      { score: 99 },
      null,
    ],
  });
  assert.deepEqual(
    result.jobs.map((job) => job.id),
    ['job-a', 'job-b'],
  );
  assert.equal(result.matchedCount, 1);
});

test('59 never connects;60 connects; missing evidence never becomes a zero-valued match', () => {
  const result = normalizeMatching({
    items: [
      { id: 'below', score: 59, matched: true },
      { id: 'boundary', score: 60, matched: true },
      { id: 'none', score: null, matched: false },
      { id: 'excluded', score: 90, matched: false },
    ],
  });
  assert.deepEqual(
    result.jobs.filter((job) => job.matched).map((job) => job.id),
    ['boundary'],
  );
  assert.equal(result.jobs.find((job) => job.id === 'none').score, null);
});

test('all eligible rays use the same start clock and reveal together', () => {
  const result = normalizeMatching({
    items: [
      { id: 'one', score: 60 },
      { id: 'two', score: 81 },
      { id: 'three', score: 100 },
    ],
  });
  assert.equal(new Set(result.jobs.map((job) => job.connectionStart)).size, 1);
  assert.equal(result.jobs[0].connectionStart, CONNECTION_START);
  assert.equal(connectionProgress(CONNECTION_START - 0.01), 0);
  assert.equal(connectionProgress(CONNECTION_START), 0);
  assert.equal(connectionProgress(CONNECTION_START + CONNECTION_DURATION), 1);
});

test('layout remains stable across report order, matching scores and résumé changes', () => {
  const first = normalizeMatching({
    items: [
      { id: 'seoul', score: 80, latitude: 37.5665, longitude: 126.978 },
      { id: 'schematic', score: 61 },
    ],
  });
  const second = normalizeMatching({
    items: [
      { id: 'schematic', score: 40 },
      { id: 'seoul', score: 59, latitude: 37.5665, longitude: 126.978 },
    ],
  });
  assert.deepEqual(
    first.jobs.map(({ id, x, y }) => ({ id, x, y })),
    second.jobs.map(({ id, x, y }) => ({ id, x, y })),
  );
  assert.equal(first.matchedCount, 2);
  assert.equal(second.matchedCount, 0);
  assert.ok(second.jobs.every((job) => job.connectionStart === null));
});

test('empty and unavailable reports expose no stale jobs', () => {
  const populated = normalizeMatching({ items: [{ id: 'previous', score: 88 }] });
  const empty = normalizeMatching({ status: 'resume_required', items: [] });
  assert.equal(populated.jobs.length, 1);
  assert.deepEqual(empty.jobs, []);
  assert.equal(empty.matchedCount, 0);
  assert.equal(empty.status, 'resume_required');
});

test('sequential posting IDs occupy all quadrants without accidental hash clusters', () => {
  const result = normalizeMatching({
    items: Array.from({ length: 60 }, (_, index) => ({
      id: `job-${String(index).padStart(2, '0')}`,
      score: 70,
    })),
  });
  const quadrants = [0, 0, 0, 0];
  for (const job of result.jobs) {
    quadrants[(job.x >= 0 ? 1 : 0) + (job.y >= 0 ? 2 : 0)] += 1;
  }
  assert.ok(
    quadrants.every((count) => count >= 5 && count <= 30),
    String(quadrants),
  );
});

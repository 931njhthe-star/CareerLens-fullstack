import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStudyFibres,
  studyFibreGrowth,
  studyFibreTip,
  STUDY_FIBRE_COUNT,
} from '../../src/features/analysis/study-fibre-growth.js';

const fibres = createStudyFibres();

test('curved fibres start at the empty pupil boundary and extend only outward', () => {
  assert.equal(fibres.length, STUDY_FIBRE_COUNT);
  for (const fibre of fibres) {
    assert.ok(Math.abs(Math.hypot(fibre.points[0].x, fibre.points[0].y) - 60) < 1e-9);
    let previous = 60;
    for (let step = 0; step <= 40; step++) {
      const tip = studyFibreTip(fibre, step / 40);
      const radius = Math.hypot(tip.x, tip.y);
      assert.ok(radius + 1e-8 >= previous);
      assert.ok(radius <= 194 + 1e-8);
      previous = radius;
    }
    assert.ok(Math.abs(previous - 194) < 1e-8);
  }
});

test('a few fibres start first, then scattered fibres grow independently and complete', () => {
  assert.ok(fibres.every((fibre) => studyFibreGrowth(fibre, 13) === 0));
  const pioneers = fibres.filter((fibre) => studyFibreGrowth(fibre, 13.6) > 0);
  assert.equal(pioneers.length, 8);
  const spreading = fibres.map((fibre) => studyFibreGrowth(fibre, 14.6));
  assert.ok(spreading.filter((amount) => amount > 0).length > 500);
  assert.ok(spreading.some((amount) => amount === 0));
  assert.ok(new Set(spreading.map((amount) => amount.toFixed(3))).size > 50);
  for (const fibre of fibres) {
    assert.ok(studyFibreGrowth(fibre, 15) >= studyFibreGrowth(fibre, 14.6));
    assert.equal(studyFibreGrowth(fibre, 17.6), 1);
  }
});

test('scrubbing and changing topics preserves deterministic fibre growth per seed', () => {
  assert.deepEqual(createStudyFibres(7), createStudyFibres(7));
  assert.notDeepEqual(createStudyFibres(8)[4], createStudyFibres(7)[4]);
});

test('initial and highlighted fibres have irregular spacing, without mirrored return arcs', () => {
  for (const seed of [7, 8, 7926]) {
    const strands = createStudyFibres(seed);
    const initial = strands.filter((fibre) => fibre.pioneer).map((fibre) => fibre.index);
    assert.equal(initial.length, 8);
    const gaps = initial.map(
      (index, i) =>
        (initial[(i + 1) % initial.length] - index + STUDY_FIBRE_COUNT) % STUDY_FIBRE_COUNT,
    );
    assert.ok(new Set(gaps).size >= 6);
    const accents = strands.filter((fibre) => fibre.accent).map((fibre) => fibre.index);
    assert.ok(accents.length > 10 && accents.length < 60);
    assert.ok(accents.some((index) => index % 32 !== 0));
    const deflections = strands.map((fibre) => {
      const start = fibre.points[0];
      const end = fibre.points.at(-1);
      return Math.atan2(start.x * end.y - start.y * end.x, start.x * end.x + start.y * end.y);
    });
    assert.ok(deflections.filter((angle) => angle > 0.01).length > 200);
    assert.ok(deflections.filter((angle) => angle < -0.01).length > 200);
    assert.ok(new Set(deflections.map((angle) => angle.toFixed(4))).size > 400);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STUDY_STAGES,
  STUDY_DURATION,
  STUDY_ARTWORK,
  studyArtworkTransform,
  studyGeometry,
  studyNode,
  studyRotation,
  studyRingOpacity,
  studyEyeReveal,
  studyLoadingState,
  studyStageAt,
  studyTopics,
} from '../../src/features/analysis/fixed-anchor-study.js';

test('source artwork pupil matches the existing fixed ring without a time-dependent transform', () => {
  const transform = studyArtworkTransform(1942, 809);
  assert.equal(transform.x + STUDY_ARTWORK.pupilX * transform.scale, 600);
  assert.equal(transform.y + STUDY_ARTWORK.pupilY * transform.scale, 245);
  assert.equal(STUDY_ARTWORK.pupilRadius * transform.scale, 60);
  assert.ok(transform.x >= 0 && transform.x + transform.width <= 1200);
  assert.ok(transform.y >= 0 && transform.y + transform.height < 531);
});

test('completed circle and analytical pupil retain one center and radius across all later stages', () => {
  for (const time of [9.5, 10.4, 12.5, 14.5, 17, 18, 32]) {
    const geometry = studyGeometry();
    assert.equal(geometry.centerX, 600);
    assert.equal(geometry.centerY, 245);
    assert.equal(geometry.radius, 60);
    for (let i = 0; i < 5; i++) {
      const node = studyNode(i, time);
      assert.ok(
        Math.abs(
          Math.hypot(node.x - geometry.centerX, node.y - geometry.centerY) - geometry.radius,
        ) < 1e-10,
      );
    }
  }
});

test('element motion remains continuous while forming and rotating', () => {
  for (let time = 6; time < 10; time += 0.01) {
    for (let i = 0; i < 5; i++) {
      const first = studyNode(i, time);
      const second = studyNode(i, time + 0.001);
      assert.ok(
        Math.hypot(second.x - first.x, second.y - first.y) < 1,
        `continuous element ${i} at ${time}`,
      );
    }
  }
});

test('rotation accelerates smoothly without stopping or changing phase', () => {
  const speed = (time) => (studyRotation(time + 0.00001) - studyRotation(time - 0.00001)) / 0.00002;
  assert.ok(speed(12.85) > speed(10) * 30);
  assert.ok(Math.abs(speed(12.85) / (2 * Math.PI) - 3.5) < 0.001);
  for (const time of [12, 12.85])
    assert.ok(Math.abs(speed(time - 0.0001) - speed(time + 0.0001)) < 0.001);
  assert.ok(studyRotation(19) > studyRotation(18));
});

test('the standalone ring body dissolves into the iris', () => {
  assert.equal(studyRingOpacity(10.4), 1);
  assert.equal(studyRingOpacity(12.85), 1);
  let previous = 1;
  for (let time = 13.35; time <= 15.15; time += 0.01) {
    const opacity = studyRingOpacity(time);
    assert.ok(opacity <= previous && opacity >= 0);
    previous = opacity;
  }
  for (const time of [15.15, 17, 18, 32]) assert.equal(studyRingOpacity(time), 0);
});

test('opposing eye contours draw during acceleration, before iris growth', () => {
  assert.ok(studyEyeReveal(12).every((leg) => leg.trace === 0));
  const drawing = studyEyeReveal(12.5);
  assert.equal(drawing.length, 2);
  assert.ok(drawing.every((leg) => leg.trace > 0 && leg.trace < 1));
  assert.ok(drawing[0].trace > drawing[1].trace);
  assert.ok(studyEyeReveal(13.05).every((leg) => leg.trace === 1));
});

test('illustrative percentage advances monotonically and pupil reflections persist while waiting', () => {
  assert.equal(studyLoadingState(11).percent, null);
  assert.equal(studyLoadingState(12).percent, 0);
  let previous = 0;
  for (let time = 12; time < STUDY_DURATION; time += 0.03) {
    const loading = studyLoadingState(time);
    assert.ok(loading.percent >= previous && loading.percent < 100);
    assert.equal(loading.active, true);
    previous = loading.percent;
  }
  assert.equal(studyLoadingState(18).percent, 92);
  assert.equal(studyLoadingState(20).reflection, 1);
  assert.ok(studyLoadingState(20.1).rotation > studyLoadingState(20).rotation);
  for (const time of [22, 30]) {
    const complete = studyLoadingState(time);
    assert.equal(complete.percent, 100);
    assert.equal(complete.active, false);
    assert.equal(complete.reflection, 0);
  }
});

test('five illustrative report topics are unique and repeatable per seed', () => {
  const first = studyTopics(7);
  assert.equal(first.length, 5);
  assert.equal(new Set(first.map((topic) => topic.index)).size, 5);
  assert.deepEqual(first, studyTopics(7));
  assert.notDeepEqual(first, studyTopics(7926));
  assert.ok(first.every((topic) => typeof topic.label === 'string' && topic.label.length > 0));
});

test('eight storyboard poses cover the timeline and final analysis keeps its stage', () => {
  assert.equal(STUDY_STAGES.length, 8);
  assert.equal(STUDY_DURATION, 22);
  assert.equal(studyStageAt(0).id, 'light');
  assert.equal(studyStageAt(100).id, 'analysis');
  for (const stage of STUDY_STAGES) assert.equal(studyStageAt(stage.time).id, stage.id);
});

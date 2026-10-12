import test from 'node:test';
import assert from 'node:assert/strict';
import { liveJourneyGeometry } from '../../src/features/analysis/journey-layout.js';
import { liveMotionViewport } from '../../src/features/analysis/live-eye-motion.js';
import { studyNode } from '../../src/features/analysis/fixed-anchor-study.js';

test('live branch destinations fit below navigation and converge on the unchanged pupil', () => {
  for (const [width, height, startY, navigationBottom] of [
    [1440, 1000, 342, 187],
    [1366, 768, 342, 187],
    [390, 844, 447, 260],
    [320, 568, 447, 260],
  ]) {
    const viewport = liveMotionViewport(width, height);
    const origin = {
      x: (34 - viewport.offsetX) / viewport.scale,
      y: (startY - viewport.offsetY) / viewport.scale,
    };
    const geometry = liveJourneyGeometry(viewport, origin);
    assert.equal(geometry.destinations.length, 5);
    for (let index = 0; index < 5; index++) {
      const branched = studyNode(index, 5.5, geometry.destinations);
      const x = viewport.offsetX + branched.x * viewport.scale;
      const y = viewport.offsetY + branched.y * viewport.scale;
      assert.ok(x > 0 && x < width - 45);
      assert.ok(y - 20 * geometry.labelScale * viewport.scale > navigationBottom);
      assert.ok(y < height - 40);
      assert.ok(
        Math.abs(
          studyNode(index, 10.4, geometry.destinations).radius * viewport.scale - viewport.radius,
        ) < 1e-8,
      );
    }
  }
});

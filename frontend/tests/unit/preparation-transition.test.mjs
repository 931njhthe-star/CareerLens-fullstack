import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINIMUM_PRESENTATION_MS,
  remainingPresentationTime,
  waitForPresentationDelay,
  finishPreparationPresentation,
} from '../../src/features/analysis/preparation-transition.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('presentation minimum is four seconds from the original start, not API completion', () => {
  assert.equal(MINIMUM_PRESENTATION_MS, 4000);
  assert.equal(remainingPresentationTime(500, 500), 4000);
  assert.equal(remainingPresentationTime(500, 1250), 3250);
  assert.equal(remainingPresentationTime(500, 3500), 1000);
  assert.equal(remainingPresentationTime(500, 4499), 1);
  assert.equal(remainingPresentationTime(500, 4500), 0);
  assert.equal(remainingPresentationTime(500, 4501), 0);
  assert.equal(remainingPresentationTime(500, 8200), 0);
  assert.equal(remainingPresentationTime(500, 400), 4000);
});

test('a fast successful analysis without graphics waits only the remaining presentation minimum', async () => {
  const gate = deferred();
  const controller = new AbortController();
  let completed = 0;
  const completion = finishPreparationPresentation({
    startedAt: 100,
    now: () => 900,
    signal: controller.signal,
    wait: (duration, signal) => {
      assert.equal(duration, 3200);
      assert.equal(signal, controller.signal);
      return gate.promise;
    },
    onComplete: () => completed++,
  });
  await nextTurn();
  assert.equal(completed, 0);
  gate.resolve();
  await completion;
  assert.equal(completed, 1);
});

test('a slow analysis adds no new four-second hold but still waits for the eye fold', async () => {
  const fold = deferred();
  let completed = 0,
    finishCalls = 0;
  const completion = finishPreparationPresentation({
    eye: {
      finish: () => {
        finishCalls++;
        return fold.promise;
      },
    },
    startedAt: 200,
    now: () => 6700,
    signal: new AbortController().signal,
    wait: (duration) => {
      assert.equal(duration, 0);
      return Promise.resolve();
    },
    onComplete: () => completed++,
  });
  await nextTurn();
  assert.equal(finishCalls, 1);
  assert.equal(completed, 0);
  fold.resolve();
  await completion;
  assert.equal(completed, 1);
});

test('minimum hold and eye finishing run together; neither gate alone permits navigation', async (t) => {
  for (const first of ['minimum', 'visual']) {
    await t.test(`${first} finishes first`, async () => {
      const gates = { minimum: deferred(), visual: deferred() };
      let completed = 0;
      const completion = finishPreparationPresentation({
        eye: { finish: () => gates.visual.promise },
        startedAt: 0,
        now: () => 500,
        signal: new AbortController().signal,
        wait: () => gates.minimum.promise,
        onComplete: () => completed++,
      });
      gates[first].resolve();
      await nextTurn();
      assert.equal(completed, 0);
      gates[first === 'minimum' ? 'visual' : 'minimum'].resolve();
      await completion;
      assert.equal(completed, 1);
    });
  }
});

test('leaving during an unfinished eye animation cancels navigation even if its promise never settles', async () => {
  const fold = deferred();
  const controller = new AbortController();
  let completed = 0;
  const completion = finishPreparationPresentation({
    eye: { finish: () => fold.promise },
    startedAt: 0,
    now: () => 4000,
    signal: controller.signal,
    onComplete: () => completed++,
  });
  const cancelled = assert.rejects(completion, { name: 'AbortError' });
  controller.abort();
  await cancelled;
  assert.equal(completed, 0);
  // A late graphics failure after disposal must remain handled as well.
  fold.reject(new Error('disposed renderer'));
  await nextTurn();
  assert.equal(completed, 0);
});

test('graphics failures retain successful analysis and fall back to the remaining minimum', async (t) => {
  for (const failure of ['synchronous', 'asynchronous']) {
    await t.test(failure, async () => {
      const gate = deferred();
      let completed = 0;
      const completion = finishPreparationPresentation({
        eye: {
          finish: () => {
            if (failure === 'synchronous') throw new Error('renderer unavailable');
            return Promise.reject(new Error('animation interrupted'));
          },
        },
        startedAt: 400,
        now: () => 1100,
        signal: new AbortController().signal,
        wait: (duration) => {
          assert.equal(duration, 3300);
          return gate.promise;
        },
        onComplete: () => completed++,
      });
      await nextTurn();
      assert.equal(completed, 0);
      gate.resolve();
      await completion;
      assert.equal(completed, 1);
    });
  }
});

test('an already-aborted page never starts presentation work', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    finishPreparationPresentation({
      eye: { finish: () => assert.fail('animation must not start after disposal') },
      startedAt: 0,
      signal: controller.signal,
      wait: () => assert.fail('timer must not start after disposal'),
      onComplete: () => assert.fail('cancelled page must not navigate'),
    }),
    { name: 'AbortError' },
  );
});

test('the real presentation delay completes at zero or after a short timer', async () => {
  const signal = new AbortController().signal;
  await waitForPresentationDelay(0, signal);
  await waitForPresentationDelay(5, signal);
});

test('the real presentation delay cancels its pending timer and preserves the abort reason', async () => {
  const controller = new AbortController();
  const reason = new DOMException('The user left the analysis page', 'AbortError');
  const delayed = waitForPresentationDelay(1000, controller.signal);
  const cancelled = assert.rejects(delayed, (error) => error === reason);
  controller.abort(reason);
  await cancelled;
  assert.throws(
    () => waitForPresentationDelay(0, controller.signal),
    (error) => error === reason,
  );
});

test('navigation during the real minimum hold cannot complete the presentation', async () => {
  const controller = new AbortController();
  let completed = 0;
  const completion = finishPreparationPresentation({
    eye: { finish: () => Promise.resolve() },
    startedAt: performance.now(),
    signal: controller.signal,
    onComplete: () => completed++,
  });
  const cancelled = assert.rejects(completion, { name: 'AbortError' });
  controller.abort();
  await cancelled;
  assert.equal(completed, 0);
});

test('the report particle bridge waits for a full eye without folding or restarting four seconds', async () => {
  const gauge = deferred();
  let completed = false;
  const completion = finishPreparationPresentation({
    eye: {
      finish: (options) => {
        assert.deepEqual(options, { fold: false });
        return gauge.promise;
      },
    },
    startedAt: 100,
    now: () => 7400,
    signal: new AbortController().signal,
    fold: false,
    wait: (duration) => {
      assert.equal(duration, 0);
      return Promise.resolve();
    },
    onComplete: () => {
      completed = true;
    },
  });
  await nextTurn();
  assert.equal(completed, false, 'real analysis completion alone cannot truncate the gauge');
  gauge.resolve();
  await completion;
  assert.equal(completed, true);
});

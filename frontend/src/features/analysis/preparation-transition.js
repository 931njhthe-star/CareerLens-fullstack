export const MINIMUM_PRESENTATION_MS = 4000;

export function remainingPresentationTime(startedAt, now) {
  return Math.max(0, MINIMUM_PRESENTATION_MS - Math.max(0, now - startedAt));
}

export function waitForPresentationDelay(duration, signal) {
  signal.throwIfAborted();
  if (duration <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Presentation cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, duration);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export function withPresentationSignal(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () =>
      reject(signal.reason || new DOMException('Presentation cancelled', 'AbortError'));
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', cancel));
  });
}

// API work runs concurrently with the presentation minimum. A late response
// waits only for the eye's short finishing motion, never another four seconds.
export async function finishPreparationPresentation({
  eye,
  startedAt,
  signal,
  onComplete,
  now = () => performance.now(),
  wait = waitForPresentationDelay,
  fold = true,
}) {
  signal.throwIfAborted();
  const minimum = wait(remainingPresentationTime(startedAt, now()), signal);
  const visual = (async () => {
    try {
      if (eye?.finish) await withPresentationSignal(eye.finish({ fold }), signal);
    } catch (error) {
      if (signal.aborted) throw error;
      // A graphics failure does not invalidate already successful API analysis.
    }
  })();
  await Promise.all([minimum, visual]);
  signal.throwIfAborted();
  onComplete();
}

export const INTRODUCTION_DURATION_MS = 2500;

export function bindIntroduction({ onComplete } = {}) {
  const root = document.querySelector('[data-introduction]');
  if (!root) return () => {};

  const skip = root.querySelector('[data-intro-skip]');
  let disposed = false;
  let timer;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    skip?.removeEventListener('click', complete);
  };
  const complete = () => {
    if (disposed) return;
    dispose();
    onComplete?.();
  };

  skip?.addEventListener('click', complete);
  timer = setTimeout(complete, INTRODUCTION_DURATION_MS);
  return dispose;
}

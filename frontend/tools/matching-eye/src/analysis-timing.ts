export const MIN_ANALYSIS_PRESENTATION_MS = 4000;
export const ANALYSIS_FOLD_MS = 520;
export const EYE_DRAW_MS = 720;
const SETTLE_MS = 240;
const RUNNING_RISE_MS = 1600;
const clamp = (value: number, low = 0, high = 1): number => Math.min(high, Math.max(low, value));
export const smoothstep = (value: number): number => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

/** Presentation progress is deliberately separate from server stage completion. */
export class AnalysisTimeline {
  readonly startedAt: number;
  private completedAt: number | null = null;
  private completionFrom = 0;
  private completionVelocity = 0;
  private completionEnd = 0;
  private pausedAt: number | null = null;
  private pausedProgress = 0;
  private runningBaseAt: number;
  private runningBaseProgress = 0;

  constructor(startedAt: number) {
    this.startedAt = startedAt;
    this.runningBaseAt = startedAt;
  }

  private running(now: number): number {
    return (
      this.runningBaseProgress +
      (0.96 - this.runningBaseProgress) *
        (1 - Math.exp(-Math.max(0, now - this.runningBaseAt) / RUNNING_RISE_MS))
    );
  }

  setStatus(complete: boolean, failed: boolean, now: number): void {
    if (failed) {
      if (this.pausedAt === null) this.pausedProgress = Math.min(0.96, this.progress(now));
      this.pausedAt = now;
      this.completedAt = null;
      return;
    }
    if (this.pausedAt !== null) {
      this.runningBaseAt = now;
      this.runningBaseProgress = this.pausedProgress;
      this.pausedAt = null;
    }
    if (!complete && this.completedAt !== null) {
      this.runningBaseProgress = Math.min(0.96, this.progress(now));
      this.runningBaseAt = now;
      this.completedAt = null;
    }
    if (!complete || this.completedAt !== null) return;
    this.completionFrom = this.progress(now);
    this.completionVelocity =
      ((0.96 - this.runningBaseProgress) / RUNNING_RISE_MS) *
      Math.exp(-Math.max(0, now - this.runningBaseAt) / RUNNING_RISE_MS);
    this.completedAt = now;
    this.completionEnd = Math.max(this.startedAt + MIN_ANALYSIS_PRESENTATION_MS, now + SETTLE_MS);
  }

  progress(now: number): number {
    if (this.pausedAt !== null) return this.pausedProgress;
    if (this.completedAt === null) return this.running(now);
    const duration = this.completionEnd - this.completedAt;
    const t = clamp((now - this.completedAt) / duration);
    const distance = 1 - this.completionFrom;
    // A monotone Hermite curve preserves motion at the API hand-off, then settles.
    const tangent = Math.min(this.completionVelocity * duration, distance * 2.5);
    return clamp(
      (2 * t ** 3 - 3 * t ** 2 + 1) * this.completionFrom +
        (t ** 3 - 2 * t ** 2 + t) * tangent +
        (-2 * t ** 3 + 3 * t ** 2),
    );
  }

  get readyAt(): number | null {
    return this.completedAt === null ? null : this.completionEnd;
  }
  fold(now: number): number {
    return this.readyAt === null ? 0 : smoothstep((now - this.readyAt) / ANALYSIS_FOLD_MS);
  }
  finished(now: number): boolean {
    return this.readyAt !== null && now >= this.readyAt + ANALYSIS_FOLD_MS;
  }
}

/** A pair of readouts alternates corners; fully hidden frames own topic changes. */
export function calloutFrame(
  elapsed: number,
  slot: number,
): { sequence: number; opacity: number; corner: string } {
  const shifted = Math.max(0, elapsed - 260 - slot * 520);
  const period = 1450;
  const sequence = Math.floor(shifted / period);
  const phase = shifted % period;
  const opacity =
    elapsed < 260 + slot * 520
      ? 0
      : smoothstep(phase / 210) * (1 - smoothstep((phase - 1120) / 240));
  const corners = slot === 0 ? ['top-left', 'bottom-left'] : ['bottom-right', 'top-right'];
  return { sequence, opacity, corner: corners[sequence % corners.length] };
}

/** Three readable groups of four fit inside the existing four-second presentation. */
export function criterionCalloutFrame(
  elapsed: number,
  slot: number,
): { sequence: number; opacity: number } {
  const start = 100 + slot * 35;
  const shifted = Math.max(0, elapsed - start);
  const period = 1200;
  const phase = shifted % period;
  return {
    sequence: Math.floor(shifted / period),
    opacity: elapsed < start ? 0 : smoothstep(phase / 160) * (1 - smoothstep((phase - 1020) / 150)),
  };
}

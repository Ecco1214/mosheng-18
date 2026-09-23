export type GesturePoint = { x: number; y: number };

type TimedPoint = GesturePoint & { time: number };

type UpFlickResult = {
  point: GesturePoint;
  shotPoint: GesturePoint | null;
};

const DEFAULTS = {
  smoothingAlpha: 0.36,
  aimDeadzone: 0.24,
  dwellMs: 170,
  sampleWindowMs: 360,
  stableRadius: 1.8,
  flickWindowMs: 460,
  minRise: 3.4,
  maxHorizontalDrift: 5.8,
  cooldownMs: 720,
};

/**
 * Temporal filter for the training gun gesture.
 * It smooths aim, requires a short stable dwell, then fires once when the raw
 * index fingertip rises quickly. The returned shotPoint is the pre-flick aim,
 * so lifting the finger does not drag the shot away from the target.
 */
export class UpFlickDetector {
  private smoothed: GesturePoint | null = null;
  private output: GesturePoint | null = null;
  private samples: TimedPoint[] = [];
  private anchorRaw: GesturePoint | null = null;
  private anchorAim: GesturePoint | null = null;
  private armedAt = 0;
  private cooldownUntil = 0;
  private relativeAnchor: GesturePoint | null = null;
  private candidateAt = 0;
  private raised = false;
  private lastTime = 0;

  update(raw: GesturePoint, now: number, poseActive: boolean, relative?: GesturePoint): UpFlickResult {
    if (this.lastTime && now - this.lastTime > 200) this.reset();
    const dt = this.lastTime ? Math.min(100, now - this.lastTime) : 33;
    this.lastTime = now;
    const alpha = 1 - Math.exp(-dt / 65);
    this.smoothed = this.smoothed
      ? {
          x: this.smoothed.x + (raw.x - this.smoothed.x) * alpha,
          y: this.smoothed.y + (raw.y - this.smoothed.y) * alpha,
        }
      : { ...raw };

    if (!this.output || distance(this.output, this.smoothed) >= DEFAULTS.aimDeadzone) {
      this.output = { ...this.smoothed };
    }

    if (!poseActive) {
      this.samples = [];
      this.anchorRaw = null;
      this.anchorAim = null;
      this.armedAt = 0;
      this.relativeAnchor = null;
      this.candidateAt = 0;
      return { point: this.output, shotPoint: null };
    }

    this.samples.push({ ...raw, time: now });
    this.samples = this.samples.filter((sample) => now - sample.time <= DEFAULTS.sampleWindowMs);

    if (this.anchorRaw && this.anchorAim) {
      const rise = relative && this.relativeAnchor ? this.relativeAnchor.y - relative.y : this.anchorRaw.y - raw.y;
      const threshold = relative ? 0.16 : DEFAULTS.minRise;
      const horizontalDrift = Math.abs(this.anchorRaw.x - raw.x);
      if (this.raised) {
        if (rise < threshold * .35 && now >= this.cooldownUntil) {
          this.raised = false;
          this.anchorRaw = null;
          this.anchorAim = null;
          this.samples = [];
        }
        return { point: this.output, shotPoint: null };
      }
      if (rise >= threshold * .45 && !this.candidateAt) this.candidateAt = now;
      if (rise < threshold * .25) this.candidateAt = 0;
      const elapsed = this.candidateAt ? now - this.candidateAt : 0;

      if (
        now >= this.cooldownUntil
        && this.candidateAt > 0
        && elapsed >= 25 && elapsed <= 650
        && rise >= threshold
        && horizontalDrift <= DEFAULTS.maxHorizontalDrift
      ) {
        const shotPoint = { ...this.anchorAim };
        this.cooldownUntil = now + DEFAULTS.cooldownMs;
        this.samples = [];
        this.raised = true;
        this.candidateAt = 0;
        return { point: this.output, shotPoint };
      }

      if (elapsed > 650 || horizontalDrift > DEFAULTS.maxHorizontalDrift || rise < -(relative ? .18 : 2.5) || (relative && rise < threshold * .45 && distance(raw, this.anchorRaw) > 2.8)) {
        this.anchorRaw = null;
        this.anchorAim = null;
        this.armedAt = 0;
        this.relativeAnchor = null;
        this.candidateAt = 0;
        this.samples = [{ ...raw, time: now }];
      }
    }

    if (!this.anchorRaw && now >= this.cooldownUntil && this.samples.length >= 3) {
      const first = this.samples[0];
      const duration = now - first.time;
      const center = averagePoint(this.samples);
      const radius = Math.max(...this.samples.map((sample) => distance(sample, center)));
      if (duration >= 230 && radius <= 1.2) {
        this.anchorRaw = { x: center.x, y: center.y };
        this.anchorAim = { ...this.output };
        this.armedAt = now;
        this.relativeAnchor = relative ? { ...relative } : null;
      }
    }

    return { point: this.output, shotPoint: null };
  }

  reset() {
    this.samples = [];
    this.anchorRaw = null;
    this.anchorAim = null;
    this.armedAt = 0;
    this.relativeAnchor = null;
    this.candidateAt = 0;
    this.raised = false;
    this.smoothed = null;
    this.output = null;
    this.lastTime = 0;
  }
}

export function viewportPointToContainedImage(
  point: GesturePoint,
  viewportWidth: number,
  viewportHeight: number,
  imageAspect: number,
): GesturePoint {
  if (viewportWidth <= 0 || viewportHeight <= 0 || imageAspect <= 0) return point;
  const viewportAspect = viewportWidth / viewportHeight;
  let renderedWidth = viewportWidth;
  let renderedHeight = viewportHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (viewportAspect > imageAspect) {
    renderedWidth = viewportHeight * imageAspect;
    offsetX = (viewportWidth - renderedWidth) / 2;
  } else {
    renderedHeight = viewportWidth / imageAspect;
    offsetY = (viewportHeight - renderedHeight) / 2;
  }

  return {
    x: ((point.x / 100) * viewportWidth - offsetX) / renderedWidth * 100,
    y: ((point.y / 100) * viewportHeight - offsetY) / renderedHeight * 100,
  };
}

export function containedImagePointToViewport(
  point: GesturePoint,
  viewportWidth: number,
  viewportHeight: number,
  imageAspect: number,
): GesturePoint {
  if (viewportWidth <= 0 || viewportHeight <= 0 || imageAspect <= 0) return point;
  const viewportAspect = viewportWidth / viewportHeight;
  let renderedWidth = viewportWidth;
  let renderedHeight = viewportHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (viewportAspect > imageAspect) {
    renderedWidth = viewportHeight * imageAspect;
    offsetX = (viewportWidth - renderedWidth) / 2;
  } else {
    renderedHeight = viewportWidth / imageAspect;
    offsetY = (viewportHeight - renderedHeight) / 2;
  }

  return {
    x: (offsetX + renderedWidth * point.x / 100) / viewportWidth * 100,
    y: (offsetY + renderedHeight * point.y / 100) / viewportHeight * 100,
  };
}

function averagePoint(points: GesturePoint[]): GesturePoint {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

function distance(a: GesturePoint, b: GesturePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

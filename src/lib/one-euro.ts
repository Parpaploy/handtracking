/**
 * 1€ filter — Casiez, Roussel & Vogel, CHI 2012.
 *
 * A fixed exponential smooth can only trade jitter against lag. Crank it up
 * and a still arm stops shaking but a waving one drags half a second behind;
 * back it off and the wave is crisp but the still arm buzzes. MediaPipe's
 * monocular depth estimate buzzes hard, so neither setting is acceptable.
 *
 * The 1€ filter raises its own cutoff frequency in proportion to how fast the
 * signal is moving: heavy smoothing while the limb is still, nearly
 * transparent while it moves. That is precisely the arm-shake failure mode.
 *
 * State lives in flat typed arrays with stride 3 so a 33-point pose costs one
 * allocation at startup rather than one per frame.
 */

export interface OneEuroParams {
  /** Cutoff in Hz at zero speed. Lower = steadier at rest, more lag. */
  minCutoff: number;
  /** How strongly speed raises the cutoff. Higher = less lag when moving. */
  beta: number;
  /** Cutoff for the speed estimate itself. 1 Hz is the paper's default. */
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroParams = {
  minCutoff: 1,
  beta: 0.7,
  dCutoff: 1,
};

function smoothingFactor(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export interface LandmarkFilter {
  /** Filtered value per channel, stride 3. */
  x: Float64Array;
  /** Filtered derivative per channel, stride 3. */
  dx: Float64Array;
  /** 0 until a point has seen its first sample. */
  primed: Uint8Array;
  capacity: number;
}

export function createLandmarkFilter(): LandmarkFilter {
  return {
    x: new Float64Array(0),
    dx: new Float64Array(0),
    primed: new Uint8Array(0),
    capacity: 0,
  };
}

/**
 * Forget every point. Call this whenever tracking drops, otherwise the first
 * frame after a re-acquire is smoothed against a stale position and the limb
 * visibly slides in from wherever it was last seen.
 */
export function resetLandmarkFilter(f: LandmarkFilter): void {
  f.primed.fill(0);
}

function ensureCapacity(f: LandmarkFilter, n: number): void {
  if (f.capacity >= n) return;
  const x = new Float64Array(n * 3);
  const dx = new Float64Array(n * 3);
  const primed = new Uint8Array(n);
  x.set(f.x);
  dx.set(f.dx);
  primed.set(f.primed);
  f.x = x;
  f.dx = dx;
  f.primed = primed;
  f.capacity = n;
}

/**
 * Filter one landmark array in place-ish: returns fresh point objects carrying
 * the smoothed x/y/z and every other field (visibility, presence) untouched.
 *
 * `dt` is in seconds and must be > 0; the caller should clamp it, because a
 * dropped frame or a backgrounded tab otherwise hands us a dt large enough to
 * make the cutoff meaningless.
 */
export function filterLandmarks<T extends { x: number; y: number; z: number }>(
  f: LandmarkFilter,
  points: T[],
  dt: number,
  p: OneEuroParams,
): T[] {
  ensureCapacity(f, points.length);

  const aD = smoothingFactor(p.dCutoff, dt);
  const out: T[] = new Array(points.length);

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const base = i * 3;

    if (!f.primed[i]) {
      f.x[base] = pt.x;
      f.x[base + 1] = pt.y;
      f.x[base + 2] = pt.z;
      f.dx[base] = 0;
      f.dx[base + 1] = 0;
      f.dx[base + 2] = 0;
      f.primed[i] = 1;
      out[i] = pt;
      continue;
    }

    for (let c = 0; c < 3; c++) {
      const k = base + c;
      const v = c === 0 ? pt.x : c === 1 ? pt.y : pt.z;

      const speed = (v - f.x[k]) / dt;
      f.dx[k] += aD * (speed - f.dx[k]);

      const cutoff = p.minCutoff + p.beta * Math.abs(f.dx[k]);
      f.x[k] += smoothingFactor(cutoff, dt) * (v - f.x[k]);
    }

    out[i] = { ...pt, x: f.x[base], y: f.x[base + 1], z: f.x[base + 2] };
  }

  return out;
}

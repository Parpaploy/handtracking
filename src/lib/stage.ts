import { useEffect, useState, type RefObject } from "react";

type Pt = { x: number; y: number; z?: number };

/** Tablets / phones: touch-first devices with weaker GPUs. */
export const IS_LOW_POWER =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(pointer: coarse)").matches ||
    // iPadOS reports itself as a Mac; touch points give it away.
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/** Camera constraints shared by every game: 16:9 so the full-screen stage
 *  needs little cropping. HD on computers; on tablets a smaller frame,
 *  since every pixel is uploaded to the GPU and drawn each frame. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: IS_LOW_POWER
    ? {
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 30 },
      }
    : { width: { ideal: 1280 }, height: { ideal: 720 } },
};

/** Max hands MediaPipe should look for. More than 2 so several people
 *  (or both hands of two players) can play at once. */
export const MAX_HANDS = 4;

/**
 * Resize a canvas' backing store to its on-screen CSS size. Returns true
 * when the size changed (which also clears the canvas).
 */
export function syncCanvasToDisplay(canvas: HTMLCanvasElement): boolean {
  const w = Math.max(1, Math.round(canvas.clientWidth));
  const h = Math.max(1, Math.round(canvas.clientHeight));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

/** Resize an offscreen canvas while keeping what was painted on it. */
export function resizeKeepingContent(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
) {
  if (canvas.width === w && canvas.height === h) return;
  const temp = document.createElement("canvas");
  temp.width = canvas.width;
  temp.height = canvas.height;
  temp.getContext("2d")?.drawImage(canvas, 0, 0);
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(temp, 0, 0);
}

function coverRect(vw: number, vh: number, cw: number, ch: number) {
  const s = Math.max(cw / vw, ch / vh);
  const dw = vw * s;
  const dh = vh * s;
  return { dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw, dh };
}

/**
 * Draw the camera frame mirrored and scaled to cover the whole canvas
 * (like CSS object-fit: cover). `pad` grows the image on every side,
 * used to hide blur edges.
 */
export function drawVideoCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  vw: number,
  vh: number,
  cw: number,
  ch: number,
  pad = 0,
) {
  const { dx, dy, dw, dh } = coverRect(vw || cw, vh || ch, cw, ch);
  ctx.save();
  ctx.translate(cw, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(image, dx - pad, dy - pad, dw + pad * 2, dh + pad * 2);
  ctx.restore();
}

/**
 * Convert landmarks normalised to the (unmirrored) video frame into
 * landmarks normalised to the cover-fitted canvas. Mirroring afterwards
 * with `x = 1 - x` still lines up because the crop is centred.
 */
export function mapToStage<T extends Pt>(
  lm: T[],
  vw: number,
  vh: number,
  cw: number,
  ch: number,
): T[] {
  if (!vw || !vh) return lm;
  const { dx, dy, dw, dh } = coverRect(vw, vh, cw, ch);
  return lm.map((p) => ({
    ...p,
    x: (p.x * dw + dx) / cw,
    y: (p.y * dh + dy) / ch,
  }));
}

/**
 * Gives each detected hand an ID that stays the same across frames, by
 * matching palm centres to the previous frame. MediaPipe's own order and
 * Left/Right labels are not stable once more than one person is in view.
 */
export function createHandIdTracker(maxDist = 0.18, keepFrames = 6) {
  type Track = {
    id: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    missed: number;
  };
  let tracked: Track[] = [];
  let nextId = 0;

  return (hands: Pt[][]): number[] => {
    const centers = hands.map((lm) => ({
      x: (lm[0].x + lm[9].x) / 2,
      y: (lm[0].y + lm[9].y) / 2,
    }));

    // Match against where each hand is expected to be now (constant
    // velocity), so two players' hands crossing don't swap IDs.
    const pairs: { i: number; j: number; d: number }[] = [];
    centers.forEach((c, i) =>
      tracked.forEach((t, j) => {
        const k = t.missed + 1;
        const px = t.x + t.vx * k;
        const py = t.y + t.vy * k;
        pairs.push({ i, j, d: Math.hypot(c.x - px, c.y - py) });
      }),
    );
    pairs.sort((a, b) => a.d - b.d);

    const ids = new Array<number>(hands.length).fill(-1);
    const match = new Array<number>(hands.length).fill(-1);
    const used = new Set<number>();
    for (const { i, j, d } of pairs) {
      if (d > maxDist) break;
      if (ids[i] !== -1 || used.has(j)) continue;
      ids[i] = tracked[j].id;
      match[i] = j;
      used.add(j);
    }

    const next: Track[] = centers.map((c, i) => {
      if (match[i] === -1) {
        ids[i] = nextId++;
        return { id: ids[i], ...c, vx: 0, vy: 0, missed: 0 };
      }
      const t = tracked[match[i]];
      const k = t.missed + 1;
      // Smoothed per-frame velocity.
      const vx = t.vx * 0.5 + ((c.x - t.x) / k) * 0.5;
      const vy = t.vy * 0.5 + ((c.y - t.y) / k) * 0.5;
      return { id: ids[i], ...c, vx, vy, missed: 0 };
    });
    tracked.forEach((t, j) => {
      if (!used.has(j) && t.missed < keepFrames)
        next.push({ ...t, missed: t.missed + 1 });
    });
    tracked = next;
    return ids;
  };
}

/** Track an element's rendered size (CSS px). */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

import {
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { getSharedFileset } from "./mediapipe-fileset";

const MODEL_PATH = "/mediapipe/hand_landmarker/hand_landmarker.task";

type Pt = { x: number; y: number; z: number };

/**
 * Why the hand limit matters for speed: HandLandmarker only runs its
 * expensive palm *detector* while fewer hands are tracked than `numHands`.
 * With numHands = 4 and 1–3 hands in view, it re-detects every frame,
 * which makes weaker computers lag. Games that only need two hands ask for
 * two; the drawing game asks for four but drops to two if it's too slow.
 */
const SLOW_DETECT_MS = 28; // average detect time considered too slow
const SLOW_FRAMES = 45; // …sustained this many frames before downgrading

/** Live numbers for the `?debug` overlay. */
export const perfStats = {
  delegate: "-" as "GPU" | "CPU" | "-",
  numHands: 0,
  detectMs: 0,
  fps: 0,
  downgraded: false,
};

export interface AdaptiveDetector {
  detect(video: HTMLVideoElement): HandLandmarkerResult | null;
  close(): void;
  /** Called once if the hand limit is lowered for speed. */
  onDowngrade?: (numHands: number) => void;
}

export async function createAdaptiveDetector(
  numHands: number,
): Promise<AdaptiveDetector> {
  const create = async (delegate: "GPU" | "CPU") =>
    HandLandmarker.createFromOptions(await getSharedFileset(), {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: "VIDEO",
      numHands,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  let landmarker: HandLandmarker;
  try {
    landmarker = await create("GPU");
    perfStats.delegate = "GPU";
  } catch (err) {
    console.warn("GPU delegate ใช้ไม่ได้ ใช้ CPU แทน:", err);
    landmarker = await create("CPU");
    perfStats.delegate = "CPU";
  }
  perfStats.numHands = numHands;
  perfStats.downgraded = false;

  let lastTs = 0;
  let lastFrameAt = 0;
  let avgMs = 0;
  let slowFrames = 0;
  let current = numHands;
  let closed = false;

  const det: AdaptiveDetector = {
    detect(video) {
      if (closed || !video.videoWidth) return null;
      const t0 = performance.now();
      const ts = Math.max(lastTs + 1, Math.round(t0));
      lastTs = ts;
      const result = landmarker.detectForVideo(video, ts);
      const ms = performance.now() - t0;

      avgMs = avgMs ? avgMs * 0.9 + ms * 0.1 : ms;
      if (lastFrameAt) {
        const fps = 1000 / Math.max(1, t0 - lastFrameAt);
        perfStats.fps = perfStats.fps ? perfStats.fps * 0.9 + fps * 0.1 : fps;
      }
      lastFrameAt = t0;
      perfStats.detectMs = avgMs;

      if (current > 2) {
        slowFrames = avgMs > SLOW_DETECT_MS ? slowFrames + 1 : 0;
        if (slowFrames >= SLOW_FRAMES) {
          current = 2;
          slowFrames = 0;
          perfStats.numHands = 2;
          perfStats.downgraded = true;
          landmarker.setOptions({ numHands: 2 }).catch(console.error);
          det.onDowngrade?.(2);
        }
      }
      return result;
    },
    close() {
      closed = true;
      landmarker.close();
    },
  };
  return det;
}

export interface TasksHandResults {
  image: HTMLVideoElement;
  multiHandLandmarks: Pt[][];
  multiHandedness: { label: "Left" | "Right"; score: number; index: number }[];
  multiHandWorldLandmarks: Pt[][];
}

/**
 * Drop-in replacement for the legacy `new Hands(...)` object from
 * @mediapipe/hands, backed by tasks-vision HandLandmarker on the GPU.
 * Same shape: setOptions / onResults / send / close, results in the legacy
 * format (multiHandLandmarks, multiHandedness with `label`).
 */
export function createTasksHands(numHands = 2) {
  let callback: ((r: TasksHandResults) => void) | null = null;
  let detector: AdaptiveDetector | null = null;
  let closed = false;

  const ready = createAdaptiveDetector(numHands).then((d) => {
    if (closed) d.close();
    else detector = d;
  });

  return {
    /** Kept for API compatibility; options are fixed at creation. */
    setOptions(_opts: unknown) {
      void _opts;
    },
    onResults(cb: (r: TasksHandResults) => void) {
      callback = cb;
    },
    async send({ image }: { image: HTMLVideoElement }) {
      await ready;
      if (!detector || closed) return;
      const r = detector.detect(image);
      if (!r) return;
      callback?.({
        image,
        multiHandLandmarks: r.landmarks as Pt[][],
        multiHandWorldLandmarks: r.worldLandmarks as Pt[][],
        multiHandedness: r.handedness.map((c, index) => ({
          label: (c[0]?.categoryName === "Left" ? "Left" : "Right") as
            "Left" | "Right",
          score: c[0]?.score ?? 0,
          index,
        })),
      });
    },
    async close() {
      closed = true;
      detector?.close();
      detector = null;
    },
  };
}

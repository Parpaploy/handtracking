import {
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { getSharedFileset } from "./mediapipe-fileset";

const MODEL_PATH = "/mediapipe/hand_landmarker/hand_landmarker.task";

type Pt = { x: number; y: number; z: number };

/**
 * Speed notes:
 * - HandLandmarker only runs its expensive palm *detector* while fewer
 *   hands are tracked than `numHands`; a high limit with few hands in view
 *   means re-detecting every frame.
 * - On slow machines (e.g. Windows laptops on integrated graphics, or no
 *   GPU at all) the detector steps its workload down until it keeps up:
 *     1. hand limit 4 → 2            (drawing game only)
 *     2. camera 1280×720 → 640×360  (less to upload and draw each frame)
 *     3. detect every other frame, reusing the last hands in between, so
 *        the video itself still updates every frame and looks smooth.
 */
const SLOW_DETECT_MS = 24; // average detect time considered too slow
const SLOW_FPS = 22; // …or frame rate below this
const SLOW_FRAMES = 40; // sustained this many frames before stepping down

type Level = 0 | 1 | 2 | 3;
const LEVEL_LABEL = ["ปกติ", "ลดจำนวนมือ", "ลดความละเอียดกล้อง", "จับมือเฟรมเว้นเฟรม"];

// If the "GPU" delegate is this slow, also try the CPU and keep the faster.
const TRY_CPU_ABOVE_MS = 45;
const COMPARE_FRAMES = 30;

/** The browser's WebGL renderer name (what "GPU" really runs on). */
function webglRenderer(): string {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return "no WebGL";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return String(name);
  } catch {
    return "unknown";
  }
}

/** Software "GPUs" (driver problems, VMs, remote desktop): CPU is faster. */
const SOFTWARE_GL =
  /swiftshader|basic render|llvmpipe|softpipe|software|microsoft basic/i;

/** Live numbers for the `?debug` overlay. */
export const perfStats = {
  renderer: "-",
  delegate: "-" as "GPU" | "CPU" | "-",
  numHands: 0,
  detectMs: 0,
  fps: 0,
  downgraded: false,
  level: "ปกติ",
  camera: "-",
};

export interface AdaptiveDetector {
  /** Hands for this frame (may be the previous result when skipping). */
  detect(video: HTMLVideoElement): HandLandmarkerResult | null;
  close(): void;
  /** Called if the hand limit is lowered for speed. */
  onDowngrade?: (numHands: number) => void;
}

function lowerCamera(video: HTMLVideoElement) {
  const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
  track
    ?.applyConstraints({ width: { ideal: 640 }, height: { ideal: 360 } })
    .catch((err) => console.warn("ลดความละเอียดกล้องไม่ได้:", err));
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

  const renderer = webglRenderer();
  perfStats.renderer = renderer;
  const softwareGL = SOFTWARE_GL.test(renderer) || renderer === "no WebGL";

  let landmarker: HandLandmarker;
  let delegate: "GPU" | "CPU" = "CPU";
  if (softwareGL) {
    landmarker = await create("CPU");
  } else {
    try {
      landmarker = await create("GPU");
      delegate = "GPU";
    } catch (err) {
      console.warn("GPU delegate ใช้ไม่ได้ ใช้ CPU แทน:", err);
      landmarker = await create("CPU");
    }
  }
  perfStats.delegate = delegate;

  let current = numHands;
  let level: Level = 0;
  let lastTs = 0;
  let lastFrameAt = 0;
  let avgMs = 0;
  let slowFrames = 0;
  let frame = 0;
  let cached: HandLandmarkerResult | null = null;
  let closed = false;
  // Without a GPU, start already lightened (steps 1–2 applied on first frame).
  // (Only when CPU was forced by a failure/software GL; a CPU picked by the
  // GPU-vs-CPU comparison below is already fast enough.)
  let pendingCpuStart = delegate === "CPU";

  // GPU-vs-CPU comparison state.
  let cpuTried = delegate === "CPU";
  let detectCount = 0;
  let candidate: HandLandmarker | null = null;
  let compare: {
    gpu: HandLandmarker;
    gpuMs: number;
    cpuMs: number;
    n: number;
  } | null = null;

  perfStats.numHands = numHands;
  perfStats.downgraded = false;
  perfStats.level = LEVEL_LABEL[0];
  perfStats.fps = 0;

  const setLevel = (next: Level, video: HTMLVideoElement) => {
    level = next;
    perfStats.level = LEVEL_LABEL[next];
    perfStats.downgraded = true;
    if (next >= 1 && current > 2) {
      current = 2;
      perfStats.numHands = 2;
      landmarker.setOptions({ numHands: 2 }).catch(console.error);
      det.onDowngrade?.(2);
    }
    if (next === 2) lowerCamera(video);
  };

  const det: AdaptiveDetector = {
    detect(video) {
      if (closed || !video.videoWidth) return null;
      frame++;
      const t0 = performance.now();
      if (lastFrameAt) {
        const fps = 1000 / Math.max(1, t0 - lastFrameAt);
        perfStats.fps = perfStats.fps ? perfStats.fps * 0.9 + fps * 0.1 : fps;
      }
      lastFrameAt = t0;
      perfStats.camera = `${video.videoWidth}×${video.videoHeight}`;

      if (pendingCpuStart) {
        pendingCpuStart = false;
        setLevel(1, video);
        setLevel(2, video);
      }

      // Step 3: reuse the previous hands on every other frame.
      if (level >= 3 && cached && frame % 2 === 1) return cached;

      // Swap in the CPU landmarker once it has loaded, and time it.
      if (candidate && !compare) {
        compare = { gpu: landmarker, gpuMs: avgMs, cpuMs: 0, n: 0 };
        landmarker = candidate;
        candidate = null;
        perfStats.delegate = "CPU";
        perfStats.level = `${LEVEL_LABEL[level]} · ทดสอบ CPU`;
      }

      const ts = Math.max(lastTs + 1, Math.round(performance.now()));
      lastTs = ts;
      const d0 = performance.now();
      const result = landmarker.detectForVideo(video, ts);
      const ms = performance.now() - d0;
      detectCount++;
      cached = result;

      if (compare) {
        compare.cpuMs = compare.n ? compare.cpuMs * 0.8 + ms * 0.2 : ms;
        compare.n++;
        perfStats.detectMs = compare.cpuMs;
        if (compare.n >= COMPARE_FRAMES) {
          if (compare.cpuMs < compare.gpuMs * 0.85) {
            compare.gpu.close(); // CPU wins
            avgMs = compare.cpuMs;
          } else {
            landmarker.close(); // GPU was better after all
            landmarker = compare.gpu;
            perfStats.delegate = "GPU";
            avgMs = compare.gpuMs;
          }
          perfStats.level = LEVEL_LABEL[level];
          compare = null;
          slowFrames = 0;
        }
        return result;
      }

      avgMs = avgMs ? avgMs * 0.9 + ms * 0.1 : ms;
      perfStats.detectMs = avgMs;

      // "GPU" that is this slow is usually software rendering or a very
      // weak chip: load the CPU version in the background and compare.
      if (
        !cpuTried &&
        perfStats.delegate === "GPU" &&
        detectCount > 15 &&
        avgMs > TRY_CPU_ABOVE_MS
      ) {
        cpuTried = true;
        create("CPU")
          .then((lm) => {
            if (closed) return lm.close();
            // Match the hand limit in use (may have been lowered already).
            if (current !== numHands)
              lm.setOptions({ numHands: current }).catch(console.error);
            candidate = lm;
          })
          .catch((err) => console.warn("สร้าง CPU detector ไม่ได้:", err));
      }

      if (level < 3) {
        const slow = avgMs > SLOW_DETECT_MS || perfStats.fps < SLOW_FPS;
        slowFrames = slow ? slowFrames + 1 : 0;
        if (slowFrames >= SLOW_FRAMES) {
          slowFrames = 0;
          avgMs = 0;
          // Skip the hand-limit step when there is nothing to lower.
          let next = (level + 1) as Level;
          if (next === 1 && current <= 2) next = 2;
          setLevel(next, video);
        }
      }
      return result;
    },
    close() {
      closed = true;
      landmarker.close();
      candidate?.close();
      compare?.gpu.close();
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

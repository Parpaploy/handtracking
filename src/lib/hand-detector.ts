import {
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { getSharedFileset } from "./mediapipe-fileset";
import { CAMERA_HD, CAMERA_SMALL, IS_LOW_POWER } from "./stage";

const MODEL_PATH = "/mediapipe/hand_landmarker/hand_landmarker.task";

type Pt = { x: number; y: number; z: number };

/**
 * Speed notes:
 * - HandLandmarker only runs its expensive palm *detector* while fewer
 *   hands are tracked than `numHands`; a high limit with few hands in view
 *   means re-detecting every frame.
 * - The camera starts at 640×360 everywhere. Once detection has been
 *   clearly fast for a while (and not on a tablet), it is raised to
 *   1280×720 for a sharper picture; if HD then turns out slow, it goes
 *   back down and stays down.
 * - On slow machines (e.g. Windows laptops on integrated graphics, or no
 *   GPU at all) the detector steps its workload down until it keeps up:
 *     1. hand limit 4 → 2            (drawing game only)
 *     2. camera back to 640×360      (if it had been raised)
 *     3. detect every other frame, reusing the last hands in between, so
 *        the video itself still updates every frame and looks smooth.
 */
const SLOW_DETECT_MS = 24; // average detect time considered too slow
// Not frame rate: detection only runs on new camera frames, so fps mostly
// reflects the webcam (many give 15–30 fps, less in dim light), not speed.
const WARMUP_FRAMES = 60; // first GPU frames compile shaders and are slow
const SLOW_FRAMES = 40; // sustained this many frames before stepping down
const FAST_DETECT_MS = 14; // average detect time fast enough to try HD
const FAST_FRAMES = 60; // …sustained this many frames (≈2 s)

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
  delegate: "-" as string,
  /** Hand updates per second (separate from video fps when in a worker). */
  handRate: 0,
  worker: false,
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

function setCamera(video: HTMLVideoElement, size: typeof CAMERA_HD) {
  const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
  track
    ?.applyConstraints(size)
    .catch((err) => console.warn("เปลี่ยนความละเอียดกล้องไม่ได้:", err));
}

/** Safari / iPad (all iOS browsers are WebKit): keep the main-thread path
 *  that is already tuned there; WebKit's worker GPU support is patchy. */
const IS_WEBKIT =
  typeof navigator !== "undefined" &&
  ((/AppleWebKit/.test(navigator.userAgent) &&
    !/Chrome|Chromium|Edg|Firefox/.test(navigator.userAgent)) ||
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

const CAN_USE_WORKER =
  typeof Worker !== "undefined" &&
  typeof OffscreenCanvas !== "undefined" &&
  typeof createImageBitmap === "function" &&
  !IS_WEBKIT;

/**
 * Hand detector for the games. Prefers a Web Worker so a slow detection
 * never freezes the video (see hand-worker.ts); falls back to running on
 * the page if the worker can't start.
 */
export async function createAdaptiveDetector(
  numHands: number,
): Promise<AdaptiveDetector> {
  if (CAN_USE_WORKER) {
    try {
      return await createWorkerDetector(numHands);
    } catch (err) {
      console.warn("hand worker ใช้ไม่ได้ หามือบนหน้าเว็บแทน:", err);
    }
  }
  return createMainThreadDetector(numHands);
}

async function createWorkerDetector(
  numHands: number,
): Promise<AdaptiveDetector> {
  const renderer = webglRenderer();
  perfStats.renderer = renderer;
  const softwareGL = SOFTWARE_GL.test(renderer) || renderer === "no WebGL";

  const worker = new Worker(new URL("./hand-worker.ts", import.meta.url), {
    type: "module",
  });
  const delegate = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker timeout")), 20000);
    worker.onmessage = (e) => {
      if (e.data.type === "ready") {
        clearTimeout(timer);
        resolve(e.data.delegate);
      } else if (e.data.type === "error") {
        clearTimeout(timer);
        reject(new Error(e.data.message));
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error(e.message || "worker error"));
    };
    worker.postMessage({
      type: "init",
      numHands,
      delegate: softwareGL ? "CPU" : "GPU",
    });
  }).catch((err) => {
    worker.terminate();
    throw err;
  });

  perfStats.worker = true;
  perfStats.delegate = delegate;
  perfStats.numHands = numHands;
  perfStats.downgraded = false;
  perfStats.level = "ปกติ";
  perfStats.fps = 0;
  perfStats.handRate = 0;

  let latest: HandLandmarkerResult | null = null;
  let busySince = 0; // 0 = idle
  let closed = false;
  let current = numHands;
  // Camera: stay small on tablets / without a GPU; otherwise raise to HD
  // once detection has proven fast.
  let hd: "wait" | "on" | "off" =
    IS_LOW_POWER || delegate === "CPU" ? "off" : "wait";
  let fastFrames = 0;
  let slowFrames = 0;
  let results = 0;
  let lastResultAt = 0;
  let lastRenderAt = 0;
  let video: HTMLVideoElement | null = null;

  const adapt = (avg: number) => {
    if (results < WARMUP_FRAMES || !video) return;
    if (hd === "wait") {
      fastFrames = avg < FAST_DETECT_MS ? fastFrames + 1 : 0;
      if (fastFrames >= FAST_FRAMES) {
        hd = "on";
        slowFrames = 0;
        setCamera(video, CAMERA_HD);
      }
    }
    slowFrames = avg > SLOW_DETECT_MS ? slowFrames + 1 : 0;
    if (slowFrames < SLOW_FRAMES) return;
    slowFrames = 0;
    if (hd === "on") {
      hd = "off";
      setCamera(video, CAMERA_SMALL);
      perfStats.downgraded = true;
      perfStats.level = "ลดความละเอียดกล้อง";
    } else if (current > 2) {
      current = 2;
      worker.postMessage({ type: "hands", n: 2 });
      perfStats.numHands = 2;
      perfStats.downgraded = true;
      perfStats.level = "ลดจำนวนมือ";
      det.onDowngrade?.(2);
    }
  };

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "result") {
      busySince = 0;
      results++;
      latest = {
        landmarks: m.landmarks,
        worldLandmarks: m.worldLandmarks,
        handedness: m.handedness,
        handednesses: m.handedness,
      } as HandLandmarkerResult;
      perfStats.detectMs = m.avgMs;
      perfStats.delegate = m.delegate;
      const now = performance.now();
      if (lastResultAt) {
        const rate = 1000 / Math.max(1, now - lastResultAt);
        perfStats.handRate = perfStats.handRate
          ? perfStats.handRate * 0.9 + rate * 0.1
          : rate;
      }
      lastResultAt = now;
      adapt(m.avgMs);
    } else if (m.type === "error") {
      busySince = 0;
      console.error("hand worker:", m.message);
    }
  };
  worker.onerror = (e) => {
    busySince = 0;
    console.error("hand worker:", e.message);
  };

  const det: AdaptiveDetector = {
    detect(v) {
      video = v;
      if (closed || !v.videoWidth) return latest;
      const now = performance.now();
      if (lastRenderAt) {
        const fps = 1000 / Math.max(1, now - lastRenderAt);
        perfStats.fps = perfStats.fps ? perfStats.fps * 0.9 + fps * 0.1 : fps;
      }
      lastRenderAt = now;
      perfStats.camera = `${v.videoWidth}×${v.videoHeight}`;

      // One frame in flight at a time; newer frames simply wait their turn.
      // (Safety: if a reply never comes, try again after 2 s.)
      if (!busySince || now - busySince > 2000) {
        busySince = now;
        createImageBitmap(v)
          .then((bitmap) => {
            if (closed) return bitmap.close();
            worker.postMessage({ type: "frame", bitmap, ts: now }, [bitmap]);
          })
          .catch(() => {
            busySince = 0;
          });
      }
      return latest;
    },
    close() {
      closed = true;
      worker.terminate();
    },
  };
  return det;
}

async function createMainThreadDetector(
  numHands: number,
): Promise<AdaptiveDetector> {
  perfStats.worker = false;
  perfStats.handRate = 0;
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
  // HD camera: "wait" until proven fast, "on" once raised, "off" for good.
  let hd: "wait" | "on" | "off" = IS_LOW_POWER ? "off" : "wait";
  let fastFrames = 0;

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
    if (next >= 2 && hd === "on") setCamera(video, CAMERA_SMALL);
    if (next >= 2) hd = "off";
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

      const warm = detectCount > WARMUP_FRAMES;

      // Fast for a while at the small size: switch the camera to HD.
      if (hd === "wait" && level === 0 && warm) {
        fastFrames = avgMs < FAST_DETECT_MS ? fastFrames + 1 : 0;
        if (fastFrames >= FAST_FRAMES) {
          hd = "on";
          slowFrames = 0;
          setCamera(video, CAMERA_HD);
        }
      }

      if (level < 3) {
        const slow = warm && avgMs > SLOW_DETECT_MS;
        slowFrames = slow ? slowFrames + 1 : 0;
        if (slowFrames >= SLOW_FRAMES && hd === "on") {
          // HD was too much after all: back to small, keep everything else.
          slowFrames = 0;
          avgMs = 0;
          hd = "off";
          setCamera(video, CAMERA_SMALL);
        } else if (slowFrames >= SLOW_FRAMES) {
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

/// <reference lib="webworker" />
/**
 * Hand detection off the main thread. On slow machines one detection can
 * take 50–150 ms; run on the page itself, that freezes the video and all
 * drawing for that long. Here the page keeps rendering at full speed and
 * simply uses the newest hands whenever they arrive.
 *
 * Messages in:  init {numHands, delegate} · frame {bitmap, ts} · hands {n}
 * Messages out: ready {delegate} · result {...} · error {message}
 */
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const WASM_PATH = "/mediapipe/tasks-vision/wasm";
const MODEL_PATH = "/mediapipe/hand_landmarker/hand_landmarker.task";

// If the "GPU" delegate is this slow (weak integrated graphics), also try
// the CPU and keep whichever is faster.
const TRY_CPU_ABOVE_MS = 45;
const COMPARE_FRAMES = 20;

type Delegate = "GPU" | "CPU";

let landmarker: HandLandmarker | null = null;
let delegate: Delegate = "CPU";
let numHands = 2;
let lastTs = 0;
let avgMs = 0;
let count = 0;
let cpuTried = false;
let compare: {
  gpu: HandLandmarker;
  gpuMs: number;
  cpuMs: number;
  n: number;
} | null = null;

// The "_module" wasm loader works inside module workers.
const fileset = FilesetResolver.forVisionTasks(WASM_PATH, true);

async function create(d: Delegate) {
  return HandLandmarker.createFromOptions(await fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: d },
    runningMode: "VIDEO",
    numHands,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

function post(msg: unknown) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

function detect(bitmap: ImageBitmap, ts: number) {
  if (!landmarker) return bitmap.close();
  const t = Math.max(lastTs + 1, Math.round(ts));
  lastTs = t;
  const t0 = performance.now();
  let r;
  try {
    r = landmarker.detectForVideo(bitmap, t);
  } finally {
    bitmap.close();
  }
  const ms = performance.now() - t0;
  count++;

  if (compare) {
    compare.cpuMs = compare.n ? compare.cpuMs * 0.8 + ms * 0.2 : ms;
    if (++compare.n >= COMPARE_FRAMES) {
      if (compare.cpuMs < compare.gpuMs * 0.85) {
        compare.gpu.close(); // CPU wins
        avgMs = compare.cpuMs;
      } else {
        landmarker.close(); // GPU was better after all
        landmarker = compare.gpu;
        delegate = "GPU";
        avgMs = compare.gpuMs;
      }
      compare = null;
    }
  } else {
    avgMs = avgMs ? avgMs * 0.9 + ms * 0.1 : ms;
    if (
      !cpuTried &&
      delegate === "GPU" &&
      count > 30 &&
      avgMs > TRY_CPU_ABOVE_MS
    ) {
      cpuTried = true;
      create("CPU")
        .then((cpu) => {
          compare = { gpu: landmarker!, gpuMs: avgMs, cpuMs: 0, n: 0 };
          landmarker = cpu;
          delegate = "CPU";
        })
        .catch((err) => console.warn("สร้าง CPU detector ไม่ได้:", err));
    }
  }

  post({
    type: "result",
    landmarks: r.landmarks,
    worldLandmarks: r.worldLandmarks,
    handedness: r.handedness,
    ms,
    avgMs,
    delegate: compare ? "CPU (ทดสอบ)" : delegate,
  });
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === "init") {
    numHands = m.numHands;
    try {
      if (m.delegate === "GPU") {
        try {
          landmarker = await create("GPU");
          delegate = "GPU";
        } catch (err) {
          console.warn("GPU ใน worker ใช้ไม่ได้ ใช้ CPU แทน:", err);
          landmarker = await create("CPU");
          delegate = "CPU";
        }
      } else {
        landmarker = await create("CPU");
        delegate = "CPU";
        cpuTried = true;
      }
      post({ type: "ready", delegate });
    } catch (err) {
      post({ type: "error", message: String(err) });
    }
  } else if (m.type === "frame") {
    try {
      detect(m.bitmap as ImageBitmap, m.ts);
    } catch (err) {
      post({ type: "error", message: String(err) });
    }
  } else if (m.type === "hands") {
    numHands = m.n;
    landmarker?.setOptions({ numHands: m.n }).catch(console.error);
    compare?.gpu.setOptions({ numHands: m.n }).catch(console.error);
  }
};

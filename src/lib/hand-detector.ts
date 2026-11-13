import { HandLandmarker } from "@mediapipe/tasks-vision";
import { getSharedFileset } from "./mediapipe-fileset";
import { MAX_HANDS } from "./stage";

const MODEL_PATH = "/mediapipe/hand_landmarker/hand_landmarker.task";

type Pt = { x: number; y: number; z: number };

export interface TasksHandResults {
  image: HTMLVideoElement;
  multiHandLandmarks: Pt[][];
  multiHandedness: { label: "Left" | "Right"; score: number; index: number }[];
  multiHandWorldLandmarks: Pt[][];
}

/**
 * Drop-in replacement for the legacy `new Hands(...)` object from
 * @mediapipe/hands, backed by the newer tasks-vision HandLandmarker on the
 * GPU. The legacy solution slows down sharply per extra hand and is very
 * laggy on tablets; this one is much lighter.
 *
 * Same shape: setOptions / onResults / send / close, with results in the
 * legacy format (multiHandLandmarks, multiHandedness with `label`).
 */
export function createTasksHands(numHands = MAX_HANDS) {
  let callback: ((r: TasksHandResults) => void) | null = null;
  let landmarker: HandLandmarker | null = null;
  let closed = false;
  let lastTs = 0;

  const create = async (delegate: "GPU" | "CPU") =>
    HandLandmarker.createFromOptions(await getSharedFileset(), {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: "VIDEO",
      numHands,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  const ready = (async () => {
    let lm: HandLandmarker;
    try {
      lm = await create("GPU");
    } catch (err) {
      console.warn("GPU delegate ใช้ไม่ได้ ใช้ CPU แทน:", err);
      lm = await create("CPU");
    }
    if (closed) lm.close();
    else landmarker = lm;
  })();

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
      if (!landmarker || closed || !image.videoWidth) return;
      const ts = Math.max(lastTs + 1, Math.round(performance.now()));
      lastTs = ts;
      const r = landmarker.detectForVideo(image, ts);
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
      landmarker?.close();
      landmarker = null;
    },
  };
}

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { PoseFrame } from "../lib/pose-rig";
import {
  createLandmarkFilter,
  filterLandmarks,
  resetLandmarkFilter,
  DEFAULT_ONE_EURO,
  type OneEuroParams,
} from "../lib/one-euro";

const WASM_PATH = "/mediapipe/tasks-vision/wasm";
const MODEL_PATH = "/mediapipe/pose_landmarker/pose_landmarker_lite.task";

/**
 * Runs PoseLandmarker on the shared webcam video.
 *
 * Landmarks land in a ref rather than state on purpose: this fires at video
 * frame rate, and re-rendering React 30-60 times a second just to hand three.js
 * some numbers is pure waste. Only the coarse flags are state.
 */
export function usePoseLandmarks(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled = true,
  filterParams: OneEuroParams = DEFAULT_ONE_EURO,
) {
  const poseRef = useRef<PoseFrame | null>(null);
  const [ready, setReady] = useState(false);
  const [poseFound, setPoseFound] = useState(false);

  // Read inside the detect loop rather than captured, so dragging the leva
  // sliders retunes the filter without tearing down the landmarker.
  const paramsRef = useRef(filterParams);
  paramsRef.current = filterParams;

  useEffect(() => {
    if (!enabled) {
      poseRef.current = null;
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let landmarker: PoseLandmarker | null = null;
    let lastVideoTime = -1;
    let lastFound = false;
    // MediaPipe rejects a frame whose timestamp is not strictly greater than
    // the previous one, and it converts ms to microseconds internally — so a
    // sub-millisecond wobble in performance.now() is enough to poison the
    // graph permanently ("Packet timestamp mismatch on ... norm_rect").
    // Feed it whole milliseconds that can only ever go up.
    let lastTimestamp = 0;
    // MediaPipe's depth estimate is its noisiest channel by a wide margin, and
    // a swing-only retarget turns that noise straight into a shaking arm. See
    // lib/one-euro.ts for why a plain exponential smooth cannot fix it.
    const filter = createLandmarkFilter();

    const init = async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      const created = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      if (cancelled) {
        created.close();
        return;
      }
      landmarker = created;
      setReady(true);
    };

    init().catch((err) => {
      console.error("โหลด PoseLandmarker ไม่สำเร็จ:", err);
    });

    const loop = () => {
      const video = videoRef.current;

      if (
        video &&
        landmarker &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.currentTime !== lastVideoTime
      ) {
        lastVideoTime = video.currentTime;

        try {
          const timestamp = Math.max(
            lastTimestamp + 1,
            Math.round(performance.now()),
          );
          const dt = Math.min(
            Math.max((timestamp - lastTimestamp) / 1000, 1 / 240),
            1 / 5,
          );
          lastTimestamp = timestamp;

          const result = landmarker.detectForVideo(video, timestamp);
          const world = result.worldLandmarks?.[0];
          const view = result.landmarks?.[0];

          if (world && view && world.length > 0) {
            poseRef.current = {
              world: filterLandmarks(filter, world, dt, paramsRef.current),
              view,
            };
            if (!lastFound) {
              lastFound = true;
              setPoseFound(true);
            }
          } else {
            poseRef.current = null;
            // Forget the old position: smoothing the re-acquire against a
            // stale one makes the arm visibly slide in from where the body
            // used to be.
            resetLandmarkFilter(filter);
            if (lastFound) {
              lastFound = false;
              setPoseFound(false);
            }
          }
        } catch (err) {
          console.error("pose detect ล้มเหลว:", err);
        }
      }

      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      landmarker?.close();
      landmarker = null;
      poseRef.current = null;
      setReady(false);
      setPoseFound(false);
    };
  }, [videoRef, enabled]);

  // Guard the flags too: the teardown above is async-adjacent, and a stale
  // "tracking..." while the landmarker is being rebuilt reads as a lie.
  return { poseRef, ready: enabled && ready, poseFound: enabled && poseFound };
}

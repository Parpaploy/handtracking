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

export function usePoseLandmarks(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled = true,
  filterParams: OneEuroParams = DEFAULT_ONE_EURO,
) {
  const poseRef = useRef<PoseFrame | null>(null);
  const [ready, setReady] = useState(false);
  const [poseFound, setPoseFound] = useState(false);

  const paramsRef = useRef(filterParams);

  useEffect(() => {
    paramsRef.current = filterParams;
  }, [filterParams]);

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

    let lastTimestamp = 0;

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

  return { poseRef, ready: enabled && ready, poseFound: enabled && poseFound };
}

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { HandFrame, Side } from "../lib/pose-rig";

const WASM_PATH = "/mediapipe/tasks-vision/wasm";
const MODEL_PATH = "/mediapipe/hand_landmarker/hand_landmarker.task";

/**
 * Runs HandLandmarker on the shared webcam video.
 *
 * Same shape as usePoseLandmarks: landmarks go in a ref because this fires at
 * video frame rate and re-rendering React just to hand three.js some numbers
 * is pure waste. Only the coarse flags are state.
 */
export function useHandLandmarks(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled = true,
) {
  const handsRef = useRef<HandFrame[] | null>(null);
  const [ready, setReady] = useState(false);
  const [handCount, setHandCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      handsRef.current = null;
      return;
    }

    let cancelled = false;
    let rafId = 0;
    let landmarker: HandLandmarker | null = null;
    let lastVideoTime = -1;
    let lastCount = 0;
    // MediaPipe rejects a frame whose timestamp is not strictly greater than
    // the previous one, and converts ms to microseconds internally — so a
    // sub-millisecond wobble in performance.now() permanently poisons the
    // graph. Whole milliseconds that can only go up.
    let lastTimestamp = 0;

    const init = async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      const created = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
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
      console.error("โหลด HandLandmarker ไม่สำเร็จ:", err);
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
          lastTimestamp = timestamp;

          const result = landmarker.detectForVideo(video, timestamp);

          const frames: HandFrame[] = [];
          const worlds = result.worldLandmarks ?? [];
          const handedness = result.handedness ?? [];

          for (let i = 0; i < worlds.length; i++) {
            const world = worlds[i];
            const label = handedness[i]?.[0]?.categoryName;
            if (!world || world.length === 0) continue;
            if (label !== "Left" && label !== "Right") continue;
            frames.push({ world, label: label as Side });
          }

          handsRef.current = frames.length > 0 ? frames : null;

          if (frames.length !== lastCount) {
            lastCount = frames.length;
            setHandCount(frames.length);
          }
        } catch (err) {
          console.error("hand detect ล้มเหลว:", err);
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
      handsRef.current = null;
      setReady(false);
      setHandCount(0);
    };
  }, [videoRef, enabled]);

  return {
    handsRef,
    ready: enabled && ready,
    handCount: enabled ? handCount : 0,
  };
}

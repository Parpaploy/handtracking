import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { HandFrame, Side } from "../lib/pose-rig";
import {
  createLandmarkFilter,
  filterLandmarks,
  resetLandmarkFilter,
  DEFAULT_ONE_EURO,
  type LandmarkFilter,
  type OneEuroParams,
} from "../lib/one-euro";

const WASM_PATH = "/mediapipe/tasks-vision/wasm";
const MODEL_PATH = "/mediapipe/hand_landmarker/hand_landmarker.task";

export function useHandLandmarks(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled = true,
  filterParams: OneEuroParams = DEFAULT_ONE_EURO,
) {
  const handsRef = useRef<HandFrame[] | null>(null);
  const [ready, setReady] = useState(false);
  const [handCount, setHandCount] = useState(0);

  const paramsRef = useRef(filterParams);

  useEffect(() => {
    paramsRef.current = filterParams;
  }, [filterParams]);

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

    let lastTimestamp = 0;

    const filters = new Map<Side, LandmarkFilter>();

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
          const dt = Math.min(
            Math.max((timestamp - lastTimestamp) / 1000, 1 / 240),
            1 / 5,
          );
          lastTimestamp = timestamp;

          const result = landmarker.detectForVideo(video, timestamp);

          const frames: HandFrame[] = [];
          const worlds = result.worldLandmarks ?? [];
          const handedness = result.handedness ?? [];
          const seen = new Set<Side>();

          for (let i = 0; i < worlds.length; i++) {
            const world = worlds[i];
            const label = handedness[i]?.[0]?.categoryName;
            if (!world || world.length === 0) continue;
            if (label !== "Left" && label !== "Right") continue;

            const side = label as Side;
            seen.add(side);

            let filter = filters.get(side);
            if (!filter) {
              filter = createLandmarkFilter();
              filters.set(side, filter);
            }

            frames.push({
              world: filterLandmarks(filter, world, dt, paramsRef.current),
              label: side,
            });
          }

          for (const [side, filter] of filters) {
            if (!seen.has(side)) resetLandmarkFilter(filter);
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

import { useEffect, useRef, useState } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  createLandmarkFilter,
  filterLandmarks,
  resetLandmarkFilter,
  DEFAULT_ONE_EURO,
  type OneEuroParams,
} from "../lib/one-euro";

export type BlendshapeMap = Record<string, number>;

export interface HeadRotation {
  x: number;
  y: number;
  z: number;
}

const WASM_PATH = "/mediapipe/tasks-vision/wasm";
const MODEL_PATH = "/mediapipe/face_landmarker/face_landmarker.task";

// คู่ blendshape ที่ต้องสลับชื่อกันเวลา mirror ภาพ
// (ซ้าย-ขวาของ MediaPipe อิงตามตัวแบบจริง ไม่ใช่ตามภาพที่ผู้ใช้เห็นในกระจก)
const LEFT_RIGHT_PAIRS: [string, string][] = [
  ["eyeBlinkLeft", "eyeBlinkRight"],
  ["eyeLookDownLeft", "eyeLookDownRight"],
  ["eyeLookInLeft", "eyeLookInRight"],
  ["eyeLookOutLeft", "eyeLookOutRight"],
  ["eyeLookUpLeft", "eyeLookUpRight"],
  ["eyeSquintLeft", "eyeSquintRight"],
  ["eyeWideLeft", "eyeWideRight"],
  ["browDownLeft", "browDownRight"],
  ["browOuterUpLeft", "browOuterUpRight"],
  ["cheekSquintLeft", "cheekSquintRight"],
  ["mouthDimpleLeft", "mouthDimpleRight"],
  ["mouthFrownLeft", "mouthFrownRight"],
  ["mouthLowerDownLeft", "mouthLowerDownRight"],
  ["mouthPressLeft", "mouthPressRight"],
  ["mouthSmileLeft", "mouthSmileRight"],
  ["mouthStretchLeft", "mouthStretchRight"],
  ["mouthUpperUpLeft", "mouthUpperUpRight"],
  ["noseSneerLeft", "noseSneerRight"],
];

function matrixToEuler(
  m: ArrayLike<number>,
  mirror: boolean,
  out: HeadRotation,
): HeadRotation {
  const m31 = m[2];
  const m32 = m[6];
  const m33 = m[10];
  const m21 = m[1];
  const m11 = m[0];
  const m23 = m[9];
  const m22 = m[5];

  if (Math.abs(m31) < 0.9999999) {
    out.y = Math.asin(-m31);
    out.x = Math.atan2(m32, m33);
    out.z = Math.atan2(m21, m11);
  } else {
    out.z = 0;
    out.y = m31 > 0 ? -Math.PI / 2 : Math.PI / 2;
    out.x = Math.atan2(-m23, m22);
  }

  // mirror ตามแนวตั้ง (แกน Y ของโลก) ทำให้ yaw (y) และ roll (z) กลับเครื่องหมาย
  // ส่วน pitch (x, ก้ม-เงย) ไม่ได้รับผลกระทบ
  if (mirror) {
    out.y = -out.y;
    out.z = -out.z;
  }

  return out;
}

/**
 * Runs FaceLandmarker on the shared webcam video.
 *
 * Output lands in refs, not state, matching usePoseLandmarks and
 * useHandLandmarks. This used to call setBlendshapes and setHeadRotation on
 * every detected frame, which re-rendered the whole /model route 30-60 times a
 * second purely to hand three.js some numbers. The dropped frames that caused
 * showed up as head jitter — and the hair chains hang off the head bone, so
 * the spring bones amplify it into a visible twitch.
 */
export function useFaceBlendshapes(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options?: { mirror?: boolean; filter?: OneEuroParams },
) {
  const mirror = options?.mirror ?? true; // ให้ default ตรงกับ video ที่ scaleX(-1) อยู่แล้ว
  const filterParams = options?.filter ?? DEFAULT_ONE_EURO;

  const blendshapesRef = useRef<BlendshapeMap>({});
  const headRotationRef = useRef<HeadRotation>({ x: 0, y: 0, z: 0 });
  const [ready, setReady] = useState(false);
  const [faceFound, setFaceFound] = useState(false);

  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const mirrorRef = useRef(mirror);
  const paramsRef = useRef(filterParams);
  paramsRef.current = filterParams;

  // อัปเดตค่า mirror ล่าสุดใน ref แบบ side-effect (ไม่แตะระหว่าง render)
  useEffect(() => {
    mirrorRef.current = mirror;
  }, [mirror]);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let lastVideoTime = -1;
    let lastFound = false;
    let lastMirror = mirrorRef.current;
    // Timestamps handed to MediaPipe must strictly increase, and it converts
    // ms to microseconds internally — sub-millisecond wobble in
    // performance.now() permanently poisons the graph. Whole ms, monotonic.
    let lastTimestamp = 0;

    // The head pose comes out of a solved transformation matrix, which is
    // every bit as jittery as the raw landmarks. Same filter, one "point".
    const rotationFilter = createLandmarkFilter();
    const rotationIn: HeadRotation[] = [{ x: 0, y: 0, z: 0 }];
    // Raw scores, kept separate so the mirrored map can be built without
    // reading values this frame already overwrote.
    const raw: BlendshapeMap = {};

    const init = async () => {
      const filesetResolver = await FilesetResolver.forVisionTasks(WASM_PATH);
      const landmarker = await FaceLandmarker.createFromOptions(
        filesetResolver,
        {
          baseOptions: {
            modelAssetPath: MODEL_PATH,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        },
      );
      if (cancelled) {
        landmarker.close();
        return;
      }
      landmarkerRef.current = landmarker;
      setReady(true);
    };

    init().catch((err) => {
      console.error("โหลด FaceLandmarker ไม่สำเร็จ:", err);
    });

    const loop = () => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;

      if (
        video &&
        landmarker &&
        video.readyState >= 2 &&
        // Same INVALID_ARGUMENT guard the pose and hand hooks carry; this one
        // was missing it.
        video.videoWidth > 0 &&
        video.currentTime !== lastVideoTime
      ) {
        lastVideoTime = video.currentTime;
        const timestamp = Math.max(
          lastTimestamp + 1,
          Math.round(performance.now()),
        );
        const dt = Math.min(
          Math.max((timestamp - lastTimestamp) / 1000, 1 / 240),
          1 / 5,
        );
        lastTimestamp = timestamp;

        try {
          const result: FaceLandmarkerResult = landmarker.detectForVideo(
            video,
            timestamp,
          );

          const isMirrored = mirrorRef.current;
          // Flipping mirror negates yaw and roll, which the filter would
          // otherwise chase across the jump as if the head had whipped round.
          if (isMirrored !== lastMirror) {
            lastMirror = isMirrored;
            resetLandmarkFilter(rotationFilter);
          }

          const shapes = result.faceBlendshapes?.[0]?.categories;
          const found = Boolean(shapes && shapes.length > 0);

          if (shapes) {
            for (const s of shapes) raw[s.categoryName] = s.score;

            // Mutated in place: the 52 category names never change, so there
            // is nothing to gain from a fresh object every frame.
            const out = blendshapesRef.current;
            for (const s of shapes) out[s.categoryName] = raw[s.categoryName];

            if (isMirrored) {
              for (const [left, right] of LEFT_RIGHT_PAIRS) {
                if (left in raw) out[right] = raw[left];
                if (right in raw) out[left] = raw[right];
              }
            }
          }

          const matrix = result.facialTransformationMatrixes?.[0]?.data;
          if (matrix) {
            matrixToEuler(matrix, isMirrored, rotationIn[0]);
            const smoothed = filterLandmarks(
              rotationFilter,
              rotationIn,
              dt,
              paramsRef.current,
            )[0];
            headRotationRef.current.x = smoothed.x;
            headRotationRef.current.y = smoothed.y;
            headRotationRef.current.z = smoothed.z;
          } else {
            resetLandmarkFilter(rotationFilter);
          }

          // Only the coarse flag is state, and only when it actually flips.
          if (found !== lastFound) {
            lastFound = found;
            setFaceFound(found);
          }
        } catch (err) {
          console.error("face detect ล้มเหลว:", err);
        }
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      setReady(false);
      setFaceFound(false);
    };
  }, [videoRef]);

  return { blendshapesRef, headRotationRef, ready, faceFound };
}

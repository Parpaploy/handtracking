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
import { LEFT_RIGHT_PAIRS } from "../constants/model.const";
import type {
  BlendshapeMap,
  HeadRotation,
} from "../interfaces/model.interface";

const WASM_PATH = "/mediapipe/tasks-vision/wasm";
const MODEL_PATH = "/mediapipe/face_landmarker/face_landmarker.task";

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

  if (mirror) {
    out.y = -out.y;
    out.z = -out.z;
  }

  return out;
}

export function useFaceBlendshapes(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options?: { mirror?: boolean; filter?: OneEuroParams },
) {
  const mirror = options?.mirror ?? true;
  const filterParams = options?.filter ?? DEFAULT_ONE_EURO;

  const blendshapesRef = useRef<BlendshapeMap>({});
  const headRotationRef = useRef<HeadRotation>({ x: 0, y: 0, z: 0 });
  const [ready, setReady] = useState(false);
  const [faceFound, setFaceFound] = useState(false);

  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const mirrorRef = useRef(mirror);
  const paramsRef = useRef(filterParams);

  useEffect(() => {
    mirrorRef.current = mirror;
  }, [mirror]);

  useEffect(() => {
    paramsRef.current = filterParams;
  }, [filterParams]);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let lastVideoTime = -1;
    let lastFound = false;
    let lastMirror = mirrorRef.current;

    let lastTimestamp = 0;

    const rotationFilter = createLandmarkFilter();
    const rotationIn: HeadRotation[] = [{ x: 0, y: 0, z: 0 }];

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

          if (isMirrored !== lastMirror) {
            lastMirror = isMirrored;
            resetLandmarkFilter(rotationFilter);
          }

          const shapes = result.faceBlendshapes?.[0]?.categories;
          const found = Boolean(shapes && shapes.length > 0);

          if (shapes) {
            for (const s of shapes) raw[s.categoryName] = s.score;

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

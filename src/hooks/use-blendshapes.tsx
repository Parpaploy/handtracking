import { useEffect, useRef, useState } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

export type BlendshapeMap = Record<string, number>;

export interface HeadRotation {
  x: number;
  y: number;
  z: number;
}

const WASM_PATH = "/mediapipe/tasks-vision/wasm";
const MODEL_PATH = "/mediapipe/face_landmarker/face_landmarker.task";

function matrixToEuler(m: ArrayLike<number>): HeadRotation {
  const m31 = m[2];
  const m32 = m[6];
  const m33 = m[10];
  const m21 = m[1];
  const m11 = m[0];
  const m23 = m[9];
  const m22 = m[5];

  let x: number, y: number, z: number;

  if (Math.abs(m31) < 0.9999999) {
    y = Math.asin(-m31);
    x = Math.atan2(m32, m33);
    z = Math.atan2(m21, m11);
  } else {
    z = 0;
    y = m31 > 0 ? -Math.PI / 2 : Math.PI / 2;
    x = Math.atan2(-m23, m22);
  }

  return { x, y, z };
}

export function useFaceBlendshapes(
  videoRef: React.RefObject<HTMLVideoElement | null>,
) {
  const [blendshapes, setBlendshapes] = useState<BlendshapeMap>({});
  const [headRotation, setHeadRotation] = useState<HeadRotation>({
    x: 0,
    y: 0,
    z: 0,
  });
  const [ready, setReady] = useState(false);
  const [faceFound, setFaceFound] = useState(false);

  const landmarkerRef = useRef<FaceLandmarker | null>(null);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let lastVideoTime = -1;

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
        video.currentTime !== lastVideoTime
      ) {
        lastVideoTime = video.currentTime;
        const result: FaceLandmarkerResult = landmarker.detectForVideo(
          video,
          performance.now(),
        );

        const shapes = result.faceBlendshapes?.[0]?.categories;
        setFaceFound(Boolean(shapes && shapes.length > 0));

        if (shapes) {
          const map: BlendshapeMap = {};
          for (const s of shapes) map[s.categoryName] = s.score;
          setBlendshapes(map);
        }

        const matrix = result.facialTransformationMatrixes?.[0]?.data;
        if (matrix) {
          setHeadRotation(matrixToEuler(matrix));
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
    };
  }, [videoRef]);

  return { blendshapes, headRotation, ready, faceFound };
}

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

function mirrorBlendshapes(map: BlendshapeMap): BlendshapeMap {
  const mirrored: BlendshapeMap = { ...map };
  for (const [left, right] of LEFT_RIGHT_PAIRS) {
    if (left in map) mirrored[right] = map[left];
    if (right in map) mirrored[left] = map[right];
  }
  return mirrored;
}

function matrixToEuler(m: ArrayLike<number>, mirror: boolean): HeadRotation {
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

  // mirror ตามแนวตั้ง (แกน Y ของโลก) ทำให้ yaw (y) และ roll (z) กลับเครื่องหมาย
  // ส่วน pitch (x, ก้ม-เงย) ไม่ได้รับผลกระทบ
  if (mirror) {
    y = -y;
    z = -z;
  }

  return { x, y, z };
}

export function useFaceBlendshapes(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options?: { mirror?: boolean },
) {
  const mirror = options?.mirror ?? true; // ให้ default ตรงกับ video ที่ scaleX(-1) อยู่แล้ว

  const [blendshapes, setBlendshapes] = useState<BlendshapeMap>({});
  const [headRotation, setHeadRotation] = useState<HeadRotation>({
    x: 0,
    y: 0,
    z: 0,
  });
  const [ready, setReady] = useState(false);
  const [faceFound, setFaceFound] = useState(false);

  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const mirrorRef = useRef(mirror);

  // อัปเดตค่า mirror ล่าสุดใน ref แบบ side-effect (ไม่แตะระหว่าง render)
  useEffect(() => {
    mirrorRef.current = mirror;
  }, [mirror]);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let lastVideoTime = -1;
    let lastTimestamp = 0;

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
        const timestamp = Math.max(
          lastTimestamp + 1,
          Math.round(performance.now()),
        );
        lastTimestamp = timestamp;

        const result: FaceLandmarkerResult = landmarker.detectForVideo(
          video,
          timestamp,
        );

        const shapes = result.faceBlendshapes?.[0]?.categories;
        setFaceFound(Boolean(shapes && shapes.length > 0));

        if (shapes) {
          const map: BlendshapeMap = {};
          for (const s of shapes) map[s.categoryName] = s.score;
          setBlendshapes(mirrorRef.current ? mirrorBlendshapes(map) : map);
        }

        const matrix = result.facialTransformationMatrixes?.[0]?.data;
        if (matrix) {
          setHeadRotation(matrixToEuler(matrix, mirrorRef.current));
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

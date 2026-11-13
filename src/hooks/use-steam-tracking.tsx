import { useEffect, useRef, useState } from "react";
import type {
  FaceMeshConstructorLocal,
  FaceResultsLocal,
  HandResultsLocal,
  Landmark,
} from "../interfaces/hand-tracking.interface";

import { FogGlass } from "../lib/fog-glass";
import { createTasksHands } from "../lib/hand-detector";
import {
  CAMERA_CONSTRAINTS,
  createHandIdTracker,
  mapToStage,
} from "../lib/stage";

declare const FaceMesh: FaceMeshConstructorLocal;

// Gestures (same as the foggy-glass project).
const PINCH_RATIO = 0.42; // thumb–index distance / palm length
const FIST_CURL_RATIO = 1.15;
const FIST_MIN_CURLED = 3;
/** Finger-line width (CSS px), nudged by how close the hand is. */
const BRUSH_SIZE = 18;
const MAX_JUMP = 220; // CSS px; bigger jumps start a new stroke
const SMOOTH = 0.55;

const MOUTH_OPEN_RATIO_THRESHOLD = 0.05;
const MOUTH_OPEN_RATIO_RELEASE = 0.035;

type Point = { x: number; y: number };

function dist(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Palm length in stage pixels (landmarks are stage-normalised). */
function palmPx(lm: Landmark[], w: number, h: number) {
  return Math.hypot((lm[0].x - lm[9].x) * w, (lm[0].y - lm[9].y) * h);
}

function isPinch(lm: Landmark[], w: number, h: number) {
  const gap = Math.hypot((lm[4].x - lm[8].x) * w, (lm[4].y - lm[8].y) * h);
  return gap < palmPx(lm, w, h) * PINCH_RATIO;
}

function isFist(lm: Landmark[]) {
  const tips = [8, 12, 16, 20];
  const mcps = [5, 9, 13, 17];
  let curled = 0;
  for (let i = 0; i < 4; i++) {
    const mcp = dist(lm[0], lm[mcps[i]]);
    if (mcp > 0 && dist(lm[0], lm[tips[i]]) / mcp < FIST_CURL_RATIO) curled++;
  }
  return curled >= FIST_MIN_CURLED;
}

export function useSteamHandTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const [status, setStatus] = useState("กำลังเริ่ม...");
  const [handCount, setHandCount] = useState(0);
  const [mouthOpen, setMouthOpen] = useState(false);
  const [isPinchingState, setIsPinchingState] = useState(false);

  const glassRef = useRef<FogGlass | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let glass: FogGlass;
    try {
      glass = new FogGlass(canvas);
    } catch (err) {
      const msg = `❌ Error: เบราว์เซอร์นี้ไม่รองรับ WebGL2 (${String(err)})`;
      queueMicrotask(() => setStatus(msg));
      return;
    }
    glassRef.current = glass;
    glass.setBackground({ kind: "video", el: video, mirror: true });

    const assignIds = createHandIdTracker();
    const prev = new Map<number, Point>();
    const smooth = new Map<number, Point>();
    let mouthIsOpen = false;

    // Two hands: a higher limit makes the model re-detect every frame.
    const hands = createTasksHands(2);
    hands.onResults((results: HandResultsLocal) => {
      // Stage size in CSS px (the glass works in CSS px).
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const landmarks = (results.multiHandLandmarks ?? []).map((lm) =>
        mapToStage(lm, video.videoWidth, video.videoHeight, w, h),
      );
      const ids = assignIds(landmarks);
      let anyPinch = false;
      const seen = new Set<number>();

      landmarks.forEach((lm, i) => {
        const id = ids[i];
        seen.add(id);
        const pinch = isPinch(lm, w, h);
        const fist = !pinch && isFist(lm);
        if (pinch) anyPinch = true;

        // pinch → between thumb & index tips; fist → palm centre
        const src = pinch
          ? { x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2 }
          : { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 };
        const raw = { x: (1 - src.x) * w, y: src.y * h };

        // light smoothing to remove jitter
        const s0 = smooth.get(id);
        const p = s0
          ? {
              x: s0.x + (raw.x - s0.x) * SMOOTH,
              y: s0.y + (raw.y - s0.y) * SMOOTH,
            }
          : raw;
        smooth.set(id, p);

        if (!pinch && !fist) {
          prev.delete(id);
          return;
        }
        const palm = palmPx(lm, w, h);
        const near = Math.min(1.25, Math.max(0.8, palm / 160));
        const size = pinch
          ? BRUSH_SIZE * near
          : Math.min(220, Math.max(60, palm * 1.4));

        const q = prev.get(id);
        if (q && Math.hypot(p.x - q.x, p.y - q.y) < MAX_JUMP) {
          glass.wipe(q.x, q.y, p.x, p.y, 0.5, size);
        } else {
          glass.wipe(p.x, p.y, p.x + 0.1, p.y + 0.1, 0.5, size);
        }
        prev.set(id, p);
      });

      for (const id of [...prev.keys()]) if (!seen.has(id)) prev.delete(id);
      for (const id of [...smooth.keys()]) if (!seen.has(id)) smooth.delete(id);

      setHandCount(landmarks.length);
      setIsPinchingState(anyPinch);
    });

    const faceMesh = new FaceMesh({
      locateFile: (f: string) => `/mediapipe/face_mesh/${f}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      // Only lip/brow/chin points are used; the refined iris/lip model
      // isn't needed and is costly on tablets.
      refineLandmarks: false,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults((results: FaceResultsLocal) => {
      const faces = results.multiFaceLandmarks ?? [];
      const lm = faces[0];
      if (!lm) {
        if (mouthIsOpen) {
          mouthIsOpen = false;
          glass.breathe(false);
          setMouthOpen(false);
        }
        return;
      }
      const upperLip = lm[13];
      const lowerLip = lm[14];
      const top = lm[10];
      const chin = lm[152];
      if (!upperLip || !lowerLip || !top || !chin) return;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const [mouth] = mapToStage(
        [
          {
            x: (upperLip.x + lowerLip.x) / 2,
            y: (upperLip.y + lowerLip.y) / 2,
          },
        ],
        video.videoWidth,
        video.videoHeight,
        w,
        h,
      );
      glass.moveBreath((1 - mouth.x) * w, mouth.y * h);

      const ratio = dist(upperLip, lowerLip) / (dist(top, chin) || 1);
      if (!mouthIsOpen && ratio > MOUTH_OPEN_RATIO_THRESHOLD) {
        mouthIsOpen = true;
        glass.breathe(true);
        setMouthOpen(true);
      } else if (mouthIsOpen && ratio < MOUTH_OPEN_RATIO_RELEASE) {
        mouthIsOpen = false;
        glass.breathe(false);
        setMouthOpen(false);
      }
    });

    let detectId = 0;
    let cancelled = false;
    let activeStream: MediaStream | null = null;

    let detectFrame = 0;
    const detectLoop = async () => {
      if (cancelled) return;
      detectFrame++;
      if (video.readyState === 4) {
        await hands.send({ image: video });
        // Mouth only needs ~15 checks/s: run the face model every other frame.
        if (detectFrame % 2 === 0) await faceMesh.send({ image: video });
      }
      if (cancelled) return;
      detectId = requestAnimationFrame(detectLoop);
    };

    navigator.mediaDevices
      .getUserMedia(CAMERA_CONSTRAINTS)
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        activeStream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video
            .play()
            .then(() => {
              setStatus("tracking...");
              detectLoop().catch(console.error);
            })
            .catch(console.error);
        };
      })
      .catch((err: Error) => {
        if (!cancelled) setStatus(`❌ Error: ${err.message}`);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(detectId);
      activeStream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.onloadedmetadata = null;
      hands.close().catch(() => {});
      faceMesh.close().catch(() => {});
      glass.dispose();
      glassRef.current = null;
    };
  }, [videoRef, canvasRef]);

  const clearFog = () => glassRef.current?.clearAll();
  const refogAll = () => glassRef.current?.refog();

  return {
    status,
    handCount,
    mouthOpen,
    isPinching: isPinchingState,
    clearFog,
    refogAll,
  };
}

import { useEffect, useRef, useState } from "react";
import type {
  FaceMeshConstructorLocal,
  FaceResultsLocal,
  HandResultsLocal,
  Landmark,
} from "../interfaces/hand-tracking.interface";

import { createTasksHands } from "../lib/hand-detector";
import {
  CAMERA_CONSTRAINTS,
  createHandIdTracker,
  drawVideoCover,
  mapToStage,
  resizeKeepingContent,
  syncCanvasToDisplay,
} from "../lib/stage";

declare const FaceMesh: FaceMeshConstructorLocal;

// Fog blur radius (CSS px). Applied with a CSS filter on its own canvas
// element: canvas `ctx.filter` is ignored by Safari, and scaling tricks
// look blocky there.
const BLUR_PX = 22;
// The fog canvas extends this far past each edge so the blur doesn't fade
// to transparent at the screen border.
const FOG_PAD = BLUR_PX * 2;

const WIPE_RADIUS = 18;
const WIPE_STRENGTH = 0.75;
const WIPE_STEP = Math.max(WIPE_RADIUS * 0.4, 4);
const MAX_INTERP_DIST = 140;
const PINCH_THRESHOLD = 0.05;

const FIST_WIPE_STRENGTH = 0.85;
const FIST_CURL_TIP_TO_MCP_RATIO = 1.15;
const FIST_MIN_CURLED_FINGERS = 3;

const FIST_RADIUS_FROM_PALM_FACTOR = 0.9;
const FIST_RADIUS_MIN = 24;
const FIST_RADIUS_MAX = 140;

const BREATH_MIN_RADIUS = 55;
const BREATH_MAX_RADIUS = 150;
const BREATH_RAMP_FRAMES = 20;
const BREATH_DECAY_PER_FRAME = 1;
const BREATH_STRENGTH_PER_FRAME = 0.1;

const MOUTH_OPEN_RATIO_THRESHOLD = 0.05;
const MOUTH_OPEN_RATIO_RELEASE = 0.035;

type Point = { x: number; y: number };

type FogComposite = "source-over" | "destination-out";

function dist(a: Landmark, b: Landmark) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function isPinching(lm: Landmark[]) {
  return dist(lm[4], lm[8]) < PINCH_THRESHOLD;
}

function isFist(lm: Landmark[]) {
  const wrist = lm[0];
  const tipIdx = [8, 12, 16, 20];
  const mcpIdx = [5, 9, 13, 17];

  let curled = 0;
  for (let i = 0; i < tipIdx.length; i++) {
    const tipDist = dist(wrist, lm[tipIdx[i]]);
    const mcpDist = dist(wrist, lm[mcpIdx[i]]);
    if (mcpDist <= 0) continue;
    if (tipDist / mcpDist < FIST_CURL_TIP_TO_MCP_RATIO) curled++;
  }
  return curled >= FIST_MIN_CURLED_FINGERS;
}

function measureFistRadiusPx(lm: Landmark[], w: number, h: number) {
  const wrist = lm[0];
  const indexMcp = lm[5];
  const pinkyMcp = lm[17];
  const middleMcp = lm[9];

  const toPx = (p: Landmark) => ({ x: p.x * w, y: p.y * h });
  const wristPx = toPx(wrist);
  const indexPx = toPx(indexMcp);
  const pinkyPx = toPx(pinkyMcp);
  const middlePx = toPx(middleMcp);

  const knuckleSpan = Math.hypot(indexPx.x - pinkyPx.x, indexPx.y - pinkyPx.y);
  const palmLength = Math.hypot(wristPx.x - middlePx.x, wristPx.y - middlePx.y);

  const palmSize = (knuckleSpan + palmLength) / 2;
  const radius = palmSize * FIST_RADIUS_FROM_PALM_FACTOR;

  return Math.min(FIST_RADIUS_MAX, Math.max(FIST_RADIUS_MIN, radius));
}

function drawMirroredVideo(
  targetCtx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement,
  w: number,
  h: number,
) {
  drawVideoCover(
    targetCtx,
    videoEl,
    videoEl.videoWidth,
    videoEl.videoHeight,
    w,
    h,
  );
}

function paintFogStamp(
  maskCtx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  strength: number,
  composite: FogComposite,
) {
  maskCtx.save();
  maskCtx.globalCompositeOperation = composite;
  const grad = maskCtx.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, `rgba(255,255,255,${strength})`);
  grad.addColorStop(1, "rgba(255,255,255,0)");
  maskCtx.fillStyle = grad;
  maskCtx.beginPath();
  maskCtx.arc(x, y, radius, 0, Math.PI * 2);
  maskCtx.fill();
  maskCtx.restore();
}

export function useSteamHandTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const [status, setStatus] = useState("กำลังเริ่ม...");
  const [handCount, setHandCount] = useState(0);
  const [mouthOpen, setMouthOpen] = useState(false);
  const [isPinchingState, setIsPinchingState] = useState(false);

  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const fogLayerCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const prevTipsRef = useRef(new Map<number, Point>());

  const mouthOpenRef = useRef(false);
  const mouthPosRef = useRef<Point | null>(null);
  const breathRampRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    syncCanvasToDisplay(canvas);

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    maskCanvasRef.current = maskCanvas;

    // Visible fog layer: sharp video × mask, blurred by the browser's CSS
    // filter (smooth in every browser, GPU-accelerated).
    const fogLayerCanvas = document.createElement("canvas");
    fogLayerCanvas.width = canvas.width + FOG_PAD * 2;
    fogLayerCanvas.height = canvas.height + FOG_PAD * 2;
    Object.assign(fogLayerCanvas.style, {
      position: "absolute",
      left: `${-FOG_PAD}px`,
      top: `${-FOG_PAD}px`,
      width: `calc(100% + ${FOG_PAD * 2}px)`,
      height: `calc(100% + ${FOG_PAD * 2}px)`,
      filter: `blur(${BLUR_PX}px)`,
      pointerEvents: "none",
    });
    canvas.insertAdjacentElement("afterend", fogLayerCanvas);
    fogLayerCanvasRef.current = fogLayerCanvas;

    // Mask padded to the fog canvas size (edges stretched into the pad).
    const paddedMask = document.createElement("canvas");

    const assignIds = createHandIdTracker();

    // Two hands: a higher limit makes the model re-detect every frame.
    const hands = createTasksHands(2);
    hands.onResults((results: HandResultsLocal) => {
      const w = canvas.width;
      const h = canvas.height;
      const landmarks = (results.multiHandLandmarks ?? []).map((lm) =>
        mapToStage(lm, video.videoWidth, video.videoHeight, w, h),
      );
      const ids = assignIds(landmarks);
      const maskCtx = maskCanvas.getContext("2d");

      const nextPrevTips = new Map<number, Point>();
      let anyPinching = false;

      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        const pinching = isPinching(lm);
        const fist = !pinching && isFist(lm);

        if (!pinching && !fist) continue;

        if (pinching) anyPinching = true;

        const tip = pinching ? lm[8] : lm[9];

        const x = (1 - tip.x) * w;
        const y = tip.y * h;

        const radius = pinching ? WIPE_RADIUS : measureFistRadiusPx(lm, w, h);
        const strength = pinching ? WIPE_STRENGTH : FIST_WIPE_STRENGTH;
        const step = pinching ? WIPE_STEP : Math.max(radius * 0.4, 4);

        if (maskCtx) {
          const prev = prevTipsRef.current.get(ids[i]);
          const segDist = prev ? Math.hypot(x - prev.x, y - prev.y) : Infinity;

          if (prev && segDist <= MAX_INTERP_DIST) {
            const steps = Math.max(1, Math.ceil(segDist / step));
            for (let s = 1; s <= steps; s++) {
              const t = s / steps;
              paintFogStamp(
                maskCtx,
                prev.x + (x - prev.x) * t,
                prev.y + (y - prev.y) * t,
                radius,
                strength,
                "destination-out",
              );
            }
          } else {
            paintFogStamp(maskCtx, x, y, radius, strength, "destination-out");
          }
        }

        nextPrevTips.set(ids[i], { x, y });
      }

      prevTipsRef.current = nextPrevTips;
      setHandCount(landmarks.length);
      setIsPinchingState(anyPinching);
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
      if (faces.length === 0) return;
      const lm = faces[0];
      const upperLip = lm[13];
      const lowerLip = lm[14];
      const top = lm[10];
      const chin = lm[152];
      if (!upperLip || !lowerLip || !top || !chin) return;

      const w = canvas.width;
      const h = canvas.height;
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
      const mouthCenterX = mouth.x;
      const mouthCenterY = mouth.y;

      mouthPosRef.current = { x: (1 - mouthCenterX) * w, y: mouthCenterY * h };

      const mouthDist = dist(upperLip, lowerLip);
      const faceHeight = dist(top, chin) || 1;
      const ratio = mouthDist / faceHeight;

      if (!mouthOpenRef.current && ratio > MOUTH_OPEN_RATIO_THRESHOLD) {
        mouthOpenRef.current = true;
        setMouthOpen(true);
      } else if (mouthOpenRef.current && ratio < MOUTH_OPEN_RATIO_RELEASE) {
        mouthOpenRef.current = false;
        setMouthOpen(false);
      }
    });

    let animId: number;
    let detectId: number;
    let cancelled = false;
    let activeStream: MediaStream | null = null;

    const renderLoop = () => {
      if (cancelled) return;

      syncCanvasToDisplay(canvas);
      const w = canvas.width;
      const h = canvas.height;

      resizeKeepingContent(maskCanvas, w, h);
      const fw = w + FOG_PAD * 2;
      const fh = h + FOG_PAD * 2;
      if (fogLayerCanvas.width !== fw || fogLayerCanvas.height !== fh) {
        fogLayerCanvas.width = fw;
        fogLayerCanvas.height = fh;
      }
      if (paddedMask.width !== fw || paddedMask.height !== fh) {
        paddedMask.width = fw;
        paddedMask.height = fh;
      }

      const maskCtx = maskCanvas.getContext("2d");

      if (mouthOpenRef.current) {
        breathRampRef.current = Math.min(
          breathRampRef.current + 1,
          BREATH_RAMP_FRAMES,
        );
      } else {
        breathRampRef.current = Math.max(
          breathRampRef.current - BREATH_DECAY_PER_FRAME,
          0,
        );
      }

      if (maskCtx && mouthOpenRef.current && mouthPosRef.current) {
        const t = breathRampRef.current / BREATH_RAMP_FRAMES;
        const radius =
          BREATH_MIN_RADIUS + (BREATH_MAX_RADIUS - BREATH_MIN_RADIUS) * t;
        paintFogStamp(
          maskCtx,
          mouthPosRef.current.x,
          mouthPosRef.current.y,
          radius,
          BREATH_STRENGTH_PER_FRAME,
          "source-over",
        );
      }

      const fogCtx = fogLayerCanvas.getContext("2d");
      const pmCtx = paddedMask.getContext("2d");
      if (fogCtx && pmCtx) {
        // Padded mask: stretched copy for the off-screen border, exact
        // copy where it's visible.
        pmCtx.clearRect(0, 0, fw, fh);
        pmCtx.drawImage(maskCanvas, 0, 0, fw, fh);
        pmCtx.clearRect(FOG_PAD, FOG_PAD, w, h);
        pmCtx.drawImage(maskCanvas, FOG_PAD, FOG_PAD);

        fogCtx.globalCompositeOperation = "source-over";
        fogCtx.clearRect(0, 0, fw, fh);
        // Stretched video for the border, exact video in the visible area.
        drawMirroredVideo(fogCtx, video, fw, fh);
        fogCtx.save();
        fogCtx.translate(FOG_PAD, FOG_PAD);
        fogCtx.beginPath();
        fogCtx.rect(0, 0, w, h);
        fogCtx.clip();
        drawMirroredVideo(fogCtx, video, w, h);
        fogCtx.restore();
        fogCtx.globalCompositeOperation = "destination-in";
        fogCtx.drawImage(paddedMask, 0, 0);
        fogCtx.globalCompositeOperation = "source-over";
      }

      ctx.clearRect(0, 0, w, h);
      drawMirroredVideo(ctx, video, w, h);

      animId = requestAnimationFrame(renderLoop);
    };

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
              renderLoop();
            })
            .catch(console.error);
        };
      })
      .catch((err: Error) => {
        if (!cancelled) setStatus(`❌ Error: ${err.message}`);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
      cancelAnimationFrame(detectId);
      activeStream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.onloadedmetadata = null;
      hands.close().catch(() => {});
      faceMesh.close().catch(() => {});
      fogLayerCanvas.remove();
    };
  }, [videoRef, canvasRef]);

  const clearFog = () => {
    const mc = maskCanvasRef.current;
    if (mc) mc.getContext("2d")?.clearRect(0, 0, mc.width, mc.height);
  };

  const refogAll = () => {
    const mc = maskCanvasRef.current;
    const mctx = mc?.getContext("2d");
    if (mc && mctx) {
      mctx.save();
      mctx.globalCompositeOperation = "source-over";
      mctx.fillStyle = "rgba(255,255,255,1)";
      mctx.fillRect(0, 0, mc.width, mc.height);
      mctx.restore();
    }
  };

  return {
    status,
    handCount,
    mouthOpen,
    isPinching: isPinchingState,
    clearFog,
    refogAll,
  };
}

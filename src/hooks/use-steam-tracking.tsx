import { useEffect, useRef, useState } from "react";
import type {
  FaceMeshConstructorLocal,
  FaceResultsLocal,
  HandResultsLocal,
  HandsConstructorLocal,
  Landmark,
} from "../interfaces/hand-tracking.interface";

declare const Hands: HandsConstructorLocal;
declare const FaceMesh: FaceMeshConstructorLocal;

const BLUR_PX = 22;

const WIPE_RADIUS = 18;
const WIPE_STRENGTH = 0.75;
const WIPE_STEP = Math.max(WIPE_RADIUS * 0.4, 4);
const MAX_INTERP_DIST = 140;
const PINCH_THRESHOLD = 0.05;

const BREATH_MIN_RADIUS = 55;
const BREATH_MAX_RADIUS = 200;
const BREATH_RAMP_FRAMES = 20;
const BREATH_DECAY_PER_FRAME = 1;
const BREATH_STRENGTH_PER_FRAME = 0.13;

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

function drawMirroredVideo(
  targetCtx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement,
  w: number,
  h: number,
  blurPx: number,
) {
  const pad = blurPx > 0 ? Math.ceil(blurPx * 1.5) : 0;

  targetCtx.save();
  if (blurPx > 0) targetCtx.filter = `blur(${blurPx}px)`;
  targetCtx.scale(-1, 1);
  targetCtx.drawImage(videoEl, -w - pad, -pad, w + pad * 2, h + pad * 2);
  targetCtx.restore();
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

  const prevTipsRef = useRef<(Point | null)[]>([]);

  const mouthOpenRef = useRef(false);
  const mouthPosRef = useRef<Point | null>(null);
  const breathRampRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 720;
    canvas.height = 560;

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = 720;
    maskCanvas.height = 560;
    maskCanvasRef.current = maskCanvas;

    const fogLayerCanvas = document.createElement("canvas");
    fogLayerCanvas.width = 720;
    fogLayerCanvas.height = 560;
    fogLayerCanvasRef.current = fogLayerCanvas;

    const hands = new Hands({
      locateFile: (f: string) => `/mediapipe/hands/${f}`,
    });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });
    hands.onResults((results: HandResultsLocal) => {
      const landmarks = results.multiHandLandmarks ?? [];
      const w = video.videoWidth || 720;
      const h = video.videoHeight || 560;
      const maskCtx = maskCanvas.getContext("2d");

      const nextPrevTips: (Point | null)[] = [];
      let anyPinching = false;

      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        const pinching = isPinching(lm);

        if (!pinching) {
          nextPrevTips[i] = null;
          continue;
        }

        anyPinching = true;

        const tip = lm[8];

        const x = (1 - tip.x) * w;
        const y = tip.y * h;

        if (maskCtx) {
          const prev = prevTipsRef.current[i];
          const segDist = prev ? Math.hypot(x - prev.x, y - prev.y) : Infinity;

          if (prev && segDist <= MAX_INTERP_DIST) {
            const steps = Math.max(1, Math.ceil(segDist / WIPE_STEP));
            for (let s = 1; s <= steps; s++) {
              const t = s / steps;
              paintFogStamp(
                maskCtx,
                prev.x + (x - prev.x) * t,
                prev.y + (y - prev.y) * t,
                WIPE_RADIUS,
                WIPE_STRENGTH,
                "destination-out",
              );
            }
          } else {
            paintFogStamp(
              maskCtx,
              x,
              y,
              WIPE_RADIUS,
              WIPE_STRENGTH,
              "destination-out",
            );
          }
        }

        nextPrevTips[i] = { x, y };
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
      refineLandmarks: true,
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

      const w = video.videoWidth || 720;
      const h = video.videoHeight || 560;
      const mouthCenterX = (upperLip.x + lowerLip.x) / 2;
      const mouthCenterY = (upperLip.y + lowerLip.y) / 2;

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

      const w = video.videoWidth || 720;
      const h = video.videoHeight || 560;

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      if (maskCanvas.width !== w || maskCanvas.height !== h) {
        maskCanvas.width = w;
        maskCanvas.height = h;
      }
      if (fogLayerCanvas.width !== w || fogLayerCanvas.height !== h) {
        fogLayerCanvas.width = w;
        fogLayerCanvas.height = h;
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
      if (fogCtx) {
        fogCtx.clearRect(0, 0, w, h);
        drawMirroredVideo(fogCtx, video, w, h, BLUR_PX);
        fogCtx.globalCompositeOperation = "destination-in";
        fogCtx.drawImage(maskCanvas, 0, 0, w, h);
        fogCtx.globalCompositeOperation = "source-over";
      }

      ctx.clearRect(0, 0, w, h);
      drawMirroredVideo(ctx, video, w, h, 0);
      ctx.drawImage(fogLayerCanvas, 0, 0, w, h);

      animId = requestAnimationFrame(renderLoop);
    };

    const detectLoop = async () => {
      if (cancelled) return;
      if (video.readyState === 4) {
        await hands.send({ image: video });
        await faceMesh.send({ image: video });
      }
      if (cancelled) return;
      detectId = requestAnimationFrame(detectLoop);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { width: 720, height: 560 } })
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

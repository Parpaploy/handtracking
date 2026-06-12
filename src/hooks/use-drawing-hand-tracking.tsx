import { useEffect, useRef, useState } from "react";
import type {
  HandResults,
  HandsConstructor,
  Landmark,
  DrawMode,
} from "../interfaces/hand-tracking.interface";

declare const Hands: HandsConstructor;

const CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
];

const FINGERTIPS = [4, 8, 12, 16, 20];
const PINCH_THRESHOLD = 0.05;
const SMOOTH_FACTOR = 0.35;
const PINCH_GRACE_FRAMES = 5;

const PALETTE_COLORS = [
  // "#FF6B6B",
  // "#FF9F43",
  // "#FFEAA7",
  // "#55EFC4",
  // "#00CEC9",
  // "#74B9FF",
  // "#A29BFE",
  // "#FD79A8",
  // "#FFFFFF",

  "#000000",
  "#FFFFFF",
  "#FF4D4D",
  "#FF9900",
  "#FFE600",
  "#4DFF91",
  "#4DC8FF",
  "#B44DFF",
  "#FF4DB8",
];
const SWATCH_SIZE = 36;
const SWATCH_GAP = 10;
const PALETTE_Y_OFFSET = 12;

function getPaletteRects(canvasW: number, canvasH: number) {
  const totalW =
    PALETTE_COLORS.length * (SWATCH_SIZE + SWATCH_GAP) - SWATCH_GAP;
  const startX = (canvasW - totalW) / 2;
  const y = canvasH - SWATCH_SIZE - PALETTE_Y_OFFSET;
  return PALETTE_COLORS.map((color, i) => ({
    x: startX + i * (SWATCH_SIZE + SWATCH_GAP),
    y,
    w: SWATCH_SIZE,
    h: SWATCH_SIZE,
    color,
  }));
}

function getHoveredSwatch(
  px: number,
  py: number,
  canvasW: number,
  canvasH: number,
): number {
  for (let i = 0; i < PALETTE_COLORS.length; i++) {
    const { x, y, w, h } = getPaletteRects(canvasW, canvasH)[i];
    if (px >= x - 6 && px <= x + w + 6 && py >= y - 6 && py <= y + h + 6)
      return i;
  }
  return -1;
}

function drawPalette(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  hoveredIdx: number,
  currentColor: string,
) {
  const rects = getPaletteRects(canvasW, canvasH);
  const totalW =
    PALETTE_COLORS.length * (SWATCH_SIZE + SWATCH_GAP) - SWATCH_GAP;
  const stripX = (canvasW - totalW) / 2 - 14;
  const stripY = canvasH - SWATCH_SIZE - PALETTE_Y_OFFSET - 12;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.rect(stripX, stripY, totalW + 28, SWATCH_SIZE + 24);
  ctx.fill();
  ctx.restore();

  rects.forEach(({ x, y, w, h, color }, i) => {
    const isHovered = i === hoveredIdx;
    const isActive = color === currentColor;

    if (isHovered) {
      ctx.save();
      ctx.fillStyle = color + "44";
      ctx.beginPath();
      ctx.rect(x - 5, y - 5, w + 10, h + 10);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.strokeStyle = isHovered || isActive ? "#fff" : "rgba(255,255,255,0.2)";
    ctx.lineWidth = isHovered ? 3 : isActive ? 2 : 0.5;
    ctx.stroke();
    ctx.restore();

    if (isActive) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + w / 2, y - 9, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.restore();
    }
  });
}

function dist(a: Landmark, b: Landmark) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function isPinching(lm: Landmark[]) {
  return dist(lm[4], lm[8]) < PINCH_THRESHOLD;
}

function drawHand(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[],
  w: number,
  h: number,
) {
  const x = (i: number) => lm[i].x * w;
  const y = (i: number) => lm[i].y * h;
  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(x(a), y(a));
    ctx.lineTo(x(b), y(b));
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  for (let i = 0; i < lm.length; i++) {
    ctx.beginPath();
    ctx.arc(x(i), y(i), FINGERTIPS.includes(i) ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }
}

export function useDrawingHandTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const [status, setStatus] = useState("กำลังเริ่ม...");
  const [handCount, setHandCount] = useState(0);
  const [drawMode, setDrawMode] = useState<DrawMode>("idle");
  const [strokeColor, setStrokeColor] = useState("#000000");

  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const smoothedPointRef = useRef<{ x: number; y: number } | null>(null);
  const pinchGraceRef = useRef(0);
  const strokeColorRef = useRef("#000000");
  const pinchLockedRef = useRef(false);

  useEffect(() => {
    strokeColorRef.current = strokeColor;
  }, [strokeColor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drawingCanvas = document.createElement("canvas");
    drawingCanvas.width = 720;
    drawingCanvas.height = 560;
    Object.assign(drawingCanvas.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
    });
    canvas.parentElement?.appendChild(drawingCanvas);
    drawingCanvasRef.current = drawingCanvas;
    return () => {
      drawingCanvas.remove();
    };
  }, [canvasRef]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 720;
    canvas.height = 560;

    const hands = new Hands({
      locateFile: (f: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
    });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });

    hands.onResults((results: HandResults) => {
      const w = video.videoWidth || 720;
      const h = video.videoHeight || 560;

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const drawingCanvas = drawingCanvasRef.current;
      if (
        drawingCanvas &&
        (drawingCanvas.width !== w || drawingCanvas.height !== h)
      ) {
        const temp = document.createElement("canvas");
        temp.width = drawingCanvas.width;
        temp.height = drawingCanvas.height;
        temp.getContext("2d")?.drawImage(drawingCanvas, 0, 0);
        drawingCanvas.width = w;
        drawingCanvas.height = h;
        drawingCanvas.getContext("2d")?.drawImage(temp, 0, 0);
      }

      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(results.image, -w, 0, w, h);
      ctx.restore();

      if (drawingCanvas) ctx.drawImage(drawingCanvas, 0, 0);

      const landmarks = results.multiHandLandmarks ?? [];
      const handedness = results.multiHandedness ?? [];
      const drawingCtx = drawingCanvas?.getContext("2d") ?? null;

      let currentMode: DrawMode = "idle";
      let leftHandFound = false;
      let globalHoveredIdx = -1;

      for (let hi = 0; hi < landmarks.length; hi++) {
        const lm = landmarks[hi];
        const label = handedness[hi]?.label ?? "Right";
        const m = lm.map((p) => ({ ...p, x: 1 - p.x }));

        drawHand(ctx, m, w, h);

        const pinching = isPinching(m);
        const midX = ((m[4].x + m[8].x) / 2) * w;
        const midY = ((m[4].y + m[8].y) / 2) * h;
        const tipX = m[8].x * w;
        const tipY = m[8].y * h;

        if (label === "Left") {
          leftHandFound = true;

          const swatchIdx = getHoveredSwatch(midX, midY, w, h);
          if (swatchIdx !== -1) globalHoveredIdx = swatchIdx;

          if (pinching) {
            if (!pinchLockedRef.current) {
              if (swatchIdx !== -1) {
                pinchLockedRef.current = true;
                strokeColorRef.current = PALETTE_COLORS[swatchIdx];
                setStrokeColor(PALETTE_COLORS[swatchIdx]);
                lastPointRef.current = null;
                smoothedPointRef.current = null;
              }
            }

            if (swatchIdx === -1 && drawingCtx) {
              pinchGraceRef.current = 0;
              currentMode = "draw";

              if (!smoothedPointRef.current) {
                smoothedPointRef.current = { x: midX, y: midY };
              } else {
                smoothedPointRef.current = {
                  x:
                    smoothedPointRef.current.x +
                    (midX - smoothedPointRef.current.x) * SMOOTH_FACTOR,
                  y:
                    smoothedPointRef.current.y +
                    (midY - smoothedPointRef.current.y) * SMOOTH_FACTOR,
                };
              }
              const sx = smoothedPointRef.current.x;
              const sy = smoothedPointRef.current.y;

              drawingCtx.globalCompositeOperation = "source-over";
              drawingCtx.strokeStyle = strokeColorRef.current;
              drawingCtx.lineWidth = 3;
              drawingCtx.lineCap = "round";
              drawingCtx.lineJoin = "round";

              if (lastPointRef.current) {
                drawingCtx.beginPath();
                drawingCtx.moveTo(
                  lastPointRef.current.x,
                  lastPointRef.current.y,
                );
                drawingCtx.lineTo(sx, sy);
                drawingCtx.stroke();
              }
              lastPointRef.current = { x: sx, y: sy };

              ctx.beginPath();
              ctx.arc(sx, sy, 8, 0, Math.PI * 2);
              ctx.fillStyle = strokeColorRef.current;
              ctx.globalAlpha = 0.8;
              ctx.fill();
              ctx.globalAlpha = 1;
            }
          } else {
            pinchLockedRef.current = false;
            pinchGraceRef.current += 1;
            if (pinchGraceRef.current > PINCH_GRACE_FRAMES) {
              lastPointRef.current = null;
              smoothedPointRef.current = null;
              pinchGraceRef.current = 0;
            }
          }
        }

        if (label === "Right" && pinching && drawingCtx) {
          currentMode = "erase";
          drawingCtx.globalCompositeOperation = "destination-out";
          drawingCtx.beginPath();
          drawingCtx.arc(tipX, tipY, 24, 0, Math.PI * 2);
          drawingCtx.fillStyle = "rgba(0,0,0,1)";
          drawingCtx.fill();
          ctx.beginPath();
          ctx.arc(tipX, tipY, 24, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255,100,100,0.8)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      if (!leftHandFound) {
        pinchGraceRef.current += 1;
        if (pinchGraceRef.current > PINCH_GRACE_FRAMES) {
          lastPointRef.current = null;
          smoothedPointRef.current = null;
          pinchGraceRef.current = 0;
        }
      }

      if (landmarks.length === 0) currentMode = "idle";

      drawPalette(ctx, w, h, globalHoveredIdx, strokeColorRef.current);

      setHandCount(landmarks.length);
      setDrawMode(currentMode);
      setStatus("tracking...");
    });

    let animId: number;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 720, height: 560 } })
      .then((stream) => {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video
            .play()
            .then(() => {
              const loop = async () => {
                if (video.readyState === 4) await hands.send({ image: video });
                animId = requestAnimationFrame(loop);
              };
              loop().catch(console.error);
            })
            .catch(console.error);
        };
      })
      .catch((err: Error) => {
        setStatus(`❌ Error: ${err.message}`);
      });

    return () => {
      cancelAnimationFrame(animId);
      (video.srcObject as MediaStream)?.getTracks().forEach((t) => t.stop());
    };
  }, [videoRef, canvasRef]);

  const clearDrawing = () => {
    const dc = drawingCanvasRef.current;
    if (dc) dc.getContext("2d")?.clearRect(0, 0, dc.width, dc.height);
  };

  return {
    status,
    handCount,
    drawMode,
    clearDrawing,
    strokeColor,
    setStrokeColor,
  };
}

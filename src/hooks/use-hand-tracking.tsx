import { useEffect, useState } from "react";
import type {
  HandResults,
  HandsConstructor,
  Landmark,
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
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  for (let i = 0; i < lm.length; i++) {
    const isTip = FINGERTIPS.includes(i);
    const radius = isTip ? 4 : 2.5;

    ctx.beginPath();
    ctx.arc(x(i), y(i), radius, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }
}

export function useHandTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const [status, setStatus] = useState("กำลังเริ่ม...");
  const [handCount, setHandCount] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 640;
    canvas.height = 480;

    const hands = new Hands({
      locateFile: (f: string) =>
        `/mediapipe/hands/${f}`,
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });

    hands.onResults((results: HandResults) => {
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(results.image, -w, 0, w, h);
      ctx.restore();

      for (const lm of results.multiHandLandmarks ?? []) {
        const mirroredLm = lm.map((p) => ({
          ...p,
          x: 1 - p.x,
        }));

        drawHand(ctx, mirroredLm, w, h);
      }

      setHandCount(results.multiHandLandmarks?.length ?? 0);
      setStatus("tracking...");
    });

    let animId: number;
    let cancelled = false;
    let activeStream: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480 } })
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
              const loop = async () => {
                if (cancelled) return;
                if (video.readyState === 4) {
                  await hands.send({ image: video });
                }
                if (cancelled) return;
                animId = requestAnimationFrame(loop);
              };
              loop().catch(console.error);
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
      activeStream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.onloadedmetadata = null;
      hands.close().catch(() => {});
    };
  }, [videoRef, canvasRef]);

  return { status, handCount };
}

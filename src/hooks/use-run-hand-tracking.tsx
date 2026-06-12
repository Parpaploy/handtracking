import { useEffect, useRef, useState } from "react";
import type {
  HandResults,
  HandsConstructor,
  Landmark,
} from "../interfaces/hand-tracking.interface";

declare const Hands: HandsConstructor;

const FINGER_LABELS = ["ซอล", "โด", "เร", "มี", "ฟา"];

const FINGERTIP_IDX = [4, 8, 12, 16, 20];
const FINGERBASE_IDX = [2, 6, 10, 14, 18];
const PRESS_THRESHOLD = 0.045;
const THUMB_PRESS_THRESHOLD = 0.04;

const RUNNER_GOAL = 1.0;
const RUNNER_FIST_MIN_FINGERS = 3;
const RUNNER_ACCEL = 0.002;
const RUNNER_DECEL = 0.92;

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

function isFist(lm: Landmark[]): boolean {
  const tips = [8, 12, 16, 20];
  const bases = [5, 9, 13, 17];
  let curled = 0;
  for (let i = 0; i < 4; i++) {
    if (lm[tips[i]].y > lm[bases[i]].y) curled++;
  }
  return curled >= RUNNER_FIST_MIN_FINGERS;
}

function drawHandSkeleton(
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
    ctx.arc(x(i), y(i), FINGERTIP_IDX.includes(i) ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }
}

function drawFistIndicator(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[],
  fist: boolean,
  handColor: string,
  w: number,
  h: number,
) {
  const wx = lm[0].x * w;
  const wy = Math.max(26, lm[0].y * h - 44);
  const r = fist ? 18 : 13;
  ctx.save();
  ctx.beginPath();
  ctx.arc(wx, wy, r, 0, Math.PI * 2);
  ctx.fillStyle = fist
    ? handColor === "orange"
      ? "rgba(255,140,0,0.3)"
      : "rgba(0,200,255,0.3)"
    : "rgba(255,255,255,0.05)";
  ctx.fill();
  ctx.strokeStyle = fist
    ? handColor === "orange"
      ? "rgba(255,180,0,0.9)"
      : "rgba(0,230,255,0.9)"
    : "rgba(255,255,255,0.2)";
  ctx.lineWidth = fist ? 2 : 1;
  ctx.stroke();
  ctx.font = "12px sans-serif";
  ctx.fillStyle = fist ? "#fff" : "rgba(255,255,255,0.3)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(fist ? "✊" : "🖐", wx, wy);
  ctx.restore();
}

export function useRunHandTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const [status, setStatus] = useState("กำลังเริ่ม...");
  const [handCount, setHandCount] = useState(0);
  const [activeFigerNames, setActiveFigerNames] = useState<string[]>([]);

  const prevPressed = useRef(new Set<string>());

  const runnerPosRef = useRef(0);
  const runnerSpeedRef = useRef(0);
  const runnerWonRef = useRef(false);
  const lastWristYs = useRef<[number | null, number | null]>([null, null]);

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
      const w = canvas.width;
      const h = canvas.height;

      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(results.image, -w, 0, w, h);
      ctx.restore();

      const landmarks = results.multiHandLandmarks ?? [];
      const handedness = results.multiHandedness ?? [];

      const newPressed = new Set<string>();
      const fingerNames: string[] = [];

      let totalShake = 0;
      let fistCount = 0;

      for (let hi = 0; hi < landmarks.length; hi++) {
        const lm = landmarks[hi];
        const label = handedness[hi]?.label ?? "Right";

        const m: Landmark[] = lm.map((p) => ({ ...p, x: 1 - p.x }));

        const isLeft = label === "Left";
        const handColor = isLeft ? "orange" : "cyan";
        const handIdx = isLeft ? 0 : 1;

        drawHandSkeleton(ctx, m, w, h);

        const fist = isFist(m);
        drawFistIndicator(ctx, m, fist, handColor, w, h);

        if (fist) {
          fistCount++;
          const wy = m[0].y;
          const prev = lastWristYs.current[handIdx];
          if (prev !== null) {
            const dy = Math.abs(wy - prev);
            totalShake += dy * 55;
          }
          lastWristYs.current[handIdx] = wy;
        } else {
          lastWristYs.current[handIdx] = null;
        }

        for (let fi = 0; fi < 5; fi++) {
          const tipIdx = FINGERTIP_IDX[fi];
          const baseIdx = FINGERBASE_IDX[fi];
          const tip = m[tipIdx];
          const base = m[baseIdx];

          let pressed: boolean;
          if (fi === 0) {
            pressed = isLeft
              ? tip.x - base.x > THUMB_PRESS_THRESHOLD
              : base.x - tip.x > THUMB_PRESS_THRESHOLD;
          } else {
            pressed = tip.y - base.y > PRESS_THRESHOLD;
          }

          if (pressed) {
            const noteKey = `${label}_${fi}`;
            newPressed.add(noteKey);
            fingerNames.push(FINGER_LABELS[fi]);
          }
        }
      }

      if (!runnerWonRef.current) {
        if (fistCount >= 2 && totalShake > 0.3) {
          const gain = Math.min(totalShake * 1.2, 6);

          runnerSpeedRef.current = Math.min(
            runnerSpeedRef.current + gain * 0.04,
            1,
          );

          runnerPosRef.current = Math.min(
            runnerPosRef.current + gain * RUNNER_ACCEL,
            RUNNER_GOAL,
          );
        } else {
          runnerSpeedRef.current *= RUNNER_DECEL;
          if (runnerSpeedRef.current < 0.01) runnerSpeedRef.current = 0;
        }

        if (runnerPosRef.current >= RUNNER_GOAL) {
          runnerWonRef.current = true;
          setTimeout(() => {
            runnerPosRef.current = 0;
            runnerSpeedRef.current = 0;
            runnerWonRef.current = false;
          }, 5000);
        }
      }

      prevPressed.current = newPressed;

      setHandCount(landmarks.length);
      setActiveFigerNames([...new Set(fingerNames)]);
      setStatus("tracking...");
    });

    let animId: number;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480 } })
      .then((stream) => {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video.play().then(() => {
            const loop = async () => {
              if (video.readyState === 4) await hands.send({ image: video });
              animId = requestAnimationFrame(loop);
            };
            loop().catch(console.error);
          });
        };
      })
      .catch((err: Error) => setStatus(`❌ ${err.message}`));

    return () => {
      cancelAnimationFrame(animId);
      (video.srcObject as MediaStream)?.getTracks().forEach((t) => t.stop());
    };
  }, [videoRef, canvasRef]);

  return {
    status,
    handCount,
    activeFigerNames,
    runnerPosRef,
    runnerSpeedRef,
    runnerWonRef,
  };
}

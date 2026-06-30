import { useEffect, useState } from "react";
import type {
  FaceMeshConstructorLocal,
  FaceResultsLocal,
  HandResults,
  HandsConstructor,
  Landmark,
} from "../interfaces/hand-tracking.interface";

declare const Hands: HandsConstructor;
declare const FaceMesh: FaceMeshConstructorLocal;

export type Emotion = "neutral" | "happy" | "surprised" | "sad" | "angry";

const EMOTION_LABEL: Record<Emotion, string> = {
  neutral: "Neutral",
  happy: "Happy",
  surprised: "Surprised",
  sad: "Sad",
  angry: "Angry",
};

// Box/tag color per emotion (teal-style like the reference UI, with variation)
const EMOTION_COLOR: Record<Emotion, string> = {
  neutral: "#cfcfcf",
  happy: "#fcba03",
  surprised: "#fc6f03",
  sad: "#1d57a3",
  angry: "#d11f1f",
};

function dist(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

type RawMetrics = {
  mouthOpen: number;
  mouthWidth: number;
  cornerLiftNorm: number;
  browRaise: number;
  browGap: number;
  eyeOpen: number;
};

function computeMetrics(lm: Landmark[]): RawMetrics | null {
  const leftEyeCenter = {
    x: (lm[33].x + lm[133].x) / 2,
    y: (lm[33].y + lm[133].y) / 2,
  } as Landmark;
  const rightEyeCenter = {
    x: (lm[362].x + lm[263].x) / 2,
    y: (lm[362].y + lm[263].y) / 2,
  } as Landmark;
  const norm = dist(leftEyeCenter, rightEyeCenter);
  if (norm === 0) return null;

  const mouthOpen = dist(lm[13], lm[14]) / norm;
  const mouthWidth = dist(lm[61], lm[291]) / norm;
  const mouthCenterY = (lm[13].y + lm[14].y) / 2;
  const cornerLiftNorm = (mouthCenterY - (lm[61].y + lm[291].y) / 2) / norm;

  const browRaiseL = dist(lm[105], lm[159]) / norm;
  const browRaiseR = dist(lm[334], lm[386]) / norm;
  const browRaise = (browRaiseL + browRaiseR) / 2;

  const browGap = dist(lm[55], lm[285]) / norm;

  const eyeOpenL = dist(lm[159], lm[145]) / norm;
  const eyeOpenR = dist(lm[386], lm[374]) / norm;
  const eyeOpen = (eyeOpenL + eyeOpenR) / 2;

  return { mouthOpen, mouthWidth, cornerLiftNorm, browRaise, browGap, eyeOpen };
}

const CALIBRATION_FRAMES = 20;
const EMOTION_HISTORY_SIZE = 7;

// Per-face stateful tracker: calibrates a "neutral" baseline for this
// specific person over the first ~20 frames, then classifies emotion
// relative to that baseline (much more reliable than fixed magic numbers,
// since brow/mouth proportions vary a lot between faces). Also smooths
// the classification over a short rolling window to reduce flicker.
function createFaceEmotionTracker() {
  let calibrating = true;
  let frameCount = 0;
  let baseBrowRaise = 0;
  let baseBrowGap = 0;
  let baseMouthWidth = 0;
  const history: Emotion[] = [];

  function smooth(next: Emotion): Emotion {
    history.push(next);
    if (history.length > EMOTION_HISTORY_SIZE) history.shift();
    const counts = new Map<Emotion, number>();
    for (const e of history) counts.set(e, (counts.get(e) ?? 0) + 1);
    let best: Emotion = next;
    let bestCount = 0;
    for (const [e, c] of counts) {
      if (c > bestCount) {
        best = e;
        bestCount = c;
      }
    }
    return best;
  }

  return function classify(lm: Landmark[]): Emotion {
    const m = computeMetrics(lm);
    if (!m) return "neutral";

    if (calibrating) {
      baseBrowRaise += m.browRaise;
      baseBrowGap += m.browGap;
      baseMouthWidth += m.mouthWidth;
      frameCount++;
      if (frameCount >= CALIBRATION_FRAMES) {
        baseBrowRaise /= frameCount;
        baseBrowGap /= frameCount;
        baseMouthWidth /= frameCount;
        calibrating = false;
      }
      return "neutral";
    }

    const browRaiseRatio = m.browRaise / baseBrowRaise; // <1 = brows lowered
    const browGapRatio = m.browGap / baseBrowGap; // <1 = brows pulled together (furrow)
    const mouthWidthRatio = m.mouthWidth / baseMouthWidth; // >1 = wider (smile)

    let detected: Emotion = "neutral";

    if (m.mouthOpen > 0.22 && browRaiseRatio > 1.18) {
      detected = "surprised";
    } else if (m.cornerLiftNorm > 0.045 && mouthWidthRatio > 1.06) {
      detected = "happy";
    } else if (browGapRatio < 0.94 && browRaiseRatio < 0.92) {
      // furrowed + lowered brows = frown/angry — this is the key signal,
      // independent of eye openness since that varies a lot per person
      detected = "angry";
    } else if (m.cornerLiftNorm < -0.018 && mouthWidthRatio < 1.0) {
      detected = "sad";
    }

    return smooth(detected);
  };
}

// Computes a padded bounding box (in pixel space) around a set of landmarks.
function getBoundingBox(
  lm: Landmark[],
  w: number,
  h: number,
  paddingRatio = 0.18,
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of lm) {
    const px = p.x * w;
    const py = p.y * h;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const boxW = maxX - minX;
  const boxH = maxY - minY;
  const padX = boxW * paddingRatio;
  // a bit more padding on top for forehead/hair, less on the chin side
  const padTop = boxH * (paddingRatio + 0.12);
  const padBottom = boxH * paddingRatio * 0.4;

  return {
    x: minX - padX,
    y: minY - padTop,
    width: boxW + padX * 2,
    height: boxH + padTop + padBottom,
  };
}

// Draws a detection-style bounding box with a colored label tag, similar to
// common face/emotion-detection UIs (rounded tag, colored border).
function drawDetectionBox(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; width: number; height: number },
  label: string,
  color: string,
) {
  const { x, y, width, height } = box;

  // box border
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();

  // label tag
  ctx.save();
  ctx.font = "bold 15px sans-serif";
  const paddingX = 10;
  const tagHeight = 26;
  const textWidth = ctx.measureText(label).width;
  const tagWidth = textWidth + paddingX * 2;
  const tagX = x;
  const tagY = y - tagHeight;

  const r = 4;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tagX + r, tagY);
  ctx.lineTo(tagX + tagWidth - r, tagY);
  ctx.quadraticCurveTo(tagX + tagWidth, tagY, tagX + tagWidth, tagY + r);
  ctx.lineTo(tagX + tagWidth, tagY + tagHeight);
  ctx.lineTo(tagX, tagY + tagHeight);
  ctx.lineTo(tagX, tagY + r);
  ctx.quadraticCurveTo(tagX, tagY, tagX + r, tagY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "middle";
  ctx.fillText(label, tagX + paddingX, tagY + tagHeight / 2 + 1);
  ctx.restore();
}

export function useMoodTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const [status, setStatus] = useState("กำลังเริ่ม...");
  const [handCount, setHandCount] = useState(0);
  const [faceCount, setFaceCount] = useState(0);
  const [emotion, setEmotion] = useState<Emotion>("neutral");

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 640;
    canvas.height = 480;

    let latestHandLandmarks: Landmark[][] = [];
    let latestFaceLandmarks: Landmark[][] = [];
    let currentEmotions: Emotion[] = [];
    const trackers: Array<(lm: Landmark[]) => Emotion> = [];

    function getTracker(i: number) {
      if (!trackers[i]) trackers[i] = createFaceEmotionTracker();
      return trackers[i];
    }

    const hands = new Hands({
      locateFile: (f: string) => `/mediapipe/hands/${f}`,
    });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });
    hands.onResults((results: HandResults) => {
      latestHandLandmarks = results.multiHandLandmarks ?? [];
      setHandCount(latestHandLandmarks.length);
    });

    const faceMesh = new FaceMesh({
      locateFile: (f: string) => `/mediapipe/face_mesh/${f}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 4,
      refineLandmarks: true,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults((results: FaceResultsLocal) => {
      latestFaceLandmarks = results.multiFaceLandmarks ?? [];
      setFaceCount(latestFaceLandmarks.length);

      const detectedEmotions = latestFaceLandmarks.map((faceLm, i) =>
        getTracker(i)(faceLm),
      );
      // drop trackers for faces that disappeared so they reset cleanly
      // (re-calibrate) if a new face later takes that slot
      trackers.length = latestFaceLandmarks.length;
      currentEmotions = detectedEmotions;

      const primary = detectedEmotions[0] ?? "neutral";
      setEmotion((prev) => (prev === primary ? prev : primary));
    });

    let animId: number;
    let detectId: number;
    let cancelled = false;
    let activeStream: MediaStream | null = null;

    const renderLoop = () => {
      if (cancelled) return;

      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -w, 0, w, h);
      ctx.restore();

      latestFaceLandmarks.forEach((lm, i) => {
        const mirroredLm = lm.map((p) => ({ ...p, x: 1 - p.x }));
        const box = getBoundingBox(mirroredLm, w, h);
        const faceEmotion = currentEmotions[i] ?? "neutral";
        const color = EMOTION_COLOR[faceEmotion];
        const label = EMOTION_LABEL[faceEmotion];
        drawDetectionBox(ctx, box, label, color);
      });

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
      .getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
      })
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

  return {
    status,
    handCount,
    faceCount,
    emotion,
    emotionLabel: EMOTION_LABEL[emotion],
  };
}

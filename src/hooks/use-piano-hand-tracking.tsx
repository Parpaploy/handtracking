import { useEffect, useRef, useState, useCallback } from "react";
import type {
  HandResults,
  HandsConstructor,
  Landmark,
} from "../interfaces/hand-tracking.interface";

declare const Hands: HandsConstructor;

const FINGER_LABELS = ["ซอล", "โด", "เร", "มี", "ฟา"];
const FINGER_NOTES = [[67], [60], [62], [64], [65]];

const FINGERTIP_IDX = [4, 8, 12, 16, 20];
const FINGERBASE_IDX = [2, 6, 10, 14, 18];
const PRESS_THRESHOLD = 0.045;
const THUMB_PRESS_THRESHOLD = 0.04;

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

let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx() {
  if (!sharedAudioCtx) sharedAudioCtx = new AudioContext();
  return sharedAudioCtx;
}
function midiToFreq(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

type NoteNode = { osc: OscillatorNode; gain: GainNode };

function startNote(map: Map<string, NoteNode>, key: string, midi: number) {
  if (map.has(key)) return;
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = "triangle";
  osc.frequency.value = midiToFreq(midi);
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.02);
  osc.start();
  map.set(key, { osc, gain });
}

function stopNote(map: Map<string, NoteNode>, key: string) {
  const node = map.get(key);
  if (!node) return;
  const ctx = getAudioCtx();
  node.gain.gain.setValueAtTime(node.gain.gain.value, ctx.currentTime);
  node.gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
  node.osc.stop(ctx.currentTime + 0.19);
  map.delete(key);
}

function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[],
  w: number,
  h: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  for (let i = 0; i < lm.length; i++) {
    ctx.beginPath();
    ctx.arc(
      lm[i].x * w,
      lm[i].y * h,
      FINGERTIP_IDX.includes(i) ? 4 : 2.5,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  pressed: boolean,
  handColor: string,
) {
  const r = pressed ? 22 : 18;

  if (pressed) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r + 8, 0, Math.PI * 2);
    ctx.fillStyle =
      handColor === "orange" ? "rgba(255,140,0,0.15)" : "rgba(0,200,255,0.15)";
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = pressed
    ? handColor === "orange"
      ? "rgba(255,140,0,0.8)"
      : "rgba(0,200,255,0.8)"
    : "rgba(255,255,255,0.12)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = pressed
    ? handColor === "orange"
      ? "rgba(255,180,0,1)"
      : "rgba(0,230,255,1)"
    : "rgba(255,255,255,0.3)";
  ctx.lineWidth = pressed ? 2 : 1;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = `${pressed ? "bold" : "normal"} 11px sans-serif`;
  ctx.fillStyle = pressed ? "#fff" : "rgba(255,255,255,0.65)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x - 4, y);
  ctx.restore();
}

export function usePianoHandTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const [status, setStatus] = useState("กำลังเริ่ม...");
  const [handCount, setHandCount] = useState(0);
  const [activeNoteNames, setActiveNoteNames] = useState<string[]>([]);
  const [octave, setOctaveState] = useState(4);

  const octaveRef = useRef(4);
  const activeNotesMap = useRef(new Map<string, NoteNode>());
  const lastNotesKeyRef = useRef("");
  const prevPressed = useRef(new Set<string>());

  const setOctave = useCallback((fn: (prev: number) => number) => {
    setOctaveState((prev) => {
      const next = Math.max(1, Math.min(6, fn(prev)));
      octaveRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const notesMap = activeNotesMap.current;

    canvas.width = 720;
    canvas.height = 560;

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
      const w = canvas.width;
      const h = canvas.height;

      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(results.image, -w, 0, w, h);
      ctx.restore();

      const landmarks = results.multiHandLandmarks ?? [];
      const handedness = results.multiHandedness ?? [];

      const newPressed = new Set<string>();
      const noteNames: string[] = [];

      for (let hi = 0; hi < landmarks.length; hi++) {
        const lm = landmarks[hi];
        const label = handedness[hi]?.label ?? "Right";

        const m: Landmark[] = lm.map((p) => ({ ...p, x: 1 - p.x }));

        const isLeft = label === "Left";
        const handColor = isLeft ? "orange" : "cyan";
        const skeletonColor = isLeft
          ? "rgba(255,140,0,0.5)"
          : "rgba(0,200,255,0.5)";
        const octaveOffset = isLeft ? 1 : 0;

        drawHandSkeleton(ctx, m, w, h, skeletonColor);

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

          const tx = tip.x * w;
          const ty = Math.max(26, tip.y * h - 28);

          drawBubble(ctx, tx, ty, FINGER_LABELS[fi], pressed, handColor);

          if (pressed) {
            const noteKey = `${label}_${fi}`;
            newPressed.add(noteKey);
            const midi =
              FINGER_NOTES[fi][0] +
              octaveOffset * 12 +
              (octaveRef.current - 4) * 12;
            noteNames.push(FINGER_LABELS[fi]);

            if (!prevPressed.current.has(noteKey)) {
              startNote(notesMap, noteKey, midi);
            }
          }
        }
      }

      for (const k of prevPressed.current) {
        if (!newPressed.has(k)) stopNote(notesMap, k);
      }
      prevPressed.current = newPressed;

      setHandCount(landmarks.length);
      const uniqueNotes = [...new Set(noteNames)];
      const notesKey = uniqueNotes.join("|");
      if (notesKey !== lastNotesKeyRef.current) {
        lastNotesKeyRef.current = notesKey;
        setActiveNoteNames(uniqueNotes);
      }
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
          video.play().then(() => {
            if (cancelled) return;
            const loop = async () => {
              if (cancelled) return;
              if (video.readyState === 4) await hands.send({ image: video });
              if (cancelled) return;
              animId = requestAnimationFrame(loop);
            };
            loop().catch(console.error);
          });
        };
      })
      .catch((err: Error) => {
        if (!cancelled) setStatus(`❌ ${err.message}`);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
      activeStream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.onloadedmetadata = null;
      hands.close().catch(() => {});
      notesMap.forEach((_, k) => stopNote(notesMap, k));
    };
  }, [videoRef, canvasRef]);

  return { status, handCount, activeNoteNames, octave, setOctave };
}
